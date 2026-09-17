// Bounded operator verification using only the existing approved domestic adapters.
// A target registration is never counted as a successful request or observation.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { collectApprovedDomesticQueryOnce } from '../cloudflare/live-search.mjs';
import { pcCollectionTargetSetV2 } from '../cloudflare/pc-directory-http.mjs';
import { getPcSource } from '../collector/logic/pc-source-registry.mjs';
import { SearchIndex } from './search-index.mjs';
import { PcPartsLedger } from './pc-parts-ledger.mjs';
import { PcShadowPipeline } from './pc-shadow-pipeline.mjs';
import { stabilizeIncrementalPcProjections } from './pc-projection-republish-policy.mjs';

export const RELEASE_SOURCE_KEYS = Object.freeze(['joonggonara', 'bunjang']);
export const RELEASE_PRICE_CATEGORIES = Object.freeze(['CPU', 'GPU', 'RAM', 'MOTHERBOARD', 'SSD', 'HDD', 'PSU', 'CASE', 'COOLING']);
const representatives = ['cpu:intel:i5-12400f', 'gpu:nvidia:rtx-3060-ti', 'motherboard:msi:pro-b650m-p',
  'ssd:samsung:capacity-bucket:513-gb-1-tb', 'hdd:western-digital:capacity-bucket:gt-2-tb-le-4-tb',
  'psu:seasonic:watts-bucket:751-850', 'case:facet:mid-tower:fractal-design', 'cooling:facet:air-cpu:noctua'];

export function releaseCollectionTargets(all = pcCollectionTargetSetV2().targets) {
  const domestic = all.filter(t => RELEASE_SOURCE_KEYS.every(source => t.sourceKeys.includes(source)) && t.enabled);
  const korean = domestic.filter(t => t.targetId.endsWith(':domestic:ko') && t.canonicalProductId?.startsWith('ram:g-skill:'));
  if (korean.length !== 27 || new Set(korean.map(t => t.canonicalProductId)).size !== 27) throw new Error('EXACT_GSKILL_QUERY_SET_REQUIRED');
  const priced = representatives.map(id => domestic.filter(t => t.canonicalProductId === id).at(-1));
  const market = RELEASE_PRICE_CATEGORIES.map(category => domestic.find(t => t.categoryCode === category && t.cadenceClass === 'HOURLY_CATEGORY'));
  if ([...priced, ...market].some(t => !t)) throw new Error('NINE_CATEGORY_RELEASE_TARGETS_REQUIRED');
  return [...korean, ...priced, ...market].map(t => ({ ...t, verification_role: korean.includes(t)
    ? 'GSKILL_KOREAN' : priced.includes(t) ? 'PRICE_REPRESENTATIVE' : 'BROAD_MARKET_SAMPLE' }));
}

export function approvedRuntime(sourceKey, runtime, now = Date.now()) {
  const registry = getPcSource(sourceKey);
  return RELEASE_SOURCE_KEYS.includes(sourceKey) && registry?.policy_status === 'APPROVED'
    && registry.runtime_status === 'ENABLED' && runtime?.policy_status === 'APPROVED'
    && runtime.runtime_status === 'ENABLED' && !(Date.parse(runtime.backoff_until || '') > now)
    && !(Date.parse(runtime.quarantine_until || '') > now);
}

export const isCollectionAccessBlock = message => /(?:HTTP[_ ]?(?:401|403|429)|\b401\b|\b403\b|\b429\b|blocked|captcha)/iu.test(String(message));

