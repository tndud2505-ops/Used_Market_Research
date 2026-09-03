import { PC_PRODUCT_MASTER_V2 } from "../pc-product-master-v2.mjs";

const PSU_CATEGORY = "PSU";
const PRODUCT_NODE = "PRODUCT";

/**
 * PSU browsing is intentionally a short path: rated output -> model.
 *
 * ATX revision, form factor, efficiency, modularity, and manufacturer are
 * model/listing metadata. They are not independent browse rows because doing
 * so makes a power-supply directory noisy and causes unrelated values to be
 * shown before a real model is selected.
 */
export const PSU_BROWSE_FLOW_VERSION = 1;

export const PSU_WATTS_BUCKET_ORDER_V1 = Object.freeze([
  "LE_500",
  "550_650",
  "700_750",
  "800_850",
  "900_1000",
  "1100_1200",
  "GT_1200"
]);

export const PSU_WATTS_BUCKET_LABELS_V1 = Object.freeze({
  LE_500: "500W 이하",
  "550_650": "550~650W",
  "700_750": "700~750W",
  "800_850": "800~850W",
  "900_1000": "900~1000W",
  "1100_1200": "1100~1200W",
  GT_1200: "1200W 초과"
});

const PSU_MODEL_METADATA = [
  { key: "manufacturer", label: "제조사", source: "product_master" },
  { key: "atx_spec", label: "ATX 규격", source: "spec_or_browse_facets" },
  { key: "form_factor", label: "폼팩터", source: "spec_or_browse_facets" },
  { key: "efficiency", label: "효율", source: "spec_or_browse_facets" },
  { key: "modularity", label: "케이블 방식", source: "spec_or_browse_facets" }
];

export const PSU_BROWSE_FLOW_V1 = deepFreeze({
  version: PSU_BROWSE_FLOW_VERSION,
  category_code: PSU_CATEGORY,
  steps: [
    { key: "watts_bucket", label: "정격 출력", source: "browse_facets", selection: "single" },
    { key: "model", label: "모델", source: "product_master", selection: "single", depends_on: ["watts_bucket"] }
  ],
  model_metadata: PSU_MODEL_METADATA
});

const BUCKET_ALIASES = new Map([
  ["LE_500", "LE_500"],
  ["550_650", "550_650"],
  ["700_750", "700_750"],
  ["800_850", "800_850"],
  ["900_1000", "900_1000"],
  ["1100_1200", "1100_1200"],
  ["GT_1200", "GT_1200"],
  ["500W 이하", "LE_500"],
  ["550~650W", "550_650"],
  ["550-650W", "550_650"],
  ["700~750W", "700_750"],
  ["700-750W", "700_750"],
  ["800~850W", "800_850"],
  ["800-850W", "800_850"],
  ["900~1000W", "900_1000"],
  ["900-1000W", "900_1000"],
  ["1100~1200W", "1100_1200"],
  ["1100-1200W", "1100_1200"],
  ["1200W 초과", "GT_1200"],
  [">1200W", "GT_1200"]
]);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function normalizeText(value) {
  return String(value ?? "").normalize("NFKC").trim();
}

function normalizeKey(value) {
  return normalizeText(value).toUpperCase().replace(/\s+/gu, " ");
}

function asPositiveNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null;
  const text = normalizeText(value);
  // Prefer an explicit watt suffix. For example, ATX 3.0 850W must read as
  // 850W, not as the revision number 3.0.
  const match = text.match(/(\d+(?:\.\d+)?)\s*(?:W|와트)\b/iu) || text.match(/^(\d+(?:\.\d+)?)$/u);
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isFinite(number) && number > 0 ? number : null;
}

/** Convert a rated output in watts to the public, stable bucket key. */
export function psuWattsBucketV1(value) {
  const normalized = normalizeKey(value);
  const direct = BUCKET_ALIASES.get(normalized) || BUCKET_ALIASES.get(normalized.replace(/\s+/gu, ""));
  if (direct) return direct;
  const watts = asPositiveNumber(value);
  if (watts === null) return null;
  if (watts <= 500) return "LE_500";
  if (watts <= 650) return "550_650";
  if (watts <= 750) return "700_750";
  if (watts <= 850) return "800_850";
  if (watts <= 1000) return "900_1000";
  if (watts <= 1200) return "1100_1200";
  return "GT_1200";
}

function rawFacet(product, key) {
  return product?.browse_facets?.[key] ?? product?.spec?.[key];
}

/**
 * Read a product's output bucket from the master. A numeric `spec.watts`
 * remains supported for older master rows; no bucket is invented when the
 * master has neither a bucket nor a rated wattage.
 */
