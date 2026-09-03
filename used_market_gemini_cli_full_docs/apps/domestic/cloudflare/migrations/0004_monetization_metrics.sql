CREATE TABLE IF NOT EXISTS monetization_daily_metrics (
  date_key TEXT NOT NULL,
  offer_id TEXT NOT NULL,
  slot TEXT NOT NULL CHECK (slot = 'after-organic-results'),
  context_type TEXT NOT NULL CHECK (context_type IN ('canonical_product', 'category')),
  context_key TEXT NOT NULL,
  impressions INTEGER NOT NULL DEFAULT 0 CHECK (impressions >= 0),
  clicks INTEGER NOT NULL DEFAULT 0 CHECK (clicks >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (date_key, offer_id, slot, context_type, context_key)
) STRICT;

CREATE TABLE IF NOT EXISTS monetization_event_dedup (
  token_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('impression', 'click')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (token_id, event_type)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_monetization_event_dedup_expiry
  ON monetization_event_dedup(expires_at);
