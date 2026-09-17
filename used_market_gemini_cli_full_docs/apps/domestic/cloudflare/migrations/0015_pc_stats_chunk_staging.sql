CREATE TABLE IF NOT EXISTS public_stats_publication_chunks (
  publication_id TEXT NOT NULL REFERENCES public_stats_publications(publication_id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  expected_chunk_count INTEGER NOT NULL CHECK (expected_chunk_count > 0),
  chunk_checksum TEXT NOT NULL,
  row_count INTEGER NOT NULL CHECK (row_count > 0),
  non_empty_scope_count INTEGER NOT NULL CHECK (non_empty_scope_count >= 0),
  first_scope_key TEXT NOT NULL,
  last_scope_key TEXT NOT NULL,
  staged_at TEXT NOT NULL,
  PRIMARY KEY (publication_id, chunk_index)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_public_stats_chunks_publication
  ON public_stats_publication_chunks(publication_id, chunk_index);
