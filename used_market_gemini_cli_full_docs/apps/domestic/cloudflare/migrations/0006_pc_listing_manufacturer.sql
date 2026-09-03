ALTER TABLE listings ADD COLUMN canonical_manufacturer TEXT;

CREATE INDEX IF NOT EXISTS idx_listings_pc_facets
  ON listings (pc_category_code, canonical_manufacturer, site, active, updated_at DESC);
