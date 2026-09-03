ALTER TABLE listings ADD COLUMN canonical_product_id TEXT;
ALTER TABLE listings ADD COLUMN canonical_display_name TEXT;
ALTER TABLE listings ADD COLUMN listing_kind TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE listings ADD COLUMN pc_category_code TEXT;
ALTER TABLE listings ADD COLUMN quantity INTEGER;
ALTER TABLE listings ADD COLUMN price_scope TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE listings ADD COLUMN condition_code TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE listings ADD COLUMN lifecycle_status TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE listings ADD COLUMN market_pool TEXT;
ALTER TABLE listings ADD COLUMN confidence_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE listings ADD COLUMN evidence_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE listings ADD COLUMN price_eligible INTEGER NOT NULL DEFAULT 0 CHECK (price_eligible IN (0, 1));
ALTER TABLE listings ADD COLUMN exclusion_reasons_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE listings ADD COLUMN good_listing_eligible INTEGER NOT NULL DEFAULT 0 CHECK (good_listing_eligible IN (0, 1));
ALTER TABLE listings ADD COLUMN reference_price REAL;

CREATE INDEX IF NOT EXISTS idx_listings_pc_product
  ON listings (canonical_product_id, market_pool, condition_code, active, updated_at DESC);
