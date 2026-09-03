import {
  PC_PRODUCT_MASTER_V2,
  PC_PRODUCT_MASTER_V2_VERSION
} from "../data/pc-product-master-v2.mjs";

export const PUBLIC_PC_CATEGORY_CODES = Object.freeze([
  "CPU", "GPU", "RAM", "MOTHERBOARD", "SSD", "HDD", "PSU"
]);

export const PUBLIC_PC_CATEGORY_DEFINITIONS = Object.freeze([
  { code: "CPU", label: "CPU", brand_label: "제조사", order: 0 },
  { code: "GPU", label: "그래픽카드", brand_label: "제품 브랜드", order: 1 },
  { code: "RAM", label: "RAM", brand_label: "모듈 브랜드", order: 2 },
  { code: "MOTHERBOARD", label: "메인보드", brand_label: "보드 브랜드", order: 3 },
  { code: "SSD", label: "SSD", brand_label: "브랜드", order: 4 },
  { code: "HDD", label: "HDD", brand_label: "브랜드", order: 5 },
  { code: "PSU", label: "파워서플라이", brand_label: "파워 브랜드", order: 6 }
]);

const FACETS = Object.freeze({
  CPU: [
    ["manufacturer", "제조사"], ["generation", "세대·제품군"], ["model", "정확한 CPU 모델"]
  ],
  GPU: [
    ["gpu_model", "GPU 모델"], ["board_brand", "제품 브랜드"], ["model", "정확한 그래픽카드 모델"]
  ],
  RAM: [
    ["usage", "사용 유형"], ["generation", "DDR 세대"], ["configuration", "구성"], ["model", "정확한 제품·품번"]
  ],
  MOTHERBOARD: [
    ["socket", "CPU 소켓"], ["chipset", "칩셋"], ["form_factor", "폼팩터"], ["model", "정확한 보드 모델"]
  ],
  SSD: [
    ["form_interface", "제품 형태·인터페이스"], ["capacity", "용량"], ["model", "정확한 SSD 모델"]
  ],
  HDD: [
    ["capacity", "용량"], ["purpose", "용도"], ["model", "정확한 HDD 모델"]
  ],
  PSU: [
    ["rated_wattage", "정격 출력"], ["form_factor", "폼팩터"], ["model", "정확한 PSU 모델"]
  ]
});

const SUPPLEMENTAL_PRODUCTS = Object.freeze([
  { id: "motherboard:amd:b650m-mortar", name: "MSI MAG B650M MORTAR WIFI", category: "MOTHERBOARD", manufacturer: "MSI", brand: "MAG", group: "motherboard:amd:b650", aliases: ["B650M 박격포 WIFI"], spec: { socket: "AM5", chipset: "B650", exact_model: "B650M MORTAR WIFI", form_factor: "M-ATX", memory_generation: "DDR5", wifi_variant: "WIFI" } },
  { id: "motherboard:intel:b760m-a-d4", name: "ASUS TUF GAMING B760M-A D4", category: "MOTHERBOARD", manufacturer: "ASUS", brand: "TUF Gaming", group: "motherboard:intel:b760", aliases: ["B760M-A D4"], spec: { socket: "LGA1700", chipset: "B760", exact_model: "B760M-A D4", form_factor: "M-ATX", memory_generation: "DDR4", wifi_variant: "NONE" } },
  { id: "ssd:samsung:990-pro-1tb", name: "Samsung 990 PRO 1TB", category: "SSD", manufacturer: "Samsung", brand: "Samsung", group: "ssd:samsung:990-pro", aliases: ["990 PRO 1TB"], spec: { exact_model: "990 PRO", marketed_capacity_gb: 1000, form_factor: "M.2 2280", interface: "PCIe", protocol: "NVMe" } },
  { id: "ssd:samsung:990-pro-2tb", name: "Samsung 990 PRO 2TB", category: "SSD", manufacturer: "Samsung", brand: "Samsung", group: "ssd:samsung:990-pro", aliases: ["990 PRO 2TB"], spec: { exact_model: "990 PRO", marketed_capacity_gb: 2000, form_factor: "M.2 2280", interface: "PCIe", protocol: "NVMe" } },
  { id: "ssd:samsung:m2-sata-1tb", name: "Samsung M.2 SATA 1TB", category: "SSD", manufacturer: "Samsung", brand: "Samsung", group: "ssd:samsung:m2-sata", aliases: ["M.2 SATA 1TB"], spec: { exact_model: "M.2 SATA", marketed_capacity_gb: 1000, form_factor: "M.2 2280", interface: "SATA", protocol: "AHCI" } },
  { id: "hdd:seagate:st16000dm001", name: "Seagate ST16000DM001 16TB", category: "HDD", manufacturer: "Seagate", brand: "Seagate", group: "hdd:seagate:st16000dm001", aliases: ["ST16000DM001 16TB"], spec: { exact_model: "ST16000DM001", marketed_capacity_gb: 16000, purpose: "DESKTOP_PC", form_factor: "3.5-inch", interface: "SATA" } },
  { id: "psu:seasonic:vertex-gx-850", name: "Seasonic VERTEX GX-850 850W", category: "PSU", manufacturer: "Seasonic", brand: "Seasonic", group: "psu:seasonic:gx-850", aliases: ["VERTEX GX-850 850W"], spec: { exact_model: "VERTEX GX-850", rated_wattage: 850, form_factor: "ATX", atx_or_sfx_version: "ATX 3.0" } }
]);

