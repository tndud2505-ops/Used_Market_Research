import { createHash } from "node:crypto";
import { OPERATIONAL_PC_DIRECTORY_SITES } from "../cloudflare/target-sites.mjs";
import { pcListingPublicIdentity } from "../cloudflare/pc-listings-contract.mjs";
import { getPcSource } from "../collector/logic/pc-source-registry.mjs";
import { canonicalSourceListingToken } from "./pc-source-listing-identity.mjs";

const PUBLIC_LISTING_KINDS = new Set(["SINGLE_COMPONENT", "SAME_PRODUCT_LOT"]);
const PUBLIC_PRICE_SCOPES = new Set(["TOTAL", "UNIT"]);
const DOMESTIC_MARKET_POOLS = new Set(["KR_C2C_USED", "KR_DEALER_USED", "KR_REFURB_RETAIL"]);
const RECONCILIATION_REASON = "NOT_IN_ACTIVE_PIPELINE_ELIGIBLE_SET";

export const DEFAULT_PC_REPUBLISH_SOURCES = Object.freeze([...OPERATIONAL_PC_DIRECTORY_SITES]);

function text(value) {
  return String(value ?? "").trim();
}

function itemId(item) {
  return text(item?.item_id ?? item?.id);
}

function price(item) {
  return Number(item?.price ?? item?.price_value);
}

function currentItemIdCanRepresentAuthority(item) {
  return !(text(item?.site).toLowerCase() === "ebay" && /^ebay:https?:/iu.test(itemId(item)));
}

function canonicalSourceUrl(site, token, fallback) {
  const builders = {
    bunjang: (id) => `https://m.bunjang.co.kr/products/${id}`,
    hellomarket: (id) => `https://www.hellomarket.com/item/${id}`,
    joonggonara: (id) => `https://web.joongna.com/product/${id}`,
    ebay: (id) => `https://www.ebay.com/itm/${id}`,
    danawa: (id) => `https://dmall.danawa.com/v3/?controller=sale&methods=blog&seq=${id}`,
    rethinkmall: (id) => `https://web.rethinkmall.com/goods/${id}`,
    coolenjoy: (id) => `https://coolenjoy.net/bbs/mart2/${id}`
  };
  if (builders[site]) return builders[site](encodeURIComponent(token));
  try {
    const parsed = new URL(text(fallback));
    if (!/^https?:$/u.test(parsed.protocol) || /\[(?:PHONE|EMAIL)\]/iu.test(parsed.toString())) throw new Error("masked");
    return parsed.toString();
  } catch {
    throw new Error(`AUTHORITATIVE_URL_UNRECOVERABLE:${site}:${token}`);
  }
}

function normalizedProjectionIdentity(item) {
  const identity = pcListingPublicIdentity(item);
  if (!identity || /:row:$/u.test(identity)) throw new Error(`PUBLIC_PROJECTION_IDENTITY_MISSING:${itemId(item)}`);
  return identity;
}

export function repairAuthoritativePcProjection(sourceId, sourceListingId, projection) {
  const site = text(sourceId).toLowerCase();
  const token = canonicalSourceListingToken(site, sourceListingId);
  const stableItemId = `${site}:${token}`;
  return {
    ...projection,
    id: stableItemId,
    item_id: stableItemId,
    site,
    source_listing_id: text(sourceListingId),
    url: canonicalSourceUrl(site, token, projection?.url),
    authoritative_identity: `${site}:source-id:${token}`
  };
}

