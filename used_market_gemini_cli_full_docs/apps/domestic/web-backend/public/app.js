const PRODUCT_QUERY_KEYS = new Set([
  "manufacturer", "model", "gpu_model", "board_brand", "usage", "configuration", "socket", "chipset", "form_interface", "capacity", "purpose", "rated_wattage",
  "chip_manufacturer", "market_segment", "family", "generation", "vram_gb",
  "platform_vendor", "socket", "suffix", "memory_generation", "module_capacity_gb", "form_factor", "ecc", "buffering",
  "chipset", "capacity_bucket", "interface", "protocol", "pcie_generation", "use_class", "recording_technology",
  "watts_bucket", "atx_spec", "modularity", "efficiency", "subtype", "radiator_mm", "fan_mm", "chassis_class",
  "motherboard_support", "side_panel", "host_interface", "bracket", "media_family", "capability", "placement",
]);
const FALLBACK_BROWSE_FLOWS = Object.freeze({
  CPU: Object.freeze([
    Object.freeze({ key: "manufacturer", label: "제조사" }),
    Object.freeze({ key: "family", label: "제품군" }),
    Object.freeze({ key: "generation", label: "세대" }),
    Object.freeze({ key: "socket", label: "소켓" }),
    Object.freeze({ key: "suffix", label: "모델 구분" }),
  ]),
  GPU: Object.freeze([
    Object.freeze({ key: "manufacturer", label: "칩 제조사" }),
    Object.freeze({ key: "family", label: "제품군" }),
    Object.freeze({ key: "generation", label: "세대" }),
    Object.freeze({ key: "vram_gb", label: "VRAM" }),
  ]),
  RAM: Object.freeze([
    Object.freeze({ key: "generation", label: "DDR 세대" }),
    Object.freeze({ key: "module_capacity_gb", label: "모듈 용량" }),
    Object.freeze({ key: "manufacturer", label: "제조사" }),
  ]),
  MOTHERBOARD: Object.freeze([
    Object.freeze({ key: "platform_vendor", label: "CPU 플랫폼" }),
    Object.freeze({ key: "socket", label: "CPU 소켓" }),
    Object.freeze({ key: "chipset", label: "칩셋" }),
    Object.freeze({ key: "manufacturer", label: "제조사" }),
    Object.freeze({ key: "form_factor", label: "폼팩터" }),
  ]),
  SSD: Object.freeze([
    Object.freeze({ key: "form_interface", label: "형태·인터페이스" }),
    Object.freeze({ key: "capacity_bucket", label: "용량" }),
    Object.freeze({ key: "manufacturer", label: "제조사" }),
    Object.freeze({ key: "protocol", label: "프로토콜" }),
  ]),
  HDD: Object.freeze([
    Object.freeze({ key: "capacity_bucket", label: "용량" }),
    Object.freeze({ key: "manufacturer", label: "제조사" }),
    Object.freeze({ key: "purpose", label: "용도" }),
    Object.freeze({ key: "interface", label: "인터페이스" }),
  ]),
  PSU: Object.freeze([
    Object.freeze({ key: "watts_bucket", label: "정격 출력" }),
    Object.freeze({ key: "form_factor", label: "폼팩터" }),
    Object.freeze({ key: "manufacturer", label: "제조사" }),
    Object.freeze({ key: "atx_spec", label: "ATX 규격" }),
    Object.freeze({ key: "efficiency", label: "효율 등급" }),
    Object.freeze({ key: "modularity", label: "케이블 방식" }),
  ]),
});
const COHORTS = [
  { marketPool: "KR_C2C_USED", condition: "USED_WORKING", currency: "KRW", label: "국내 개인 중고" },
  { marketPool: "KR_DEALER_USED", condition: "USED_WORKING", currency: "KRW", label: "국내 업자 중고" },
  { marketPool: "KR_REFURB_RETAIL", condition: "REFURBISHED", currency: "KRW", label: "국내 리퍼비시" },
  { marketPool: "OVERSEAS_USED", condition: "USED_WORKING", currency: "USD", label: "해외 중고" },
];
const mobileFacetMedia = window.matchMedia("(max-width: 640px)");
const stackedLayoutMedia = window.matchMedia("(max-width: 1120px)");
const compactFilterMedia = window.matchMedia("(max-width: 1120px)");
const SCOPED_LISTING_AUTORUN_MODEL_LIMIT = 12;
const SEARCH_LISTING_AUTORUN_MODEL_LIMIT = 18;
let browseListingTimer = null;
let catalogSearchTimer = null;
let catalogSearchComposing = false;

const state = {
  catalog: null,
  categories: [],
  facetSchema: null,
  browseFlows: {},
  facetUniverse: {},
  sources: [],
  sourceCandidates: [],
  seedProducts: [],
  categoryCode: "",
  facets: {},
  openFacetRows: new Set(),
  expandedFacetOptions: new Set(),
  selectedSites: new Set(),
  query: "",
  products: [],
  productTotal: 0,
  productCursor: "",
  productPage: 1,
  selectedProduct: null,
  listings: [],
  listingCursor: "",
  listingPage: 1,
  listingPages: new Map(),
  listingPageCursors: new Map([[1, ""]]),
  listingNextCursors: new Map(),
  listingScopeKey: "",
  listingSort: "recent",
  priceMin: "",
  priceMax: "",
  detailStats: [],
  visibleStatsCount: 0,
  productRequest: null,
  listingRequest: null,
  detailRequest: null,
  sourceMoreOpen: false,
  modelFiltersCollapsed: false,
  listingOptionsCollapsed: false,
  returnFocusProductId: "",
};

const dom = {
  catalogSearch: document.querySelector("#catalog-search"),
  catalogQuery: document.querySelector("#catalog-query"),
  catalogMeta: document.querySelector("#catalog-meta"),
  categorySelect: document.querySelector("#category-select"),
  workspaceTitle: document.querySelector("#workspace-title"),
  workspaceIntro: document.querySelector("#workspace-intro"),
  modelFilters: document.querySelector("#model-filters"),
  modelFilterBody: document.querySelector("#model-filter-body"),
  modelFilterToggle: document.querySelector("#model-filter-toggle"),
  filterCategoryLabel: document.querySelector("#filter-category-label"),
  filterContext: document.querySelector("#filter-context"),
  facetRows: document.querySelector("#facet-rows"),
  activeFilterSummary: document.querySelector("#active-filter-summary"),
  activeFilterChips: document.querySelector("#active-filter-chips"),
  sourceFacetRow: document.querySelector("#source-facet-row"),
  sourceFilters: document.querySelector("#source-filters"),
  sourceFilterSummary: document.querySelector("#source-filter-summary"),
  sourceMoreToggle: document.querySelector("#source-more-toggle"),
  resetFilters: document.querySelector("#reset-filters"),
  showMatchedModels: document.querySelector("#show-matched-models"),
  catalogMessage: document.querySelector("#catalog-message"),
  modelSelect: document.querySelector("#model-select"),
  modelDetailDialog: document.querySelector("#model-detail-dialog"),
  modelDetailClose: document.querySelector("#model-detail-close"),
  pricePanelContent: document.querySelector("#price-panel-content"),
  pricePanelTitle: document.querySelector("#price-panel-title"),
  detailMessage: document.querySelector("#detail-message"),
  priceSummary: document.querySelector("#price-summary"),
  activeLatest: document.querySelector("#active-latest"),
  activeChange: document.querySelector("#active-change"),
  activeMean: document.querySelector("#active-mean"),
  activeCount: document.querySelector("#active-count"),
  reservedLatest: document.querySelector("#reserved-latest"),
  reservedChange: document.querySelector("#reserved-change"),
  reservedMean: document.querySelector("#reserved-mean"),
  reservedCount: document.querySelector("#reserved-count"),
  soldLatest: document.querySelector("#sold-latest"),
  soldChange: document.querySelector("#sold-change"),
  soldMean: document.querySelector("#sold-mean"),
  soldCount: document.querySelector("#sold-count"),
  confirmedLatest: document.querySelector("#confirmed-latest"),
  confirmedChange: document.querySelector("#confirmed-change"),
  confirmedMean: document.querySelector("#confirmed-mean"),
  confirmedCount: document.querySelector("#confirmed-count"),
  priceChartDisclosure: document.querySelector("#price-chart-disclosure"),
  statsSection: document.querySelector("#stats-section"),
  statsAsOf: document.querySelector("#stats-as-of"),
  statsGroups: document.querySelector("#stats-groups"),
  listingSection: document.querySelector("#listing-section"),
  listingTitle: document.querySelector("#listing-title"),
  listingMessage: document.querySelector("#listing-message"),
  listingOptions: document.querySelector("#listing-options"),
  listingOptionsToggle: document.querySelector("#listing-options-toggle"),
  backToModels: document.querySelector("#back-to-models"),
  listingControls: document.querySelector("#listing-controls"),
  listingSort: document.querySelector("#listing-sort"),
  listingSortTabs: [...document.querySelectorAll(".listing-sort-tab")],
  priceMin: document.querySelector("#price-min"),
  priceMax: document.querySelector("#price-max"),
  listingRows: document.querySelector("#listing-rows"),
  listingEmpty: document.querySelector("#listing-empty"),
  listingPagination: document.querySelector("#listing-pagination"),
  listingPageNumbers: document.querySelector("#listing-page-numbers"),
  listingPagePrev: document.querySelector("#listing-page-prev"),
  listingPageNext: document.querySelector("#listing-page-next"),
};

function createElement(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function unwrapPayload(payload) {
  let current = payload;
  for (let depth = 0; depth < 3; depth += 1) {
    if (!current || typeof current !== "object") return current;
    if (current.ok === false || current.status === "error") {
      throw new Error(firstDefined(current.error?.message, current.message, current.error, "요청을 처리하지 못했습니다."));
    }
    const isEnvelope = current.ok === true || current.status === "success";
    if (isEnvelope && current.data && typeof current.data === "object") {
      current = current.data;
      continue;
    }
    return current;
  }
  return current;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "same-origin",
    signal: options.signal,
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("서버 응답 형식을 확인할 수 없습니다.");
  }
  if (!response.ok) {
    throw new Error(firstDefined(payload?.error?.message, payload?.message, `요청에 실패했습니다. (${response.status})`));
  }
  return unwrapPayload(payload);
}

function normalizeText(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function categoryCode(category) {
  return normalizeText(firstDefined(category?.category_code, category?.code, category?.id)).toUpperCase();
}

function categoryLabel(category) {
  return normalizeText(firstDefined(category?.display_name, category?.label, category?.name, categoryCode(category)));
}

function productId(product) {
  return normalizeText(firstDefined(product?.canonical_product_id, product?.product_id, product?.id));
}

function productName(product) {
  return normalizeText(firstDefined(product?.canonical_display_name, product?.display_name, product?.name, "이름 미확인 제품"));
}

function productCategory(product) {
  const category = firstDefined(product?.category_code, product?.category, product?.product_category);
  if (category && typeof category === "object") return categoryCode(category);
  return normalizeText(category).toUpperCase();
}

function productManufacturer(product) {
  const maker = firstDefined(product?.manufacturer, product?.brand, product?.board_manufacturer, product?.key_specs?.board_manufacturer);
  if (maker && typeof maker === "object") return normalizeText(firstDefined(maker.display_name, maker.name, maker.code));
  return normalizeText(maker);
}

function productFamily(product) {
  return normalizeText(firstDefined(product?.family, product?.product_family, product?.series, product?.generation, product?.key_specs?.family, product?.key_specs?.generation));
}

function normalizeSources(sources) {
  return toArray(sources)
    .filter((source) => source && source.public_enabled !== false && source.enabled !== false)
    .filter((source) => !["DISABLED", "DENIED"].includes(normalizeText(firstDefined(source.operating_status, source.runtime_status, source.status)).toUpperCase()))
    .map((source) => {
      const marketPools = [...new Set(toArray(source.market_pools)
        .map(normalizeText)
        .filter(Boolean))];
      const primaryMarketPool = normalizeText(source.market_pool);
      if (!marketPools.length && primaryMarketPool) marketPools.push(primaryMarketPool);
      return {
        id: normalizeText(firstDefined(source.source_id, source.key, source.code, source.id)),
        label: normalizeText(firstDefined(source.display_name, source.label, source.name, source.source_id, source.id)),
        marketPools,
        currency: normalizeText(firstDefined(source.currency, primaryMarketPool.startsWith("OVERSEAS") ? "USD" : "KRW")).toUpperCase(),
      };
    })
    .filter((source) => source.id && source.label);
}

function normalizeSourceCandidates(sources) {
  return toArray(sources)
    .filter((source) => source && source.public_enabled === false)
    .map((source) => ({
      id: normalizeText(firstDefined(source.source_id, source.key, source.code, source.id)),
      label: normalizeText(firstDefined(source.display_name, source.label, source.name, source.source_id, source.id)),
      reason: normalizeText(source.availability_reason).toUpperCase(),
      policyUrl: normalizeText(source.policy_reference_url),
      activationUrl: normalizeText(source.activation_url),
      integrationDocsUrl: normalizeText(source.integration_docs_url),
    }))
    .filter((source) => source.id && source.label);
}

function sourceLabel(sourceId) {
  const normalized = normalizeText(sourceId);
  const known = {
    joonggonara: "중고나라",
    bunjang: "번개장터",
    hellomarket: "헬로마켓",
    rethinkmall: "리씽크몰",
    danawa: "다나와 장터",
    ebay: "eBay",
    coolenjoy: "쿨엔조이",
    daangn: "당근",
  };
  return state.sources.find((source) => source.id === normalized)?.label || known[normalized] || normalized || "출처 미확인";
}

function normalizePrice(value, fallbackCurrency = "KRW") {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "object") {
    const amount = Number(firstDefined(value.amount, value.value, value.price, value.median, value.mean));
    if (!Number.isFinite(amount)) return null;
    return { amount, currency: normalizeText(firstDefined(value.currency, fallbackCurrency)).toUpperCase() || fallbackCurrency };
  }
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return { amount, currency: fallbackCurrency };
}

function metricValue(block, keys) {
  if (!block || typeof block !== "object") return null;
  for (const key of keys) {
    const price = normalizePrice(block[key], normalizeText(block.currency) || "KRW");
    if (price) return price;
  }
  return null;
}