const PUBLIC_PRODUCTS = Object.freeze([
  ...PC_PRODUCT_MASTER_V2.filter((product) => PUBLIC_PC_CATEGORY_CODES.includes(product.category)),
  ...SUPPLEMENTAL_PRODUCTS
].reduce((products, product) => {
  if (!products.some((candidate) => candidate.id === product.id)) products.push(product);
  return products;
}, []));

function normalize(value) {
  return String(value ?? "").normalize("NFKC").trim();
}

function compact(value) {
  return normalize(value).toUpperCase().replace(/[^0-9A-Z가-힣]+/gu, "");
}

function values(value) {
  if (value === undefined || value === null || value === "") return [];
  return (Array.isArray(value) ? value : [value]).map(normalize).filter(Boolean);
}

function first(value) {
  return values(value)[0] || "";
}

function categoryCode(value, { allowEmpty = false } = {}) {
  const code = normalize(value).toUpperCase();
  if (!code && allowEmpty) return "";
  if (!PUBLIC_PC_CATEGORY_CODES.includes(code)) throw new RangeError(`Unknown public PC category: ${code || ""}`);
  return code;
}

function productSpec(product) {
  return { ...(product.spec || {}), ...(product.browse_facets || {}) };
}

function modelValue(product) {
  const spec = productSpec(product);
  return first(spec.exact_model || spec.gpu_model || spec.cpu_model || product.name);
}

function capacityValues(product) {
  const spec = productSpec(product);
  const exact = spec.marketed_capacity_gb ?? spec.capacity_gb;
  if (exact !== undefined && exact !== null) return [normalize(exact)];
  return values(spec.capacity_examples_gb || spec.capacity_bucket);
}

function publicFacetValues(product, key) {
  const spec = productSpec(product);
  switch (key) {
    case "manufacturer": return values(product.manufacturer || spec.chip_manufacturer || spec.platform_vendor);
    case "generation": return values(spec.generation || spec.memory_generation || spec.family);
    case "model": return values(modelValue(product));
    case "gpu_model": return values(spec.gpu_model || (product.category === "GPU" ? modelValue(product) : ""));
    case "board_brand": return values(spec.board_manufacturer || product.board_brand || product.brand);
    case "usage": {
      if (product.category === "RAM" && ["SODIMM", "SO-DIMM"].includes(first(spec.form_factor || spec.buffering).toUpperCase())) return ["LAPTOP"];
      const segment = normalize(spec.market_segment || "CONSUMER_DESKTOP");
      return [segment === "DESKTOP" ? "CONSUMER_DESKTOP" : segment];
    }
    case "configuration": return product.category === "RAM" ? [`${first(spec.module_capacity_gb || spec.capacity_per_module_gb)}GB × ${first(spec.module_count || spec.modules_per_kit || 1)}`] : [];
    case "module_capacity_gb": return product.category === "RAM" ? values(spec.module_capacity_gb || spec.capacity_per_module_gb) : [];
    case "socket": return values(spec.socket);
    case "chipset": return values(spec.chipset || first(modelValue(product).match(/\b([ABHXZ]\d{3})M?/iu)?.[1]));
    case "form_factor": return values(spec.form_factor);
    case "form_interface": return values(spec.form_factor && spec.protocol ? `${spec.form_factor} ${spec.protocol}` : spec.form_factor || spec.interface);
    case "interface": return values(spec.interface);
    case "capacity": return capacityValues(product);
    case "purpose": return values(spec.purpose || spec.use_class);
    case "rated_wattage": return values(spec.rated_wattage || spec.watts || first(modelValue(product).match(/\b\d{3,4}\s*W\b/iu)?.[0]?.replace(/\s+/gu, "")));
    default: return [];
  }
}

function filterMatches(product, key, requested) {
  if (!requested.length) return true;
  const actual = publicFacetValues(product, key);
  return requested.some((expected) => actual.some((candidate) => compact(candidate) === compact(expected)));
}

function normalizeFilters(options = {}) {
  const input = options instanceof URLSearchParams ? Object.fromEntries(options.entries()) : options;
  const category = categoryCode(input.category || input.category_code, { allowEmpty: true });
  const filters = {};
  const aliases = {
    manufacturer: ["manufacturer", "brand"], generation: ["generation", "memory_generation"], model: ["model", "exact_model"],
    gpu_model: ["gpu_model"], board_brand: ["board_brand", "board_manufacturer"], usage: ["usage", "market_segment"],
    configuration: ["configuration", "config"], module_capacity_gb: ["module_capacity_gb", "capacity_per_module_gb"], socket: ["socket"], chipset: ["chipset"], form_factor: ["form_factor"],
    form_interface: ["form_interface"], capacity: ["capacity", "marketed_capacity_gb", "capacity_bucket"], purpose: ["purpose", "use_class"],
    rated_wattage: ["rated_wattage", "watts", "watts_bucket"]
  };
  for (const [key, names] of Object.entries(aliases)) {
    const requested = names.flatMap((name) => values(input[name]));
    if (requested.length) filters[key] = [...new Set(requested)];
  }
  return { category, filters };
}

