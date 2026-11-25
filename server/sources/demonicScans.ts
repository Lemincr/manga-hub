import * as cheerio from 'cheerio';
import { BaseSource, absUrl, parseNumber, toIso, type ChapterInfo, type ChapterPages, type ChapterPreview, type SeriesDetail, type SeriesSummary } from './baseSource.js';
import { HttpError } from '../http.js';

/**
 * Demonic Scans — custom PHP site (no theme). Series key = the raw path segment after /manga/.
 * Chapter key = query string "manga=<id>&chapter=<n>" of /chaptered.php.
 *   latest : /lastupdates.php?list=N      -> .updates-element
 *   search : /advanced.php?title=…        -> anchors to /manga/…
 *   series : /manga/<key>                 -> h1.big-fat-titles, #chapters-list a.chplinks
 *   pages  : /chaptered.php?manga=&chapter= -> img.imgholder (first one is an ad placeholder)
 */
export class DemonicScans extends BaseSource {
  readonly id = 'demonicScans';
  readonly name = 'Demonic Scans';
  readonly tier = 'extra';

  private keyOf(href: string) {
    const m = /\/manga\/([^/?#]+)/.exec(href);
    return m ? m[1] : null;
  }

  async latest(page: number): Promise<SeriesSummary[]> {
    const $ = cheerio.load(await this.html(`${this.baseUrl}/lastupdates.php?list=${page}`));
    const out: SeriesSummary[] = [];
    $('.updates-element').each((_, el) => {
      const $el = $(el);
      const a = $el.find('a[href*="/manga/"]').first();
      const key = this.keyOf(a.attr('href') ?? '');
      if (!key) return;
      const links = $el.find('a.chplinks');
      const latestChapter = links.first().text().trim() || null;
      const recentChapters: ChapterPreview[] = [];
      $el.find('.chap-date').each((_, row) => {
        if (recentChapters.length >= 2) return;
        const $a = $(row).find('a.chplinks').first();
        const m = /chaptered\.php\?(manga=\d+&chapter=[^&"]+)/.exec($a.attr('href') ?? '');
        const label = $a.text().trim();
        const num = parseNumber(label);
        const dt = toIso($(row).find('a.chplinks').eq(1).text());
        if (num != null) recentChapters.push({ key: m?.[1] ?? null, number: num, title: `Ch. ${num}`, publishedAt: dt });
      });
      const rawAlt = ($el.find('img').first().attr('alt') ?? '').split(';').map((s) => s.trim()).filter(Boolean);
      out.push({
        seriesKey: key,
        title: (a.attr('title') ?? $el.find('h2 a').attr('title') ?? key).trim(),
        altTitles: rawAlt,
        cover: absUrl($el.find('img').first().attr('src'), this.baseUrl),
        latestChapter,
        latestAt: toIso(links.eq(1).text()),
        recentChapters,
        status: 'Ongoing',
        chapterCount: parseNumber(latestChapter),
      });
    });
    return out;
  }

  async search(q: string): Promise<SeriesSummary[]> {
    const $ = cheerio.load(await this.html(`${this.baseUrl}/search.php?manga=${encodeURIComponent(q)}`));
    const seen = new Map<string, SeriesSummary>();
    $('a[href*="/manga/"]').each((_, el) => {
      const $a = $(el);
      const key = this.keyOf($a.attr('href') ?? '');
      if (!key) return;
      const cur = seen.get(key) ?? { seriesKey: key, title: '', cover: null };
      // Only take the first clean title line (search.php includes a view-count line inside the anchor text)
      const firstLine = ($a.attr('title') ?? $a.find('img').attr('title') ?? $a.text().split('\n')[0] ?? '')
        .replace(/\s+/g, ' ')
        .trim();
      cur.title ||= firstLine;
      cur.cover ||= absUrl($a.find('img').first().attr('src'), this.baseUrl);
      seen.set(key, cur);
    });
    return [...seen.values()]
      .map((s) => ({ ...s, title: s.title || decodeURIComponent(s.seriesKey).replace(/[-_]/g, ' ') }))
      .slice(0, 24);
  }

  async series(key: string): Promise<SeriesDetail> {
    const $ = cheerio.load(await this.html(this.seriesUrl(key), { ttlMs: 0 }));
    const title = $('h1.big-fat-titles').first().text().trim();
    if (!title) throw new HttpError('Could not find the series title — Demonic Scans layout may have changed.', 'parse');
    const chapters: ChapterInfo[] = [];
    $('#chapters-list a.chplinks').each((_, el) => {
      const $a = $(el);
      const m = /chaptered\.php\?(manga=\d+&chapter=[^&"]+)/.exec($a.attr('href') ?? '');
      const label = $a.clone().children().remove().end().text().trim();
      const number = parseNumber(label);
      if (!m || number == null) return;
      chapters.push({ key: m[1], number, title: label, publishedAt: toIso($a.find('span').first().text()) });
    });
    if (!chapters.length) throw new HttpError('No chapters found — Demonic Scans layout may have changed.', 'parse');
    const alt = $('li:contains("Alternatives")').first().next('li').text().replace(/\u00a0/g, ' ').split(/[;,]/).map((t) => t.trim()).filter(Boolean);
    return {
      seriesKey: key,
      title,
      cover: absUrl($('#manga-info-container img').first().attr('src') ?? $('meta[property="og:image"]').attr('content'), this.baseUrl),
      altTitles: alt,
      description: ($('meta[property="og:description"]').attr('content') ?? $('#manga-info-rightColumn p').first().text()).replace(/\s+/g, ' ').trim(),
      status: $('li:contains("Status")').first().next('li').text().trim() || null,
      latestChapter: chapters[0]?.title,
      latestAt: chapters.map((c) => c.publishedAt).filter(Boolean).sort().at(-1),
      chapters,
    };
  }

  async pages(_s: string, chapterKey: string): Promise<ChapterPages> {
    const $ = cheerio.load(await this.html(`${this.baseUrl}/chaptered.php?${chapterKey}`, { ttlMs: 0 }));
    const images: string[] = [];
    $('img.imgholder').each((_, el) => {
      const u = absUrl($(el).attr('src'), this.baseUrl);
      if (u && !/free_ads|\/img\//.test(u)) images.push(u);
    });
    if (!images.length) throw new HttpError('No page images found — selectors may need updating.', 'parse');
    return { images };
  }

  seriesUrl(key: string) {
    return `${this.baseUrl}/manga/${key}`;
  }
  chapterUrl(_s: string, chapterKey: string) {
    return `${this.baseUrl}/chaptered.php?${chapterKey}`;
  }
}