export function isAuthoritativePcProjectionEligible(item) {
  if (!item || typeof item !== "object") return false;
  const site = text(item.site).toLowerCase();
  if (!DEFAULT_PC_REPUBLISH_SOURCES.includes(site)) return false;
  let source;
  try {
    source = getPcSource(site);
  } catch {
    return false;
  }
  const marketPool = text(item.market_pool).toUpperCase();
  const currency = text(item.currency).toUpperCase();
  const quantity = Number(item.quantity);
  const amount = price(item);
  const currencyMatchesPool = DOMESTIC_MARKET_POOLS.has(marketPool)
    ? currency === "KRW"
    : marketPool === "OVERSEAS_USED" && currency === "USD";
  return item.price_eligible === true
    && text(item.lifecycle_status).toUpperCase() === "ACTIVE"
    && text(item.condition_code).toUpperCase() === "USED_WORKING"
    && PUBLIC_LISTING_KINDS.has(text(item.listing_kind).toUpperCase())
    && PUBLIC_PRICE_SCOPES.has(text(item.price_scope).toUpperCase())
    && Number.isInteger(quantity) && quantity >= 1
    && Number.isFinite(amount) && amount > 0
    && Boolean(text(item.canonical_product_id))
    && source.market_pools.includes(marketPool)
    && currencyMatchesPool;
}

function projectionMatchesPipelineVersion(projection, pipelineVersion) {
  if (!pipelineVersion) return true;
  return Number(projection?.normalization_version) === Number(pipelineVersion.normalization_version)
    && text(projection?.parser_version) === text(pipelineVersion.parser_version)
    && text(projection?.rule_version) === text(pipelineVersion.rule_version)
    && text(projection?.filter_version) === text(pipelineVersion.filter_version);
}

function newerAuthority(candidate, previous) {
  const candidateTime = Number.isFinite(Date.parse(text(candidate.updated_at))) ? Date.parse(text(candidate.updated_at)) : 0;
  const previousTime = Number.isFinite(Date.parse(text(previous.updated_at))) ? Date.parse(text(previous.updated_at)) : 0;
  if (candidateTime !== previousTime) return candidateTime > previousTime;
  const candidatePair = `${text(candidate.site)}\u0000${text(candidate.source_listing_id)}`;
  const previousPair = `${text(previous.site)}\u0000${text(previous.source_listing_id)}`;
  return candidatePair.localeCompare(previousPair) < 0;
}

function incrementalSourceListingId(item, site) {
  const explicit = text(item?.source_listing_id);
  if (explicit) return explicit;
  const id = itemId(item);
  const prefix = `${site}:`;
  if (id.toLowerCase().startsWith(prefix)) return id.slice(prefix.length);
  return id || text(item?.url);
}

function incrementalSafetyPriority(item) {
  const publicActive = text(item?.lifecycle_status).toUpperCase() === "ACTIVE"
    && item?.price_eligible === true;
  return publicActive ? 0 : 1;
}

function newerIncrementalProjection(candidate, previous) {
  const candidateTime = Number.isFinite(Date.parse(text(candidate.updated_at))) ? Date.parse(text(candidate.updated_at)) : 0;
  const previousTime = Number.isFinite(Date.parse(text(previous.updated_at))) ? Date.parse(text(previous.updated_at)) : 0;
  if (candidateTime !== previousTime) return candidateTime > previousTime;
  const candidateSafety = incrementalSafetyPriority(candidate);
  const previousSafety = incrementalSafetyPriority(previous);
  if (candidateSafety !== previousSafety) return candidateSafety > previousSafety;
  return newerAuthority(candidate, previous);
}

export function stabilizeIncrementalPcProjections(items) {
  const selected = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== "object") throw new TypeError("incremental projection must be an object");
    const site = text(item.site).toLowerCase();
    const sourceListingId = incrementalSourceListingId(item, site);
    if (!site || !sourceListingId) throw new Error("INCREMENTAL_PROJECTION_SOURCE_IDENTITY_MISSING");
    const repaired = repairAuthoritativePcProjection(site, sourceListingId, item);
    const previous = selected.get(repaired.authoritative_identity);
    if (!previous || newerIncrementalProjection(repaired, previous)) {
      selected.set(repaired.authoritative_identity, repaired);
    }
  }
  return [...selected.values()].sort((left, right) => itemId(left).localeCompare(itemId(right)));
}

