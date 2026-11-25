import { cacheGet, cacheSet } from './http.js';
import { normalizeStatus, normalizeTags, normalizeTitleKey, type NormalizedStatus, type NormalizedType } from './sources/baseSource.js';

export interface EnrichedMetadata {
  title?: string | null;
  altTitles: string[];
  type?: NormalizedType | null;
  status?: NormalizedStatus | null;
  genres: string[];
  creator?: string | null;
  description?: string | null;
  cover?: string | null;
  rating?: number | null;
}

const ANILIST_URL = 'https://graphql.anilist.co';
const TTL_MS = 7 * 24 * 3600_000; // 7 days in SQLite cache table

let queue: Promise<void> = Promise.resolve();
let lastCall = 0;

async function throttleAniList() {
  const prev = queue;
  const mine = prev.then(async () => {
    const wait = lastCall + 700 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
  });
  queue = mine;
  await mine;
}

function countryToType(country: string | undefined | null): NormalizedType | null {
  if (!country) return null;
  const c = country.toUpperCase();
  if (c === 'KR') return 'Manhwa';
  if (c === 'CN' || c === 'TW' || c === 'HK') return 'Manhua';
  if (c === 'JP') return 'Manga';
  return null;
}

/**
 * Look up a series title on AniList GraphQL (cached for 7 days in SQLite `cache`).
 * Never throws; returns null on miss or rate-limit so scraping flows never break.
 */
export async function enrichFromCatalog(rawTitle: string): Promise<EnrichedMetadata | null> {
  const keyTitle = normalizeTitleKey(rawTitle);
  if (!keyTitle || keyTitle.length < 3) return null;
  const cacheKey = `catalog:anilist:${keyTitle}`;
  const hit = cacheGet<EnrichedMetadata | null>(cacheKey);
  if (hit !== undefined) return hit;

  try {
    await throttleAniList();
    const res = await fetch(ANILIST_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(8_000),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'MangaHub/1.0 (+http://localhost:3001)',
      },
      body: JSON.stringify({
        query: `query ($s: String) {
          Media(search: $s, type: MANGA) {
            countryOfOrigin
            status
            averageScore
            genres
            tags { name rank isMediaSpoiler }
            description(asHtml: false)
            coverImage { large }
            staff(perPage: 4) { edges { role node { name { full } } } }
            title { romaji english native }
            synonyms
          }
        }`,
        variables: { s: rawTitle.slice(0, 90) },
      }),
    });

    if (!res.ok) {
      if (res.status === 404) cacheSet(cacheKey, null, 24 * 3600_000);
      return null;
    }
    const json = (await res.json()) as any;
    const m = json?.data?.Media;
    if (!m) {
      cacheSet(cacheKey, null, 24 * 3600_000);
      return null;
    }

    const rawTags: string[] = [
      ...(m.genres ?? []),
      ...((m.tags ?? [])
        .filter((t: any) => !t?.isMediaSpoiler && (t?.rank ?? 0) >= 45)
        .map((t: any) => t?.name)
        .filter(Boolean)),
    ];
    const staff = (m.staff?.edges ?? [])
      .map((e: any) => e?.node?.name?.full)
      .filter(Boolean);
    const alts = [m.title?.english, m.title?.romaji, m.title?.native, ...(m.synonyms ?? [])]
      .map((s) => String(s ?? '').trim())
      .filter(Boolean);

    const out: EnrichedMetadata = {
      title: m.title?.english || m.title?.romaji || null,
      altTitles: [...new Set(alts)],
      type: countryToType(m.countryOfOrigin),
      status: normalizeStatus(m.status),
      genres: normalizeTags(rawTags),
      creator: [...new Set(staff)].slice(0, 2).join(', ') || null,
      description: m.description ? String(m.description).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : null,
      cover: m.coverImage?.large ?? null,
      rating: m.averageScore ? Number((Number(m.averageScore) / 10).toFixed(1)) : null,
    };
    cacheSet(cacheKey, out, TTL_MS);
    return out;
  } catch {
    return null;
  }
}
