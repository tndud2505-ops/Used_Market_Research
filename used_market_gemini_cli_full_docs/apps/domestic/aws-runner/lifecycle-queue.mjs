import { createHash } from 'node:crypto';
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
  db.exec(`CREATE TABLE IF NOT EXISTS pc_bunjang_search_windows (
    scope_key TEXT PRIMARY KEY, observed_at TEXT NOT NULL, rows_json TEXT NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS pc_bunjang_missing_candidates (
    source_listing_id TEXT PRIMARY KEY, scope_key TEXT NOT NULL, missing_at TEXT NOT NULL,
    expires_at TEXT NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS pc_danawa_query_windows (
    query_key TEXT PRIMARY KEY, observed_at TEXT NOT NULL, ids_json TEXT NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS pc_danawa_missing_candidates (
    source_listing_id TEXT PRIMARY KEY, query_key TEXT NOT NULL, missing_at TEXT NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS pc_lifecycle_queue (
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

// A candidate is never evidence of a sale. Until a later confirmation it hides
// the listing from current PC listings; expires_at only bounds detail requests.
// Exact query/page plan and a strictly interior latest-sort timestamp exclude
// products merely pushed past the fetched page boundary by newer listings.
const BUNJANG_MISSING_RETENTION_MS = 7 * 86400000;
export function recordBunjangSearchWindows(db, { windows = [], observations = [], now = Date.now(), observedAfter = now - 7200000 } = {}) {
  const receipt = { windows: windows.length, accepted_windows: 0, compared_windows: 0,
    rejected_windows: 0, disappeared_in_range: 0, added: 0, reappeared: 0, candidates: 0,
    complete_windows: 0, empty_after_results: 0, rejected_reasons: {}, search_status_counts: {} };
  const reject = reason => { receipt.rejected_windows++; receipt.rejected_reasons[reason] = (receipt.rejected_reasons[reason] || 0) + 1; };
  const seen = new Set();
  for (const observation of observations) {
    const item = observation?.item, at = Date.parse(observation?.observed_at);
    const id = String(item?.source_listing_id || '');
    if (item?.site === 'bunjang' && /^\d+$/.test(id)
      && item.url === `https://m.bunjang.co.kr/products/${id}`
      && at >= observedAfter && at <= now && now - at <= 7200000) {
      seen.add(id);
      if (['ACTIVE','RESERVED','SOLD','DELETED'].includes(item.status))
        receipt.search_status_counts[item.status] = (receipt.search_status_counts[item.status] || 0) + 1;
    }
  }
  const selected = new Map();
  for (const window of windows) {
    const at = Date.parse(window?.observed_at), rows = window?.rows;
    // A complete window reached the end of the query's results (no next page),
    // so even zero or one row is a full answer; a partial one needs a floor.
    const complete = window?.complete === true;
    const reason = typeof window?.scope !== 'string' || window.scope.length > 2000 ? 'scope'
      : !(at >= observedAfter && at <= now && now - at <= 7200000) ? 'time'
        : !Array.isArray(rows) || rows.length > 120 || rows.length < (complete ? 0 : 2) ? 'size'
          : new Set(rows.map(r => r?.id)).size !== rows.length ? 'duplicate'
            : !rows.every((r, i) => /^\d+$/.test(r?.id) && Number.isFinite(Date.parse(r.updated_at))
              && Date.parse(r.updated_at) <= at
              && (!i || Date.parse(rows[i-1].updated_at) >= Date.parse(r.updated_at))) ? 'row' : null;
    if (reason) { reject(reason); continue; }
    const key = createHash('sha256').update(window.scope).digest('hex');
    const previous = selected.get(key);
    if (!previous || at > Date.parse(previous.observed_at)) selected.set(key, window);
    else if (at === Date.parse(previous.observed_at) && JSON.stringify(rows) !== JSON.stringify(previous.rows)) previous.conflict = true;
    rows.forEach(r => seen.add(r.id));
  }
  // Older ledger rows use the canonical product URL as their source ID.
  const lookup = db.prepare(`SELECT last_checked_at,lifecycle_status FROM pc_lifecycle_queue WHERE source_id='bunjang'
    AND source_listing_id IN (?, 'bunjang:https://m.bunjang.co.kr/products/' || ?) ORDER BY last_checked_at DESC LIMIT 1`);
  const remove = db.prepare('DELETE FROM pc_bunjang_missing_candidates WHERE source_listing_id=?');
  const read = db.prepare('SELECT * FROM pc_bunjang_search_windows WHERE scope_key=?');
  const save = db.prepare(`INSERT INTO pc_bunjang_search_windows VALUES (?,?,?)
    ON CONFLICT(scope_key) DO UPDATE SET observed_at=excluded.observed_at,rows_json=excluded.rows_json`);
  const add = db.prepare(`INSERT INTO pc_bunjang_missing_candidates VALUES (?,?,?,?)
    ON CONFLICT(source_listing_id) DO UPDATE SET scope_key=excluded.scope_key,missing_at=excluded.missing_at,expires_at=excluded.expires_at
    WHERE excluded.missing_at > pc_bunjang_missing_candidates.missing_at`);
  db.exec('SAVEPOINT bunjang_search_compare');
  try {
    // Beyond seven days the existing unconfirmed-listing visibility rule applies.
    db.prepare('DELETE FROM pc_bunjang_missing_candidates WHERE missing_at<=?').run(new Date(now-BUNJANG_MISSING_RETENTION_MS).toISOString());
    // One latest window per scope, retained across daily rotation and source cooldowns.
    db.prepare('DELETE FROM pc_bunjang_search_windows WHERE observed_at<?').run(new Date(now-7*86400000).toISOString());
    for (const id of seen) receipt.reappeared += Number(remove.run(id).changes);
    const compare = (key, window, prior) => {
      receipt.accepted_windows++;
      if (window.complete === true) receipt.complete_windows++;
      if (prior) {
        receipt.compared_windows++;
        // Only an incomplete window can push older products past its last page.
        const floor = window.complete === true ? -Infinity : Date.parse(window.rows.at(-1).updated_at);
        for (const old of JSON.parse(prior.rows_json)) {
          if (seen.has(old.id) || Date.parse(old.updated_at) <= floor) continue;
          receipt.disappeared_in_range++;
          const q = lookup.get(old.id, old.id);
          if (!q || !['ACTIVE','RESERVED','UNAVAILABLE_UNKNOWN'].includes(q.lifecycle_status)
            || q.last_checked_at >= window.observed_at) continue;
          receipt.added += Number(add.run(old.id, key, window.observed_at,
            new Date(Date.parse(window.observed_at)+86400000).toISOString()).changes);
        }
      }
      save.run(key, window.observed_at, JSON.stringify(window.rows));
    };
    const emptyAfterResults = [];
    let nonEmptyCompared = 0;
    for (const [key, window] of selected) {
      if (window.conflict) { reject('conflict'); continue; }
      const prior = read.get(key);
      if (prior && prior.observed_at >= window.observed_at) continue;
      if (!window.rows.length && prior && JSON.parse(prior.rows_json).length) { emptyAfterResults.push([key, window, prior]); continue; }
      // Only scopes that still return rows show the source is answering normally.
      if (prior && window.rows.length) nonEmptyCompared++;
      compare(key, window, prior);
    }
    // A query emptying out is normal for one sold model, not for most queries
    // at once; treat a burst as a source anomaly and keep the prior windows.
    receipt.empty_after_results = emptyAfterResults.length;
    if (emptyAfterResults.length > Math.max(5, nonEmptyCompared)) emptyAfterResults.forEach(() => reject('empty_anomaly'));
    else for (const [key, window, prior] of emptyAfterResults) compare(key, window, prior);
    receipt.candidates = Number(db.prepare(`SELECT count(DISTINCT c.source_listing_id) n FROM pc_bunjang_missing_candidates c
      JOIN pc_lifecycle_queue q ON q.source_id='bunjang'
        AND q.source_listing_id IN (c.source_listing_id, 'bunjang:https://m.bunjang.co.kr/products/' || c.source_listing_id)
      WHERE q.last_checked_at<c.missing_at AND q.lifecycle_status IN ('ACTIVE','RESERVED','UNAVAILABLE_UNKNOWN')`).get().n);
    receipt.hidden_missing = Number(db.prepare('SELECT count(*) n FROM pc_bunjang_missing_candidates').get().n);
    db.exec('RELEASE bunjang_search_compare');
    return receipt;
  } catch (error) { db.exec('ROLLBACK TO bunjang_search_compare; RELEASE bunjang_search_compare'); throw error; }
}