function sampleCount(block) {
  const value = Number(firstDefined(block?.n, block?.count, block?.sample_count, block?.listing_count, block?.total));
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function formatMoney(value, fallbackCurrency = "KRW") {
  const price = normalizePrice(value, fallbackCurrency);
  if (!price) return "—";
  const currency = price.currency || fallbackCurrency;
  try {
    return new Intl.NumberFormat("ko-KR", {
      style: "currency",
      currency,
      maximumFractionDigits: currency === "KRW" ? 0 : 2,
    }).format(price.amount);
  } catch {
    return `${price.amount.toLocaleString("ko-KR")} ${currency}`;
  }
}

function formatCount(value) {
  if (value === null || value === undefined || value === "") return "—";
  const count = Number(value);
  return Number.isFinite(count) ? `${count.toLocaleString("ko-KR")}건` : "—";
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return normalizeText(value);
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(value, window.location.origin);
    if (url.protocol === "http:") url.protocol = "https:";
    if (url.protocol !== "https:") return "";
    if (url.username || url.password) return "";
    return url.href;
  } catch {
    return "";
  }
}

function showCatalogMessage(message, isError = false) {
  dom.catalogMessage.textContent = message;
  dom.catalogMessage.classList.toggle("is-error", isError);
  dom.catalogMessage.hidden = !message;
}

function showDetailMessage(message, isError = false) {
  dom.detailMessage.textContent = message;
  dom.detailMessage.classList.toggle("is-error", isError);
  dom.detailMessage.hidden = !message;
}

function showListingMessage(message, isError = false) {
  dom.listingMessage.textContent = message;
  dom.listingMessage.classList.toggle("is-error", isError);
  dom.listingMessage.hidden = !message;
}

function setBusy(button, isBusy, busyText) {
  if (!button) return;
  if (isBusy) {
    if (!button.dataset.originalText) button.dataset.originalText = button.textContent;
    button.textContent = busyText;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    delete button.dataset.originalText;
    button.disabled = false;
  }
}

function cancelListingRequest({ hidePagination = true } = {}) {
  clearTimeout(browseListingTimer);
  browseListingTimer = null;
  state.listingRequest?.abort();
  state.listingRequest = null;
  dom.listingSection?.removeAttribute("aria-busy");
  if (hidePagination) dom.listingPagination.hidden = true;
}

function resetListingPagination() {
  state.listingPage = 1;
  state.listingCursor = "";
  state.listingPages.clear();
  state.listingPageCursors.clear();
  state.listingPageCursors.set(1, "");
  state.listingNextCursors.clear();
  dom.listingPageNumbers.replaceChildren();
  dom.listingPagination.hidden = true;
}

function catalogCategoryProducts(category) {
  return state.seedProducts.filter((product) => !category || productCategory(product) === category);
}

function facetOptionLabel(key, value) {
  if (key === "suffix" && value === "NONE") return "일반";
  const capacityLabels = {
    LE_256_GB: "256GB 이하", "480_512_GB": "480~512GB", "960_GB_1_TB": "960GB~1TB",
    "1_92_2_TB": "1.92~2TB", "3_84_4_TB": "3.84~4TB", "7_68_8_TB": "7.68~8TB", GT_8_TB: "8TB 초과",
    LE_1_TB: "1TB 이하", "2_TB": "2TB", "3_4_TB": "3~4TB", "5_6_TB": "5~6TB", "8_TB": "8TB",
    "10_12_TB": "10~12TB", "14_16_TB": "14~16TB", "18_20_TB": "18~20TB", "22_24_TB": "22~24TB", GE_26_TB: "26TB 이상",
  };
  const rangeLabels = {
    GE_500GB: "500GB 이상", GE_1TB: "1TB 이상", GE_2TB: "2TB 이상", GE_4TB: "4TB 이상", GE_8TB: "8TB 이상", GE_10TB: "10TB 이상", GE_16TB: "16TB 이상",
    LE_500GB: "500GB 이하", LE_1TB: "1TB 이하", LE_2TB: "2TB 이하", LE_4TB: "4TB 이하",
  };
  if (rangeLabels[value]) return rangeLabels[value];
  const wattsLabels = { LE_500: "500W 이하", "550_650": "550~650W", "700_750": "700~750W", "800_850": "800~850W", "900_1000": "900~1000W", "1100_1200": "1100~1200W", GT_1200: "1200W 초과" };
  const usageLabels = { LAPTOP: "노트북", CONSUMER_DESKTOP: "데스크탑", DESKTOP: "데스크탑" };
  if (key === "usage") return usageLabels[value] || value;
  if (["module_capacity_gb", "vram_gb"].includes(key)) return `${value}GB`;
  if (["radiator_mm", "fan_mm"].includes(key)) return `${value}mm`;
  if (key === "pcie_generation") return `PCIe ${value}.0`;
  if (key === "capacity_bucket") return capacityLabels[value] || value;
  if (key === "capacity" && capacityLabels[value]) return capacityLabels[value];
  if (key === "watts_bucket") return wattsLabels[value] || value;
  if (key === "rated_wattage" && /^\d+$/u.test(value)) return `${value}W`;
  return value;
}

function normalizeFacetOption(option, key = "") {
  if (option && typeof option === "object") {
    const value = normalizeText(firstDefined(option.value, option.code, option.id, option.key, option.name));
    const providedLabel = normalizeText(firstDefined(option.label, option.display_name, option.name));
    const label = providedLabel && providedLabel !== value ? providedLabel : facetOptionLabel(key, value);
    const count = Number(firstDefined(option.count, option.model_count, option.total));
    return value ? {
      value,
      label,
      ...(Number.isFinite(count) ? { count } : {}),
      ...(option.disabled === true ? { disabled: true } : {})
    } : null;
  }
  const value = normalizeText(option);
  return value ? { value, label: facetOptionLabel(key, value) } : null;
}

function normalizeFacetDefinition(definition, fallbackKey = "") {
  if (!definition) return null;
  const key = normalizeText(firstDefined(definition.query_param, definition.param, definition.key, definition.id, fallbackKey)).toLowerCase();
  if (!PRODUCT_QUERY_KEYS.has(key)) return null;
  const labelMap = {
    manufacturer: "제조사", model: "정확한 모델", chip_manufacturer: "칩 제조사", market_segment: "제품 유형",
    board_brand: "제품 브랜드", usage: "사용 유형", configuration: "구성", form_interface: "제품 형태·인터페이스", purpose: "용도", rated_wattage: "정격 출력",
    family: "제품군 / 규격", generation: "세대", vram_gb: "VRAM", vram_options_gb: "VRAM", gpu_model: "GPU 모델", platform_vendor: "CPU 제조사", socket: "소켓",
    suffix: "모델 suffix", memory_generation: "메모리 규격", module_capacity_gb: "모듈 용량", form_factor: "폼팩터",
    ecc: "ECC", buffering: "모듈 종류", chipset: "칩셋", capacity_bucket: "용량", interface: "인터페이스",
    protocol: "프로토콜", pcie_generation: "PCIe 세대", use_class: "사용군", recording_technology: "기록 방식",
    watts: "정격 출력", watts_bucket: "정격 출력", atx_spec: "ATX 규격", modularity: "케이블 방식", efficiency: "효율 등급",
    module_count: "모듈 수", total_capacity_gb: "총용량",
    subtype: "종류", radiator_mm: "라디에이터", fan_mm: "팬 크기", chassis_class: "케이스 크기",
    motherboard_support: "지원 보드", side_panel: "측면 패널", host_interface: "호스트 규격", bracket: "브래킷",
    media_family: "미디어", capability: "읽기 / 쓰기", placement: "내장 / 외장",
  };
  const label = normalizeText(firstDefined(definition.label, definition.display_name, definition.name, labelMap[key], key));
  const options = toArray(firstDefined(definition.options, definition.values, definition.items))
    .map((option) => normalizeFacetOption(option, key))
    .filter(Boolean);
  return { key, label, options };
}

function normalizeBrowseFlows(value) {
  if (!value || typeof value !== "object") return {};
  const entries = Array.isArray(value)
    ? value.map((flow) => [normalizeText(firstDefined(flow?.category_code, flow?.category)), flow?.steps || flow?.flow || flow?.facets || []])
    : Object.entries(value);
  return Object.fromEntries(entries.map(([category, steps]) => {
    const rawSteps = steps && !Array.isArray(steps) && typeof steps === "object"
      ? firstDefined(steps.steps, steps.browse_flow, steps.flow, steps.facets, [])
      : steps;
    const normalizedSteps = toArray(rawSteps).map((step) => {
      if (typeof step === "string") return { key: step, label: normalizeFacetDefinition({ key: step })?.label || step };
      const key = normalizeText(firstDefined(step?.key, step?.query_param, step?.param)).toLowerCase();
      if (!key || !PRODUCT_QUERY_KEYS.has(key)) return null;
      return {
        key,
        label: normalizeText(firstDefined(step?.label, step?.display_name, normalizeFacetDefinition({ key })?.label, key)),
        depends_on: toArray(firstDefined(step?.depends_on, step?.dependsOn)).map((item) => normalizeText(item).toLowerCase()).filter(Boolean),
      };
    }).filter(Boolean);
    return [normalizeText(category).toUpperCase(), normalizedSteps];
  }).filter(([category, steps]) => category && steps.length));
}

function browseFlowForCategory(category) {
  const catalogFlow = toArray(state.browseFlows?.[category]);
  return catalogFlow.length ? catalogFlow : toArray(FALLBACK_BROWSE_FLOWS[category]);
}

function selectedFacetValues(key) {
  const current = state.facets[key];
  if (Array.isArray(current)) return current.map(normalizeText).filter(Boolean);
  return normalizeText(current) ? [normalizeText(current)] : [];
}

function selectedFacetCount() {
  return Object.keys(state.facets).reduce((total, key) => total + selectedFacetValues(key).length, 0);
}

function hasSelectedFacets() {
  return selectedFacetCount() > 0;
}

function productFacetValues(product, key) {
  if (key === "manufacturer") {
    const category = productCategory(product);
    const manufacturer = category === "GPU"
      ? firstDefined(product?.manufacturer, product?.key_specs?.chip_manufacturer, product?.browse_facets?.chip_manufacturer, product?.spec?.chip_manufacturer)
      : productManufacturer(product);
    return [normalizeText(manufacturer)].filter(Boolean);
  }
  if (key === "model") return [productName(product)].filter(Boolean);
  if (key === "board_brand") return [productManufacturer(product)].filter(Boolean);
  if (key === "family") return [productFamily(product)].filter(Boolean);
  const specs = {
    ...(product?.key_specs && typeof product.key_specs === "object" ? product.key_specs : {}),
    ...(product?.browse_facets && typeof product.browse_facets === "object" ? product.browse_facets : {}),
    ...(product?.spec_json && typeof product.spec_json === "object" ? product.spec_json : {}),
    ...(product?.spec && typeof product.spec === "object" ? product.spec : {}),
  };
  if (key === "gpu_model") return [firstDefined(specs.gpu_model, specs.family, productName(product))].filter(Boolean).map(normalizeText);
  if (key === "generation") return [firstDefined(specs.generation, specs.memory_generation)].filter(Boolean).map(normalizeText);
  if (key === "vram_gb") return toArray(firstDefined(specs.vram_gb, specs.vram_options_gb)).map(normalizeText).filter(Boolean);
  if (key === "atx_spec") return [firstDefined(specs.atx_spec, specs.atx_or_sfx_version)].filter(Boolean).map(normalizeText);
  if (key === "usage") {
    const formFactor = normalizeText(firstDefined(specs.form_factor, specs.memory_form_factor)).toUpperCase();
    return [formFactor === "SODIMM" || formFactor === "SO-DIMM" ? "LAPTOP" : firstDefined(specs.market_segment, "CONSUMER_DESKTOP")].filter(Boolean).map(normalizeText);
  }
  if (key === "configuration") {
    const capacity = firstDefined(specs.module_capacity_gb, specs.capacity_per_module_gb);
    const modules = firstDefined(specs.module_count, specs.modules_per_kit);
    return [specs.configuration, capacity !== undefined ? `${capacity}GB × ${modules || 1}` : ""].filter(Boolean).map(normalizeText);
  }
  if (key === "form_interface") {
    const form = firstDefined(specs.form_factor, specs.interface);
    const productInterface = firstDefined(specs.interface);
    return [form && productInterface && form !== productInterface ? `${form} ${productInterface}` : form].filter(Boolean).map(normalizeText);
  }
  if (key === "capacity") return [firstDefined(specs.marketed_capacity_gb, specs.capacity_gb, specs.capacity_bucket)].filter((value) => value !== undefined && value !== null).map(normalizeText);
  if (key === "purpose") return [firstDefined(specs.purpose, specs.use_class)].filter(Boolean).map(normalizeText);
  if (key === "rated_wattage") return [firstDefined(specs.rated_wattage, specs.watts, specs.watts_bucket)].filter(Boolean).map(normalizeText);
  const value = firstDefined(specs[key], product?.[key]);
  return (Array.isArray(value) ? value : [value]).map((item) => normalizeText(item)).filter(Boolean);
}

function compareFacetOptions(left, right) {
  return left.label.localeCompare(right.label, "ko-KR", { numeric: true, sensitivity: "base" });
}

function sortFacetOptions(category, key, options) {
  const makerOrder = {
    CPU: ["Intel", "AMD"],
    GPU: ["NVIDIA", "AMD", "Intel"],
  };
  const makers = makerOrder[category];
  return [...options].sort((left, right) => {
    if (key === "manufacturer" && makers) {
      const leftIndex = makers.indexOf(left.value);
      const rightIndex = makers.indexOf(right.value);
      if (leftIndex >= 0 || rightIndex >= 0) return (leftIndex < 0 ? makers.length : leftIndex) - (rightIndex < 0 ? makers.length : rightIndex);
    }
    if (category === "CPU" && key === "generation") {
      const rank = (value) => {
        if (/^Core Ultra/iu.test(value)) return 30000;
        const intel = value.match(/^(\d+)th$/iu);
        if (intel) return 20000 + Number(intel[1]);
        const ryzen = value.match(/^Ryzen\s+(\d+)/iu);
        if (ryzen) return 10000 + Number(ryzen[1]);
        return 0;
      };
      const ranked = rank(right.value) - rank(left.value);
      if (ranked) return ranked;
    }
    return compareFacetOptions(left, right);
  });
}

