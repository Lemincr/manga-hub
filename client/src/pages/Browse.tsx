import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import type { FeedItem } from '../types';
import { FeedCard, SourceStatusBar } from '../components/Feed';
import { SourceChips, useSources } from '../components/Sources';

type SortKey = 'latest' | 'rating' | 'title' | 'chapters';
type PopoverKey = 'sort' | 'status' | 'type' | 'genres' | 'creator' | 'minCh' | null;

const SORT_LABELS: Record<SortKey, string> = {
  latest: 'Latest Update',
  rating: 'Popularity / Rating',
  title: 'Title (A–Z)',
  chapters: 'Chapter Count',
};

const STATUS_OPTIONS = ['Ongoing', 'Completed', 'Hiatus', 'Cancelled'] as const;
const TYPE_OPTIONS = ['Manhwa', 'Manga', 'Manhua', 'Novel/Other'] as const;
const MIN_CH_PRESETS = [0, 10, 25, 50, 100, 200] as const;

const COMMON_GENRES = [
  'Action',
  'Adventure',
  "Boys' Love",
  'Comedy',
  'Crossdressing',
  'Drama',
  'Dungeons',
  'Ecchi',
  'Fantasy',
  'Full Color',
  'Genderswap',
  "Girls' Love",
  'Gore',
  'Gyaru',
  'Harem',
  'Historical',
  'Horror',
  'Isekai',
  'Josei',
  'Magic',
  'Martial Arts',
  'Mature',
  'Mecha',
  'Medical',
  'Military',
  'Monster Girls',
  'Monsters',
  'Murim',
  'Mystery',
  'Necromancer',
  'Overpowered',
  'Post-Apocalyptic',
  'Psychological',
  'Regression',
  'Reincarnation',
  'Revenge',
  'Reverse Harem',
  'Romance',
  'School Life',
  'Sci-Fi',
  'Seinen',
  'Shoujo',
  'Shounen',
  'Slice of Life',
  'Sports',
  'Supernatural',
  'Survival',
  'System',
  'Thriller',
  'Time Travel',
  'Tower',
  'Tragedy',
  'Transmigration',
  'Vampires',
  'Video Games',
  'Villain',
  'Villainess',
  'Virtual Reality',
  'Webtoon',
  'Wuxia',
  'Zombies',
];

function extractChapterNumber(it: FeedItem): number {
  if (it.chapterCount != null && !Number.isNaN(Number(it.chapterCount))) return Number(it.chapterCount);
  const m = /(\d+(?:\.\d+)?)/.exec(it.latestChapter ?? '');
  return m ? parseFloat(m[1]) : 0;
}

