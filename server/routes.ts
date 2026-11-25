import { Router, json } from 'express';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { all, get, run, tx, IMG_DIR } from './db.js';
import { getAllSettings, setSettings, getSetting, DEFAULTS } from './settings.js';
import { sources, getSource } from './sources/index.js';
import { cacheClear, cacheGet, cacheSet, cachePrune, resetBlock } from './http.js';
import { checkAll, checkState, describeError, getSeries, refreshSeries, schedulePolling, shapeSeries, statuses, track, upsertSummary } from './service.js';
import { isRecentWithinWeek, normalizeStatus, normalizeTags, normalizeTitleKey, normalizeType, scoreSearchMatch, type BrowseQuery, type ChapterPages, type SeriesSummary } from './sources/baseSource.js';
import { MangaDex } from './sources/mangaDex.js';
import { enrichFromCatalog } from './enrichment.js';

export const api = Router();
api.use(json({ limit: '100mb' }));

const wrap = (fn: (req: any, res: any, next: any) => Promise<any> | any) => (req: any, res: any, next: any) =>
  Promise.resolve(fn(req, res, next)).catch((e) => {
    const d = describeError(e);
    if (!res.headersSent) {
      res.status(d.kind === 'unknown' ? 500 : 502).json({ error: d.message, kind: d.kind });
    }
  });

const STATUSES = ['reading', 'plan', 'hold', 'completed', 'dropped'];
const imgUrl = (sourceId: string, u: string) => `/api/img?s=${encodeURIComponent(sourceId)}&u=${encodeURIComponent(u)}`;

/**
 * Source priority for deduplication:
 * Asura Scans -> King of Shojo -> MangaDex -> Weeb Central -> Vortex Scans -> Demonic Scans -> MangaHere -> others
 */
const SOURCE_PRIORITY: Record<string, number> = {
  asuraScans: 1,
  kingOfShojo: 2,
  mangaDex: 3,
  weebCentral: 4,
  vortexScans: 5,
  demonicScans: 6,
  mangaHere: 7,
  manhuaUs: 8,
  mangakakalot: 9,
  batoTo: 10,
  reaperScans: 11,
};
const priorityOf = (sourceId: string) => SOURCE_PRIORITY[sourceId] ?? 99;

const chosen = (q: unknown) => {
  const ids = String(q ?? '').split(',').filter(Boolean);
  if (!ids.length) return sources.filter((s) => s.enabled);
  return sources.filter((s) => s.enabled && ids.includes(s.id) && !s.hiddenFromFilters);
};

// ---------------------------------------------------------------- sources & tags
const sourceInfo = (s: (typeof sources)[number]) => ({
  id: s.id,
  name: s.name,
  tier: s.tier,
  hidden: s.hiddenFromFilters,
  enabled: s.enabled,
  baseUrl: s.baseUrl,
  extraSettings: s.extraSettings,
  status: statuses[s.id],
});
api.get('/sources', (_req, res) => res.json(sources.map(sourceInfo)));
api.post('/sources/:id/test', wrap(async (req, res) => {
  const s = getSource(req.params.id);
  resetBlock(new URL(s.baseUrl).host);
  try {
    const items = await track(s, () => s.latest(1));
    res.json({ ok: true, message: `OK — ${items.length} series on latest page`, source: sourceInfo(s) });
  } catch (e) {
    res.json({ ok: false, message: describeError(e).message, source: sourceInfo(s) });
  }
}));

const BASE_TAGS = [
  'Action', 'Adaptation', 'Adult', 'Adventure', 'Aliens', 'Animals', 'Anthology', "Boys' Love", 'Comedy',
  'Cooking', 'Crime', 'Crossdressing', 'Crazy MC', 'Delinquents', 'Demon', 'Demons', 'Doujinshi', 'Drama',
  'Dungeons', 'Ecchi', 'Fantasy', 'Full Color', 'Game', 'Genderswap', 'Genius MC', 'Ghosts', "Girls' Love",
  'Gore', 'Gyaru', 'Harem', 'Historical', 'Horror', 'Incest', 'Isekai', 'Josei', 'Loli', 'Mafia', 'Magic',
  'Magical Girls', 'Martial Arts', 'Mature', 'Mecha', 'Medical', 'Military', 'Monster Girls', 'Monsters',
  'Murim', 'Music', 'Mystery', 'Necromancer', 'Ninja', 'Office Workers', 'Official Colored', 'Oneshot',
  'Overpowered', 'Philosophical', 'Police', 'Post-Apocalyptic', 'Psychological', 'Regression', 'Reincarnation',
  'Revenge', 'Reverse Harem', 'Romance', 'Samurai', 'School Life', 'Sci-Fi', 'Seinen', 'Sexual Violence',
  'Shota', 'Shoujo', 'Shounen', 'Slice of Life', 'Smut', 'Sports', 'SuperHero', 'Supernatural', 'Survival',
  'System', 'Thriller', 'Time Travel', 'Tower', 'Traditional Games', 'Tragedy', 'Transmigration', 'Vampires',
  'Video Games', 'Villain', 'Villainess', 'Violence', 'Virtual Reality', 'Webtoon', 'Wuxia', 'Zombies',
];

