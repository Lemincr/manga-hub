import { BaseSource, normalizeStatus, normalizeTags, normalizeType, type ChapterInfo, type ChapterPages, type ChapterPreview, type SeriesDetail, type SeriesSummary } from './baseSource.js';
import { HttpError } from '../http.js';

/**
 * Vortex Scans — Next.js front-end with a public JSON API (default https://vortexscans.org/api):
 *   GET /query?page=&perPage=&searchTerm=     -> { posts: [...], totalCount }
 *   GET /post?postSlug=<slug>                 -> { post: {id, postTitle, postContent, ...}, totalChapterCount }
 *   GET /chapters?postId=<id>&skip=&take=&order=desc -> { post: { chapters: [...] } }
 * Page images are not in the API; they are embedded in the chapter HTML page as
 * https://storage.vortexscans.org/upload/series/<slug>/<uuid>/page-0001….webp
 * Paid / scheduled chapters have no images and are reported as locked.
 */
export class VortexScans extends BaseSource {
  readonly id = 'vortexScans';
  readonly name = 'Vortex Scans';
  readonly tier = 'extra';
  readonly extraSettings = [{ key: 'apiUrl', label: 'API URL' }];

  private get api() {
    return String(this.setting('apiUrl')).replace(/\/+$/, '');
  }

  private summary(p: any): SeriesSummary {
    const chs: any[] = Array.isArray(p.chapters) ? p.chapters : [];
    const ch = chs[0];
    const recentChapters: ChapterPreview[] = chs.slice(0, 2).map((c) => ({
      key: c.slug ?? `chapter-${c.number}`,
      number: Number(c.number),
      title: `Ch. ${c.number}`,
      publishedAt: c.createdAt ?? null,
    }));
    const genres = normalizeTags(Array.isArray(p.genres) ? p.genres.map((g: any) => g?.name ?? g) : []);
    const chNum = ch?.number != null ? Number(ch.number) : null;
    if (recentChapters.length === 1 && chNum != null && chNum >= 2) {
      recentChapters.push({ key: `chapter-${chNum - 1}`, number: chNum - 1, title: `Ch. ${chNum - 1}` });
    }
    const creators = [p.author, p.artist].map((x) => String(x ?? '').trim()).filter(Boolean);
    return {
      seriesKey: p.slug,
      title: p.postTitle,
      cover: p.featuredImage ?? null,
      latestChapter: ch ? `Chapter ${ch.number}` : null,
      latestAt: ch?.createdAt ?? p.updatedAt ?? null,
      recentChapters,
      status: normalizeStatus(p.seriesStatus) ?? 'Ongoing',
      type: normalizeType(p.seriesType) ?? 'Manhwa',
      genres,
      creator: [...new Set(creators)].join(', ') || null,
      chapterCount: chNum,
      rating: p.averageRating != null ? Number(Number(p.averageRating).toFixed(2)) : null,
    };
  }

  async search(q: string) {
    const j = await this.json(`${this.api}/query?page=1&perPage=24&searchTerm=${encodeURIComponent(q)}`);
    return (j.posts ?? []).map((p: any) => this.summary(p));
  }

  async latest(page: number) {
    const j = await this.json(`${this.api}/query?page=${page}&perPage=24`);
    return (j.posts ?? []).map((p: any) => this.summary(p));
  }

  async series(key: string): Promise<SeriesDetail> {
    const d = await this.json(`${this.api}/post?postSlug=${encodeURIComponent(key)}`, { ttlMs: 0 });
    const p = d.post;
    if (!p?.id) throw new HttpError('Unexpected Vortex payload (API changed?)', 'parse');
    const take = Math.max(50, Number(d.totalChapterCount) || 1000);
    const c = await this.json(`${this.api}/chapters?postId=${p.id}&skip=0&take=${take}&order=desc&userid=`, { ttlMs: 0 });
    const now = Date.now();
    const chapters: ChapterInfo[] = (c.post?.chapters ?? []).map((ch: any) => ({
      key: ch.slug,
      number: Number(ch.number),
      title: ch.title ? `Chapter ${ch.number} – ${ch.title}` : `Chapter ${ch.number}`,
      publishedAt: ch.createdAt ?? null,
      locked: !!ch.isPermanentlyLocked || Number(ch.price) > 0 || (!!ch.unlockAt && Date.parse(ch.unlockAt) > now),
    }));
    return {
      seriesKey: key,
      title: p.postTitle,
      cover: p.featuredImage ?? null,
      altTitles: String(p.alternativeTitles ?? '').split(',').map((t) => t.trim()).filter(Boolean),
      description: String(p.postContent ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      status: p.seriesStatus ?? null,
      latestChapter: chapters[0]?.title,
      latestAt: chapters[0]?.publishedAt,
      chapters,
    };
  }

  async pages(seriesKey: string, chapterKey: string): Promise<ChapterPages> {
    const html = await this.html(this.chapterUrl(seriesKey, chapterKey), { ttlMs: 0 });
    const found = html.match(/https:\/\/storage\.[^"'\\\s]+\/upload\/series\/[^"'\\\s]+\.(?:webp|jpe?g|png|avif)/g) ?? [];
    const seen = [...new Set(found)].filter((u) => !u.includes('/featured/'));
    const pageNo = (u: string) => Number(/page-(\d+)/i.exec(u)?.[1] ?? NaN);
    if (seen.length && seen.every((u) => !Number.isNaN(pageNo(u)))) seen.sort((a, b) => pageNo(a) - pageNo(b));
    if (!seen.length) return { images: [], locked: true, message: 'No pages available — this chapter is probably paid/early-access on Vortex Scans.' };
    return { images: seen };
  }

  seriesUrl(key: string) {
    return `${this.baseUrl}/series/${encodeURIComponent(key)}`;
  }
  chapterUrl(seriesKey: string, chapterKey: string) {
    return `${this.baseUrl}/series/${encodeURIComponent(seriesKey)}/${chapterKey}`;
  }
}
