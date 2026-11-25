import { get, run } from './db.js';
import { getSetting } from './settings.js';

export type ErrorKind = 'blocked' | 'http' | 'network' | 'parse' | 'locked';

export class HttpError extends Error {
  constructor(
    message: string,
    public kind: ErrorKind,
    public status = 0,
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- throttling: serialise requests per host with a minimum delay -------------
const queues = new Map<string, Promise<void>>();
const lastAt = new Map<string, number>();

async function throttle(host: string, customDelayMs?: number) {
  const delay = customDelayMs !== undefined ? customDelayMs : Number(getSetting('requestDelayMs')) || 0;
  if (delay <= 0) return;
  const prev = queues.get(host) ?? Promise.resolve();
  const mine = prev.then(async () => {
    const wait = (lastAt.get(host) ?? 0) + delay - Date.now();
    if (wait > 0) await sleep(wait);
    lastAt.set(host, Date.now());
  });
  queues.set(host, mine);
  await mine;
}

// ---- structured cache ---------------------------------------------------------
export function cacheGet<T = string>(key: string): T | undefined {
  const row = get('SELECT value, expires_at FROM cache WHERE key = ?', key);
  if (!row || row.expires_at < Date.now()) return undefined;
  return JSON.parse(row.value) as T;
}
export function cacheSet(key: string, value: unknown, ttlMs: number) {
  run(
    'INSERT INTO cache(key,value,expires_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, expires_at=excluded.expires_at',
    key,
    JSON.stringify(value),
    Date.now() + ttlMs,
  );
}
export function cachePrune() {
  run('DELETE FROM cache WHERE expires_at < ?', Date.now());
}
export function cacheClear() {
  run('DELETE FROM cache');
}

export interface FetchOpts {
  referer?: string;
  method?: 'GET' | 'POST';
  body?: string;
  headers?: Record<string, string>;
  /** cache lifetime; 0 disables caching. Default: settings.cacheTtlMinutes */
  ttlMs?: number;
  /** ignore cached copy (the fresh response is still stored) */
  fresh?: boolean;
  retries?: number;
  /** optional per-request override for host throttle delay (ms) */
  delayMs?: number;
}

const looksLikeChallenge = (body: string) =>
  /just a moment|cf-chl|challenge-platform|attention required|cloudflare/i.test(body.slice(0, 6000));

/**
 * Anti-bot handling. When a site answers with a Cloudflare challenge we do NOT try to solve or
 * evade it. We stop hammering the host for a cool-down period, report a clear status, and let the
 * UI offer "open in browser". Use resetBlock() (Settings → Test) to retry earlier.
 */
const BLOCK_COOLDOWN_MS = 15 * 60_000;
const blockedUntil = new Map<string, number>();
export const resetBlock = (host: string) => blockedUntil.delete(host);
const blockedMessage = (status: number) =>
  `Blocked by the site's anti-bot protection (HTTP ${status}, Cloudflare challenge). Manga Hub does not bypass challenges — open the site in your browser, or try another mirror domain in Settings.`;

/** Plain browser-like request headers (no cookies, no spoofed client hints). */
function browserHeaders(url: string, opts: FetchOpts): Record<string, string> {
  const ua = getSetting<string>('userAgent');
  const isJson = opts.headers?.Accept?.includes('json');
  return {
    'User-Agent': ua,
    Accept: isJson ? 'application/json, text/plain, */*' : 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    ...(isJson ? {} : { 'Upgrade-Insecure-Requests': '1' }),
    ...(opts.referer ? { Referer: opts.referer } : {}),
  };
}

/** Polite fetch: throttle per host, cache GETs, retry with exponential backoff. */
export async function fetchText(url: string, opts: FetchOpts = {}): Promise<string> {
  const method = opts.method ?? 'GET';
  const ttl = opts.ttlMs ?? (Number(getSetting('cacheTtlMinutes')) || 0) * 60_000;
  const cacheKey = `http:${method}:${url}:${opts.body ?? ''}`;
  if (method === 'GET' && ttl > 0 && !opts.fresh) {
    const hit = cacheGet<string>(cacheKey);
    if (hit !== undefined) return hit;
  }

  const host = new URL(url).host;
  const until = blockedUntil.get(host) ?? 0;
  if (until > Date.now())
    throw new HttpError(`${blockedMessage(403)} (Paused until ${new Date(until).toLocaleTimeString()} to avoid hammering the site; Settings → Test retries now.)`, 'blocked', 403);
  const retries = opts.retries ?? 2;
  let lastErr: HttpError | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(1000 * 2 ** (attempt - 1) + Math.random() * 400);
    await throttle(host, opts.delayMs);
    try {
      const res = await fetch(url, {
        method,
        body: opts.body,
        redirect: 'follow',
        signal: AbortSignal.timeout(20_000),
        headers: { ...browserHeaders(url, opts), ...opts.headers },
      });
      const text = await res.text();
      if (res.ok) {
        if (method === 'GET' && ttl > 0) cacheSet(cacheKey, text, ttl);
        return text;
      }
      const challenged = res.headers.get('cf-mitigated') === 'challenge' || ((res.status === 403 || res.status === 503) && looksLikeChallenge(text));
      if (challenged) {
        blockedUntil.set(host, Date.now() + BLOCK_COOLDOWN_MS);
        throw new HttpError(blockedMessage(res.status), 'blocked', res.status);
      }
      if (res.status === 403) throw new HttpError('Access forbidden (HTTP 403) — the site refused the request.', 'blocked', 403);
      if (res.status === 429 || res.status >= 500) {
        lastErr = new HttpError(`Site returned HTTP ${res.status}`, 'http', res.status);
        const ra = Number(res.headers.get('retry-after'));
        if (ra > 0 && ra < 30) await sleep(ra * 1000);
        continue; // retry
      }
      throw new HttpError(`Site returned HTTP ${res.status}`, 'http', res.status);
    } catch (e) {
      if (e instanceof HttpError) {
        if (e.kind === 'blocked' || e.status === 404) throw e;
        lastErr = e;
        if (!(e.status === 429 || e.status >= 500)) throw e;
      } else {
        lastErr = new HttpError(`Network error: ${(e as Error).message}`, 'network');
      }
    }
  }
  throw lastErr ?? new HttpError('Request failed', 'network');
}

export async function fetchJson<T = any>(url: string, opts: FetchOpts = {}): Promise<T> {
  const text = await fetchText(url, opts);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError('Expected JSON but received something else (site layout/API changed?)', 'parse');
  }
}