export function collectAuthoritativePcProjections(identities, getProjection, { pipelineVersion = null } = {}) {
  if (typeof getProjection !== "function") throw new TypeError("getProjection must be a function");
  const selected = new Map();
  const identitySizes = new Map();
  const uniquePairs = new Map();
  for (const row of Array.isArray(identities) ? identities : []) {
    const sourceId = text(row?.source_id).toLowerCase();
    const sourceListingId = text(row?.source_listing_id);
    if (!sourceId || !sourceListingId) throw new Error("SOURCE_PAIR_IDENTITY_MISSING");
    uniquePairs.set(`${sourceId}\u0000${sourceListingId}`, { source_id: sourceId, source_listing_id: sourceListingId });
  }
  let unprojectedCount = 0;
  let versionCoveredCount = 0;
  let versionMismatchCount = 0;
  let ineligibleCount = 0;
  const sourcePairCoverage = [];
  for (const row of uniquePairs.values()) {
    const projection = getProjection(row.source_id, row.source_listing_id);
    if (!projection) {
      unprojectedCount += 1;
      sourcePairCoverage.push({ source_id: row.source_id, source_listing_id: row.source_listing_id, projection: null });
      continue;
    }
    sourcePairCoverage.push({
      source_id: row.source_id,
      source_listing_id: row.source_listing_id,
      updated_at: text(projection.updated_at),
      normalization_version: Number(projection.normalization_version),
      parser_version: text(projection.parser_version),
      rule_version: text(projection.rule_version),
      filter_version: text(projection.filter_version)
    });
    if (!projectionMatchesPipelineVersion(projection, pipelineVersion)) {
      versionMismatchCount += 1;
      continue;
    }
    versionCoveredCount += 1;
    if (!isAuthoritativePcProjectionEligible(projection)) {
      ineligibleCount += 1;
      continue;
    }
    const normalized = repairAuthoritativePcProjection(row.source_id, row.source_listing_id, projection);
    const identity = normalized.authoritative_identity;
    identitySizes.set(identity, Number(identitySizes.get(identity) || 0) + 1);
    const previous = selected.get(identity);
    if (!previous || newerAuthority(normalized, previous)) selected.set(identity, normalized);
  }
  const items = [...selected.values()].sort((left, right) => (
    normalizedProjectionIdentity(left).localeCompare(normalizedProjectionIdentity(right))
      || itemId(left).localeCompare(itemId(right))
  ));
  const latestSelection = items.map((item) => ({
    authoritative_identity: item.authoritative_identity,
    source_listing_id: text(item.source_listing_id),
    item_id: itemId(item),
    updated_at: text(item.updated_at),
    price: price(item)
  }));
  return {
    items,
    input_row_count: Array.isArray(identities) ? identities.length : 0,
    source_pair_count: uniquePairs.size,
    scanned_count: uniquePairs.size,
    projection_count: uniquePairs.size - unprojectedCount,
    version_covered_count: versionCoveredCount,
    version_mismatch_count: versionMismatchCount,
    unprojected_count: unprojectedCount,
    ineligible_count: ineligibleCount,
    stable_identity_collision_group_count: [...identitySizes.values()].filter((size) => size > 1).length,
    stable_identity_collision_extra_count: [...identitySizes.values()].reduce((sum, size) => sum + Math.max(0, size - 1), 0),
    latest_selection_count: items.length,
    latest_selection_checksum: createHash("sha256").update(JSON.stringify(latestSelection)).digest("hex"),
    source_pair_checksum: createHash("sha256").update(JSON.stringify(sourcePairCoverage.sort((left, right) => (
      `${left.source_id}\u0000${left.source_listing_id}`.localeCompare(`${right.source_id}\u0000${right.source_listing_id}`)
    )))).digest("hex")
  };
}

