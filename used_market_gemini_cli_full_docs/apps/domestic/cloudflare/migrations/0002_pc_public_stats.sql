CREATE TABLE IF NOT EXISTS public_stats_publications (
  publication_id TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  expected_row_count INTEGER NOT NULL CHECK (expected_row_count > 0),
  expected_non_empty_scope_count INTEGER NOT NULL CHECK (expected_non_empty_scope_count > 0),
  parser_version TEXT NOT NULL,
  rule_version TEXT NOT NULL,
  filter_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  activated_at TEXT,
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1))
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_public_stats_one_active
  ON public_stats_publications(active) WHERE active = 1;

CREATE TABLE IF NOT EXISTS public_product_stats (
  publication_id TEXT NOT NULL REFERENCES public_stats_publications(publication_id) ON DELETE CASCADE,
  canonical_product_id TEXT NOT NULL,
  market_pool TEXT NOT NULL,
  condition_code TEXT NOT NULL,
  currency TEXT NOT NULL,
  days INTEGER NOT NULL CHECK (days = 30),
  stats_json TEXT NOT NULL,
  as_of TEXT NOT NULL,
  PRIMARY KEY (publication_id, canonical_product_id, market_pool, condition_code, currency, days),
  UNIQUE (publication_id, canonical_product_id, market_pool, condition_code, currency, days)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_public_product_stats_lookup
  ON public_product_stats(canonical_product_id, market_pool, condition_code, currency, days, publication_id);
