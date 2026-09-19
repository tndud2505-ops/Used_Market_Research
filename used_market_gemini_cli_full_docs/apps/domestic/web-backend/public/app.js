import { createContextualAffiliate } from "./affiliate.js?v=compact-ad-v2";
import { createAdfitSlot } from "./adfit.js?v=adfit-v2";
import { createListingPricePreview } from "./listing-price-preview.mjs?v=search-modal-v3";

const PRODUCT_QUERY_KEYS = new Set([
  "manufacturer", "model", "gpu_model", "board_brand", "usage", "configuration", "socket", "chipset", "form_interface", "capacity", "purpose", "rated_wattage",
  "chip_manufacturer", "market_segment", "family", "generation", "vram_gb",
  "platform_vendor", "socket", "suffix", "memory_generation", "module_capacity_gb", "form_factor", "ecc", "buffering",
  "chipset", "capacity_bucket", "interface", "protocol", "pcie_generation", "use_class", "recording_technology",
  "watts_bucket", "atx_spec", "modularity", "efficiency", "product_kind", "subtype", "radiator_mm", "fan_mm", "chassis_class",
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
  ]),
  SSD: Object.freeze([
    Object.freeze({ key: "product_kind", label: "제품 종류" }),
    Object.freeze({ key: "capacity_bucket", label: "용량" }),
    Object.freeze({ key: "manufacturer", label: "제조사" }),
  ]),
  HDD: Object.freeze([
    Object.freeze({ key: "placement", label: "설치 방식" }),
    Object.freeze({ key: "capacity_bucket", label: "용량" }),
    Object.freeze({ key: "manufacturer", label: "제조사" }),
  ]),
  PSU: Object.freeze([
    Object.freeze({ key: "watts_bucket", label: "정격 출력" }),
    Object.freeze({ key: "form_factor", label: "크기 규격" }),
    Object.freeze({ key: "manufacturer", label: "제조사" }),
  ]),
});
const mobileFacetMedia = window.matchMedia("(max-width: 760px)");
const compactFilterMedia = window.matchMedia("(max-width: 760px)");
const FILTER_COLUMN_DEFAULT = 224;
let browseListingTimer = null;
let browseGeneration = 0;
let catalogSearchTimer = null;

const state = {
  catalog: null,
  categories: [],
  facetSchema: null,
  browseFlows: {},
  facetUniverse: {},
  availableFacets: null,
  sources: [],
  sourceCandidates: [],
  seedProducts: [],
  categoryCode: "",
  facets: {},
  openFacetRows: new Set(),
  expandedFacetOptions: new Set(),
  selectedSites: new Set(),
  availableSourceCounts: null,
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
  listingTotal: null,
  listingSort: "recent",
  productRequest: null,
  listingRequest: null,
  modelFiltersCollapsed: false,
  returnFocusProductId: "",
};

const dom = {
  catalogMeta: document.querySelector("#catalog-meta"),
  categorySelect: document.querySelector("#category-select"),
  workspaceTitle: document.querySelector("#workspace-title"),
  modelFilters: document.querySelector("#model-filters"),
  workspaceContent: document.querySelector(".workspace-content"),
  resultsFlow: document.querySelector(".results-flow"),
  filterColumnResizer: document.querySelector("#filter-column-resizer"),
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
  resetFilters: document.querySelector("#reset-filters"),
  showMatchedModels: document.querySelector("#show-matched-models"),
  catalogMessage: document.querySelector("#catalog-message"),
  modelSelect: document.querySelector("#model-select"),
  listingSection: document.querySelector("#listing-section"),
  listingTitle: document.querySelector("#listing-title"),
  listingCount: document.querySelector("#listing-count"),
  listingMessage: document.querySelector("#listing-message"),
  backToModels: document.querySelector("#back-to-models"),
  modelDetailOpen: document.querySelector("#model-detail-open"),
  listingSort: document.querySelector("#listing-sort"),
  listingSortTabs: [...document.querySelectorAll(".listing-sort-tab")],
  listingRows: document.querySelector("#listing-rows"),
  listingEmpty: document.querySelector("#listing-empty"),
  listingPagination: document.querySelector("#listing-pagination"),
  listingPageNumbers: document.querySelector("#listing-page-numbers"),
  listingPagePrev: document.querySelector("#listing-page-prev"),
  listingPageNext: document.querySelector("#listing-page-next"),
  adfitBanner: document.querySelector("#adfit-banner"),
};

