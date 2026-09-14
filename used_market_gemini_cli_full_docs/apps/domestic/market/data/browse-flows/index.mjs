import { PC_PRODUCT_MASTER_V2 } from "../pc-product-master-v2.mjs";
import { GPU_BROWSE_FLOW, getGpuBrowseFacets } from "./gpu.mjs";
import { CPU_BROWSE_FLOW_V1, CPU_BROWSE_DEFAULT_FILTERS_V1, cpuBrowseFlowForApiV1, cpuBrowseProductsV1 } from "./cpu.mjs";
import { RAM_BROWSE_FLOW_V1, ramBrowseFlowForApiV1, ramBrowseFacetsForMaster } from "./ram.mjs";
import { PSU_WATTS_BUCKET_LABELS_V1 } from "./psu.mjs";

const CATEGORY_ORDER = Object.freeze(["GPU", "CPU", "RAM", "MOTHERBOARD", "SSD", "HDD", "PSU", "COOLING", "CASE", "EXPANSION_CARD", "ODD"]);
const FALLBACK_FLOW = Object.freeze({
  SSD: [
    { key: "product_kind", label: "제품 종류" },
    { key: "capacity_bucket", label: "용량" },
    { key: "manufacturer", label: "제조사" }
  ],
  MOTHERBOARD: [
    { key: "platform_vendor", label: "CPU 플랫폼" },
    { key: "socket", label: "CPU 소켓" },
    { key: "chipset", label: "칩셋" },
    { key: "manufacturer", label: "제조사" }
  ],
  HDD: [
    { key: "placement", label: "설치 방식" },
    { key: "capacity_bucket", label: "용량" },
    { key: "manufacturer", label: "제조사" }
  ],
  PSU: [
    { key: "watts_bucket", label: "정격 출력" },
    { key: "form_factor", label: "크기 규격" },
    { key: "manufacturer", label: "제조사" }
  ],
  COOLING: [{ key: "subtype", label: "종류" }],
  CASE: [{ key: "chassis_class", label: "케이스 크기" }],
  EXPANSION_CARD: [{ key: "subtype", label: "용도" }],
  ODD: [{ key: "media_family", label: "미디어" }],
});
const HDD_CAPACITY_LABELS = Object.freeze({
  LE_1_TB: "1TB 이하",
  GT_1_TB_LE_2_TB: "1TB 초과~2TB",
  GT_2_TB_LE_4_TB: "2TB 초과~4TB",
  GT_4_TB_LE_6_TB: "4TB 초과~6TB",
  GT_6_TB_LE_8_TB: "6TB 초과~8TB",
  GT_8_TB_LE_12_TB: "8TB 초과~12TB",
  GT_12_TB_LE_16_TB: "12TB 초과~16TB",
  GT_16_TB_LE_20_TB: "16TB 초과~20TB",
  GT_20_TB_LE_24_TB: "20TB 초과~24TB",
  GT_24_TB: "24TB 초과"
});
const SSD_CAPACITY_LABELS = Object.freeze({
  LE_256_GB: "256GB 이하",
  "257_512_GB": "257~512GB",
  "513_GB_1_TB": "513GB~1TB",
  GT_1_TB_LE_2_TB: "1TB 초과~2TB",
  GT_2_TB_LE_4_TB: "2TB 초과~4TB",
  GT_4_TB_LE_8_TB: "4TB 초과~8TB",
  GT_8_TB: "8TB 초과"
});

function normalizeText(value) {
  return String(value ?? "").normalize("NFKC").trim();
}

function values(value) {
  if (value === undefined || value === null || value === "") return [];
  return (Array.isArray(value) ? value : [value]).map(normalizeText).filter(Boolean);
}

function same(left, right) {
  return normalizeText(left).toUpperCase() === normalizeText(right).toUpperCase();
}

function productNode(product) {
  const node = normalizeText(product?.browse_facets?.directory_node_type ?? product?.spec?.directory_node_type).toUpperCase();
  return !node || node === "PRODUCT";
}

function browseProducts(category, products = PC_PRODUCT_MASTER_V2) {
  const categoryRecords = (Array.isArray(products) ? products : []).filter((product) => same(product?.category, category));
  let records = categoryRecords.filter(productNode);
  if (records.length === 0) {
    records = categoryRecords.filter((product) => same(
      product?.browse_facets?.directory_node_type ?? product?.spec?.directory_node_type,
      "BROWSE_BUCKET"
    ));
  }
  if (["GPU", "CPU"].includes(category)) {
    records = records.filter((product) => same(product?.browse_facets?.market_segment ?? product?.spec?.market_segment, "DESKTOP"));
  }
  if (category === "CPU") return cpuBrowseProductsV1(products);
  return records;
}

function facetValue(product, key) {
  if (key === "manufacturer") return product?.manufacturer;
  if (key === "product_kind" && product?.category === "SSD") return ["M2_NVME", "SATA_2_5", "M2_SATA", "EXTERNAL", "OTHER_UNKNOWN"];
  if (key === "placement" && product?.category === "HDD") return ["INTERNAL", "EXTERNAL", "UNKNOWN"];
  if (key === "family") return product?.browse_facets?.family ?? product?.spec?.family;
  return product?.browse_facets?.[key] ?? product?.spec?.[key] ?? product?.[key];
}

