import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { readLocalState } from './republish-pc-projections.mjs';
import { SearchIndex } from './search-index.mjs';
import { PcPartsLedger } from './pc-parts-ledger.mjs';
import { buildPcProjectionReconciliation, DEFAULT_PC_REPUBLISH_SOURCES, pcProjectionTombstone } from './pc-projection-republish-policy.mjs';

export function localProjectionPlan(indexPath) {
  const sources = [...DEFAULT_PC_REPUBLISH_SOURCES];
  const state = readLocalState(indexPath, sources);
  // D1 is deliberately outside this AWS-primary operation. No external reads,
  // writes or arbitrary public URL are accepted by this command.
  const plan = buildPcProjectionReconciliation({ authoritative: state.authority.items,
    localPublic: state.localPublic, d1Public: state.authority.items,
    pipelineVersion: state.activeVersion, authorityCoverage: state.authority, sources });
  if (state.authority.projection_count !== state.authority.source_pair_count
    || state.authority.version_covered_count !== state.authority.source_pair_count
    || state.authority.unprojected_count !== 0 || state.authority.version_mismatch_count !== 0) {
    throw new Error('LOCAL_PROJECTION_AUTHORITY_INCOMPLETE');
  }
  const checksum = createHash('sha256').update(JSON.stringify({ pipeline: state.activeVersion,
    source_pairs: state.authority.source_pair_checksum, latest: state.authority.latest_selection_checksum,
    upserts: plan.local_upserts, stale: plan.local_stale })).digest('hex');
  return { plan, state, summary: {
    checksum, pipeline: state.activeVersion, source_pair_count: state.authority.source_pair_count,
    version_covered_count: state.authority.version_covered_count,
    authoritative_count: plan.authoritative_count, current_count: plan.local_public_count,
    stale_count: plan.local_stale_count, missing_count: plan.local_missing_count,
    stale_preview: plan.local_stale.slice(0, 20).map(row => ({ id: row.item_id, category: row.category_code, model: row.canonical_product_id }))
  } };
}

async function main(argv) {
  const value = name => argv.find(v => v.startsWith(`${name}=`))?.slice(name.length + 1);
  const file = value('--db') || process.env.RUNNER_INDEX_PATH;
  if (!file || !existsSync(file)) throw new Error('EXISTING_LOCAL_DATABASE_REQUIRED');
  const { plan, summary } = localProjectionPlan(file);
  if (!argv.includes('--apply')) { console.log(JSON.stringify({ mode: 'dry-run', ...summary }, null, 2)); return; }
  if (value('--confirm-checksum') !== summary.checksum) throw new Error('LOCAL_RECONCILIATION_CHECKSUM_MISMATCH');
  for (const name of ['authoritative_count', 'current_count', 'stale_count', 'missing_count', 'source_pair_count']) {
    const expected = value(`--expect-${name.replaceAll('_', '-')}`);
    if (expected == null || Number(expected) !== summary[name]) throw new Error(`LOCAL_RECONCILIATION_COUNT_MISMATCH:${name}`);
  }
  const backup = `${path.resolve(file)}.pre-local-reconcile-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const db = new DatabaseSync(file);
  try {
    new PcPartsLedger({ db }); // register expression-index SQL functions before backup
    db.exec(`VACUUM INTO '${backup.replaceAll("'", "''")}'`);
  } finally { db.close(); }
  if (!existsSync(backup)) throw new Error('LOCAL_RECONCILIATION_BACKUP_MISSING');
  const index = new SearchIndex({ filePath: file, backupDir: path.join(path.dirname(file), 'backups') });
  try {
    const appliedAt = new Date().toISOString();
    index.upsertPublicProjections([...plan.local_upserts,
      ...plan.local_stale.map(row => pcProjectionTombstone(row, { updatedAt: appliedAt }))], { observedAt: appliedAt });
  } finally { index.close(); }
  const verified = localProjectionPlan(file).summary;
  if (verified.stale_count || verified.missing_count || verified.current_count !== verified.authoritative_count) throw new Error('LOCAL_RECONCILIATION_POSTCHECK_FAILED');
  console.log(JSON.stringify({ mode: 'apply', ...summary, backup, verified }, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