function groupByIdentity(items, label) {
  const groups = new Map();
  const seenIds = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    const id = itemId(item);
    if (!id) throw new Error(`${label}_ITEM_ID_MISSING`);
    if (seenIds.has(id)) throw new Error(`${label}_DUPLICATE_ITEM_ID:${id}`);
    seenIds.add(id);
    const identity = normalizedProjectionIdentity(item);
    if (!groups.has(identity)) groups.set(identity, []);
    groups.get(identity).push(item);
  }
  for (const rows of groups.values()) rows.sort((left, right) => itemId(left).localeCompare(itemId(right)));
  return groups;
}

function sourceScoped(items, sources) {
  const allowed = new Set(sources);
  return (Array.isArray(items) ? items : []).filter((item) => allowed.has(text(item?.site).toLowerCase()));
}

function reconcileTarget(authoritative, current, label) {
  const authorityGroups = groupByIdentity(authoritative, "AUTHORITATIVE");
  const currentGroups = groupByIdentity(current, label);
  const stale = [];
  const upserts = [];
  const missing = [];
  for (const [identity, authorityRows] of authorityGroups) {
    if (authorityRows.length !== 1) throw new Error(`AUTHORITATIVE_IDENTITY_COLLISION:${identity}`);
    const authority = authorityRows[0];
    const currentRows = currentGroups.get(identity) || [];
    const canonicalId = itemId(authority);
    const exact = currentRows.find((item) => itemId(item) === canonicalId) || null;
    const representative = exact || currentRows.find(currentItemIdCanRepresentAuthority) || null;
    if (!exact) missing.push(authority);
    upserts.push({ ...(representative || {}), ...authority, id: canonicalId, item_id: canonicalId });
    for (const item of currentRows) {
      if (itemId(item) !== canonicalId) stale.push(item);
    }
    currentGroups.delete(identity);
  }
  for (const rows of currentGroups.values()) stale.push(...rows);
  const byId = (left, right) => itemId(left).localeCompare(itemId(right));
  stale.sort(byId);
  upserts.sort(byId);
  missing.sort(byId);
  const upsertIds = new Set(upserts.map(itemId));
  const collision = stale.find((item) => upsertIds.has(itemId(item)));
  if (collision) throw new Error(`${label}_STALE_UPSERT_ITEM_ID_COLLISION:${itemId(collision)}`);
  return { stale, upserts, missing };
}

function criticalProjection(item) {
  return {
    item_id: itemId(item),
    identity: normalizedProjectionIdentity(item),
    source_listing_id: text(item.source_listing_id),
    updated_at: text(item.updated_at),
    canonical_product_id: text(item.canonical_product_id),
    listing_kind: text(item.listing_kind).toUpperCase(),
    quantity: Number(item.quantity),
    price_scope: text(item.price_scope).toUpperCase(),
    condition_code: text(item.condition_code).toUpperCase(),
    lifecycle_status: text(item.lifecycle_status).toUpperCase(),
    market_pool: text(item.market_pool).toUpperCase(),
    currency: text(item.currency).toUpperCase(),
    price: price(item)
  };
}