async function main() {
  const targets = releaseCollectionTargets();
  if (process.argv.includes('--dry-run')) {
    console.log(JSON.stringify({ targets, requests_maximum: targets.length * RELEASE_SOURCE_KEYS.length,
      source_keys: RELEASE_SOURCE_KEYS, collected: false }, null, 2)); return;
  }
  const directory = process.argv[2];
  if (!process.argv.includes('--confirm-approved-local-collection') || !directory?.startsWith('/var/lib/used-market-runner/backups/parts-v18-')
    || !existsSync(`${directory}/search-index.sqlite`) || !existsSync('/var/lib/used-market-runner/parts-release-owner.txt')) {
    throw new Error('RECOVERY_POINT_AND_EXCLUSIVE_RELEASE_OWNER_REQUIRED');
  }
  const state = execFileSync('systemctl', ['show', '--property=ActiveState', '--value', 'used-market-runner.service'], { encoding: 'utf8' }).trim();
  if (state !== 'inactive') throw new Error('RUNNER_MUST_BE_STOPPED_FOR_OPERATOR_COLLECTION');
  const reportPath = `${directory}/release-real-collection.json`, journalPath = `${directory}/release-real-collection.jsonl`;
  if (existsSync(reportPath) || existsSync(journalPath)) throw new Error('REFUSING_TO_OVERWRITE_COLLECTION_EVIDENCE');
  const index = new SearchIndex({ filePath: '/var/lib/used-market-runner/search-index.sqlite', backupDir: `${directory}/collection-backups` });
  const ledger = new PcPartsLedger({ db: index.db });
  const report = { owner: readFileSync('/var/lib/used-market-runner/parts-release-owner.txt', 'utf8').split('\n')[0],
    started_at: new Date().toISOString(), source_keys: RELEASE_SOURCE_KEYS, requested_target_count: targets.length,
    target_set: ledger.getActiveCollectionTargetSummary(), sources: [] };
  try {
    if (ledger.getActivePipelineVersion()?.normalization_version !== 18) throw new Error('RELEASE_VERSION18_REQUIRED');
    for (const source of RELEASE_SOURCE_KEYS) if (!approvedRuntime(source, ledger.getSource(source))) throw new Error(`SOURCE_NOT_READY:${source}`);
    const pipeline = new PcShadowPipeline({ ledger }); await pipeline.initialize();
    for (const sourceKey of RELEASE_SOURCE_KEYS) {
      if (!approvedRuntime(sourceKey, ledger.getSource(sourceKey))) throw new Error(`SOURCE_NOT_READY:${sourceKey}`);
      const startedAt = new Date().toISOString();
      const crawlId = ledger.startCrawlRun({ sourceId: sourceKey, startedAt, adapterVersion: 'operator-parts-release-v18' });
      const source = { source_id: sourceKey, crawl_run_id: crawlId, started_at: startedAt, targets: [], blocked: false };
      report.sources.push(source);
      for (const target of targets) {
        if (!approvedRuntime(sourceKey, ledger.getSource(sourceKey))) { source.blocked = true; break; }
        const at = new Date().toISOString();
        const maximum = index.db.prepare('SELECT COALESCE(MAX(id),0) AS n FROM listing_snapshots').get().n;
        const entry = { target_id: target.targetId, canonical_product_id: target.canonicalProductId,
          category: target.categoryCode, query: target.queryText, role: target.verification_role, started_at: at, status: 'STARTED' };
        source.targets.push(entry);
        try {
          const items = await collectApprovedDomesticQueryOnce(sourceKey, target.queryText, 20);
          if (!Array.isArray(items)) throw new Error('INVALID_COLLECTION_RESPONSE');
          const projected = pipeline.recordItems(items.map(item => ({ ...item, site: sourceKey })), { observedAt: at });
          index.upsertPublicProjections(stabilizeIncrementalPcProjections(projected), { observedAt: at });
          const inserted = index.db.prepare(`SELECT s.id AS snapshot_id, s.source_listing_id, n.canonical_product_id,
            n.category_code, n.statistics_eligible FROM listing_snapshots s JOIN normalized_listings n ON n.snapshot_id=s.id
            WHERE s.id>? AND s.source_id=? AND n.normalization_version=18 ORDER BY s.id`).all(maximum, sourceKey);
          const changes = projected.filter(item => item._pc_snapshot_created).length;
          if (inserted.length !== changes) throw new Error('COLLECTION_COMMIT_EVIDENCE_MISMATCH');
          Object.assign(entry, { status: 'SUCCEEDED', finished_at: new Date().toISOString(), returned_count: items.length,
            observed_count: projected.length, new_snapshot_count: inserted.length, saved_snapshots: inserted,
            verified_fresh_request_count: items.verified_request_count,
            exact_requested_matches: target.canonicalProductId ? projected.filter(item => item.canonical_product_id === target.canonicalProductId).length : null,
            comparable_count: projected.filter(item => item.statistics_eligible === true).length,
            unknown_or_unregistered_count: projected.filter(item => !item.canonical_product_id || item.category_code === 'UNKNOWN').length,
            classified_ids: [...new Set(projected.map(item => item.canonical_product_id).filter(Boolean))] });
          ledger.updateSourceTargetRuntime({ sourceId: sourceKey, targetId: target.targetId, startedAt: at, succeededAt: entry.finished_at, cursor: null, error: null });
        } catch (error) {
          entry.status = 'FAILED'; entry.error = String(error.message || error); entry.finished_at = new Date().toISOString();
          ledger.updateSourceTargetRuntime({ sourceId: sourceKey, targetId: target.targetId, startedAt: at, succeededAt: null, cursor: null, error: entry.error });
          source.blocked = isCollectionAccessBlock(entry.error);
          if (source.blocked) {
            const until = new Date(Date.now() + 3600000).toISOString();
            ledger.updateSourceRuntime(sourceKey, { ...ledger.getSource(sourceKey), runtime_status: 'QUARANTINED',
              backoff_until: until, quarantine_until: until, last_error: entry.error });
          }
        }
        appendFileSync(journalPath, JSON.stringify({ source_id: sourceKey, ...entry }) + '\n', { mode: 0o600 });
        console.log(JSON.stringify({ phase: 'real_collection_target', source: sourceKey, target: entry.target_id,
          status: entry.status, returned: entry.returned_count, saved_new: entry.new_snapshot_count, matches: entry.exact_requested_matches, error: entry.error }));
        if (source.blocked || /UNVERIFIED_|INVALID_COLLECTION_RESPONSE/u.test(entry.error||'')) break;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      source.finished_at = new Date().toISOString();
      source.successful = source.targets.filter(t => t.status === 'SUCCEEDED').length;
      source.failed = source.targets.filter(t => t.status === 'FAILED').length;
      source.unexecuted = targets.filter(t => !source.targets.some(r => r.target_id === t.targetId)).map(t => t.targetId);
      source.status = source.blocked ? 'QUARANTINED' : source.failed || source.unexecuted.length ? 'FAILED' : 'SUCCEEDED';
      ledger.finishCrawlRun({ crawlRunId: crawlId, status: source.status, finishedAt: source.finished_at,
        collectedCount: source.targets.reduce((n,t)=>n+(t.observed_count||0),0), changedCount: source.targets.reduce((n,t)=>n+(t.new_snapshot_count||0),0),
        requestCount: source.targets.length, requestFailureCount: source.failed, parsedCount: source.targets.reduce((n,t)=>n+(t.returned_count||0),0),
        httpBlockedCount: source.blocked ? 1 : 0, error: source.targets.filter(t=>t.error).map(t=>t.error).join('; ') || null });
      if (source.status === 'SUCCEEDED') ledger.updateSourceRuntime(sourceKey, { ...ledger.getSource(sourceKey),
        runtime_status: 'ENABLED', consecutive_failures: 0, backoff_until: null, quarantine_until: null,
        last_started_at: startedAt, last_succeeded_at: source.finished_at, last_error: null });
    }
  } finally {
    report.finished_at = new Date().toISOString();
    report.passed = report.sources.length === RELEASE_SOURCE_KEYS.length && report.sources.every(s => s.status === 'SUCCEEDED');
    writeFileSync(reportPath, JSON.stringify(report, null, 2), { mode: 0o600, flag: 'wx' });
    index.close();
  }
  if (!report.passed) throw new Error('COLLECTION_NOT_FULLY_SUCCESSFUL_SEE_SAVED_EVIDENCE');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message || String(error)); process.exitCode = 1; });
}
