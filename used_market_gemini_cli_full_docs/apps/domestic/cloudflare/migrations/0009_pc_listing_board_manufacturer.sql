ALTER TABLE listings ADD COLUMN board_manufacturer TEXT;

UPDATE listings
SET board_manufacturer = canonical_manufacturer
WHERE pc_category_code = 'GPU'
  AND board_manufacturer IS NULL
  AND canonical_manufacturer IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_listings_pc_board_manufacturer
  ON listings (pc_category_code, board_manufacturer, site, active, updated_at DESC);