api.get('/tags', wrap(async (_req, res) => {
  const list: string[] = [...BASE_TAGS];
  // Pull any genres already stored in the local SQLite database
  for (const r of all('SELECT genres FROM series WHERE genres IS NOT NULL')) {
    try {
      const arr = JSON.parse(r.genres);
      if (Array.isArray(arr)) list.push(...arr);
    } catch {
      /* ignore */
    }
  }
  // Merge MangaDex tag catalog if available
  const md = sources.find((s) => s.id === 'mangaDex') as MangaDex | undefined;
  if (md && md.enabled) {
    const map = await md.tagMap();
    list.push(...Object.keys(map));
  }
  const normalized = normalizeTags(list).sort((a, b) => a.localeCompare(b));
  res.json({ tags: normalized });
}));

// ---------------------------------------------------------------- decorate & deduplicate
const parseJsonArr = (s: string | null | undefined): string[] => {
  try {
    return JSON.parse(s ?? '[]');
  } catch {
    return [];
  }
};

const decorate = (sourceId: string, items: SeriesSummary[]) => {
  const nowMs = Date.now();
  return items.map((it) => {
    const row = get(
      'SELECT id, in_library, library_status, site_status, media_type, genres, creator, rating, latest_number, latest_at, last_read_number FROM series WHERE source_id = ? AND series_key = ?',
      sourceId,
      it.seriesKey,
    );
    const dbGenres = parseJsonArr(row?.genres);
    const genres = normalizeTags([...(it.genres ?? []), ...dbGenres]);
    const chCount = it.chapterCount ?? row?.latest_number ?? null;

    let unreadCount: number | null = null;
    let newUnreadCount = 0;
    let latestNewAtMs = 0;

    // Build recentChapters (up to 2), pulling from local DB if the series has already been refreshed
    let recentChapters = (it.recentChapters ?? []).slice(0, 2).map((c) => {
      const read = row && row.last_read_number >= 0 ? Number(c.number) <= Number(row.last_read_number) : false;
      const isNew = !read && isRecentWithinWeek(c.publishedAt ?? it.latestAt, nowMs);
      return { ...c, read, isNew };
    });

    if (row?.id) {
      unreadCount = (
        get('SELECT COUNT(*) n FROM chapters WHERE series_id = ? AND number > ?', row.id, row.last_read_number) as any
      ).n as number;
      const unreadRows = all(
        'SELECT published_at, discovered_at FROM chapters WHERE series_id = ? AND number > ?',
        row.id,
        row.last_read_number,
      );
      for (const u of unreadRows) {
        const eff = (u.published_at as string | null) ?? (u.discovered_at as string | null);
        if (isRecentWithinWeek(eff, nowMs)) {
          newUnreadCount++;
          const t = Date.parse(eff!);
          if (t > latestNewAtMs) latestNewAtMs = t;
        }
      }
      const dbChs = all(
        'SELECT id, chapter_key, number, title, published_at, discovered_at FROM chapters WHERE series_id = ? ORDER BY number DESC LIMIT 2',
        row.id,
      );
      if (dbChs.length) {
        recentChapters = dbChs.map((c) => {
          const read = Number(row.last_read_number) >= 0 && Number(c.number) <= Number(row.last_read_number);
          const eff = (c.published_at as string | null) ?? (c.discovered_at as string | null);
          const isNew = !read && isRecentWithinWeek(eff, nowMs);
          return {
            id: c.id as number,
            key: c.chapter_key as string,
            number: Number(c.number),
            title: `Ch. ${c.number}`,
            publishedAt: eff,
            read,
            isNew,
          };
        });
      }
    } else {
      // Unbookmarked discovery item: count any recentChapters (<7 days) as fresh releases
      for (const c of recentChapters) {
        if (c.isNew) {
          newUnreadCount++;
          const t = Date.parse(c.publishedAt ?? it.latestAt ?? '');
          if (!Number.isNaN(t) && t > latestNewAtMs) latestNewAtMs = t;
        }
      }
    }

    return {
      ...it,
      sourceId,
      sourceName: getSource(sourceId).name,
      seriesId: row?.id ?? null,
      inLibrary: !!row?.in_library,
      libraryStatus: row?.library_status ?? null,
      unread: unreadCount,
      newUnreadCount,
      hasNewUnread: newUnreadCount > 0,
      latestNewAt: latestNewAtMs > 0 ? new Date(latestNewAtMs).toISOString() : null,
      status: normalizeStatus(it.status ?? row?.site_status) ?? it.status ?? row?.site_status ?? null,
      type: normalizeType(it.type ?? row?.media_type) ?? it.type ?? row?.media_type ?? null,
      genres,
      creator: it.creator ?? row?.creator ?? null,
      chapterCount: chCount,
      rating: it.rating ?? row?.rating ?? null,
      latestAt: it.latestAt ?? row?.latest_at ?? null,
      recentChapters,
    };
  });
};