function buildFacetUniverse() {
  const universe = {};
  state.categories.forEach((category) => {
    const code = categoryCode(category);
    const products = catalogCategoryProducts(code);
    universe[code] = {};
    browseFlowForCategory(code).forEach((step) => {
      const counts = new Map();
      products.forEach((product) => {
        productFacetValues(product, step.key).forEach((value) => {
          counts.set(value, (counts.get(value) || 0) + 1);
        });
      });
      universe[code][step.key] = sortFacetOptions(code, step.key, [...counts.entries()]
        .map(([value, count]) => ({ value, label: facetOptionLabel(step.key, value), count })));
    });
  });
  state.facetUniverse = universe;
}

function productCapacityNumbers(product) {
  const specs = {
    ...(product?.key_specs && typeof product.key_specs === "object" ? product.key_specs : {}),
    ...(product?.browse_facets && typeof product.browse_facets === "object" ? product.browse_facets : {}),
    ...(product?.spec_json && typeof product.spec_json === "object" ? product.spec_json : {}),
    ...(product?.spec && typeof product.spec === "object" ? product.spec : {}),
  };
  const numbers = [];
  if (specs.marketed_capacity_gb) numbers.push(Number(specs.marketed_capacity_gb));
  if (specs.capacity_gb) numbers.push(Number(specs.capacity_gb));
  if (Array.isArray(specs.capacity_examples_gb)) {
    for (const ex of specs.capacity_examples_gb) numbers.push(Number(ex));
  }
  const bucketValues = {
    LE_256_GB: [256], "480_512_GB": [500], "960_GB_1_TB": [1000],
    "1_92_2_TB": [2000], "3_84_4_TB": [4000], "7_68_8_TB": [8000], GT_8_TB: [16000],
    LE_1_TB: [1000], "2_TB": [2000], "3_4_TB": [4000], "5_6_TB": [6000], "8_TB": [8000],
    "10_12_TB": [12000], "14_16_TB": [16000], "18_20_TB": [20000], "22_24_TB": [24000], GE_26_TB: [26000],
  };
  if (specs.capacity_bucket && bucketValues[specs.capacity_bucket]) {
    numbers.push(...bucketValues[specs.capacity_bucket]);
  }
  return numbers.filter((n) => Number.isFinite(n) && n > 0);
}

function productMatchesActiveFacets(product, ignoreKey = "") {
  return Object.keys(state.facets).every((key) => {
    const requested = selectedFacetValues(key);
    if (!requested.length || key === ignoreKey) return true;
    if (key === "capacity") {
      const numbers = productCapacityNumbers(product);
      if (requested.some((expected) => {
        const matchGe = String(expected).match(/^GE_(\d+)(GB|TB)?$/i);
        if (matchGe) {
          const threshold = Number(matchGe[1]) * (matchGe[2]?.toUpperCase() === "TB" ? 1000 : 1);
          return numbers.some((n) => n >= threshold * 0.95);
        }
        const matchLe = String(expected).match(/^LE_(\d+)(GB|TB)?$/i);
        if (matchLe) {
          const threshold = Number(matchLe[1]) * (matchLe[2]?.toUpperCase() === "TB" ? 1000 : 1);
          return numbers.some((n) => n <= threshold * 1.05);
        }
        return false;
      })) return true;
    }
    const actual = productFacetValues(product, key);
    return requested.some((expected) => actual.some((value) => String(value).toUpperCase() === String(expected).toUpperCase()));
  });
}

function facetOptionsForStep(category, step) {
  const fixedOptions = toArray(state.facetUniverse?.[category]?.[step.key]);
  if (fixedOptions.length) return fixedOptions;

  if (category === "SSD" && step.key === "capacity") {
    return [
      { value: "GE_500GB", label: "500GB 이상" },
      { value: "GE_1TB", label: "1TB 이상" },
      { value: "GE_2TB", label: "2TB 이상" },
      { value: "GE_4TB", label: "4TB 이상" },
      { value: "LE_500GB", label: "500GB 이하" },
      { value: "LE_1TB", label: "1TB 이하" },
      { value: "480_512_GB", label: "480~512GB" },
      { value: "960_GB_1_TB", label: "960GB~1TB" },
      { value: "1_92_2_TB", label: "1.92~2TB" },
      { value: "3_84_4_TB", label: "3.84~4TB" },
    ];
  }
  if (category === "HDD" && step.key === "capacity") {
    return [
      { value: "GE_2TB", label: "2TB 이상" },
      { value: "GE_4TB", label: "4TB 이상" },
      { value: "GE_8TB", label: "8TB 이상" },
      { value: "GE_10TB", label: "10TB 이상" },
      { value: "GE_16TB", label: "16TB 이상" },
      { value: "LE_1TB", label: "1TB 이하" },
      { value: "LE_2TB", label: "2TB 이하" },
      { value: "2_TB", label: "2TB" },
      { value: "3_4_TB", label: "3~4TB" },
      { value: "8_TB", label: "8TB" },
      { value: "10_12_TB", label: "10~12TB" },
      { value: "14_16_TB", label: "14~16TB" },
    ];
  }
  const schema = state.facetSchema?.[category] || state.facetSchema?.[category.toLowerCase()];
  const schemaOptions = toArray(schema?.[step.key]).map((option) => normalizeFacetOption(option, step.key)).filter(Boolean);
  if (schemaOptions.length && !step.depends_on?.length) return schemaOptions;

  const pool = state.seedProducts.length ? catalogCategoryProducts(category) : (state.products.length ? state.products : []);
  const derived = new Map();
  pool.filter((product) => productCategory(product) === category).forEach((product) => {
    productFacetValues(product, step.key).forEach((value) => {
      const current = derived.get(value) || { value, label: facetOptionLabel(step.key, value), count: 0 };
      current.count += 1;
      derived.set(value, current);
    });
  });
  return sortFacetOptions(category, step.key, [...derived.values()]);
}

function facetDefinitionsForCategory(category) {
  const definitions = browseFlowForCategory(category).filter((step) => step.key !== "model" && step.key !== "gpu_model").map((step) => {
    const options = facetOptionsForStep(category, step);
    return { ...step, rowKey: step.key, options };
  }).filter((definition) => definition.options.length > 0);
  if (category !== "CPU") return definitions;
  return definitions.flatMap((definition) => {
    if (definition.key !== "generation") return [definition];
    const intelOptions = definition.options.filter((option) => !/^Ryzen\s/iu.test(option.value));
    const amdOptions = definition.options.filter((option) => /^Ryzen\s/iu.test(option.value));
    return [
      { ...definition, rowKey: "generation-intel", label: "인텔 CPU 종류", options: intelOptions },
      { ...definition, rowKey: "generation-amd", label: "AMD CPU 종류", options: amdOptions },
    ].filter((row) => row.options.length > 0);
  });
}

function renderCategories() {
  dom.categorySelect.replaceChildren();
  if (!state.categoryCode) {
    const placeholder = createElement("option", "", state.query ? "전체 부품 검색" : "부품 선택");
    placeholder.value = "";
    placeholder.selected = true;
    placeholder.disabled = true;
    dom.categorySelect.append(placeholder);
  }
  state.categories.forEach((category) => {
    const code = categoryCode(category);
    const option = createElement("option", "", categoryLabel(category));
    option.value = code;
    option.selected = state.categoryCode === code;
    dom.categorySelect.append(option);
  });
  dom.categorySelect.disabled = state.categories.length === 0;
}

function makeFacetButton(label, value, active, onClick, disabled = false) {
  const button = createElement("button", "facet-option", label);
  button.type = "button";
  button.disabled = disabled;
  button.dataset.value = value;
  button.setAttribute("aria-pressed", String(active));
  button.addEventListener("click", onClick);
  return button;
}

function makeFacetCheckboxRow(definition) {
  const row = createElement("section", "model-facet-row");
  row.dataset.facetKey = definition.key;
  row.dataset.facetRow = definition.rowKey;
  const rowId = `facet-values-${definition.rowKey.replace(/[^a-z0-9_-]/giu, "-")}`;
  const selected = selectedFacetValues(definition.key);
  const selectedSet = new Set(selected);
  const rowOptionValues = new Set(definition.options.map((option) => option.value));
  const selectedLabels = selected.filter((value) => rowOptionValues.has(value))
    .map((value) => definition.options.find((option) => option.value === value)?.label || value);
  const isMobileDisclosure = mobileFacetMedia.matches;
  const open = !isMobileDisclosure || state.openFacetRows.has(definition.rowKey) || selectedLabels.length > 0;

  const disclosure = createElement(isMobileDisclosure ? "button" : "div", "facet-disclosure");
  if (isMobileDisclosure) {
    disclosure.type = "button";
    disclosure.setAttribute("aria-controls", rowId);
    disclosure.setAttribute("aria-expanded", String(open));
  }
  disclosure.append(
    createElement("strong", "facet-row-label", definition.label),
    createElement("span", "facet-selected-summary", selectedLabels.length
      ? `${selectedLabels.slice(0, 2).join(", ")}${selectedLabels.length > 2 ? ` 외 ${selectedLabels.length - 2}개` : ""}`
      : "전체"),
    createElement("span", "facet-disclosure-icon", open ? "−" : "+"),
  );
  if (isMobileDisclosure) {
    disclosure.addEventListener("click", () => {
      if (state.openFacetRows.has(definition.rowKey)) state.openFacetRows.delete(definition.rowKey);
      else state.openFacetRows.add(definition.rowKey);
      renderFacets();
    });
  }

  const body = createElement("div", "facet-matrix-body");
  body.id = rowId;
  const values = createElement("div", "model-facet-values");
  const expanded = state.expandedFacetOptions.has(definition.rowKey);
  const initialOptions = definition.options.slice(0, 5);
  const visibleOptions = expanded ? definition.options : initialOptions;

  visibleOptions.forEach((option) => {
    const choice = createElement("label", "model-facet-choice");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.name = definition.key;
    checkbox.value = option.value;
    checkbox.checked = selectedSet.has(option.value);
    checkbox.addEventListener("change", () => updateFacet(definition.key, option.value, definition.rowKey));
    choice.append(checkbox, createElement("span", "model-facet-option-label", option.label));
    if (Number.isFinite(Number(option.count))) {
      choice.append(createElement("span", "model-facet-count", `${Number(option.count).toLocaleString("ko-KR")}개`));
    }
    values.append(choice);
  });
  body.append(values);

  if (definition.options.length > 5) {
    const more = createElement("button", "facet-more", expanded ? "접기" : `${definition.options.length}개`);
    more.type = "button";
    more.setAttribute("aria-expanded", String(expanded));
    more.setAttribute("aria-controls", rowId);
    more.setAttribute("aria-label", expanded ? `${definition.label} 옵션 접기` : `${definition.label} 옵션 ${definition.options.length}개 모두 보기`);
    more.addEventListener("click", () => {
      if (expanded) state.expandedFacetOptions.delete(definition.rowKey);
      else state.expandedFacetOptions.add(definition.rowKey);
      renderFacets();
    });
    body.append(more);
  }
  row.append(disclosure, body);
  return row;
}

function renderActiveFilterSummary(definitions) {
  if (!dom.activeFilterSummary || !dom.activeFilterChips) return;
  dom.activeFilterChips.replaceChildren();
  Object.entries(state.facets).forEach(([key]) => {
    selectedFacetValues(key).forEach((value) => {
      const rows = definitions.filter((definition) => definition.key === key);
      const row = rows.find((definition) => definition.options.some((option) => option.value === value)) || rows[0];
      const option = row?.options.find((candidate) => candidate.value === value);
      const button = createElement("button", "active-filter-chip");
      button.type = "button";
      button.setAttribute("aria-label", `${row?.label || key} ${option?.label || value} 조건 해제`);
      button.append(
        createElement("span", "active-filter-chip-label", option?.label || facetOptionLabel(key, value)),
        createElement("span", "active-filter-chip-remove", "×"),
      );
      button.querySelector(".active-filter-chip-remove")?.setAttribute("aria-hidden", "true");
      button.addEventListener("click", () => updateFacet(key, value, row?.rowKey || key));
      dom.activeFilterChips.append(button);
    });
  });
  if (!hasSelectedFacets()) {
    dom.activeFilterChips.append(createElement("span", "active-filter-empty", "전체"));
  }
  dom.activeFilterSummary.hidden = false;
}

function updateMatchedModelButton() {
  if (!dom.showMatchedModels) return;
  dom.showMatchedModels.textContent = "검색 결과로 이동";
}

function updateFacetSelectionUi(definitions = facetDefinitionsForCategory(state.categoryCode)) {
  const selectionCount = selectedFacetCount();
  if (dom.filterContext) dom.filterContext.textContent = selectionCount ? `${selectionCount}개 조건 선택` : "전체 상품";

  dom.facetRows.querySelectorAll('.model-facet-row').forEach((row) => {
    const definition = definitions.find((candidate) => candidate.rowKey === row.dataset.facetRow);
    if (!definition) return;
    const selected = new Set(selectedFacetValues(definition.key));
    const labels = definition.options
      .filter((option) => selected.has(option.value))
      .map((option) => option.label);
    const summary = row.querySelector(".facet-selected-summary");
    if (summary) {
      summary.textContent = labels.length
        ? `${labels.slice(0, 2).join(", ")}${labels.length > 2 ? ` 외 ${labels.length - 2}개` : ""}`
        : "전체";
    }
    row.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
      checkbox.checked = selected.has(checkbox.value);
    });
  });

  renderActiveFilterSummary(definitions);
  dom.resetFilters.hidden = !hasSelectedFacets() && !state.query;
  updateMatchedModelButton();
}

function renderFacets() {
  dom.facetRows.replaceChildren();
  const category = state.categories.find((item) => categoryCode(item) === state.categoryCode);
  if (dom.filterCategoryLabel) dom.filterCategoryLabel.textContent = category ? categoryLabel(category) : "PC 부품";
  const definitions = facetDefinitionsForCategory(state.categoryCode);
  definitions.forEach((definition) => {
    dom.facetRows.append(makeFacetCheckboxRow(definition));
  });

  if (!definitions.length && state.categoryCode) {
    dom.facetRows.append(createElement("p", "facet-empty", "선택 가능한 필터가 없습니다."));
  }
  dom.modelFilters.hidden = !state.categoryCode && definitions.length === 0;

  updateFacetSelectionUi(definitions);
  renderSourceFilters();
}