export function buildPcProjectionReconciliation({
  authoritative,
  d1Public,
  localPublic,
  pipelineVersion,
  authorityCoverage = null,
  sources = DEFAULT_PC_REPUBLISH_SOURCES
}) {
  const normalizedSources = [...new Set((Array.isArray(sources) ? sources : [])
    .map((value) => text(value).toLowerCase()).filter(Boolean))].sort();
  if (normalizedSources.length === 0) throw new Error("RECONCILIATION_SOURCE_SCOPE_EMPTY");
  if (normalizedSources.some((source) => !DEFAULT_PC_REPUBLISH_SOURCES.includes(source))) {
    throw new Error("RECONCILIATION_SOURCE_SCOPE_NOT_OPERATIONAL");
  }
  const authority = sourceScoped(authoritative, normalizedSources).sort((left, right) => (
    normalizedProjectionIdentity(left).localeCompare(normalizedProjectionIdentity(right))
      || itemId(left).localeCompare(itemId(right))
  ));
  if (authority.length === 0) throw new Error("AUTHORITATIVE_ELIGIBLE_SET_EMPTY");
  const authorityGroups = groupByIdentity(authority, "AUTHORITATIVE");
  if (authorityGroups.size !== authority.length) throw new Error("AUTHORITATIVE_IDENTITY_SET_NOT_UNIQUE");
  const d1 = reconcileTarget(authority, sourceScoped(d1Public, normalizedSources), "D1_PUBLIC");
  const local = reconcileTarget(authority, sourceScoped(localPublic, normalizedSources), "LOCAL_PUBLIC");
  const coverage = {
    source_pair_count: Number(authorityCoverage?.source_pair_count ?? authority.length),
    projection_count: Number(authorityCoverage?.projection_count ?? authority.length),
    version_covered_count: Number(authorityCoverage?.version_covered_count ?? authority.length),
    version_mismatch_count: Number(authorityCoverage?.version_mismatch_count ?? 0),
    unprojected_count: Number(authorityCoverage?.unprojected_count ?? 0),
    stable_identity_collision_group_count: Number(authorityCoverage?.stable_identity_collision_group_count ?? 0),
    stable_identity_collision_extra_count: Number(authorityCoverage?.stable_identity_collision_extra_count ?? 0),
    latest_selection_count: Number(authorityCoverage?.latest_selection_count ?? authority.length),
    latest_selection_checksum: text(authorityCoverage?.latest_selection_checksum),
    source_pair_checksum: text(authorityCoverage?.source_pair_checksum)
  };
  const checksumInput = {
    pipeline_version: pipelineVersion || null,
    authority_coverage: coverage,
    sources: normalizedSources,
    authoritative: authority.map(criticalProjection),
    d1_stale: d1.stale.map(criticalProjection),
    d1_missing: d1.missing.map(criticalProjection),
    d1_upserts: d1.upserts.map(criticalProjection),
    local_stale: local.stale.map(criticalProjection),
    local_missing: local.missing.map(criticalProjection),
    local_upserts: local.upserts.map(criticalProjection)
  };
  const checksum = createHash("sha256").update(JSON.stringify(checksumInput)).digest("hex");
  return {
    checksum,
    pipeline_version: pipelineVersion || null,
    ...coverage,
    sources: normalizedSources,
    authoritative_count: authority.length,
    d1_public_count: sourceScoped(d1Public, normalizedSources).length,
    d1_stale_count: d1.stale.length,
    d1_missing_count: d1.missing.length,
    local_public_count: sourceScoped(localPublic, normalizedSources).length,
    local_stale_count: local.stale.length,
    local_missing_count: local.missing.length,
    authoritative: authority,
    d1_stale: d1.stale,
    d1_upserts: d1.upserts,
    local_stale: local.stale,
    local_upserts: local.upserts
  };
}

export function pcProjectionTombstone(item, { updatedAt } = {}) {
  const id = itemId(item);
  if (!id) throw new Error("TOMBSTONE_ITEM_ID_MISSING");
  const reasons = [...new Set([
    ...(Array.isArray(item?.exclusion_reasons) ? item.exclusion_reasons.map(text).filter(Boolean) : []),
    RECONCILIATION_REASON
  ])];
  return {
    ...item,
    id,
    item_id: id,
    price: price(item),
    updated_at: text(updatedAt) || text(item.updated_at),
    price_eligible: false,
    good_listing_eligible: false,
    exclusion_reasons: reasons
  };
}

function readOptionValue(argv, index, name) {
  const argument = argv[index];
  if (argument === name) {
    const value = text(argv[index + 1]);
    if (!value) throw new Error(`${name} requires a value`);
    return { value, consumed: 1 };
  }
  if (argument.startsWith(`${name}=`)) {
    const value = text(argument.slice(name.length + 1));
    if (!value) throw new Error(`${name} requires a value`);
    return { value, consumed: 0 };
  }
  return null;
}