export interface DeduplicatedItem {
  sourceId: string;
  sourceName: string;
  seriesKey: string;
  title: string;
  altTitles?: string[];
  cover?: string | null;
  latestChapter?: string | null;
  latestAt?: string | null;
  seriesId: number | null;
  inLibrary: boolean;
  status?: string | null;
  type?: string | null;
  genres: string[];
  creator?: string | null;
  chapterCount?: number | null;
  rating?: number | null;
  recentChapters: any[];
  altSources: { sourceId: string; sourceName: string; seriesKey: string; seriesId: number | null; latestChapter?: string | null }[];
}

/**
 * Deduplicate items across sources using canonical title keys + altTitles.
 * When two items share any normalized title or altTitle key, the higher-priority source
 * (Asura Scans -> King of Shojo -> MangaDex -> others) becomes the primary card, while metadata
 * (genres, type, status, creator, cover, chapterCount) is merged from both and the secondary
 * source is attached in `altSources`.
 */
function deduplicateItems(rawItems: any[]): DeduplicatedItem[] {
  const sorted = [...rawItems].sort((a, b) => priorityOf(a.sourceId) - priorityOf(b.sourceId));
  const groups: DeduplicatedItem[] = [];
  const keyToGroup = new Map<string, DeduplicatedItem>();

  for (const item of sorted) {
    const candidateKeys = [item.title, ...(item.altTitles ?? [])]
      .map((t) => normalizeTitleKey(t))
      .filter((k) => k.length >= 3);

    let existing: DeduplicatedItem | undefined;
    for (const k of candidateKeys) {
      const hit = keyToGroup.get(k);
      if (hit) {
        existing = hit;
        break;
      }
    }

    if (!existing) {
      const group: DeduplicatedItem = {
        ...item,
        genres: normalizeTags(item.genres),
        recentChapters: item.recentChapters ?? [],
        altSources: item.altSources ? [...item.altSources] : [],
      };
      groups.push(group);
      for (const k of candidateKeys) if (!keyToGroup.has(k)) keyToGroup.set(k, group);
    } else {
      // Register any new alias keys onto the existing group
      for (const k of candidateKeys) if (!keyToGroup.has(k)) keyToGroup.set(k, existing);
      // Merge supplementary metadata from the duplicate entry
      existing.genres = normalizeTags([...existing.genres, ...(item.genres ?? [])]);
      existing.cover = existing.cover || item.cover;
      existing.type = existing.type || item.type;
      existing.status = existing.status || item.status;
      existing.creator = existing.creator || item.creator;
      existing.rating = existing.rating ?? item.rating;
      existing.chapterCount = Math.max(Number(existing.chapterCount) || 0, Number(item.chapterCount) || 0) || existing.chapterCount;
      if (item.inLibrary && !existing.inLibrary) {
        existing.inLibrary = true;
        existing.seriesId = existing.seriesId ?? item.seriesId;
      }
      if (!existing.recentChapters?.length && item.recentChapters?.length) {
        existing.recentChapters = item.recentChapters;
      }
      if (
        item.sourceId !== existing.sourceId &&
        !existing.altSources.some((a) => a.sourceId === item.sourceId)
      ) {
        existing.altSources.push({
          sourceId: item.sourceId,
          sourceName: item.sourceName,
          seriesKey: item.seriesKey,
          seriesId: item.seriesId ?? null,
          latestChapter: item.latestChapter ?? null,
        });
      }
      for (const subAlt of item.altSources ?? []) {
        if (
          subAlt.sourceId !== existing.sourceId &&
          !existing.altSources.some((a) => a.sourceId === subAlt.sourceId)
        ) {
          existing.altSources.push(subAlt);
        }
      }
    }
  }
  return groups;
}

