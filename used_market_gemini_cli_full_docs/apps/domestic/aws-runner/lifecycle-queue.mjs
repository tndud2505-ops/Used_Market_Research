// Rebuildable current-state index. Immutable observation/price history is never changed.
const UPSERT = `INSERT INTO pc_lifecycle_queue(source_id,source_listing_id,snapshot_id,observed_at,
  raw_listing_id,lifecycle_status,last_checked_at,missing_check_count)
  SELECT s.source_id,s.source_listing_id,s.id,s.observed_at,s.raw_listing_id,s.lifecycle_status,
    r.last_checked_at,r.missing_check_count FROM listing_snapshots s JOIN raw_listings r ON r.id=s.raw_listing_id
  WHERE s.id = ?
  ON CONFLICT(source_id,source_listing_id) DO UPDATE SET snapshot_id=excluded.snapshot_id,
    observed_at=excluded.observed_at,raw_listing_id=excluded.raw_listing_id,lifecycle_status=excluded.lifecycle_status,
    last_checked_at=excluded.last_checked_at,missing_check_count=excluded.missing_check_count,
    next_attempt_at=excluded.last_checked_at
  WHERE (excluded.observed_at,excluded.snapshot_id) > (pc_lifecycle_queue.observed_at,pc_lifecycle_queue.snapshot_id)`;

export function migrateLifecycleQueue(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS pc_lifecycle_queue (
    source_id TEXT NOT NULL, source_listing_id TEXT NOT NULL, snapshot_id INTEGER NOT NULL,
    observed_at TEXT NOT NULL, raw_listing_id INTEGER NOT NULL, lifecycle_status TEXT NOT NULL,
    last_checked_at TEXT NOT NULL, missing_check_count INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT NOT NULL DEFAULT '', last_attempt_at TEXT, last_outcome TEXT,
    PRIMARY KEY(source_id,source_listing_id)) STRICT;
    CREATE INDEX IF NOT EXISTS idx_lifecycle_due ON pc_lifecycle_queue(source_id,lifecycle_status,last_checked_at,next_attempt_at);
    CREATE INDEX IF NOT EXISTS idx_lifecycle_raw ON pc_lifecycle_queue(raw_listing_id);
    CREATE INDEX IF NOT EXISTS idx_lifecycle_snapshot ON pc_lifecycle_queue(snapshot_id);
    CREATE TABLE IF NOT EXISTS pc_lifecycle_bootstrap (
      id INTEGER PRIMARY KEY CHECK(id=1), source_cursor TEXT NOT NULL DEFAULT '',
      listing_cursor TEXT NOT NULL DEFAULT '', source_end TEXT NOT NULL DEFAULT '', listing_end TEXT NOT NULL DEFAULT '',
      ready INTEGER NOT NULL DEFAULT 0) STRICT;
    INSERT OR IGNORE INTO pc_lifecycle_bootstrap(id,source_end,listing_end,ready)
      SELECT 1,COALESCE((SELECT source_id FROM listing_snapshots ORDER BY source_id DESC,source_listing_id DESC LIMIT 1),''),
        COALESCE((SELECT source_listing_id FROM listing_snapshots ORDER BY source_id DESC,source_listing_id DESC LIMIT 1),''),
        NOT EXISTS(SELECT 1 FROM listing_snapshots LIMIT 1);
    CREATE TABLE IF NOT EXISTS pc_lifecycle_runs (
      source_id TEXT PRIMARY KEY, backoff_until TEXT, receipt_json TEXT NOT NULL DEFAULT '{}') STRICT;
    CREATE TRIGGER IF NOT EXISTS pc_lifecycle_snapshot_insert AFTER INSERT ON listing_snapshots BEGIN
      ${UPSERT.replace('WHERE s.id = ?', 'WHERE s.id = NEW.id')};
    END;
    CREATE TRIGGER IF NOT EXISTS pc_lifecycle_raw_check AFTER UPDATE OF last_checked_at,missing_check_count ON raw_listings BEGIN
      UPDATE pc_lifecycle_queue SET last_checked_at=NEW.last_checked_at,missing_check_count=NEW.missing_check_count,
        next_attempt_at=NEW.last_checked_at
      WHERE raw_listing_id=NEW.id;
    END;
    CREATE TRIGGER IF NOT EXISTS pc_lifecycle_snapshot_delete AFTER DELETE ON listing_snapshots
      WHEN EXISTS(SELECT 1 FROM pc_lifecycle_queue WHERE snapshot_id=OLD.id) BEGIN
      DELETE FROM pc_lifecycle_queue WHERE snapshot_id=OLD.id;
      ${UPSERT.replace('WHERE s.id = ?', `WHERE s.id = (SELECT id FROM listing_snapshots
        WHERE source_id=OLD.source_id AND source_listing_id=OLD.source_listing_id ORDER BY observed_at DESC,id DESC LIMIT 1)`)};
    END;`);
}

export function lifecycleQueueReady(db) {
  return db.prepare('SELECT ready FROM pc_lifecycle_bootstrap WHERE id=1').get()?.ready === 1;
}

// Restart-safe, bounded identity pages; no full-history scan or full DB copy at startup.
export function bootstrapLifecycleQueue(db, limit = 200) {
  const state = db.prepare('SELECT * FROM pc_lifecycle_bootstrap WHERE id=1').get();
  if (state.ready) return { ready: true, processed: 0 };
  db.exec('BEGIN IMMEDIATE');
  try {
    const rows = db.prepare(`SELECT DISTINCT source_id,source_listing_id FROM listing_snapshots
      WHERE (source_id,source_listing_id) > (?,?) AND (source_id,source_listing_id) <= (?,?)
      ORDER BY source_id,source_listing_id LIMIT ?`)
      .all(state.source_cursor,state.listing_cursor,state.source_end,state.listing_end,Math.min(500,Math.max(1,limit)));
    const latest = db.prepare(`SELECT id FROM listing_snapshots WHERE source_id=? AND source_listing_id=?
      ORDER BY observed_at DESC,id DESC LIMIT 1`);
    const upsert = db.prepare(UPSERT);
    for (const row of rows) upsert.run(latest.get(row.source_id,row.source_listing_id).id);
    const last = rows.at(-1);
    if (last) db.prepare('UPDATE pc_lifecycle_bootstrap SET source_cursor=?,listing_cursor=? WHERE id=1')
      .run(last.source_id,last.source_listing_id);
    else db.exec('UPDATE pc_lifecycle_bootstrap SET ready=1 WHERE id=1');
    db.exec('COMMIT');
    return { ready: !last, processed: rows.length };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function deferLifecycleAttempt(db, sourceId, listingId, { at = new Date().toISOString(), outcome = 'ATTEMPTING', delayMs = 3600000 } = {}) {
  db.prepare(`UPDATE pc_lifecycle_queue SET last_attempt_at=?,last_outcome=?,next_attempt_at=?
    WHERE source_id=? AND source_listing_id=?`).run(at,outcome,new Date(Date.parse(at)+delayMs).toISOString(),sourceId,listingId);
}

export function recordLifecycleRun(db, sourceId, receipt, backoffUntil = null) {
  db.prepare(`INSERT INTO pc_lifecycle_runs(source_id,backoff_until,receipt_json) VALUES (?,?,?)
    ON CONFLICT(source_id) DO UPDATE SET backoff_until=excluded.backoff_until,receipt_json=excluded.receipt_json`)
    .run(sourceId,backoffUntil,JSON.stringify(receipt));
}
