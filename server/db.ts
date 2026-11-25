import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');
export const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
export const IMG_DIR = path.join(DATA_DIR, 'img-cache');
fs.mkdirSync(IMG_DIR, { recursive: true });

const EMBEDDED_SCHEMA = `
CREATE TABLE IF NOT EXISTS series (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id         TEXT    NOT NULL,
  series_key        TEXT    NOT NULL,
  title             TEXT    NOT NULL,
  aliases           TEXT    NOT NULL DEFAULT '[]',
  source_aliases    TEXT    NOT NULL DEFAULT '[]',
  cover             TEXT,
  description       TEXT,
  site_status       TEXT,
  in_library        INTEGER NOT NULL DEFAULT 0,
  library_status    TEXT    NOT NULL DEFAULT 'plan',
  last_read_number  REAL    NOT NULL DEFAULT -1,
  resume_chapter_id INTEGER,
  resume_scroll     REAL    NOT NULL DEFAULT 0,
  resume_done       INTEGER NOT NULL DEFAULT 0,
  last_read_at      TEXT,
  latest_number     REAL,
  latest_at         TEXT,
  last_checked_at   TEXT,
  check_error       TEXT,
  added_at          TEXT    NOT NULL,
  UNIQUE (source_id, series_key)
);

CREATE TABLE IF NOT EXISTS chapters (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  series_id     INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  chapter_key   TEXT    NOT NULL,
  number        REAL    NOT NULL,
  title         TEXT    NOT NULL,
  published_at  TEXT,
  locked        INTEGER NOT NULL DEFAULT 0,
  UNIQUE (series_id, chapter_key)
);
CREATE INDEX IF NOT EXISTS idx_chapters_series_number ON chapters(series_id, number);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cache (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
`;

const schemaPath = [path.join(here, 'schema.sql'), path.join(ROOT, 'server', 'schema.sql')].find((p) =>
  fs.existsSync(p),
);
const schemaSql = schemaPath ? fs.readFileSync(schemaPath, 'utf8') : EMBEDDED_SCHEMA;

export const db = new DatabaseSync(path.join(DATA_DIR, 'manga.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
db.exec(schemaSql);

// Idempotent column migrations for existing databases
for (const col of [
  "ALTER TABLE series ADD COLUMN media_type TEXT",
  "ALTER TABLE series ADD COLUMN genres TEXT NOT NULL DEFAULT '[]'",
  "ALTER TABLE series ADD COLUMN creator TEXT",
  "ALTER TABLE series ADD COLUMN rating REAL",
  "ALTER TABLE chapters ADD COLUMN discovered_at TEXT",
]) {
  try {
    db.exec(col);
  } catch {
    /* column already exists */
  }
}

/** Run fn inside a transaction. */
export function tx<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export const all = (sql: string, ...p: any[]) => db.prepare(sql).all(...p) as any[];
export const get = (sql: string, ...p: any[]) => db.prepare(sql).get(...p) as any;
export const run = (sql: string, ...p: any[]) => db.prepare(sql).run(...p);
