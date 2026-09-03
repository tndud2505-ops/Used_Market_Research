import { PC_PRODUCT_MASTER_V2 } from "../pc-product-master-v2.mjs";

const RAM_CATEGORY = "RAM";
const PRODUCT_NODE = "PRODUCT";
const GENERATION_ORDER = ["DDR3", "DDR4", "DDR5"];

function freezeDeep(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeDeep(child);
  }
  return value;
}

function normalizeText(value) {
  return String(value ?? "").normalize("NFKC").trim().toUpperCase();
}

function normalizeCapacity(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "string"
    ? Number(value.trim().match(/^(\d+(?:\.\d+)?)\s*(?:GB|G)?$/iu)?.[1])
    : Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function ramProducts(products) {
  return (Array.isArray(products) ? products : []).filter((product) => (
    normalizeText(product?.category) === RAM_CATEGORY
    && normalizeText(product?.browse_facets?.directory_node_type || product?.spec?.directory_node_type) === PRODUCT_NODE
  ));
}

function generationValue(product) {
  return String(product?.browse_facets?.memory_generation ?? product?.spec?.memory_generation ?? "").normalize("NFKC").trim();
}

function capacityValue(product) {
  return normalizeCapacity(product?.browse_facets?.module_capacity_gb ?? product?.spec?.module_capacity_gb);
}

function compareGeneration(left, right) {
  const leftIndex = GENERATION_ORDER.indexOf(left);
  const rightIndex = GENERATION_ORDER.indexOf(right);
  return (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex) - (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex)
    || left.localeCompare(right, "en");
}

function uniqueValues(records, readValue, compare) {
  return [...new Set(records.map(readValue).filter((value) => value !== null && value !== undefined && value !== ""))].sort(compare);
}

function facetOptions(records, readValue, compare, label = (value) => String(value)) {
  const values = uniqueValues(records, readValue, compare);
  return values.map((value) => ({
    value,
    label: label(value),
    count: records.filter((record) => readValue(record) === value).length
  }));
}

/**
 * The RAM browse path is intentionally short: DDR generation -> module capacity -> model.
 * Form factor, module count, and total capacity stay model metadata instead of becoming
 * extra filter rows. This registry is data-derived so an unregistered value cannot leak
 * into the public directory.
 */
export const RAM_BROWSE_FLOW_V1 = freezeDeep({
  version: 1,
  category_code: RAM_CATEGORY,
  steps: [
    { key: "memory_generation", label: "DDR 세대", source: "browse_facets", selection: "single" },
    { key: "module_capacity_gb", label: "모듈 용량", source: "browse_facets", selection: "single", depends_on: ["memory_generation"] },
    { key: "model", label: "모델", source: "product_master", selection: "single", depends_on: ["memory_generation", "module_capacity_gb"] }
  ],
  model_metadata: [
    { key: "module_count", label: "모듈 수", source: "spec" },
    { key: "total_capacity_gb", label: "총용량", source: "derived_or_spec" },
    { key: "form_factor", label: "DIMM/SODIMM", source: "spec_or_browse_facets" }
  ]
});

/**
 * Return the available RAM facet values for the current cascade selection.
 * Counts are calculated from the V2 master records, never from a hand-written
 * capacity list. The facet's own selection is ignored while counting that facet,
 * which keeps sibling choices visible when a user changes a selection.
 */
export function ramBrowseFacetsForMaster(products = PC_PRODUCT_MASTER_V2, selection = {}) {
  const records = ramProducts(products);
  const requestedGeneration = String(selection?.memory_generation ?? "").normalize("NFKC").trim();
  const selectedGeneration = records.map(generationValue)
    .find((value) => normalizeText(value) === normalizeText(requestedGeneration)) || requestedGeneration;
  const selectedCapacity = normalizeCapacity(selection?.module_capacity_gb);

  const generationScope = records.filter((record) => (
    selectedCapacity === null || capacityValue(record) === selectedCapacity
  ));
  const capacityScope = records.filter((record) => (
    !selectedGeneration || generationValue(record) === selectedGeneration
  ));
  const selectedScope = records.filter((record) => (
    (!selectedGeneration || generationValue(record) === selectedGeneration)
    && (selectedCapacity === null || capacityValue(record) === selectedCapacity)
  ));

  return {
    category_code: RAM_CATEGORY,
    browse_flow: RAM_BROWSE_FLOW_V1,
    selected: {
      memory_generation: selectedGeneration || null,
      module_capacity_gb: selectedCapacity
    },
    available_facets: {
      memory_generation: facetOptions(generationScope, generationValue, compareGeneration),
      module_capacity_gb: facetOptions(capacityScope, capacityValue, (left, right) => left - right, (value) => `${value}GB`)
    },
    model_count: selectedScope.length,
    model_ids: selectedScope.map((product) => product.id).sort((left, right) => String(left).localeCompare(String(right), "en"))
  };
}

/**
 * Project the metadata shown beside a RAM model. Existing master fields win;
 * total capacity is derived only when module count and module capacity are known.
 */
export function ramModelMetadata(product) {
  if (!product || normalizeText(product.category) !== RAM_CATEGORY) return null;
  const spec = product.spec || {};
  const facets = product.browse_facets || {};
  const moduleCapacity = normalizeCapacity(spec.module_capacity_gb ?? facets.module_capacity_gb);
  const moduleCount = normalizeCapacity(spec.module_count);
  const totalCapacity = normalizeCapacity(spec.total_capacity_gb)
    ?? (moduleCapacity !== null && moduleCount !== null ? moduleCapacity * moduleCount : null);
  const formFactor = spec.form_factor ?? facets.form_factor ?? spec.memory_form_factor ?? facets.memory_form_factor ?? null;
  return {
    module_capacity_gb: moduleCapacity,
    module_count: moduleCount,
    total_capacity_gb: totalCapacity,
    form_factor: formFactor
  };
}

export const RAM_BROWSE_GENERATIONS_V1 = freezeDeep([...GENERATION_ORDER]);

// Aliases keep the category module easy to consume from the shared catalog
// registry while retaining the explicit V1 names used by this contract.
export const RAM_BROWSE_FLOW = RAM_BROWSE_FLOW_V1;
export const RAM_BROWSE_FACET_KEYS = freezeDeep(["memory_generation", "module_capacity_gb"]);
export const RAM_MODEL_METADATA_FIELDS_V1 = freezeDeep(RAM_BROWSE_FLOW_V1.model_metadata.map(({ key }) => key));

export function ramBrowseFlowForApiV1(products = PC_PRODUCT_MASTER_V2, selection = {}) {
  const facets = ramBrowseFacetsForMaster(products, selection);
  return {
    version: RAM_BROWSE_FLOW_V1.version,
    category_code: RAM_CATEGORY,
    browse_flow: RAM_BROWSE_FLOW_V1,
    defaults: {},
    available_facets: facets.available_facets,
    selected: facets.selected,
    model_metadata: [...RAM_MODEL_METADATA_FIELDS_V1],
    product_count: facets.model_count
  };
}