export function parsePcProjectionRepublishArguments(argv) {
  const result = {
    apply: false,
    confirmChecksum: "",
    expectedAuthoritativeCount: null,
    expectedSourcePairCount: null,
    expectedProjectionCount: null,
    expectedVersionCoveredCount: null,
    expectedD1StaleCount: null,
    expectedD1MissingCount: null,
    expectedLocalStaleCount: null,
    expectedLocalMissingCount: null
  };
  const numberOptions = new Map([
    ["--expect-authoritative-count", "expectedAuthoritativeCount"],
    ["--expect-source-pair-count", "expectedSourcePairCount"],
    ["--expect-projection-count", "expectedProjectionCount"],
    ["--expect-version-covered-count", "expectedVersionCoveredCount"],
    ["--expect-d1-stale-count", "expectedD1StaleCount"],
    ["--expect-d1-missing-count", "expectedD1MissingCount"],
    ["--expect-local-stale-count", "expectedLocalStaleCount"],
    ["--expect-local-missing-count", "expectedLocalMissingCount"]
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") {
      result.apply = true;
      continue;
    }
    const checksum = readOptionValue(argv, index, "--confirm-checksum");
    if (checksum) {
      result.confirmChecksum = checksum.value.toLowerCase();
      index += checksum.consumed;
      continue;
    }
    let matched = false;
    for (const [name, key] of numberOptions) {
      const option = readOptionValue(argv, index, name);
      if (!option) continue;
      if (!/^\d+$/u.test(option.value)) throw new Error(`${name} must be a non-negative integer`);
      result[key] = Number(option.value);
      index += option.consumed;
      matched = true;
      break;
    }
    if (matched) continue;
    throw new Error(`Unsupported argument: ${argument}`);
  }
  const confirmationsPresent = Boolean(result.confirmChecksum)
    || result.expectedAuthoritativeCount !== null
    || result.expectedSourcePairCount !== null
    || result.expectedProjectionCount !== null
    || result.expectedVersionCoveredCount !== null
    || result.expectedD1StaleCount !== null
    || result.expectedD1MissingCount !== null
    || result.expectedLocalStaleCount !== null
    || result.expectedLocalMissingCount !== null;
  if (!result.apply && confirmationsPresent) throw new Error("confirmation options require --apply");
  if (result.apply) {
    if (!/^[a-f0-9]{64}$/u.test(result.confirmChecksum)
      || result.expectedAuthoritativeCount === null
      || result.expectedSourcePairCount === null
      || result.expectedProjectionCount === null
      || result.expectedVersionCoveredCount === null
      || result.expectedD1StaleCount === null
      || result.expectedD1MissingCount === null
      || result.expectedLocalStaleCount === null
      || result.expectedLocalMissingCount === null) {
      throw new Error("--apply requires checksum and all exact expected counts from a dry-run");
    }
  }
  return result;
}

export function assertPcProjectionApplyConfirmation(options, plan) {
  if (!options?.apply) throw new Error("RECONCILIATION_APPLY_NOT_CONFIRMED");
  const mismatches = [];
  if (options.confirmChecksum !== plan.checksum) mismatches.push("checksum");
  if (options.expectedAuthoritativeCount !== plan.authoritative_count) mismatches.push("authoritative_count");
  if (options.expectedSourcePairCount !== plan.source_pair_count) mismatches.push("source_pair_count");
  if (options.expectedProjectionCount !== plan.projection_count) mismatches.push("projection_count");
  if (options.expectedVersionCoveredCount !== plan.version_covered_count) mismatches.push("version_covered_count");
  if (options.expectedD1StaleCount !== plan.d1_stale_count) mismatches.push("d1_stale_count");
  if (options.expectedD1MissingCount !== plan.d1_missing_count) mismatches.push("d1_missing_count");
  if (options.expectedLocalStaleCount !== plan.local_stale_count) mismatches.push("local_stale_count");
  if (options.expectedLocalMissingCount !== plan.local_missing_count) mismatches.push("local_missing_count");
  if (mismatches.length > 0) throw new Error(`RECONCILIATION_CONFIRMATION_MISMATCH:${mismatches.join(",")}`);
  return true;
}