function setModelFiltersCollapsed(collapsed) {
  state.modelFiltersCollapsed = Boolean(collapsed);
  dom.modelFilterBody.hidden = state.modelFiltersCollapsed;
  dom.modelFilterToggle.setAttribute("aria-expanded", String(!state.modelFiltersCollapsed));
  dom.modelFilterToggle.textContent = state.modelFiltersCollapsed ? "옵션 전체보기" : "옵션 접기";
}

function setListingOptionsCollapsed(collapsed) {
  state.listingOptionsCollapsed = Boolean(mobileFacetMedia.matches && collapsed);
  dom.listingOptions.hidden = state.listingOptionsCollapsed;
  dom.listingOptionsToggle.setAttribute("aria-expanded", String(!state.listingOptionsCollapsed));
  dom.listingOptionsToggle.textContent = state.listingOptionsCollapsed ? "정렬·가격 열기" : "정렬·가격 닫기";
}

function syncListingSortTabs() {
  const activeSort = state.listingSort || dom.listingSort.value || "recent";
  dom.listingSort.value = activeSort;
  dom.listingSortTabs.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.sort === activeSort));
  });
}

function syncSourceFilterSummary() {
  if (!dom.sourceFilterSummary) return;
  if (state.selectedSites.size === 0) {
    dom.sourceFilterSummary.textContent = listingPriceControlsActive() && listingCurrencyScope() === "KRW"
      ? "원화 사이트 전체"
      : "사이트 전체";
    return;
  }
  dom.sourceFilterSummary.textContent = state.selectedSites.size === 1
    ? sourceLabel([...state.selectedSites][0])
    : `사이트 ${state.selectedSites.size}개`;
}

function reloadListingsForControls(focusSourceValue) {
  renderSourceFilters();
  if (focusSourceValue !== undefined) {
    window.requestAnimationFrame(() => {
      dom.sourceFilters.querySelector(`input[data-value="${CSS.escape(focusSourceValue)}"]`)
        ?.focus({ preventScroll: true });
    });
  }
  if (state.selectedProduct) {
    clearSelectedPriceTable();
    dom.statsGroups.replaceChildren();
    dom.statsSection.hidden = true;
    dom.priceChartDisclosure.hidden = true;
    showDetailMessage("선택한 사이트의 가격 통계를 불러오는 중입니다.");
    loadProductDetail();
  }
  else if (shouldAutoLoadScopedListings()) loadListings(false);
  else showScopedListings(0, { load: false });
}

function renderSourceFilters() {
  dom.sourceFilters.replaceChildren();
  dom.sourceFacetRow.hidden = state.sources.length === 0;
  syncSourceFilterSummary();
  if (!state.sources.length) return;
  const allSourcesLabel = listingPriceControlsActive() && listingCurrencyScope() === "KRW" ? "원화 전체" : "전체";
  const priority = ["joonggonara", "bunjang", "danawa"];
  const compactLabels = { joonggonara: "중고나라", bunjang: "번개", danawa: "다나와" };
  const orderedSources = [...state.sources].sort((left, right) => {
    const leftIndex = priority.indexOf(left.id);
    const rightIndex = priority.indexOf(right.id);
    return (leftIndex < 0 ? priority.length : leftIndex) - (rightIndex < 0 ? priority.length : rightIndex);
  });
  const appendChoice = (label, value, checked, onChange, extra = false) => {
    const choice = createElement("label", `source-choice${extra ? " is-extra" : ""}`);
    if (extra && !state.sourceMoreOpen) choice.hidden = true;
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = checked;
    checkbox.dataset.value = value;
    checkbox.addEventListener("change", onChange);
    choice.append(checkbox, createElement("span", "", label));
    dom.sourceFilters.append(choice);
  };
  appendChoice(allSourcesLabel, "", state.selectedSites.size === 0, () => {
    state.selectedSites.clear();
    reloadListingsForControls("");
  });
  orderedSources.forEach((source, index) => {
    appendChoice(compactLabels[source.id] || source.label, source.id, state.selectedSites.has(source.id), () => {
      if (state.selectedSites.has(source.id)) state.selectedSites.delete(source.id);
      else state.selectedSites.add(source.id);
      reloadListingsForControls(source.id);
    }, index >= 3);
  });
  const extraCount = Math.max(0, orderedSources.length - 3);
  dom.sourceMoreToggle.hidden = extraCount === 0;
  dom.sourceMoreToggle.textContent = state.sourceMoreOpen ? "접기" : "더보기";
  dom.sourceMoreToggle.setAttribute("aria-expanded", String(state.sourceMoreOpen));
}

function updateFacet(key, value, rowKey = key) {
  const next = new Set(selectedFacetValues(key));
  if (next.has(value)) next.delete(value);
  else next.add(value);
  if (next.size) state.facets[key] = [...next];
  else delete state.facets[key];
  state.openFacetRows.add(rowKey);
  syncCatalogUrl();
  updateFacetSelectionUi();
  refreshBrowseScope(180);
}

function selectCategory(code) {
  if (!code || code === state.categoryCode) return;
  state.categoryCode = code;
  state.query = "";
  dom.catalogQuery.value = "";
  state.facets = {};
  state.openFacetRows.clear();
  state.expandedFacetOptions.clear();
  state.listingSort = "recent";
  state.priceMin = "";
  state.priceMax = "";
  dom.listingSort.value = "recent";
  syncListingSortTabs();
  state.sourceMoreOpen = false;
  dom.priceMin.value = "";
  dom.priceMax.value = "";
  const firstFacet = browseFlowForCategory(code)[0]?.key;
  if (firstFacet) state.openFacetRows.add(firstFacet);
  clearTimeout(catalogSearchTimer);
  renderCategories();
  renderFacets();
  updateWorkspaceHeading();
  syncCatalogUrl();
  refreshBrowseScope();
}

function updateWorkspaceHeading() {
  const category = state.categories.find((item) => categoryCode(item) === state.categoryCode);
  const label = category ? categoryLabel(category) : "제품";
  const categoryRoute = window.location.pathname.match(/^\/categories\/([a-z-]+)$/u);
  const query = state.query.slice(0, 80);
  const pageTitle = query
    ? `${query} 중고 PC 부품 검색 | USED PICK`
    : categoryRoute
      ? `중고 ${label} 검색 | ${label} 중고시세 비교 | USED PICK`
      : "중고 PC·컴퓨터 부품 검색 | 중고 시세 비교 | USED PICK";
  const pageDescription = query
    ? `중고 PC 부품 검색 결과입니다. ${query} 모델별 매물과 일별 중고 시세를 비교하세요.`
    : categoryRoute
      ? `중고 ${label}를 모델별로 검색하고 현재 매물, 판매중 가격, 일별 ${label} 중고시세를 비교하세요.`
      : "중고 PC와 컴퓨터 부품을 모델별로 검색하세요. 중고 그래픽카드, CPU, RAM, SSD, 메인보드, 파워서플라이 매물과 일별 중고 시세를 비교합니다.";
  const heading = query
    ? `“${query}” 중고 PC 검색 결과`
    : categoryRoute
      ? `중고 ${label} 검색`
      : "중고 PC 부품 검색";
  const intro = query
    ? `${query} 관련 중고 PC 부품 모델과 현재 매물을 비교합니다.`
    : categoryRoute
      ? `중고 ${label} 모델을 검색하고 출처별 매물과 중고시세를 비교하세요.`
      : "중고 컴퓨터 부품을 모델별로 검색하고 현재 매물과 최근 중고 시세를 비교하세요.";

  dom.workspaceTitle.textContent = heading;
  if (dom.workspaceIntro) dom.workspaceIntro.textContent = intro;
  document.title = pageTitle;
  const descriptionMeta = document.querySelector('meta[name="description"]');
  const ogTitleMeta = document.querySelector('meta[property="og:title"]');
  const ogDescriptionMeta = document.querySelector('meta[property="og:description"]');
  const twitterTitleMeta = document.querySelector('meta[name="twitter:title"]');
  const twitterDescriptionMeta = document.querySelector('meta[name="twitter:description"]');
  if (descriptionMeta) descriptionMeta.setAttribute("content", pageDescription);
  if (ogTitleMeta) ogTitleMeta.setAttribute("content", pageTitle);
  if (ogDescriptionMeta) ogDescriptionMeta.setAttribute("content", pageDescription);
  if (twitterTitleMeta) twitterTitleMeta.setAttribute("content", pageTitle);
  if (twitterDescriptionMeta) twitterDescriptionMeta.setAttribute("content", pageDescription);
}

function productSpecText(product) {
  const explicit = normalizeText(firstDefined(product?.spec_summary, product?.spec_text, product?.capacity_label));
  if (explicit) return explicit;
  const specs = {
    ...(product?.key_specs && typeof product.key_specs === "object" ? product.key_specs : {}),
    ...(product?.spec_json && typeof product.spec_json === "object" ? product.spec_json : {}),
    ...(product?.specs && typeof product.specs === "object" ? product.specs : {}),
    ...(product?.spec && typeof product.spec === "object" ? product.spec : {}),
    ...(product?.browse_facets && typeof product.browse_facets === "object" ? product.browse_facets : {}),
  };
  if (!specs || typeof specs !== "object") return "—";
  if (productCategory(product) === "RAM") {
    const generation = normalizeText(specs.memory_generation);
    const moduleCapacity = Number(specs.module_capacity_gb);
    const moduleCount = Number(specs.module_count);
    const totalCapacity = Number.isFinite(Number(specs.total_capacity_gb))
      ? Number(specs.total_capacity_gb)
      : Number.isFinite(moduleCapacity) && Number.isFinite(moduleCount) ? moduleCapacity * moduleCount : null;
    const capacity = Number.isFinite(moduleCapacity)
      ? `${moduleCapacity}GB${Number.isFinite(moduleCount) ? ` × ${moduleCount}` : ""}${Number.isFinite(totalCapacity) ? ` · 총 ${totalCapacity}GB` : ""}`
      : "";
    const formFactor = normalizeText(specs.form_factor || specs.memory_form_factor);
    return [generation, capacity, formFactor].filter(Boolean).join(" · ") || "—";
  }
  const priority = {
    GPU: ["gpu_model", "board_manufacturer", "vram_gb", "generation", "family"],
    CPU: ["generation", "family", "suffix", "socket"],
    RAM: ["memory_generation", "module_capacity_gb", "module_count", "total_capacity_gb", "form_factor"],
    SSD: ["marketed_capacity_gb", "capacity_gb", "interface", "protocol", "form_factor"],
    HDD: ["marketed_capacity_gb", "capacity_gb", "purpose", "form_factor"],
    MOTHERBOARD: ["socket", "chipset", "form_factor", "memory_generation"],
    PSU: ["rated_wattage", "watts", "atx_spec", "efficiency", "form_factor"],
  }[productCategory(product)] || [];
  const orderedKeys = [...new Set([...priority, ...Object.keys(specs)])];
  if (productCategory(product) === "RAM" && specs.total_capacity_gb === undefined
    && Number.isFinite(Number(specs.module_capacity_gb)) && Number.isFinite(Number(specs.module_count))) {
    specs.total_capacity_gb = Number(specs.module_capacity_gb) * Number(specs.module_count);
  }
  return orderedKeys.map((key) => [key, specs[key]])
    .filter(([key, value]) => !["directory_node_type", "market_segment", "board_manufacturer", "chip_manufacturer", "manufacturer_roles"].includes(key)
      && (["string", "number"].includes(typeof value) || Array.isArray(value))
      && (Array.isArray(value) ? value.length : normalizeText(value)))
    .slice(0, 3)
    .map(([key, value]) => facetOptionLabel(key, Array.isArray(value) ? value.join(" / ") : normalizeText(value)))
    .join(" · ") || "—";
}

function renderProducts() {
  const selectedId = state.selectedProduct ? productId(state.selectedProduct) : "";
  const total = Number.isFinite(Number(state.productTotal)) && Number(state.productTotal) >= state.products.length
    ? Number(state.productTotal)
    : state.products.length;
  dom.modelSelect.replaceChildren();
  const placeholder = createElement("option", "", total
    ? `검색된 모델 ${total.toLocaleString("ko-KR")}개`
    : "검색된 모델 없음");
  placeholder.value = "";
  dom.modelSelect.append(placeholder);
  state.products.forEach((product) => {
    const option = createElement("option", "", `${productName(product)} · ${productSpecText(product)}`);
    option.value = productId(product);
    option.selected = option.value === selectedId;
    dom.modelSelect.append(option);
  });
  dom.modelSelect.disabled = state.products.length === 0;
  if (!selectedId) dom.modelSelect.value = "";
  if (!state.selectedProduct) dom.listingSection.hidden = total === 0;
  updateMatchedModelButton();
}

function buildProductQuery(cursor = "") {
  const params = new URLSearchParams();
  if (state.categoryCode) params.set("category_code", state.categoryCode);
  Object.keys(state.facets).forEach((key) => {
    if (!PRODUCT_QUERY_KEYS.has(key)) return;
    selectedFacetValues(key).forEach((value) => params.append(key, value));
  });
  if (state.query) params.set("q", state.query);
  if (cursor) params.set("cursor", cursor);
  return params;
}

function filterSeedProducts() {
  const query = state.query.toLocaleLowerCase("ko-KR");
  return state.seedProducts.filter((product) => {
    if (state.categoryCode && productCategory(product) !== state.categoryCode) return false;
    if (query && !productName(product).toLocaleLowerCase("ko-KR").includes(query)) return false;
    return productMatchesActiveFacets(product);
  });
}

function openSingleSearchResult() {
  if (state.productTotal !== 1 || state.products.length !== 1) return false;
  selectProduct(state.products[0]);
  return true;
}

