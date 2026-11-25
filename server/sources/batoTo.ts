import { BaseSource, type ChapterPages, type SeriesDetail, type SeriesSummary } from './baseSource.js';
import { HttpError } from '../http.js';

/**
 * Bato.to / xbato — Adapter for the Bato v3/v4 family.
 * NOTE (Nov 2026): Official Bato domains (bato.to, xbato.com, bato.si, etc.) currently return a
 * copyright takedown page ("THIS WEBSITE HAS BEEN CLOSED DUE TO COPYRIGHT INFRINGEMENT") and `/ap2/`
 * returns an S3 error stub. Kept disabled by default so "All sources" does not error out, while
 * remaining ready in Settings if a working mirror or self-hosted compatible instance is configured.
 */
export class BatoTo extends BaseSource {
  readonly id = 'batoTo';
  readonly name = 'Bato.to (xbato)';
  readonly tier = 'extra';

  private async checkAlive(): Promise<string> {
    const html = await this.html(this.baseUrl + '/');
    if (/THIS WEBSITE HAS BEEN CLOSED|closed-assets/i.test(html)) {
      throw new HttpError(
        `Bato.to (${this.baseUrl}) has been shut down due to copyright takedown. Disable this source or configure a live mirror in Settings.`,
        'http',
        503,
      );
    }
    return html;
  }

  async search(query: string): Promise<SeriesSummary[]> {
    await this.checkAlive();
    const res = await this.json(`${this.baseUrl}/ap2/`, {
      method: 'POST',
      ttlMs: 0,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        query: `query ($q: String!) { get_content_searchComic(select: { word: $q, size: 24, page: 1 }) { items { data { id name urlPath urlCover600 } } } }`,
        variables: { q: query },
      }),
    });
    const items = res?.data?.get_content_searchComic?.items ?? [];
    return items.map((it: any) => ({
      seriesKey: String(it.data?.urlPath ?? it.data?.id ?? '').replace(/^\/+|\/+$/g, ''),
      title: it.data?.name ?? 'Untitled',
      cover: it.data?.urlCover600 ?? null,
    }));
  }

  async latest(page: number): Promise<SeriesSummary[]> {
    await this.checkAlive();
    const res = await this.json(`${this.baseUrl}/ap2/`, {
      method: 'POST',
      ttlMs: 0,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        query: `query ($p: Int!) { get_content_searchComic(select: { size: 24, page: $p, sortby: "update" }) { items { data { id name urlPath urlCover600 } } } }`,
        variables: { p: page },
      }),
    });
    const items = res?.data?.get_content_searchComic?.items ?? [];
    return items.map((it: any) => ({
      seriesKey: String(it.data?.urlPath ?? it.data?.id ?? '').replace(/^\/+|\/+$/g, ''),
      title: it.data?.name ?? 'Untitled',
      cover: it.data?.urlCover600 ?? null,
    }));
  }

  async series(seriesKey: string): Promise<SeriesDetail> {
    await this.checkAlive();
    throw new HttpError(`Bato.to series endpoint unavailable for ${seriesKey}. Open original site in browser.`, 'parse');
  }

  async pages(_seriesKey: string, chapterKey: string): Promise<ChapterPages> {
    await this.checkAlive();
    throw new HttpError(`Bato.to chapter endpoint unavailable for ${chapterKey}. Open original site in browser.`, 'parse');
  }

  seriesUrl(key: string) {
    return `${this.baseUrl}/title/${key}`;
  }
  chapterUrl(seriesKey: string, chapterKey: string) {
    return `${this.baseUrl}/title/${seriesKey}/${chapterKey}`;
  }
}