function parseBrowseQuery(q: any): BrowseQuery {
  const split = (v: unknown) =>
    String(v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  return {
    page: Math.max(1, Number(q.page) || 1),
    q: String(q.q ?? '').trim(),
    status: split(q.status),
    type: split(q.type),
    genresInclude: split(q.genresInclude),
    genresExclude: split(q.genresExclude),
    creator: String(q.creator ?? '').trim(),
    sort: String(q.sort ?? 'latest'),
  };
}

function matchesServerBrowseFilter(it: DeduplicatedItem, bq: BrowseQuery): boolean {
  if (bq.status?.length) {
    if (!it.status || !bq.status.some((s) => s.toLowerCase() === it.status!.toLowerCase())) return false;
  }
  if (bq.type?.length) {
    if (!it.type || !bq.type.some((t) => t.toLowerCase() === it.type!.toLowerCase())) return false;
  }
  if (bq.genresInclude?.length) {
    const gLow = (it.genres ?? []).map((g) => g.toLowerCase());
    if (!bq.genresInclude.every((g) => gLow.includes(g.toLowerCase()))) return false;
  }
  if (bq.genresExclude?.length) {
    const gLow = (it.genres ?? []).map((g) => g.toLowerCase());
    if (gLow.some((g) => bq.genresExclude!.some((ex) => ex.toLowerCase() === g))) return false;
  }
  if (bq.creator) {
    const cLow = bq.creator.toLowerCase();
    const hay = `${it.creator ?? ''} ${it.title}`.toLowerCase();
    if (!hay.includes(cLow)) return false;
  }
  return true;
}

// ---------------------------------------------------------------- discovery / search
api.get('/discover', wrap(async (req, res) => {
  const bq = parseBrowseQuery(req.query);
  const srcs = chosen(req.query.sources);
  const raw: any[] = [];
  const st: Record<string, any> = {};
  await Promise.all(
    srcs.map(async (s) => {
      try {
        const list = await track(s, () => s.browse(bq));
        raw.push(...decorate(s.id, list));
        st[s.id] = { ok: true };
      } catch (e) {
        st[s.id] = { ok: false, message: describeError(e).message };
      }
    }),
  );
  let items = deduplicateItems(raw).filter((it) => matchesServerBrowseFilter(it, bq));
  const t = (x: any) => {
    const ms = x.latestAt ? Date.parse(x.latestAt) : 0;
    return Number.isNaN(ms) ? 0 : ms;
  };
  const newPrio = (a: any, b: any) => {
    const aBookmarkedNew = a.inLibrary && a.hasNewUnread ? 1 : 0;
    const bBookmarkedNew = b.inLibrary && b.hasNewUnread ? 1 : 0;
    if (bBookmarkedNew !== aBookmarkedNew) return bBookmarkedNew - aBookmarkedNew;
    const aNew = a.hasNewUnread ? 1 : 0;
    const bNew = b.hasNewUnread ? 1 : 0;
    if (bNew !== aNew) return bNew - aNew;
    return 0;
  };
  items.sort((a, b) => newPrio(a, b) || t(b) - t(a) || priorityOf(a.sourceId) - priorityOf(b.sourceId));
  res.json({ items, statuses: st });
}));

api.get('/search', wrap(async (req, res) => {
  const bq = parseBrowseQuery(req.query);
  if (!bq.q) return res.json({ items: [], results: {}, statuses: {} });
  const srcs = chosen(req.query.sources);
  const results: Record<string, any[]> = {};
  const rawCounts: Record<string, { raw: number; relevant: number }> = {};
  const rawAll: any[] = [];
  const st: Record<string, any> = {};

  await Promise.all(
    srcs.map(async (s) => {
      try {
        const rawList = decorate(s.id, await track(s, () => s.browse(bq)));
        // Enforce strict title relevance on every source's raw results
        const relevantList = rawList.filter((it) => {
          const candidates = [it.title, ...(it.altTitles ?? []), it.seriesKey?.replace(/[-_/]+/g, ' ')];
          const m = scoreSearchMatch(bq.q, candidates);
          if (m.matches) (it as any)._searchScore = m.score;
          return m.matches;
        });
        rawCounts[s.id] = { raw: rawList.length, relevant: relevantList.length };
        results[s.id] = relevantList;
        rawAll.push(...relevantList);
        st[s.id] = { ok: true };
      } catch (e) {
        rawCounts[s.id] = { raw: 0, relevant: 0 };
        results[s.id] = [];
        st[s.id] = { ok: false, message: describeError(e).message };
      }
    }),
  );

  // Deduplicate across all sources prioritizing Asura Scans -> King of Shojo -> MangaDex
  let items = deduplicateItems(rawAll);

  // Enrich top search results from AniList catalog if metadata is missing
  if (bq.q && items.length > 0) {
    await Promise.all(
      items.slice(0, 6).map(async (it) => {
        if (!it.type || !it.genres.length || !it.cover) {
          const en = await enrichFromCatalog(it.title);
          if (en) {
            it.type = it.type || en.type || null;
            it.status = it.status || en.status || null;
            it.genres = normalizeTags([...it.genres, ...en.genres]);
            it.creator = it.creator || en.creator || null;
            it.cover = it.cover || en.cover || null;
            it.rating = it.rating ?? en.rating ?? null;
          }
        }
      }),
    );
    items = deduplicateItems(items);
  }

  items = items.filter((it) => matchesServerBrowseFilter(it, bq));
  items.sort(
    (a, b) =>
      ((b as any)._searchScore ?? 0) - ((a as any)._searchScore ?? 0) ||
      priorityOf(a.sourceId) - priorityOf(b.sourceId),
  );

  const countSummary = Object.entries(rawCounts)
    .map(([id, c]) => `${id}:${c.raw}->${c.relevant}`)
    .join(', ');
  console.log(`[search] q="${bq.q}" (${countSummary}) => ${items.length} deduplicated`);

  res.json({ items, results, statuses: st, counts: rawCounts });
}));

// ---------------------------------------------------------------- library
api.get('/library', (req, res) => {
  const where = ['in_library = 1'];
  const p: any[] = [];
  if (req.query.status && STATUSES.includes(String(req.query.status))) {
    where.push('library_status = ?');
    p.push(req.query.status);
  }
  if (req.query.source) {
    where.push('source_id = ?');
    p.push(req.query.source);
  }
  const q = String(req.query.q ?? '').trim();
  if (q) {
    where.push('(title LIKE ? OR aliases LIKE ? OR source_aliases LIKE ?)');
    p.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const rows = all(`SELECT * FROM series WHERE ${where.join(' AND ')}`, ...p).map(shapeSeries);
  const sort = String(req.query.sort ?? 'latest');
  const time = (s?: string | null) => {
    if (!s) return 0;
    const t = Date.parse(s);
    return Number.isNaN(t) ? 0 : t;
  };
  /**
   * Default ('latest') and 'unread' sorts prioritize series with recent unread chapters (< 1 week old, "New")
   * at the very top (1st), ordered by freshest new chapter release date, then unread count, then latest update.
   */
  const compareNewPriority = (a: any, b: any) => {
    const aHasNew = a.hasNewUnread ? 1 : 0;
    const bHasNew = b.hasNewUnread ? 1 : 0;
    if (bHasNew !== aHasNew) return bHasNew - aHasNew;
    if (aHasNew && bHasNew) {
      const diffNew = time(b.latestNewAt) - time(a.latestNewAt);
      if (diffNew !== 0) return diffNew;
      if (b.newUnreadCount !== a.newUnreadCount) return b.newUnreadCount - a.newUnreadCount;
    }
    return 0;
  };

  rows.sort((a, b) =>
    sort === 'unread'
      ? compareNewPriority(a, b) || b.unread - a.unread || time(b.latestAt) - time(a.latestAt)
      : sort === 'title'
        ? a.title.localeCompare(b.title)
        : sort === 'added'
          ? time(b.addedAt) - time(a.addedAt)
          : sort === 'read'
            ? time(b.lastReadAt) - time(a.lastReadAt)
            : compareNewPriority(a, b) ||
              (b.unread > 0 ? 1 : 0) - (a.unread > 0 ? 1 : 0) ||
              time(b.latestAt) - time(a.latestAt) ||
              b.unread - a.unread,
  );
  const counts: Record<string, number> = {};
  for (const r of all('SELECT library_status s, COUNT(*) n FROM series WHERE in_library = 1 GROUP BY library_status')) counts[r.s] = r.n;
  res.json({ items: rows, counts });
});

/** Add to library: either { seriesId } or a summary { sourceId, seriesKey, title, cover } */
api.post('/library', wrap(async (req, res) => {
  const b = req.body;
  let id: number;
  if (b.seriesId) id = Number(b.seriesId);
  else {
    getSource(b.sourceId);
    id = upsertSummary(b.sourceId, {
      seriesKey: b.seriesKey,
      title: b.title,
      cover: b.cover,
      latestAt: b.latestAt,
      status: b.statusLabel,
      type: b.type,
      genres: b.genres,
      creator: b.creator,
      rating: b.rating,
    });
  }
  if (!getSeries(id)) return res.status(404).json({ error: 'Series not found' });
  run('UPDATE series SET in_library = 1, library_status = ? WHERE id = ?', STATUSES.includes(b.status) ? b.status : 'plan', id);
  let warning: string | undefined;
  try {
    await refreshSeries(id);
  } catch (e) {
    warning = describeError(e).message;
  }
  res.json({ series: shapeSeries(getSeries(id)), warning });
}));

api.post('/library/check', wrap(async (_req, res) => {
  await checkAll();
  res.json(checkState);
}));
api.get('/library/check', (_req, res) => res.json(checkState));

// ---------------------------------------------------------------- series & quick chapter jump
/** Preview (not bookmarked): creates a hidden row so chapters and reader work. */
api.post('/series/open', wrap(async (req, res) => {
  const b = req.body;
  getSource(b.sourceId);
  const id = upsertSummary(b.sourceId, {
    seriesKey: b.seriesKey,
    title: b.title,
    cover: b.cover,
    latestAt: b.latestAt,
    status: b.status,
    type: b.type,
    genres: b.genres,
    creator: b.creator,
    rating: b.rating,
  });
  if (!get('SELECT 1 x FROM chapters WHERE series_id = ?', id)) await refreshSeries(id);
  res.json({ id });
}));

/**
 * Resolve & open a specific chapter directly from a Discovery/Browse card quick link.
 * Ensures the series exists in SQLite, fetches chapters if needed, and returns { seriesId, chapterId }.
 */
api.post('/series/open-chapter', wrap(async (req, res) => {
  const b = req.body;
  getSource(b.sourceId);
  const seriesId = upsertSummary(b.sourceId, {
    seriesKey: b.seriesKey,
    title: b.title,
    cover: b.cover,
    latestAt: b.latestAt,
  });
  if (!get('SELECT 1 x FROM chapters WHERE series_id = ?', seriesId)) {
    await refreshSeries(seriesId);
  }
  let ch =
    (b.chapterKey && get('SELECT id FROM chapters WHERE series_id = ? AND chapter_key = ?', seriesId, b.chapterKey)) ||
    (b.chapterNumber != null && get('SELECT id FROM chapters WHERE series_id = ? AND number = ?', seriesId, Number(b.chapterNumber)));
  if (!ch) {
    // Refresh once in case it's a brand-new chapter
    await refreshSeries(seriesId);
    ch =
      (b.chapterKey && get('SELECT id FROM chapters WHERE series_id = ? AND chapter_key = ?', seriesId, b.chapterKey)) ||
      (b.chapterNumber != null && get('SELECT id FROM chapters WHERE series_id = ? AND number = ?', seriesId, Number(b.chapterNumber))) ||
      get('SELECT id FROM chapters WHERE series_id = ? ORDER BY number DESC LIMIT 1', seriesId);
  }
  if (!ch) return res.status(404).json({ error: 'Chapter could not be found for this series.' });
  res.json({ seriesId, chapterId: ch.id });
}));

api.get('/series/:id', wrap(async (req, res) => {
  const s = getSeries(Number(req.params.id));
  if (!s) return res.status(404).json({ error: 'Series not found' });
  const nowMs = Date.now();
  const chapters = all(
    'SELECT id, chapter_key, number, title, published_at, discovered_at, locked FROM chapters WHERE series_id = ? ORDER BY number DESC',
    s.id,
  ).map((c) => {
    const read = Number(c.number) <= Number(s.last_read_number);
    const eff = (c.published_at as string | null) ?? (c.discovered_at as string | null);
    const isNew = !read && isRecentWithinWeek(eff, nowMs);
    return {
      id: c.id,
      number: c.number,
      title: c.title,
      publishedAt: eff,
      locked: !!c.locked,
      read,
      isNew,
      originalUrl: getSource(s.source_id).chapterUrl(s.series_key, c.chapter_key, c.number),
    };
  });
  res.json({ series: shapeSeries(s), chapters });
}));

api.patch('/series/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const b = req.body;
  if (!getSeries(id)) return res.status(404).json({ error: 'Series not found' });
  if (STATUSES.includes(b.libraryStatus)) run('UPDATE series SET library_status = ? WHERE id = ?', b.libraryStatus, id);
  if (Array.isArray(b.aliases)) run('UPDATE series SET aliases = ? WHERE id = ?', JSON.stringify(b.aliases.map(String).map((x: string) => x.trim()).filter(Boolean)), id);
  if (typeof b.title === 'string' && b.title.trim()) run('UPDATE series SET title = ? WHERE id = ?', b.title.trim(), id);
  res.json({ series: shapeSeries(getSeries(id)) });
}));

