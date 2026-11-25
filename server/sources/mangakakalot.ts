import * as cheerio from 'cheerio';
import { BaseSource, absUrl, parseNumber, toIso, type ChapterInfo, type ChapterPages, type SeriesDetail, type SeriesSummary } from './baseSource.js';
import { HttpError } from '../http.js';

/**
 * Mangakakalot (mangakakalot.gg / mangakakalot.com) — Standard HTML scraper for the Mangakakalot /
 * MangaNelo template:
 *  - latest : `/` or `/manga_list?type=latest&page={p}` -> `.itemupdate` or `.list-truyen-item-wrap`
 *  - search : `/search/story/{slug_query}`              -> `.story_item`
 *  - series : `/manga/{slug}`                           -> `.manga-info-text`, `.chapter-list .row`
 *  - pages  : `/manga/{slug}/{chapter}`                 -> `.container-chapter-reader img`
 * Note: search/series subpaths are frequently behind Cloudflare (403); when blocked, `http.ts`
 * triggers the 15-minute cooldown and surfaces the "Open original" fallback.
 */
export class Mangakakalot extends BaseSource {
  readonly id = 'mangakakalot';
  readonly name = 'Mangakakalot';
  readonly tier = 'extra';

  private keyOf(href: string): string | null {
    const m = /\/(?:manga|read-[a-z0-9-]+)\/([^/?#]+)/i.exec(href);
    return m ? m[1] : null;
  }

  async latest(page: number): Promise<SeriesSummary[]> {
    const url = page === 1 ? `${this.baseUrl}/` : `${this.baseUrl}/manga_list?type=latest&category=all&state=all&page=${page}`;
    const $ = cheerio.load(await this.html(url));
    const out: SeriesSummary[] = [];
    $('.itemupdate, .list-truyen-item-wrap').each((_, el) => {
      const $el = $(el);
      const a = $el.find('h3 a, a.cover').first();
      const key = this.keyOf(a.attr('href') ?? '');
      if (!key) return;
      const img = $el.find('img').first();
      out.push({
        seriesKey: key,
        title: ($el.find('h3 a').first().text() || img.attr('alt') || key).trim(),
        cover: absUrl(img.attr('data-src') || img.attr('src'), this.baseUrl),
        latestChapter: $el.find('ul li a.sts_1, a.list-story-item-wrap-chapter').first().text().trim() || null,
      });
    });
    return out;
  }

  async search(query: string): Promise<SeriesSummary[]> {
    const slug = query.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    const $ = cheerio.load(await this.html(`${this.baseUrl}/search/story/${encodeURIComponent(slug)}`));
    const out: SeriesSummary[] = [];
    $('.story_item, .daily-update .panel_story_list .story_item').each((_, el) => {
      const $el = $(el);
      const a = $el.find('.story_name a, h3 a').first();
      const key = this.keyOf(a.attr('href') ?? '');
      if (!key) return;
      const img = $el.find('img').first();
      out.push({
        seriesKey: key,
        title: a.text().trim() || key,
        cover: absUrl(img.attr('data-src') || img.attr('src'), this.baseUrl),
        latestChapter: $el.find('.story_chapter a').first().text().trim() || null,
      });
    });
    return out;
  }

  async series(key: string): Promise<SeriesDetail> {
    const $ = cheerio.load(await this.html(this.seriesUrl(key), { ttlMs: 0 }));
    const title = $('.manga-info-text li h1, .story-info-right h1').first().text().trim();
    if (!title) throw new HttpError('Could not find series title on Mangakakalot — layout changed or blocked.', 'parse');
    const chapters: ChapterInfo[] = [];
    $('.chapter-list .row, .row-content-chapter li').each((_, el) => {
      const $el = $(el);
      const a = $el.find('a').first();
      const href = a.attr('href') ?? '';
      const ck = href.split('/').filter(Boolean).at(-1);
      const label = a.text().trim();
      const number = parseNumber(label);
      if (!ck || number == null) return;
      chapters.push({
        key: ck,
        number,
        title: label,
        publishedAt: toIso($el.find('span, .chapter-time').last().attr('title') || $el.find('span, .chapter-time').last().text()),
      });
    });
    if (!chapters.length) throw new HttpError('No chapters found on Mangakakalot.', 'parse');
    const img = $('.manga-info-pic img, .info-image img').first();
    return {
      seriesKey: key,
      title,
      cover: absUrl(img.attr('data-src') || img.attr('src'), this.baseUrl),
      altTitles: $('.story-alternative, .manga-info-text li:contains("Alternative")')
        .first()
        .text()
        .replace(/^Alternative\s*:?/i, '')
        .split(/[;,]/)
        .map((s) => s.trim())
        .filter(Boolean),
      description: $('#noidungm, #panel-story-info-description').first().text().replace(/\s+/g, ' ').trim(),
      status: $('.manga-info-text li:contains("Status"), .variations-tableInfo tr:contains("Status") td.table-value').first().text().replace(/Status\s*:?/i, '').trim() || null,
      latestChapter: chapters[0]?.title,
      latestAt: chapters[0]?.publishedAt,
      chapters,
    };
  }

  async pages(seriesKey: string, chapterKey: string): Promise<ChapterPages> {
    const $ = cheerio.load(await this.html(this.chapterUrl(seriesKey, chapterKey), { ttlMs: 0 }));
    const images: string[] = [];
    $('.container-chapter-reader img').each((_, el) => {
      const u = absUrl($(el).attr('data-src') || $(el).attr('src'), this.baseUrl);
      if (u) images.push(u);
    });
    if (!images.length) throw new HttpError('No chapter images found on Mangakakalot.', 'parse');
    return { images };
  }

  seriesUrl(key: string) {
    return `${this.baseUrl}/manga/${key}`;
  }
  chapterUrl(seriesKey: string, chapterKey: string) {
    return `${this.baseUrl}/manga/${seriesKey}/${chapterKey}`;
  }
}
