const STATUS_PRIORITY = Object.freeze([
  "SOURCE_ERROR", "PUBLIC_MISSING", "CLASSIFIER_UNRESOLVED", "SOURCE_MATCH_EXCLUDED",
  "PUBLIC_ONLY", "SOURCE_NO_EXACT_MATCH", "CATEGORY_MISMATCH", "SOURCE_EMPTY",
  "SOURCE_MATCH", "CATEGORY_MATCH", "MATCHED",
]);

function splitList(value, transform = (entry) => entry) {
  return [...new Set(String(value || "").split(",").map((entry) => transform(entry.trim())).filter(Boolean))];
}

function boundedInteger(value, fallback, minimum, maximum, name) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}

export function parseProbeConfig(env, operationalSourceKeys) {
  const operational = [...new Set(operationalSourceKeys.map((source) => String(source).trim().toLowerCase()).filter(Boolean))];
  const requested = splitList(env.PC_PROBE_SOURCES || env.PC_PROBE_SOURCE, (entry) => entry.toLowerCase());
  const sourceKeys = requested.length > 0 ? requested : operational;
  for (const sourceKey of sourceKeys) {
    if (!operational.includes(sourceKey)) throw new Error(`PC_PROBE_SOURCE_NOT_OPERATIONAL:${sourceKey}`);
  }
  const cadenceClass = String(env.PC_PROBE_CADENCE_CLASS || "ALL").trim().toUpperCase();
  if (!["ALL", "HOURLY_CATEGORY", "DAILY_MASTER"].includes(cadenceClass)) {
    throw new Error("PC_PROBE_CADENCE_CLASS must be ALL, HOURLY_CATEGORY, or DAILY_MASTER");
  }
  const publicBaseUrl = new URL(String(env.PC_PROBE_PUBLIC_BASE_URL || "https://used-pick.com"));
  if (!["http:", "https:"].includes(publicBaseUrl.protocol)) throw new Error("PC_PROBE_PUBLIC_BASE_URL must use HTTP or HTTPS");
  return {
    sourceKeys,
    productIds: splitList(env.PC_PROBE_PRODUCT_IDS),
    categories: splitList(env.PC_PROBE_CATEGORIES, (entry) => entry.toUpperCase()),
    cadenceClass,
    offset: boundedInteger(env.PC_PROBE_OFFSET, 0, 0, 10_000_000, "PC_PROBE_OFFSET"),
    targetLimit: boundedInteger(env.PC_PROBE_TARGET_LIMIT, 25, 1, 200, "PC_PROBE_TARGET_LIMIT"),
    itemLimit: boundedInteger(env.PC_PROBE_ITEM_LIMIT ?? env.PC_PROBE_LIMIT, 20, 1, 80, "PC_PROBE_ITEM_LIMIT"),
    delayMs: boundedInteger(env.PC_PROBE_DELAY_MS, 250, 0, 5_000, "PC_PROBE_DELAY_MS"),
    comparePublic: String(env.PC_PROBE_COMPARE_PUBLIC ?? "1").trim() !== "0",
    publicBaseUrl: publicBaseUrl.toString().replace(/\/$/u, ""),
  };
}

export function selectProbeRuns(targets, config) {
  const productIds = new Set(config.productIds || []);
  const categories = new Set(config.categories || []);
  const runs = [];
  for (const sourceKey of config.sourceKeys) {
    const assigned = targets.filter((target) => target.enabled !== false
      && target.sourceKeys.includes(sourceKey)
      && (config.cadenceClass === "ALL" || target.cadenceClass === config.cadenceClass)
      && (productIds.size === 0 || productIds.has(target.canonicalProductId))
      && (categories.size === 0 || categories.has(target.categoryCode)))
      .sort((left, right) => Number(left.targetOrder || 0) - Number(right.targetOrder || 0)
        || String(left.targetId).localeCompare(String(right.targetId)));
    assigned.forEach((target) => runs.push({ sourceKey, target }));
  }
  const offset = Math.min(config.offset, runs.length);
  const selected = runs.slice(offset, offset + config.targetLimit);
  return {
    totalRuns: runs.length,
    runs: selected,
    nextOffset: offset + selected.length < runs.length ? offset + selected.length : null,
  };
}

export function filterCollectionTargets(targets, {
  cadenceClass = "ALL", productIds = [], targetIds = [], offset = 0, limit = null,
} = {}) {
  const products = new Set(productIds);
  const selectedTargets = new Set(targetIds);
  const filtered = targets.filter((target) => {
    const cadence = String(target.cadence_class || target.cadenceClass || "HOURLY_CATEGORY");
    const productId = String(target.canonical_product_id || target.canonicalProductId || "");
    const targetId = String(target.target_id || target.targetId || "");
    return (cadenceClass === "ALL" || cadence === cadenceClass)
      && (products.size === 0 || products.has(productId))
      && (selectedTargets.size === 0 || selectedTargets.has(targetId));
  });
  const start = Math.min(Math.max(0, Number(offset) || 0), filtered.length);
  return Number.isInteger(Number(limit)) && Number(limit) > 0
    ? filtered.slice(start, start + Number(limit))
    : filtered.slice(start);
}

