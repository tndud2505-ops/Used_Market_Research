function canonicalRows(rows) {
  return [...rows]
    .map((row) => ({
      canonical_product_id: String(row.canonical_product_id),
      market_pool: String(row.market_pool),
      condition_code: String(row.condition_code),
      currency: String(row.currency),
      days: Number(row.days),
      stats_json: typeof row.stats_json === "string" ? row.stats_json : JSON.stringify(row.stats_json),
      as_of: String(row.as_of)
    }))
    .sort((left, right) => statsPublicationKey(left).localeCompare(statsPublicationKey(right)));
}

export function statsPublicationKey(row) {
  return [row.canonical_product_id, row.market_pool, row.condition_code, row.currency, Number(row.days)].join("\u0000");
}

export function statsPublicationBoundaryKey(row) {
  return JSON.stringify([
    String(row.canonical_product_id), String(row.market_pool), String(row.condition_code),
    String(row.currency), Number(row.days)
  ]);
}

function boundaryKeyForComparison(value) {
  const fields = JSON.parse(String(value));
  if (!Array.isArray(fields) || fields.length !== 5) throw new Error("invalid publication chunk boundary");
  return fields.map(String).join("\u0000");
}

function dailyMetricHasEvidence(metric) {
  if (!metric || typeof metric !== "object") return false;
  if (Number(metric.sample_count || 0) > 0 || Number(metric.unit_count || 0) > 0) return true;
  return ["min", "max", "mean", "median", "trimmed_mean", "p25", "p75", "seven_day_sold_median"]
    .some((key) => Number.isFinite(Number(metric[key])) && metric[key] !== null);
}

function compactDailyRows(rows) {
  return (Array.isArray(rows) ? rows : []).filter((row) => (
    dailyMetricHasEvidence(row?.active)
    || dailyMetricHasEvidence(row?.reserved)
    || dailyMetricHasEvidence(row?.sold)
    || dailyMetricHasEvidence(row?.confirmed_transactions)
  ));
}