async function loadProducts() {
  if (!state.categoryCode && !state.query) return;
  state.productRequest?.abort();
  const controller = new AbortController();
  state.productRequest = controller;
  state.productCursor = "";
  state.products = [];
  state.productTotal = 0;
  state.productPage = 1;
  showCatalogMessage("제품 목록을 불러오는 중입니다.");
  dom.modelSelect.setAttribute("aria-busy", "true");
  try {
    const payload = await fetchJson(`/api/catalog/models?${buildProductQuery()}`, { signal: controller.signal });
    const nestedProducts = payload?.products && !Array.isArray(payload.products) && typeof payload.products === "object"
      ? payload.products
      : null;
    const items = toArray(firstDefined(
      nestedProducts?.items,
      payload?.items,
      payload?.models,
      Array.isArray(payload?.products) ? payload.products : null,
      payload?.results,
    ));
    state.products = items;
    const responseTotal = Number(firstDefined(nestedProducts?.total, payload?.total));
    state.productTotal = Number.isFinite(responseTotal)
      ? responseTotal
      : items.length;
    renderProducts();
    showCatalogMessage("");
    openSingleSearchResult();
  } catch (error) {
    if (error.name === "AbortError") return;
    const fallback = filterSeedProducts();
    if (fallback.length) {
      state.products = fallback;
      state.productTotal = fallback.length;
      state.productCursor = "";
      renderProducts();
      showCatalogMessage("제품 목록 API가 응답하지 않아 카탈로그에 포함된 제품을 표시합니다.");
      openSingleSearchResult();
    } else {
      state.products = [];
      state.productTotal = 0;
      renderProducts();
      showCatalogMessage(`제품 목록을 불러오지 못했습니다. ${error.message}`, true);
    }
  } finally {
    if (state.productRequest === controller) {
      state.productRequest = null;
      dom.modelSelect.removeAttribute("aria-busy");
    }
  }
}

function resetDetail() {
  cancelListingRequest();
  state.detailRequest?.abort();
  state.detailRequest = null;
  state.selectedProduct = null;
  state.listings = [];
  resetListingPagination();
  state.listingScopeKey = "";
  state.detailStats = [];
  state.visibleStatsCount = 0;
  closeModelDetail(false);
  document.body.classList.remove("has-selected-product");
  dom.pricePanelTitle.textContent = "모델을 선택하세요";
  showDetailMessage("검색된 모델을 누르면 일별 평균 가격을 표시합니다.");
  dom.priceSummary.hidden = true;
  dom.statsSection.hidden = true;
  dom.priceChartDisclosure.hidden = true;
  dom.listingSection.hidden = true;
  dom.backToModels.hidden = true;
  dom.statsGroups.replaceChildren();
  dom.listingRows.replaceChildren();
  showListingMessage("");
  renderProducts();
}

function currentListingScopeTitle() {
  if (state.query) return `“${state.query}” 검색 매물`;
  const category = state.categories.find((item) => categoryCode(item) === state.categoryCode);
  const selected = Object.entries(state.facets)
    .flatMap(([key]) => selectedFacetValues(key).map((value) => facetOptionLabel(key, value)))
    .slice(0, 3);
  const scope = [category ? categoryLabel(category) : "PC 부품", ...selected].join(" · ");
  return `${scope} 현재 매물`;
}

function activeFacetValueCount() {
  return Object.values(state.facets).reduce((total, values) => (
    total + (Array.isArray(values) ? values.filter(Boolean).length : 0)
  ), 0);
}

function shouldAutoLoadScopedListings() {
  if (state.selectedProduct) return true;
  const total = Number.isFinite(Number(state.productTotal)) ? Number(state.productTotal) : state.products.length;
  if (total <= 0) return false;
  if (state.query) return total <= SEARCH_LISTING_AUTORUN_MODEL_LIMIT;
  return activeFacetValueCount() > 0 && total <= SCOPED_LISTING_AUTORUN_MODEL_LIMIT;
}

function scopedListingHoldMessage() {
  const total = Number.isFinite(Number(state.productTotal)) ? Number(state.productTotal) : state.products.length;
  if (total <= 0) return "조건에 맞는 모델이 없습니다.";
  return `검색된 모델 ${total.toLocaleString("ko-KR")}개. 모델을 선택하면 현재 매물과 일별 평균 가격 그래프를 봅니다.`;
}

function showScopedListings(listingDelayMs = 0, options = {}) {
  cancelListingRequest();
  state.detailRequest?.abort();
  state.detailRequest = null;
  state.selectedProduct = null;
  state.listings = [];
  resetListingPagination();
  state.listingScopeKey = "";
  state.detailStats = [];
  state.visibleStatsCount = 0;
  closeModelDetail(false);
  document.body.classList.remove("has-selected-product");
  dom.pricePanelTitle.textContent = "모델을 선택하세요";
  showDetailMessage("검색된 모델을 누르면 일별 평균 가격을 표시합니다.");
  dom.priceSummary.hidden = true;
  dom.statsSection.hidden = true;
  dom.priceChartDisclosure.hidden = true;
  dom.statsGroups.replaceChildren();
  dom.listingSection.hidden = false;
  dom.backToModels.hidden = true;
  dom.listingTitle.textContent = currentListingScopeTitle();
  dom.listingEmpty.textContent = state.productTotal
    ? "선택한 조건에 맞는 현재 매물이 없습니다."
    : "선택한 조건에 맞는 모델이 없습니다.";
  dom.listingRows.replaceChildren();
  renderProducts();
  if (options.load === false) {
    dom.listingEmpty.hidden = true;
    renderListingPagination();
    showListingMessage(scopedListingHoldMessage());
    return;
  }
  if (listingDelayMs > 0) {
    showListingMessage("현재 매물을 불러오는 중입니다.");
    browseListingTimer = window.setTimeout(() => {
      browseListingTimer = null;
      loadListings(false);
    }, listingDelayMs);
  } else {
    loadListings(false);
  }
}

async function refreshBrowseScope(listingDelayMs = 0) {
  resetDetail();
  await loadProducts();
  if (state.selectedProduct) return;
  showScopedListings(listingDelayMs, { load: shouldAutoLoadScopedListings() });
}

function closeModelDetail(restoreFocus = true) {
  if (dom.modelDetailDialog.open) dom.modelDetailDialog.close();
  document.body.classList.remove("has-model-dialog");
  if (state.selectedProduct) {
    dom.modelSelect.value = "";
    const placeholder = dom.modelSelect.options[0];
    if (placeholder) placeholder.textContent = `선택: ${productName(state.selectedProduct)}`;
  }
  if (restoreFocus) dom.modelSelect.focus({ preventScroll: true });
}

function openModelDetail() {
  if (!dom.modelDetailDialog.open) dom.modelDetailDialog.showModal();
  document.body.classList.add("has-model-dialog");
}

function clearSelectedPriceTable() {
  [
    dom.activeLatest, dom.activeMean, dom.activeChange,
    dom.reservedLatest, dom.reservedMean, dom.reservedChange,
    dom.soldLatest, dom.soldMean, dom.soldChange,
    dom.confirmedLatest, dom.confirmedMean, dom.confirmedChange,
  ].forEach((cell) => { cell.textContent = "—"; cell.classList.remove("is-up", "is-down"); });
  [dom.activeCount, dom.reservedCount, dom.soldCount, dom.confirmedCount]
    .forEach((cell) => { cell.textContent = "—"; });
}

function listingPriceControlsActive() {
  return state.listingSort !== "recent" || Boolean(state.priceMin || state.priceMax);
}

function listingSourceScope() {
  return state.selectedSites.size
    ? state.sources.filter((source) => state.selectedSites.has(source.id))
    : state.sources;
}

function listingCurrencyScope() {
  const currencies = [...new Set(listingSourceScope().map((source) => source.currency).filter(Boolean))];
  if (currencies.length === 1) return currencies[0];
  return listingPriceControlsActive() && currencies.includes("KRW") ? "KRW" : "";
}

function selectProduct(product) {
  if (!productId(product)) {
    showDetailMessage("이 제품은 표준 제품 ID가 없어 상세 통계를 조회할 수 없습니다.", true);
    return;
  }
  cancelListingRequest();
  state.returnFocusProductId = productId(product);
  state.selectedProduct = product;
  document.body.classList.add("has-selected-product");
  state.listings = [];
  resetListingPagination();
  state.listingScopeKey = "";
  state.detailStats = [];
  state.visibleStatsCount = 0;
  dom.pricePanelTitle.textContent = productName(product);
  dom.workspaceTitle.textContent = productName(product);
  dom.listingTitle.textContent = `${productName(product)} 현재 매물`;
  clearSelectedPriceTable();
  dom.priceSummary.hidden = true;
  dom.statsSection.hidden = true;
  dom.priceChartDisclosure.hidden = true;
  dom.listingSection.hidden = false;
  dom.backToModels.hidden = false;
  dom.backToModels.textContent = "← 전체 조건 매물";
  dom.listingRows.replaceChildren();
  dom.listingEmpty.hidden = true;
  dom.listingEmpty.textContent = "이 모델의 현재 매물이 없습니다.";
  showListingMessage("현재 매물을 불러오는 중입니다.");
  showDetailMessage("가격 통계와 현재 매물을 불러오는 중입니다.");
  renderProducts();
  openModelDetail();
  loadProductDetail();
  window.requestAnimationFrame(() => {
    dom.pricePanelTitle.focus({ preventScroll: true });
  });
}

function buildListingQuery(cursor = "") {
  const params = new URLSearchParams();
  if (state.selectedProduct) {
    params.set("canonical_product_id", productId(state.selectedProduct));
  } else {
    if (state.categoryCode) params.set("category_code", state.categoryCode);
    Object.keys(state.facets).sort().forEach((key) => {
      if (!PRODUCT_QUERY_KEYS.has(key)) return;
      selectedFacetValues(key).sort().forEach((value) => params.append(key, value));
    });
    if (state.query) params.set("q", state.query);
  }
  if (state.selectedSites.size) params.set("sites", [...state.selectedSites].join(","));
  if (state.listingSort) params.set("sort", state.listingSort);
  if (state.priceMin) params.set("price_min", state.priceMin);
  if (state.priceMax) params.set("price_max", state.priceMax);
  const sourceScope = listingSourceScope();
  const marketPools = [...new Set(sourceScope.flatMap((source) => source.marketPools).filter(Boolean))];
  const currencyScope = listingCurrencyScope();
  if (currencyScope) params.set("currency", currencyScope);
  if (marketPools.length === 1) params.set("market_pool", marketPools[0]);
  if (cursor) params.set("cursor", cursor);
  return params;
}

function buildStatsUrl(product, cohort) {
  const params = new URLSearchParams({
    days: "30",
    market_pool: cohort.marketPool,
    condition: cohort.condition,
    currency: cohort.currency,
  });
  return `/api/products/${encodeURIComponent(productId(product))}/price-stats?${params}`;
}

async function loadProductDetail() {
  cancelListingRequest();
  resetListingPagination();
  state.detailRequest?.abort();
  const controller = new AbortController();
  state.detailRequest = controller;
  const product = state.selectedProduct;
  let listingSettled = false;
  let listingError = null;
  let statsSettled = 0;
  let statsFailures = 0;
  const totalStats = COHORTS.length;
  const isActiveDetail = () => !controller.signal.aborted && state.selectedProduct === product;
  const applyFinalDetailMessage = () => {
    const allStatsFailed = totalStats > 0 && statsFailures === totalStats;
    if (listingError && allStatsFailed) {
      showDetailMessage("현재 매물 목록과 가격 통계를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.", true);
    } else if (listingError && statsFailures) {
      showDetailMessage(state.visibleStatsCount
        ? "확인 가능한 가격 통계만 표시하며, 현재 매물 목록은 불러오지 못했습니다."
        : "현재 매물 목록과 일부 가격 통계를 불러오지 못했습니다. 확인된 범위에는 가격 자료가 없습니다.", true);
    } else if (listingError) {
      showDetailMessage(state.visibleStatsCount
        ? "가격 통계는 표시했지만 현재 매물 목록을 불러오지 못했습니다."
        : "현재 매물 목록을 불러오지 못했고, 확인된 범위에는 가격 통계가 없습니다.", true);
    } else if (allStatsFailed) {
      showDetailMessage("현재 매물은 표시했지만 가격 통계를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.", true);
    } else if (statsFailures && !state.visibleStatsCount) {
      showDetailMessage("현재 매물은 표시했지만 일부 가격 통계를 불러오지 못했고, 확인된 범위에는 가격 자료가 없습니다.", true);
    } else if (!state.visibleStatsCount) {
      showDetailMessage(state.selectedSites.size
        ? "현재 매물은 표시했지만 선택한 사이트의 일별 가격 통계는 아직 없습니다."
        : "현재 매물은 표시했지만 이 모델의 일별 가격 통계는 아직 없습니다.");
    } else if (statsFailures) {
      showDetailMessage("일부 시장군 통계가 없어 확인 가능한 자료만 표시합니다.");
    } else {
      showDetailMessage("");
    }
  };
  const updateDetailProgressMessage = () => {
    if (!isActiveDetail()) return;
    if (listingSettled && statsSettled >= totalStats) {
      applyFinalDetailMessage();
    } else if (state.visibleStatsCount || state.detailStats.length) {
      showDetailMessage(listingSettled && !listingError
        ? "일별 가격 통계를 표시했습니다. 나머지 시장군은 확인 중입니다."
        : "일별 가격 통계를 표시했고, 현재 매물을 불러오는 중입니다.");
    } else if (listingSettled && !listingError) {
      showDetailMessage("현재 매물을 표시했고, 일별 가격 통계를 불러오는 중입니다.");
    } else {
      showDetailMessage("가격 통계와 현재 매물을 불러오는 중입니다.");
    }
  };
  const listingPromise = fetchJson(`/api/pc/listings?${buildListingQuery()}`, { signal: controller.signal });
  const listingTask = listingPromise.then((payload) => {
    if (!isActiveDetail()) return;
    applyListingPayload(payload, 1);
    showListingMessage("");
  }).catch((error) => {
    if (error.name === "AbortError") throw error;
    if (!isActiveDetail()) return;
    listingError = error;
    state.listings = [];
    resetListingPagination();
    renderListings();
    showListingMessage("현재 매물 목록을 불러오지 못했습니다.", true);
  }).finally(() => {
    if (!isActiveDetail()) return;
    listingSettled = true;
    updateDetailProgressMessage();
  });
  const statsTasks = COHORTS.map(async (cohort) => {
    try {
      const data = await fetchJson(buildStatsUrl(product, cohort), { signal: controller.signal });
      if (!isActiveDetail()) return;
      state.detailStats = [
        ...state.detailStats.filter((result) => result.cohort.marketPool !== cohort.marketPool || result.cohort.currency !== cohort.currency),
        { cohort, data, error: null },
      ];
      renderStats();
    } catch (error) {
      if (error.name === "AbortError") throw error;
      if (isActiveDetail()) statsFailures += 1;
    } finally {
      if (!isActiveDetail()) return;
      statsSettled += 1;
      updateDetailProgressMessage();
    }
  });

  try {
    await Promise.allSettled([listingTask, ...statsTasks]);
    if (isActiveDetail()) applyFinalDetailMessage();
  } catch (error) {
    if (error.name !== "AbortError") showDetailMessage(`상세 정보를 불러오지 못했습니다. ${error.message}`, true);
  } finally {
    if (state.detailRequest === controller) state.detailRequest = null;
  }
}