function clampNumber(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function setupColumnResizer({ resizer, container, target, property, minimum, maximum, defaultValue, direction = 1, flexibleMinimum, onApply }) {
  if (!resizer || !container || !target) return null;
  let value = defaultValue;
  let preferredValue = defaultValue;
  const dynamicMaximum = () => Math.max(minimum, Math.min(maximum, container.clientWidth - flexibleMinimum));
  const apply = (nextValue, remember = true) => {
    value = Math.round(clampNumber(nextValue, minimum, dynamicMaximum()));
    if (remember) preferredValue = value;
    container.style.setProperty(property, `${value}px`);
    resizer.setAttribute("aria-valuenow", String(value));
    resizer.setAttribute("aria-valuemax", String(dynamicMaximum()));
    onApply?.();
  };
  const currentWidth = () => target.getBoundingClientRect().width || value;
  resizer.addEventListener("pointerdown", (event) => {
    if (compactFilterMedia.matches || event.button !== 0) return;
    const startX = event.clientX;
    const startWidth = currentWidth();
    resizer.setPointerCapture(event.pointerId);
    document.body.classList.add("is-resizing-columns");
    const move = (moveEvent) => apply(startWidth + (moveEvent.clientX - startX) * direction);
    const stop = () => {
      document.body.classList.remove("is-resizing-columns");
      resizer.removeEventListener("pointermove", move);
      resizer.removeEventListener("pointerup", stop);
      resizer.removeEventListener("pointercancel", stop);
    };
    resizer.addEventListener("pointermove", move);
    resizer.addEventListener("pointerup", stop);
    resizer.addEventListener("pointercancel", stop);
  });
  resizer.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Home") {
      apply(defaultValue);
      return;
    }
    const step = event.shiftKey ? 48 : 16;
    apply(value + (event.key === "ArrowRight" ? step : -step) * direction);
  });
  resizer.addEventListener("dblclick", () => apply(defaultValue));
  window.addEventListener("resize", () => apply(preferredValue, false));
  apply(defaultValue);
  return { reapply: () => apply(preferredValue, false) };
}

function setupColumnResizers() {
  setupColumnResizer({
    resizer: dom.filterColumnResizer, container: dom.workspaceContent, target: dom.modelFilters,
    property: "--filter-column-width", minimum: 168, maximum: 320,
    defaultValue: FILTER_COLUMN_DEFAULT, flexibleMinimum: 500,
  });
}
const contextualAffiliate = createContextualAffiliate(document.querySelector("#contextual-offer"));
const adfit = createAdfitSlot(dom.adfitBanner);

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
    signal: options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(20000)])
      : AbortSignal.timeout(20000),
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

function productDirectoryNodeType(product) {
  return normalizeText(firstDefined(product?.directory_node_type, product?.key_specs?.directory_node_type,
    product?.spec?.directory_node_type, product?.browse_facets?.directory_node_type)).toUpperCase();
}

