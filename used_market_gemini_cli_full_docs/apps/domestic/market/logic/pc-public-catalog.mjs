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
    ["manufacturer", "제조사"], ["family", "제품군"], ["generation", "세대"], ["socket", "소켓"], ["suffix", "모델 구분"]
  ],
  GPU: [
    ["manufacturer", "칩 제조사"], ["family", "제품군"], ["generation", "세대"], ["vram_gb", "VRAM"]
  ],
  RAM: [
    ["generation", "DDR 세대"], ["module_capacity_gb", "모듈 용량"], ["manufacturer", "제조사"]
  ],
  MOTHERBOARD: [
    ["platform_vendor", "CPU 플랫폼"], ["socket", "CPU 소켓"], ["chipset", "칩셋"], ["manufacturer", "제조사"]
  ],
  SSD: [
    ["product_kind", "제품 종류"], ["capacity_bucket", "용량"], ["manufacturer", "제조사"]
  ],
  HDD: [
    ["placement", "설치 방식"], ["capacity_bucket", "용량"], ["manufacturer", "제조사"]
  ],
  PSU: [
    ["watts_bucket", "정격 출력"], ["form_factor", "크기 규격"], ["manufacturer", "제조사"]
  ]
});
const LISTING_ONLY_FACETS = new Set(["product_kind", "placement", "form_factor"]);

