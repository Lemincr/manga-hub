import {
  BaseSource,
  normalizeStatus,
  normalizeTag,
  normalizeTags,
  parseNumber,
  type BrowseQuery,
  type ChapterInfo,
  type ChapterPages,
  type ChapterPreview,
  type SeriesDetail,
  type SeriesSummary,
} from './baseSource.js';
import { cacheGet, cacheSet, HttpError } from '../http.js';

const RATINGS = 'contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica';
const LANG = 'en';

export class MangaDex extends BaseSource {
  readonly id = 'mangaDex';
  readonly name = 'MangaDex';
  readonly tier = 'extra';
  readonly extraSettings = [{ key: 'apiUrl', label: 'API URL' }];

  private get api() {
    return String(this.setting('apiUrl')).replace(/\/+$/, '');
  }

  protected override json<T = any>(url: string, opts: Parameters<BaseSource['json']>[1] = {}) {
    return super.json<T>(url, {
      ...opts,
      referer: '',
      headers: {
        'User-Agent': 'MangaHub/1.0 (+http://localhost:3001)',
        Accept: 'application/json',
        ...opts.headers,
      },
    });
  }

  /** Fetch & cache MangaDex's official tag catalog (normalized tag name -> UUID). */
  async tagMap(): Promise<Record<string, string>> {
    const cacheKey = 'mangadex:tag-map:v1';
    const hit = cacheGet<Record<string, string>>(cacheKey);
    if (hit) return hit;
    try {
      const j = await this.json(`${this.api}/manga/tag`, { ttlMs: 24 * 3600_000 });
      const map: Record<string, string> = {};
      for (const t of j.data ?? []) {
        const name = normalizeTag(t?.attributes?.name?.en);
        if (name && t?.id) map[name.toLowerCase()] = t.id;
      }
      cacheSet(cacheKey, map, 24 * 3600_000);
      return map;
    } catch {
      return {};
    }
  }

  private pickTitle(t: Record<string, string> | undefined, alts: Record<string, string>[] = []) {
    if (t?.en) return t.en;
    const altEn = alts.find((a) => a.en)?.en;
    if (altEn) return altEn;
    return t?.['ja-ro'] ?? t?.['ko-ro'] ?? t?.['zh-ro'] ?? Object.values(t ?? {})[0] ?? 'Untitled';
  }

  private summary(m: any): SeriesSummary {
    const rels: any[] = m.relationships ?? [];
    const cover = rels.find((r) => r.type === 'cover_art')?.attributes?.fileName;
    const creators = rels
      .filter((r) => (r.type === 'author' || r.type === 'artist') && r.attributes?.name)
      .map((r) => String(r.attributes.name).trim());
    const a = m.attributes;
    const alts: Record<string, string>[] = a.altTitles ?? [];
    const altList = alts.flatMap((o) => Object.values(o)).filter(Boolean);
    const lang = String(a.originalLanguage ?? 'ja').toLowerCase();
    const type = lang === 'ko' ? 'Manhwa' : lang === 'zh' || lang === 'zh-hk' ? 'Manhua' : 'Manga';
    const genres = normalizeTags((a.tags ?? []).map((t: any) => t?.attributes?.name?.en));
    const lastNum = parseNumber(a.lastChapter);
    const recentChapters: ChapterPreview[] = [];
    if (lastNum != null && lastNum > 0) {
      recentChapters.push({ number: lastNum, title: `Ch. ${lastNum}`, publishedAt: a.updatedAt ?? null });
      if (lastNum >= 2) recentChapters.push({ number: lastNum - 1, title: `Ch. ${lastNum - 1}` });
    }
    return {
      seriesKey: m.id,
      title: this.pickTitle(a.title, alts),
      altTitles: altList,
      cover: cover ? `https://uploads.mangadex.org/covers/${m.id}/${cover}.256.jpg` : null,
      latestChapter: a.lastChapter ? `Chapter ${a.lastChapter}` : null,
      latestAt: a.latestUploadedChapter ? a.updatedAt : (a.updatedAt ?? null),
      recentChapters,
      status: normalizeStatus(a.status) ?? 'Ongoing',
      type,
      genres,
      creator: [...new Set(creators)].join(', ') || null,
      chapterCount: lastNum,
    };
  }

  private list(extra: string) {
    return this.json(`${this.api}/manga?limit=24&includes[]=cover_art&includes[]=author&includes[]=artist&hasAvailableChapters=true&availableTranslatedLanguage[]=${LANG}&${RATINGS}&${extra}`);
  }

  async search(q: string) {
    const j = await this.list(`title=${encodeURIComponent(q)}&order[relevance]=desc`);
    return (j.data ?? []).map((m: any) => this.summary(m));
  }

  async latest(page: number) {
    const j = await this.list(`order[latestUploadedChapter]=desc&offset=${(page - 1) * 24}`);
    return (j.data ?? []).map((m: any) => this.summary(m));
  }

