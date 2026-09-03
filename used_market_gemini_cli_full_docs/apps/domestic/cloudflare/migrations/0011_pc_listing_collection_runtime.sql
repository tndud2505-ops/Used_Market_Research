CREATE TABLE IF NOT EXISTS pc_listing_collection_manifests (
  source_id TEXT NOT NULL,
  as_of TEXT NOT NULL,
  manifest_version TEXT NOT NULL,
  successful_target_ids_json TEXT NOT NULL DEFAULT '[]',
  successful_target_count INTEGER NOT NULL DEFAULT 0,
  mirrored_at TEXT NOT NULL,
  PRIMARY KEY (source_id, as_of)
);

CREATE INDEX IF NOT EXISTS idx_pc_listing_collection_manifests_as_of
  ON pc_listing_collection_manifests(as_of DESC, source_id);

CREATE TABLE IF NOT EXISTS pc_listing_collection_target_runtime (
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  last_succeeded_at TEXT NOT NULL,
  manifest_version TEXT NOT NULL,
  mirrored_at TEXT NOT NULL,
  PRIMARY KEY (source_id, target_id, last_succeeded_at),
  FOREIGN KEY (source_id, last_succeeded_at)
    REFERENCES pc_listing_collection_manifests(source_id, as_of)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pc_listing_collection_target_latest
  ON pc_listing_collection_target_runtime(source_id, target_id, last_succeeded_at DESC);
