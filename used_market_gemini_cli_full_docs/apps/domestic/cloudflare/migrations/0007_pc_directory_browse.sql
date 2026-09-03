CREATE INDEX IF NOT EXISTS idx_listings_pc_directory_browse
  ON listings (canonical_product_id, site, active, price_value, updated_at DESC);
