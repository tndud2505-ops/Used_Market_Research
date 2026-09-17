import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import {
  stageProductStatsChunk, activateStagedProductStats, readActiveProductStatsScopes, statsChecksum,
  statsChunkManifestChecksum, statsPublicationBoundaryKey, statsPublicationKey
} from '../cloudflare/public-product-stats.mjs';
import worker from '../cloudflare/worker.mjs';
import { readActiveStatsScopes, publishStatsInChunks } from '../aws-runner/pc-stats-publication-client.mjs';
import { fullPublicationScopes } from '../aws-runner/pc-publication-scopes.mjs';

// Actual SQLite tables and constraints, but only an isolated in-memory DB.
class LocalD1 {
  constructor() {
    this.sqlite = new DatabaseSync(':memory:');
    this.sqlite.exec('PRAGMA foreign_keys=ON');
    for (const name of ['0002_pc_public_stats.sql', '0015_pc_stats_chunk_staging.sql']) {
      this.sqlite.exec(readFileSync(new URL(`../cloudflare/migrations/${name}`, import.meta.url), 'utf8'));
    }
    this.failPointer = false;
  }
  prepare(sql) {
    const db = this;
    const wrap = values => ({
      sql, values, bind: (...args) => wrap(args),
      first: async () => db.sqlite.prepare(sql).get(...values) || null,
      all: async () => ({ results: db.sqlite.prepare(sql).all(...values) }),
      run: async () => ({ success: true, meta: { changes: db.sqlite.prepare(sql).run(...values).changes } })
    });
    return wrap([]);
  }
  async batch(statements) {
    this.sqlite.exec('BEGIN IMMEDIATE');
    try {
      const results = [];
      for (const statement of statements) {
        if (this.failPointer && /SET active = 1/u.test(statement.sql)) throw new Error('fixture pointer failure');
        const prepared = this.sqlite.prepare(statement.sql);
        if (/^\s*SELECT/u.test(statement.sql)) results.push({ success: true, results: prepared.all(...statement.values) });
        else results.push({ success: true, meta: { changes: prepared.run(...statement.values).changes } });
      }
      this.sqlite.exec('COMMIT');
      return results;
    } catch (error) { this.sqlite.exec('ROLLBACK'); throw error; }
  }
  active() { return this.sqlite.prepare('SELECT publication_id FROM public_stats_publications WHERE active=1').get()?.publication_id; }
  close() { this.sqlite.close(); }
}

const asOf = '2026-09-17T05:00:00.000Z';
const versions = { normalization: 18, parser: 'pc-parser-v8', rule: 'pc-rules-v18', filter: 'pc-filter-v7' };
const rows = Array.from({ length: 41 }, (_, i) => ({
  canonical_product_id: `ram:fixture:model-${String(i).padStart(3, '0')}`,
  market_pool: 'KR_C2C_USED', condition_code: 'USED_WORKING', currency: 'KRW', days: 30,
  stats_json: { versions, active: { sample_count: 3, median: 100000 }, sold: { sample_count: 0 },
    by_source: [], traceability: { member_count: 3, member_checksum: 'a'.repeat(64) } },
  as_of: asOf
}));
const checksum = await statsChecksum(rows);
function payload(id, patch = {}) {
  return { publication_id: id, checksum, expected_row_count: rows.length,
    expected_non_empty_scope_count: rows.length, normalization_version: 18,
    parser_version: versions.parser, rule_version: versions.rule, filter_version: versions.filter,
    created_at: asOf, merge_with_active: false, ...patch };
}
async function stage(db, id, patch = {}, inputRows = rows) {
  const chunks = [];
  for (let offset = 0; offset < inputRows.length; offset += 40) {
    const part = inputRows.slice(offset, offset + 40);
    const descriptor = {
      chunk_index: chunks.length, expected_chunk_count: Math.ceil(inputRows.length / 40),
      chunk_checksum: await statsChecksum(part), row_count: part.length, non_empty_scope_count: part.length,
      first_scope_key: statsPublicationBoundaryKey(part[0]), last_scope_key: statsPublicationBoundaryKey(part.at(-1))
    };
    await stageProductStatsChunk(db, { ...payload(id, patch), ...descriptor,
      chunk_row_count: part.length, chunk_non_empty_scope_count: part.length, rows: part });
    chunks.push(descriptor);
    assert.notEqual(db.active(), id, 'partial staging must never be active');
  }
  return { ...payload(id, patch), expected_chunk_count: chunks.length,
    chunk_manifest_checksum: await statsChunkManifestChecksum(chunks) };
}