api.delete('/series/:id', (req, res) => {
  run('DELETE FROM series WHERE id = ?', Number(req.params.id));
  res.json({ ok: true });
});

api.post('/series/:id/refresh', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const r = await refreshSeries(id);
  res.json({ ...r, series: shapeSeries(getSeries(id)) });
}));

/** body: { chapterId, scroll, done, force } — force lets the user lower the read marker. */
api.put('/series/:id/progress', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const { chapterId, scroll = 0, done = false, force = false } = req.body;
  const ch = get('SELECT * FROM chapters WHERE id = ? AND series_id = ?', chapterId, id);
  if (!ch) return res.status(404).json({ error: 'Chapter not found' });
  const s = getSeries(id);
  const number = force ? ch.number : Math.max(s.last_read_number, ch.number);
  run('UPDATE series SET last_read_number = ?, resume_chapter_id = ?, resume_scroll = ?, resume_done = ?, last_read_at = ? WHERE id = ?', number, ch.id, Number(scroll) || 0, done ? 1 : 0, new Date().toISOString(), id);
  if (s.in_library && s.library_status === 'plan') run("UPDATE series SET library_status = 'reading' WHERE id = ?", id);
  res.json({ ok: true });
}));

api.delete('/series/:id/progress', (req, res) => {
  run('UPDATE series SET last_read_number = -1, resume_chapter_id = NULL, resume_scroll = 0, resume_done = 0 WHERE id = ?', Number(req.params.id));
  res.json({ ok: true });
});

