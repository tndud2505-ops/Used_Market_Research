import { DatabaseSync } from 'node:sqlite';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PcPartsLedger } from './pc-parts-ledger.mjs';
import { readVerifiedRepairBase } from './pc-stats-repair-base.mjs';
import { calculateScopedReplacements, planScopedStatsRepair } from './pc-stats-repair-plan.mjs';
import { statsPublicationKey } from '../cloudflare/public-product-stats.mjs';
import { PC_DIRECTORY_PUBLICATION_SOURCE_KEYS } from '../collector/logic/pc-source-registry.mjs';
import { readActiveStatsScopes, publishStatsInChunks } from './pc-stats-publication-client.mjs';
import { assertFullPublicationActivation } from './pc-publication-scopes.mjs';
import { storeCompletedPricePublication, storedPricePublicationKey } from './pc-stored-price-publication.mjs';

const apply = process.argv.includes('--apply');
const importUrl = process.env.D1_STATS_IMPORT_URL;
const token = process.env.CLOUDFLARE_MANUAL_RUN_TOKEN || process.env.IMPORT_TOKEN;
const indexPath = process.env.RUNNER_INDEX_PATH;
const outputPath = process.env.PC_STATS_REPAIR_OUTPUT;
const scopes = JSON.parse(process.env.PC_STATS_REPAIR_SCOPES_JSON || '[]');
if (!indexPath || !importUrl || !token || !Array.isArray(scopes) || !scopes.length)
  throw new Error('EXPLICIT_REPAIR_CONFIGURATION_REQUIRED');
if (apply && !outputPath) throw new Error('REPAIR_RECOVERY_OUTPUT_REQUIRED');
async function requireIdlePublisher() {
  const health = await fetch(`http://127.0.0.1:${process.env.RUNNER_PORT || 8787}/health`).then(r=>r.json());
  if (!health.ok || health.active_run || health.pc_parts?.publication_active || health.pc_parts?.scheduler_active)
    throw new Error('REPAIR_RUNNER_BUSY');
}
await requireIdlePublisher();
const keys = scopes.map(statsPublicationKey);
if (new Set(keys).size !== keys.length || scopes.some(s => s.days !== 30
  || ['canonical_product_id','market_pool','condition_code','currency'].some(k => !s[k] || typeof s[k] !== 'string')))
  throw new Error('EXACT_REPAIR_SCOPES_REQUIRED');

const db = new DatabaseSync(indexPath);
db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=10000');
const ledger = new PcPartsLedger({db});
try {
  const active = ledger.getActivePipelineVersion();
  const base = await readVerifiedRepairBase({ importUrl, token,
    publicationId: process.env.PC_STATS_REPAIR_BASE_ID, normalizationVersion: active?.normalization_version });
  if (base.parser_version !== active.parser_version || base.rule_version !== active.rule_version
    || base.filter_version !== active.filter_version) throw new Error('REPAIR_REQUIRES_SAME_PIPELINE');
  const byKey = new Map(base.rows.map(row => [statsPublicationKey(row), row]));
  if (keys.some(key => !byKey.has(key))) throw new Error('REPAIR_SCOPE_NOT_IN_BASE');
  const optionsFor = scope => ({ canonicalProductId: scope.canonical_product_id, marketPool: scope.market_pool,
    condition: scope.condition_code, currency: scope.currency, days: scope.days, asOf: base.created_at,
    normalizationVersion: active.normalization_version, parserVersion: active.parser_version,
    ruleVersion: active.rule_version, filterVersion: active.filter_version, sourceIds: PC_DIRECTORY_PUBLICATION_SOURCE_KEYS });
  await requireIdlePublisher();
  const replacements = calculateScopedReplacements(ledger, scopes, optionsFor);
  const plan = await planScopedStatsRepair({ base, replacements, reason: process.env.PC_STATS_REPAIR_REASON || 'PRICE_CHANGE',
    thresholdKrw: Number(process.env.PC_STATS_REPAIR_THRESHOLD_KRW || 3000) });
  const { publication, ...report } = plan;
  console.log(JSON.stringify({ phase:'repair_plan', base_publication_id:base.publication_id,
    as_of:base.created_at, ...report }));
  if (apply && publication) {
    await requireIdlePublisher();
    if (JSON.stringify(active) !== JSON.stringify(ledger.getActivePipelineVersion())) throw new Error('REPAIR_PIPELINE_CHANGED');
    const external = await readActiveStatsScopes({importUrl,token});
    if (external.scopes.some(row => !byKey.has(statsPublicationKey(row)))) throw new Error('REPAIR_BASE_OMITS_ACTIVE_SCOPE');
    const activeKeys = new Set(external.scopes.map(statsPublicationKey));
    console.log(JSON.stringify({phase:'verified_base_coverage',retained_active_scopes:activeKeys.size,
      additional_precomputed_scopes:base.rows.filter(row=>!activeKeys.has(statsPublicationKey(row))).length}));
    publication.expected_previous_publication = { publication_id:external.publication_id, checksum:external.checksum };
    const localOptions = { publicationId:publication.publication_id, rows:publication.rows,
      expectedRowCount:publication.rows.length, expectedKeys:publication.rows.map(storedPricePublicationKey),
      allowedSourceIds:PC_DIRECTORY_PUBLICATION_SOURCE_KEYS };
    storeCompletedPricePublication(db,{...localOptions,validateOnly:true});
    // Seal both the verified base and repair before publication; no whole DB
    // backup/reclassification/rebuild is needed for a bounded correction.
    await writeFile(path.resolve(`${outputPath}.base.json`),JSON.stringify(base),{flag:'wx',mode:0o600});
    await writeFile(path.resolve(outputPath),JSON.stringify(publication),{flag:'wx',mode:0o600});
    const activated = await publishStatsInChunks({ importUrl,token,publication,timeoutMs:15*60*1000,
      onProgress:({staged,total})=>{if(staged===total||staged%200===0)console.log(JSON.stringify({phase:'staging',staged,total}));} });
    assertFullPublicationActivation(publication,activated);
    const publishedAt = new Date().toISOString();
    storeCompletedPricePublication(db,{...localOptions,publishedAt});
    for (const decision of plan.decisions.filter(row=>row.action==='REPAIR_SCOPE')) {
      const current = db.prepare(`SELECT MAX(as_of) AS as_of FROM daily_price_stat_windows
        WHERE canonical_product_id=? AND market_pool=? AND condition_code=? AND currency=?`).get(
        decision.canonical_product_id,decision.market_pool,decision.condition_code,decision.currency);
      // Preserve newer daily coverage while repairing this product's history.
      const asOf = current?.as_of > base.created_at ? current.as_of : base.created_at;
      ledger.rebuildDailyPriceStats({...optionsFor(decision),asOf});
    }
    ledger.recordPublicationSuccess({publicationId:publication.publication_id,checksum:publication.checksum,
      rowCount:publication.rows.length,publishedAt});
    console.log(JSON.stringify({phase:'scoped_repair_complete',publication_id:publication.publication_id,
      as_of:publication.created_at,published_at:publishedAt,previewed_scope_count:scopes.length,
      repaired_scope_count:plan.decisions.filter(row=>row.action==='REPAIR_SCOPE').length,
      preserved_scope_count:plan.preserved_scope_count,verifier:activated.verifier,
      row_checksum_verified:activated.row_checksum_verified,recovery_file:path.resolve(outputPath)}));
  }
} finally { db.close(); }
