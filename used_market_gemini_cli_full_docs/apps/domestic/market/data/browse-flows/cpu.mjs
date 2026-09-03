import { PC_PRODUCT_MASTER_V2 } from "../pc-product-master-v2.mjs";

export const CPU_BROWSE_FLOW_VERSION = 1;

const CPU_BROWSE_FLOW = [
  {
    key: "platform_vendor",
    label: "제조사",
    source: "browse_facets",
    depends_on: [],
    visible: true
  },
  {
    key: "family",
    label: "제품군",
    source: "browse_facets",
    depends_on: ["platform_vendor"],
    visible: true
  }
];

const CPU_BROWSE_DEFAULT_FILTERS = {
  market_segment: "DESKTOP"
};

const CPU_MODEL_METADATA_FIELDS = [
  "cpu_model",
  "generation",
  "suffix",
  "socket"
];

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function asValues(value) {
  if (value === undefined || value === null || value === "") return [];
  return (Array.isArray(value) ? value : [value])
    .map((item) => String(item).normalize("NFKC").trim())
    .filter(Boolean);
}

function sameValue(left, right) {
  return String(left).normalize("NFKC").toUpperCase() === String(right).normalize("NFKC").toUpperCase();
}

function matches(actual, requested) {
  const values = asValues(actual);
  return requested.length === 0 || requested.some((expected) => values.some((value) => sameValue(value, expected)));
}

function productFacet(product, key) {
  return product?.browse_facets?.[key];
}

function compareText(left, right) {
  return String(left).localeCompare(String(right), "en", { sensitivity: "base", numeric: true });
}

/**
 * The CPU directory intentionally contains desktop CPUs only.  Generation,
 * suffix, and socket are model metadata and are not browse steps.
 */
export function cpuBrowseProductsV1(products = PC_PRODUCT_MASTER_V2) {
  return products.filter((product) => product?.category === "CPU"
    && product?.spec?.directory_node_type === "PRODUCT"
    && sameValue(productFacet(product, "market_segment"), CPU_BROWSE_DEFAULT_FILTERS.market_segment));
}

function productsForSelection(products, selections, keys) {
  return products.filter((product) => keys.every((key) => matches(productFacet(product, key), asValues(selections?.[key]))));
}

/**
 * Returns choices for the visible CPU cascade. Counts are always calculated
 * from the current desktop product master, never from a hard-coded list.
 */
export function cpuBrowseFacetValuesV1(products = PC_PRODUCT_MASTER_V2, selections = {}) {
  const desktopProducts = cpuBrowseProductsV1(products);
  const result = {};
  for (const [index, step] of CPU_BROWSE_FLOW.entries()) {
    const parentKeys = CPU_BROWSE_FLOW.slice(0, index).map(({ key }) => key);
    const scoped = productsForSelection(desktopProducts, selections, parentKeys);
    const counts = new Map();
    for (const product of scoped) {
      for (const value of asValues(productFacet(product, step.key))) {
        const existing = counts.get(value) || { value, label: value, count: 0 };
        existing.count += 1;
        counts.set(value, existing);
      }
    }
    result[step.key] = [...counts.values()].sort((left, right) => compareText(left.label, right.label));
  }
  return result;
}

export function cpuBrowseFlowForApiV1(products = PC_PRODUCT_MASTER_V2) {
  const desktopProducts = cpuBrowseProductsV1(products);
  return {
    version: CPU_BROWSE_FLOW_VERSION,
    category_code: "CPU",
    browse_flow: CPU_BROWSE_FLOW,
    defaults: CPU_BROWSE_DEFAULT_FILTERS,
    model_metadata: CPU_MODEL_METADATA_FIELDS,
    available_facets: cpuBrowseFacetValuesV1(products),
    product_count: desktopProducts.length
  };
}

export const CPU_BROWSE_FLOW_V1 = deepFreeze(CPU_BROWSE_FLOW);
export const CPU_BROWSE_DEFAULT_FILTERS_V1 = deepFreeze(CPU_BROWSE_DEFAULT_FILTERS);
export const CPU_MODEL_METADATA_FIELDS_V1 = deepFreeze(CPU_MODEL_METADATA_FIELDS);

export const CPU_VENDOR_FAMILIES_V1 = deepFreeze(
  Object.fromEntries(
    cpuBrowseFacetValuesV1().platform_vendor.map(({ value }) => [
      value,
      cpuBrowseFacetValuesV1(PC_PRODUCT_MASTER_V2, { platform_vendor: value }).family.map(({ value: family }) => family)
    ])
  )
);
