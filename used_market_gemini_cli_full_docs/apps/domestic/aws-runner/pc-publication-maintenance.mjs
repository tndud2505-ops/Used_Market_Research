import { DatabaseSync } from 'node:sqlite';

export function assertPublicationBackup(file, publication) {
  // A compressed same-day recovery copy may predate this publication. Do not
  // duplicate/decompress the full DB merely to enable cleanup: defer cleanup.
  if (!file || file.endsWith('.gz')) throw new Error('PC_STORAGE_BACKUP_PUBLICATION_UNVERIFIED');
  const backup = new DatabaseSync(file, { readOnly: true });
  try {
    const row = backup.prepare("SELECT publication_id, checksum, row_count FROM pc_publication_runtime WHERE publication_kind = 'PRODUCT_STATS'").get();
    if (row?.publication_id !== publication.publication_id || row?.checksum !== publication.checksum
      || Number(row?.row_count) !== Number(publication.row_count)) throw new Error('PC_STORAGE_BACKUP_PUBLICATION_MISMATCH');
  } finally { backup.close(); }
}

export function maintainPublishedStats(index, ledger, publication, publishedAt) {
  try {
    const storageCompactionBackup = index.createBackup();
    if (!storageCompactionBackup) throw new Error('PC_STORAGE_COMPACTION_BACKUP_REQUIRED');
    assertPublicationBackup(storageCompactionBackup, publication);
    const storageCompaction = ledger.compactStorage({
      asOf: new Date(publishedAt), observationRetentionDays: 30, pruneObservationDetails: true
    });
    return { storage_maintenance_ok: true, storage_compaction_backup: storageCompactionBackup, storage_compaction: storageCompaction };
  } catch (error) {
    // Publication is already authoritative. Keep this failure separate, and
    // never compact without the matching recovery copy or republish on its own.
    console.error(JSON.stringify({ phase: 'post_publication_maintenance_failed', error: error.message }));
    return { storage_maintenance_ok: false, storage_compaction: null, storage_maintenance_error: error.message };
  }
}
