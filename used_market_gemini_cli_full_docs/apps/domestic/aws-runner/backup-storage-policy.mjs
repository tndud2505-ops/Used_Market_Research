import { existsSync, statfsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function requiredBackupFreeBytes(databaseBytes) {
  if (!Number.isFinite(databaseBytes) || databaseBytes < 0) throw new Error('BACKUP_SIZE_INVALID');
  // VACUUM INTO writes one compact copy; leave room for concurrent WAL/growth.
  return Math.ceil(databaseBytes + Math.max(1024 ** 3, databaseBytes * 0.2));
}

export function assertBackupSpace(filePath, destinationDirectory) {
  const walPath = `${filePath}-wal`;
  const bytes = statSync(filePath).size + (existsSync(walPath) ? statSync(walPath).size : 0);
  const fs = statfsSync(destinationDirectory);
  const free = Number(fs.bavail) * Number(fs.bsize);
  const required = requiredBackupFreeBytes(bytes);
  if (free < required) throw new Error(`BACKUP_SPACE_REQUIRED:${required}:AVAILABLE:${free}`);
  return { database_bytes: bytes, free_bytes: free, required_bytes: required };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const option = name => process.argv[process.argv.indexOf(name) + 1];
  const database = process.argv.includes('--db') ? option('--db') : '/var/lib/used-market-runner/search-index.sqlite';
  const destination = process.argv.includes('--backup-dir') ? option('--backup-dir') : path.dirname(database);
  try {
    if (process.argv.includes('--db') && (!database || database.startsWith('--') || !existsSync(database))) {
      throw new Error('BACKUP_DATABASE_NOT_FOUND');
    }
    console.log(JSON.stringify(existsSync(database) ? assertBackupSpace(database, destination)
      : { initial_install: true, database_exists: false }));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