function normTitle(s: string | undefined | null): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/\bcolosseum\b/g, 'coliseum')
    .replace(/\s*[\(\[\{][^\)\]\}]*[\)\]\}]\s*/g, ' ')
    .replace(/^(.{10,}?)(?:\s*[:~～]\s*|\s+-\s+|\s+–\s+)(.+)$/, '$1')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export default function Browse() {
  const sources = useSources();
  // null = "All sources" (queries primary + extra sources)
  const [selectedSources, setSelectedSources] = useState<string[] | null>(null);
  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [items, setItems] = useState<FeedItem[]>([]);
  const [statuses, setStatuses] = useState<Record<string, { ok: boolean; message?: string }>>({});
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [serverTags, setServerTags] = useState<string[]>(COMMON_GENRES);

  // Pill filter states
  const [openPop, setOpenPop] = useState<PopoverKey>(null);
  const [sort, setSort] = useState<SortKey>('latest');
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [genreInclude, setGenreInclude] = useState<string[]>([]);
  const [genreExclude, setGenreExclude] = useState<string[]>([]);
  const [genreQuery, setGenreQuery] = useState('');
  const [creatorFilter, setCreatorFilter] = useState('');
  const [minChapters, setMinChapters] = useState<number>(0);
  const [hideBookmarked, setHideBookmarked] = useState(false);

  const barRef = useRef<HTMLDivElement>(null);
  const reqSeq = useRef(0);
  const names = useMemo(() => Object.fromEntries(sources.map((s) => [s.id, s.name])), [sources]);

  useEffect(() => {
    api
      .get<{ tags: string[] }>('/tags')
      .then((r) => {
        if (r.tags?.length) setServerTags(r.tags);
      })
      .catch(() => {});
  }, []);

  // Close popover on outside click
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setOpenPop(null);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  // Debounce search query so typing searches seamlessly
  useEffect(() => {
    const t = window.setTimeout(() => setActiveQuery(query.trim()), 380);
    return () => window.clearTimeout(t);
  }, [query]);

  // Filter predicate matching a single FeedItem against current pill filters
  const matchesFilters = useCallback(
    (it: FeedItem) => {
      if (hideBookmarked && it.inLibrary) return false;
      if (statusFilter.length > 0) {
        if (!it.status || !statusFilter.some((s) => s.toLowerCase() === it.status!.toLowerCase())) return false;
      }
      if (typeFilter.length > 0) {
        if (!it.type || !typeFilter.some((t) => t.toLowerCase() === it.type!.toLowerCase())) return false;
      }
      if (genreInclude.length > 0) {
        const itemGenres = (it.genres ?? []).map((g) => g.toLowerCase());
        if (!genreInclude.every((g) => itemGenres.includes(g.toLowerCase()))) return false;
      }
      if (genreExclude.length > 0) {
        const itemGenres = (it.genres ?? []).map((g) => g.toLowerCase());
        if (itemGenres.some((g) => genreExclude.some((ex) => ex.toLowerCase() === g))) return false;
      }
      if (creatorFilter.trim()) {
        const creatorQ = creatorFilter.trim().toLowerCase();
        const hay = `${it.creator ?? ''} ${it.title}`.toLowerCase();
        if (!hay.includes(creatorQ)) return false;
      }
      if (minChapters > 0) {
        const ch = extractChapterNumber(it);
        if (ch < minChapters) return false;
      }
      return true;
    },
    [hideBookmarked, statusFilter, typeFilter, genreInclude, genreExclude, creatorFilter, minChapters],
  );

  // Merge new batch of items with existing items while deduplicating by canonical title & sourceKey
  const mergeDedup = (prev: FeedItem[], incoming: FeedItem[]): FeedItem[] => {
    const out = [...prev];
    const seenKeys = new Set<string>();
    const titleToIdx = new Map<string, number>();

    for (let i = 0; i < out.length; i++) {
      const it = out[i];
      seenKeys.add(`${it.sourceId}:${it.seriesKey}`);
      for (const t of [it.title, ...(it.altTitles ?? [])]) {
        const nk = normTitle(t);
        if (nk.length >= 3 && !titleToIdx.has(nk)) titleToIdx.set(nk, i);
      }
    }

    for (const it of incoming) {
      const sk = `${it.sourceId}:${it.seriesKey}`;
      if (seenKeys.has(sk)) continue;
      seenKeys.add(sk);

      const candidateKeys = [it.title, ...(it.altTitles ?? [])].map(normTitle).filter((k) => k.length >= 3);
      let hitIdx: number | undefined;
      for (const k of candidateKeys) {
        const idx = titleToIdx.get(k);
        if (idx !== undefined) {
          hitIdx = idx;
          break;
        }
      }

      if (hitIdx === undefined) {
        const newIdx = out.length;
        out.push(it);
        for (const k of candidateKeys) if (!titleToIdx.has(k)) titleToIdx.set(k, newIdx);
      } else {
        const existing = { ...out[hitIdx] };
        existing.genres = [...new Set([...(existing.genres ?? []), ...(it.genres ?? [])])];
        existing.cover = existing.cover || it.cover;
        existing.type = existing.type || it.type;
        existing.status = existing.status || it.status;
        existing.creator = existing.creator || it.creator;
        if (it.sourceId !== existing.sourceId) {
          const alts = [...(existing.altSources ?? [])];
          if (!alts.some((a) => a.sourceId === it.sourceId)) {
            alts.push({
              sourceId: it.sourceId,
              sourceName: it.sourceName,
              seriesKey: it.seriesKey,
              seriesId: it.seriesId,
              latestChapter: it.latestChapter,
            });
          }
          existing.altSources = alts;
        }
        out[hitIdx] = existing;
      }
    }
    return out;
  };

  const buildQueryParams = useCallback(
    (p: number, ids: string[] | null, q: string) => {
      const params = new URLSearchParams({ page: String(p), sort });
      if (ids !== null && ids.length) params.set('sources', ids.join(','));
      if (q) params.set('q', q);
      if (statusFilter.length) params.set('status', statusFilter.join(','));
      if (typeFilter.length) params.set('type', typeFilter.join(','));
      if (genreInclude.length) params.set('genresInclude', genreInclude.join(','));
      if (genreExclude.length) params.set('genresExclude', genreExclude.join(','));
      if (creatorFilter.trim()) params.set('creator', creatorFilter.trim());
      return params.toString();
    },
    [sort, statusFilter, typeFilter, genreInclude, genreExclude, creatorFilter],
  );

  /**
   * Fetch pages from `/discover` or `/search`.
   * When active filters are applied and a single page yields very few matching cards (< 12),
   * automatically advances up to 2 more pages so "Load More" never stops prematurely.
   */
  const load = useCallback(
    async (startPage: number, ids: string[] | null, q: string, append: boolean) => {
      if (ids !== null && !ids.length) return;
      const mySeq = ++reqSeq.current;
      setLoading(true);
      try {
        const endpoint = q ? '/search' : '/discover';
        const hasServerOrClientFilter =
          statusFilter.length > 0 ||
          typeFilter.length > 0 ||
          genreInclude.length > 0 ||
          genreExclude.length > 0 ||
          creatorFilter.trim() !== '' ||
          minChapters > 0;

        // Only multi-hop when browsing latest feed with filters; when searching a title `q`, page 1 is authoritative
        const maxHops = !q && hasServerOrClientFilter ? 3 : 1;
        let currentPage = startPage;
        let collected: FeedItem[] = [];
        let moreAvailable = !q;

        for (let hop = 0; hop < maxHops; hop++) {
          const qs = buildQueryParams(currentPage, ids, q);
          const r = await api.get<{
            items?: FeedItem[];
            results?: Record<string, FeedItem[]>;
            statuses: typeof statuses;
          }>(`${endpoint}?${qs}`);
          if (mySeq !== reqSeq.current) return;
          setStatuses(r.statuses);
          const batch = r.items ?? Object.values(r.results ?? {}).flat();
          if (!batch.length) {
            moreAvailable = false;
            break;
          }
          collected = mergeDedup(collected, batch);
          const matchingCount = collected.filter(matchesFilters).length;
          if (matchingCount >= 12 || hop === maxHops - 1) {
            break;
          }
          currentPage++;
        }

        if (mySeq !== reqSeq.current) return;
        setItems((prev) => (append ? mergeDedup(prev, collected) : collected));
        setPage(currentPage);
        setHasMore(moreAvailable);
      } finally {
        if (mySeq === reqSeq.current) setLoading(false);
      }
    },
    [
      buildQueryParams,
      matchesFilters,
      statusFilter.length,
      typeFilter.length,
      genreInclude.length,
      genreExclude.length,
      creatorFilter,
      minChapters,
    ],
  );

  // Trigger fresh load when sources, search query, or server-backed filters change
  useEffect(() => {
    if (sources.length) void load(1, selectedSources, activeQuery, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    sources.length,
    selectedSources === null ? 'ALL' : selectedSources.join(','),
    activeQuery,
    statusFilter.join(','),
    typeFilter.join(','),
    genreInclude.join(','),
    genreExclude.join(','),
    sort,
  ]);

  // Dynamic genre list combining server tag catalog + genres on loaded items
  const allGenres = useMemo(() => {
    const set = new Set<string>(serverTags);
    for (const it of items) {
      for (const g of it.genres ?? []) if (g) set.add(g);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [items, serverTags]);

  const toggleArr = (arr: string[], val: string) =>
    arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val];

  const cycleGenre = (g: string) => {
    if (genreInclude.includes(g)) {
      setGenreInclude(genreInclude.filter((x) => x !== g));
      setGenreExclude([...genreExclude, g]);
    } else if (genreExclude.includes(g)) {
      setGenreExclude(genreExclude.filter((x) => x !== g));
    } else {
      setGenreInclude([...genreInclude, g]);
    }
  };

  const clearAllFilters = () => {
    setSort('latest');
    setStatusFilter([]);
    setTypeFilter([]);
    setGenreInclude([]);
    setGenreExclude([]);
    setCreatorFilter('');
    setMinChapters(0);
    setHideBookmarked(false);
  };

  const hasActiveFilters =
    sort !== 'latest' ||
    statusFilter.length > 0 ||
    typeFilter.length > 0 ||
    genreInclude.length > 0 ||
    genreExclude.length > 0 ||
    creatorFilter.trim() !== '' ||
    minChapters > 0 ||
    hideBookmarked;

  const shown = useMemo(() => {
    const filtered = items.filter(matchesFilters);
    const copy = [...filtered];
    // When searching for a title with default 'latest' sort, preserve server's relevance + source priority order
    if (activeQuery && sort === 'latest') return copy;
    copy.sort((a, b) => {
      if (sort === 'title') return a.title.localeCompare(b.title);
      if (sort === 'chapters') return extractChapterNumber(b) - extractChapterNumber(a);
      if (sort === 'rating')
        return (b.rating ?? 0) - (a.rating ?? 0) || extractChapterNumber(b) - extractChapterNumber(a);
      // For 'latest', prioritize bookmarked series with new (<1 week) unread chapters, then any series with new (<1 week) chapters
      const aBookNew = a.inLibrary && a.hasNewUnread ? 1 : 0;
      const bBookNew = b.inLibrary && b.hasNewUnread ? 1 : 0;
      if (bBookNew !== aBookNew) return bBookNew - aBookNew;
      const aNew = a.hasNewUnread ? 1 : 0;
      const bNew = b.hasNewUnread ? 1 : 0;
      if (bNew !== aNew) return bNew - aNew;
      const ta = a.latestAt ? Date.parse(a.latestAt) : 0;
      const tb = b.latestAt ? Date.parse(b.latestAt) : 0;
      return (Number.isNaN(tb) ? 0 : tb) - (Number.isNaN(ta) ? 0 : ta);
    });
    return copy;
  }, [items, matchesFilters, sort, activeQuery]);

  return (
    <div className="space-y-4">
      {/* Top Row: Title, Unified Search Bar, and Refresh */}
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Browse</h1>
          <p className="text-xs text-neutral-400">
            {activeQuery
              ? `Searching "${activeQuery}" across sources (deduplicated by priority)`
              : 'Latest updates & discovery across sources'}
          </p>
        </div>

        <form
          className="relative ml-auto flex flex-1 sm:max-w-md"
          onSubmit={(e) => {
            e.preventDefault();
            setActiveQuery(query.trim());
          }}
        >
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-neutral-500">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-4.35-4.35m1.85-5.15a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </span>
          <input
            className="input w-full pl-9 pr-20"
            placeholder="Search series title across sources…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setActiveQuery('');
              }}
              className="absolute inset-y-1 right-1.5 rounded-md px-2 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-white"
            >
              Clear
            </button>
          )}
        </form>

        <button
          type="button"
          className="btn"
          disabled={loading}
          onClick={() => load(1, selectedSources, activeQuery, false)}
        >
          ↻ Refresh
        </button>
      </div>

      {/* Source Filter Chips (Primary sources + All Sources) */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-neutral-800/80 bg-neutral-900/50 px-3.5 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-xs font-medium text-neutral-400">Sources:</span>
          <SourceChips sources={sources} selected={selectedSources} onChange={setSelectedSources} />
        </div>
        <span className="text-xs text-neutral-500">
          Showing <strong className="text-neutral-200">{shown.length}</strong> of {items.length} unique series
        </span>
      </div>

      {/* Modular Pill-Style Filter Bar */}
      <div ref={barRef} className="relative flex flex-wrap items-center gap-2">
        {/* 1. Sort Dropdown Pill */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpenPop(openPop === 'sort' ? null : 'sort')}
            className={`pill ${sort !== 'latest' ? 'pill-active' : ''}`}
          >
            <svg
              className="h-3.5 w-3.5 text-violet-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
            </svg>
            <span>{SORT_LABELS[sort]}</span>
            <span className="text-[10px] opacity-60">▾</span>
          </button>
          {openPop === 'sort' && (
            <div className="absolute left-0 top-full z-30 mt-1.5 w-48 rounded-xl border border-neutral-800 bg-neutral-900 p-1.5 shadow-2xl">
              {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    setSort(k);
                    setOpenPop(null);
                  }}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-left text-xs transition ${
                    sort === k
                      ? 'bg-violet-600/25 font-semibold text-violet-200'
                      : 'text-neutral-300 hover:bg-neutral-800'
                  }`}
                >
                  <span>{SORT_LABELS[k]}</span>
                  {sort === k && <span>✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 2. + Status Pill */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpenPop(openPop === 'status' ? null : 'status')}
            className={`pill ${statusFilter.length ? 'pill-active' : ''}`}
          >
            <span>+ Status</span>
            {statusFilter.length > 0 && (
              <span className="rounded-full bg-violet-500/30 px-1.5 py-0.2 text-[10px] font-semibold text-violet-200">
                {statusFilter.join(', ')}
              </span>
            )}
          </button>
          {openPop === 'status' && (
            <div className="absolute left-0 top-full z-30 mt-1.5 w-48 rounded-xl border border-neutral-800 bg-neutral-900 p-2 shadow-2xl">
              <div className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                Series Status
              </div>
              {STATUS_OPTIONS.map((st) => {
                const active = statusFilter.includes(st);
                return (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setStatusFilter(toggleArr(statusFilter, st))}
                    className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs transition ${
                      active ? 'bg-violet-600/25 font-medium text-violet-200' : 'text-neutral-300 hover:bg-neutral-800'
                    }`}
                  >
                    <span>{st}</span>
                    <span
                      className={`h-3.5 w-3.5 rounded border text-center text-[10px] leading-3 ${
                        active ? 'border-violet-400 bg-violet-600 text-white' : 'border-neutral-700'
                      }`}
                    >
                      {active ? '✓' : ''}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* 3. + Type Pill */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpenPop(openPop === 'type' ? null : 'type')}
            className={`pill ${typeFilter.length ? 'pill-active' : ''}`}
          >
            <span>+ Type</span>
            {typeFilter.length > 0 && (
              <span className="rounded-full bg-violet-500/30 px-1.5 py-0.2 text-[10px] font-semibold text-violet-200">
                {typeFilter.join(', ')}
              </span>
            )}
          </button>
          {openPop === 'type' && (
            <div className="absolute left-0 top-full z-30 mt-1.5 w-48 rounded-xl border border-neutral-800 bg-neutral-900 p-2 shadow-2xl">
              <div className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                Format Type
              </div>
              {TYPE_OPTIONS.map((tp) => {
                const active = typeFilter.includes(tp);
                return (
                  <button
                    key={tp}
                    type="button"
                    onClick={() => setTypeFilter(toggleArr(typeFilter, tp))}
                    className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs transition ${
                      active ? 'bg-violet-600/25 font-medium text-violet-200' : 'text-neutral-300 hover:bg-neutral-800'
                    }`}
                  >
                    <span>{tp}</span>
                    <span
                      className={`h-3.5 w-3.5 rounded border text-center text-[10px] leading-3 ${
                        active ? 'border-violet-400 bg-violet-600 text-white' : 'border-neutral-700'
                      }`}
                    >
                      {active ? '✓' : ''}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* 4. + Genres Pill (Include / Exclude multi-select with search) */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpenPop(openPop === 'genres' ? null : 'genres')}
            className={`pill ${genreInclude.length || genreExclude.length ? 'pill-active' : ''}`}
          >
            <span>+ Genres</span>
            {(genreInclude.length > 0 || genreExclude.length > 0) && (
              <span className="rounded-full bg-violet-500/30 px-1.5 py-0.2 text-[10px] font-semibold text-violet-200">
                {genreInclude.length ? `+${genreInclude.length}` : ''}
                {genreInclude.length && genreExclude.length ? ' / ' : ''}
                {genreExclude.length ? `-${genreExclude.length}` : ''}
              </span>
            )}
          </button>
          {openPop === 'genres' && (
            <div className="absolute left-0 top-full z-30 mt-1.5 w-96 rounded-xl border border-neutral-800 bg-neutral-900 p-3 shadow-2xl">
              <div className="mb-2 flex items-center justify-between text-[11px] text-neutral-400">
                <span className="font-semibold uppercase tracking-wider">
                  Genres ({allGenres.length}) · Click: +Include → -Exclude
                </span>
                {(genreInclude.length > 0 || genreExclude.length > 0) && (
                  <button
                    type="button"
                    onClick={() => {
                      setGenreInclude([]);
                      setGenreExclude([]);
                    }}
                    className="text-violet-400 hover:underline"
                  >
                    Reset
                  </button>
                )}
              </div>
              <input
                className="input mb-2.5 w-full py-1 text-xs"
                placeholder="Filter genre tags (e.g. Genderswap, Isekai, Murim)…"
                value={genreQuery}
                onChange={(e) => setGenreQuery(e.target.value)}
              />
              <div className="flex max-h-60 flex-wrap gap-1.5 overflow-y-auto pr-1">
                {allGenres
                  .filter((g) => g.toLowerCase().includes(genreQuery.toLowerCase()))
                  .map((g) => {
                    const inc = genreInclude.includes(g);
                    const exc = genreExclude.includes(g);
                    return (
                      <button
                        key={g}
                        type="button"
                        onClick={() => cycleGenre(g)}
                        className={`rounded-md border px-2 py-1 text-[11px] font-medium transition ${
                          inc
                            ? 'border-emerald-500/60 bg-emerald-500/20 text-emerald-200'
                            : exc
                              ? 'border-rose-500/60 bg-rose-500/20 text-rose-200 line-through'
                              : 'border-neutral-800 bg-neutral-950/70 text-neutral-300 hover:border-neutral-700'
                        }`}
                      >
                        {inc ? `+ ${g}` : exc ? `- ${g}` : g}
                      </button>
                    );
                  })}
              </div>
            </div>
          )}
        </div>

        {/* 5. + Creator Pill */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpenPop(openPop === 'creator' ? null : 'creator')}
            className={`pill ${creatorFilter.trim() ? 'pill-active' : ''}`}
          >
            <span>+ Creator</span>
            {creatorFilter.trim() && (
              <span className="max-w-28 truncate rounded-full bg-violet-500/30 px-1.5 py-0.2 text-[10px] font-semibold text-violet-200">
                {creatorFilter.trim()}
              </span>
            )}
          </button>
          {openPop === 'creator' && (
            <div className="absolute left-0 top-full z-30 mt-1.5 w-64 rounded-xl border border-neutral-800 bg-neutral-900 p-3 shadow-2xl">
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                Author / Artist
              </div>
              <input
                autoFocus
                className="input w-full text-xs"
                placeholder="Type author or studio name…"
                value={creatorFilter}
                onChange={(e) => setCreatorFilter(e.target.value)}
              />
              {creatorFilter && (
                <button
                  type="button"
                  onClick={() => setCreatorFilter('')}
                  className="mt-2 text-xs text-violet-400 hover:underline"
                >
                  Clear creator filter
                </button>
              )}
            </div>
          )}
        </div>

        {/* 6. + Minimum Chapters Pill */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpenPop(openPop === 'minCh' ? null : 'minCh')}
            className={`pill ${minChapters > 0 ? 'pill-active' : ''}`}
          >
            <span>+ Minimum Chapters</span>
            {minChapters > 0 && (
              <span className="rounded-full bg-violet-500/30 px-1.5 py-0.2 text-[10px] font-semibold text-violet-200">
                {minChapters}+
              </span>
            )}
          </button>
          {openPop === 'minCh' && (
            <div className="absolute left-0 top-full z-30 mt-1.5 w-60 rounded-xl border border-neutral-800 bg-neutral-900 p-3 shadow-2xl">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                Minimum Chapters
              </div>
              <div className="mb-2.5 flex flex-wrap gap-1.5">
                {MIN_CH_PRESETS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => {
                      setMinChapters(n);
                      setOpenPop(null);
                    }}
                    className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                      minChapters === n
                        ? 'border-violet-500 bg-violet-600/25 text-violet-200'
                        : 'border-neutral-800 bg-neutral-950 text-neutral-300 hover:border-neutral-700'
                    }`}
                  >
                    {n === 0 ? 'Any' : `${n}+`}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-neutral-400">Custom:</span>
                <input
                  type="number"
                  min={0}
                  className="input w-24 py-1 text-xs"
                  value={minChapters}
                  onChange={(e) => setMinChapters(Math.max(0, Number(e.target.value) || 0))}
                />
              </div>
            </div>
          )}
        </div>

        {/* 7. Hide Bookmarked Toggle Pill */}
        <button
          type="button"
          onClick={() => setHideBookmarked(!hideBookmarked)}
          className={`pill ${hideBookmarked ? 'pill-active' : ''}`}
        >
          <span
            className={`inline-block h-2 w-2 rounded-full ${hideBookmarked ? 'bg-violet-400' : 'bg-neutral-600'}`}
          />
          <span>Hide Bookmarked</span>
        </button>

        {/* Clear All Button */}
        {hasActiveFilters && (
          <button
            type="button"
            onClick={clearAllFilters}
            className="ml-1 rounded-full px-2.5 py-1 text-xs font-medium text-violet-400 transition hover:bg-violet-950/40 hover:text-violet-200"
          >
            ✕ Clear all
          </button>
        )}
      </div>

      {/* Active Filter Chips Summary Row */}
      {hasActiveFilters && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-neutral-500">Active:</span>
          {statusFilter.map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(toggleArr(statusFilter, st))}
              className="inline-flex items-center gap-1 rounded-md border border-violet-500/30 bg-violet-950/30 px-2 py-0.5 text-violet-200"
            >
              Status: {st} <span className="opacity-60">×</span>
            </button>
          ))}
          {typeFilter.map((tp) => (
            <button
              key={tp}
              type="button"
              onClick={() => setTypeFilter(toggleArr(typeFilter, tp))}
              className="inline-flex items-center gap-1 rounded-md border border-violet-500/30 bg-violet-950/30 px-2 py-0.5 text-violet-200"
            >
              Type: {tp} <span className="opacity-60">×</span>
            </button>
          ))}
          {genreInclude.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGenreInclude(toggleArr(genreInclude, g))}
              className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-950/30 px-2 py-0.5 text-emerald-200"
            >
              +{g} <span className="opacity-60">×</span>
            </button>
          ))}
          {genreExclude.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGenreExclude(toggleArr(genreExclude, g))}
              className="inline-flex items-center gap-1 rounded-md border border-rose-500/30 bg-rose-950/30 px-2 py-0.5 text-rose-200"
            >
              -{g} <span className="opacity-60">×</span>
            </button>
          ))}
          {creatorFilter.trim() && (
            <button
              type="button"
              onClick={() => setCreatorFilter('')}
              className="inline-flex items-center gap-1 rounded-md border border-violet-500/30 bg-violet-950/30 px-2 py-0.5 text-violet-200"
            >
              Creator: {creatorFilter.trim()} <span className="opacity-60">×</span>
            </button>
          )}
          {minChapters > 0 && (
            <button
              type="button"
              onClick={() => setMinChapters(0)}
              className="inline-flex items-center gap-1 rounded-md border border-violet-500/30 bg-violet-950/30 px-2 py-0.5 text-violet-200"
            >
              {minChapters}+ chapters <span className="opacity-60">×</span>
            </button>
          )}
        </div>
      )}

      <SourceStatusBar statuses={statuses} names={names} />

      {/* Feed Grid */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {shown.map((it) => (
          <FeedCard
            key={it.sourceId + ':' + it.seriesKey}
            item={it}
            onChange={(p) => setItems((all) => all.map((x) => (x === it ? { ...x, ...p } : x)))}
          />
        ))}
      </div>

      {loading && (
        <div className="py-10 text-center text-sm text-neutral-400">
          <span className="inline-block animate-pulse">Loading series from sources…</span>
        </div>
      )}

      {!loading && !shown.length && (
        <div className="rounded-2xl border border-neutral-800/70 bg-neutral-900/40 py-14 text-center">
          <p className="text-sm text-neutral-400">No series matched your current filters on page {page}.</p>
          <div className="mt-3 flex justify-center gap-2">
            {hasMore && (
              <button
                type="button"
                onClick={() => load(page + 1, selectedSources, activeQuery, true)}
                className="btn btn-primary"
              >
                Search next page (Page {page + 1})
              </button>
            )}
            {hasActiveFilters && (
              <button type="button" onClick={clearAllFilters} className="btn">
                Reset active filters
              </button>
            )}
          </div>
        </div>
      )}

      {!loading && items.length > 0 && hasMore && (
        <div className="py-6 text-center">
          <button
            type="button"
            className="btn px-6"
            onClick={() => load(page + 1, selectedSources, activeQuery, true)}
          >
            Load more ({activeQuery ? `Page ${page + 1}` : `Page ${page + 1} updates`})
          </button>
        </div>
      )}
    </div>
  );
}
