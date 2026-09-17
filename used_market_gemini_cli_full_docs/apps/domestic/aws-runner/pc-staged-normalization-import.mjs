import { realpathSync } from 'node:fs';

const quote = name => `"${String(name).replaceAll('"', '""')}"`;
const tables = ['listing_snapshots', 'raw_listings', 'normalized_listings', 'listing_items'];

/**
 * Reuse validated normalization work without replacing the live database.
 * Reused original observations must be byte-for-byte equal. New live observations are
 * deliberately not imported and must be normalized by the ordinary catch-up pass.
 * Neither publication previews nor collection success records are copied.
 */
export function importStagedNormalizations({ ledger, stagingPath, versions, expectedSnapshotCount, reuseUnchangedOnly = false }) {
  if (!ledger?.db || !Number.isInteger(expectedSnapshotCount) || expectedSnapshotCount < 1
    || !Number.isInteger(versions?.normalizationVersion) || versions.normalizationVersion < 2
    || typeof reuseUnchangedOnly !== 'boolean') {
    throw new Error('STAGED_IMPORT_ARGUMENTS_INVALID');
  }
  const db = ledger.db;
  const file = realpathSync(stagingPath);
  const databases = db.prepare('PRAGMA database_list').all();
  if (databases.some(d => d.name === 'pc_validated_stage' || (d.file && realpathSync(d.file) === file))) {
    throw new Error('STAGED_IMPORT_DATABASE_COLLISION');
  }
  const parameters = [versions.normalizationVersion, versions.parserVersion, versions.ruleVersion, versions.filterVersion];
  const versionWhere = 'normalization_version = ? AND parser_version = ? AND rule_version = ? AND filter_version = ?';
  const columns = new Map();
  db.prepare('ATTACH DATABASE ? AS pc_validated_stage').run(file);
  let transaction = false;
  try {
    db.exec('BEGIN IMMEDIATE'); transaction = true;
    for (const table of tables) {
      const live = db.prepare(`PRAGMA main.table_info(${quote(table)})`).all();
      const stage = db.prepare(`PRAGMA pc_validated_stage.table_info(${quote(table)})`).all();
      if (!live.length || JSON.stringify(live.map(r => [r.name, r.type])) !== JSON.stringify(stage.map(r => [r.name, r.type]))) {
        throw new Error(`STAGED_IMPORT_SCHEMA_MISMATCH:${table}`);
      }
      columns.set(table, live.map(r => r.name));
    }
    const sealed = db.prepare(`SELECT * FROM pc_validated_stage.pc_pipeline_versions WHERE ${versionWhere} AND version_status = 'ACTIVE'`).get(...parameters);
    const quality = sealed?.quality_report_json ? JSON.parse(sealed.quality_report_json) : null;
    if (!sealed || sealed.model_version !== versions.modelVersion || !quality
      || Object.keys(quality.targets || {}).length < 6 || Object.values(quality.targets).some(t => t.met !== true)
      || Object.values(quality.integrity_blockers || {}).some(v => Number(v) > 0)) throw new Error('STAGED_IMPORT_QUALITY_NOT_SEALED');
    const existing = db.prepare('SELECT COUNT(*) AS n FROM main.normalized_listings WHERE normalization_version = ?').get(versions.normalizationVersion).n;
    if (existing !== 0) throw new Error('STAGED_IMPORT_TARGET_ALREADY_EXISTS');
    const sourceCount = db.prepare('SELECT COUNT(*) AS n FROM pc_validated_stage.listing_snapshots').get().n;
    const normalizedCount = db.prepare(`SELECT COUNT(DISTINCT snapshot_id) AS n FROM pc_validated_stage.normalized_listings WHERE ${versionWhere}`).get(...parameters).n;
    if (sourceCount !== expectedSnapshotCount || normalizedCount !== sourceCount) throw new Error('STAGED_IMPORT_COVERAGE_INCOMPLETE');
    // Strict mode still rejects every source mismatch. The explicitly selected
    // partial mode does NOT relax comparisons: changed rows are left unimported
    // for ordinary reclassification against the current production observation.
    for (const table of reuseUnchangedOnly ? [] : ['listing_snapshots', 'raw_listings']) {
      const different = columns.get(table).map(c => `s.${quote(c)} IS NOT p.${quote(c)}`).join(' OR ');
      const referenced = table === 'raw_listings'
        ? 'JOIN (SELECT DISTINCT raw_listing_id FROM pc_validated_stage.listing_snapshots) required ON required.raw_listing_id = s.id' : '';
      const mismatch = db.prepare(`SELECT s.id FROM pc_validated_stage.${quote(table)} s ${referenced}
        LEFT JOIN main.${quote(table)} p ON p.id = s.id WHERE p.id IS NULL OR ${different} LIMIT 1`).get();
      if (mismatch) throw new Error(`STAGED_IMPORT_OBSERVATION_MISMATCH:${table}:${mismatch.id}`);
    }
    const snapshotEqual = columns.get('listing_snapshots').map(c => `s.${quote(c)} IS p.${quote(c)}`).join(' AND ');
    const rawEqual = columns.get('raw_listings').map(c => `sr.${quote(c)} IS pr.${quote(c)}`).join(' AND ');
    db.exec(`CREATE TEMP TABLE pc_stage_reusable_snapshots (snapshot_id INTEGER PRIMARY KEY)`);
    db.exec(`INSERT INTO pc_stage_reusable_snapshots
      SELECT s.id FROM pc_validated_stage.listing_snapshots s
      JOIN main.listing_snapshots p ON p.id = s.id
      JOIN pc_validated_stage.raw_listings sr ON sr.id = s.raw_listing_id
      JOIN main.raw_listings pr ON pr.id = p.raw_listing_id
      WHERE ${snapshotEqual} AND ${rawEqual}`);
    const reusableCount = Number(db.prepare('SELECT COUNT(*) AS n FROM pc_stage_reusable_snapshots').get().n);
    if (reusableCount === 0 || (!reuseUnchangedOnly && reusableCount !== expectedSnapshotCount)) {
      throw new Error('STAGED_IMPORT_NO_VERIFIED_REUSABLE_ROWS');
    }
    const normalizationColumns = columns.get('normalized_listings').filter(c => c !== 'id').map(quote).join(', ');
    const inserted = db.prepare(`INSERT INTO main.normalized_listings (${normalizationColumns})
      SELECT ${normalizationColumns} FROM pc_validated_stage.normalized_listings WHERE ${versionWhere}
        AND snapshot_id IN (SELECT snapshot_id FROM pc_stage_reusable_snapshots)`).run(...parameters);
    const itemColumns = columns.get('listing_items').filter(c => c !== 'id');
    const selected = itemColumns.map(c => c === 'normalized_listing_id' ? 'p.id' : `i.${quote(c)}`).join(', ');
    const insertedItems = db.prepare(`INSERT INTO main.listing_items (${itemColumns.map(quote).join(', ')})
      SELECT ${selected} FROM pc_validated_stage.listing_items i
      JOIN pc_validated_stage.normalized_listings s ON s.id = i.normalized_listing_id
      JOIN main.normalized_listings p ON p.snapshot_id = s.snapshot_id
        AND p.normalization_version = s.normalization_version AND p.parser_version = s.parser_version
        AND p.rule_version = s.rule_version AND p.filter_version = s.filter_version
      WHERE s.normalization_version = ? AND s.parser_version = ? AND s.rule_version = ? AND s.filter_version = ?`).run(...parameters);
    if (Number(inserted.changes) !== reusableCount) throw new Error('STAGED_IMPORT_ROW_COUNT_MISMATCH');
    db.exec('DROP TABLE temp.pc_stage_reusable_snapshots');
    db.exec('COMMIT'); transaction = false;
    return { imported_snapshots: Number(inserted.changes), imported_items: Number(insertedItems.changes),
      deferred_changed_snapshots: expectedSnapshotCount - reusableCount,
      comparison_policy: 'ALL_SOURCE_COLUMNS_EXACT', reuse_unchanged_only: reuseUnchangedOnly,
      source_observations_changed: 0, copied_publications: 0 };
  } catch (error) {
    if (transaction) { try { db.exec('ROLLBACK'); } catch {} transaction = false; }
    throw error;
  } finally {
    db.exec('DETACH DATABASE pc_validated_stage');
  }
}