export function compactStatsForPublication(stats) {
  if (!stats || typeof stats !== "object" || Array.isArray(stats)) return stats;
  return {
    ...stats,
    daily: compactDailyRows(stats.daily),
    by_source: (Array.isArray(stats.by_source) ? stats.by_source : []).map((entry) => ({
      ...entry,
      daily: compactDailyRows(entry?.daily)
    }))
  };
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function statsChecksum(rows) {
  return sha256(JSON.stringify(canonicalRows(rows)));
}

function canonicalChunkManifest(chunks) {
  return [...(Array.isArray(chunks) ? chunks : [])]
    .map((chunk) => ({
      chunk_index: Number(chunk.chunk_index),
      expected_chunk_count: Number(chunk.expected_chunk_count),
      chunk_checksum: String(chunk.chunk_checksum || ""),
      row_count: Number(chunk.row_count),
      non_empty_scope_count: Number(chunk.non_empty_scope_count),
      first_scope_key: String(chunk.first_scope_key || ""),
      last_scope_key: String(chunk.last_scope_key || "")
    }))
    .sort((left, right) => left.chunk_index - right.chunk_index);
}

export async function statsChunkManifestChecksum(chunks) {
  return sha256(JSON.stringify(canonicalChunkManifest(chunks)));
}

export async function readActiveProductStatsScopes(db) {
  // D1 batch supplies one consistent read transaction; never export prices.
  const results = await db.batch([
    db.prepare(`SELECT publication_id, checksum, expected_row_count
      FROM public_stats_publications WHERE active = 1`),
    db.prepare(`SELECT s.canonical_product_id, s.market_pool, s.condition_code,
        s.currency, s.days
      FROM public_product_stats s JOIN public_stats_publications p
        ON p.publication_id = s.publication_id AND p.active = 1`)
  ]);
  const activeRows = results[0]?.results || [];
  const scopes = results[1]?.results || [];
  if (activeRows.length > 1) throw new Error('active publication identity is ambiguous');
  const active = activeRows[0];
  if (!active) {
    if (scopes.length) throw new Error('orphan active publication scopes');
    return { publication_id: null, checksum: null, row_count: 0, scopes: [], checked_at: new Date().toISOString() };
  }
  if (!active.publication_id || !/^[a-f0-9]{64}$/u.test(active.checksum)
    || Number(active.expected_row_count) !== scopes.length
    || new Set(scopes.map(statsPublicationKey)).size !== scopes.length) {
    throw new Error('active publication scope manifest is inconsistent');
  }
  return { publication_id: active.publication_id, checksum: active.checksum,
    row_count: scopes.length, scopes, checked_at: new Date().toISOString() };
}

function nonEmptyScopeCount(rows) {
  return rows.filter((row) => {
    let stats;
    try { stats = JSON.parse(row.stats_json); } catch { return false; }
    return Number(stats?.active?.sample_count || 0) + Number(stats?.sold?.sample_count || 0)
      + Number(stats?.reserved?.sample_count || 0)
      + Number(stats?.confirmed_transactions?.sample_count || 0) > 0;
  }).length;
}

function validateStatsRows(rows, parserVersion, ruleVersion, filterVersion, context = "publication") {
  for (const row of rows) {
    let parsedStats;
    try { parsedStats = JSON.parse(row.stats_json); } catch { throw new Error(`${context} stats_json is invalid`); }
    const versions = parsedStats?.versions;
    if (versions?.parser !== parserVersion
      || versions?.rule !== ruleVersion
      || versions?.filter !== filterVersion) {
      throw new Error(`${context} contains mixed rule versions`);
    }
    const bySource = Array.isArray(parsedStats?.by_source) ? parsedStats.by_source : [];
    const sourceIds = bySource.map((entry) => String(entry?.source_id || ""));
    if (sourceIds.some((sourceId) => !sourceId) || new Set(sourceIds).size !== sourceIds.length) {
      throw new Error(`${context} contains duplicate or invalid source statistics`);
    }
    if (sourceIds.some((sourceId, index) => index > 0 && sourceIds[index - 1].localeCompare(sourceId) > 0)) {
      throw new Error(`${context} source statistics must be sorted`);
    }
  }
}

function publicationMetadata(input) {
  return {
    publicationId: String(input.publication_id || ""),
    checksum: String(input.checksum || ""),
    expectedRowCount: Number(input.expected_row_count),
    expectedNonEmptyScopeCount: Number(input.expected_non_empty_scope_count),
    parserVersion: String(input.parser_version || ""),
    ruleVersion: String(input.rule_version || ""),
    filterVersion: String(input.filter_version || ""),
    createdAt: String(input.created_at || "")
  };
}

function assertPublicationMetadata(input, stored) {
  const metadata = publicationMetadata(input);
  if (!metadata.publicationId || !/^[a-f0-9]{64}$/u.test(metadata.checksum)
    || !Number.isSafeInteger(metadata.expectedRowCount) || metadata.expectedRowCount < 1
    || !Number.isSafeInteger(metadata.expectedNonEmptyScopeCount) || metadata.expectedNonEmptyScopeCount < 1
    || metadata.expectedNonEmptyScopeCount > metadata.expectedRowCount || !metadata.parserVersion
    || !metadata.ruleVersion || !metadata.filterVersion || !Number.isFinite(Date.parse(metadata.createdAt))) {
    throw new Error("invalid staged publication metadata");
  }
  if (stored && (String(stored.publication_id) !== metadata.publicationId
    || String(stored.checksum) !== metadata.checksum
    || Number(stored.expected_row_count) !== metadata.expectedRowCount
    || Number(stored.expected_non_empty_scope_count) !== metadata.expectedNonEmptyScopeCount
    || String(stored.parser_version) !== metadata.parserVersion
    || String(stored.rule_version) !== metadata.ruleVersion
    || String(stored.filter_version) !== metadata.filterVersion
    || String(stored.created_at) !== metadata.createdAt)) {
    throw new Error("staged publication metadata mismatch");
  }
  return metadata;
}

function validateChunkRowContract(rows, input, metadata) {
  const normalization = Number(input.normalization_version);
  if (!Number.isSafeInteger(normalization) || normalization < 1) throw new Error("invalid publication normalization version");
  validateStatsRows(rows, metadata.parserVersion, metadata.ruleVersion, metadata.filterVersion, "publication chunk");
  for (const row of rows) {
    if (row.days !== 30 || ['canonical_product_id', 'market_pool', 'condition_code', 'currency']
      .some(key => !row[key] || row[key] !== row[key].trim() || row[key].includes('\u0000'))) {
      throw new Error("invalid publication scope identity");
    }
    if (row.as_of !== metadata.createdAt) throw new Error("publication as_of timestamp mismatch");
    const stats = JSON.parse(row.stats_json);
    if (stats?.versions?.normalization !== normalization) throw new Error("publication normalization version mismatch");
    if (!Number.isSafeInteger(stats?.traceability?.member_count) || stats.traceability.member_count < 0
      || !/^[a-f0-9]{64}$/u.test(stats?.traceability?.member_checksum || '')) {
      throw new Error("publication member traceability is incomplete");
    }
  }
}

async function verifyStagedContent(db, input, metadata) {
  // A hash of chunk descriptors does not prove the claimed complete row hash.
  // Re-read immutable staging in canonical key order and hash the exact same
  // JSON byte sequence as statsChecksum, without allocating the full payload.
  const result = await db.prepare(`SELECT rowid AS storage_rowid,
      canonical_product_id, market_pool, condition_code, currency, days,
      length(CAST(stats_json AS BLOB)) AS stats_bytes
    FROM public_product_stats WHERE publication_id = ?`).bind(metadata.publicationId).all();
  const identities = [...(Array.isArray(result?.results) ? result.results : result || [])]
    .sort((left, right) => statsPublicationKey(left).localeCompare(statsPublicationKey(right)));
  const keys = identities.map(statsPublicationKey);
  if (identities.length !== metadata.expectedRowCount || new Set(keys).size !== keys.length) {
    throw new Error("staged publication scope count mismatch");
  }
  const pages = [];
  let page = [];
  let pageBytes = 0;
  for (const identity of identities) {
    const bytes = Number(identity.stats_bytes);
    if (!Number.isSafeInteger(Number(identity.storage_rowid)) || !Number.isSafeInteger(bytes)
      || bytes < 1 || bytes > 2_000_000) throw new Error("staged publication row size is invalid");
    if (page.length && (page.length >= 80 || pageBytes + bytes > 2_097_152)) {
      pages.push(page); page = []; pageBytes = 0;
    }
    page.push(identity); pageBytes += bytes;
  }
  if (page.length) pages.push(page);
  // Leave room for metadata, predecessor and the final atomic pointer batch.
  // Exceeding this bounded verification budget is a failure, never a skip.
  if (pages.length > 35) throw new Error("staged publication verification query budget exceeded");
  const { createHash } = await import('node:crypto');
  const digest = createHash('sha256');
  digest.update('[');
  let count = 0;
  let sampled = 0;
  for (const identitiesPage of pages) {
    const pageResult = await db.prepare(`SELECT canonical_product_id, market_pool,
        condition_code, currency, days, stats_json, as_of
      FROM public_product_stats WHERE publication_id = ?
        AND rowid IN (${identitiesPage.map(() => '?').join(',')})`)
      .bind(metadata.publicationId, ...identitiesPage.map(identity => identity.storage_rowid)).all();
    const storedRows = canonicalRows(Array.isArray(pageResult?.results) ? pageResult.results : pageResult || []);
    if (storedRows.length !== identitiesPage.length || storedRows.some((row, i) =>
      statsPublicationKey(row) !== statsPublicationKey(identitiesPage[i]))) {
      throw new Error("staged publication scope changed during verification");
    }
    validateChunkRowContract(storedRows, input, metadata);
    sampled += nonEmptyScopeCount(storedRows);
    for (const row of storedRows) {
      if (count > 0) digest.update(',');
      digest.update(JSON.stringify(row));
      count += 1;
    }
  }
  digest.update(']');
  if (digest.digest('hex') !== metadata.checksum) throw new Error("staged publication full row checksum mismatch");
  if (count !== metadata.expectedRowCount || sampled !== metadata.expectedNonEmptyScopeCount) {
    throw new Error("staged publication stored sample count mismatch");
  }
  return { keys, pages: pages.length };
}

export async function stageProductStatsChunk(db, input) {
  if (input.merge_with_active !== false) throw new Error("chunked publication must replace the complete active publication");
  const metadata = assertPublicationMetadata(input, null);
  const chunkIndex = Number(input.chunk_index);
  const expectedChunkCount = Number(input.expected_chunk_count);
  const inputRows = canonicalRows(input.rows || []);
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0
    || !Number.isInteger(expectedChunkCount) || expectedChunkCount < 1 || chunkIndex >= expectedChunkCount) {
    throw new Error("invalid publication chunk position");
  }
  if (inputRows.length < 1 || inputRows.length > 40) throw new Error("publication chunk must contain 1 to 40 rows");
  const keys = inputRows.map(statsPublicationKey);
  if (new Set(keys).size !== keys.length) throw new Error("publication chunk contains duplicate scope keys");
  const chunkChecksum = await statsChecksum(inputRows);
  const chunkNonEmptyScopeCount = nonEmptyScopeCount(inputRows);
  if (chunkChecksum !== String(input.chunk_checksum || "")
    || inputRows.length !== Number(input.chunk_row_count)
    || chunkNonEmptyScopeCount !== Number(input.chunk_non_empty_scope_count)
    || statsPublicationBoundaryKey(inputRows[0]) !== String(input.first_scope_key || "")
    || statsPublicationBoundaryKey(inputRows.at(-1)) !== String(input.last_scope_key || "")) {
    throw new Error("publication chunk manifest mismatch");
  }
  validateChunkRowContract(inputRows, input, metadata);

  let stored = await db.prepare(`SELECT publication_id, checksum, expected_row_count,
      expected_non_empty_scope_count, parser_version, rule_version, filter_version, created_at, active
    FROM public_stats_publications WHERE publication_id = ?`).bind(metadata.publicationId).first();
  if (!stored) {
    await db.prepare(`INSERT INTO public_stats_publications (
        publication_id, checksum, expected_row_count, expected_non_empty_scope_count,
        parser_version, rule_version, filter_version, created_at, active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`).bind(
      metadata.publicationId, metadata.checksum, metadata.expectedRowCount,
      metadata.expectedNonEmptyScopeCount, metadata.parserVersion, metadata.ruleVersion,
      metadata.filterVersion, metadata.createdAt
    ).run();
    stored = { ...input, active: 0 };
  }
  assertPublicationMetadata(input, stored);
  if (Number(stored.active) !== 0) throw new Error("publication is already active");

  const existingChunk = await db.prepare(`SELECT chunk_index, expected_chunk_count, chunk_checksum,
      row_count, non_empty_scope_count, first_scope_key, last_scope_key
    FROM public_stats_publication_chunks WHERE publication_id = ? AND chunk_index = ?`)
    .bind(metadata.publicationId, chunkIndex).first();
  if (existingChunk) {
    const expected = canonicalChunkManifest([{
      chunk_index: chunkIndex, expected_chunk_count: expectedChunkCount,
      chunk_checksum: chunkChecksum, row_count: inputRows.length,
      non_empty_scope_count: chunkNonEmptyScopeCount,
      first_scope_key: statsPublicationBoundaryKey(inputRows[0]),
      last_scope_key: statsPublicationBoundaryKey(inputRows.at(-1))
    }])[0];
    const actual = canonicalChunkManifest([existingChunk])[0];
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("staged publication chunk conflict");
    return { publication_id: metadata.publicationId, chunk_index: chunkIndex, already_staged: true };
  }

  const statements = inputRows.map((row) => db.prepare(`INSERT INTO public_product_stats (
      publication_id, canonical_product_id, market_pool, condition_code, currency, days, stats_json, as_of
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      metadata.publicationId, row.canonical_product_id, row.market_pool, row.condition_code,
      row.currency, row.days, row.stats_json, row.as_of
    ));
  statements.push(db.prepare(`INSERT INTO public_stats_publication_chunks (
      publication_id, chunk_index, expected_chunk_count, chunk_checksum, row_count,
      non_empty_scope_count, first_scope_key, last_scope_key, staged_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      metadata.publicationId, chunkIndex, expectedChunkCount, chunkChecksum, inputRows.length,
      chunkNonEmptyScopeCount, statsPublicationBoundaryKey(inputRows[0]),
      statsPublicationBoundaryKey(inputRows.at(-1)), new Date().toISOString()
    ));
  await db.batch(statements);
  return { publication_id: metadata.publicationId, chunk_index: chunkIndex, already_staged: false };
}

export async function activateStagedProductStats(db, input) {
  if (input.merge_with_active !== false) throw new Error("chunked publication must replace the complete active publication");
  const stored = await db.prepare(`SELECT publication_id, checksum, expected_row_count,
      expected_non_empty_scope_count, parser_version, rule_version, filter_version, created_at, active
    FROM public_stats_publications WHERE publication_id = ?`).bind(String(input.publication_id || "")).first();
  if (!stored) throw new Error("staged publication was not found");
  const metadata = assertPublicationMetadata(input, stored);
  if (Number(stored.active) !== 0) throw new Error("publication is already active");

  const chunkResult = await db.prepare(`SELECT chunk_index, expected_chunk_count, chunk_checksum,
      row_count, non_empty_scope_count, first_scope_key, last_scope_key
    FROM public_stats_publication_chunks WHERE publication_id = ? ORDER BY chunk_index`)
    .bind(metadata.publicationId).all();
  const chunks = canonicalChunkManifest(Array.isArray(chunkResult?.results) ? chunkResult.results : chunkResult || []);
  const expectedChunkCount = Number(input.expected_chunk_count);
  if (!Number.isInteger(expectedChunkCount) || expectedChunkCount < 1 || chunks.length !== expectedChunkCount
    || chunks.some((chunk, index) => chunk.chunk_index !== index || chunk.expected_chunk_count !== expectedChunkCount)) {
    throw new Error("staged publication chunk count mismatch");
  }
  if (chunks.some((chunk, index) => index > 0
    && boundaryKeyForComparison(chunks[index - 1].last_scope_key)
      .localeCompare(boundaryKeyForComparison(chunk.first_scope_key)) >= 0)) {
    throw new Error("staged publication chunk scope order mismatch");
  }
  if (await statsChunkManifestChecksum(chunks) !== String(input.chunk_manifest_checksum || "")) {
    throw new Error("staged publication chunk checksum mismatch");
  }
  const stagedRowCount = chunks.reduce((total, chunk) => total + chunk.row_count, 0);
  const stagedNonEmptyScopeCount = chunks.reduce((total, chunk) => total + chunk.non_empty_scope_count, 0);
  if (stagedRowCount !== metadata.expectedRowCount
    || stagedNonEmptyScopeCount !== metadata.expectedNonEmptyScopeCount) {
    throw new Error("staged publication aggregate manifest mismatch");
  }
  const verified = await db.prepare(`SELECT COUNT(*) AS count
    FROM public_product_stats WHERE publication_id = ?`).bind(metadata.publicationId).first();
  if (Number(verified?.count) !== metadata.expectedRowCount) throw new Error("staged publication row count mismatch");

  const verifiedContent = await verifyStagedContent(db, input, metadata);

  const active = await db.prepare(`SELECT publication_id, checksum, expected_row_count,
      expected_non_empty_scope_count FROM public_stats_publications WHERE active = 1`).first();
  if (Object.hasOwn(input, 'expected_previous_publication')) {
    const expected = input.expected_previous_publication;
    if (!expected || expected.publication_id !== (active?.publication_id ?? null)
      || expected.checksum !== (active?.checksum ?? null)) {
      throw new Error('active publication predecessor changed; prepare a fresh complete publication');
    }
  }
  const actualKeys = verifiedContent.keys;
  let removedActiveScopeKeys = [];
  if (active?.publication_id) {
    const activeKeyResult = await db.prepare(`SELECT canonical_product_id, market_pool, condition_code, currency, days
      FROM public_product_stats WHERE publication_id = ?`).bind(active.publication_id).all();
    const actualKeySet = new Set(actualKeys);
    removedActiveScopeKeys = (Array.isArray(activeKeyResult?.results) ? activeKeyResult.results : activeKeyResult || [])
      .map(statsPublicationKey).filter((key) => !actualKeySet.has(key));
  }
  let scopeSchemaMigrationApplied = false;
  if (removedActiveScopeKeys.length > 0 || Number(active?.expected_row_count || 0) > metadata.expectedRowCount) {
    const migration = input.scope_schema_migration;
    const reason = String(migration?.reason || "").trim();
    scopeSchemaMigrationApplied = Boolean(active?.publication_id)
      && migration && typeof migration === "object" && !Array.isArray(migration)
      && String(migration.previous_publication_id || "") === String(active.publication_id)
      && String(migration.previous_checksum || "") === String(active.checksum)
      && Number(migration.expected_removed_scope_count) === removedActiveScopeKeys.length
      && Number.isFinite(Date.parse(String(migration.reviewed_at || "")))
      && reason.length >= 20 && reason.length <= 500;
    if (!scopeSchemaMigrationApplied) throw new Error("publication scope shrink requires an explicit schema migration");
  }
  const previousNonEmptyScopeCount = Number(active?.expected_non_empty_scope_count || 0);
  let sampleDropAcknowledged = false;
  if (previousNonEmptyScopeCount > 0
    && metadata.expectedNonEmptyScopeCount < Math.max(1, Math.floor(previousNonEmptyScopeCount * 0.5))) {
    const acknowledgement = input.sample_drop_acknowledgement;
    const reason = String(acknowledgement?.reason || "").trim();
    sampleDropAcknowledged = Boolean(active?.publication_id)
      && acknowledgement && typeof acknowledgement === "object" && !Array.isArray(acknowledgement)
      && String(acknowledgement.previous_publication_id || "") === String(active.publication_id)
      && String(acknowledgement.previous_checksum || "") === String(active.checksum)
      && Number(acknowledgement.expected_non_empty_scope_count) === metadata.expectedNonEmptyScopeCount
      && Number.isFinite(Date.parse(String(acknowledgement.reviewed_at || "")))
      && reason.length >= 20 && reason.length <= 500;
    if (!sampleDropAcknowledged) throw new Error("publication sampled scope count dropped by more than 50 percent");
  }

  await db.batch([
    db.prepare("UPDATE public_stats_publications SET active = 0 WHERE active = 1"),
    db.prepare(`UPDATE public_stats_publications SET active = 1, activated_at = ?
      WHERE publication_id = ? AND checksum = ? AND expected_row_count = ?`).bind(
      new Date().toISOString(), metadata.publicationId, metadata.checksum, metadata.expectedRowCount
    ),
    // Readers only use the active pointer. Prune superseded and abandoned
    // staging rows in the same transaction so daily publications cannot fill D1.
    db.prepare("DELETE FROM public_stats_publications WHERE active = 0")
  ]);
  return {
    publication_id: metadata.publicationId,
    checksum: metadata.checksum,
    row_count: metadata.expectedRowCount,
    non_empty_scope_count: metadata.expectedNonEmptyScopeCount,
    scope_key_count: actualKeys.length,
    input_row_count: metadata.expectedRowCount,
    preserved_row_count: 0,
    overwritten_row_count: 0,
    merged_with_active: false,
    sample_drop_acknowledged: sampleDropAcknowledged,
    scope_schema_migration_applied: scopeSchemaMigrationApplied,
    removed_scope_count: removedActiveScopeKeys.length,
    row_checksum_verified: true,
    verification_pages: verifiedContent.pages,
    active: true
  };
}

export async function publishProductStats(db, input) {
  if (input.merge_with_active !== undefined && typeof input.merge_with_active !== "boolean") {
    throw new Error("merge_with_active must be a boolean");
  }
  const mergeWithActive = input.merge_with_active === true;
  const parserVersion = String(input.parser_version);
  const ruleVersion = String(input.rule_version);
  const filterVersion = String(input.filter_version);
  const inputRows = canonicalRows(input.rows || []);
  const expectedInputRowCount = Number(input.expected_row_count);
  const expectedInputChecksum = String(input.checksum || "");
  const actualInputRowCount = inputRows.length;
  const actualInputNonEmptyScopeCount = nonEmptyScopeCount(inputRows);
  const expectedInputNonEmptyScopeCount = Number(input.expected_non_empty_scope_count);
  const actualInputChecksum = await statsChecksum(inputRows);
  if (actualInputRowCount === 0) throw new Error("empty publication cannot replace active stats");
  if (actualInputRowCount !== expectedInputRowCount) throw new Error("publication row count mismatch");
  if (actualInputChecksum !== expectedInputChecksum) throw new Error("publication checksum mismatch");
  if (actualInputNonEmptyScopeCount === 0) throw new Error("publication with no sampled scopes cannot replace active stats");
  if (actualInputNonEmptyScopeCount !== expectedInputNonEmptyScopeCount) throw new Error("publication non-empty scope manifest mismatch");
  const inputKeys = inputRows.map(statsPublicationKey).sort();
  const expectedKeys = [...new Set((Array.isArray(input.expected_keys) ? input.expected_keys : []).map(String))].sort();
  if (expectedKeys.length !== inputKeys.length || expectedKeys.some((key, index) => key !== inputKeys[index])) {
    throw new Error("publication scope manifest mismatch");
  }
  validateStatsRows(inputRows, parserVersion, ruleVersion, filterVersion);

  const createdAt = String(input.created_at || new Date().toISOString());
  const publicationId = String(input.publication_id);
  const previous = await db.prepare(`SELECT publication_id, checksum, expected_row_count,
      expected_non_empty_scope_count, parser_version, rule_version, filter_version
    FROM public_stats_publications WHERE active = 1`).first();
  let previousRows = [];
  if (previous?.publication_id) {
    const previousResult = await db.prepare(`SELECT canonical_product_id, market_pool, condition_code,
        currency, days, stats_json, as_of
      FROM public_product_stats WHERE publication_id = ?`).bind(previous.publication_id).all();
    previousRows = canonicalRows(Array.isArray(previousResult?.results)
      ? previousResult.results
      : Array.isArray(previousResult) ? previousResult : []);
  }

  let rows = inputRows;
  let actualRowCount = actualInputRowCount;
  let actualNonEmptyScopeCount = actualInputNonEmptyScopeCount;
  let actualChecksum = actualInputChecksum;
  let actualKeys = inputKeys;
  let preservedRowCount = 0;
  let overwrittenRowCount = 0;
  if (mergeWithActive && previous?.publication_id) {
    if (String(previous.parser_version) !== parserVersion
      || String(previous.rule_version) !== ruleVersion
      || String(previous.filter_version) !== filterVersion) {
      throw new Error("merge_with_active requires exact parser/rule/filter version match");
    }
    if (previousRows.length !== Number(previous.expected_row_count)) {
      throw new Error("active publication row count integrity check failed");
    }
    const previousChecksum = await statsChecksum(previousRows);
    if (previousChecksum !== String(previous.checksum || "")) {
      throw new Error("active publication checksum integrity check failed");
    }
    if (nonEmptyScopeCount(previousRows) !== Number(previous.expected_non_empty_scope_count)) {
      throw new Error("active publication non-empty scope integrity check failed");
    }
    validateStatsRows(
      previousRows,
      String(previous.parser_version),
      String(previous.rule_version),
      String(previous.filter_version),
      "active publication"
    );
    const previousKeys = previousRows.map(statsPublicationKey);
    if (new Set(previousKeys).size !== previousKeys.length) {
      throw new Error("active publication contains duplicate scope keys");
    }
    const inputKeySet = new Set(inputKeys);
    const preservedRows = previousRows.filter((row) => !inputKeySet.has(statsPublicationKey(row)));
    preservedRowCount = preservedRows.length;
    overwrittenRowCount = previousRows.length - preservedRowCount;
    rows = canonicalRows([...preservedRows, ...inputRows]);
    actualRowCount = rows.length;
    actualNonEmptyScopeCount = nonEmptyScopeCount(rows);
    actualChecksum = await statsChecksum(rows);
    actualKeys = rows.map(statsPublicationKey).sort();
  }

  const actualKeySet = new Set(actualKeys);
  const removedActiveScopeKeys = previousRows
    .map(statsPublicationKey)
    .filter((key) => !actualKeySet.has(key));
  let scopeSchemaMigrationApplied = false;
  if (removedActiveScopeKeys.length > 0 || Number(previous?.expected_row_count || 0) > actualRowCount) {
    const migration = input.scope_schema_migration;
    const reviewedAt = String(migration?.reviewed_at || "");
    const reason = String(migration?.reason || "").trim();
    scopeSchemaMigrationApplied = Boolean(previous?.publication_id)
      && migration && typeof migration === "object" && !Array.isArray(migration)
      && String(migration.previous_publication_id || "") === String(previous.publication_id)
      && String(migration.previous_checksum || "") === String(previous.checksum)
      && Number(migration.expected_removed_scope_count) === removedActiveScopeKeys.length
      && Number.isFinite(Date.parse(reviewedAt))
      && reason.length >= 20 && reason.length <= 500;
    if (!scopeSchemaMigrationApplied) {
      throw new Error(Number(previous?.expected_row_count || 0) > actualRowCount
        ? "publication scope shrink requires an explicit schema migration"
        : "publication cannot omit an active scope key without an explicit schema migration");
    }
  }
  const previousNonEmptyScopeCount = Number(previous?.expected_non_empty_scope_count || 0);
  let sampleDropAcknowledged = false;
  if (previousNonEmptyScopeCount > 0 && actualNonEmptyScopeCount < Math.max(1, Math.floor(previousNonEmptyScopeCount * 0.5))) {
    const acknowledgement = input.sample_drop_acknowledgement;
    const reviewedAt = String(acknowledgement?.reviewed_at || "");
    const reason = String(acknowledgement?.reason || "").trim();
    const expectedCount = Number(acknowledgement?.expected_non_empty_scope_count);
    const minimumCount = Number(acknowledgement?.minimum_non_empty_scope_count);
    const maximumCount = Number(acknowledgement?.maximum_non_empty_scope_count);
    const reviewedRange = Number.isInteger(minimumCount) && minimumCount > 0
      && Number.isInteger(maximumCount) && maximumCount >= minimumCount
      && maximumCount - minimumCount <= Math.max(10, Math.floor(previousNonEmptyScopeCount * 0.05))
      && actualNonEmptyScopeCount >= minimumCount && actualNonEmptyScopeCount <= maximumCount;
    sampleDropAcknowledged = Boolean(previous?.publication_id)
      && acknowledgement && typeof acknowledgement === "object" && !Array.isArray(acknowledgement)
      && String(acknowledgement.previous_publication_id || "") === String(previous.publication_id)
      && String(acknowledgement.previous_checksum || "") === String(previous.checksum)
      && (expectedCount === actualNonEmptyScopeCount || reviewedRange)
      && Number.isFinite(Date.parse(reviewedAt))
      && reason.length >= 20 && reason.length <= 500;
    if (!sampleDropAcknowledged) {
      throw new Error("publication sampled scope count dropped by more than 50 percent");
    }
  }
  const publicationStatement = db.prepare(`INSERT INTO public_stats_publications (
      publication_id, checksum, expected_row_count, expected_non_empty_scope_count, parser_version, rule_version, filter_version, created_at, active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`).bind(
      publicationId, actualChecksum, actualRowCount, actualNonEmptyScopeCount,
      parserVersion, ruleVersion, filterVersion, createdAt
    );
  const rowStatements = rows.map((row) => db.prepare(`INSERT INTO public_product_stats (
      publication_id, canonical_product_id, market_pool, condition_code, currency, days, stats_json, as_of
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      publicationId, row.canonical_product_id, row.market_pool, row.condition_code,
      row.currency, row.days, row.stats_json, row.as_of
    ));

  try {
    // Staging can span bounded D1 batches; inactive partial rows are never public.
    // The active pointer still changes in one final transaction after checksum/count verification.
    const stageStatements = [publicationStatement, ...rowStatements];
    for (let offset = 0; offset < stageStatements.length; offset += 50) {
      await db.batch(stageStatements.slice(offset, offset + 50));
    }
    const verified = await db.prepare(`SELECT COUNT(*) AS count
      FROM public_product_stats WHERE publication_id = ?`).bind(publicationId).first();
    if (Number(verified?.count) !== actualRowCount) throw new Error("staged publication row count mismatch");

    // BEGIN TRANSACTION / COMMIT semantics are provided by D1 batch for the active pointer swap.
    await db.batch([
      db.prepare("UPDATE public_stats_publications SET active = 0 WHERE active = 1"),
      db.prepare(`UPDATE public_stats_publications
        SET active = 1, activated_at = ?
        WHERE publication_id = ? AND checksum = ? AND expected_row_count = ?`).bind(
          new Date().toISOString(), publicationId, actualChecksum, actualRowCount
      ),
      db.prepare("DELETE FROM public_stats_publications WHERE active = 0")
    ]);
    return {
      publication_id: publicationId,
      checksum: actualChecksum,
      row_count: actualRowCount,
      non_empty_scope_count: actualNonEmptyScopeCount,
      scope_key_count: actualKeys.length,
      input_row_count: actualInputRowCount,
      preserved_row_count: preservedRowCount,
      overwritten_row_count: overwrittenRowCount,
      merged_with_active: mergeWithActive && Boolean(previous?.publication_id),
      sample_drop_acknowledged: sampleDropAcknowledged,
      scope_schema_migration_applied: scopeSchemaMigrationApplied,
      removed_scope_count: removedActiveScopeKeys.length,
      active: true
    };
  } catch (error) {
    // ROLLBACK the inactive staging rows; no reader can observe them because active never changed.
    await db.prepare("DELETE FROM public_stats_publications WHERE publication_id = ? AND active = 0").bind(publicationId).run();
    throw error;
  }
}

export async function readPublishedProductStats(db, query) {
  const row = await db.prepare(`SELECT s.stats_json
    FROM public_product_stats s
    JOIN public_stats_publications p ON p.publication_id = s.publication_id AND p.active = 1
    WHERE s.canonical_product_id = ? AND s.market_pool = ? AND s.condition_code = ?
      AND s.currency = ? AND s.days = ?
    LIMIT 1`).bind(
    query.canonicalProductId, query.marketPool, query.condition, query.currency, query.days
  ).first();
  return row ? JSON.parse(row.stats_json) : null;
}