function applyListingPayload(payload, pageNumber = 1) {
  const items = toArray(firstDefined(payload?.items, payload?.listings, payload?.results));
  state.listings = items;
  state.listingPage = pageNumber;
  state.listingPages.set(pageNumber, items);
  state.listingCursor = normalizeText(firstDefined(payload?.next_cursor, payload?.nextCursor, payload?.pagination?.next_cursor, payload?.pagination?.nextCursor));
  state.listingNextCursors.set(pageNumber, state.listingCursor);
  if (state.listingCursor) state.listingPageCursors.set(pageNumber + 1, state.listingCursor);
  else state.listingPageCursors.delete(pageNumber + 1);
  renderListings();
}

function listingPrice(listing) {
  const price = firstDefined(listing?.price_value, listing?.price, listing?.display_price, listing?.amount, listing?.unit_price);
  const currency = normalizeText(firstDefined(listing?.currency, price?.currency, "KRW"));
  return formatMoney(price, currency);
}

function listingIdentity(listing) {
  const source = normalizeText(firstDefined(listing.source_id, listing.site, listing.source));
  const explicit = normalizeText(firstDefined(listing.source_listing_id, listing.item_id, listing.id));
  const url = normalizeText(firstDefined(listing.url, listing.listing_url, listing.canonical_url));
  let urlIdentity = "";
  try {
    const parsed = new URL(url);
    urlIdentity = parsed.searchParams.get("seq") || parsed.searchParams.get("item") || parsed.pathname;
  } catch {
    urlIdentity = url;
  }
  return `${source}\u0000${explicit.replace(new RegExp(`^${source}:`, "u"), "") || urlIdentity}`;
}

function listingIsDisplayable(listing) {
  if (listing?.price_eligible === false) return false;
  const condition = normalizeText(firstDefined(listing?.condition_code, listing?.condition)).toUpperCase();
  if (condition && condition !== "USED_WORKING") return false;
  const quantity = Number(firstDefined(listing?.quantity, 1));
  if (!Number.isFinite(quantity) || quantity < 1) return false;
  const scope = normalizeText(listing?.price_scope).toUpperCase();
  return !["AMBIGUOUS", "UNKNOWN"].includes(scope);
}

function listingConditionLabel(value) {
  const normalized = normalizeText(value).toUpperCase();
  return ({ ACTIVE: "판매중", USED_WORKING: "정상 작동", RESERVED: "예약중" })[normalized] || normalized || "상태 미확인";
}

function listingScopeLabel(listing) {
  const quantity = Math.max(1, Number(firstDefined(listing?.quantity, 1)) || 1);
  const scope = normalizeText(listing?.price_scope).toUpperCase();
  const scopeLabel = scope === "UNIT" ? "개당가격" : scope === "TOTAL" ? (quantity > 1 ? "일괄가격" : "단품가격") : "가격범위 확인중";
  return `${quantity}개 · ${scopeLabel}`;
}

function renderListings() {
  dom.listingRows.replaceChildren();
  const unique = new Map();
  state.listings.filter(listingIsDisplayable).forEach((listing) => {
    const key = listingIdentity(listing);
    const existing = unique.get(key);
    if (!existing || (!existing.image_url && listing.image_url)) unique.set(key, listing);
  });
  const visibleListings = [...unique.values()];
  visibleListings.forEach((listing) => {
    const row = createElement("article", "listing-row");
    const titleText = normalizeText(firstDefined(listing.title, listing.display_title, listing.name, "제목 미확인 매물"));
    const url = safeHttpsUrl(firstDefined(listing.url, listing.listing_url, listing.canonical_url));
    const imageUrl = safeHttpsUrl(firstDefined(listing.image_url, listing.thumbnail_url, listing.image));
    const media = createElement(url ? "a" : "div", "listing-media");
    if (url) {
      media.href = url;
      media.target = "_blank";
      media.rel = "noopener noreferrer";
      media.setAttribute("aria-label", `${titleText} 매물 보기`);
    }
    if (imageUrl) {
      const image = document.createElement("img");
      image.src = imageUrl;
      image.alt = "";
      image.loading = "lazy";
      image.decoding = "async";
      image.addEventListener("error", () => {
        image.remove();
        media.classList.add("is-empty");
        media.textContent = "이미지 없음";
      }, { once: true });
      media.append(image);
    } else {
      media.classList.add("is-empty");
      media.textContent = "이미지 없음";
    }
    const body = createElement("div", "listing-body");
    const source = createElement("span", "listing-source", sourceLabel(firstDefined(listing.source_id, listing.site, listing.source)));
    const title = createElement(url ? "a" : "span", "listing-title", titleText);
    if (url) {
      title.href = url;
      title.target = "_blank";
      title.rel = "noopener noreferrer";
    }
    body.append(source, title);
    const meta = createElement("div", "listing-meta");
    const canonicalModel = normalizeText(listing.canonical_display_name);
    const canonicalProductId = normalizeText(listing.canonical_product_id);
    if (!state.selectedProduct && canonicalModel) {
      if (canonicalProductId) {
        const modelAction = createElement("button", "listing-model listing-model-action", `${canonicalModel} 시세`);
        modelAction.type = "button";
        modelAction.setAttribute("aria-label", `${canonicalModel} 가격 인사이트 보기`);
        modelAction.addEventListener("click", () => {
          const product = state.products.find((item) => productId(item) === canonicalProductId) || {
            canonical_product_id: canonicalProductId,
            canonical_display_name: canonicalModel,
            category_code: state.categoryCode,
            manufacturer: firstDefined(listing.canonical_manufacturer, listing.manufacturer),
          };
          selectProduct(product);
        });
        meta.append(modelAction);
      } else {
        meta.append(createElement("span", "listing-model", canonicalModel));
      }
    }
    const maker = normalizeText(firstDefined(listing.board_manufacturer, listing.canonical_manufacturer, listing.manufacturer));
    if (maker) meta.append(createElement("span", "listing-maker", maker));
    meta.append(createElement("span", "listing-state", listingConditionLabel(firstDefined(listing.condition_code, listing.lifecycle_status, listing.status, listing.availability))));
    meta.append(createElement("span", "listing-scope", listingScopeLabel(listing)));
    body.append(meta);
    const observed = createElement("div", "listing-observed");
    const observedAt = formatDateTime(firstDefined(listing.observed_at, listing.posted_at, listing.created_at, listing.updated_at));
    if (observedAt) observed.append(createElement("time", "", observedAt));
    const commerce = createElement("div", "listing-commerce");
    commerce.append(createElement("span", "listing-price", listingPrice(listing)));
    if (url) {
      const action = createElement("a", "listing-action", "매물 보기");
      action.href = url;
      action.target = "_blank";
      action.rel = "noopener noreferrer";
      commerce.append(action);
    }
    row.append(media, body, observed, commerce);
    dom.listingRows.append(row);
  });
  dom.listingEmpty.hidden = visibleListings.length > 0;
  renderListingPagination();
}

function renderListingPagination() {
  const knownPages = new Set([...state.listingPages.keys(), ...state.listingPageCursors.keys()]);
  const maxKnownPage = Math.max(1, ...knownPages);
  dom.listingPageNumbers.replaceChildren();

  const visiblePages = listingPaginationWindow(maxKnownPage, state.listingPage);
  let previousPageNumber = 0;
  visiblePages.forEach((pageNumber) => {
    if (previousPageNumber && pageNumber - previousPageNumber > 1) {
      dom.listingPageNumbers.append(createElement("span", "listing-page-ellipsis", "…"));
    }
    const button = createElement("button", "listing-page-number", String(pageNumber));
    button.type = "button";
    button.dataset.page = String(pageNumber);
    button.setAttribute("aria-label", `${pageNumber}페이지`);
    if (pageNumber === state.listingPage) button.setAttribute("aria-current", "page");
    button.disabled = !state.listingPages.has(pageNumber) && !state.listingPageCursors.has(pageNumber);
    dom.listingPageNumbers.append(button);
    previousPageNumber = pageNumber;
  });

  const previousPage = state.listingPage - 1;
  const nextPage = state.listingPage + 1;
  dom.listingPagePrev.disabled = previousPage < 1 || !state.listingPages.has(previousPage);
  dom.listingPageNext.disabled = !state.listingPages.has(nextPage) && !state.listingPageCursors.has(nextPage);
  dom.listingPagination.hidden = maxKnownPage === 1;
}

function listingPaginationWindow(maxPage, currentPage) {
  if (maxPage <= 5) return Array.from({ length: maxPage }, (_, index) => index + 1);
  const pages = new Set([1, maxPage, currentPage - 1, currentPage, currentPage + 1]);
  if (currentPage <= 3) [2, 3, 4].forEach((page) => pages.add(page));
  if (currentPage >= maxPage - 2) [maxPage - 3, maxPage - 2, maxPage - 1].forEach((page) => pages.add(page));
  return [...pages].filter((page) => page >= 1 && page <= maxPage).sort((left, right) => left - right);
}

async function showListingPage(pageNumber) {
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber === state.listingPage) return;
  const cachedListings = state.listingPages.get(pageNumber);
  if (cachedListings) {
    cancelListingRequest({ hidePagination: false });
    state.listingPage = pageNumber;
    state.listings = cachedListings;
    state.listingCursor = state.listingNextCursors.get(pageNumber) || "";
    renderListings();
    showListingMessage("");
    window.requestAnimationFrame(() => {
      dom.listingPageNumbers.querySelector(`[data-page="${pageNumber}"]`)?.focus({ preventScroll: true });
    });
    return;
  }

  const cursor = state.listingPageCursors.get(pageNumber);
  if (!cursor) return;
  await requestListingPage(pageNumber, cursor);
}

function sourceRows(data) {
  const raw = firstDefined(data?.by_source, data?.sources, data?.source_stats);
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    return Object.entries(raw).map(([sourceId, value]) => ({
      ...(value && typeof value === "object" ? value : {}),
      source_id: firstDefined(value?.source_id, sourceId),
    }));
  }
  return [];
}

function statsRow(label, data, currency, combined = false) {
  const row = createElement("tr", combined ? "combined-row" : "");
  const active = firstDefined(data?.active, data?.active_stats, {});
  const sold = firstDefined(data?.sold, data?.sold_last_ask, data?.sold_stats, {});
  const confirmed = firstDefined(data?.confirmed_transactions, data?.confirmed_transaction, data?.transactions, {});
  const activeCount = firstDefined(sampleCount(active), data?.active_count, data?.n_active);
  const mean = metricValue(active, ["mean", "average", "avg", "mean_price"]) || normalizePrice(firstDefined(data?.active_mean, data?.average), currency);
  const median = metricValue(active, ["median", "median_price"]) || normalizePrice(data?.active_median, currency);
  const soldMean = metricValue(sold, ["mean", "average", "avg", "mean_price", "sold_last_ask_mean"]) || normalizePrice(firstDefined(data?.sold_last_ask_mean, data?.sold_mean), currency);
  const soldMedian = metricValue(sold, ["median", "median_price", "sold_last_ask_median"]) || normalizePrice(firstDefined(data?.sold_last_ask_median, data?.sold_median), currency);
  const soldCount = firstDefined(sampleCount(sold), data?.sold_count, data?.n_sold);
  const confirmedPrice = metricValue(confirmed, ["median", "median_price", "mean", "average", "amount", "transaction_price_median"])
    || normalizePrice(firstDefined(data?.confirmed_transaction_median, data?.transaction_price_median), currency);
  const confirmedCount = firstDefined(sampleCount(confirmed), data?.confirmed_transaction_count, data?.n_confirmed_transactions);

  row.append(
    createElement("td", "", label),
    createElement("td", "", activeCount === undefined || activeCount === null ? "—" : String(activeCount)),
    createElement("td", "", formatMoney(mean, currency)),
    createElement("td", "", formatMoney(median, currency)),
    createElement("td", "", formatMoney(soldMean, currency)),
  );
  const soldCell = createElement("td", "", formatMoney(soldMedian, currency));
  if (soldCount !== undefined && soldCount !== null) soldCell.title = `판매완료 표본 ${soldCount}건`;
  const confirmedCell = createElement("td", "", formatMoney(confirmedPrice, currency));
  if (confirmedCount !== undefined && confirmedCount !== null) confirmedCell.title = `확인된 체결가 표본 ${confirmedCount}건`;
  row.append(soldCell, confirmedCell);
  return row;
}

function compactStatsRow(label, data, currency, combined = false) {
  const row = createElement("tr", combined ? "combined-row" : "");
  const active = firstDefined(data?.active, data?.active_stats, {});
  const confirmed = firstDefined(data?.confirmed_transactions, data?.confirmed_transaction, data?.transactions, {});
  const activeMean = metricValue(active, ["mean", "average", "avg", "mean_price"]);
  const activeMedian = metricValue(active, ["median", "median_price"]);
  const confirmedMean = metricValue(confirmed, ["mean", "average", "avg", "mean_price", "transaction_price_mean"]);
  const confirmedMedian = metricValue(confirmed, ["median", "median_price", "transaction_price_median"]);
  const activeCell = createElement("td", "metric-pair");
  activeCell.append(createElement("strong", "", formatMoney(activeMean, currency)), createElement("small", "", `중앙 ${formatMoney(activeMedian, currency)}`));
  const confirmedCell = createElement("td", "metric-pair confirmed-metric");
  confirmedCell.append(createElement("strong", "", formatMoney(confirmedMean, currency)), createElement("small", "", `중앙 ${formatMoney(confirmedMedian, currency)}`));
  const counts = `${sampleCount(active) ?? 0} / ${sampleCount(confirmed) ?? 0}`;
  row.append(createElement("td", "", label), activeCell, confirmedCell, createElement("td", "sample-pair", counts));
  return row;
}

