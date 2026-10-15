import { getStatsJson, readActiveStatsScopes } from './pc-stats-publication-client.mjs';
import { verifyStoredStatsOnAws } from './pc-stats-readback.mjs';

const samePointer = (left, right) => left?.publication_id === right?.publication_id && left?.checksum === right?.checksum;

function assertLocalRecovery(db, intent) {
  const runtime = db.prepare("SELECT * FROM pc_publication_runtime WHERE publication_kind = 'PRODUCT_STATS'").get();
  const local = db.prepare('SELECT * FROM pc_stored_price_publications WHERE publication_id = ?').get(intent.publication_id);
  const count = db.prepare('SELECT COUNT(*) AS n FROM pc_stored_price_publication_rows WHERE publication_id = ?').get(intent.publication_id).n;
  if ((runtime && !samePointer(runtime, intent) && !samePointer(runtime, intent.expected_previous_publication))
    || (samePointer(runtime, intent) && runtime.row_count !== intent.expected_row_count)
    || local?.checksum !== intent.local_checksum || local.row_count !== intent.expected_row_count || count !== intent.expected_row_count)
    throw new Error('PUBLICATION_RECOVERY_AWS_MISMATCH');
}

// The owning Runner applies a fully verified proof, atomically exposing the
// prepared local response and recording its D1 receipt. Safe to repeat after a crash.
export function completeReconciledPublication(db, intent, proof) {
  if (proof?.verified !== true || proof.outcome !== 'published' || !samePointer(proof, intent)
    || !Number.isFinite(Date.parse(proof.published_at))) throw new Error('PUBLICATION_RECOVERY_PROOF_REQUIRED');
  db.exec('BEGIN IMMEDIATE');
  try {
    assertLocalRecovery(db, intent);
    db.prepare('UPDATE pc_stored_price_publications SET completed = 1, published_at = ? WHERE publication_id = ?').run(proof.published_at, intent.publication_id);
    db.prepare(`INSERT INTO pc_publication_runtime(publication_kind, publication_id, checksum, row_count, published_at)
      VALUES ('PRODUCT_STATS', ?, ?, ?, ?) ON CONFLICT(publication_kind) DO UPDATE SET
      publication_id = excluded.publication_id, checksum = excluded.checksum,
      row_count = excluded.row_count, published_at = excluded.published_at`).run(intent.publication_id, intent.checksum, intent.expected_row_count, proof.published_at);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

// Read-only reconciliation. Only the Runner owning the durable queue may apply
// the returned proof; neither staged rows nor the active pointer are changed.
export async function reconcilePublication({ intent, db, importUrl, token,
  readActive = readActiveStatsScopes, readJson = getStatsJson, verify = verifyStoredStatsOnAws }) {
  if (!intent?.publication_id || !intent.local_checksum || !intent.expected_previous_publication)
    throw new Error('PUBLICATION_RECOVERY_REQUIRES_DURABLE_INTENT');
  const active = await readActive({ importUrl, token });
  const url = new URL(importUrl);
  url.pathname = '/admin/product-stats-readback'; url.search = ''; url.hash = '';
  url.searchParams.set('publication_id', intent.publication_id);
  url.searchParams.set('kind', 'identities');
  const stored = (await readJson(url, token)).page?.publication;
  for (const key of ['publication_id', 'checksum', 'expected_row_count', 'expected_non_empty_scope_count',
    'parser_version', 'rule_version', 'filter_version', 'created_at']) {
    if (stored?.[key] !== intent[key]) throw new Error('PUBLICATION_RECOVERY_IDENTITY_MISMATCH');
  }
  let outcome;
  if (samePointer(active, intent) && active.row_count === intent.expected_row_count && stored.active === 1) {
    await verify({ importUrl, token, publication: intent, expectedActive: 1, recoverManifest: true });
    // AWS stores an enriched response with a different checksum from D1.
    // Bind each to its own pre-stage checksum rather than compare unlike hashes.
    assertLocalRecovery(db, intent);
    outcome = 'published';
  } else if (samePointer(active, intent.expected_previous_publication) && stored.active === 0 && stored.activated_at === null) {
    outcome = 'never_activated';
  } else throw new Error('PUBLICATION_RECOVERY_AMBIGUOUS');
  const after = await readActive({ importUrl, token });
  if (!samePointer(active, after) || active.row_count !== after.row_count) throw new Error('PUBLICATION_RECOVERY_ACTIVE_CHANGED');
  return { verified: true, publication_id: intent.publication_id, checksum: intent.checksum, outcome, published_at: stored.activated_at };
}