// ---------------------------------------------------------------- reader / chapter fetcher
api.get('/reader/:seriesId/:chapterId', wrap(async (req, res) => {
  const s = getSeries(Number(req.params.seriesId));
  const ch = s && get('SELECT * FROM chapters WHERE id = ? AND series_id = ?', Number(req.params.chapterId), s.id);
  if (!s || !ch) return res.status(404).json({ error: 'Chapter not found' });
  const src = getSource(s.source_id);
  const key = `pages:${src.id}:${s.series_key}:${ch.chapter_key}`;
  let pages = cacheGet<ChapterPages>(key);
  if (!pages || req.query.fresh) {
    pages = await track(src, () => src.pages(s.series_key, ch.chapter_key));
    if (pages.images.length) cacheSet(key, pages, 6 * 3600_000);
  }
  const prev = get('SELECT id FROM chapters WHERE series_id = ? AND number < ? ORDER BY number DESC LIMIT 1', s.id, ch.number);
  const next = get('SELECT id FROM chapters WHERE series_id = ? AND number > ? ORDER BY number ASC LIMIT 1', s.id, ch.number);
  res.json({
    series: { id: s.id, title: s.title, sourceId: src.id },
    chapter: { id: ch.id, number: ch.number, title: ch.title },
    images: pages.images.map((u) => imgUrl(src.id, u)),
    locked: !!pages.locked,
    message: pages.message,
    prevId: prev?.id ?? null,
    nextId: next?.id ?? null,
    originalUrl: src.chapterUrl(s.series_key, ch.chapter_key, ch.number),
    resume: s.resume_chapter_id === ch.id ? { scroll: s.resume_scroll, done: !!s.resume_done } : null,
  });
}));

