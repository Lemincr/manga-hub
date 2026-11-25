import { all, get, run } from './db.js';

/** Every supported setting and its default. Source settings follow `source.<id>.<field>`. */
export const DEFAULTS: Record<string, string | number | boolean> = {
  requestDelayMs: 800, // minimum gap between requests to the same host
  cacheTtlMinutes: 30, // HTTP cache lifetime for listing/search pages
  pollMinutes: 0, // background "check for new chapters" interval, 0 = off
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',

  'source.asuraScans.enabled': true,
  'source.asuraScans.baseUrl': 'https://asurascans.com',
  'source.asuraScans.apiUrl': 'https://api.asurascans.com/api',

  'source.kingOfShojo.enabled': true,
  'source.kingOfShojo.baseUrl': 'https://kingofshojo.com',

  'source.manhuaUs.enabled': true,
  'source.manhuaUs.baseUrl': 'https://manhuaus.com',

  // Extra sources: only used for "All sources" unless this is switched off.
  'sources.extraInAllOnly': true,

  'source.mangaDex.enabled': true,
  'source.mangaDex.baseUrl': 'https://mangadex.org',
  'source.mangaDex.apiUrl': 'https://api.mangadex.org',

  'source.weebCentral.enabled': true,
  'source.weebCentral.baseUrl': 'https://weebcentral.com',

  'source.vortexScans.enabled': true,
  'source.vortexScans.baseUrl': 'https://vortexscans.org',
  'source.vortexScans.apiUrl': 'https://vortexscans.org/api',

  'source.demonicScans.enabled': true,
  'source.demonicScans.baseUrl': 'https://demonicscans.org',

  'source.mangaHere.enabled': true,
  'source.mangaHere.baseUrl': 'https://www.mangahere.cc',

  'source.mangakakalot.enabled': false,
  'source.mangakakalot.baseUrl': 'https://www.mangakakalot.gg',

  'source.batoTo.enabled': false,
  'source.batoTo.baseUrl': 'https://bato.to',

  'source.reaperScans.enabled': false,
  'source.reaperScans.baseUrl': 'https://reaperscans.com',
  'source.reaperScans.apiUrl': 'https://api.reaperscans.com',
};

export function getSetting<T extends string | number | boolean = any>(key: string): T {
  const row = get('SELECT value FROM settings WHERE key = ?', key);
  if (row) {
    try {
      return JSON.parse(row.value);
    } catch {
      /* fall through to default */
    }
  }
  return DEFAULTS[key] as T;
}

export function getAllSettings(): Record<string, any> {
  const out: Record<string, any> = { ...DEFAULTS };
  for (const r of all('SELECT key, value FROM settings')) {
    if (r.key in DEFAULTS) {
      try {
        out[r.key] = JSON.parse(r.value);
      } catch {
        /* ignore */
      }
    }
  }
  return out;
}

export function setSettings(values: Record<string, any>) {
  for (const [k, v] of Object.entries(values)) {
    if (!(k in DEFAULTS)) continue;
    if (typeof v !== typeof DEFAULTS[k]) continue;
    run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, JSON.stringify(v));
  }
}
