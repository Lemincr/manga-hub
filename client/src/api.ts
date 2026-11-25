import type { FeedItem, RecentChapterLink } from './types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  let lastErr: unknown;
  // Retry once on transient network/restart errors ("Failed to fetch") while the desktop launcher auto-revives the backend
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(600 * attempt);
    try {
      const res = await fetch('/api' + url, {
        ...init,
        headers: init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      return data as T;
    } catch (e) {
      lastErr = e;
      const msg = (e as Error)?.message ?? '';
      if (!/failed to fetch|networkerror|load failed/i.test(msg)) throw e;
    }
  }
  throw new Error(
    'Could not reach the local Manga Hub server (127.0.0.1:3001). If it was closed, re-open MangaHub.exe or run `npm start`.',
  );
}
const body = (method: string, b?: unknown): RequestInit => ({
  method,
  body: b === undefined ? undefined : JSON.stringify(b),
});

/** Cover images also go through the proxy so hotlink protection never breaks them. */
export const proxied = (url: string | null | undefined, sourceId: string) =>
  url ? `/api/img?s=${encodeURIComponent(sourceId)}&u=${encodeURIComponent(url)}` : '';

export const api = {
  get: <T,>(url: string) => req<T>(url),
  post: <T,>(url: string, b?: unknown) => req<T>(url, body('POST', b ?? {})),
  put: <T,>(url: string, b?: unknown) => req<T>(url, body('PUT', b ?? {})),
  patch: <T,>(url: string, b?: unknown) => req<T>(url, body('PATCH', b ?? {})),
  del: <T,>(url: string) => req<T>(url, body('DELETE')),
  bookmark: (it: FeedItem) =>
    req<{ series: { id: number }; warning?: string }>(
      '/library',
      body('POST', {
        sourceId: it.sourceId,
        seriesKey: it.seriesKey,
        title: it.title,
        cover: it.cover,
        latestAt: it.latestAt,
        statusLabel: it.status,
        type: it.type,
        genres: it.genres,
        creator: it.creator,
        rating: it.rating,
      }),
    ),
  open: (it: { sourceId: string; seriesKey: string; title: string; cover?: string | null; latestAt?: string | null; status?: string | null; type?: string | null; genres?: string[]; creator?: string | null; rating?: number | null }) =>
    req<{ id: number }>(
      '/series/open',
      body('POST', {
        sourceId: it.sourceId,
        seriesKey: it.seriesKey,
        title: it.title,
        cover: it.cover,
        latestAt: it.latestAt,
        status: it.status,
        type: it.type,
        genres: it.genres,
        creator: it.creator,
        rating: it.rating,
      }),
    ),
  openChapter: (it: FeedItem, ch: RecentChapterLink) =>
    req<{ seriesId: number; chapterId: number }>(
      '/series/open-chapter',
      body('POST', {
        sourceId: it.sourceId,
        seriesKey: it.seriesKey,
        title: it.title,
        cover: it.cover,
        latestAt: it.latestAt,
        chapterKey: ch.key ?? null,
        chapterNumber: ch.number,
      }),
    ),
};

export function timeAgo(iso?: string | null) {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t) || t <= 0) return '';
  const s = (Date.now() - t) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)}d ago`;
  return new Date(t).toLocaleDateString();
}

const ONE_WEEK_MS = 7 * 24 * 3600_000;

/** Safely checks whether a chapter date is < 7 days old (never true for null/invalid/undated chapters). */
export function isRecentChapterDate(iso?: string | null): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (Number.isNaN(t) || t <= 0) return false;
  const age = Date.now() - t;
  return age >= -86400_000 && age < ONE_WEEK_MS;
}
