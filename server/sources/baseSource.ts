import { fetchText, fetchJson, type FetchOpts } from '../http.js';
import { getSetting } from '../settings.js';

export type NormalizedStatus = 'Ongoing' | 'Completed' | 'Hiatus' | 'Cancelled';
export type NormalizedType = 'Manhwa' | 'Manga' | 'Manhua' | 'Novel/Other';

export interface ChapterPreview {
  key?: string | null;
  number: number;
  title: string;
  publishedAt?: string | null;
}

export interface BrowseQuery {
  page?: number;
  q?: string;
  status?: string[];
  type?: string[];
  genresInclude?: string[];
  genresExclude?: string[];
  creator?: string;
  sort?: string;
}

export interface SeriesSummary {
  seriesKey: string;
  title: string;
  altTitles?: string[];
  cover?: string | null;
  latestChapter?: string | null; // human label e.g. "Chapter 153"
  latestAt?: string | null; // ISO date
  recentChapters?: ChapterPreview[]; // up to 2 latest chapters for quick links
  status?: NormalizedStatus | string | null;
  type?: NormalizedType | string | null;
  genres?: string[];
  creator?: string | null; // author / artist
  chapterCount?: number | null;
  rating?: number | null; // 0-10 scale or popularity metric
}

export function normalizeStatus(raw: string | undefined | null): NormalizedStatus | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  if (/complet|finish|end/.test(s)) return 'Completed';
  if (/hiatus|pause|season\s*end/.test(s)) return 'Hiatus';
  if (/cancel|drop|discontin|axed/.test(s)) return 'Cancelled';
  if (/ongoing|releas|publishing|active|updating/.test(s)) return 'Ongoing';
  return null;
}

export function normalizeType(raw: string | undefined | null): NormalizedType | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  if (/manhwa|korean|webtoon/.test(s)) return 'Manhwa';
  if (/manhua|chinese/.test(s)) return 'Manhua';
  if (/manga|japanese/.test(s)) return 'Manga';
  if (/novel|oel|comic|other/.test(s)) return 'Novel/Other';
  return null;
}

// Canonical tag synonyms map so different sites' tag names merge cleanly
const TAG_SYNONYMS: Record<string, string> = {
  'gender bender': 'Genderswap',
  'genderswap': 'Genderswap',
  'gender swap': 'Genderswap',
  'transgender': 'Genderswap',
  'crossdressing': 'Crossdressing',
  'sci fi': 'Sci-Fi',
  'sci-fi': 'Sci-Fi',
  'science fiction': 'Sci-Fi',
  'martial art': 'Martial Arts',
  'martial arts': 'Martial Arts',
  'school life': 'School Life',
  'slice of life': 'Slice of Life',
  'girls love': "Girls' Love",
  "girls' love": "Girls' Love",
  'yuri': "Girls' Love",
  'shoujo ai': "Girls' Love",
  'boys love': "Boys' Love",
  "boys' love": "Boys' Love",
  'yaoi': "Boys' Love",
  'shounen ai': "Boys' Love",
  'post apocalyptic': 'Post-Apocalyptic',
  'post-apocalyptic': 'Post-Apocalyptic',
  'female harem': 'Harem',
  'male harem': 'Reverse Harem',
  'reverse harem': 'Reverse Harem',
  'web comic': 'Webtoon',
  'long strip': 'Webtoon',
  'full color': 'Full Color',
  'fan colored': 'Full Color',
};

export function normalizeTag(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/\s+/g, ' ').trim();
  if (!cleaned || cleaned.length > 36) return null;
  const key = cleaned.toLowerCase().replace(/[_-]+/g, ' ');
  if (TAG_SYNONYMS[key]) return TAG_SYNONYMS[key];
  return cleaned
    .split(' ')
    .map((w) => (w.length <= 2 && w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
}

export function normalizeTags(list: (string | undefined | null)[] | undefined | null): string[] {
  if (!list) return [];
  const out = new Set<string>();
  for (const t of list) {
    const n = normalizeTag(t);
    if (n) out.add(n);
  }
  return [...out];
}

/**
 * Canonical title key for cross-source deduplication:
 * - Lowercases, normalizes "colosseum" -> "coliseum", strips "(fan colored)" / "[official]" suffixes,
 * - Cuts off long subtitle tails after `:`, `~`, ` - ` when the main title is at least 10 chars,
 * - Strips punctuation and collapses whitespace.
 */
export function normalizeTitleKey(raw: string | undefined | null): string {
  if (!raw) return '';
  let s = raw
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\bcolosseum\b/g, 'coliseum')
    .replace(/[\(\[\{]\s*(?:fan\s*colou?red|official|full\s*colou?r|un-?censored|webtoon|manga|manhwa|manhua)[^)\]\}]*[\)\]\}]/gi, '')
    .trim();

  // Strip subtitle after ~ ... ~ or after : / - if the prefix is already a distinctive title (>= 10 alnum chars)
  const subMatch = /^(.{10,}?)(?:\s*[:~～]\s*|\s+-\s+|\s+–\s+)(.+)$/.exec(s);
  if (subMatch) {
    const prefixAlnum = subMatch[1].replace(/[^a-z0-9]/g, '');
    if (prefixAlnum.length >= 10) s = subMatch[1];
  }

  return s
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