// ---------------------------------------------------------------- image proxy
const isPrivateIp = (ip: string) =>
  net.isIPv4(ip)
    ? /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)
    : /^(::1?$|fe80|fc|fd)/i.test(ip);

api.get('/img', async (req, res) => {
  try {
    const u = new URL(String(req.query.u));
    if (!/^https?:$/.test(u.protocol)) return void res.status(400).send('bad url');
    const src = sources.find((x) => x.id === String(req.query.s));
    const addrs = await dns.lookup(u.hostname, { all: true });
    if (addrs.some((a) => isPrivateIp(a.address))) return void res.status(403).send('private address blocked');

    const key = crypto.createHash('sha1').update(u.toString()).digest('hex');
    const file = path.join(IMG_DIR, key);
    res.setHeader('Cache-Control', 'public, max-age=86400');

    // Only serve cached file if it actually holds image content-type (evicts old text/plain challenge responses)
    if (fs.existsSync(file) && fs.existsSync(file + '.type')) {
      const cachedType = fs.readFileSync(file + '.type', 'utf8').trim();
      if (cachedType.startsWith('image/')) {
        res.type(cachedType);
        return void fs.createReadStream(file).pipe(res);
      }
      fs.rmSync(file, { force: true });
      fs.rmSync(file + '.type', { force: true });
    }

    // MangaDex CDN (uploads.mangadex.org / *.mangadex.network) redirects to /edge/challenge if
    // Referer: https://mangadex.org/ is sent with a browser UA. Omit Referer and use MangaHub UA.
    const isMangaDexHost = /mangadex\.(org|network)$/i.test(u.hostname) || src?.id === 'mangaDex';
    const isAniListHost = /anilist\.co$/i.test(u.hostname);

    const buildHeaders = (urlObj: URL): Record<string, string> => {
      if (isMangaDexHost || isAniListHost) {
        return {
          'User-Agent': 'MangaHub/1.0 (+http://localhost:3001)',
          Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        };
      }
      return {
        'User-Agent': getSetting('userAgent'),
        ...(src ? { Referer: src.baseUrl + '/' } : {}),
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      };
    };

    // Candidates: for MangaDex .256.jpg / .512.jpg thumbnails, fall back to original cover file if needed
    const candidates = [u.toString()];
    if (isMangaDexHost && /\.(256|512)\.jpg$/i.test(u.pathname)) {
      candidates.push(u.toString().replace(/\.(256|512)\.jpg$/i, ''));
    }

    let last = 0;
    for (const candidate of candidates) {
      const targetUrl = new URL(candidate);
      for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt) await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
        try {
          const r = await fetch(targetUrl, {
            signal: AbortSignal.timeout(25_000),
            headers: buildHeaders(targetUrl),
          });
          last = r.status;
          const type = (r.headers.get('content-type') ?? '').toLowerCase();
          if (r.ok && type.startsWith('image/')) {
            const buf = Buffer.from(await r.arrayBuffer());
            if (buf.length > 64) {
              fs.writeFileSync(file, buf);
              fs.writeFileSync(file + '.type', type);
              res.type(type);
              return void res.end(buf);
            }
          }
          if (r.status < 500 && r.status !== 429) break;
        } catch {
          last = 502;
        }
      }
    }
    res.removeHeader('Cache-Control');
    res.status(last || 502).send(`upstream image error ${last}`);
  } catch (e) {
    res.status(400).send((e as Error).message);
  }
});

