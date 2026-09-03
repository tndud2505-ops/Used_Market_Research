import { PC_PRODUCT_MASTER_V2 } from "../pc-product-master-v2.mjs";

/**
 * GPU is browsed as a compact cascade.  Chip vendor and family are useful
 * discovery choices, while board vendors remain listing-stage filters because
 * the master does not contain board-specific SKU rows yet.
 */
export const GPU_BROWSE_FACET_KEYS = Object.freeze([
  "chip_manufacturer",
  "family"
]);

export const GPU_HIDDEN_BROWSE_FACETS = Object.freeze([
  "market_segment",
  "board_manufacturer",
  "vram_gb"
]);

export const GPU_BROWSE_FLOW_VERSION = 2;

const CHIP_MANUFACTURERS = ["NVIDIA", "AMD", "Intel"];
const FAMILY_BY_CHIP = Object.freeze({
  NVIDIA: Object.freeze(["GeForce GTX", "GeForce RTX"]),
  AMD: Object.freeze(["Radeon RX", "Radeon Vega"]),
  Intel: Object.freeze(["Intel Arc"])
});

export const GPU_BROWSE_FLOW = Object.freeze({
  version: GPU_BROWSE_FLOW_VERSION,
  category: "GPU",
  label: "GPU",
  default_facets: Object.freeze({ market_segment: "DESKTOP" }),
  steps: Object.freeze([
    Object.freeze({
      key: "chip_manufacturer",
      label: "칩 제조사",
      depends_on: Object.freeze([]),
      values: Object.freeze(["NVIDIA", "AMD", "Intel"])
    }),
    Object.freeze({
      key: "family",
      label: "제품군",
      depends_on: Object.freeze(["chip_manufacturer"]),
      values: Object.freeze([])
    })
  ]),
  hidden_facets: GPU_HIDDEN_BROWSE_FACETS,
  model_metadata_fields: Object.freeze(["gpu_model", "generation", "vram_options_gb", "market_segment"]),
  family_by_chip: FAMILY_BY_CHIP
});

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function normalizeText(value) {
  return String(value ?? "").normalize("NFKC").trim();
}

function productNodes(products) {
  return products.filter((product) => (
    product?.category === "GPU" &&
    (product?.spec?.directory_node_type ?? "PRODUCT") === "PRODUCT"
  ));
}

function countBy(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return counts;
}

function option(value, count) {
  return { value, label: value, count };
}

function selectedValue(selection = {}, ...keys) {
  for (const key of keys) {
    const value = normalizeText(selection?.[key]);
    if (value) return value;
  }
  return "";
}

function facetValue(product, key) {
  return product?.browse_facets?.[key] ?? product?.spec?.[key];
}

function normalizeSelection(selection = {}) {
  return {
    chipManufacturer: selectedValue(selection, "chip_manufacturer", "chipManufacturer"),
    family: selectedValue(selection, "family"),
  };
}

/**
 * Return browse facets for the current GPU selection. A family is only
 * emitted after a valid chip manufacturer is selected, preventing unrelated
 * NVIDIA/AMD/Intel families from appearing together in the UI.
 */
export function getGpuBrowseFacets(products = PC_PRODUCT_MASTER_V2, selection = {}) {
  const nodes = productNodes(products).filter((product) => normalizeText(facetValue(product, "market_segment")).toUpperCase() === "DESKTOP");
  const selected = normalizeSelection(selection);
  const chipCounts = countBy(nodes.map((product) => facetValue(product, "chip_manufacturer")).filter(Boolean));
  const chips = [...chipCounts.entries()]
    .map(([value, count]) => option(value, count))
    .sort((left, right) => left.label.localeCompare(right.label, "en", { sensitivity: "base" }));
  const chipScoped = selected.chipManufacturer
    ? nodes.filter((product) => normalizeText(facetValue(product, "chip_manufacturer")).toUpperCase() === selected.chipManufacturer.toUpperCase())
    : [];
  const familyCounts = countBy(chipScoped.map((product) => facetValue(product, "family")).filter(Boolean));
  const families = [...familyCounts.entries()]
    .map(([value, count]) => option(value, count))
    .sort((left, right) => left.label.localeCompare(right.label, "en", { numeric: true, sensitivity: "base" }));

  return deepFreeze({
    version: GPU_BROWSE_FLOW_VERSION,
    category: "GPU",
    default_facets: { ...GPU_BROWSE_FLOW.default_facets },
    visible_facets: [...GPU_BROWSE_FACET_KEYS],
    hidden_facets: [...GPU_HIDDEN_BROWSE_FACETS],
    steps: GPU_BROWSE_FLOW.steps.map((step) => ({
      ...step,
      options: step.key === "chip_manufacturer" ? chips : families,
    })),
    available_facets: {
      chip_manufacturer: chips,
      family: families
    },
    selection: {
      chip_manufacturer: selected.chipManufacturer || null,
      family: selected.family || null,
    },
    model_metadata_fields: [...GPU_BROWSE_FLOW.model_metadata_fields]
  });
}

export function isGpuFamilyCompatible(chipManufacturer, family) {
  const chip = normalizeText(chipManufacturer);
  const requestedFamily = normalizeText(family);
  return Boolean(requestedFamily && (FAMILY_BY_CHIP[chip] || []).includes(requestedFamily));
}

/**
 * Keep VRAM visible on a model row without making it a separate browse
 * facet. The returned object deliberately excludes board manufacturer and
 * browse-only fields.
 */
export function getGpuModelMetadata(product) {
  if (!product || product.category !== "GPU") throw new TypeError("GPU product metadata requires a GPU product");
  const vramOptions = Array.isArray(product.spec?.vram_options_gb)
    ? [...new Set(product.spec.vram_options_gb.map(Number).filter(Number.isFinite))].sort((a, b) => a - b)
    : [];
  return {
    canonical_product_id: product.id,
    canonical_display_name: product.name,
    gpu_model: product.spec?.gpu_model || null,
    vram_options_gb: vramOptions,
    generation: product.browse_facets?.generation || product.spec?.generation || null,
    market_segment: product.spec?.market_segment || "DESKTOP"
  };
}

export function gpuBrowseFlowForApi(products = PC_PRODUCT_MASTER_V2, selection = {}) {
  return getGpuBrowseFacets(products, selection);
}
