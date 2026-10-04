import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SearchIndex } from '../aws-runner/search-index.mjs';
import { requiredBackupFreeBytes } from '../aws-runner/backup-storage-policy.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dir = mkdtempSync(path.join(os.tmpdir(), 'used-backup-contract-'));
let index;
try {
  const dbPath = path.join(dir, 'search-index.sqlite');
  index = new SearchIndex({ filePath: dbPath, now: () => Date.parse('2026-10-04T12:00:00Z') });
  const first = index.createBackup();
  assert.ok(existsSync(first));
  assert.equal(index.createBackup(), first, 'same-day requests reuse one completed recovery point');
  const recovery = path.join(dir, 'backups', 'search-index-pre-migration-v9.sqlite');
  writeFileSync(recovery, 'retained recovery evidence');
  assert.deepEqual(index.pruneBackups(), [], 'only validated offline maintenance may expire backups');
  assert.ok(existsSync(recovery), 'daily quota never deletes a migration recovery point');
  assert.equal(requiredBackupFreeBytes(1024 ** 3), 2 * 1024 ** 3);
  assert.equal(requiredBackupFreeBytes(10 * 1024 ** 3), 12 * 1024 ** 3);
  assert.throws(() => requiredBackupFreeBytes(NaN), /SIZE_INVALID/);
  const preflight = fileURLToPath(new URL('../aws-runner/backup-storage-policy.mjs', import.meta.url));
  assert.equal(spawnSync(process.execPath, [preflight, '--db', dbPath]).status, 0);
  assert.notEqual(spawnSync(process.execPath, [preflight, '--db', path.join(dir, 'missing.sqlite')]).status, 0,
    'an explicit wrong database target must not pass preflight as a new install');
  const installer = readFileSync(new URL('../aws-runner/install-ubuntu24.sh', import.meta.url), 'utf8');
  assert.match(installer, /bash "\$APP_ROOT\/aws-runner\/install-backup-storage\.sh"/);
  const maintenance = readFileSync(new URL('../aws-runner/maintain-backup-storage.py', import.meta.url), 'utf8');
  assert.doesNotMatch(maintenance, /shutil\.rmtree|VACUUM|DELETE FROM|systemctl.*stop/);
  const service = readFileSync(new URL('../aws-runner/used-market-backup-storage.service', import.meta.url), 'utf8');
  assert.match(service, /--daily --apply/);
  assert.match(service, /MemoryMax=128M/);
  console.log('backup storage policy contract passed');
} finally {
  index?.close();
  rmSync(dir, { recursive: true, force: true });
}
if (process.platform === 'linux') {
  const result = spawnSync('python3', [fileURLToPath(new URL('./backup-storage-contract.py', import.meta.url))], { stdio: 'inherit' });
  assert.equal(result.status, 0, 'Linux compression/expiry safety contract');
} else {
  console.log('Linux archive contract must also run on the deployment host (fcntl and /proc).');
}