const SEARCH_STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'in', 'to', 'and', 'or', 'for', 'on', 'at', 'by', 'with', 'from', 'as', 'is', 'was', 'are', 'be',
  'no', 'wa', 'ga', 'wo', 'o', 'ni', 'de', 'to', 'na',
]);

export function normalizeSearchText(raw: string | undefined | null): string {
  if (!raw) return '';
  return raw
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\bcolosseum\b/g, 'coliseum')
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Strict search relevance filter & scorer:
 * - Normalizes both `query` and all candidate titles (`title` + `altTitles`).
 * - Strips common stopwords ("the", "a", "of", "in", "to", "and", etc.) unless the query consists only of stopwords.
 * - Requires either:
 *    1) Direct normalized phrase/substring match of the full normalized query, OR
 *    2) Every meaningful (non-stopword) query token appears as a word or prefix in at least one candidate title.
 * - Rejects broad OR matches where only 1 out of N tokens matched or where only stopwords ("the") matched.
 */
export function scoreSearchMatch(
  query: string | undefined | null,
  candidateTitles: (string | undefined | null)[],
): { matches: boolean; score: number } {
  const normQ = normalizeSearchText(query);
  if (!normQ) return { matches: true, score: 1 };

  const allQueryTokens = normQ.split(' ').filter(Boolean);
  const meaningfulTokens = allQueryTokens.filter((t) => !SEARCH_STOPWORDS.has(t) && t.length > 1);
  // If user literally searched only stopwords (e.g. "the"), require all of them; otherwise require all meaningful tokens
  const requiredTokens = meaningfulTokens.length > 0 ? meaningfulTokens : allQueryTokens;

  let bestScore = 0;
  for (const rawTitle of candidateTitles) {
    const normT = normalizeSearchText(rawTitle);
    if (!normT) continue;

    // 1) Exact full title match
    if (normT === normQ) {
      bestScore = Math.max(bestScore, 100);
      continue;
    }

    // 2) Full normalized phrase substring match (e.g. "make the exorcist" inside "make the exorcist fall in love")
    if (normT.includes(normQ)) {
      const bonus = normT.startsWith(normQ) ? 95 : 88;
      bestScore = Math.max(bestScore, bonus);
      continue;
    }

    // 3) Check that EVERY required non-stopword token appears in this candidate title
    const titleWords = normT.split(' ').filter(Boolean);
    const allTokensPresent = requiredTokens.every((qt) =>
      titleWords.some((tw) => tw === qt || (qt.length >= 3 && tw.startsWith(qt))),
    );
    if (allTokensPresent) {
      // Score higher if tokens appear in order or at the start
      const startsWithFirst = titleWords[0]?.startsWith(requiredTokens[0]) ? 10 : 0;
      bestScore = Math.max(bestScore, 70 + startsWithFirst);
    }
  }

  return { matches: bestScore > 0, score: bestScore };
}

export interface ChapterInfo {
  key: string;
  number: number;
  title: string;
  publishedAt?: string | null;
  locked?: boolean;
}

export interface SeriesDetail extends SeriesSummary {
  altTitles: string[];
  description?: string | null;
  status?: string | null;
  chapters: ChapterInfo[];
}

export interface ChapterPages {
  images: string[];
  locked?: boolean;
  message?: string;
}

export interface ExtraSetting {
  key: string; // stored as source.<id>.<key>
  label: string;
}

export abstract class BaseSource {
  abstract readonly id: string;
  abstract readonly name: string;
  readonly tier: 'primary' | 'extra' = 'primary';
  get hiddenFromFilters(): boolean {
    return this.tier === 'extra' && !!getSetting<boolean>('sources.extraInAllOnly');
  }
  readonly extraSettings: ExtraSetting[] = [];

