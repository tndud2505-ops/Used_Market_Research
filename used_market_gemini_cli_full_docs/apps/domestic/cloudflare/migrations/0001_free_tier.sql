CREATE TABLE IF NOT EXISTS listings (
  item_id TEXT PRIMARY KEY,
  site TEXT NOT NULL,
  category_id TEXT NOT NULL,
  title TEXT NOT NULL,
  search_text TEXT NOT NULL,
  price_value REAL,
  currency TEXT NOT NULL DEFAULT 'KRW',
  url TEXT NOT NULL,
  image_url TEXT,
  seller_name TEXT,
  posted_at TEXT,
  updated_at TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
) STRICT;

CREATE INDEX IF NOT EXISTS idx_listings_search
  ON listings (active, category_id, site, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_listings_updated
  ON listings (active, updated_at DESC);

CREATE TABLE IF NOT EXISTS collection_runs (
  run_id TEXT PRIMARY KEY,
  site TEXT NOT NULL,
  category_id TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  browser_seconds REAL NOT NULL DEFAULT 0,
  items_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT
) STRICT;

CREATE INDEX IF NOT EXISTS idx_collection_runs_recent
  ON collection_runs (site, category_id, started_at DESC);

CREATE TABLE IF NOT EXISTS free_tier_usage (
  date_key TEXT PRIMARY KEY,
  browser_seconds REAL NOT NULL DEFAULT 0,
  queue_operations INTEGER NOT NULL DEFAULT 0,
  d1_rows_written INTEGER NOT NULL DEFAULT 0,
  collection_runs INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
) STRICT;
