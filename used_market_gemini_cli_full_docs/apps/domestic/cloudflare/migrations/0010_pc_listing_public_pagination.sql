CREATE INDEX IF NOT EXISTS idx_listings_pc_public_recent
  ON listings (updated_at DESC, item_id ASC)
  WHERE active = 1
    AND lifecycle_status = 'ACTIVE'
    AND canonical_product_id IS NOT NULL
    AND price_value IS NOT NULL
    AND price_value > 0
    AND listing_kind IN ('SINGLE_COMPONENT', 'SAME_PRODUCT_LOT')
    AND price_eligible = 1
    AND condition_code = 'USED_WORKING'
    AND quantity IS NOT NULL
    AND quantity >= 1
    AND price_scope IN ('TOTAL', 'UNIT');

CREATE INDEX IF NOT EXISTS idx_listings_pc_public_site_recent
  ON listings (site, updated_at DESC, item_id ASC)
  WHERE active = 1
    AND lifecycle_status = 'ACTIVE'
    AND canonical_product_id IS NOT NULL
    AND price_value IS NOT NULL
    AND price_value > 0
    AND listing_kind IN ('SINGLE_COMPONENT', 'SAME_PRODUCT_LOT')
    AND price_eligible = 1
    AND condition_code = 'USED_WORKING'
    AND quantity IS NOT NULL
    AND quantity >= 1
    AND price_scope IN ('TOTAL', 'UNIT');