function combineSourceMetric(rows, key) {
  const blocks = rows.map((row) => firstDefined(row?.[key], key === "sold" ? row?.sold_last_ask : null, {}));
  const sampleCountTotal = blocks.reduce((sum, block) => sum + Number(sampleCount(block) || 0), 0);
  const meanParts = blocks.map((block) => ({ count: Number(sampleCount(block) || 0), value: Number(firstDefined(block?.mean, block?.average, block?.avg)) }))
    .filter((part) => part.count > 0 && Number.isFinite(part.value));
  const representedCount = meanParts.reduce((sum, part) => sum + part.count, 0);
  const mean = representedCount === sampleCountTotal && representedCount > 0
    ? meanParts.reduce((sum, part) => sum + part.value * part.count, 0) / representedCount
    : null;
  return { sample_count: sampleCountTotal, mean, median: null };
}

function statsForSelectedSites(data) {
  if (!state.selectedSites.size) return data;
  const rows = sourceRows(data).filter((row) => state.selectedSites.has(normalizeText(firstDefined(row.source_id, row.site, row.source))));
  if (rows.length === 1 && state.selectedSites.size === 1) {
    return { ...rows[0], by_source: rows, by_manufacturer: [], as_of: data?.as_of, selected_site_scope: "single" };
  }
  if (!rows.length) return null;
  return {
    ...data,
    active: combineSourceMetric(rows, "active"),
    reserved: combineSourceMetric(rows, "reserved"),
    sold: combineSourceMetric(rows, "sold"),
    confirmed_transactions: combineSourceMetric(rows, "confirmed_transactions"),
    daily: [],
    by_source: rows,
    by_manufacturer: [],
    selected_site_scope: "multiple",
  };
}

function statsHasEvidence(data) {
  const blocks = [data?.active, data?.reserved, data?.sold, data?.confirmed_transactions];
  if (blocks.some((block) => Number(sampleCount(block) || 0) > 0)) return true;
  if (sourceRows(data).some((row) => [row?.active, row?.reserved, row?.sold, row?.confirmed_transactions]
    .some((block) => Number(sampleCount(block) || 0) > 0))) return true;
  return toArray(data?.daily).some((row) => [row?.active, row?.reserved, row?.sold, row?.confirmed_transactions]
    .some((block) => Number(sampleCount(block) || 0) > 0));
}

function createSvgElement(tag, attributes = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, String(value)));
  return element;
}

function dailyAveragePoint(row, key, index) {
  const metric = row?.[key];
  const average = Number(firstDefined(metric?.mean, metric?.average, metric?.avg, metric?.mean_price));
  const count = Number(firstDefined(metric?.sample_count, metric?.count, 0));
  if (!Number.isFinite(average) || average <= 0 || !Number.isFinite(count) || count <= 0) return null;
  const date = normalizeText(firstDefined(row?.date, row?.stat_date));
  return { index, date, average, count };
}

