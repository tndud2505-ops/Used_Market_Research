// Audits already-downloaded READ-ONLY D1 query output. No DB client, write or
// application hashing/aggregation helper is imported.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { inspectPriceMetric, PRICE_METRICS } from './lib/pc-independent-price-audit.mjs';

const json = async path => JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/u, ''));
const [currentPath, previousPath, publicReportPath, publicRawPath, outputPath] = process.argv.slice(2);
if (!outputPath) throw new Error('USAGE: current-d1 previous-keys public-report public-raw unique-output');
const [current, previous, publicReport, publicRaw] = await Promise.all([currentPath, previousPath, publicReportPath, publicRawPath].map(json));
for (const query of [...current, ...previous]) {
  if (query.success !== true || query.meta?.rows_written !== 0 || query.meta?.changed_db !== false) throw new Error('READ_ONLY_SUCCESSFUL_D1_EVIDENCE_REQUIRED');
}
const rows = current.flatMap(query => query.results);
if (!rows.length) throw new Error('ACTIVE_PUBLICATION_MISSING');
const head = rows[0];
const failures = [];
const key = row => [row.canonical_product_id, row.market_pool, row.condition_code, row.currency, Number(row.days)].join('\0');
const canonical = rows.map(row => ({ canonical_product_id: String(row.canonical_product_id), market_pool: String(row.market_pool),
  condition_code: String(row.condition_code), currency: String(row.currency), days: Number(row.days),
  stats_json: typeof row.stats_json === 'string' ? row.stats_json : JSON.stringify(row.stats_json), as_of: String(row.as_of) }))
  .sort((left, right) => key(left).localeCompare(key(right)));
const computedChecksum = createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
if (computedChecksum !== head.publication_checksum) failures.push('D1_STORED_ROWS_CHECKSUM_MISMATCH');
if (rows.length !== head.expected_row_count) failures.push('PUBLICATION_ROW_COUNT_MISMATCH');
if (new Set(rows.map(key)).size !== rows.length) failures.push('DUPLICATE_SCOPE_KEY');
if (new Set(rows.map(row => row.as_of)).size !== 1) failures.push('MIXED_AS_OF');
if (new Set(rows.map(row => JSON.stringify([row.publication_id, row.publication_checksum, row.expected_row_count,
  row.parser_version, row.rule_version, row.filter_version]))).size !== 1) failures.push('MIXED_PUBLICATION_MANIFEST');