let passed = 0;
const failures = [];
async function check(name, fn) {
  const db = new LocalD1();
  try { await fn(db); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { failures.push({ name, error: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
  finally { db.close(); }
}
await check('all 41 rows activate only after both complete chunks', async db => {
  const manifest = await stage(db, 'complete');
  const activated = await activateStagedProductStats(db, manifest);
  assert.equal(activated.checksum, checksum);
  assert.equal(activated.row_count, rows.length);
  assert.equal(db.active(), 'complete');
});
await check('wrong claimed overall checksum is rejected', async db => {
  const manifest = await stage(db, 'wrong-checksum', { checksum: 'b'.repeat(64) });
  await assert.rejects(() => activateStagedProductStats(db, manifest), /checksum/u);
  assert.equal(db.active(), undefined);
});
await check('same row count with modified stored price is rejected', async db => {
  const manifest = await stage(db, 'tampered-price');
  db.sqlite.prepare("UPDATE public_product_stats SET stats_json=json_set(stats_json,'$.active.median',900000) WHERE canonical_product_id=?")
    .run(rows[0].canonical_product_id);
  await assert.rejects(() => activateStagedProductStats(db, manifest), /checksum/u);
  assert.equal(db.active(), undefined);
});
await check('same row count with a replaced scope identity is rejected', async db => {
  const manifest = await stage(db, 'tampered-key');
  db.sqlite.prepare('UPDATE public_product_stats SET canonical_product_id=? WHERE canonical_product_id=?')
    .run('ram:fixture:replacement', rows[0].canonical_product_id);
  await assert.rejects(() => activateStagedProductStats(db, manifest), /checksum|scope/u);
  assert.equal(db.active(), undefined);
});
await check('mixed normalization version cannot be staged', async db => {
  const altered = structuredClone(rows);
  altered[0].stats_json.versions.normalization = 17;
  const alteredChecksum = await statsChecksum(altered);
  await assert.rejects(() => stage(db, 'mixed-normalization', { checksum: alteredChecksum }, altered), /normalization|version/u);
});
await check('inconsistent as_of cannot be staged', async db => {
  const altered = structuredClone(rows);
  altered[0].as_of = '2026-09-16T05:00:00.000Z';
  await assert.rejects(() => stage(db, 'wrong-time', {}, altered), /as_of|timestamp/u);
});
await check('missing chunk descriptor cannot activate', async db => {
  const manifest = await stage(db, 'missing-chunk');
  db.sqlite.prepare('DELETE FROM public_stats_publication_chunks WHERE chunk_index=1').run();
  await assert.rejects(() => activateStagedProductStats(db, manifest), /chunk count/u);
  assert.equal(db.active(), undefined);
});
await check('failed pointer transaction preserves the previous publication', async db => {
  await activateStagedProductStats(db, await stage(db, 'previous'));
  const next = await stage(db, 'next');
  db.failPointer = true;
  await assert.rejects(() => activateStagedProductStats(db, next), /fixture pointer failure/u);
  assert.equal(db.active(), 'previous');
});
await check('empty D1 is explicitly attested with no copied prices', async db => {
  const proof = await readActiveProductStatsScopes(db);
  assert.equal(proof.publication_id, null);
  assert.equal(proof.checksum, null);
  assert.deepEqual(proof.scopes, []);
  assert.equal(proof.row_count, 0);
});
await check('fresh D1 identities bootstrap an empty local publication table', async db => {
  await activateStagedProductStats(db, await stage(db, 'external'));
  const proof = await readActiveProductStatsScopes(db);
  assert.equal(proof.row_count, 41);
  assert.equal(proof.checksum, checksum);
  assert.ok(proof.scopes.every(scope => !('stats_json' in scope) && !('price' in scope)));
  const localWithoutPublication = { prepare: () => ({ all: () => [] }) };
  const combined = fullPublicationScopes(localWithoutPublication, [{
    canonical_product_id: 'ram:fixture:new-observation', market_pool: 'KR_C2C_USED',
    condition_code: 'USED_WORKING', currency: 'KRW', days: 30
  }], { externalActive: proof });
  assert.equal(combined.length, 42);
  assert.ok(rows.every(row => combined.some(scope => statsPublicationKey(scope) === statsPublicationKey(row))));
});
await check('stale predecessor rejects activation and preserves current prices', async db => {
  await activateStagedProductStats(db, await stage(db, 'previous'));
  const next = await stage(db, 'candidate');
  await assert.rejects(() => activateStagedProductStats(db, { ...next,
    expected_previous_publication: { publication_id: 'obsolete', checksum }
  }), /predecessor changed/u);
  assert.equal(db.active(), 'previous');
});
await check('Worker scope endpoint is authenticated and returns no-store identity data', async db => {
  const url = 'https://publication.test/admin/product-stats-scopes';
  const env = { DB: db, MANUAL_RUN_TOKEN: 'fixture-secret' };
  assert.equal((await worker.fetch(new Request(url), env)).status, 401);
  const response = await worker.fetch(new Request(url, { headers: { authorization: 'Bearer fixture-secret' } }), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).external_active.row_count, 0);
});
await check('client-to-Worker complete publication and bootstrap use one matching manifest', async db => {
  const originalFetch = globalThis.fetch;
  const seen = [];
  try {
    globalThis.fetch = async (url, options) => {
      seen.push({ path: new URL(url).pathname, method: options.method });
      return worker.fetch(new Request(url, options), { DB: db, MANUAL_RUN_TOKEN: 'fixture-secret' });
    };
    const importUrl = 'https://publication.test/admin/import-product-stats';
    const proof = await readActiveStatsScopes({ importUrl, token: 'fixture-secret' });
    const result = await publishStatsInChunks({ importUrl, token: 'fixture-secret', timeoutMs: 1000,
      publication: { ...payload('roundtrip'), rows, expected_keys: rows.map(statsPublicationKey),
        expected_previous_publication: { publication_id: proof.publication_id, checksum: proof.checksum } } });
    assert.equal(result.row_checksum_verified, true);
    assert.equal(result.checksum, checksum);
    assert.equal(db.active(), 'roundtrip');
    assert.deepEqual(seen.map(item => item.method), ['GET', 'POST', 'POST', 'POST']);
    assert.equal(seen.at(-1).path, '/admin/activate-product-stats');
  } finally { globalThis.fetch = originalFetch; }
});
console.log(JSON.stringify({ status: failures.length ? 'failed' : 'passed', contract: 'pc-agent1-chunk-integrity',
  passed, failed: failures.length, failures, production_writes: 0, real_requests: 0 }));
if (failures.length) process.exitCode = 1;
