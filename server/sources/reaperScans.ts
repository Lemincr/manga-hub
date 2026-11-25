import { BaseSource, type ChapterInfo, type ChapterPages, type SeriesDetail, type SeriesSummary } from './baseSource.js';
import { HttpError } from '../http.js';

/**
 * Reaper Scans — Adapter for Reaper Scans' Next.js/API backend (`api.reaperscans.com`).
 * NOTE: Reaper Scans shut down operations after a cease-and-desist, so the default domain no longer
 * resolves. Disabled by default so "All sources" remains fast and clean, while keeping existing or
 * imported Reaper Scans library entries intact and configurable if a mirror URL is entered in Settings.
 */
export class ReaperScans extends BaseSource {
  readonly id = 'reaperScans';
  readonly name = 'Reaper Scans';
  readonly tier = 'extra';
  readonly extraSettings = [{ key: 'apiUrl', label: 'API URL' }];

  private get api() {
    return String(this.setting('apiUrl')).replace(/\/+$/, '');
  }

  private summary(s: any): SeriesSummary {
    const ch = s.free_chapters?.[0] ?? s.chapters?.[0];
    return {
      seriesKey: s.series_slug ?? s.slug,
      title: s.title,
      cover: s.thumbnail ?? null,
      latestChapter: ch?.chapter_name ?? null,
      latestAt: ch?.created_at ?? s.updated_at ?? null,
    };
  }

  async search(query: string): Promise<SeriesSummary[]> {
    const j = await this.json(`${this.api}/query?page=1&perPage=24&series_type=Comic&query_string=${encodeURIComponent(query)}`);
    return (j.data ?? []).map((s: any) => this.summary(s));
  }

  async latest(page: number): Promise<SeriesSummary[]> {
    const j = await this.json(`${this.api}/query?page=${page}&perPage=24&series_type=Comic&order=desc&orderBy=updated_at`);
    return (j.data ?? []).map((s: any) => this.summary(s));
  }

  async series(key: string): Promise<SeriesDetail> {
    const s = await this.json(`${this.api}/series/${encodeURIComponent(key)}`, { ttlMs: 0 });
    if (!s?.id) throw new HttpError('Reaper Scans series payload not found', 'parse');
    const c = await this.json(`${this.api}/chapters/${s.id}?page=1&perPage=1000&order=desc`, { ttlMs: 0 });
    const chapters: ChapterInfo[] = (c.data ?? []).map((ch: any, idx: number) => ({
      key: ch.chapter_slug,
      number: parseFloat(String(ch.chapter_name ?? '').replace(/[^0-9.]/g, '')) || idx + 1,
      title: ch.chapter_name || `Chapter ${idx + 1}`,
      publishedAt: ch.created_at ?? null,
      locked: Number(ch.price) > 0,
    }));
    return {
      ...this.summary(s),
      altTitles: String(s.alternative_names ?? '').split(/[,;|]/).map((t) => t.trim()).filter(Boolean),
      description: String(s.description ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      status: s.status ?? null,
      chapters,
    };
  }

  async pages(seriesKey: string, chapterKey: string): Promise<ChapterPages> {
    const j = await this.json(`${this.api}/chapter/${encodeURIComponent(seriesKey)}/${encodeURIComponent(chapterKey)}`, { ttlMs: 0 });
    const imgs: string[] = j.chapter?.chapter_data?.images ?? j.data?.images ?? [];
    if (!imgs.length) return { images: [], locked: true, message: 'No pages returned (chapter locked or site offline).' };
    return { images: imgs };
  }

  seriesUrl(key: string) {
    return `${this.baseUrl}/series/${key}`;
  }
  chapterUrl(seriesKey: string, chapterKey: string) {
    return `${this.baseUrl}/series/${seriesKey}/${chapterKey}`;
  }
}