  setting<T = string>(field: string): T {
    return getSetting<any>(`source.${this.id}.${field}`) as T;
  }
  get baseUrl(): string {
    return String(this.setting('baseUrl')).replace(/\/+$/, '');
  }
  get enabled(): boolean {
    return !!this.setting<boolean>('enabled');
  }

  abstract search(query: string): Promise<SeriesSummary[]>;
  abstract latest(page: number): Promise<SeriesSummary[]>;
  /** Optional filter-aware browse hook so API/filter-capable sources can filter server-side. */
  async browse(query: BrowseQuery): Promise<SeriesSummary[]> {
    const page = Math.max(1, query.page ?? 1);
    if (query.q && query.q.trim()) return page === 1 ? this.search(query.q.trim()) : [];
    return this.latest(page);
  }
  abstract series(seriesKey: string): Promise<SeriesDetail>;
  /**
   * Fast chapter-only sync for "Check for new chapters" when metadata is already in SQLite.
   * Defaults to calling `this.series(seriesKey)` and returning `d.chapters`, while API adapters
   * (like Asura Scans or Vortex) override this to hit only the chapters endpoint (cutting requests in half).
   */
  async chaptersOnly(seriesKey: string): Promise<ChapterInfo[]> {
    const d = await this.series(seriesKey);
    return d.chapters;
  }
  abstract pages(seriesKey: string, chapterKey: string): Promise<ChapterPages>;
  /** Public URL (for "open original" fallback) */
  abstract seriesUrl(seriesKey: string): string;
  abstract chapterUrl(seriesKey: string, chapterKey: string, number?: number): string;

  protected html(url: string, opts: FetchOpts = {}) {
    return fetchText(url, { referer: this.baseUrl + '/', ...opts });
  }
  protected json<T = any>(url: string, opts: FetchOpts = {}) {
    return fetchJson<T>(url, { referer: this.baseUrl + '/', headers: { Accept: 'application/json' }, ...opts });
  }
}

/** Extract the first number found in a string ("Chapter 12.5 - Foo" => 12.5). */
export function parseNumber(s: string | undefined | null): number | null {
  const m = /(\d+(?:\.\d+)?)/.exec(s ?? '');
  return m ? parseFloat(m[1]) : null;
}

export function toIso(s: string | undefined | null): string | null {
  if (!s) return null;
  const raw = s.trim();
  if (!raw) return null;
  // Relative strings from scraped sites: "2 hours ago", "3 days ago", "just now", "yesterday"
  const now = Date.now();
  if (/^(just\s*now|moments?\s*ago|today)$/i.test(raw)) return new Date(now).toISOString();
  if (/^yesterday$/i.test(raw)) return new Date(now - 86400_000).toISOString();
  const rel = /(\d+)\s*(sec(?:ond)?|min(?:ute)?|hour|hr|day|wk|week|month|mo|year|yr)s?\s*ago/i.exec(raw);
  if (rel) {
    const n = Number(rel[1]);
    const u = rel[2].toLowerCase();
    const mult =
      u.startsWith('sec') ? 1000
      : u.startsWith('min') ? 60_000
      : u.startsWith('h') ? 3600_000
      : u.startsWith('d') ? 86400_000
      : u.startsWith('w') ? 7 * 86400_000
      : u.startsWith('mo') ? 30 * 86400_000
      : 365 * 86400_000;
    return new Date(now - n * mult).toISOString();
  }
  const t = Date.parse(raw);
  if (Number.isNaN(t) || t <= 0) return null;
  const year = new Date(t).getUTCFullYear();
  if (year < 2000 || year > 2100) return null;
  return new Date(t).toISOString();
}

export const ONE_WEEK_MS = 7 * 24 * 3600_000;

/**
 * Safely checks whether a chapter date string is less than 7 days old relative to now.
 * Never returns true for missing, invalid, placeholder (year <= 2000), or far-future dates.
 */
export function isRecentWithinWeek(isoOrDate: string | undefined | null, nowMs = Date.now()): boolean {
  if (!isoOrDate) return false;
  const t = Date.parse(isoOrDate);
  if (Number.isNaN(t) || t <= 0) return false;
  const age = nowMs - t;
  // Allow up to 24h clock skew in the future, and strictly < 7 days in the past
  return age >= -86400_000 && age < ONE_WEEK_MS;
}

export function absUrl(u: string | undefined | null, base: string): string | null {
  if (!u) return null;
  try {
    return new URL(u.trim(), base + '/').toString();
  } catch {
    return null;
  }
}
