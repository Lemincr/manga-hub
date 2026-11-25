import * as cheerio from 'cheerio';
import {
  BaseSource,
  absUrl,
  normalizeStatus,
  normalizeTags,
  normalizeType,
  toIso,
  type BrowseQuery,
  type ChapterInfo,
  type ChapterPages,
  type ChapterPreview,
  type SeriesDetail,
  type SeriesSummary,
} from './baseSource.js';
import { HttpError } from '../http.js';

const cover = (ulid: string) => `https://temp.compsci88.com/cover/normal/${ulid}.webp`;
const numberOf = (label: string) => {
  const m = /chapter\s*(\d+(?:\.\d+)?)/i.exec(label) ?? /(\d+(?:\.\d+)?)/.exec(label);
  return m ? parseFloat(m[1]) : null;
};

// Map canonical tag names back to WeebCentral's tag parameter names
const WC_TAG_MAP: Record<string, string> = {
  genderswap: 'Gender Bender',
  "girls' love": 'Yuri',
  "boys' love": 'Yaoi',
};

export class WeebCentral extends BaseSource {
  readonly id = 'weebCentral';
  readonly name = 'Weeb Central';
  readonly tier = 'extra';

  private key(href: string) {
    const m = /\/series\/([0-9A-Z]{26}\/[^/?#]+)/.exec(href);
    return m ? m[1] : null;
  }

  private parseSearchCards(html: string): SeriesSummary[] {
    const $ = cheerio.load(html);
    const seen = new Map<string, SeriesSummary>();
    $('article.bg-base-300, article').each((_, el) => {
      const $el = $(el);
      const a = $el.find('a[href*="/series/"]').first();
      const key = this.key(a.attr('href') ?? '');
      if (!key || seen.has(key)) return;
      const ulid = key.split('/')[0];
      const alt = $el.find('img[alt]').first().attr('alt')?.replace(/\s*cover$/i, '').trim();
      const title = alt || $el.find('a.link-hover').first().text().trim() || decodeURIComponent(key.split('/')[1]).replace(/-/g, ' ');
      const statusRaw = $el.find('strong:contains("Status:")').parent().find('span').first().text().trim();
      const typeRaw =
        $el.find('strong:contains("Type:")').parent().find('span').first().text().trim() ||
        $el.find('[data-tip="Manga"], [data-tip="Manhwa"], [data-tip="Manhua"]').first().attr('data-tip') ||
        '';
      const authors = $el
        .find('strong:contains("Author")')
        .parent()
        .find('a')
        .map((_, x) => $(x).text().trim())
        .get()
        .filter(Boolean);
      const tags = $el
        .find('strong:contains("Tag")')
        .parent()
        .find('span')
        .map((_, x) => $(x).text().replace(/,/g, '').trim())
        .get()
        .filter(Boolean);

      seen.set(key, {
        seriesKey: key,
        title,
        cover: cover(ulid),
        status: normalizeStatus(statusRaw) ?? 'Ongoing',
        type: normalizeType(typeRaw) ?? 'Manga',
        genres: normalizeTags(tags),
        creator: authors.join(', ') || null,
      });
    });
    return [...seen.values()];
  }

  async search(q: string): Promise<SeriesSummary[]> {
    const html = await this.html(
      `${this.baseUrl}/search/data?text=${encodeURIComponent(q)}&sort=Best%20Match&order=Descending&official=Any&display_mode=Full%20Display`,
    );
    return this.parseSearchCards(html).slice(0, 32);
  }

  async latest(page: number): Promise<SeriesSummary[]> {
    const $ = cheerio.load(await this.html(`${this.baseUrl}/latest-updates/${page}`));
    const out: SeriesSummary[] = [];
    $('article[data-tip]').each((_, el) => {
      const $el = $(el);
      const key = this.key($el.find('a[href*="/series/"]').first().attr('href') ?? '');
      if (!key) return;
      const latestChapter = $el.find('span').filter((_, s) => /chapter/i.test($(s).text())).first().text().trim() || null;
      const chHref = $el.find('a[href*="/chapters/"]').first().attr('href') ?? '';
      const chKey = /\/chapters\/([0-9A-Z]{26})/.exec(chHref)?.[1] ?? null;
      const chNum = numberOf(latestChapter ?? '');
      const latestAt = toIso($el.find('time').first().attr('datetime'));
      const recentChapters: ChapterPreview[] = [];
      if (chNum != null) {
        recentChapters.push({ key: chKey, number: chNum, title: `Ch. ${chNum}`, publishedAt: latestAt });
        if (chNum >= 2) recentChapters.push({ number: chNum - 1, title: `Ch. ${chNum - 1}` });
      }
      const statusIcon = $el.find('img[src*="icon-"]').attr('src') ?? '';
      const status = /complete/i.test(statusIcon) ? 'Completed' : /hiatus/i.test(statusIcon) ? 'Hiatus' : 'Ongoing';
      out.push({
        seriesKey: key,
        title: $el.attr('data-tip')!.trim(),
        cover: cover(key.split('/')[0]),
        latestChapter,
        latestAt,
        recentChapters,
        status,
        chapterCount: chNum,
      });
    });
    return out;
  }

  override async browse(q: BrowseQuery): Promise<SeriesSummary[]> {
    const page = Math.max(1, q.page ?? 1);
    const hasServerFilters =
      Boolean(q.q?.trim()) ||
      Boolean(q.type?.length) ||
      Boolean(q.status?.length) ||
      Boolean(q.genresInclude?.length) ||
      Boolean(q.creator?.trim());

    if (!hasServerFilters) return this.latest(page);

    const limit = 32;
    const offset = (page - 1) * limit;
    const parts: string[] = [
      `text=${encodeURIComponent(q.q?.trim() ?? '')}`,
      `sort=${encodeURIComponent(q.sort === 'title' ? 'Alphabet' : q.sort === 'rating' ? 'Popularity' : 'Latest Updates')}`,
      'order=Descending',
      'official=Any',
      'display_mode=Full%20Display',
      `limit=${limit}`,
      `offset=${offset}`,
    ];
    if (q.creator?.trim()) parts.push(`author=${encodeURIComponent(q.creator.trim())}`);
    for (const tp of q.type ?? []) {
      if (['Manga', 'Manhwa', 'Manhua'].includes(tp)) parts.push(`included_type=${encodeURIComponent(tp)}`);
    }
    for (const st of q.status ?? []) {
      if (['Ongoing', 'Completed', 'Hiatus', 'Cancelled'].includes(st)) parts.push(`included_status=${encodeURIComponent(st)}`);
    }
    for (const g of q.genresInclude ?? []) {
      const mapped = WC_TAG_MAP[g.toLowerCase()] ?? g;
      parts.push(`included_tag=${encodeURIComponent(mapped)}`);
    }
    const html = await this.html(`${this.baseUrl}/search/data?${parts.join('&')}`);
    return this.parseSearchCards(html);
  }

  async series(key: string): Promise<SeriesDetail> {
    const ulid = key.split('/')[0];
    const $ = cheerio.load(await this.html(this.seriesUrl(key), { ttlMs: 0 }));
    const title = $('h1').first().text().trim();
    if (!title) throw new HttpError('Could not find the series title — Weeb Central layout may have changed.', 'parse');
    const field = (name: string) => $(`strong:contains("${name}")`).first().parent();
    const alts = field('Associated Name').find('li').map((_, li) => $(li).text().trim()).get();
    const tags = field('Tag').find('a').map((_, a) => $(a).text().trim()).get();
    const typeRaw = field('Type').find('a').first().text().trim();
    const authors = field('Author').find('a').map((_, a) => $(a).text().trim()).get();

    const $c = cheerio.load(await this.html(`${this.baseUrl}/series/${ulid}/full-chapter-list`, { ttlMs: 0, headers: { 'HX-Request': 'true' } }));
    const chapters: ChapterInfo[] = [];
    $c('a[href*="/chapters/"]').each((_, el) => {
      const $a = $c(el);
      const ck = /\/chapters\/([0-9A-Z]{26})/.exec($a.attr('href') ?? '')?.[1];
      const label = $a.find('span.grow > span').first().text().trim() || $a.text().trim().split('\n')[0].trim();
      const number = numberOf(label);
      if (!ck || number == null) return;
      chapters.push({ key: ck, number, title: label, publishedAt: toIso($a.find('time').first().attr('datetime')) });
    });
    if (!chapters.length) throw new HttpError('No chapters found — Weeb Central layout may have changed.', 'parse');
    return {
      seriesKey: key,
      title,
      cover: cover(ulid),
      altTitles: alts,
      description: field('Description').find('p').first().text().replace(/\s+/g, ' ').trim(),
      status: normalizeStatus(field('Status').find('a').first().text().trim()) ?? null,
      type: normalizeType(typeRaw) ?? 'Manga',
      genres: normalizeTags(tags),
      creator: authors.join(', ') || null,
      latestChapter: chapters[0]?.title,
      latestAt: chapters.map((c) => c.publishedAt).filter(Boolean).sort().at(-1),
      chapters,
    };
  }

  override async chaptersOnly(key: string): Promise<ChapterInfo[]> {
    const ulid = key.split('/')[0];
    const $c = cheerio.load(
      await this.html(`${this.baseUrl}/series/${ulid}/full-chapter-list`, {
        ttlMs: 0,
        delayMs: 250,
        headers: { 'HX-Request': 'true' },
      }),
    );
    const chapters: ChapterInfo[] = [];
    $c('a[href*="/chapters/"]').each((_, el) => {
      const $a = $c(el);
      const ck = /\/chapters\/([0-9A-Z]{26})/.exec($a.attr('href') ?? '')?.[1];
      const label = $a.find('span.grow > span').first().text().trim() || $a.text().trim().split('\n')[0].trim();
      const number = numberOf(label);
      if (!ck || number == null) return;
      chapters.push({ key: ck, number, title: label, publishedAt: toIso($a.find('time').first().attr('datetime')) });
    });
    if (!chapters.length) throw new HttpError('No chapters found — Weeb Central layout may have changed.', 'parse');
    return chapters;
  }

  async pages(_s: string, chapterKey: string): Promise<ChapterPages> {
    const html = await this.html(`${this.baseUrl}/chapters/${chapterKey}/images?is_prev=False&current_page=1&reading_style=long_strip`, { ttlMs: 0, headers: { 'HX-Request': 'true' } });
    const $ = cheerio.load(html);
    const images = $('img')
      .map((_, el) => absUrl($(el).attr('src'), this.baseUrl))
      .get()
      .filter((u) => u && !u.includes('/static/'));
    if (!images.length) throw new HttpError('No page images found — selectors may need updating.', 'parse');
    return { images };
  }

  seriesUrl(key: string) {
    return `${this.baseUrl}/series/${key}`;
  }
  chapterUrl(_s: string, chapterKey: string) {
    return `${this.baseUrl}/chapters/${chapterKey}`;
  }
}