const records = new Map();
let metricFailures = 0, validTraceFields = 0;
const emptyHash = createHash('sha256').update('[]').digest('hex');
for (const row of rows) {
  const stats = typeof row.stats_json === 'string' ? JSON.parse(row.stats_json) : row.stats_json;
  records.set(key(row), { row, stats });
  for (const parent of [stats, ...(stats.by_source || [])]) for (const metric of PRICE_METRICS) {
    if (inspectPriceMetric(parent[metric]).problems.length) metricFailures++;
  }
  if (stats.versions?.normalization !== publicReport.expected_manifest.versions.normalization
    || stats.versions?.parser !== row.parser_version || stats.versions?.rule !== row.rule_version
    || stats.versions?.filter !== row.filter_version) failures.push(`ROW_VERSION:${key(row)}`);
  const trace = stats.traceability;
  if (Number.isSafeInteger(trace?.member_count) && trace.member_count >= 0 && /^[a-f0-9]{64}$/u.test(trace?.member_checksum || '')
    && (trace.member_count > 0 || trace.member_checksum === emptyHash)) validTraceFields++;
}
if (metricFailures) failures.push(`METRIC_POLICY_FAILURES:${metricFailures}`);
if (validTraceFields !== rows.length) failures.push('MEMBER_TRACE_FIELD_INVALID');
const beforeKeys = new Set(previous.flatMap(query => query.results).map(key));
const currentKeys = new Set(rows.map(key));
const removedKeys = [...beforeKeys].filter(value => !currentKeys.has(value)).sort();
const addedKeys = [...currentKeys].filter(value => !beforeKeys.has(value)).sort();
if (removedKeys.length) failures.push(`PREVIOUS_SCOPES_OMITTED:${removedKeys.length}`);
const publicFailures = [], missingScopes = [];
let matchedExact = 0;
const fields = ['sample_count', 'unit_count', 'min', 'max', 'mean', 'median', 'trimmed_mean', 'p25', 'p75', 'outlier_count'];
const sameMetric = (a, b) => fields.every(field => (a?.[field] ?? null) === (b?.[field] ?? null));
for (const product of publicReport.rows) {
  if (product.browse_only) continue;
  const raw = publicRaw[product.id];
  const record = records.get(key({ canonical_product_id: product.id, market_pool: 'KR_C2C_USED', condition_code: 'USED_WORKING', currency: 'KRW', days: 30 }));
  if (!record) {
    missingScopes.push({ id: product.id, category: product.category, cause: product.cause, positive_api_samples: product.has_samples });
    if (raw?.publication_id || product.has_samples) publicFailures.push(`${product.id}:NO_D1_SCOPE_BUT_PUBLIC_EVIDENCE`);
    continue;
  }
  const issues = [];
  if (raw?.publication_id !== record.row.publication_id) issues.push('PUBLICATION_ID');
  if (raw?.as_of !== record.row.as_of) issues.push('AS_OF');
  if (raw?.traceability?.member_count !== record.stats.traceability?.member_count
    || raw?.traceability?.member_checksum !== record.stats.traceability?.member_checksum) issues.push('MEMBER_TRACE');
  for (const metric of PRICE_METRICS) if (!sameMetric(raw?.[metric], record.stats[metric])) issues.push(`METRIC:${metric}`);
  for (const source of record.stats.by_source || []) {
    const publicSource = raw?.by_source?.find(item => item.source_id === source.source_id);
    if (!publicSource) issues.push(`SOURCE_MISSING:${source.source_id}`);
    else for (const metric of PRICE_METRICS) if (!sameMetric(publicSource[metric], source[metric])) issues.push(`SOURCE_METRIC:${source.source_id}:${metric}`);
  }
  if (issues.length) publicFailures.push({ id: product.id, issues });
  else matchedExact++;
}
if (publicFailures.length) failures.push(`PUBLIC_D1_MISMATCHES:${publicFailures.length}`);
const report = { checked_at: new Date().toISOString(), status: failures.length ? 'FAIL' : 'PASS',
  production_mutations: false, query_rows_written: 0, publication_id: head.publication_id, activated_at: head.activated_at,
  parser: head.parser_version, rule: head.rule_version, filter: head.filter_version, as_of: rows[0].as_of,
  expected_rows: head.expected_row_count, actual_rows: rows.length, declared_checksum: head.publication_checksum,
  computed_stored_rows_checksum: computedChecksum, checksum_matches: computedChecksum === head.publication_checksum,
  prior_scope_count: beforeKeys.size, retained_prior_scope_count: beforeKeys.size - removedKeys.length,
  removed_scope_count: removedKeys.length, added_scope_count: addedKeys.length, removed_keys: removedKeys, added_keys: addedKeys,
  failed_2086_preparation_exact_key_comparison: 'BLOCKED: that precise prepared-key snapshot is not available locally; not inferred from row counts',
  valid_member_trace_fields: validTraceFields, independent_raw_ledger_member_recomputation: 'BLOCKED: SQLite read was rejected by connector',
  public_exact_scopes_matched: matchedExact, public_d1_mismatches: publicFailures, unrepresented_public_scopes: missingScopes,
  unrepresented_scope_note: 'No D1 scope exists for the requested domestic/working/KRW/30-day tuple. This alone does not prove that all marketplaces contain zero matching listings.',
  failures };
await writeFile(outputPath, JSON.stringify(report, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ ...report, added_keys: `${addedKeys.length} identity-only keys saved to evidence`,
  unrepresented_public_scopes: missingScopes.length }, null, 2));
if (failures.length) process.exitCode = 1;
