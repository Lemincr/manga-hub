import type { BaseSource } from './baseSource.js';
import { AsuraScans } from './asuraScans.js';
import { KingOfShojo } from './kingOfShojo.js';
import { ManhuaUs } from './manhuaUs.js';
import { MangaDex } from './mangaDex.js';
import { WeebCentral } from './weebCentral.js';
import { VortexScans } from './vortexScans.js';
import { DemonicScans } from './demonicScans.js';
import { MangaHere } from './mangaHere.js';
import { Mangakakalot } from './mangakakalot.js';
import { BatoTo } from './batoTo.js';
import { ReaperScans } from './reaperScans.js';

/**
 * Order = priority (Asura first). Register new adapters here.
 * tier 'primary' → own filter pill; tier 'extra' → only reachable through "All sources"
 * (unless Settings → "Extra sources only in All" is switched off).
 *
 * BatoTo, ReaperScans, and Mangakakalot are registered and configurable in Settings,
 * with `enabled: false` by default because bato.to and reaperscans.com have shut down
 * and mangakakalot.gg search/series subpaths are behind a Cloudflare challenge.
 */
export const sources: BaseSource[] = [
  new AsuraScans(),
  new KingOfShojo(),
  new ManhuaUs(),
  new MangaDex(),
  new WeebCentral(),
  new VortexScans(),
  new DemonicScans(),
  new MangaHere(),
  new Mangakakalot(),
  new BatoTo(),
  new ReaperScans(),
];

export const getSource = (id: string): BaseSource => {
  const s = sources.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown source "${id}"`);
  return s;
};
