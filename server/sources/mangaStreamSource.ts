import * as cheerio from 'cheerio';
import { BaseSource, absUrl, normalizeStatus, normalizeTags, normalizeType, parseNumber, toIso, type BrowseQuery, type ChapterInfo, type ChapterPages, type ChapterPreview, type SeriesDetail, type SeriesSummary } from './baseSource.js';
import { HttpError } from '../http.js';

/**
 * Adapter for the very common "MangaStream" WordPress theme (used by King of Shojo and many others).
 * All selectors live in `sel` so a subclass can override only what differs.
 */
export abstract class MangaStreamSource extends BaseSource {
  protected sel = {
    card: '.bsx',
    cardLink: 'a',
    cardTitle: '.tt',
    cardCover: 'img',
    cardChapter: '.epxs',
    seriesTitle: 'h1.entry-title',
    seriesCover: '.thumb img',
    seriesDesc: '.entry-content[itemprop=description], .entry-content',
    seriesStatus: '.imptdt i',
    altTitles: '.wd-full:contains("Alternative") span, .alternative',
    chapterItem: '#chapterlist li',
    chapterLink: 'a',
    chapterNum: '.chapternum',
    chapterDate: '.chapterdate',
    readerImages: '#readerarea img',
  };
  protected mangaPath = '/manga/';
  protected latestPath = (page: number) => `/manga/?page=${page}&order=update`;
  protected searchPath = (q: string) => `/?s=${encodeURIComponent(q)}`;

  private cards(html: string): SeriesSummary[] {
    const $ = cheerio.load(html);
    const out: SeriesSummary[] = [];
    $(this.sel.card).each((_, el) => {
      const $el = $(el);
      const href = $el.find(this.sel.cardLink).first().attr('href') ?? '';
      const key = this.keyFromUrl(href);
      if (!key) return;
      const img = $el.find(this.sel.cardCover).first();
      const latestChapter = $el.find(this.sel.cardChapter).first().text().trim() || null;
      const chNum = parseNumber(latestChapter);
      const recentChapters: ChapterPreview[] = [];
      if (chNum != null) {
        recentChapters.push({ key: `${key}-chapter-${chNum}`, number: chNum, title: `Ch. ${chNum}` });
        if (chNum >= 2) recentChapters.push({ key: `${key}-chapter-${chNum - 1}`, number: chNum - 1, title: `Ch. ${chNum - 1}` });
      }
      const typeClass = $el.find('span.type').attr('class') ?? '';
      const ratingNum = parseFloat($el.find('.numscore').first().text().trim());
      out.push({
        seriesKey: key,
        title: ($el.find(this.sel.cardTitle).first().text() || $el.find('a').first().attr('title') || key).trim(),
        cover: absUrl(img.attr('data-src') || img.attr('src'), this.baseUrl),
        latestChapter,
        recentChapters,
        status: 'Ongoing',
        type: normalizeType(typeClass) ?? 'Manhwa',
        chapterCount: chNum,
        rating: Number.isNaN(ratingNum) ? null : ratingNum,
      });
    });
    return out;
  }

  /** https://site/manga/some-slug/ -> some-slug */
  protected keyFromUrl(href: string): string | null {
    const m = /\/manga\/([^/?#]+)/.exec(href);
    return m ? m[1] : null;
  }

  async search(q: string) {
    return this.cards(await this.html(this.baseUrl + this.searchPath(q)));
  }
  async latest(page: number) {
    return this.cards(await this.html(this.baseUrl + this.latestPath(page)));
  }
  override async browse(q: BrowseQuery): Promise<SeriesSummary[]> {
    const page = Math.max(1, q.page ?? 1);
    if (q.q?.trim()) return page === 1 ? this.search(q.q.trim()) : [];
    const params = new URLSearchParams({
      page: String(page),
      order: q.sort === 'title' ? 'title' : q.sort === 'rating' ? 'popular' : 'update',
    });
    if (q.status?.length === 1) params.set('status', q.status[0].toLowerCase());
    if (q.type?.length === 1 && q.type[0] !== 'Novel/Other') params.set('type', q.type[0].toLowerCase());
    if (q.genresInclude?.length) {
      for (const g of q.genresInclude) params.append('genre[]', g.toLowerCase().replace(/\s+/g, '-'));
    }
    return this.cards(await this.html(`${this.baseUrl}/manga/?${params.toString()}`));
  }

  seriesUrl(key: string) {
    return `${this.baseUrl}${this.mangaPath}${key}/`;
  }
  chapterUrl(_s: string, chapterKey: string) {
    return `${this.baseUrl}/${chapterKey}/`;
  }

  async series(key: string): Promise<SeriesDetail> {
    const $ = cheerio.load(await this.html(this.seriesUrl(key), { ttlMs: 0 }));
    const s = this.sel;
    const title = $(s.seriesTitle).first().text().trim();
    if (!title) throw new HttpError('Could not find the series title — site layout may have changed (update selectors).', 'parse');
    const chapters: ChapterInfo[] = [];
    $(s.chapterItem).each((_, el) => {
      const $el = $(el);
      const href = $el.find(s.chapterLink).first().attr('href') ?? '';
      const label = $el.find(s.chapterNum).first().text().trim() || $el.find('a').first().text().trim();
      const number = parseFloat($el.attr('data-num') ?? '') || parseNumber(label);
      const ck = this.chapterKeyFromUrl(href);
      if (!ck || number == null) return;
      chapters.push({ key: ck, number, title: label || `Chapter ${number}`, publishedAt: toIso($el.find(s.chapterDate).first().text()) });
    });
    if (!chapters.length) throw new HttpError('No chapters found — site layout may have changed (update selectors).', 'parse');
    const alts = $(s.altTitles).first().text().split(/[,;|]/).map((t) => t.trim()).filter(Boolean);
    const img = $(s.seriesCover).first();
    return {
      seriesKey: key,
      title,
      cover: absUrl(img.attr('data-src') || img.attr('src'), this.baseUrl),
      altTitles: alts,
      description: $(s.seriesDesc).first().text().replace(/\s+/g, ' ').trim(),
      status: $(s.seriesStatus).first().text().trim() || null,
      latestChapter: chapters[0]?.title,
      latestAt: chapters[0]?.publishedAt,
      chapters,
    };
  }

  /** https://site/some-series-chapter-12/ -> some-series-chapter-12 */
  protected chapterKeyFromUrl(href: string): string | null {
    try {
      const p = new URL(href, this.baseUrl + '/').pathname.replace(/^\/|\/$/g, '');
      return p || null;
    } catch {
      return null;
    }
  }

  async pages(_seriesKey: string, chapterKey: string): Promise<ChapterPages> {
    const html = await this.html(this.chapterUrl('', chapterKey), { ttlMs: 0 });
    let images: string[] = [];
    // 1) ts_reader.run({...sources:[{images:[...]}]})
    const m = /ts_reader\.run\((\{[\s\S]*?\})\);/.exec(html);
    if (m) {
      try {
        images = JSON.parse(m[1]).sources?.[0]?.images ?? [];
      } catch {
        /* fall back to DOM */
      }
    }
    // 2) plain <img> tags in the reader area
    if (!images.length) {
      const $ = cheerio.load(html);
      $(this.sel.readerImages).each((_, el) => {
        const u = $(el).attr('data-src') || $(el).attr('src');
        if (u) images.push(u);
      });
    }
    images = images.map((u) => absUrl(u, this.baseUrl)!).filter(Boolean);
    if (!images.length) throw new HttpError('No page images found — selectors may need updating.', 'parse');
    return { images };
  }
}
