import { PC_PRODUCT_MASTER_V2 } from "../pc-product-master-v2.mjs";

const SSD_CATEGORY = "SSD";
const PRODUCT_NODE = "PRODUCT";
const BROWSE_BUCKET_NODE = "BROWSE_BUCKET";

const SSD_BUCKET_ORDER = Object.freeze([
  "LE_256_GB",
  "480_512_GB",
  "960_GB_1_TB",
  "1_92_2_TB",
  "3_84_4_TB",
  "7_68_8_TB",
  "GT_8_TB"
]);

const SSD_BUCKET_LABELS = Object.freeze({
  LE_256_GB: "256GB 이하",
  "480_512_GB": "480~512GB",
  "960_GB_1_TB": "960GB~1TB",
  "1_92_2_TB": "1.92~2TB",
  "3_84_4_TB": "3.84~4TB",
  "7_68_8_TB": "7.68~8TB",
  GT_8_TB: "8TB 초과"
});

function freezeDeep(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeDeep(child);
  }
  return value;
}

function normalizeText(value) {
  return String(value ?? "").normalize("NFKC").trim();
}

function normalizeBucket(value) {
  const normalized = normalizeText(value).toUpperCase();
  return SSD_BUCKET_ORDER.includes(normalized) ? normalized : normalized || null;
}

function nodeType(product) {
  return normalizeText(product?.browse_facets?.directory_node_type ?? product?.spec?.directory_node_type).toUpperCase();
}

function isSsd(product) {
  return normalizeText(product?.category).toUpperCase() === SSD_CATEGORY;
}

function capacityBucketValue(product) {
  return normalizeBucket(product?.browse_facets?.capacity_bucket ?? product?.spec?.capacity_bucket);
}

function ssdNodes(products) {
  return (Array.isArray(products) ? products : []).filter(isSsd);
}

/**
 * The current V2 master contains capacity-bucket directory nodes for SSDs.
 * When exact SKU product nodes are added, they take precedence automatically;
 * this keeps the public flow useful during the master migration without
 * inventing capacity values or models outside the master.
 */
export function ssdBrowseProductsV1(products = PC_PRODUCT_MASTER_V2) {
  const nodes = ssdNodes(products);
  const productNodes = nodes.filter((product) => nodeType(product) === PRODUCT_NODE);
  if (productNodes.length > 0) return productNodes;
  return nodes.filter((product) => nodeType(product) === BROWSE_BUCKET_NODE);
}

function compareBucket(left, right) {
  const leftIndex = SSD_BUCKET_ORDER.indexOf(left);
  const rightIndex = SSD_BUCKET_ORDER.indexOf(right);
  return (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex)
    - (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex)
    || left.localeCompare(right, "en");
}

function compareText(left, right) {
  return String(left).localeCompare(String(right), "en", { sensitivity: "base", numeric: true });
}

function facetOptions(records) {
  const counts = new Map();
  for (const record of records) {
    const value = capacityBucketValue(record);
    if (!value) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()]
    .sort(([left], [right]) => compareBucket(left, right))
    .map(([value, count]) => ({
      value,
      label: SSD_BUCKET_LABELS[value] || value,
      count
    }));
}

function matchesCapacity(product, selectedCapacity) {
  return !selectedCapacity || capacityBucketValue(product) === selectedCapacity;
}

/**
 * SSD browse path: capacity bucket -> model. Interface/protocol/form factor
 * and manufacturer are intentionally model/listing metadata, not extra
 * browse rows. All facet options and model ids come from the master records.
 */
export const SSD_BROWSE_FLOW_V1 = freezeDeep({
  version: 1,
  category_code: SSD_CATEGORY,
  steps: [
    { key: "capacity_bucket", label: "용량", source: "browse_facets", selection: "single" },
    { key: "model", label: "모델", source: "product_master", selection: "single", depends_on: ["capacity_bucket"] }
  ],
  model_metadata: [
    { key: "interface", label: "인터페이스", source: "spec_or_browse_facets" },
    { key: "protocol", label: "프로토콜", source: "spec_or_browse_facets" },
    { key: "form_factor", label: "폼팩터", source: "spec_or_browse_facets" },
    { key: "manufacturer", label: "제조사", source: "product_master" }
  ]
});

export function ssdBrowseFacetsForMaster(products = PC_PRODUCT_MASTER_V2, selection = {}) {
  const records = ssdBrowseProductsV1(products);
  const selectedCapacity = normalizeBucket(selection?.capacity_bucket ?? selection?.capacityBucket);
  const selectedRecords = records.filter((record) => matchesCapacity(record, selectedCapacity));
  return {
    version: SSD_BROWSE_FLOW_V1.version,
    category_code: SSD_CATEGORY,
    browse_flow: SSD_BROWSE_FLOW_V1,
    selected: { capacity_bucket: selectedCapacity },
    available_facets: {
      capacity_bucket: facetOptions(records)
    },
    model_count: selectedRecords.length,
    model_ids: selectedRecords
      .map((product) => product.id)
      .filter(Boolean)
      .sort(compareText)
  };
}

function readProductField(product, key) {
  return product?.spec?.[key] ?? product?.browse_facets?.[key] ?? null;
}

export function ssdModelMetadata(product) {
  if (!product || !isSsd(product)) return null;
  return {
    canonical_product_id: product.id || null,
    canonical_display_name: product.name || null,
    interface: readProductField(product, "interface"),
    protocol: readProductField(product, "protocol"),
    form_factor: readProductField(product, "form_factor"),
    manufacturer: product.manufacturer || null
  };
}

export const SSD_BROWSE_BUCKETS_V1 = freezeDeep([...SSD_BUCKET_ORDER]);
export const SSD_BROWSE_FLOW = SSD_BROWSE_FLOW_V1;
export const SSD_BROWSE_FACET_KEYS = freezeDeep(["capacity_bucket"]);
export const SSD_MODEL_METADATA_FIELDS_V1 = freezeDeep(
  SSD_BROWSE_FLOW_V1.model_metadata.map(({ key }) => key)
);

export function ssdBrowseFlowForApiV1(products = PC_PRODUCT_MASTER_V2, selection = {}) {
  const facets = ssdBrowseFacetsForMaster(products, selection);
  return {
    version: SSD_BROWSE_FLOW_V1.version,
    category_code: SSD_CATEGORY,
    browse_flow: SSD_BROWSE_FLOW_V1,
    defaults: {},
    available_facets: facets.available_facets,
    selected: facets.selected,
    model_metadata: [...SSD_MODEL_METADATA_FIELDS_V1],
    product_count: facets.model_count
  };
}

