CREATE TABLE IF NOT EXISTS search_response_cache (
  cache_key TEXT PRIMARY KEY,
  country TEXT NOT NULL CHECK (country IN ('jp', 'us')),
  sites_json TEXT NOT NULL,
  request_json TEXT NOT NULL,
  response_json TEXT NOT NULL,
  stored_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_global_search_cache_expiry
  ON search_response_cache (country, expires_at);

CREATE TABLE IF NOT EXISTS api_response_cache (
  cache_key TEXT PRIMARY KEY,
  response_json TEXT NOT NULL,
  stored_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_global_api_cache_expiry
  ON api_response_cache (expires_at);

CREATE TABLE IF NOT EXISTS global_release_state (
  state_key TEXT PRIMARY KEY,
  state_value TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
