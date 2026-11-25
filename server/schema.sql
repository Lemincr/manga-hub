-- Manga Hub schema (SQLite). Applied idempotently at startup by db.ts.

CREATE TABLE IF NOT EXISTS series (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id       TEXT    NOT NULL,              -- adapter id, e.g. 'asuraScans'
  series_key      TEXT    NOT NULL,              -- adapter-specific stable key (slug)
  title           TEXT    NOT NULL,
  aliases         TEXT    NOT NULL DEFAULT '[]', -- JSON array, user-editable
  source_aliases  TEXT    NOT NULL DEFAULT '[]', -- JSON array, scraped from the site
  cover           TEXT,
  description     TEXT,
  site_status     TEXT,                          -- ongoing / completed ... as reported by site
  in_library      INTEGER NOT NULL DEFAULT 0,    -- 0 = just previewed, 1 = bookmarked
  library_status  TEXT    NOT NULL DEFAULT 'plan', -- reading|plan|hold|completed|dropped
  last_read_number REAL   NOT NULL DEFAULT -1,   -- highest chapter number reached
  resume_chapter_id INTEGER,                     -- chapter to resume
  resume_scroll   REAL    NOT NULL DEFAULT 0,    -- image index (float) within resume chapter
  resume_done     INTEGER NOT NULL DEFAULT 0,    -- 1 once the end of resume chapter was reached
  last_read_at    TEXT,
  latest_number   REAL,
  latest_at       TEXT,                          -- ISO date of newest chapter
  last_checked_at TEXT,
  check_error     TEXT,
  added_at        TEXT    NOT NULL,
  UNIQUE (source_id, series_key)
);

CREATE TABLE IF NOT EXISTS chapters (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  series_id     INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  chapter_key   TEXT    NOT NULL,                -- adapter-specific chapter key
  number        REAL    NOT NULL,
  title         TEXT    NOT NULL,
  published_at  TEXT,
  locked        INTEGER NOT NULL DEFAULT 0,      -- premium / early-access flagged by site
  UNIQUE (series_id, chapter_key)
);
CREATE INDEX IF NOT EXISTS idx_chapters_series_number ON chapters(series_id, number);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL                            -- JSON encoded
);

-- HTTP / structured response cache (TTL based)
CREATE TABLE IF NOT EXISTS cache (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
