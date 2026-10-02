-- A publication-only index also orders its entries by SQLite rowid. The wider
-- scope key index cannot seek rowid pages without sorting the entire publication.
CREATE INDEX IF NOT EXISTS idx_public_stats_publication_rows
  ON public_product_stats(publication_id);

-- The PRIMARY KEY already supplies this exact (publication_id, chunk_index)
-- index. Keeping both charges another index write for every unchanged key.
DROP INDEX IF EXISTS idx_public_stats_chunks_publication;
