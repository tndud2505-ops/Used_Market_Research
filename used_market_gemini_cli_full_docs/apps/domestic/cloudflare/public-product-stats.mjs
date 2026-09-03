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
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

export function statsPublicationKey(row) {
  return [row.canonical_product_id, row.market_pool, row.condition_code, row.currency, Number(row.days)].join("\u0000");
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

  if (Number(previous?.expected_row_count || 0) > actualRowCount) {
    throw new Error("publication scope shrink requires an explicit schema migration");
  }
  const previousNonEmptyScopeCount = Number(previous?.expected_non_empty_scope_count || 0);
  if (previousNonEmptyScopeCount > 0 && actualNonEmptyScopeCount < Math.max(1, Math.floor(previousNonEmptyScopeCount * 0.5))) {
    throw new Error("publication sampled scope count dropped by more than 50 percent");
  }
  if (previous?.publication_id) {
    const actualKeySet = new Set(actualKeys);
    if (previousRows.some((row) => !actualKeySet.has(statsPublicationKey(row)))) {
      throw new Error("publication cannot omit an active scope key without an explicit schema migration");
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
      )
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
