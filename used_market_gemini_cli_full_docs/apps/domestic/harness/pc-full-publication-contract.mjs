import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrateStoredPricePublications } from '../aws-runner/pc-stored-price-publication.mjs';
import { fullPublicationScopes, assertFullPublicationActivation } from '../aws-runner/pc-publication-scopes.mjs';

const db = new DatabaseSync(':memory:');
try {
  migrateStoredPricePublications(db);
  const scope = (id, currency = 'KRW', market = 'KR_C2C_USED') => ({ canonical_product_id: id,
    market_pool: market, condition_code: 'USED_WORKING', currency, days: 30 });
  db.prepare(`INSERT INTO pc_stored_price_publications VALUES (?,?,?,?,?,?,?,?,?)`).run(
    'previous', 'previous-checksum', 1, 17, 'pc-parser-v7', 'pc-rules-v17', 'pc-filter-v6',
    '2026-09-16T12:00:00.000Z', '2026-09-16T12:01:00.000Z');
  db.prepare(`INSERT INTO pc_stored_price_publication_rows VALUES (?,?,?,?,?,?,?,?)`).run(
    'previous', 'cpu:previous-with-no-current-observation', 'KR_C2C_USED', 'USED_WORKING', 'KRW', 30,
    '2026-09-16', JSON.stringify({ active: { mean: 999_999 } }));
  const rows = fullPublicationScopes(db, [scope('ram:new'), scope('ram:new'), scope('ram:new', 'USD', 'OVERSEAS_USED')]);
  assert.equal(rows.length, 3, 'old scope identities survive; duplicate observations do not duplicate publication rows');
  assert.equal(rows.some(r => r.canonical_product_id === 'cpu:previous-with-no-current-observation'), true);
  assert.equal(rows.some(r => r.currency === 'USD'), true, 'currencies and pools stay separate');
  assert.equal(JSON.stringify(rows).includes('999999'), false, 'previous prices must NEVER be copied');
  const expected = { publication_id: 'next', checksum: 'new-checksum', expected_row_count: 3 };
  const activation = { publication_id: 'next', checksum: 'new-checksum', row_count: 3, input_row_count: 3,
    scope_key_count: 3, preserved_row_count: 0, merged_with_active: false, active: true };
  assertFullPublicationActivation(expected, activation);
  for (const change of [{ checksum: 'other' }, { row_count: 4 }, { input_row_count: 2 },
    { scope_key_count: 2 }, { preserved_row_count: 1 }, { merged_with_active: true }, { active: false }]) {
    assert.throws(() => assertFullPublicationActivation(expected, { ...activation, ...change }), /MANIFEST_MISMATCH/);
  }
  console.log(JSON.stringify({ status: 'passed', contract: 'pc-full-publication', scope_count: 3, stale_prices_reused: 0 }));
} finally { db.close(); }
