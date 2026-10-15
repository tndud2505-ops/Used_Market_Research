import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { PublicationJobState } from '../aws-runner/publication-job-state.mjs';
import { DatabaseSync } from 'node:sqlite';
import { assertPublicationBackup, maintainPublishedStats } from '../aws-runner/pc-publication-maintenance.mjs';
import { createStatsService, requestIsolatedPublication, requestIsolatedVerification } from '../aws-runner/isolated-stats-publisher.mjs';
import { streamStatsChecksum } from '../aws-runner/stream-stats-checksum.mjs';
import { statsChecksum } from '../cloudflare/public-product-stats.mjs';
import { canonicalPcStatsTraceMembers, pcStatsTraceability } from '../aws-runner/pc-stats-traceability.mjs';
import { probeRunnerReadiness } from '../cloudflare/runner-readiness.mjs';
import { createLifecycleStatusCache, createLifecycleQueueBootstrap } from '../aws-runner/lifecycle-status-cache.mjs';
import { PcPartsLedger } from '../aws-runner/pc-parts-ledger.mjs';
import { reconcilePublication, completeReconciledPublication } from '../aws-runner/reconcile-publication.mjs';

const rows = [3, 1, 2].map(value => ({ canonical_product_id: `cpu:한글:${value}`, market_pool: 'KR_DOMESTIC_USED', condition_code: 'USED_WORKING', currency: 'KRW', days: 30, stats_json: { price: value, nullable: null, text: '"\\\n😀' }, as_of: '2026-10-11' }));
for (const data of [[], rows, rows.map(row => ({ ...row, stats_json: JSON.stringify(row.stats_json) }))]) assert.equal(streamStatsChecksum(data), await statsChecksum(data));
const members = [{ source_id: 'bunjang', price_value: 100, stat_date: '2026-10-11', snapshot_id: 2 }, { source_id: 'joonggonara', price_value: 200, stat_date: '2026-10-10' }];
assert.equal(pcStatsTraceability({ traceStatMembers: () => members }, {}).member_checksum, createHash('sha256').update(JSON.stringify(canonicalPcStatsTraceMembers(members))).digest('hex'));

