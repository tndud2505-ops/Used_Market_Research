CREATE TABLE IF NOT EXISTS monetization_event_dedup (
  token_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('impression', 'click')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (token_id, event_type)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_monetization_event_dedup_expiry
  ON monetization_event_dedup(expires_at);
