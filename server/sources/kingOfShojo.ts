import { MangaStreamSource } from './mangaStreamSource.js';

/**
 * King of Shojo — MangaStream theme. Defaults in MangaStreamSource work as of this writing
 * (verified: `.bsx` cards, `#chapterlist li[data-num]`, `ts_reader.run(...)` page list).
 * Override `sel` entries below if the site tweaks its markup.
 */
export class KingOfShojo extends MangaStreamSource {
  readonly id = 'kingOfShojo';
  readonly name = 'King of Shojo';
  constructor() {
    super();
    // this.sel.card = '.bsx';
    // this.latestPath = (p) => `/manga/?page=${p}&order=update`;
  }
}
