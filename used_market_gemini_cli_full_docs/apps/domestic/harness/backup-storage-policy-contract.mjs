import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
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
  writeFileSync(`${first}.gz`, gzipSync(readFileSync(first)));
  unlinkSync(first);
  const archivedBytes = readFileSync(`${first}.gz`);
  const backupNames = readdirSync(path.dirname(first)).sort();
  for (let retry = 0; retry < 3; retry += 1) {
    assert.equal(index.createBackup(), `${first}.gz`, 'reuse the verified compressed daily backup');
  }
  assert.deepEqual(readdirSync(path.dirname(first)).sort(), backupNames, 'retries leave no new full copies or partial files');
  assert.deepEqual(readFileSync(`${first}.gz`), archivedBytes, 'retries preserve the existing recovery content');
  assert.ok(!existsSync(first), 'do not regenerate a compressed full DB backup');
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
  assert.match(service, /MemoryMax=512M/);
  const writableRoots = service.match(/^ReadWritePaths=(.+)$/mu)?.[1].trim().split(/\s+/u).sort();
  assert.deepEqual(writableRoots, ['/var/lib/used-market-runner/backups', '/var/lib/used-market-runner/staging'],
    'the recurring cleaner must not gain write access to the operating database');
  assert.match(service, /^ProtectSystem=strict$/mu);
  assert.doesNotMatch(service, /--legacy-reconcile/, 'legacy sibling cleanup remains an explicit operator action');
  console.log('backup storage policy contract passed');
} finally {
  index?.close();
  rmSync(dir, { recursive: true, force: true });
}
if (process.platform === 'linux') {
  const result = spawnSync('python3', ['-B', fileURLToPath(new URL('./backup-storage-contract.py', import.meta.url))], { stdio: 'inherit' });
  assert.equal(result.status, 0, 'Linux compression/expiry safety contract');
} else {
  console.log('SKIPPED: Linux archive contract on this platform; also run python3 -B harness/backup-storage-contract.py as root in Linux/WSL (synthetic data only, no production access).');
}
