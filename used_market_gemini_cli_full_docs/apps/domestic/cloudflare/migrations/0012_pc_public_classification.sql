ALTER TABLE listings ADD COLUMN market_segment TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE listings ADD COLUMN listing_type TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE listings ADD COLUMN condition_group TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE listings ADD COLUMN spec_group_id TEXT;
ALTER TABLE listings ADD COLUMN classification_confidence REAL NOT NULL DEFAULT 0;
ALTER TABLE listings ADD COLUMN model_confidence REAL NOT NULL DEFAULT 0;
ALTER TABLE listings ADD COLUMN quantity_confidence REAL NOT NULL DEFAULT 0;
ALTER TABLE listings ADD COLUMN price_scope_confidence REAL NOT NULL DEFAULT 0;
ALTER TABLE listings ADD COLUMN statistics_eligible INTEGER NOT NULL DEFAULT 0 CHECK (statistics_eligible IN (0, 1));
ALTER TABLE listings ADD COLUMN statistics_exclusion_reasons_json TEXT NOT NULL DEFAULT '[]';

CREATE INDEX IF NOT EXISTS idx_listings_pc_public_classification
  ON listings (pc_category_code, market_segment, listing_type, condition_group, statistics_eligible, updated_at DESC);