const PUBLIC_PRODUCTS = Object.freeze([
  ...PC_PRODUCT_MASTER_V2.filter((product) => PUBLIC_PC_CATEGORY_CODES.includes(product.category))
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

const MOTHERBOARD_MANUFACTURERS = Object.freeze([
  ["ASUS", /(?:\bASUS\b|에이수스|아수스)/iu],
  ["GIGABYTE", /(?:\bGIGABYTE\b|기가바이트)/iu],
  ["MSI", /\bMSI\b/iu],
  ["ASRock", /(?:\bASRock\b|애즈락|아스락)/iu],
  ["Biostar", /(?:\bBiostar\b|바이오스타)/iu]
]);

function motherboardMatchText(value) {
  return ` ${normalize(value).toUpperCase().replace(/[^0-9A-Z가-힣]+/gu, " ").replace(/\s+/gu, " ").trim()} `;
}

function motherboardPlatform(text) {
  const amd = /\b(?:A320|B350|X370|B450|X470|A520|B550|X570|A620|B650|X670|B840|B850|X870)(?:M|I|E)?\b/iu.test(text);
  const intel = /\b(?:H110|B150|Z170|B250|Z270|B360|B365|Z370|Z390|B460|Z490|B560|Z590|H610|B660|Z690|B760|Z790|B860|Z890)(?:M|I|E)?\b/iu.test(text);
  return amd === intel ? null : (amd ? "AMD" : "Intel");
}

export function resolveExactMotherboardProduct(value) {
  const sourceText = normalize(value);
  const text = motherboardMatchText(sourceText);
  const manufacturers = [...new Set(MOTHERBOARD_MANUFACTURERS
    .filter(([, pattern]) => pattern.test(sourceText))
    .map(([manufacturer]) => manufacturer))];
  if (manufacturers.length > 1) return { product: null, reason: "MANUFACTURER_CONFLICT", manufacturer: null, platform_vendor: motherboardPlatform(text) };
  if (/(?:랜덤\s*(?:발송|출고)|무작위|복수\s*선택|택\s*1|옵션\s*(?:선택|상품)|중\s*하나)/iu.test(sourceText)) {
    return { product: null, reason: "EXACT_MODEL_REQUIRED", manufacturer: manufacturers[0] || null, platform_vendor: motherboardPlatform(text) };
  }
  const candidates = PUBLIC_PRODUCTS
    .filter((product) => product.category === "MOTHERBOARD" && productSpec(product).directory_node_type === "PRODUCT")
    .filter((product) => !manufacturers[0] || product.manufacturer === manufacturers[0])
    .map((product) => ({
      product,
      score: Math.max(0, ...[product.name, ...(product.aliases || [])].map((alias) => {
        const normalizedAlias = motherboardMatchText(alias).trim();
        return text.includes(` ${normalizedAlias} `) ? normalizedAlias.length : 0;
      }))
    }))
    .filter(({ product, score }) => {
      if (!score) return false;
      const spec = productSpec(product);
      const official = motherboardMatchText(spec.official_model || product.name);
      const revisionMatch = sourceText.match(/(?:\bREV(?:ISION)?\b|리비전)\s*(\d+(?:\.\d+)+)/iu);
      const hasWifiVariant = /\b(?:(?:WIFI|WI FI)(?:\s*[67](?:E)?)?|AX)\b/u;
      if (hasWifiVariant.test(text) && spec.wifi === false && !hasWifiVariant.test(official)) return false;
      if (/\bDDR[345]\b/u.test(text) && !text.includes(` ${String(spec.memory_generation || "").toUpperCase()} `)) return false;
      if (["D3", "D4", "D5", "II", "V2", "ICE"].some((token) => text.includes(` ${token} `) && !official.includes(` ${token} `))) return false;
      if (spec.revision_required && !revisionMatch) return false;
      if (revisionMatch && !spec.revision) return false;
      if (revisionMatch && Array.isArray(spec.verified_revisions) && spec.verified_revisions.length
        && !spec.verified_revisions.includes(revisionMatch[1])) return false;
      return true;
    })
    .sort((left, right) => right.score - left.score);
  const winner = candidates[0];
  if (!winner || (candidates[1] && candidates[1].score === winner.score)) {
    return { product: null, reason: "EXACT_MODEL_REQUIRED", manufacturer: manufacturers[0] || null, platform_vendor: motherboardPlatform(text) };
  }
  return {
    product: winner.product,
    reason: null,
    manufacturer: winner.product.manufacturer,
    platform_vendor: productSpec(winner.product).platform_vendor
  };
}

export function resolveMotherboardDirectoryNode(value) {
  const exact = resolveExactMotherboardProduct(value);
  if (exact.product) return exact;
  const facet = exact.manufacturer && exact.platform_vendor
    ? PUBLIC_PRODUCTS.find((product) => product.id === `motherboard:platform:${exact.platform_vendor.toLowerCase()}:${slugForId(exact.manufacturer)}`) || null
    : null;
  return { ...exact, product: facet, exact_product: false };
}

function slugForId(value) {
  return normalize(value).toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");
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

function productCapacityNumbers(product) {
  const spec = productSpec(product);
  const numbers = [];
  if (spec.marketed_capacity_gb) numbers.push(Number(spec.marketed_capacity_gb));
  if (spec.capacity_gb) numbers.push(Number(spec.capacity_gb));
  if (Array.isArray(spec.capacity_examples_gb)) {
    for (const ex of spec.capacity_examples_gb) numbers.push(Number(ex));
  }
  const bucketValues = {
    LE_256_GB: [256], '257_512_GB': [512], '513_GB_1_TB': [1000],
    GT_1_TB_LE_2_TB: [2000], GT_2_TB_LE_4_TB: [4000], GT_4_TB_LE_8_TB: [8000], GT_8_TB: [16000],
    LE_1_TB: [1000], GT_4_TB_LE_6_TB: [6000], GT_6_TB_LE_8_TB: [8000], GT_8_TB_LE_12_TB: [12000],
    GT_12_TB_LE_16_TB: [16000], GT_16_TB_LE_20_TB: [20000], GT_20_TB_LE_24_TB: [24000], GT_24_TB: [26000]
  };
  if (spec.capacity_bucket && bucketValues[spec.capacity_bucket]) {
    numbers.push(...bucketValues[spec.capacity_bucket]);
  }
  return numbers.filter((n) => Number.isFinite(n) && n > 0);
}

function publicFacetValues(product, key) {
  const spec = productSpec(product);
  switch (key) {
    case "manufacturer": return values(product.manufacturer || spec.chip_manufacturer || spec.platform_vendor);
    case "platform_vendor": return values(spec.platform_vendor);
    case "family": return values(spec.family);
    case "generation": return values(spec.generation || spec.memory_generation || spec.family);
    case "suffix": return values(spec.suffix);
    case "model": return values([modelValue(product), ...(product.aliases || [])]);
    case "gpu_model": return values(spec.gpu_model || (product.category === "GPU" ? modelValue(product) : ""));
    case "board_brand": return values(spec.board_manufacturer || product.board_brand || product.brand);
    case "usage": {
      if (product.category === "RAM" && ["SODIMM", "SO-DIMM"].includes(first(spec.form_factor || spec.buffering).toUpperCase())) return ["LAPTOP"];
      const segment = normalize(spec.market_segment || "CONSUMER_DESKTOP");
      return [segment === "DESKTOP" ? "CONSUMER_DESKTOP" : segment];
    }
    case "configuration": return product.category === "RAM" ? [`${first(spec.module_capacity_gb || spec.capacity_per_module_gb)}GB × ${first(spec.module_count || spec.modules_per_kit || 1)}`] : [];
    case "module_capacity_gb": return product.category === "RAM" ? values(spec.module_capacity_gb || spec.capacity_per_module_gb) : [];
    case "vram_gb": return values(spec.vram_gb || spec.vram_options_gb);
    case "socket": return values(spec.socket);
    case "chipset": return values(spec.chipset || first(modelValue(product).match(/\b([ABHXZ]\d{3})M?/iu)?.[1]));
    case "form_factor": return values(spec.form_factor);
    case "product_kind": return product.category === "SSD" ? ["M2_NVME", "SATA_2_5", "M2_SATA", "EXTERNAL", "OTHER_UNKNOWN"] : [];
    case "placement": return product.category === "HDD" ? ["INTERNAL", "EXTERNAL", "UNKNOWN"] : values(spec.placement);
    case "form_interface": {
      const forms = values(spec.form_factor);
      const interfaces = values(spec.interface);
      if (forms.length && interfaces.length) return forms.flatMap((form) => interfaces.map((connection) => `${form} ${connection}`));
      return forms.length ? forms : interfaces;
    }
    case "interface": return values(spec.interface);
    case "protocol": return values(spec.protocol);
    case "capacity": return capacityValues(product);
    case "capacity_bucket": return values(spec.capacity_bucket);
    case "purpose": return values(spec.purpose || spec.use_class);
    case "rated_wattage": return values(spec.rated_wattage || spec.watts || first(modelValue(product).match(/\b\d{3,4}\s*W\b/iu)?.[0]?.replace(/\s+/gu, "")));
    case "watts_bucket": return values(spec.watts_bucket);
    case "atx_spec": return values(spec.atx_spec || spec.atx_or_sfx_version);
    case "efficiency": return values(spec.efficiency);
    case "modularity": return values(spec.modularity);
    default: return [];
  }
}

function filterMatches(product, key, requested) {
  if (!requested.length) return true;
  if (key === "capacity") {
    const numbers = productCapacityNumbers(product);
    const hasRangeMatch = requested.some((expected) => {
      const matchGe = String(expected).match(/^GE_(\d+)(GB|TB)?$/i);
      if (matchGe) {
        const threshold = Number(matchGe[1]) * (matchGe[2]?.toUpperCase() === "TB" ? 1000 : 1);
        return numbers.some((n) => n >= (threshold * 0.95));
      }
      const matchLe = String(expected).match(/^LE_(\d+)(GB|TB)?$/i);
      if (matchLe) {
        const threshold = Number(matchLe[1]) * (matchLe[2]?.toUpperCase() === "TB" ? 1000 : 1);
        return numbers.some((n) => n <= (threshold * 1.05));
      }
      return false;
    });
    if (hasRangeMatch) return true;
  }
  const actual = publicFacetValues(product, key);
  return requested.some((expected) => actual.some((candidate) => compact(candidate) === compact(expected)));
}

function normalizeFilters(options = {}) {
  const input = options;
  const requestedValues = (name) => options instanceof URLSearchParams
    ? options.getAll(name).flatMap((value) => values(value.split(",")))
    : values(input[name]);
  const category = categoryCode(first(requestedValues("category")) || first(requestedValues("category_code")), { allowEmpty: true });
  const filters = {};
  const aliases = {
    manufacturer: ["manufacturer", "brand"], generation: ["generation", "memory_generation"], model: ["model", "exact_model"],
    gpu_model: ["gpu_model"], board_brand: ["board_brand", "board_manufacturer"], usage: ["usage", "market_segment"],
    platform_vendor: ["platform_vendor"], family: ["family"], suffix: ["suffix"],
    configuration: ["configuration", "config"], module_capacity_gb: ["module_capacity_gb", "capacity_per_module_gb"], vram_gb: ["vram_gb", "vram_options_gb"], socket: ["socket"], chipset: ["chipset"], form_factor: ["form_factor"],
    form_interface: ["form_interface"], product_kind: ["product_kind"], placement: ["placement"], capacity: ["capacity", "marketed_capacity_gb"], purpose: ["purpose", "use_class"],
    capacity_bucket: ["capacity_bucket"], interface: ["interface"], protocol: ["protocol"],
    rated_wattage: ["rated_wattage", "watts"], watts_bucket: ["watts_bucket"], atx_spec: ["atx_spec", "atx_or_sfx_version"], efficiency: ["efficiency"], modularity: ["modularity"]
  };
  for (const [key, names] of Object.entries(aliases)) {
    const requested = names.flatMap(requestedValues);
    if (requested.length) filters[key] = [...new Set(requested)];
  }
  return { category, filters };
}

function matchingProducts(category, filters, exceptKey = null) {
  return PUBLIC_PRODUCTS.filter((product) => (!category || product.category === category)
    && Object.entries(filters).every(([key, requested]) => key === exceptKey || filterMatches(product, key, requested)));
}

function productMatchesQuery(product, query) {
  if (!query) return true;
  return [product.id, product.name, ...(product.aliases || [])]
    .some((value) => normalize(value).toLocaleUpperCase("ko-KR").includes(query));
}

function optionLabel(key, value) {
  if (key === "suffix" && value === "NONE") return "일반";
  if (key === "capacity") {
    const rangeLabels = {
      GE_500GB: "500GB 이상", GE_1TB: "1TB 이상", GE_2TB: "2TB 이상", GE_4TB: "4TB 이상", GE_8TB: "8TB 이상", GE_10TB: "10TB 이상", GE_16TB: "16TB 이상",
      LE_500GB: "500GB 이하", LE_1TB: "1TB 이하", LE_2TB: "2TB 이하", LE_4TB: "4TB 이하",
    };
    if (rangeLabels[value]) return rangeLabels[value];
    if (/^\d+(?:\.\d+)?$/u.test(value)) {
      const gb = Number(value);
      return gb >= 1000 ? `${gb / 1000}TB` : `${gb}GB`;
    }
  }
  if (key === "rated_wattage" && /^\d+$/u.test(value)) {
    return `${value}W`;
  }
  if (key === "module_capacity_gb" || key === "vram_gb") return `${value}GB`;
  if (key === "product_kind") return ({ M2_NVME: "M.2 NVMe", SATA_2_5: "2.5형 SATA", M2_SATA: "M.2 SATA", EXTERNAL: "외장 SSD", OTHER_UNKNOWN: "기타·불명확" })[value] || value;
  if (key === "placement") return ({ INTERNAL: "내장 HDD", EXTERNAL: "외장 HDD", UNKNOWN: "불명확" })[value] || value;
  if (key === "watts_bucket") {
    return ({ LE_500: "500W 이하", "501_650": "501~650W", "651_750": "651~750W", "751_850": "751~850W", "851_1000": "851~1000W", "1001_1200": "1001~1200W", GT_1200: "1200W 초과" })[value] || value;
  }
  if (key === "capacity_bucket") {
    return ({ LE_256_GB: "256GB 이하", "257_512_GB": "257~512GB", "513_GB_1_TB": "513GB~1TB", GT_1_TB_LE_2_TB: "1TB 초과~2TB", GT_2_TB_LE_4_TB: "2TB 초과~4TB", GT_4_TB_LE_6_TB: "4TB 초과~6TB", GT_4_TB_LE_8_TB: "4TB 초과~8TB", GT_6_TB_LE_8_TB: "6TB 초과~8TB", GT_8_TB_LE_12_TB: "8TB 초과~12TB", GT_12_TB_LE_16_TB: "12TB 초과~16TB", GT_16_TB_LE_20_TB: "16TB 초과~20TB", GT_20_TB_LE_24_TB: "20TB 초과~24TB", GT_8_TB: "8TB 초과", LE_1_TB: "1TB 이하", GT_24_TB: "24TB 초과" })[value] || value;
  }
  return value;
}

export function publicPcProducts() {
  return PUBLIC_PRODUCTS;
}

export function publicPcProductById(canonicalProductId) {
  return PUBLIC_PRODUCTS.find((product) => product.id === normalize(canonicalProductId)) || null;
}

export function publicPcFacetDefinitions(category) {
  const code = categoryCode(category);
  const products = PUBLIC_PRODUCTS.filter((product) => product.category === code);
  return FACETS[code]
    .map(([key, label], order) => ({ key, label, order }))
    .filter(({ key }) => new Set(products.flatMap((product) => publicFacetValues(product, key))).size > 1);
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
  const input = options;
  const queryValue = options instanceof URLSearchParams ? (options.get("q") || options.get("query")) : (input.q || input.query);
  const query = normalize(queryValue).toLocaleUpperCase("ko-KR");
  const definitions = publicPcFacetDefinitions(category);
  const facets = Object.fromEntries(definitions.map(({ key, label, order }) => {
    const counts = new Map();
    for (const product of matchingProducts(category, filters, key).filter((candidate) => productMatchesQuery(candidate, query))) {
      for (const value of publicFacetValues(product, key)) counts.set(value, (counts.get(value) || 0) + 1);
    }
    return [key, { key, label, order, values: [...counts.entries()].sort(([a], [b]) => compact(a).localeCompare(compact(b))).map(([value, count]) => ({
      value,
      label: optionLabel(key, value),
      ...(!LISTING_ONLY_FACETS.has(key) ? { count } : {})
    })) }];
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
  const input = options;
  const { category, filters } = normalizeFilters(input);
  const queryValue = options instanceof URLSearchParams ? (options.get("q") || options.get("query")) : (input.q || input.query);
  const query = normalize(queryValue).toLocaleUpperCase("ko-KR");
  const products = matchingProducts(category, filters).filter((product) => productMatchesQuery(product, query));
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