const queueDir = mkdtempSync(path.join(tmpdir(), 'used-publication-queue-'));
try {
  const file = path.join(queueDir, 'state.json');
  let queue = new PublicationJobState(file);
  assert.equal(queue.admit('cron:first').status, 'queued');
  queue = new PublicationJobState(file);
  assert.equal(queue.current.status, 'queued', 'admitted intent survives restart before execution');
  assert.equal(queue.admit('cron:first').status, 'queued');
  assert.throws(() => queue.admit('different'), /BUSY/);
  queue.update({ status: 'running' });
  assert.equal(new PublicationJobState(file).current.status, 'failed', 'new jobs interrupted before durable intent cannot have written D1');
  queue.update({ status: 'running', intent_required: false });
  assert.equal(new PublicationJobState(file).current.status, 'interrupted', 'ambiguous in-flight work cannot be replayed');
  assert.throws(() => new PublicationJobState(file).admit('different'), /UNCERTAIN/);
  queue = new PublicationJobState(file);
  assert.throws(() => queue.reconcile('cron:first', { outcome: 'published' }), /REJECTED/, 'legacy jobs without intent stay blocked');
  queue.update({ status: 'completed' });
  queue = new PublicationJobState(file);
  assert.equal(queue.admit('cron:first').status, 'completed');
  assert.equal(queue.admit('cron:next').status, 'queued');
  queue.update({ status: 'running' });
  const intent = { publication_id: 'prepared', checksum: 'a'.repeat(64), local_checksum: 'b'.repeat(64), expected_row_count: 2,
    expected_chunk_count: 1, expected_non_empty_scope_count: 2, normalization_version: 1, parser_version: 'p', rule_version: 'r', filter_version: 'f',
    created_at: '2026-10-15T00:00:00.000Z', expected_previous_publication: { publication_id: 'previous', checksum: 'c'.repeat(64) } };
  queue.prepare('cron:next', intent);
  assert.throws(() => queue.prepare('wrong-key', intent), /NOT_RUNNING/);
  assert.throws(() => queue.prepare('cron:next', { ...intent, checksum: 'd'.repeat(64) }), /CONFLICT/);
  assert.equal(queue.finish('failed').status, 'interrupted', 'a response failure after intent must never authorize a new publication');
  queue = new PublicationJobState(file);
  assert.deepEqual(queue.current.intent, intent);
  const recoveryDb = new DatabaseSync(':memory:');
  recoveryDb.exec(`CREATE TABLE pc_publication_runtime(publication_kind TEXT PRIMARY KEY, publication_id TEXT, checksum TEXT, row_count INTEGER, published_at TEXT);
    CREATE TABLE pc_stored_price_publications(publication_id TEXT, checksum TEXT, row_count INTEGER, completed INTEGER, published_at TEXT);
    CREATE TABLE pc_stored_price_publication_rows(publication_id TEXT);`);
  recoveryDb.prepare('INSERT INTO pc_publication_runtime VALUES(?,?,?,?,?)').run('PRODUCT_STATS', intent.expected_previous_publication.publication_id, intent.expected_previous_publication.checksum, 2, intent.created_at);
  recoveryDb.prepare('INSERT INTO pc_stored_price_publications VALUES(?,?,?,?,?)').run(intent.publication_id, intent.local_checksum, 2, 0, intent.created_at);
  recoveryDb.prepare('INSERT INTO pc_stored_price_publication_rows VALUES(?),(?)').run(intent.publication_id, intent.publication_id);
  const { normalization_version: omitted, local_checksum: ignored, expected_previous_publication: previous, ...metadata } = intent;
  let proofCalls = 0;
  const recovery = { intent, db: recoveryDb, importUrl: 'https://fixture.invalid/admin/import-product-stats', token: 'fixture',
    readActive: async () => ({ publication_id: intent.publication_id, checksum: intent.checksum, row_count: 2 }),
    readJson: async () => ({ page: { publication: { ...metadata, active: 1, activated_at: intent.created_at } } }),
    verify: async input => { assert.equal(input.expectedActive, 1); proofCalls++; } };
  try {
    const proof = await reconcilePublication(recovery);
    assert.equal(proofCalls, 1, 'active recovery requires a full row readback');
    assert.equal(recoveryDb.prepare('SELECT completed FROM pc_stored_price_publications').get().completed, 0, 'verification itself is read-only');
    completeReconciledPublication(recoveryDb, intent, proof);
    completeReconciledPublication(recoveryDb, intent, proof);
    assert.equal(recoveryDb.prepare('SELECT completed FROM pc_stored_price_publications').get().completed, 1);
    assert.equal(recoveryDb.prepare('SELECT publication_id FROM pc_publication_runtime').get().publication_id, intent.publication_id, 'activation response loss recovers from the prepared local response');
    assert.equal(queue.reconcile('cron:next', proof).status, 'partial_success', 'recovery must not claim maintenance completion');
    recoveryDb.exec("UPDATE pc_stored_price_publications SET checksum = 'wrong'");
    await assert.rejects(reconcilePublication(recovery), /AWS_MISMATCH/);
    const inactive = { ...recovery, readActive: async () => ({ ...previous, row_count: 2 }),
      readJson: async () => ({ page: { publication: { ...metadata, active: 0, activated_at: null } } }) };
    assert.equal((await reconcilePublication(inactive)).outcome, 'never_activated');
    await assert.rejects(reconcilePublication({ ...inactive, readJson: async () => ({ page: { publication: { ...metadata, active: 0, activated_at: intent.created_at } } }) }), /AMBIGUOUS/);
    await assert.rejects(reconcilePublication({ ...inactive, readActive: async () => ({ publication_id: 'other', checksum: 'other', row_count: 2 }) }), /AMBIGUOUS/);
    await assert.rejects(reconcilePublication({ ...inactive, readJson: async () => { throw new Error('MISSING_OR_UNKNOWN'); } }), /MISSING_OR_UNKNOWN/);
    await assert.rejects(reconcilePublication({ ...recovery, verify: async () => { throw new Error('ROW_CHECKSUM_MISMATCH'); } }), /ROW_CHECKSUM_MISMATCH/);
  } finally { recoveryDb.close(); }
  writeFileSync(file, 'corrupt');
  queue = new PublicationJobState(file);
  assert.equal(queue.current.status, 'blocked');
  assert.throws(() => queue.admit('cannot-overwrite-corruption'), /UNAVAILABLE/);
  const backupFile = path.join(queueDir, 'backup.sqlite');
  const backup = new DatabaseSync(backupFile);
  backup.exec("CREATE TABLE pc_publication_runtime(publication_kind TEXT, publication_id TEXT, checksum TEXT, row_count INTEGER); INSERT INTO pc_publication_runtime VALUES('PRODUCT_STATS','fresh','checksum',10)");
  backup.close();
  const publication = { publication_id: 'fresh', checksum: 'checksum', row_count: 10 };
  assert.doesNotThrow(() => assertPublicationBackup(backupFile, publication));
  assert.throws(() => assertPublicationBackup(backupFile, { ...publication, publication_id: 'newer' }), /MISMATCH/);
  assert.throws(() => assertPublicationBackup(`${backupFile}.gz`, publication), /UNVERIFIED/);
  let compacted = false;
  const outcome = maintainPublishedStats({ createBackup: () => backupFile }, { compactStorage: () => { compacted = true; } }, { ...publication, checksum: 'changed' }, new Date().toISOString());
  assert.equal(outcome.storage_maintenance_ok, false);
  assert.equal(compacted, false, 'an older backup must never authorize pruning');
} finally { rmSync(queueDir, { recursive: true, force: true }); }