function matchingProducts(category, filters, exceptKey = null) {
  return PUBLIC_PRODUCTS.filter((product) => (!category || product.category === category)
    && Object.entries(filters).every(([key, requested]) => key === exceptKey || filterMatches(product, key, requested)));
}

function optionLabel(key, value) {
  if (key === "capacity" && /^\d+(?:\.\d+)?$/u.test(value)) {
    const gb = Number(value);
    return gb >= 1000 ? `${gb / 1000}TB` : `${gb}GB`;
  }
  return value;
}

export function publicPcProducts() {
  return PUBLIC_PRODUCTS;
}

export function publicPcFacetDefinitions(category) {
  return FACETS[categoryCode(category)].map(([key, label], order) => ({ key, label, order }));
}

export function publicPcCatalogForApi() {
  const categories = PUBLIC_PC_CATEGORY_DEFINITIONS.map((definition) => {
    const products = PUBLIC_PRODUCTS.filter((product) => product.category === definition.code);
    return {
      code: definition.code,
      label: definition.label,
      brand_label: definition.brand_label,
      order: definition.order,
      model_count: products.length,
      active_count: 0,
      sold_30d_count: 0
    };
  });
  return {
    master_version: `public-pc-${PC_PRODUCT_MASTER_V2_VERSION}`,
    categories,
    brand_label_by_category: Object.fromEntries(PUBLIC_PC_CATEGORY_DEFINITIONS.map(({ code, brand_label }) => [code, brand_label])),
    facet_schema: Object.fromEntries(PUBLIC_PC_CATEGORY_CODES.map((code) => [code, publicPcFacetDefinitions(code)])),
    browse_flow: Object.fromEntries(PUBLIC_PC_CATEGORY_CODES.map((code) => [code, { category_code: code, steps: publicPcFacetDefinitions(code) }])),
    products: PUBLIC_PRODUCTS.map((product) => publicProductForApi(product))
  };
}

export function publicPcFacetsForApi(options = {}) {
  const { category, filters } = normalizeFilters(options);
  if (!category) return { category: "", filters, facets: {}, available_facets: {} };
  const definitions = publicPcFacetDefinitions(category);
  const facets = Object.fromEntries(definitions.map(({ key, label, order }) => {
    const counts = new Map();
    for (const product of matchingProducts(category, filters, key)) {
      for (const value of publicFacetValues(product, key)) counts.set(value, (counts.get(value) || 0) + 1);
    }
    return [key, { key, label, order, values: [...counts.entries()].sort(([a], [b]) => compact(a).localeCompare(compact(b))).map(([value, count]) => ({ value, label: optionLabel(key, value), count })) }];
  }));
  return { category, filters, facets, available_facets: Object.fromEntries(Object.entries(facets).map(([key, value]) => [key, value.values])) };
}

function publicProductForApi(product, stats = {}) {
  const spec = productSpec(product);
  const category = PUBLIC_PC_CATEGORY_DEFINITIONS.find((definition) => definition.code === product.category);
  return {
    canonical_product_id: product.id,
    canonical_display_name: product.name,
    category_code: product.category,
    brand_label: category?.brand_label || "브랜드",
    brand: product.category === "GPU" ? (spec.board_manufacturer || product.board_brand || product.brand || null) : (product.manufacturer || product.brand || null),
    key_specs: spec,
    active_count: Number(stats.active_count || 0),
    active_median: stats.active_median ?? null,
    active_trimmed_mean: stats.active_trimmed_mean ?? null,
    sold_30d_count: Number(stats.sold_30d_count || 0),
    sold_30d_last_ask_median: stats.sold_30d_last_ask_median ?? null,
    last_updated_at: stats.last_updated_at || null,
    aliases: product.aliases || []
  };
}

export function publicPcModelsForApi(options = {}) {
  const input = options instanceof URLSearchParams ? Object.fromEntries(options.entries()) : options;
  const { category, filters } = normalizeFilters(input);
  const query = normalize(input.q || input.query).toLocaleUpperCase("ko-KR");
  const products = matchingProducts(category, filters).filter((product) => {
    if (!query) return true;
    return [product.id, product.name, ...(product.aliases || [])].some((value) => normalize(value).toLocaleUpperCase("ko-KR").includes(query));
  });
  return {
    category,
    filters,
    models: products.map((product) => publicProductForApi(product))
  };
}

export function publicPcCategoryForLegacy(value) {
  const code = normalize(value).toUpperCase();
  return PUBLIC_PC_CATEGORY_CODES.includes(code) ? code : "UNSUPPORTED_CATEGORY";
}
