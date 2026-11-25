import * as cheerio from 'cheerio';
import { BaseSource, absUrl, parseNumber, toIso, type ChapterInfo, type ChapterPages, type SeriesDetail, type SeriesSummary } from './baseSource.js';
import { HttpError } from '../http.js';

/**
 * Adapter for the "Madara" WordPress theme (ManhuaUS and hundreds of other sites).
 * NOTE: manhuaus.com is often behind a Cloudflare challenge. When blocked, the app shows a clear
 * status and you can use "Open original" instead — this app never tries to defeat the challenge.
 */
export abstract class MadaraSource extends BaseSource {
  protected mangaPath = 'manga';
  protected sel = {
    searchItem: '.c-tabs-item__content',
    latestItem: '.page-item-detail',
    title: '.post-title a, h3 a, h5 a',
    cover: 'img',
    latestChapter: '.chapter-item .chapter a, .list-chapter .chapter a',
    seriesTitle: '.post-title h1',
    seriesCover: '.summary_image img',
    seriesDesc: '.summary__content, .description-summary',
    altTitles: '.post-content_item:contains("Alternative") .summary-content',
    status: '.post-content_item:contains("Status") .summary-content',
    chapterItem: 'li.wp-manga-chapter',
    chapterDate: '.chapter-release-date',
    readerImages: '.reading-content img',
  };

  private cards(html: string, item: string): SeriesSummary[] {
    const $ = cheerio.load(html);
    const out: SeriesSummary[] = [];
    $(item).each((_, el) => {
      const $el = $(el);
      const a = $el.find(this.sel.title).first();
      const key = this.keyFromUrl(a.attr('href') ?? '');
      if (!key) return;
      const img = $el.find(this.sel.cover).first();
      out.push({
        seriesKey: key,
        title: a.text().trim() || key,
        cover: absUrl(img.attr('data-src') || img.attr('data-lazy-src') || img.attr('src'), this.baseUrl),
        latestChapter: $el.find(this.sel.latestChapter).first().text().trim() || null,
      });
    });
    return out;
  }
  protected keyFromUrl(href: string) {
    const m = new RegExp(`/${this.mangaPath}/([^/?#]+)`).exec(href);
    return m ? m[1] : null;
  }

  async search(q: string) {
    return this.cards(await this.html(`${this.baseUrl}/?s=${encodeURIComponent(q)}&post_type=wp-manga`), this.sel.searchItem);
  }
  async latest(page: number) {
    return this.cards(await this.html(`${this.baseUrl}/${this.mangaPath}/page/${page}/?m_orderby=latest`), this.sel.latestItem);
  }
  seriesUrl(key: string) {
    return `${this.baseUrl}/${this.mangaPath}/${key}/`;
  }
  /** chapter key = path under the series, e.g. "chapter-12" */
  chapterUrl(seriesKey: string, chapterKey: string) {
    return `${this.baseUrl}/${this.mangaPath}/${seriesKey}/${chapterKey}/`;
  }

  private parseChapters($: cheerio.CheerioAPI, seriesKey: string): ChapterInfo[] {
    const out: ChapterInfo[] = [];
    $(this.sel.chapterItem).each((_, el) => {
      const $el = $(el);
      const a = $el.find('a').first();
      const href = a.attr('href') ?? '';
      const m = new RegExp(`/${this.mangaPath}/${seriesKey}/(.+?)/?$`).exec(new URL(href, this.baseUrl).pathname);
      const label = a.text().trim();
      const number = parseNumber(label);
      if (!m || number == null) return;
      out.push({ key: m[1].replace(/\/$/, ''), number, title: label, publishedAt: toIso($el.find(this.sel.chapterDate).first().text()) });
    });
    return out;
  }

  async series(key: string): Promise<SeriesDetail> {
    const url = this.seriesUrl(key);
    const $ = cheerio.load(await this.html(url, { ttlMs: 0 }));
    const title = $(this.sel.seriesTitle).first().clone().children().remove().end().text().trim();
    if (!title) throw new HttpError('Could not find the series title — site layout may have changed.', 'parse');

    let chapters = this.parseChapters($, key);
    if (!chapters.length) {
      // Newer Madara: POST {series}/ajax/chapters/ ; older: admin-ajax.php?action=manga_get_chapters
      try {
        const frag = await this.html(`${url}ajax/chapters/`, { method: 'POST', ttlMs: 0, headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        chapters = this.parseChapters(cheerio.load(frag), key);
      } catch (e) {
        const id = $('#manga-chapters-holder').attr('data-id');
        if (!id) throw e;
        const frag = await this.html(`${this.baseUrl}/wp-admin/admin-ajax.php`, {
          method: 'POST',
          ttlMs: 0,
          body: `action=manga_get_chapters&manga=${id}`,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
        });
        chapters = this.parseChapters(cheerio.load(frag), key);
      }
    }
    if (!chapters.length) throw new HttpError('No chapters found — selectors or ajax endpoint may need updating.', 'parse');
    const img = $(this.sel.seriesCover).first();
    return {
      seriesKey: key,
      title,
      cover: absUrl(img.attr('data-src') || img.attr('data-lazy-src') || img.attr('src'), this.baseUrl),
      altTitles: $(this.sel.altTitles).first().text().split(/[,;|]/).map((t) => t.trim()).filter(Boolean),
      description: $(this.sel.seriesDesc).first().text().replace(/\s+/g, ' ').trim(),
      status: $(this.sel.status).first().text().trim() || null,
      latestChapter: chapters[0]?.title,
      latestAt: chapters[0]?.publishedAt,
      chapters,
    };
  }

  async pages(seriesKey: string, chapterKey: string): Promise<ChapterPages> {
    const $ = cheerio.load(await this.html(this.chapterUrl(seriesKey, chapterKey) + '?style=list', { ttlMs: 0 }));
    const images: string[] = [];
    $(this.sel.readerImages).each((_, el) => {
      const u = $(el).attr('data-src') || $(el).attr('data-lazy-src') || $(el).attr('src');
      const abs = absUrl(u, this.baseUrl);
      if (abs) images.push(abs);
    });
    if (!images.length) throw new HttpError('No page images found — selectors may need updating.', 'parse');
    return { images };
  }
}