async function withService(code, options, test) {
  const socketPath = process.platform === 'win32' ? `\\\\.\\pipe\\used-stats-${randomUUID()}` : path.join(tmpdir(), `used-stats-${randomUUID()}.sock`);
  const service = createStatsService({ command: process.execPath, args: ['-e', code], deadlineMs: 3000, killGraceMs: 50, log: () => {}, ...options });
  await new Promise(resolve => service.listen(socketPath, resolve));
  try { await test(socketPath); } finally { service.closeAllConnections(); await new Promise(resolve => service.close(resolve)); }
}
await withService('setTimeout(()=>console.log(JSON.stringify({published:true,publication_id:"fixture"})),300)', {}, async socketPath => {
  const first = requestIsolatedPublication({ socketPath });
  await new Promise(resolve => setTimeout(resolve, 80));
  await assert.rejects(requestIsolatedPublication({ socketPath }), /ALREADY_ACTIVE/);
  assert.equal((await first).publication_id, 'fixture');
});
await withService('setInterval(()=>{},1000)', { deadlineMs: 100 }, async socketPath => {
  const start = Date.now();
  await assert.rejects(requestIsolatedPublication({ socketPath }), /DEADLINE/);
  assert.ok(Date.now() - start < 2500, 'deadline terminates computation, not just its network request');
});
await withService('process.exit(2)', {}, async socketPath => { await assert.rejects(requestIsolatedPublication({ socketPath }), /FAILED/); });
await withService('setInterval(()=>{},1000)', {}, async socketPath => {
  await assert.rejects(requestIsolatedPublication({ socketPath, timeoutMs: 100 }), /DEADLINE/);
  await new Promise(resolve => setTimeout(resolve, 200));
  const status = await new Promise((resolve, reject) => {
    http.get({ socketPath, path: '/status' }, response => { let body = ''; response.on('data', data => body += data); response.on('end', () => resolve(JSON.parse(body))); }).on('error', reject);
  });
  assert.equal(status.active, false, 'disconnected runner must not leave orphan publication');
});
const env = { RUNNER_URL: 'https://runner.example/api/runner/run', RUNNER_TOKEN: 'fixture-only' };
const verificationOptions = { requestPath: '/verify', successKey: 'verified', input: true };
await withService('let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>console.log(JSON.stringify({verified:true,publication_id:JSON.parse(s).publication_id})))', verificationOptions, async socketPath => {
  assert.equal((await requestIsolatedVerification({ publication_id: 'fixture' }, { socketPath })).publication_id, 'fixture');
});
await withService('process.stdin.resume();setInterval(()=>{},1000)', verificationOptions, async socketPath => {
  await assert.rejects(requestIsolatedVerification({ oversized: 'x'.repeat(70000) }, { socketPath }), /INPUT_TOO_LARGE/);
});
assert.equal((await probeRunnerReadiness(env, async (url, options) => {
  assert.equal(url.pathname, '/api/pc/listings');
  assert.equal(options.redirect, 'manual');
  assert.equal(options.signal.aborted, false);
  assert.equal(Object.hasOwn(options, 'cache'), false, 'use the deployed Worker fetch-compatible options');
  return new Response(JSON.stringify({ status: 'success', data: { items: [] } }));
})).ok, true);
for (const fetcher of [async () => { throw new Error('timeout'); }, async () => new Response('{}', { status: 503 }), async () => new Response(JSON.stringify({ ok: true }))]) assert.equal((await probeRunnerReadiness(env, fetcher)).ok, false);
const statusDir = mkdtempSync(path.join(tmpdir(), 'used-lifecycle-status-'));
let statusCache;
try {
  const filePath = path.join(statusDir, 'fixture.sqlite');
  const db = new DatabaseSync(filePath), ledger = new PcPartsLedger({ db });
  ledger.migrate();
  ledger.upsertSource({sourceId:'bunjang',displayName:'Bunjang',marketPool:'KR_C2C_USED',policyStatus:'APPROVED',runtimeStatus:'ENABLED'});
  ledger.recordObservation({sourceId:'bunjang',sourceListingId:'1',title:'CPU',price:10000,currency:'KRW',status:'ACTIVE',
    rawPayload:{url:'https://m.bunjang.co.kr/products/1'},observedAt:new Date().toISOString()});
  db.exec("DELETE FROM pc_lifecycle_queue; UPDATE pc_lifecycle_bootstrap SET ready=0,source_end='bunjang',listing_end='1'");
  let bootstrapped=false;
  const bootstrap = createLifecycleQueueBootstrap(filePath,()=>{bootstrapped=true;});
  try {
    for(let i=0;i<100&&!bootstrapped;i++) { bootstrap.step(); await new Promise(resolve=>setTimeout(resolve,20)); }
    assert.ok(bootstrapped,'background bootstrap must finish actual SQLite writes');
    assert.equal(db.prepare('SELECT count(*) n FROM pc_lifecycle_queue').get().n,1);
  } finally { await bootstrap.close(); }
  db.close();
  statusCache = createLifecycleStatusCache(filePath);
  const started = performance.now();
  assert.equal(statusCache.get().bunjang.status, 'PENDING');
  assert.ok(performance.now() - started < 1000, 'health must not wait for diagnostic scans');
  let status;
  for (let i = 0; i < 100; i++) {
    await new Promise(resolve => setTimeout(resolve, 20));
    status = statusCache.get(); if (status.bunjang.status !== 'PENDING') break;
  }
  assert.equal(status.bunjang.status, 'READY');
  assert.equal(status.bunjang.due_count, 0);
  assert.ok(status.bunjang.checked_at);
  await statusCache.close();
  statusCache = createLifecycleStatusCache(filePath, { timeoutMs: 1 });
  assert.equal(statusCache.get().bunjang.due_count, undefined, 'unknown is never fabricated as zero');
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(statusCache.get().bunjang.status, 'UNAVAILABLE');
  assert.equal(statusCache.get().bunjang.error, 'LIFECYCLE_STATUS_TIMEOUT');
} finally { await statusCache?.close(); rmSync(statusDir, { recursive: true, force: true }); }
console.log('Runtime isolation: deadline, busy guard, failure, disconnect, checksum equivalence, real read readiness and nonblocking lifecycle status passed');