function projectionCategory(projection) {
  return String(projection?.pc_category_code || projection?.category_code || "").toUpperCase();
}

function projectionReasons(projection) {
  return [...new Set([
    ...(Array.isArray(projection?.exclusion_reasons) ? projection.exclusion_reasons : []),
    ...(Array.isArray(projection?.statistics_exclusion_reasons) ? projection.statistics_exclusion_reasons : []),
  ].map(String))];
}

export function assessProbeRun({ sourceKey, target, items = [], projections = [], publicListingCount = null, publicFreshness = null }) {
  const hasPublicCount = publicListingCount !== null && publicListingCount !== undefined
    && Number.isFinite(Number(publicListingCount));
  const expectedId = target.canonicalProductId || null;
  const categoryMatches = projections.filter((projection) => projectionCategory(projection) === target.categoryCode);
  const exactMatches = expectedId ? projections.filter((projection) => projection?.canonical_product_id === expectedId) : [];
  const eligibleExactMatches = exactMatches.filter((projection) => projection?.lifecycle_status === "ACTIVE"
    && projection?.price_eligible === true && projection?.statistics_eligible === true);
  const unresolved = projections.filter((projection) => !projection?.canonical_product_id
    && projectionReasons(projection).includes("MODEL_NOT_IN_MASTER"));
  const wrongModel = expectedId
    ? projections.filter((projection) => projection?.canonical_product_id && projection.canonical_product_id !== expectedId)
    : [];
  let status;
  if (items.length === 0) status = hasPublicCount && Number(publicListingCount) > 0 ? "PUBLIC_ONLY" : "SOURCE_EMPTY";
  else if (!expectedId) status = categoryMatches.length > 0 ? "CATEGORY_MATCH" : "CATEGORY_MISMATCH";
  else if (exactMatches.length === 0) {
    if (hasPublicCount && Number(publicListingCount) > 0) status = "PUBLIC_ONLY";
    else status = unresolved.length > 0 ? "CLASSIFIER_UNRESOLVED" : "SOURCE_NO_EXACT_MATCH";
  } else if (eligibleExactMatches.length === 0) status = "SOURCE_MATCH_EXCLUDED";
  else if (hasPublicCount && Number(publicListingCount) === 0) status = "PUBLIC_MISSING";
  else status = hasPublicCount && Number(publicListingCount) > 0 ? "MATCHED" : "SOURCE_MATCH";
  return {
    source_key: sourceKey,
    target_id: target.targetId,
    canonical_product_id: expectedId,
    category_code: target.categoryCode,
    query_text: target.queryText,
    cadence_class: target.cadenceClass,
    status,
    received_count: items.length,
    category_match_count: categoryMatches.length,
    exact_product_match_count: exactMatches.length,
    eligible_exact_match_count: eligibleExactMatches.length,
    unresolved_model_count: unresolved.length,
    wrong_model_count: wrongModel.length,
    public_listing_count: hasPublicCount ? Number(publicListingCount) : null,
    public_freshness: publicFreshness || null,
    samples: items.slice(0, 3).map((item, index) => ({
      item_id: String(item?.source_listing_id || item?.item_id || item?.id || index),
      title: String(item?.title || "").slice(0, 300),
      url: String(item?.url || "").slice(0, 1_000),
      canonical_product_id: projections[index]?.canonical_product_id || null,
      exclusion_reasons: projectionReasons(projections[index]),
    })),
  };
}

export function summarizeProbeRuns(rows, { offset, targetLimit, totalRuns }) {
  const statusCounts = Object.fromEntries([...new Set(rows.map((row) => row.status))]
    .sort((left, right) => STATUS_PRIORITY.indexOf(left) - STATUS_PRIORITY.indexOf(right) || left.localeCompare(right))
    .map((status) => [status, rows.filter((row) => row.status === status).length]));
  return {
    status_counts: statusCounts,
    checked_count: rows.length,
    actionable_count: rows.filter((row) => [
      "SOURCE_ERROR", "PUBLIC_MISSING", "CLASSIFIER_UNRESOLVED", "SOURCE_MATCH_EXCLUDED",
    ].includes(row.status)).length,
    next_offset: offset + Math.min(rows.length, targetLimit) < totalRuns ? offset + rows.length : null,
  };
}
