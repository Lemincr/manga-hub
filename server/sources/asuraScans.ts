import {
  BaseSource,
  normalizeStatus,
  normalizeTags,
  normalizeType,
  parseNumber,
  type BrowseQuery,
  type ChapterInfo,
  type ChapterPages,
  type ChapterPreview,
  type SeriesDetail,
  type SeriesSummary,
} from './baseSource.js';
import { HttpError } from '../http.js';

export class AsuraScans extends BaseSource {
  readonly id = 'asuraScans';
  readonly name = 'Asura Scans';
  readonly extraSettings = [{ key: 'apiUrl', label: 'API URL' }];

  private get api() {
    return String(this.setting('apiUrl')).replace(/\/+$/, '');
  }

  private summary(s: any): SeriesSummary {
    const lcs: any[] = Array.isArray(s.latest_chapters) ? s.latest_chapters : [];
    const lc = lcs[0];
    const recentChapters: ChapterPreview[] = lcs.slice(0, 2).map((c) => ({
      key: c.slug ?? `chapter-${c.number}`,
      number: Number(c.number),
      title: `Ch. ${c.number}`,
      publishedAt: c.published_at ?? null,
    }));
    const chCount = Number(s.chapter_count) || (lc?.number != null ? Number(lc.number) : parseNumber(lc?.title));
    const creators = [s.author, s.artist]
      .map((x) => String(x ?? '').trim())
      .filter((x) => x && x !== '-' && x.toLowerCase() !== 'unknown');
    const genres = normalizeTags(
      Array.isArray(s.genres) ? s.genres.map((g: any) => (typeof g === 'string' ? g : g?.name)) : [],
    );
    const altTitles = [...new Set<string>([...(s.alt_titles ?? []), ...(s.alternative_titles ?? [])])].filter(Boolean);
    return {
      seriesKey: s.slug,
      title: s.title,
      altTitles,
      cover: s.cover ?? s.cover_url ?? null,
      latestChapter: lc ? `Chapter ${lc.number}` : s.chapter_count ? `${s.chapter_count} chapters` : null,
      latestAt: s.last_chapter_at ?? lc?.published_at ?? s.updated_at ?? null,
      recentChapters,
      status: normalizeStatus(s.status) ?? 'Ongoing',
      type: normalizeType(s.type) ?? 'Manhwa',
      genres,
      creator: [...new Set(creators)].join(', ') || null,
      chapterCount: chCount || null,
      rating: s.rating != null ? Number(Number(s.rating).toFixed(2)) : null,
    };
  }

  async search(query: string) {
    const j = await this.json(`${this.api}/series?search=${encodeURIComponent(query)}&limit=24`);
    return (j.data ?? []).map((s: any) => this.summary(s));
  }

  async latest(page: number) {
    const limit = 24;
    const j = await this.json(`${this.api}/series?sort=latest&limit=${limit}&offset=${(page - 1) * limit}`);
    return (j.data ?? []).map((s: any) => this.summary(s));
  }

  override async browse(q: BrowseQuery): Promise<SeriesSummary[]> {
    const page = Math.max(1, q.page ?? 1);
    if (q.q?.trim() && page > 1) return [];
    const limit = 24;
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String((page - 1) * limit),
      sort: q.sort === 'rating' ? 'rating' : 'latest',
    });
    if (q.q?.trim()) params.set('search', q.q.trim());
    if (q.type?.length === 1) params.set('type', q.type[0].toLowerCase());
    if (q.status?.length === 1) params.set('status', q.status[0].toLowerCase());
    if (q.genresInclude?.length) {
      params.set(
        'genres',
        q.genresInclude.map((g) => g.toLowerCase().replace(/\s+/g, '-')).join(','),
      );
    }
    const j = await this.json(`${this.api}/series?${params.toString()}`);
    return (j.data ?? []).map((s: any) => this.summary(s));
  }

  async series(key: string): Promise<SeriesDetail> {
    const [d, c] = await Promise.all([
      this.json(`${this.api}/series/${encodeURIComponent(key)}`, { ttlMs: 0, delayMs: 120 }),
      this.json(`${this.api}/series/${encodeURIComponent(key)}/chapters`, { ttlMs: 0, delayMs: 120 }),
    ]);
    const s = d.series ?? d.data?.series ?? d.data ?? d;
    if (!s?.slug) throw new HttpError('Unexpected series payload (Asura API changed?)', 'parse');
    const now = Date.now();
    const chapters: ChapterInfo[] = (c.data ?? []).map((ch: any) => ({
      key: ch.slug,
      number: Number(ch.number),
      title: ch.title ? `Chapter ${ch.number} – ${ch.title}` : `Chapter ${ch.number}`,
      publishedAt: ch.published_at ?? null,
      locked: !!ch.is_premium && !!ch.early_access_until && Date.parse(ch.early_access_until) > now,
    }));
    const sum = this.summary(s);
    return {
      ...sum,
      altTitles: sum.altTitles ?? [],
      description: (s.description ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      status: sum.status ?? s.status ?? null,
      chapters,
    };
  }

  /** Fast chapter-only check: 1 API call instead of 2, with 120ms JSON API pacing. */
  override async chaptersOnly(key: string): Promise<ChapterInfo[]> {
    const c = await this.json(`${this.api}/series/${encodeURIComponent(key)}/chapters`, { ttlMs: 0, delayMs: 120 });
    const now = Date.now();
    return (c.data ?? []).map((ch: any) => ({
      key: ch.slug,
      number: Number(ch.number),
      title: ch.title ? `Chapter ${ch.number} – ${ch.title}` : `Chapter ${ch.number}`,
      publishedAt: ch.published_at ?? null,
      locked: !!ch.is_premium && !!ch.early_access_until && Date.parse(ch.early_access_until) > now,
    }));
  }

  async pages(seriesKey: string, chapterKey: string): Promise<ChapterPages> {
    const j = await this.json(`${this.api}/series/${encodeURIComponent(seriesKey)}/chapters/${encodeURIComponent(chapterKey)}`, { ttlMs: 0 });
    const d = j.data ?? j;
    const images: string[] = (d.chapter?.pages ?? []).map((p: any) => p.url).filter(Boolean);
    if (!images.length || d.is_locked) {
      return {
        images: [],
        locked: true,
        message: d.unlock_time ? `Premium/early-access chapter, unlocks ${new Date(d.unlock_time).toLocaleString()}.` : 'This chapter is locked or has no pages yet.',
      };
    }
    return { images };
  }

  seriesUrl(key: string) {
    return `${this.baseUrl}/browse?search=${encodeURIComponent(key.replace(/-/g, ' '))}`;
  }
  chapterUrl(key: string, _chapterKey: string, number?: number) {
    return `${this.baseUrl}/comics/${key}-7ba78ec7/chapter/${number ?? ''}`;
  }
}
