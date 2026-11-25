import * as cheerio from 'cheerio';
import { BaseSource, absUrl, parseNumber, toIso, type ChapterInfo, type ChapterPages, type ChapterPreview, type SeriesDetail, type SeriesSummary } from './baseSource.js';
import { HttpError } from '../http.js';

/** Decode Dean Edwards "p,a,c,k,e,d" packed JavaScript WITHOUT eval (pure string work). */
export function unpackPacked(src: string): string | null {
  const m = /\}\('([\s\S]*)',(\d+),(\d+),'([\s\S]*?)'\.split\('\|'\)/.exec(src);
  if (!m) return null;
  const base = Number(m[2]);
  const count = Number(m[3]);
  const keys = m[4].split('|');
  const enc = (n: number): string => (n < base ? '' : enc(Math.floor(n / base))) + ((n %= base) > 35 ? String.fromCharCode(n + 29) : n.toString(36));
  const dict = new Map<string, string>();
  for (let i = count - 1; i >= 0; i--) dict.set(enc(i), keys[i] || enc(i));
  return m[1].replace(/\\'/g, "'").replace(/\b\w+\b/g, (w) => dict.get(w) ?? w);
}

/**
 * MangaHere (mangahere.cc). Static HTML for listings; chapter images come from
 * `chapterfun.ashx`, which returns packed JS that yields two image URLs per call (hence page += 2).
 * Mangakakalot sites currently answer scripted requests with HTTP 403 and are not included.
 */
export class MangaHere extends BaseSource {
  readonly id = 'mangaHere';
  readonly name = 'MangaHere';
  readonly tier = 'extra';

  private cards(html: string): SeriesSummary[] {
    const $ = cheerio.load(html);
    const out: SeriesSummary[] = [];
    $('.manga-list-1-list li, .manga-list-4-list li').each((_, el) => {
      const $el = $(el);
      const a = $el.find('a[href^="/manga/"]').first();
      const key = /\/manga\/([^/]+)\/?/.exec(a.attr('href') ?? '')?.[1];
      if (!key) return;
      const subA = $el.find('.manga-list-1-item-subtitle a, .manga-list-4-item-part a').first();
      const latestChapter = subA.text().trim() || null;
      const chKey = /\/manga\/[^/]+\/(c\d+(?:\.\d+)?)\//.exec(subA.attr('href') ?? '')?.[1] ?? null;
      const chNum = parseNumber(latestChapter);
      const recentChapters: ChapterPreview[] = [];
      if (chNum != null) {
        recentChapters.push({ key: chKey, number: chNum, title: `Ch. ${chNum}` });
      }
      out.push({
        seriesKey: key,
        title: (a.attr('title') ?? key).trim(),
        cover: absUrl($el.find('img').first().attr('src')?.replace(/^http:/, 'https:'), this.baseUrl),
        latestChapter,
        recentChapters,
        type: 'Manga',
        chapterCount: chNum,
      });
    });
    return out;
  }

  async search(q: string) {
    return this.cards(await this.html(`${this.baseUrl}/search?title=${encodeURIComponent(q)}`));
  }
  async latest(page: number) {
    return this.cards(await this.html(`${this.baseUrl}/directory/${page}.htm?latest`));
  }

  async series(key: string): Promise<SeriesDetail> {
    const $ = cheerio.load(await this.html(this.seriesUrl(key), { ttlMs: 0 }));
    const title = $('.detail-info-right-title-font').first().text().trim();
    if (!title) throw new HttpError('Could not find the series title — MangaHere layout may have changed.', 'parse');
    const chapters: ChapterInfo[] = [];
    $('ul.detail-main-list li a').each((_, el) => {
      const $a = $(el);
      const m = /\/manga\/[^/]+\/(c(\d+(?:\.\d+)?))\//.exec($a.attr('href') ?? '');
      if (!m) return;
      chapters.push({
        key: m[1],
        number: parseFloat(m[2]),
        title: ($a.find('.detail-main-list-main p').first().text() || $a.attr('title') || `Chapter ${m[2]}`).trim(),
        publishedAt: toIso($a.find('.title2').first().text()),
      });
    });
    if (!chapters.length) throw new HttpError('No chapters found — MangaHere layout may have changed.', 'parse');
    return {
      seriesKey: key,
      title,
      cover: absUrl($('.detail-info-cover-img').first().attr('src')?.replace(/^http:/, 'https:'), this.baseUrl),
      altTitles: [],
      description: $('.fullcontent').first().text().replace(/\s+/g, ' ').trim(),
      status: $('.detail-info-right-title-tip').first().text().trim() || null,
      latestChapter: chapters[0]?.title,
      latestAt: chapters.map((c) => c.publishedAt).filter(Boolean).sort().at(-1),
      chapters,
    };
  }

  async pages(seriesKey: string, chapterKey: string): Promise<ChapterPages> {
    const url = this.chapterUrl(seriesKey, chapterKey);
    const html = await this.html(url, { ttlMs: 0 });
    const cid = /var chapterid\s*=\s*(\d+)/.exec(html)?.[1];
    const count = Number(/var imagecount\s*=\s*(\d+)/.exec(html)?.[1]);
    const key = /id="dm5_key"[^>]*value="([^"]*)"/.exec(html)?.[1] ?? '';
    if (!cid || !count) throw new HttpError('Chapter metadata not found — MangaHere layout may have changed.', 'parse');

    const images: string[] = [];
    for (let p = 1; p <= count; p += 2) {
      const js = await this.html(`${this.baseUrl}/manga/${seriesKey}/${chapterKey}/chapterfun.ashx?cid=${cid}&page=${p}&key=${key}`, {
        referer: url,
        ttlMs: 0,
        headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: '*/*' },
      });
      const code = unpackPacked(js) ?? js;
      const pix = /var \w+\s*=\s*"((?:https?:)?\/\/[^"]+)"/.exec(code)?.[1];
      const list = /\[\s*((?:"[^"]*"\s*,?\s*)+)\]/.exec(code)?.[1].match(/"([^"]*)"/g)?.map((s) => s.slice(1, -1)) ?? [];
      if (!pix || !list.length) throw new HttpError('Could not decode chapter images — MangaHere changed its image script.', 'parse');
      for (const v of list) images.push(absUrl(/^(https?:)?\/\//.test(v) ? v : pix + v, this.baseUrl)!);
    }
    return { images: [...new Set(images)].slice(0, count) };
  }

  seriesUrl(key: string) {
    return `${this.baseUrl}/manga/${key}/`;
  }
  chapterUrl(seriesKey: string, chapterKey: string) {
    return `${this.baseUrl}/manga/${seriesKey}/${chapterKey}/1.html`;
  }
}