  override async browse(q: BrowseQuery): Promise<SeriesSummary[]> {
    const page = Math.max(1, q.page ?? 1);
    const offset = (page - 1) * 24;
    const parts: string[] = [`offset=${offset}`];

    if (q.q?.trim()) {
      parts.push(`title=${encodeURIComponent(q.q.trim())}`);
      parts.push('order[relevance]=desc');
    } else if (q.sort === 'rating') {
      parts.push('order[followedCount]=desc');
    } else if (q.sort === 'title') {
      parts.push('order[title]=asc');
    } else {
      parts.push('order[latestUploadedChapter]=desc');
    }

    if (q.status?.length) {
      for (const st of q.status) {
        const s = st.toLowerCase();
        if (['ongoing', 'completed', 'hiatus', 'cancelled'].includes(s)) parts.push(`status[]=${s}`);
      }
    }

    if (q.type?.length) {
      for (const tp of q.type) {
        const t = tp.toLowerCase();
        if (t === 'manhwa') parts.push('originalLanguage[]=ko');
        else if (t === 'manhua') {
          parts.push('originalLanguage[]=zh');
          parts.push('originalLanguage[]=zh-hk');
        } else if (t === 'manga') parts.push('originalLanguage[]=ja');
      }
    }

    if (q.genresInclude?.length || q.genresExclude?.length) {
      const map = await this.tagMap();
      for (const g of q.genresInclude ?? []) {
        const norm = (normalizeTag(g) ?? g).toLowerCase();
        const id = map[norm];
        if (id) parts.push(`includedTags[]=${id}`);
      }
      for (const g of q.genresExclude ?? []) {
        const norm = (normalizeTag(g) ?? g).toLowerCase();
        const id = map[norm];
        if (id) parts.push(`excludedTags[]=${id}`);
      }
    }

    const j = await this.list(parts.join('&'));
    return (j.data ?? []).map((m: any) => this.summary(m));
  }

  async series(key: string): Promise<SeriesDetail> {
    const d = await this.json(`${this.api}/manga/${key}?includes[]=cover_art&includes[]=author&includes[]=artist`, { ttlMs: 0 });
    if (!d.data) throw new HttpError('Unexpected MangaDex payload', 'parse');
    const a = d.data.attributes;
    const alt = (a.altTitles ?? []).flatMap((o: Record<string, string>) => Object.values(o));

    const byNumber = new Map<number, ChapterInfo>();
    for (let offset = 0; offset < 10_000; offset += 500) {
      const f = await this.json(
        `${this.api}/manga/${key}/feed?translatedLanguage[]=${LANG}&order[chapter]=asc&limit=500&offset=${offset}&includeExternalUrl=0&includeFuturePublishAt=0&${RATINGS}`,
        { ttlMs: 0 },
      );
      for (const c of f.data ?? []) {
        if (!c.attributes.pages) continue;
        const number = parseFloat(c.attributes.chapter ?? '0') || 0;
        if (byNumber.has(number)) continue;
        const t = c.attributes.title;
        byNumber.set(number, {
          key: c.id,
          number,
          title: c.attributes.chapter ? `Chapter ${c.attributes.chapter}${t ? ` – ${t}` : ''}` : t || 'Oneshot',
          publishedAt: c.attributes.readableAt ?? c.attributes.publishAt ?? null,
        });
      }
      if (offset + 500 >= (f.total ?? 0)) break;
    }
    const chapters = [...byNumber.values()].sort((x, y) => y.number - x.number);
    if (!chapters.length) throw new HttpError('No readable English chapters on MangaDex for this title (may be external-only).', 'parse');
    const sum = this.summary(d.data);
    return {
      ...sum,
      altTitles: alt,
      description: a.description?.en ?? '',
      status: sum.status ?? a.status ?? null,
      latestAt: chapters.map((c) => c.publishedAt).filter(Boolean).sort().at(-1) ?? a.updatedAt,
      chapters,
    };
  }

  override async chaptersOnly(key: string): Promise<ChapterInfo[]> {
    const byNumber = new Map<number, ChapterInfo>();
    for (let offset = 0; offset < 10_000; offset += 500) {
      const f = await this.json(
        `${this.api}/manga/${key}/feed?translatedLanguage[]=${LANG}&order[chapter]=asc&limit=500&offset=${offset}&includeExternalUrl=0&includeFuturePublishAt=0&${RATINGS}`,
        { ttlMs: 0, delayMs: 220 },
      );
      for (const c of f.data ?? []) {
        if (!c.attributes.pages) continue;
        const number = parseFloat(c.attributes.chapter ?? '0') || 0;
        if (byNumber.has(number)) continue;
        const t = c.attributes.title;
        byNumber.set(number, {
          key: c.id,
          number,
          title: c.attributes.chapter ? `Chapter ${c.attributes.chapter}${t ? ` – ${t}` : ''}` : t || 'Oneshot',
          publishedAt: c.attributes.readableAt ?? c.attributes.publishAt ?? null,
        });
      }
      if (offset + 500 >= (f.total ?? 0)) break;
    }
    const chapters = [...byNumber.values()].sort((x, y) => y.number - x.number);
    if (!chapters.length) throw new HttpError('No readable English chapters on MangaDex for this title.', 'parse');
    return chapters;
  }

  async pages(_s: string, chapterKey: string): Promise<ChapterPages> {
    const j = await this.json(`${this.api}/at-home/server/${chapterKey}`, { ttlMs: 0 });
    const hash = j.chapter?.hash;
    const files: string[] = j.chapter?.data ?? [];
    if (!hash || !files.length) throw new HttpError('MangaDex returned no pages for this chapter', 'parse');
    return { images: files.map((f) => `${j.baseUrl}/data/${hash}/${f}`) };
  }

  seriesUrl(key: string) {
    return `${this.baseUrl}/title/${key}`;
  }
  chapterUrl(_s: string, chapterKey: string) {
    return `${this.baseUrl}/chapter/${chapterKey}`;
  }
}
