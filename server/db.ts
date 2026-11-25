import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');
export const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
export const IMG_DIR = path.join(DATA_DIR, 'img-cache');
fs.mkdirSync(IMG_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'manga.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
db.exec(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8'));

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