function flowSteps(category) {
  const configured = category === "GPU" ? GPU_BROWSE_FLOW.steps
    : category === "CPU" ? CPU_BROWSE_FLOW_V1
      : category === "RAM" ? RAM_BROWSE_FLOW_V1.steps
        : FALLBACK_FLOW[category] || [];
  return configured.filter((step) => step?.key && step.key !== "model").map((step) => ({
    key: step.key,
    label: step.label || step.key,
    ...(step.depends_on?.length ? { depends_on: [...step.depends_on] } : {}),
  }));
}

function staticFlow(category) {
  const steps = flowSteps(category);
  const defaults = category === "GPU" ? { market_segment: "DESKTOP" }
    : category === "CPU" ? { ...CPU_BROWSE_DEFAULT_FILTERS_V1 }
      : {};
  return {
    version: category === "GPU" ? GPU_BROWSE_FLOW.version : 1,
    category_code: category,
    steps,
    defaults,
    hidden_facets: category === "GPU" ? ["market_segment", "board_manufacturer", "vram_gb"] : [],
    model_metadata: category === "GPU"
      ? ["gpu_model", "vram_options_gb", "market_segment"]
      : category === "CPU"
        ? ["cpu_model", "generation", "suffix", "socket"]
        : category === "RAM"
      ? ["module_count", "total_capacity_gb", "form_factor"]
      : category === "SSD"
        ? ["interface", "protocol", "form_factor", "manufacturer"]
        : category === "PSU"
          ? ["manufacturer", "atx_spec", "form_factor", "efficiency", "modularity"]
          : [],
  };
}

function selectedValue(selection, key) {
  const entry = selection?.[key];
  return values(entry)[0] || "";
}

function genericFacets(category, products, selection = {}) {
  const records = browseProducts(category, products);
  const result = {};
  const steps = flowSteps(category);
  steps.forEach((step, index) => {
    const preceding = steps.slice(0, index);
    const scoped = records.filter((product) => preceding.every((parent) => {
      const requested = selectedValue(selection, parent.key);
      return !requested || values(facetValue(product, parent.key)).some((actual) => same(actual, requested));
    }));
    const counts = new Map();
    scoped.forEach((product) => values(facetValue(product, step.key)).forEach((value) => {
      const key = value.toUpperCase();
      const label = step.key === "capacity_bucket" && category === "HDD"
        ? HDD_CAPACITY_LABELS[value] || value
        : step.key === "capacity_bucket" && category === "SSD"
          ? SSD_CAPACITY_LABELS[value] || value
          : step.key === "watts_bucket" && category === "PSU"
            ? PSU_WATTS_BUCKET_LABELS_V1[value] || value
            : value;
      if (!counts.has(key)) counts.set(key, { value, label, count: 0 });
      counts.get(key).count += 1;
    }));
    result[step.key] = [...counts.values()];
  });
  return result;
}

function categorySpecific(category, selection, products) {
  if (category === "GPU") {
    const data = getGpuBrowseFacets(products, selection);
    return { available_facets: data.available_facets, product_count: browseProducts(category, products).filter((product) => Object.entries(selection).every(([key, value]) => !value || values(facetValue(product, key)).some((actual) => same(actual, value)))).length };
  }
  if (category === "CPU") {
    const available = genericFacets(category, products, selection);
    const records = browseProducts(category, products).filter((product) => Object.entries(selection).every(([key, value]) => !value || values(facetValue(product, key)).some((actual) => same(actual, value))));
    return { available_facets: available, product_count: records.length };
  }
  if (category === "RAM") {
    const data = ramBrowseFacetsForMaster(products, selection);
    return { available_facets: data.available_facets, product_count: data.model_count };
  }
  const available = genericFacets(category, products, selection);
  const records = browseProducts(category, products).filter((product) => Object.entries(selection).every(([key, value]) => !value || values(facetValue(product, key)).some((actual) => same(actual, value))));
  return { available_facets: available, product_count: records.length };
}

export function pcBrowseFlowForApiV1(category, selection = {}, products = PC_PRODUCT_MASTER_V2) {
  const normalizedCategory = normalizeText(category).toUpperCase();
  if (!CATEGORY_ORDER.includes(normalizedCategory)) return null;
  const flow = staticFlow(normalizedCategory);
  const specific = categorySpecific(normalizedCategory, selection, products);
  return {
    ...flow,
    available_facets: specific.available_facets,
    selected: Object.fromEntries(flow.steps.map((step) => [step.key, selectedValue(selection, step.key) || null])),
    product_count: specific.product_count,
  };
}

export function pcBrowseFlowCatalogV1(products = PC_PRODUCT_MASTER_V2) {
  return Object.fromEntries(CATEGORY_ORDER.map((category) => {
    const data = pcBrowseFlowForApiV1(category, {}, products);
    return [category, data];
  }));
}

export const PC_BROWSE_FLOW_CATEGORIES_V1 = CATEGORY_ORDER;