function dateKey(value) {
  const text = normalizeText(value);
  if (!/^\d{4}-\d{2}-\d{2}/u.test(text)) return "";
  const date = new Date(`${text.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function dailyWindow(data, days) {
  const rows = toArray(data?.daily)
    .map((row) => ({ ...row, date: dateKey(firstDefined(row?.date, row?.stat_date)) }))
    .filter((row) => row.date);
  if (!rows.length) return [];
  const byDate = new Map(rows.map((row) => [row.date, row]));
  const anchor = dateKey(data?.as_of) || rows.map((row) => row.date).sort().at(-1);
  const end = new Date(`${anchor}T00:00:00Z`);
  const window = [];
  const requestedDays = Number(days);
  const span = Number.isFinite(requestedDays)
    ? Math.max(1, requestedDays)
    : Math.min(365, Math.max(rows.length, 30));
  for (let offset = span - 1; offset >= 0; offset -= 1) {
    const date = new Date(end);
    date.setUTCDate(end.getUTCDate() - offset);
    const key = date.toISOString().slice(0, 10);
    window.push(byDate.get(key) || { date: key });
  }
  return window;
}

function renderPriceChart(data, currency) {
  const daily = dailyWindow(data);
  const series = [
    { key: "active", label: "현재 매물 일평균", className: "active-series" },
    { key: "reserved", label: "예약중 표시가 일평균", className: "reserved-series" },
    { key: "sold", label: "판매완료 표시가 일평균", className: "sold-series" },
    { key: "confirmed_transactions", label: "확인된 거래가 일평균", className: "confirmed-series" },
  ].map((entry) => ({
    ...entry,
    points: daily.map((row, index) => dailyAveragePoint(row, entry.key, index)).filter(Boolean),
  }));
  const values = series.flatMap((entry) => entry.points.map((point) => point.average));
  const figure = createElement("figure", "price-chart");
  const width = 720;
  const height = 230;
  const margin = { top: 18, right: 18, bottom: 34, left: 78 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  if (!values.length) {
    const activeCount = Number(firstDefined(data?.active?.sample_count, data?.active?.count, 0));
    const soldCount = Number(firstDefined(data?.sold?.sample_count, data?.sold?.count, 0));
    const reservedCount = Number(firstDefined(data?.reserved?.sample_count, data?.reserved?.count, 0));
    const confirmedCount = Number(firstDefined(data?.confirmed_transactions?.sample_count, data?.confirmed_transactions?.count, 0));
    const svg = createSvgElement("svg", {
      viewBox: `0 0 ${width} ${height}`,
      role: "img",
      "aria-label": "아직 표본이 없는 일별 평균 가격 그래프",
    });
    [0, 0.5, 1].forEach((ratio) => {
      const y = margin.top + plotHeight * ratio;
      svg.append(createSvgElement("line", { x1: margin.left, x2: width - margin.right, y1: y, y2: y, class: "chart-grid" }));
    });
    ["가격", "일별 수집"].forEach((labelText, index) => {
      const label = createSvgElement("text", {
        x: index === 0 ? margin.left - 10 : width - margin.right,
        y: index === 0 ? margin.top + 4 : height - 10,
        class: "chart-axis-label",
        "text-anchor": index === 0 ? "end" : "end",
      });
      label.textContent = labelText;
      svg.append(label);
    });
    figure.append(svg, createElement(
      "div",
      "price-chart-empty",
      `일별 그래프 누적 중 · 판매중 ${activeCount}건 · 예약중 ${reservedCount}건 · 판매완료 ${soldCount}건 · 확인된 실제 거래 ${confirmedCount}건`,
    ));
    return figure;
  }

  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const padding = Math.max((maximum - minimum) * 0.12, maximum * 0.03, 1);
  const yMin = Math.max(0, minimum - padding);
  const yMax = maximum + padding;
  const xAt = (index) => margin.left + (daily.length <= 1 ? plotWidth / 2 : (index / (daily.length - 1)) * plotWidth);
  const yAt = (value) => margin.top + ((yMax - value) / Math.max(1, yMax - yMin)) * plotHeight;

  const svg = createSvgElement("svg", {
    viewBox: `0 0 ${width} ${height}`,
    role: "img",
    "aria-label": `수집된 기간의 현재 매물, 예약중 표시가, 판매완료 표시가, 확인된 거래가 일별 평균 그래프`,
  });
  [0, 0.5, 1].forEach((ratio) => {
    const y = margin.top + plotHeight * ratio;
    svg.append(createSvgElement("line", { x1: margin.left, x2: width - margin.right, y1: y, y2: y, class: "chart-grid" }));
    const label = createSvgElement("text", { x: margin.left - 10, y: y + 4, class: "chart-axis-label", "text-anchor": "end" });
    label.textContent = formatMoney(yMax - (yMax - yMin) * ratio, currency);
    svg.append(label);
  });

  const dateIndexes = [...new Set([0, Math.floor((daily.length - 1) / 2), daily.length - 1])].filter((index) => index >= 0);
  dateIndexes.forEach((index) => {
    const label = createSvgElement("text", {
      x: xAt(index), y: height - 10, class: "chart-axis-label", "text-anchor": index === 0 ? "start" : index === daily.length - 1 ? "end" : "middle",
    });
    label.textContent = normalizeText(firstDefined(daily[index]?.date, daily[index]?.stat_date)).slice(5);
    svg.append(label);
  });

  series.forEach((entry) => {
    let segment = [];
    const flushSegment = () => {
      if (segment.length > 1) {
        svg.append(createSvgElement("polyline", {
          points: segment.map((point) => `${xAt(point.index)},${yAt(point.average)}`).join(" "),
          class: `chart-line ${entry.className}`,
        }));
      }
      segment = [];
    };
    entry.points.forEach((point, pointIndex) => {
      const previous = entry.points[pointIndex - 1];
      if (previous && point.index !== previous.index + 1) flushSegment();
      segment.push(point);
    });
    flushSegment();
    entry.points.forEach((point) => {
      const circle = createSvgElement("circle", {
        cx: xAt(point.index), cy: yAt(point.average), r: 3.2, class: `chart-point ${entry.className}`,
        tabindex: 0,
        role: "img",
        "aria-label": `${point.date} ${entry.label} ${formatMoney(point.average, currency)} 표본 ${point.count}건`,
      });
      const title = createSvgElement("title");
      title.textContent = `${point.date} · ${entry.label} ${formatMoney(point.average, currency)} · 표본 ${point.count}건`;
      circle.append(title);
      svg.append(circle);
    });
  });

  const caption = createElement("figcaption", "price-chart-legend");
  series.forEach((entry) => {
    const item = createElement("span", entry.className, entry.label);
    caption.append(item);
  });
  const reservedSeries = series.find((entry) => entry.key === "reserved");
  if (!reservedSeries?.points.length) {
    caption.append(createElement("span", "chart-sample-note", "예약중 표본 수집 중 (0건)"));
  }
  const soldSeries = series.find((entry) => entry.key === "sold");
  if (!soldSeries?.points.length) {
    caption.append(createElement("span", "chart-sample-note", "판매완료 표본 수집 중 (0건)"));
  }
  const confirmedSeries = series.find((entry) => entry.key === "confirmed_transactions");
  if (!confirmedSeries?.points.length) {
    caption.append(createElement("span", "chart-sample-note", "확인된 실제 거래 표본 없음 · 예약중 제외"));
  }
  caption.append(createElement("span", "chart-gap-note", "자료 없는 날짜는 연결하지 않음"));
  figure.append(svg, caption);
  return figure;
}

function renderStatsGroup(result) {
  const { cohort, data } = result;
  const group = createElement("section", "stats-group");
  const title = createElement("div", "stats-group-title");
  const selectedSiteLabel = state.selectedSites.size ? ` · ${[...state.selectedSites].map(sourceLabel).join(" + ")}` : "";
  const hasEvidence = statsHasEvidence(data);
  title.append(createElement("h4", "", `${cohort.label}${selectedSiteLabel}`), createElement("span", "", `${cohort.currency} · 일별 평균`));
  const table = createElement("table", "stats-table");
  const thead = createElement("thead");
  const headerRow = createElement("tr");
  ["사이트", "현재 등록 평균", "확인 거래가", "표본(등록/거래)"].forEach((heading) => headerRow.append(createElement("th", "", heading)));
  thead.append(headerRow);
  const tbody = createElement("tbody");
  if (!state.selectedSites.size || data?.selected_site_scope === "single") {
    tbody.append(compactStatsRow(state.selectedSites.size ? sourceLabel([...state.selectedSites][0]) : "전체", data, cohort.currency, true));
  }
  sourceRows(data).forEach((source) => {
    const label = sourceLabel(firstDefined(source.source_id, source.site, source.source));
    if (!state.selectedSites.size || data?.selected_site_scope === "multiple") tbody.append(compactStatsRow(label, source, cohort.currency));
  });
  table.append(thead, tbody);
  group.append(title);
  const siteRows = sourceRows(data);
  if (siteRows.length) {
    siteRows.forEach((source) => {
      group.append(createElement("h5", "source-chart-title", sourceLabel(firstDefined(source.source_id, source.site, source.source))));
      group.append(renderPriceChart(source, cohort.currency));
    });
  } else {
    group.append(renderPriceChart(data, cohort.currency));
  }
  if (hasEvidence) {
    group.append(table);
  } else {
    group.append(createElement("p", "stats-empty-note", "아직 계산된 가격 표본이 없습니다. 수집되는 일별 평균은 이 그래프에 누적됩니다."));
  }
  return group;
}

function latestDailyAverage(data, key, currency) {
  const points = dailyWindow(data)
    .map((row, index) => dailyAveragePoint(row, key, index))
    .filter(Boolean);
  return points.length ? normalizePrice(points.at(-1).average, currency) : null;
}

function formatPriceChange(latest, average, fallbackCurrency = "KRW") {
  const latestPrice = normalizePrice(latest, fallbackCurrency);
  const averagePrice = normalizePrice(average, fallbackCurrency);
  if (!latestPrice || !averagePrice || latestPrice.currency !== averagePrice.currency) return { text: "—", direction: "" };
  const difference = latestPrice.amount - averagePrice.amount;
  if (Math.abs(difference) < 0.5) return { text: "변동 없음", direction: "" };
  return {
    text: `${difference > 0 ? "+" : "−"}${formatMoney({ amount: Math.abs(difference), currency: latestPrice.currency }, latestPrice.currency)}`,
    direction: difference > 0 ? "is-up" : "is-down",
  };
}

function renderPriceSummaryRow(key, block, data, currency, multipleSites) {
  const latestCell = dom[`${key}Latest`];
  const meanCell = dom[`${key}Mean`];
  const changeCell = dom[`${key}Change`];
  const countCell = dom[`${key}Count`];
  const meanKeys = key === "sold"
    ? ["mean", "average", "avg", "mean_price", "sold_last_ask_mean"]
    : key === "confirmed"
      ? ["mean", "average", "avg", "mean_price", "transaction_price_mean"]
      : ["mean", "average", "avg", "mean_price"];
  const dailyKey = key === "confirmed" ? "confirmed_transactions" : key;
  const mean = metricValue(block, meanKeys);
  const latest = multipleSites ? null : latestDailyAverage(data, dailyKey, currency);
  const change = formatPriceChange(latest, mean, currency);
  latestCell.textContent = formatMoney(latest, currency);
  meanCell.textContent = formatMoney(mean, currency);
  changeCell.textContent = change.text;
  changeCell.classList.toggle("is-up", change.direction === "is-up");
  changeCell.classList.toggle("is-down", change.direction === "is-down");
  countCell.textContent = formatCount(sampleCount(block));
}

function renderStats() {
  dom.statsGroups.replaceChildren();
  clearSelectedPriceTable();
  const normalizedResults = state.detailStats
    .map((result) => ({ ...result, data: statsForSelectedSites(result.data) }))
    .filter((result) => result.data);
  const scopedResults = normalizedResults.filter((result) => statsHasEvidence(result.data));
  const chartResults = scopedResults.length ? scopedResults : normalizedResults.slice(0, 1);
  state.visibleStatsCount = scopedResults.length;
  const receivedStats = state.detailStats.length > 0;
  dom.priceSummary.hidden = !state.selectedProduct || scopedResults.length === 0;
  dom.statsSection.hidden = !state.selectedProduct || !chartResults.length;
  dom.priceChartDisclosure.hidden = dom.statsSection.hidden;
  if (!chartResults.length) {
    if (receivedStats) dom.statsGroups.append(createElement("div", "price-chart-empty", "일별 가격 통계가 아직 없습니다. 확인된 실제 거래가 없으면 실제 거래 선도 표시하지 않습니다."));
    return;
  }

  chartResults.forEach((result) => dom.statsGroups.append(renderStatsGroup(result)));
  const chartAsOf = firstDefined(...chartResults.map((result) => result.data?.as_of).filter(Boolean));
  dom.statsAsOf.textContent = formatDateTime(chartAsOf);
  if (chartAsOf) {
    dom.statsAsOf.dateTime = normalizeText(chartAsOf);
  } else {
    dom.statsAsOf.removeAttribute("datetime");
  }
  if (!scopedResults.length) return;

  const summaryResult = scopedResults.find((result) => (
    Number(sampleCount(result.data?.active) || 0) > 0
      || Number(sampleCount(result.data?.reserved) || 0) > 0
      || Number(sampleCount(result.data?.sold) || 0) > 0
      || Number(sampleCount(result.data?.confirmed_transactions) || 0) > 0
  )) || scopedResults[0];
  const summaryCurrency = summaryResult.cohort.currency;
  const summaryActive = summaryResult.data?.active || {};
  const summaryReserved = summaryResult.data?.reserved || {};
  const summarySold = firstDefined(summaryResult.data?.sold, summaryResult.data?.sold_last_ask, {});
  const summaryConfirmed = firstDefined(summaryResult.data?.confirmed_transactions, summaryResult.data?.confirmed_transaction, summaryResult.data?.transactions, {});
  const multipleSites = summaryResult.data?.selected_site_scope === "multiple";
  renderPriceSummaryRow("active", summaryActive, summaryResult.data, summaryCurrency, multipleSites);
  renderPriceSummaryRow("reserved", summaryReserved, summaryResult.data, summaryCurrency, multipleSites);
  renderPriceSummaryRow("sold", summarySold, summaryResult.data, summaryCurrency, multipleSites);
  renderPriceSummaryRow("confirmed", summaryConfirmed, summaryResult.data, summaryCurrency, multipleSites);
  const asOf = firstDefined(...scopedResults.map((result) => result.data?.as_of).filter(Boolean));
  dom.statsAsOf.textContent = formatDateTime(asOf);
  if (asOf) {
    dom.statsAsOf.dateTime = normalizeText(asOf);
  } else {
    dom.statsAsOf.removeAttribute("datetime");
  }
}

async function requestListingPage(pageNumber, cursor = "") {
  if (!state.selectedProduct && !state.categoryCode && !state.query) return;
  clearTimeout(browseListingTimer);
  browseListingTimer = null;
  const scopeKey = buildListingQuery(cursor).toString();
  state.listingScopeKey = scopeKey;
  state.listingRequest?.abort();
  const controller = new AbortController();
  state.listingRequest = controller;
  dom.listingSection.setAttribute("aria-busy", "true");
  if (pageNumber === 1) {
    state.listings = [];
    renderListings();
    showListingMessage("현재 매물을 불러오는 중입니다.");
  } else {
    showListingMessage(`${pageNumber}페이지 매물을 불러오는 중입니다.`);
  }
  try {
    const payload = await fetchJson(`/api/pc/listings?${scopeKey}`, { signal: controller.signal });
    if (state.listingScopeKey !== scopeKey) return;
    applyListingPayload(payload, pageNumber);
    showListingMessage("");
    if (pageNumber > 1) {
      window.requestAnimationFrame(() => {
        dom.listingPageNumbers.querySelector(`[data-page="${pageNumber}"]`)?.focus({ preventScroll: true });
      });
    }
  } catch (error) {
    if (error.name !== "AbortError") showListingMessage(`현재 매물을 불러오지 못했습니다. ${error.message}`, true);
  } finally {
    if (state.listingRequest === controller) {
      state.listingRequest = null;
      dom.listingSection.removeAttribute("aria-busy");
    }
  }
}

async function loadListings(append = false) {
  if (!append) {
    resetListingPagination();
    return requestListingPage(1);
  }
  const nextPage = state.listingPage + 1;
  const cursor = state.listingPageCursors.get(nextPage);
  if (cursor) return requestListingPage(nextPage, cursor);
}

function digitsOnly(value) {
  return normalizeText(value).replace(/[^0-9]/g, "");
}

function syncCatalogUrl() {
  const url = new URL(window.location.href);
  const categoryRoute = url.pathname.match(/^\/categories\/([a-z-]+)$/u);
  if (state.query) {
    url.pathname = "/";
    url.search = "";
    url.searchParams.set("q", state.query);
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    return;
  }
  for (const key of PRODUCT_QUERY_KEYS) url.searchParams.delete(key);
  url.searchParams.delete("category");
  url.searchParams.delete("category_code");
  url.searchParams.delete("query");
  if (state.categoryCode) {
    if (categoryRoute && !state.query) url.pathname = `/categories/${state.categoryCode.toLowerCase()}`;
    else url.searchParams.set("category_code", state.categoryCode);
  }
  Object.keys(state.facets).forEach((key) => {
    if (!PRODUCT_QUERY_KEYS.has(key)) return;
    selectedFacetValues(key).forEach((value) => url.searchParams.append(key, value));
  });
  url.searchParams.delete("q");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

async function loadCatalog() {
  showCatalogMessage("PC 부품 카탈로그를 불러오는 중입니다.");
  try {
    const catalog = await fetchJson("/api/pc/catalog");
    state.catalog = catalog;
    state.categories = toArray(catalog?.categories).filter((category) => categoryCode(category));
    state.facetSchema = firstDefined(catalog?.facet_schema, catalog?.facetSchema);
    state.browseFlows = normalizeBrowseFlows(firstDefined(catalog?.browse_flow, catalog?.browse_flows));
    state.sources = normalizeSources(catalog?.sources);
    state.sourceCandidates = normalizeSourceCandidates(catalog?.source_candidates);
    state.seedProducts = toArray(firstDefined(catalog?.products, catalog?.public_catalog?.products));
    if (!state.categories.length && state.seedProducts.length) {
      const inferred = [...new Set(state.seedProducts.map(productCategory).filter(Boolean))];
      state.categories = inferred.map((code) => ({ category_code: code, display_name: code }));
    }
    if (!state.categories.length) throw new Error("공개된 부품 카테고리가 없습니다.");
    buildFacetUniverse();

    const initialParams = new URLSearchParams(window.location.search);
    const initialQuery = normalizeText(initialParams.get("q") || "");
    const routeCategory = window.location.pathname.match(/^\/categories\/([a-z-]+)$/u)?.[1]?.toUpperCase();
    const queryCategory = normalizeText(initialParams.get("category_code") || initialParams.get("category")).toUpperCase();
    const initialCategory = state.categories.find((category) => categoryCode(category) === queryCategory)
      || state.categories.find((category) => categoryCode(category) === routeCategory)
      || state.categories[0];
    state.query = initialQuery;
    dom.catalogQuery.value = initialQuery;
    state.categoryCode = initialQuery
      ? ""
      : categoryCode(initialCategory);
    state.facets = {};
    if (state.categoryCode) {
      const categoryFlow = browseFlowForCategory(state.categoryCode);
      categoryFlow.forEach(({ key }) => {
        const requested = initialParams.getAll(key)
          .flatMap((value) => value.split(","))
          .map(normalizeText)
          .filter(Boolean);
        if (requested.length) state.facets[key] = [...new Set(requested)];
      });
      const firstFacet = categoryFlow[0]?.key;
      if (firstFacet) state.openFacetRows.add(firstFacet);
    }
    renderCategories();
    renderFacets();
    updateWorkspaceHeading();
    const version = normalizeText(firstDefined(catalog?.version, catalog?.catalog_version));
    dom.catalogMeta.textContent = version ? `카탈로그 ${version}` : `${state.categories.length}개 부품군`;
    showCatalogMessage("");
    await refreshBrowseScope();
  } catch (error) {
    state.categories = [];
    state.products = [];
    renderCategories();
    renderProducts();
    dom.catalogMeta.textContent = "카탈로그 연결 안 됨";
    dom.workspaceTitle.textContent = "중고 PC 부품 검색";
    showCatalogMessage(`PC 부품 카탈로그를 불러오지 못했습니다. ${error.message}`, true);
    resetDetail();
  }
}

function applyCatalogSearch(rawQuery, force = false) {
  clearTimeout(catalogSearchTimer);
  catalogSearchTimer = null;
  const nextQuery = normalizeText(rawQuery);
  if (!force && nextQuery === state.query) return;
  state.query = nextQuery;
  if (state.query) {
    state.categoryCode = "";
    state.facets = {};
    state.openFacetRows.clear();
    state.expandedFacetOptions.clear();
    renderCategories();
  } else if (!state.categoryCode) {
    state.categoryCode = categoryCode(state.categories[0]);
    const firstFacet = browseFlowForCategory(state.categoryCode)[0]?.key;
    if (firstFacet) state.openFacetRows.add(firstFacet);
    renderCategories();
  }
  syncCatalogUrl();
  updateWorkspaceHeading();
  renderFacets();
  refreshBrowseScope();
}

function scheduleCatalogSearch() {
  clearTimeout(catalogSearchTimer);
  catalogSearchTimer = null;
  if (catalogSearchComposing || !state.categories.length) return;
  const nextQuery = normalizeText(dom.catalogQuery.value);
  if (nextQuery === state.query || (nextQuery && nextQuery.length < 2)) return;
  catalogSearchTimer = window.setTimeout(() => applyCatalogSearch(nextQuery), 350);
}

dom.catalogSearch.addEventListener("submit", (event) => {
  event.preventDefault();
  applyCatalogSearch(dom.catalogQuery.value, true);
});

dom.categorySelect.addEventListener("change", () => selectCategory(dom.categorySelect.value));

dom.catalogQuery.addEventListener("search", () => {
  if (!dom.catalogQuery.value && state.query) {
    applyCatalogSearch("");
  }
});

dom.catalogQuery.addEventListener("input", scheduleCatalogSearch);
dom.catalogQuery.addEventListener("compositionstart", () => {
  catalogSearchComposing = true;
  clearTimeout(catalogSearchTimer);
});
dom.catalogQuery.addEventListener("compositionend", () => {
  catalogSearchComposing = false;
  scheduleCatalogSearch();
});

dom.resetFilters.addEventListener("click", () => {
  clearTimeout(catalogSearchTimer);
  state.facets = {};
  state.openFacetRows.clear();
  state.expandedFacetOptions.clear();
  state.selectedSites.clear();
  state.query = "";
  dom.catalogQuery.value = "";
  if (!state.categoryCode) state.categoryCode = categoryCode(state.categories[0]);
  const firstFacet = browseFlowForCategory(state.categoryCode)[0]?.key;
  if (firstFacet) state.openFacetRows.add(firstFacet);
  syncCatalogUrl();
  renderCategories();
  renderFacets();
  updateWorkspaceHeading();
  refreshBrowseScope();
});

dom.showMatchedModels?.addEventListener("click", () => {
  dom.listingSection.scrollIntoView({ behavior: "smooth", block: "start" });
});
dom.modelSelect.addEventListener("change", () => {
  const product = state.products.find((item) => productId(item) === dom.modelSelect.value);
  if (product) selectProduct(product);
});
dom.sourceMoreToggle.addEventListener("click", () => {
  state.sourceMoreOpen = !state.sourceMoreOpen;
  renderSourceFilters();
  dom.sourceMoreToggle.focus({ preventScroll: true });
});
mobileFacetMedia.addEventListener("change", (event) => {
  renderFacets();
  setListingOptionsCollapsed(event.matches);
});
compactFilterMedia.addEventListener("change", (event) => setModelFiltersCollapsed(event.matches));
dom.modelFilterToggle.addEventListener("click", () => setModelFiltersCollapsed(!state.modelFiltersCollapsed));
dom.listingOptionsToggle.addEventListener("click", () => setListingOptionsCollapsed(!state.listingOptionsCollapsed));
dom.listingPageNumbers.addEventListener("click", (event) => {
  const button = event.target.closest("[data-page]");
  if (!button) return;
  showListingPage(Number(button.dataset.page));
});
dom.listingPagePrev.addEventListener("click", () => showListingPage(state.listingPage - 1));
dom.listingPageNext.addEventListener("click", () => showListingPage(state.listingPage + 1));
dom.listingSortTabs.forEach((button) => {
  button.addEventListener("click", () => {
    const nextSort = button.dataset.sort;
    if (!nextSort || nextSort === state.listingSort) return;
    state.listingSort = nextSort;
    dom.listingSort.value = nextSort;
    syncListingSortTabs();
    reloadListingsForControls();
  });
});
dom.modelDetailClose.addEventListener("click", () => closeModelDetail());
dom.modelDetailDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeModelDetail();
});
dom.modelDetailDialog.addEventListener("click", (event) => {
  if (event.target === dom.modelDetailDialog) closeModelDetail();
});
dom.backToModels.addEventListener("click", () => {
  updateWorkspaceHeading();
  showScopedListings();
  window.requestAnimationFrame(() => dom.modelSelect.focus({ preventScroll: true }));
});

dom.listingControls.addEventListener("submit", (event) => {
  event.preventDefault();
  state.listingSort = dom.listingSort.value || state.listingSort || "recent";
  dom.listingSort.value = state.listingSort;
  syncListingSortTabs();
  state.priceMin = digitsOnly(dom.priceMin.value);
  state.priceMax = digitsOnly(dom.priceMax.value);
  dom.priceMin.value = state.priceMin;
  dom.priceMax.value = state.priceMax;
  reloadListingsForControls();
});

setModelFiltersCollapsed(compactFilterMedia.matches);
setListingOptionsCollapsed(mobileFacetMedia.matches);
syncListingSortTabs();
loadCatalog();