// ---------------------------------------------------------------- settings / backup
api.get('/settings', (_req, res) => res.json(getAllSettings()));
api.put('/settings', (req, res) => {
  setSettings(req.body ?? {});
  schedulePolling();
  res.json(getAllSettings());
});

api.post('/cache/clear', (_req, res) => {
  cacheClear();
  let files = 0;
  for (const f of fs.readdirSync(IMG_DIR)) {
    fs.rmSync(path.join(IMG_DIR, f), { force: true });
    files++;
  }
  res.json({ ok: true, imagesRemoved: files / 2 });
});

api.get('/backup', (_req, res) => {
  const backup = {
    app: 'manga-hub',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: getAllSettings(),
    series: all('SELECT * FROM series').map((s) => ({ ...s, chapters: all('SELECT chapter_key, number, title, published_at, locked FROM chapters WHERE series_id = ?', s.id) })),
  };
  res.setHeader('Content-Disposition', `attachment; filename="manga-hub-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(backup);
});

api.post('/restore', wrap(async (req, res) => {
  const b = req.body;
  if (b?.app !== 'manga-hub' || !Array.isArray(b.series)) return res.status(400).json({ error: 'Not a Manga Hub backup file' });
  const mode = req.query.mode === 'replace' ? 'replace' : 'merge';
  let imported = 0;
  tx(() => {
    if (mode === 'replace') run('DELETE FROM series');
    const idMap = new Map<number, number>();
    for (const s of b.series) {
      if (!sources.some((x) => x.id === s.source_id)) continue;
      const existing = get('SELECT id FROM series WHERE source_id = ? AND series_key = ?', s.source_id, s.series_key);
      let id: number;
      if (existing) {
        id = existing.id;
        run('UPDATE series SET title=?, aliases=?, source_aliases=?, cover=?, description=?, site_status=?, in_library=?, library_status=?, last_read_number=?, resume_scroll=?, resume_done=?, last_read_at=?, latest_number=?, latest_at=? WHERE id=?',
          s.title, s.aliases, s.source_aliases, s.cover, s.description, s.site_status, s.in_library, s.library_status, s.last_read_number, s.resume_scroll, s.resume_done, s.last_read_at, s.latest_number, s.latest_at, id);
      } else {
        id = Number(run('INSERT INTO series(source_id,series_key,title,aliases,source_aliases,cover,description,site_status,in_library,library_status,last_read_number,resume_scroll,resume_done,last_read_at,latest_number,latest_at,added_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          s.source_id, s.series_key, s.title, s.aliases ?? '[]', s.source_aliases ?? '[]', s.cover, s.description, s.site_status, s.in_library, s.library_status, s.last_read_number, s.resume_scroll, s.resume_done, s.last_read_at, s.latest_number, s.latest_at, s.added_at ?? new Date().toISOString()).lastInsertRowid);
      }
      idMap.set(s.id, id);
      for (const c of s.chapters ?? [])
        run('INSERT OR IGNORE INTO chapters(series_id, chapter_key, number, title, published_at, locked) VALUES(?,?,?,?,?,?)', id, c.chapter_key, c.number, c.title, c.published_at, c.locked ?? 0);
      if (s.resume_chapter_id) {
        const rc = get('SELECT id FROM chapters WHERE series_id = ? AND number = ?', id, s.last_read_number);
        if (rc) run('UPDATE series SET resume_chapter_id = ? WHERE id = ?', rc.id, id);
      }
      imported++;
    }
    if (b.settings) {
      const clean: Record<string, any> = {};
      for (const k of Object.keys(DEFAULTS)) if (k in b.settings) clean[k] = b.settings[k];
      setSettings(clean);
    }
  });
  schedulePolling();
  cachePrune();
  res.json({ ok: true, imported, mode });
}));