// Danawa model searches return one result page. When a re-run of the same
// query shows clearly fewer cards than a page holds, an offer it returned
// before and no longer returns has left the result. Hide it from current
// listings until a later observation; status, prices and history are unchanged.
export const DANAWA_COMPLETE_CARD_LIMIT = 20;
const DANAWA_WINDOW_RETENTION_MS = 45 * 86400000;
export function recordDanawaQueryWindows(db, { windows = [], seenIds = [], now = Date.now(), observedAfter = now - 7200000 } = {}) {
  const receipt = { windows: windows.length, accepted_windows: 0, compared_windows: 0, incomplete_windows: 0,
    rejected_windows: 0, empty_after_results: 0, added: 0, reappeared: 0, hidden_missing: 0, rejected_reasons: {}, card_counts: [] };
  const reject = reason => { receipt.rejected_windows++; receipt.rejected_reasons[reason] = (receipt.rejected_reasons[reason] || 0) + 1; };
  const accepted = new Map();
  for (const window of windows) {
    const at = Date.parse(window?.observed_at), ids = window?.ids;
    const reason = typeof window?.query !== 'string' || !window.query.trim() || window.query.length > 300 ? 'query'
      : !(at >= observedAfter && at <= now) ? 'time'
        : !Number.isInteger(window?.card_count) || window.card_count < 0 ? 'card_count'
          : !Array.isArray(ids) || ids.length > 200 || !ids.every(id => /^search_[0-9a-f]{24}$/u.test(id)) ? 'ids' : null;
    if (reason) { reject(reason); continue; }
    const key = window.query.trim();
    if (accepted.has(key)) { reject('duplicate'); accepted.delete(key); continue; }
    accepted.set(key, { ...window, ids: [...new Set(ids)] });
  }
  const read = db.prepare('SELECT * FROM pc_danawa_query_windows WHERE query_key=?');
  const save = db.prepare(`INSERT INTO pc_danawa_query_windows VALUES (?,?,?)
    ON CONFLICT(query_key) DO UPDATE SET observed_at=excluded.observed_at,ids_json=excluded.ids_json`);
  const add = db.prepare(`INSERT INTO pc_danawa_missing_candidates VALUES (?,?,?)
    ON CONFLICT(source_listing_id) DO UPDATE SET query_key=excluded.query_key,missing_at=excluded.missing_at
    WHERE excluded.missing_at > pc_danawa_missing_candidates.missing_at`);
  const remove = db.prepare('DELETE FROM pc_danawa_missing_candidates WHERE source_listing_id=?');
  db.exec('SAVEPOINT danawa_query_compare');
  try {
    const cutoff = new Date(now - DANAWA_WINDOW_RETENTION_MS).toISOString();
    db.prepare('DELETE FROM pc_danawa_query_windows WHERE observed_at<?').run(cutoff);
    db.prepare('DELETE FROM pc_danawa_missing_candidates WHERE missing_at<?').run(cutoff);
    // An offer any query of this run returned is current, whatever another query lost.
    const seen = new Set([...accepted.values()].flatMap(window => window.ids));
    for (const id of Array.isArray(seenIds) ? seenIds : []) if (/^search_[0-9a-f]{24}$/u.test(id)) seen.add(id);
    for (const id of seen) receipt.reappeared += Number(remove.run(id).changes);
    const compare = (key, window, prior) => {
      receipt.accepted_windows++;
      if (receipt.card_counts.length < 40) receipt.card_counts.push(window.card_count);
      if (prior && window.card_count <= DANAWA_COMPLETE_CARD_LIMIT) {
        receipt.compared_windows++;
        for (const id of JSON.parse(prior.ids_json)) {
          if (!seen.has(id)) receipt.added += Number(add.run(id, key, window.observed_at).changes);
        }
      } else if (prior) receipt.incomplete_windows++;
      save.run(key, window.observed_at, JSON.stringify(window.ids));
    };
    const emptied = [];
    let nonEmptyCompared = 0;
    for (const [key, window] of accepted) {
      if (window.model !== true) continue;
      const prior = read.get(key);
      if (prior && prior.observed_at >= window.observed_at) continue;
      if (!window.ids.length && prior && JSON.parse(prior.ids_json).length) { emptied.push([key, window, prior]); continue; }
      if (prior && window.ids.length) nonEmptyCompared++;
      compare(key, window, prior);
    }
    // One model selling out is normal; many queries emptying at once is a site anomaly.
    receipt.empty_after_results = emptied.length;
    if (emptied.length > Math.max(3, nonEmptyCompared)) emptied.forEach(() => reject('empty_anomaly'));
    else for (const [key, window, prior] of emptied) compare(key, window, prior);
    receipt.hidden_missing = Number(db.prepare('SELECT count(*) n FROM pc_danawa_missing_candidates').get().n);
    db.exec('RELEASE danawa_query_compare');
    return receipt;
  } catch (error) { db.exec('ROLLBACK TO danawa_query_compare; RELEASE danawa_query_compare'); throw error; }
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