function productWattsBucket(product) {
  return psuWattsBucketV1(rawFacet(product, "watts_bucket"))
    || psuWattsBucketV1(rawFacet(product, "watts"))
    || psuWattsBucketV1(rawFacet(product, "output_watts"))
    || psuWattsBucketV1(rawFacet(product, "rated_watts"));
}

function isProductNode(product) {
  return product?.spec?.directory_node_type === PRODUCT_NODE
    || product?.browse_facets?.directory_node_type === PRODUCT_NODE
    || (product?.spec?.directory_node_type === undefined && product?.browse_facets?.directory_node_type === undefined);
}

/** Return only registered PSU model rows that can be reached by output. */
export function psuBrowseProductsV1(products = PC_PRODUCT_MASTER_V2) {
  return (Array.isArray(products) ? products : []).filter((product) => (
    normalizeKey(product?.category) === PSU_CATEGORY
    && isProductNode(product)
    && productWattsBucket(product) !== null
  ));
}

function compareBucket(left, right) {
  const leftIndex = PSU_WATTS_BUCKET_ORDER_V1.indexOf(left);
  const rightIndex = PSU_WATTS_BUCKET_ORDER_V1.indexOf(right);
  return (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex)
    - (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex)
    || left.localeCompare(right, "en", { numeric: true, sensitivity: "base" });
}

function compareText(left, right) {
  return String(left).localeCompare(String(right), "en", { numeric: true, sensitivity: "base" });
}

function optionList(records) {
  const counts = new Map();
  for (const product of records) {
    const bucket = productWattsBucket(product);
    if (!bucket) continue;
    counts.set(bucket, (counts.get(bucket) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, label: PSU_WATTS_BUCKET_LABELS_V1[value] || value, count }))
    .sort((left, right) => compareBucket(left.value, right.value));
}

function selectedBucket(selection, availableValues) {
  const value = selection?.watts_bucket ?? selection?.wattsBucket;
  if (value === undefined || value === null || value === "") return null;
  const normalized = psuWattsBucketV1(value);
  return availableValues.includes(normalized) ? normalized : normalized || normalizeText(value) || null;
}

/**
 * Compute the output choices and model scope directly from the supplied
 * product master. Values absent from that master are never exposed.
 */
export function psuBrowseFacetsForMaster(products = PC_PRODUCT_MASTER_V2, selection = {}) {
  const records = psuBrowseProductsV1(products);
  const outputOptions = optionList(records);
  const availableValues = outputOptions.map(({ value }) => value);
  const requestedBucket = selectedBucket(selection, availableValues);
  const scoped = requestedBucket === null
    ? records
    : records.filter((product) => productWattsBucket(product) === requestedBucket);
  return {
    category_code: PSU_CATEGORY,
    browse_flow: PSU_BROWSE_FLOW_V1,
    selected: { watts_bucket: requestedBucket },
    available_facets: { watts_bucket: outputOptions },
    model_count: scoped.length,
    model_ids: scoped.map((product) => product.id).sort(compareText)
  };
}

function metadataValue(product, key) {
  return product?.spec?.[key] ?? product?.browse_facets?.[key] ?? null;
}

/** Project the metadata shown alongside a selected PSU model. */
export function psuModelMetadata(product) {
  if (!product || normalizeKey(product.category) !== PSU_CATEGORY) return null;
  return {
    canonical_product_id: product.id ?? null,
    canonical_display_name: product.name ?? null,
    manufacturer: product.manufacturer ?? null,
    watts: asPositiveNumber(metadataValue(product, "watts") ?? metadataValue(product, "output_watts") ?? metadataValue(product, "rated_watts")),
    watts_bucket: productWattsBucket(product),
    atx_spec: metadataValue(product, "atx_spec"),
    form_factor: metadataValue(product, "form_factor"),
    efficiency: metadataValue(product, "efficiency"),
    modularity: metadataValue(product, "modularity")
  };
}

export const PSU_BROWSE_FLOW = PSU_BROWSE_FLOW_V1;
export const PSU_BROWSE_FACET_KEYS_V1 = Object.freeze(["watts_bucket"]);
export const PSU_MODEL_METADATA_FIELDS_V1 = Object.freeze(PSU_MODEL_METADATA.map(({ key }) => key));

export function psuBrowseFlowForApiV1(products = PC_PRODUCT_MASTER_V2, selection = {}) {
  const facets = psuBrowseFacetsForMaster(products, selection);
  return {
    version: PSU_BROWSE_FLOW_VERSION,
    category_code: PSU_CATEGORY,
    browse_flow: PSU_BROWSE_FLOW_V1,
    defaults: {},
    available_facets: facets.available_facets,
    selected: facets.selected,
    model_metadata: [...PSU_MODEL_METADATA_FIELDS_V1],
    product_count: facets.model_count
  };
}
