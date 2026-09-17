import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrateStoredPricePublications } from '../aws-runner/pc-stored-price-publication.mjs';
import { fullPublicationScopes } from '../aws-runner/pc-publication-scopes.mjs';

const db = new DatabaseSync(':memory:');
const now = Date.parse('2026-09-17T05:30:00.000Z');
const scope = (id, currency = 'KRW', pool = 'KR_C2C_USED') => ({ canonical_product_id: id, market_pool: pool,
  condition_code: 'USED_WORKING', currency, days: 30 });
try {
  migrateStoredPricePublications(db);
  assert.throws(() => fullPublicationScopes(db, [scope('ram:new')]), /EXTERNAL_ACTIVE_SCOPES_REQUIRED/,
    'zero local publications cannot silently omit the external predecessor');
  const externalActive = { publication_id: 'd1-before', checksum: 'a'.repeat(64), checked_at: new Date(now).toISOString(), row_count: 2,
    scopes: [{ ...scope('cpu:old'), stats_json: { active: { mean: 999999 } } }, scope('ram:old', 'USD', 'OVERSEAS_USED')] };
  const result = fullPublicationScopes(db, [scope('ram:new'), scope('ram:new')], { externalActive, now });
  assert.equal(result.length, 3);
  assert.ok(result.some(row => row.canonical_product_id === 'cpu:old'));
  assert.equal(JSON.stringify(result).includes('999999'), false, 'only identities cross the bootstrap boundary');
  assert.equal(result.filter(row => row.currency === 'USD').length, 1);
  for (const changed of [
    { row_count: 3 }, { checked_at: '2026-09-17T05:00:00.000Z' }, { checksum: '' },
    { scopes: [scope('cpu:old'), scope('cpu:old')] },
    { scopes: [scope('cpu:old'), { ...scope('ram:old'), days: 7 }] },
    { scopes: [scope('cpu:old'), { ...scope('ram:old'), publication_id: 'another' }] }
  ]) assert.throws(() => fullPublicationScopes(db, [], { externalActive: { ...externalActive, ...changed }, now }));
  const firstInstall = { publication_id: null, checksum: null, row_count: 0, scopes: [], checked_at: new Date(now).toISOString() };
  assert.deepEqual(fullPublicationScopes(db, [scope('ram:first')], { externalActive: firstInstall, now }), [scope('ram:first')]);
  console.log(JSON.stringify({ status: 'passed', contract: 'agent3-publication-bootstrap', synthetic_only: true,
    external_scopes_retained: 2, copied_price_values: 0, malformed_and_stale_manifests_rejected: true }));
} finally { db.close(); }
