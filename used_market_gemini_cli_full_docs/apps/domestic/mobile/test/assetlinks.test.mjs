import test from 'node:test';
import assert from 'node:assert/strict';
import { createAssetLinks } from '../scripts/assetlinks.mjs';

// Synthetic test data stays in memory; never a certificate or publishable fixture.
const synthetic = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, '0')).join(':');

test('assetlinks requires an explicit package and a complete real-format fingerprint', () => {
  for (const value of [undefined, '', 'PLAY_SIGNING_SHA256', '00:11', '00:'.repeat(31) + 'GG',
    '00:'.repeat(31) + '00', synthetic.replaceAll(':', '')]) {
    assert.throws(() => createAssetLinks('com.usedpick.app', value === undefined ? [] : [value]));
  }
  assert.throws(() => createAssetLinks('com.other;command', [synthetic]));
  assert.throws(() => createAssetLinks(undefined, [synthetic]));
});

test('assetlinks binds only the selected package; normalizes and deduplicates rotation certificates', () => {
  const [entry] = createAssetLinks('com.usedpick.app', [synthetic, synthetic.toUpperCase()]);
  assert.deepEqual(entry.relation, ['delegate_permission/common.handle_all_urls']);
  assert.equal(entry.target.package_name, 'com.usedpick.app');
  assert.equal(entry.target.namespace, 'android_app');
  assert.deepEqual(entry.target.sha256_cert_fingerprints, [synthetic.toUpperCase()]);
});