function isSelectableModel(product) {
  return productCategory(product) !== "MOTHERBOARD" || productDirectoryNodeType(product) === "PRODUCT";
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

function metricValue(block, keys, fallbackCurrency = "KRW") {
  if (!block || typeof block !== "object") return null;
  for (const key of keys) {
    const price = normalizePrice(block[key], normalizeText(block.currency) || fallbackCurrency);
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

function formatListingTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${date.getMonth() + 1}.${date.getDate()} ${hours}:${minutes}`;
}

function safeHttpsUrl(value) {
  if (typeof value !== "string" || !value.trim()) return "";
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
  contextualAffiliate.clear();
  adfit.setEligible(false);
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
  state.availableSourceCounts = null;
  state.listingTotal = null;
  dom.listingCount.textContent = "";
  dom.listingPageNumbers.replaceChildren();
  dom.listingPagination.hidden = true;
}

function catalogCategoryProducts(category) {
  return state.seedProducts.filter((product) => !category || productCategory(product) === category);
}

function facetOptionLabel(key, value) {
  if (key === "suffix" && value === "NONE") return "일반";
  const capacityLabels = {
    LE_256_GB: "256GB 이하", "257_512_GB": "257~512GB", "513_GB_1_TB": "513GB~1TB",
    GT_1_TB_LE_2_TB: "1TB 초과~2TB", GT_2_TB_LE_4_TB: "2TB 초과~4TB", GT_4_TB_LE_8_TB: "4TB 초과~8TB", GT_8_TB: "8TB 초과",
    LE_1_TB: "1TB 이하", GT_1_TB_LE_2_TB: "1TB 초과~2TB", GT_2_TB_LE_4_TB: "2TB 초과~4TB",
    GT_4_TB_LE_6_TB: "4TB 초과~6TB", GT_6_TB_LE_8_TB: "6TB 초과~8TB", GT_8_TB_LE_12_TB: "8TB 초과~12TB",
    GT_12_TB_LE_16_TB: "12TB 초과~16TB", GT_16_TB_LE_20_TB: "16TB 초과~20TB",
    GT_20_TB_LE_24_TB: "20TB 초과~24TB", GT_24_TB: "24TB 초과",
  };
  const rangeLabels = {
    GE_500GB: "500GB 이상", GE_1TB: "1TB 이상", GE_2TB: "2TB 이상", GE_4TB: "4TB 이상", GE_8TB: "8TB 이상", GE_10TB: "10TB 이상", GE_16TB: "16TB 이상",
    LE_500GB: "500GB 이하", LE_1TB: "1TB 이하", LE_2TB: "2TB 이하", LE_4TB: "4TB 이하",
  };
  if (rangeLabels[value]) return rangeLabels[value];
  const wattsLabels = { LE_500: "500W 이하", "501_650": "501~650W", "651_750": "651~750W", "751_850": "751~850W", "851_1000": "851~1000W", "1001_1200": "1001~1200W", GT_1200: "1200W 초과" };
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
    LE_256_GB: [256], "257_512_GB": [512], "513_GB_1_TB": [1000],
    GT_1_TB_LE_2_TB: [2000], GT_2_TB_LE_4_TB: [4000], GT_4_TB_LE_8_TB: [8000], GT_8_TB: [16000],
    LE_1_TB: [1000], GT_4_TB_LE_6_TB: [6000], GT_6_TB_LE_8_TB: [8000], GT_8_TB_LE_12_TB: [12000],
    GT_12_TB_LE_16_TB: [16000], GT_16_TB_LE_20_TB: [20000], GT_20_TB_LE_24_TB: [24000], GT_24_TB: [26000],
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
  if (state.availableFacets && Object.hasOwn(state.availableFacets, step.key)) {
    return sortFacetOptions(category, step.key, toArray(state.availableFacets[step.key])
      .map((option) => normalizeFacetOption(option, step.key)).filter(Boolean));
  }
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
      { value: "257_512_GB", label: "257~512GB" },
      { value: "513_GB_1_TB", label: "513GB~1TB" },
      { value: "GT_1_TB_LE_2_TB", label: "1TB 초과~2TB" },
      { value: "GT_2_TB_LE_4_TB", label: "2TB 초과~4TB" },
      { value: "GT_4_TB_LE_8_TB", label: "4TB 초과~8TB" },
      { value: "GT_8_TB", label: "8TB 초과" },
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
      { value: "GT_1_TB_LE_2_TB", label: "1TB 초과~2TB" },
      { value: "GT_2_TB_LE_4_TB", label: "2TB 초과~4TB" },
      { value: "GT_4_TB_LE_6_TB", label: "4TB 초과~6TB" },
      { value: "GT_6_TB_LE_8_TB", label: "6TB 초과~8TB" },
      { value: "GT_8_TB_LE_12_TB", label: "8TB 초과~12TB" },
      { value: "GT_12_TB_LE_16_TB", label: "12TB 초과~16TB" },
      { value: "GT_16_TB_LE_20_TB", label: "16TB 초과~20TB" },
      { value: "GT_20_TB_LE_24_TB", label: "20TB 초과~24TB" },
      { value: "GT_24_TB", label: "24TB 초과" },
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
  const placeholder = createElement("option", "", state.query ? "전체 부품 검색" : "부품 선택");
  placeholder.value = "";
  placeholder.selected = !state.categoryCode;
  placeholder.disabled = !state.query;
  dom.categorySelect.append(placeholder);
  state.categories.forEach((category) => {
    const code = categoryCode(category);
    const option = createElement("option", "", categoryLabel(category));
    option.value = code;
    option.selected = state.categoryCode === code;
    dom.categorySelect.append(option);
  });
  dom.categorySelect.disabled = state.categories.length === 0;
  renderCategoryTabs();
}

function renderCategoryTabs() {
  const rail = document.querySelector("#up-category-tabs");
  if (!rail) return;
  const active = document.activeElement;
  const focusCode = rail.contains(active) ? active.dataset.category : null;
  const icons = {
    CPU: 'M7 7h10v10H7zM3 8h4M3 12h4M3 16h4M17 8h4M17 12h4M17 16h4M8 3v4M12 3v4M16 3v4M8 17v4M12 17v4M16 17v4',
    GPU: 'M3 5h18v13H3zM7 18v3M11 18v3M6 9h4v5H6zM14 9h4v5h-4z',
    RAM: 'M3 7h18v10H3zM6 10h3v4H6zM12 10h3v4h-3zM6 17v3M10 17v3M14 17v3M18 17v3',
    MOTHERBOARD: 'M4 3h16v18H4zM7 6h6v6H7zM16 6v8M7 16h10',
    SSD: 'M4 5h16v14H4zM7 8h4v4H7zM14 15h3M7 15h4',
    HDD: 'M5 3h14v18H5zM8 7h8v8H8zM12 11l5 6M8 18h2',
    PSU: 'M3 5h18v14H3zM7 9h6v6H7zM17 8v3M17 14v2',
  };
  rail.replaceChildren();
  for (const category of state.categories) {
    const code = categoryCode(category), button = createElement("button", "up-category-tab");
    button.type = "button"; button.dataset.category = code;
    button.setAttribute("aria-pressed", String(state.categoryCode === code));
    const svg = createSvgElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" });
    svg.append(createSvgElement("path", { d: icons[code] || icons.CPU }));
    button.append(svg, createElement("span", "", categoryLabel(category)));
    button.addEventListener("click", () => selectCategory(code));
    rail.append(button);
  }
  rail.hidden = state.categories.length === 0;
  document.body.classList.toggle("has-category-tabs", !rail.hidden);
  if (focusCode) [...rail.children].find(button => button.dataset.category === focusCode)?.focus({ preventScroll: true });
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
    const listingOnlyFacet = ["product_kind", "placement"].includes(definition.key)
      || (state.categoryCode === "PSU" && definition.key === "form_factor");
    if (!listingOnlyFacet && Number.isFinite(Number(option.count))) {
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
  dom.resetFilters.hidden = !hasSelectedFacets() && !state.query
    && !state.selectedSites.size && !listingPriceControlsActive();
  updateMatchedModelButton();
}

function renderFacets() {
  const active = document.activeElement;
  const focusedFacet = dom.facetRows.contains(active) ? {
    row: active.closest('.model-facet-row')?.dataset.facetRow,
    name: active.name, value: active.value,
    more: active.classList.contains('facet-more'),
  } : null;
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
  const filterOpen = document.querySelector("#up-filter-open");
  if (filterOpen) filterOpen.disabled = dom.modelFilters.hidden;

  updateFacetSelectionUi(definitions);
  renderSourceFilters();
  if (focusedFacet) {
    const row = [...dom.facetRows.querySelectorAll('.model-facet-row')].find(n => n.dataset.facetRow === focusedFacet.row);
    const target = focusedFacet.name
      ? [...(row?.querySelectorAll('input') || [])].find(n => n.name === focusedFacet.name && n.value === focusedFacet.value)
      : row?.querySelector(focusedFacet.more ? '.facet-more' : 'button.facet-disclosure');
    (target || dom.modelFilterToggle)?.focus({ preventScroll: true });
  }
}

function setModelFiltersCollapsed(collapsed) {
  state.modelFiltersCollapsed = Boolean(collapsed);
  dom.modelFilterBody.hidden = state.modelFiltersCollapsed;
  dom.modelFilterToggle.setAttribute("aria-expanded", String(!state.modelFiltersCollapsed));
  dom.modelFilterToggle.textContent = state.modelFiltersCollapsed ? "옵션 전체보기" : "옵션 접기";
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
    dom.sourceFilterSummary.textContent = "국내 전체";
    return;
  }
  const sourceId = [...state.selectedSites][0];
  dom.sourceFilterSummary.textContent = sourceId === "ebay" ? "eBay (USD)" : sourceLabel(sourceId);
}

function reloadListingsForControls(focusSourceValue) {
  syncCatalogUrl();
  updatePriceGraphLink();
  updateFacetSelectionUi();
  renderSourceFilters();
  if (focusSourceValue !== undefined) {
    window.requestAnimationFrame(() => {
      dom.sourceFilters.querySelector(`input[data-value="${CSS.escape(focusSourceValue)}"]`)
        ?.focus({ preventScroll: true });
    });
  }
  if (state.selectedProduct) {
    loadListings(false);
  }
  else if (shouldAutoLoadScopedListings()) loadListings(false);
  else showScopedListings();
}

function renderSourceFilters() {
  const focusedSource = dom.sourceFilters.contains(document.activeElement) ? document.activeElement.dataset.value : undefined;
  dom.sourceFilters.replaceChildren();
  dom.sourceFacetRow.hidden = state.sources.length === 0;
  syncSourceFilterSummary();
  if (!state.sources.length) return;
  const priority = ["joonggonara", "bunjang", "ebay"];
  const compactLabels = {
    joonggonara: "중고나라",
    bunjang: "번개장터",
    hellomarket: "헬로마켓",
    coolenjoy: "쿨엔조이",
    danawa: "다나와 장터",
  };
  const orderedSources = [...state.sources].sort((left, right) => {
    const leftIndex = priority.indexOf(left.id);
    const rightIndex = priority.indexOf(right.id);
    return (leftIndex < 0 ? priority.length : leftIndex) - (rightIndex < 0 ? priority.length : rightIndex);
  });
  const visibleSources = orderedSources.filter((source) => source.id === "ebay" || source.currency === "KRW");
  const appendChoice = (label, value, checked, onChange, count = null) => {
    const choice = createElement("label", "source-choice");
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "listing-source";
    input.checked = checked;
    input.dataset.value = value;
    input.setAttribute("aria-label", Number.isFinite(count) && count > 0 ? `${label} ${count.toLocaleString("ko-KR")}건` : label);
    input.addEventListener("change", onChange);
    choice.append(input, createElement("span", "", label));
    dom.sourceFilters.append(choice);
  };
  appendChoice("국내 전체", "", state.selectedSites.size === 0, () => {
    state.selectedSites.clear();
    reloadListingsForControls("");
  });
  visibleSources.forEach((source) => {
    const count = state.availableSourceCounts ? Number(state.availableSourceCounts[source.id] || 0) : null;
    const label = source.id === "ebay" ? "eBay (USD)" : compactLabels[source.id] || source.label;
    appendChoice(label, source.id, state.selectedSites.has(source.id), () => {
      state.selectedSites.clear();
      state.selectedSites.add(source.id);
      reloadListingsForControls(source.id);
    }, count);
  });
  if (focusedSource !== undefined) {
    [...dom.sourceFilters.querySelectorAll('input')].find(input => input.dataset.value === focusedSource)?.focus({ preventScroll: true });
  }
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
  const nextCode = normalizeText(code).toUpperCase();
  if (!nextCode && !state.query) return;
  if (nextCode === state.categoryCode) return;
  state.categoryCode = nextCode;
  state.facets = {};
  state.openFacetRows.clear();
  state.expandedFacetOptions.clear();
  resetListingControls();
  const firstFacet = state.categoryCode ? browseFlowForCategory(state.categoryCode)[0]?.key : "";
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
  dom.workspaceTitle.textContent = heading;
  const queryInput = document.querySelector("#catalog-query");
  if (queryInput && document.activeElement !== queryInput) queryInput.value = state.query;
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
  const selectableProducts = state.products.filter(isSelectableModel);
  const total = selectableProducts.length;
  dom.modelSelect.replaceChildren();
  const placeholder = createElement("option", "", total
    ? `전체 모델 · ${total.toLocaleString("ko-KR")}개`
    : "검색된 모델 없음");
  placeholder.value = "";
  dom.modelSelect.append(placeholder);
  selectableProducts.forEach((product) => {
    const option = createElement("option", "", `${productName(product)} · ${productSpecText(product)}`);
    option.value = productId(product);
    option.selected = option.value === selectedId;
    dom.modelSelect.append(option);
  });
  dom.modelSelect.disabled = selectableProducts.length === 0;
  if (!selectedId) dom.modelSelect.value = "";
  // Model count is not listing count. Keep the results region for every state.
  dom.listingSection.hidden = false;
  updatePriceGraphLink();
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
  const selectableProducts = state.products.filter(isSelectableModel);
  if (selectableProducts.length !== 1 || state.productTotal !== 1) return false;
  selectProduct(selectableProducts[0]);
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
  state.availableFacets = null;
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
    if (controller.signal.aborted || state.productRequest !== controller) return;
    state.products = items;
    const responseTotal = Number(firstDefined(nestedProducts?.total, payload?.total));
    state.productTotal = Number.isFinite(responseTotal)
      ? responseTotal
      : items.length;
    state.availableFacets = payload?.available_facets && typeof payload.available_facets === "object"
      ? payload.available_facets
      : null;
    renderFacets();
    renderProducts();
    showCatalogMessage("");
    openSingleSearchResult();
  } catch (error) {
    if (error.name === "AbortError" || controller.signal.aborted || state.productRequest !== controller) return;
    const fallback = filterSeedProducts();
    if (fallback.length) {
      state.products = fallback;
      state.productTotal = fallback.length;
      state.productCursor = "";
      state.availableFacets = null;
      renderFacets();
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
  state.selectedProduct = null;
  state.listings = [];
  resetListingPagination();
  state.listingScopeKey = "";
  document.body.classList.remove("has-selected-product");
  dom.listingSection.hidden = false;
  dom.backToModels.hidden = true;
  dom.modelDetailOpen.hidden = true;
  dom.listingRows.replaceChildren();
  dom.listingEmpty.hidden = true;
  showListingMessage("");
  renderProducts();
}

function currentListingScopeTitle() {
  const modelCount = Number.isFinite(Number(state.productTotal)) && Number(state.productTotal) > 0
    ? ` · 모델 ${Number(state.productTotal).toLocaleString("ko-KR")}개`
    : "";
  if (state.query) return `“${state.query}” 검색 매물${modelCount}`;
  const category = state.categories.find((item) => categoryCode(item) === state.categoryCode);
  const selected = Object.entries(state.facets)
    .flatMap(([key]) => selectedFacetValues(key).map((value) => facetOptionLabel(key, value)))
    .slice(0, 3);
  const scope = [category ? categoryLabel(category) : "PC 부품", ...selected].join(" · ");
  return `${scope} 현재 매물${modelCount}`;
}

function shouldAutoLoadScopedListings() {
  if (state.selectedProduct) return true;
  const total = Number.isFinite(Number(state.productTotal)) ? Number(state.productTotal) : state.products.length;
  return total > 0;
}

function showScopedListings(listingDelayMs = 0) {
  resetDetail();
  dom.listingTitle.textContent = "검색 결과";
  dom.listingEmpty.textContent = state.productTotal
    ? "선택한 조건에 맞는 현재 매물이 없습니다."
    : "선택한 조건에 맞는 모델이 없습니다.";
  syncCatalogUrl();
  updatePriceGraphLink();
  if (!shouldAutoLoadScopedListings()) {
    dom.listingCount.textContent = "0건";
    dom.listingEmpty.hidden = false;
    renderListingPagination();
    return;
  }
  if (listingDelayMs > 0) {
    showListingMessage("현재 매물을 불러오는 중입니다.");
    browseListingTimer = window.setTimeout(() => { browseListingTimer = null; loadListings(false); }, listingDelayMs);
  } else loadListings(false);
}

async function refreshBrowseScope(listingDelayMs = 0) {
  const generation = ++browseGeneration;
  state.products = [];
  state.productTotal = 0;
  resetDetail();
  syncCatalogUrl();
  await loadProducts();
  if (generation !== browseGeneration || state.selectedProduct) return;
  showScopedListings(listingDelayMs);
}

function updatePriceGraphLink() {
  const product = pricePreviewProduct();
  dom.modelDetailOpen.hidden = !product;
  if (!product) { dom.modelDetailOpen.removeAttribute("aria-label"); return; }
  dom.modelDetailOpen.setAttribute("aria-label", productName(product) + " 가격 그래프 보기");
}

function pricePreviewProduct() {
  const candidates = state.products.filter(isSelectableModel);
  return state.selectedProduct || (state.productTotal === 1 && candidates.length === 1 ? candidates[0] : null);
}

function revealSection(section) {
  const headerHeight = document.querySelector(".site-header")?.getBoundingClientRect().height || 0;
  section.style.scrollMarginTop = `${Math.ceil(headerHeight) + 12}px`;
  section.scrollIntoView({
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    block: "start",
  });
}

function listingPriceControlsActive() {
  return state.listingSort !== "recent";
}

function listingSourceScope() {
  if (state.selectedSites.size) return state.sources.filter((source) => state.selectedSites.has(source.id));
  const domesticSources = state.sources.filter((source) => source.currency === "KRW");
  return domesticSources;
}

function listingCurrencyScope() {
  if (!state.selectedSites.size) return "KRW";
  const currencies = [...new Set(listingSourceScope().map((source) => source.currency).filter(Boolean))];
  if (currencies.length === 1) return currencies[0];
  return listingPriceControlsActive() && currencies.includes("KRW") ? "KRW" : "";
}

function selectProduct(product) {
  if (!productId(product) || !isSelectableModel(product)) return;
  cancelListingRequest();
  state.returnFocusProductId = productId(product);
  state.selectedProduct = product;
  document.body.classList.add("has-selected-product");
  state.listings = [];
  resetListingPagination();
  state.listingScopeKey = "";
  dom.listingTitle.textContent = "검색 결과";
  dom.listingSection.hidden = false;
  dom.backToModels.hidden = false;
  dom.backToModels.textContent = "← 전체 모델";
  dom.backToModels.setAttribute("aria-label", "전체 조건 매물로 돌아가기");
  dom.listingRows.replaceChildren();
  dom.listingEmpty.hidden = true;
  dom.listingEmpty.textContent = "이 모델의 현재 매물이 없습니다.";
  syncCatalogUrl();
  renderProducts();
  loadListings(false);
  // Selection changes only the listing scope. Never open a graph, shift focus,
  // or scroll away while a user is typing or operating the model selector.
}

function buildListingQuery(cursor = "") {
  const params = new URLSearchParams();
  params.set("limit", "10");
  if (state.selectedProduct) {
    params.set("canonical_product_id", productId(state.selectedProduct));
  } else {
    if (state.categoryCode) params.set("category_code", state.categoryCode);
    if (state.query) params.set("q", state.query);
  }
  const listingFacetKeys = new Set(state.categoryCode === "SSD" ? ["product_kind"]
    : state.categoryCode === "HDD" ? ["placement"]
      : state.categoryCode === "PSU" ? ["form_factor"] : []);
  Object.keys(state.facets).sort().forEach((key) => {
    if (!PRODUCT_QUERY_KEYS.has(key) || (state.selectedProduct && !listingFacetKeys.has(key))) return;
    selectedFacetValues(key).sort().forEach((value) => params.append(key, value));
  });
  if (state.listingSort) params.set("sort", state.listingSort);
  const sourceScope = listingSourceScope();
  const sourceIds = sourceScope.map((source) => source.id).filter(Boolean);
  if (sourceIds.length && sourceIds.length < state.sources.length) params.set("sites", sourceIds.join(","));
  const marketPools = [...new Set(sourceScope.flatMap((source) => source.marketPools).filter(Boolean))];
  const currencyScope = listingCurrencyScope();
  if (currencyScope) params.set("currency", currencyScope);
  if (marketPools.length === 1) params.set("market_pool", marketPools[0]);
  if (cursor) params.set("cursor", cursor);
  return params;
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
  if (pageNumber === 1) {
    const rawCounts = firstDefined(payload?.source_counts, payload?.sourceCounts, {});
    state.availableSourceCounts = rawCounts && typeof rawCounts === "object" && !Array.isArray(rawCounts) ? rawCounts : null;
    const sourceTotal = state.availableSourceCounts
      ? Object.values(state.availableSourceCounts).reduce((total, count) => total + Math.max(0, Number(count) || 0), 0)
      : 0;
    const explicitTotal = Number(firstDefined(payload?.total, payload?.total_count, payload?.totalCount));
    state.listingTotal = Number.isFinite(explicitTotal) && explicitTotal >= 0 ? explicitTotal : sourceTotal || items.length;
    dom.listingCount.textContent = Number.isFinite(state.listingTotal) ? `${state.listingTotal.toLocaleString("ko-KR")}건` : "";
    renderSourceFilters();
  }
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

function listingMarketLabel(listing) {
  const marketPool = normalizeText(listing?.market_pool).toUpperCase();
  return ({
    KR_C2C_USED: "개인 중고",
    KR_DEALER_USED: "업자 중고",
    KR_REFURB_RETAIL: "리퍼비시",
    OVERSEAS_USED: "해외 중고",
  })[marketPool] || "";
}

function listingFavoriteStorageKey(listing) {
  return `used-pick:favorite:${encodeURIComponent(listingIdentity(listing))}`;
}

function listingFavoriteState(listing) {
  try {
    return window.localStorage.getItem(listingFavoriteStorageKey(listing)) === "1";
  } catch {
    return false;
  }
}

function renderFavoriteButton(button, listing, titleText, isFavorite) {
  button.replaceChildren();
  button.classList.toggle("is-active", isFavorite);
  button.setAttribute("aria-pressed", String(isFavorite));
  button.setAttribute("aria-label", `${titleText} ${isFavorite ? "이 브라우저 관심 해제" : "이 브라우저에 관심 저장"}`);
  const icon = createSvgElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" });
  icon.append(createSvgElement("path", {
    d: "M12 3.7 14.55 8.9l5.73.83-4.14 4.03.98 5.7L12 16.77 6.88 19.46l.98-5.7-4.14-4.03 5.73-.83L12 3.7Z",
  }));
  button.append(icon);
  button.title = isFavorite ? "이 브라우저 관심 해제" : "이 브라우저에 관심 저장";
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
    const sourceId = normalizeText(firstDefined(listing.source_id, listing.site, listing.source));
    const source = createElement("span", "listing-source", sourceLabel(sourceId));
    source.dataset.source = sourceId;
    const postedAtRaw = firstDefined(listing.posted_at, listing.created_at);
    const observedAtRaw = firstDefined(listing.observed_at, listing.updated_at);
    const listingTime = formatListingTime(firstDefined(postedAtRaw, observedAtRaw));
    const title = createElement(url ? "a" : "span", "listing-title", titleText);
    if (url) {
      title.href = url;
      title.target = "_blank";
      title.rel = "noopener noreferrer";
    }
    body.append(title);
    const listingProduct = state.selectedProduct
      || state.products.find((product) => productId(product) === normalizeText(listing.canonical_product_id));
    const specText = listingProduct ? productSpecText(listingProduct) : "";
    if (specText && specText !== "—") body.append(createElement("div", "listing-spec", specText));
    const meta = createElement("div", "listing-meta");
    const canonicalModel = normalizeText(listing.canonical_display_name);
    const canonicalProductId = normalizeText(listing.canonical_product_id);
    const listingNodeType = normalizeText(firstDefined(listing.directory_node_type,
      listingProduct?.key_specs?.directory_node_type)).toUpperCase();
    const exactMotherboardModel = state.categoryCode !== "MOTHERBOARD" || listingNodeType === "PRODUCT";
    if (!state.selectedProduct && (canonicalModel || state.categoryCode === "MOTHERBOARD")) {
      if (canonicalProductId && exactMotherboardModel) {
        const modelAction = createElement("button", "listing-model listing-model-action", canonicalModel);
        modelAction.type = "button";
        modelAction.setAttribute("aria-label", `${canonicalModel} 매물만 보기`);
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
        const boardSpec = listing.public_classification || listingProduct?.key_specs || {};
        const unresolvedLabel = state.categoryCode === "MOTHERBOARD"
          ? ["모델 미확인", firstDefined(listing.canonical_manufacturer, listing.manufacturer, listingProduct?.brand), boardSpec.chipset]
            .map(normalizeText).filter(Boolean).join(" · ")
          : canonicalModel;
        meta.append(createElement("span", "listing-model", unresolvedLabel));
      }
    }
    meta.append(source);
    const lifecycle = normalizeText(firstDefined(listing.lifecycle_status, listing.status, listing.availability)).toUpperCase();
    if (lifecycle === "RESERVED") meta.append(createElement("span", "listing-state", listingConditionLabel(lifecycle)));
    const marketLabel = listingMarketLabel(listing);
    if (marketLabel) meta.append(createElement("span", "listing-market", marketLabel));
    const quantity = Math.max(1, Number(firstDefined(listing?.quantity, 1)) || 1);
    if (quantity > 1) meta.append(createElement("span", "listing-scope", listingScopeLabel(listing)));
    if (meta.childElementCount) body.append(meta);
    const commerce = createElement("div", "listing-commerce");
    commerce.append(createElement("span", "listing-price", listingPrice(listing)));
    commerce.append(createElement("span", `listing-sale-state ${lifecycle === "RESERVED" ? "is-reserved" : "is-active"}`, listingConditionLabel(lifecycle || "ACTIVE")));
    if (listingTime) {
      const time = createElement("time", "listing-time", postedAtRaw ? listingTime : `확인 ${listingTime}`);
      time.title = postedAtRaw ? "등록 시각" : "최근 확인 시각";
      const machineTime = normalizeText(firstDefined(postedAtRaw, observedAtRaw));
      if (machineTime) time.dateTime = machineTime;
      commerce.append(time);
    }
    const favorite = createElement("button", "listing-favorite");
    favorite.type = "button";
    let isFavorite = listingFavoriteState(listing);
    renderFavoriteButton(favorite, listing, titleText, isFavorite);
    favorite.addEventListener("click", () => {
      isFavorite = !isFavorite;
      try {
        if (isFavorite) window.localStorage.setItem(listingFavoriteStorageKey(listing), "1");
        else window.localStorage.removeItem(listingFavoriteStorageKey(listing));
      } catch {
        isFavorite = false;
      }
      renderFavoriteButton(favorite, listing, titleText, isFavorite);
    });
    row.append(media, body, commerce, favorite);
    dom.listingRows.append(row);
  });
  dom.listingEmpty.hidden = visibleListings.length > 0;
  renderListingPagination();
  adfit.setEligible(visibleListings.length > 0);
  void contextualAffiliate.update({
    hasResults: visibleListings.length > 0,
    canonical_product_id: state.selectedProduct ? productId(state.selectedProduct) : "",
    category_code: state.selectedProduct ? productCategory(state.selectedProduct) || state.categoryCode : state.categoryCode,
  });
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
      // A user can start typing before the next frame. Do not steal their
      // focus back to a pagination button that is about to disappear.
      if (document.activeElement !== document.body && !dom.listingPagination.contains(document.activeElement)) return;
      dom.listingPageNumbers.querySelector(`[data-page="${pageNumber}"]`)?.focus({ preventScroll: true });
    });
    return;
  }

  const cursor = state.listingPageCursors.get(pageNumber);
  if (!cursor) return;
  await requestListingPage(pageNumber, cursor);
}

function createSvgElement(tag, attributes = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, String(value)));
  return element;
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
    dom.listingEmpty.hidden = true;
    showListingMessage("현재 매물을 불러오는 중입니다.");
  } else {
    showListingMessage(`${pageNumber}페이지 매물을 불러오는 중입니다.`);
  }
  try {
    const payload = await fetchJson(`/api/pc/listings?${scopeKey}`, { signal: controller.signal });
    if (controller.signal.aborted || state.listingRequest !== controller || state.listingScopeKey !== scopeKey) return;
    applyListingPayload(payload, pageNumber);
    showListingMessage("");
    if (pageNumber > 1) {
      window.requestAnimationFrame(() => {
        if (document.activeElement !== document.body && !dom.listingPagination.contains(document.activeElement)) return;
        dom.listingPageNumbers.querySelector(`[data-page="${pageNumber}"]`)?.focus({ preventScroll: true });
      });
    }
  } catch (error) {
    if (!controller.signal.aborted && state.listingRequest === controller) {
      dom.listingEmpty.hidden = true;
      showListingMessage(`현재 매물을 불러오지 못했습니다. ${error.message}`, true);
    }
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

function resetListingControls() {
  state.listingSort = "recent";
  syncListingSortTabs();
}

function showAllModels() {
  updateWorkspaceHeading();
  showScopedListings();
}

function syncCatalogUrl() {
  const url = new URL(window.location.href);
  const categoryRoute = url.pathname.match(/^\/categories\/([a-z-]+)$/u);
  url.search = "";
  if (state.query) url.pathname = "/";
  else if (categoryRoute && state.categoryCode) url.pathname = "/categories/" + state.categoryCode.toLowerCase();
  if (state.categoryCode) url.searchParams.set("category_code", state.categoryCode);
  if (state.query) url.searchParams.set("q", state.query);
  for (const key of Object.keys(state.facets)) {
    if (PRODUCT_QUERY_KEYS.has(key)) selectedFacetValues(key).forEach(value => url.searchParams.append(key, value));
  }
  if (state.selectedProduct) url.searchParams.set("model_id", productId(state.selectedProduct));
  const source = [...state.selectedSites][0];
  if (source) url.searchParams.set("sites", source);
  if (state.listingSort !== "recent") url.searchParams.set("sort", state.listingSort);
  window.history.replaceState({}, "", url.pathname + url.search + url.hash);
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
    const requestedCategory = state.categories.find((category) => categoryCode(category) === queryCategory)
      || state.categories.find((category) => categoryCode(category) === routeCategory);
    const initialCategory = requestedCategory || state.categories[0];
    const requestedSource = initialParams.get("sites");
    if (state.sources.some(source => source.id === requestedSource)) state.selectedSites.add(requestedSource);
    if (["recent", "price_asc", "price_desc"].includes(initialParams.get("sort"))) state.listingSort = initialParams.get("sort");
    syncListingSortTabs();
    state.query = initialQuery;
    state.categoryCode = initialQuery && !requestedCategory ? "" : categoryCode(initialCategory);
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
    const requestedModel = initialParams.get("model_id");
    if (requestedModel) {
      const product = state.products.find((item) => productId(item) === requestedModel);
      if (product) selectProduct(product);
    }
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
    state.facets = {};
    state.openFacetRows.clear();
    state.expandedFacetOptions.clear();
    const firstFacet = state.categoryCode ? browseFlowForCategory(state.categoryCode)[0]?.key : "";
    if (firstFacet) state.openFacetRows.add(firstFacet);
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

dom.categorySelect.addEventListener("change", () => selectCategory(dom.categorySelect.value));

dom.resetFilters.addEventListener("click", () => {
  clearTimeout(catalogSearchTimer);
  state.facets = {};
  state.openFacetRows.clear();
  state.expandedFacetOptions.clear();
  state.selectedSites.clear();
  resetListingControls();
  state.query = "";
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
  document.querySelector("#up-filter-dialog")?.close();
  requestAnimationFrame(() => revealSection(dom.listingSection));
});
dom.modelSelect.addEventListener("change", () => {
  if (!dom.modelSelect.value) {
    showAllModels();
    return;
  }
  const product = state.products.find((item) => productId(item) === dom.modelSelect.value);
  if (product) selectProduct(product);
});
mobileFacetMedia.addEventListener("change", (event) => {
  renderFacets();
});
compactFilterMedia.addEventListener("change", (event) => setModelFiltersCollapsed(event.matches));
dom.modelFilterToggle.addEventListener("click", () => setModelFiltersCollapsed(!state.modelFiltersCollapsed));
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
dom.backToModels.addEventListener("click", () => {
  showAllModels();
  window.requestAnimationFrame(() => dom.modelSelect.focus({ preventScroll: true }));
});

const pricePreview = createListingPricePreview(document.querySelector("#listing-price-dialog"), dom.modelDetailOpen);
dom.modelDetailOpen.addEventListener("click", () => {
  const product = pricePreviewProduct();
  if (product) pricePreview.open(product, [...state.selectedSites][0] || "");
});

function setupConceptAControls() {
  const dialog = document.querySelector("#up-filter-dialog"), slot = document.querySelector("#up-filter-slot");
  const opener = document.querySelector("#up-filter-open");
  if (dialog && slot && opener) {
    const home = document.createComment("filter panel home");
    dom.modelFilters.before(home);
    opener.addEventListener("click", () => {
      if (dom.modelFilters.hidden || dialog.open) return;
      slot.append(dom.modelFilters);
      setModelFiltersCollapsed(false);
      dialog.showModal();
    });
    dialog.addEventListener("close", () => {
      home.after(dom.modelFilters);
      setModelFiltersCollapsed(compactFilterMedia.matches);
      if (compactFilterMedia.matches) opener.focus({ preventScroll: true });
    });
    document.querySelector("#up-filter-close")?.addEventListener("click", () => dialog.close());
    document.querySelector("#up-filter-done")?.addEventListener("click", () => {
      dialog.close();
      requestAnimationFrame(() => revealSection(dom.listingSection));
    });
    compactFilterMedia.addEventListener("change", event => { if (!event.matches && dialog.open) dialog.close(); });
  }
}

setupConceptAControls();
setModelFiltersCollapsed(compactFilterMedia.matches);
syncListingSortTabs();
setupColumnResizers();
loadCatalog();
