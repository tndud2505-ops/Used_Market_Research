import { decodeSearchCursor, encodeSearchCursor } from "../aws-runner/search-cursor.mjs";

const SORTS = new Set(["recent", "price_asc", "price_desc"]);
const CURRENCIES = new Set(["KRW", "USD"]);
const MARKET_POOLS = new Set(["KR_C2C_USED", "KR_DEALER_USED", "KR_REFURB_RETAIL", "OVERSEAS_USED"]);
const DOMESTIC_MARKET_POOLS = new Set(["KR_C2C_USED", "KR_DEALER_USED", "KR_REFURB_RETAIL"]);

const SOURCE_URL_ID_PATTERNS = Object.freeze({
  ebay: [/\/itm\/(?:[^/?#]+\/)?(\d{8,14})(?:[/?#]|$)/iu],
  joonggonara: [/\/product\/(\d+)(?:[/?#]|$)/iu],
  bunjang: [/\/products?\/(\d+)(?:[/?#]|$)/iu],
  hellomarket: [/\/item\/(\d+)(?:[/?#]|$)/iu],
  danawa: [/[?&](?:seq|saleSeq)=([a-z0-9_-]+)(?:[&#]|$)/iu],
  rethinkmall: [/[?&]goodsNo=([a-z0-9_-]+)(?:[&#]|$)/iu],
  coolenjoy: [/[?&](?:wr_id|no)=(\d+)(?:[&#]|$)/iu],
  carrot: [/\/articles?\/(\d+)(?:[/?#]|$)/iu]
});

function text(value, maximum = 300) {
  return String(value ?? "").replace(/\s+/gu, " ").trim().slice(0, maximum);
}

function price(value, label) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new TypeError(`${label} must be a non-negative number`);
  return parsed;
}

export function parsePcListingsRequest(urlOrRequest, { allowedSites = [] } = {}) {
  const url = urlOrRequest instanceof URL
    ? urlOrRequest
    : new URL(typeof urlOrRequest === "string" ? urlOrRequest : urlOrRequest.url);
  const canonicalProductId = text(url.searchParams.get("canonical_product_id"), 300);
  const manufacturer = text(url.searchParams.get("manufacturer"), 120);
  const boardManufacturer = text(url.searchParams.get("board_manufacturer"), 120);
  const requestedSites = [...new Set([...url.searchParams.getAll("sites"), ...url.searchParams.getAll("site")]
    .flatMap((value) => value.split(","))
    .map((value) => text(value, 40))
    .filter(Boolean))].sort();
  const allowed = new Set(allowedSites);
  if (requestedSites.some((site) => !allowed.has(site))) throw new TypeError("unsupported site filter");
  const sort = text(url.searchParams.get("sort"), 30) || "recent";
  if (!SORTS.has(sort)) throw new TypeError("sort must be recent, price_asc, or price_desc");
  const currency = text(url.searchParams.get("currency"), 12).toUpperCase() || null;
  if (currency && !CURRENCIES.has(currency)) throw new TypeError("currency must be KRW or USD");
  const marketPool = text(url.searchParams.get("market_pool"), 80).toUpperCase() || null;
  if (marketPool && !MARKET_POOLS.has(marketPool)) throw new TypeError("unsupported market_pool filter");
  if (marketPool && currency) {
    if (DOMESTIC_MARKET_POOLS.has(marketPool) && currency !== "KRW") {
      throw new TypeError("domestic market_pool requires KRW");
    }
    if (marketPool === "OVERSEAS_USED" && currency !== "USD") {
      throw new TypeError("OVERSEAS_USED requires USD");
    }
  }
  const minPrice = price(url.searchParams.get("price_min") ?? url.searchParams.get("min_price"), "price_min");
  const maxPrice = price(url.searchParams.get("price_max") ?? url.searchParams.get("max_price"), "price_max");
  if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) throw new TypeError("price_min must be <= price_max");
  if (!currency && (sort !== "recent" || minPrice !== null || maxPrice !== null)) {
    throw new TypeError("currency is required for price sorting or price filters");
  }
  const requestedLimit = Number(url.searchParams.get("limit") || 30);
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1) throw new TypeError("limit must be a positive integer");
  const reconciliationAudit = text(url.searchParams.get("reconciliation_audit"), 160) || null;
  return {
    canonicalProductId,
    manufacturer,
    boardManufacturer,
    sites: requestedSites,
    sort,
    minPrice,
    maxPrice,
    marketPool,
    currency,
    limit: Math.min(100, requestedLimit),
    cursor: text(url.searchParams.get("cursor"), 2_500) || null,
    reconciliationAudit
  };
}

export function pcListingsIdentity(query) {
  const identity = {
    namespace: "pc_parts_directory_v2",
    canonical_product_id: query.canonicalProductId || "",
    manufacturer: query.manufacturer || "",
    board_manufacturer: query.boardManufacturer || "",
    sites: [...(query.sites || [])].sort(),
    sort: query.sort,
    min_price: query.minPrice,
    max_price: query.maxPrice,
    market_pool: query.marketPool || "",
    currency: query.currency || ""
  };
  if (query.reconciliationAudit) identity.reconciliation_audit = query.reconciliationAudit;
  return JSON.stringify(identity);
}

function compareText(left, right) {
  const leftText = String(left ?? "");
  const rightText = String(right ?? "");
  if (leftText < rightText) return -1;
  if (leftText > rightText) return 1;
  return 0;
}

export function comparePcListingRows(left, right, sort = "recent") {
  if (sort === "price_asc" || sort === "price_desc") {
    const leftPrice = Number(left?.price_value);
    const rightPrice = Number(right?.price_value);
    if (leftPrice !== rightPrice) return sort === "price_desc" ? rightPrice - leftPrice : leftPrice - rightPrice;
  }
  const updatedComparison = compareText(right?.updated_at, left?.updated_at);
  if (updatedComparison !== 0) return updatedComparison;
  return compareText(left?.item_id, right?.item_id);
}

function normalizedPublicUrl(value) {
  try {
    const url = new URL(String(value || ""));
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_|fbclid$|gclid$|campaign|tracking|ref$)/iu.test(key)) url.searchParams.delete(key);
    }
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/{2,}/gu, "/").replace(/\/$/u, "") || "/";
    url.searchParams.sort();
    return url.toString();
  } catch {
    return "";
  }
}

function stableIdFromUrl(site, value) {
  const normalized = normalizedPublicUrl(value);
  if (!normalized) return null;
  for (const pattern of SOURCE_URL_ID_PATTERNS[site] || []) {
    const match = normalized.match(pattern);
    if (match?.[1]) return match[1].toLowerCase();
  }
  return null;
}

function itemIdToken(row) {
  const site = text(row?.site, 40).toLowerCase();
  const raw = text(row?.item_id ?? row?.id, 700);
  const prefix = `${site}:`;
  const candidate = raw.toLowerCase().startsWith(prefix) ? raw.slice(prefix.length) : raw;
  return /^(?:https?:)?\/\//iu.test(candidate) ? "" : candidate;
}

export function pcListingPublicIdentity(row) {
  const site = text(row?.site, 40).toLowerCase();
  const explicit = itemIdToken(row);
  const stableUrlId = stableIdFromUrl(site, row?.url || row?.item_id || row?.id);
  if (stableUrlId && (!explicit || explicit.toLowerCase() === stableUrlId || explicit.toLowerCase().endsWith(`:${stableUrlId}`))) {
    return `${site}:source-id:${stableUrlId}`;
  }
  if (explicit) return `${site}:item-id:${explicit}`;
  const normalizedUrl = normalizedPublicUrl(row?.url || row?.item_id || row?.id);
  return normalizedUrl ? `${site}:url:${normalizedUrl}` : `${site}:row:${text(row?.item_id ?? row?.id, 700)}`;
}

function isLegacyUrlIdentity(row) {
  const site = text(row?.site, 40).toLowerCase();
  const raw = text(row?.item_id ?? row?.id, 700);
  const withoutPrefix = raw.toLowerCase().startsWith(`${site}:`) ? raw.slice(site.length + 1) : raw;
  return /^(?:https?:)?\/\//iu.test(withoutPrefix);
}

export function dedupePcListingRows(rows) {
  const selected = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const identity = pcListingPublicIdentity(row);
    const previous = selected.get(identity);
    if (!previous) {
      selected.set(identity, row);
      continue;
    }
    const previousLegacy = isLegacyUrlIdentity(previous);
    const candidateLegacy = isLegacyUrlIdentity(row);
    const previousUpdated = text(previous.updated_at ?? previous.last_checked_at, 80);
    const candidateUpdated = text(row.updated_at ?? row.last_checked_at, 80);
    if ((previousLegacy && !candidateLegacy) || (previousLegacy === candidateLegacy && candidateUpdated > previousUpdated)) {
      selected.set(identity, row);
    }
  }
  return [...selected.values()];
}

export function decodePcListingsCursor(query, secret) {
  if (!query.cursor) return null;
  const state = decodeSearchCursor(query.cursor, {
    cacheKey: pcListingsIdentity(query),
    sort: query.sort,
    secret
  });
  const asOf = text(state.after?.as_of, 80);
  const itemId = text(state.after?.item_id, 700);
  if (!asOf || !Number.isFinite(Date.parse(asOf)) || !itemId) throw new Error("CURSOR_INVALID: listing continuation is invalid");
  const total = Number(state.after?.total);
  const latestObservedAt = text(state.after?.latest_observed_at, 80);
  const lastCollectedAt = text(state.after?.last_collected_at, 80);
  const requiredTargetCount = Number(state.after?.required_target_count);
  const coveredTargetCount = Number(state.after?.covered_target_count);
  const hasSummary = Number.isSafeInteger(total) && total >= 0
    && (!latestObservedAt || Number.isFinite(Date.parse(latestObservedAt)))
    && (!lastCollectedAt || Number.isFinite(Date.parse(lastCollectedAt)))
    && Number.isSafeInteger(requiredTargetCount) && requiredTargetCount >= 0
    && Number.isSafeInteger(coveredTargetCount) && coveredTargetCount >= 0
    && coveredTargetCount <= requiredTargetCount;
  return {
    asOf,
    after: { item_id: itemId },
    summary: hasSummary ? {
      total,
      latestObservedAt: latestObservedAt || null,
      lastCollectedAt: lastCollectedAt || null,
      requiredTargetCount,
      coveredTargetCount
    } : null
  };
}

export function encodePcListingsCursor(query, { asOf, after, summary = null }, secret) {
  if (!after?.item_id) return null;
  const continuation = { item_id: after.item_id, as_of: asOf };
  if (summary) {
    continuation.total = summary.total;
    continuation.latest_observed_at = summary.latestObservedAt;
    continuation.last_collected_at = summary.lastCollectedAt;
    continuation.required_target_count = summary.requiredTargetCount;
    continuation.covered_target_count = summary.coveredTargetCount;
  }
  return encodeSearchCursor({
    cacheKey: pcListingsIdentity(query),
    sort: query.sort,
    snapshotVersion: Math.max(1, Date.parse(asOf)),
    after: continuation
  }, secret);
}

export function pcListingsFreshness(asOf, latestObservedAt) {
  const ageSeconds = latestObservedAt && Number.isFinite(Date.parse(latestObservedAt))
    ? Math.max(0, Math.floor((Date.parse(asOf) - Date.parse(latestObservedAt)) / 1_000))
    : null;
  return {
    as_of: asOf,
    last_collected_at: latestObservedAt || null,
    age_seconds: ageSeconds,
    state: ageSeconds === null ? "EMPTY" : ageSeconds <= 2 * 60 * 60 ? "FRESH" : "STALE"
  };
}
