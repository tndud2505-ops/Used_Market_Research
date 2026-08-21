import { TARGET_SITES, normalizeTargetSites } from "./target-sites.mjs";
import { categoryIdsFromBody, filterCategoryItems, isCategoryExcluded, isKeywordCategoryNoise } from "./category-filter.mjs";
import { hasOfficialCategory, sourceCategoryIds } from "./category-source-map.mjs";

const LIVE_CACHE_TTL_SECONDS = 300;
const LIVE_REQUEST_TIMEOUT_MS = 8_000;
// The browser still receives 30 items per page. Searches start at 160 verified
// items per source and can deepen in 160-item steps only when the user reaches
// the end of the stored result window.
const SITE_RESULT_WINDOW_INITIAL = 160;
const SITE_RESULT_WINDOW_MAX = 640;
const LIVE_LIMIT_MAX = SITE_RESULT_WINDOW_MAX * Math.max(TARGET_SITES.length, 1);
const LIVE_RETRY_MAX_ATTEMPTS = 2;
const LIVE_RETRY_BASE_DELAY_MS = 500;
const SOURCE_CACHE_TTL_MS = 300_000;
const SOURCE_STALE_CACHE_TTL_MS = 15 * 60_000;
const SOURCE_CACHE_MAX_ENTRIES = 256;
const SOURCE_COOLDOWN_MS = Object.freeze({ rethinkmall: 450 });
const SOURCE_PARSE_MAX_ITEMS = 1_280;
const SOURCE_CANDIDATE_MAX_ITEMS = SITE_RESULT_WINDOW_MAX;
const SOURCE_CANDIDATE_MIN_ITEMS = SITE_RESULT_WINDOW_INITIAL;
const PRICE_MAX_WON = 100_000_000_000;

// Each upstream market has a different failure mode. C2C markets need a
// freshness window, while RethinkMall is retailer inventory and must not be
// rejected merely because its product page is old.
const SITE_SEARCH_POLICIES = Object.freeze({
  bunjang: Object.freeze({ minimumPrice: 500, priceMaxAgeDays: 60, recommendedMaxAgeDays: 30 }),
  joonggonara: Object.freeze({ minimumPrice: 1_000, priceMaxAgeDays: 45, recommendedMaxAgeDays: 21 }),
  hellomarket: Object.freeze({ minimumPrice: 500, priceMaxAgeDays: 90, recommendedMaxAgeDays: 45 }),
  rethinkmall: Object.freeze({ minimumPrice: 100, priceMaxAgeDays: null, recommendedMaxAgeDays: null }),
});

const SOURCE_NAMES = Object.freeze({
  joonggonara: "중고나라",
  bunjang: "번개장터",
  ebay: "eBay",
  hellomarket: "Hello Market",
  rethinkmall: "RethinkMall"
});

const SUPPORTED_LIVE_SITES = new Set(["bunjang", "joonggonara", "hellomarket", "rethinkmall"]);
// Some official source categories are intentionally broad (for example,
// Joongna's mobile category includes memory cards and its furniture category
// includes desk accessories). For these categories, a title signal is safer
// than trusting the source bucket alone.
const STRICT_OFFICIAL_TITLE_CATEGORIES = new Set(["mobile", "furniture", "games"]);
const sourceSearchCache = new Map();
const sourceSearchInflight = new Map();
const sourceRequestNextAllowed = new Map();
const sourceCooldownChains = new Map();

const CATEGORY_QUERIES = Object.freeze({
  fashion: "패션의류",
  fashion_women: "여성",
  fashion_men: "남성",
  fashion_women_outer: "여성 아우터",
  fashion_women_tops: "여성 상의",
  fashion_women_bottoms: "여성 바지",
  fashion_women_skirts: "여성 치마",
  fashion_men_outer: "남성 아우터",
  fashion_men_tops: "남성 상의",
  fashion_men_bottoms: "남성 바지",
  fashion_men_jumpsuit: "남성 점프수트",
  fashion_goods: "패션잡화",
  luxury: "수입명품",
  beauty: "뷰티",
  kids: "유아",
  mobile: "스마트폰 태블릿",
  appliances: "가전",
  pc: "컴퓨터 PC",
  camera: "카메라",
  furniture: "가구",
  living: "생활",
  games: "게임기",
  hobby: "취미",
  books: "책",
  tickets: "티켓",
  sports: "스포츠",
  travel: "레저 여행",
  vehicles: "중고차",
  motorcycle: "오토바이",
  tools: "공구 산업용품",
  free_share: "무료나눔"
});

function clean(value, maximum = 1000) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maximum) : "";
}

function categoryQueryValue(categoryId) {
  if (categoryId === "fashion_women_skirts") return "\uC5EC\uC131 \uCE58\uB9C8";
  return CATEGORY_QUERIES[categoryId] || categoryId;
}

function absoluteUrl(value, base) {
  if (!value) return "";
  try {
    const normalized = String(value).replace(/\?\[object(?:%20|\s)Object\]$/i, "");
    const url = new URL(normalized, base);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function isLikelyProductImage(value) {
  return Boolean(value) && !/(header|icon|ico[_/]|placeholder|empty|default|logo|arrow|search|filter|bell|tag\/|ad[_/-]?badge|badge[_/-]?ad)/i.test(String(value));
}

function parsePrice(value) {
  if (value === null || value === undefined) return null;
  const digits = String(value).replace(/[^\d]/g, "");
  if (!digits) return null;
  const parsed = Number(digits);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parseTimestamp(value, assumedOffsetMinutes = null) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value < 10_000_000_000 ? value * 1000 : value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const valueText = clean(value, 80);
  if (!valueText) return null;
  if (/^(?:방금|조금)\s*전$/.test(valueText)) return new Date().toISOString();
  if (valueText === "어제") return new Date(Date.now() - 86_400_000).toISOString();
  const relativeMatch = valueText.match(/^(\d+)\s*(초|분|시간|일|주|개월|달|년)\s*전$/);
  if (relativeMatch) {
    const amount = Number(relativeMatch[1]);
    const unit = relativeMatch[2];
    const date = new Date();
    if (unit === "개월" || unit === "달") date.setMonth(date.getMonth() - amount);
    else if (unit === "년") date.setFullYear(date.getFullYear() - amount);
    else {
      const unitMs = { 초: 1_000, 분: 60_000, 시간: 3_600_000, 일: 86_400_000, 주: 604_800_000 }[unit];
      date.setTime(date.getTime() - amount * unitMs);
    }
    return date.toISOString();
  }
  let dateText = valueText.includes("T") ? valueText : valueText.replace(" ", "T");
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateText)) dateText = `${dateText}T00:00:00`;
  if (Number.isFinite(assumedOffsetMinutes) && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(dateText)) {
    const offset = Math.abs(Number(assumedOffsetMinutes));
    const sign = Number(assumedOffsetMinutes) >= 0 ? "+" : "-";
    dateText += `${sign}${String(Math.floor(offset / 60)).padStart(2, "0")}:${String(offset % 60).padStart(2, "0")}`;
  }
  const date = new Date(dateText);
  return Number.isNaN(date.getTime()) ? valueText : date.toISOString();
}

function categoryQuery(body) {
  const ids = [...new Set([
    ...(Array.isArray(body?.category_ids) ? body.category_ids : []),
    body?.category_id
  ].map((value) => clean(value, 80)).filter((value) => value && value !== "all"))].sort();
  const keyword = clean(body?.keyword, 80);
  const categoryKeywords = ids.map(categoryQueryValue).join(" ");
  return [keyword, categoryKeywords].filter(Boolean).join(" ");
}

export function categorySearchIds(body) {
  const ids = categoryIdsFromBody(body);
  return ids.length ? ids : ["all"];
}

function requestedSites(body) {
  const values = Array.isArray(body?.sites) ? body.sites : TARGET_SITES;
  const sites = normalizeTargetSites(values);
  const categoryIds = categoryIdsFromBody(body);
  if (!categoryIds.length) return sites;
  const hasExplicitKeyword = Boolean(clean(body?.keyword, 80));
  // Category-only browsing stays on verified source category paths. When the
  // user supplied a keyword, search-only sites can still participate and the
  // normalized result set is category-filtered after collection.
  return sites.filter((site) => (
    categoryIds.every((categoryId) => hasOfficialCategory(site, categoryId))
    || (hasExplicitKeyword && (site === "hellomarket" || site === "rethinkmall"))
  ));
}

function requestedViewSites(body) {
  const collectionSites = requestedSites(body);
  if (!Array.isArray(body?.view_sites) || body.view_sites.length === 0) return collectionSites;
  const viewSites = normalizeTargetSites(body.view_sites).filter((site) => collectionSites.includes(site));
  if (!viewSites.length) throw new Error("view_sites must include at least one selected site");
  return viewSites;
}

function requestedCollectionSites(body) {
  const collectionSites = requestedSites(body);
  if (body?.collect_view !== true && body?.expand_index !== true) return collectionSites;
  if (!Array.isArray(body?.focus_sites) || body.focus_sites.length === 0) return collectionSites;
  const focusSites = normalizeTargetSites(body.focus_sites).filter((site) => collectionSites.includes(site));
  if (!focusSites.length) throw new Error("focus_sites must include at least one selected site");
  return focusSites;
}

function requestedAcquisitionMode() {
  return "recent";
}

function buildCollectionRequest(body, canonicalKeyword, limit) {
  const acquisitionMode = requestedAcquisitionMode(body);
  return {
    ...body,
    keyword: canonicalKeyword || body?.keyword,
    sites: requestedCollectionSites(body),
    sort: acquisitionMode,
    min_price: acquisitionMode === "price_asc" ? body?.min_price : undefined,
    max_price: acquisitionMode === "price_asc" ? body?.max_price : undefined,
    limit,
    cursor: undefined
  };
}

function requestedLimit(body) {
  const value = Number(body?.limit);
  return Math.min(Number.isInteger(value) && value > 0 ? value : 24, LIVE_LIMIT_MAX);
}

function requestedSiteWindow(body) {
  const value = Number(body?.site_window);
  return Number.isInteger(value) && value > 0
    ? Math.min(value, SITE_RESULT_WINDOW_MAX)
    : SITE_RESULT_WINDOW_INITIAL;
}

function requestedSort(body) {
  const value = clean(body?.sort, 40) || "recommended";
  if (value !== "recommended" && value !== "price_asc" && value !== "price_desc" && value !== "recent") {
    throw new Error("sort must be recommended, price_asc, price_desc or recent");
  }
  return value;
}

function requestedPriceRange(body) {
  const parseBound = (key) => {
    const raw = body?.[key];
    if (raw === undefined || raw === null || raw === "") return null;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 0 || value > PRICE_MAX_WON) {
      throw new Error(`${key} must be an integer between 0 and ${PRICE_MAX_WON}`);
    }
    return value;
  };
  const min = parseBound("min_price");
  const max = parseBound("max_price");
  if (min !== null && max !== null && min > max) {
    throw new Error("min_price must be less than or equal to max_price");
  }
  return { min, max };
}

function priceInRange(item, priceRange) {
  if (priceRange.min === null && priceRange.max === null) return true;
  const price = Number(item?.price);
  return Number.isFinite(price)
    && (priceRange.min === null || price >= priceRange.min)
    && (priceRange.max === null || price <= priceRange.max);
}

function filterItemsByPriceRange(items, priceRange) {
  if (!Array.isArray(items) || (priceRange.min === null && priceRange.max === null)) return items;
  const filtered = items.filter((item) => priceInRange(item, priceRange));
  for (const key of ["received_count", "partial_error", "partial_notice", "suggested_items", "suggested_keyword", "stale_cache"]) {
    if (Object.hasOwn(items, key)) filtered[key] = items[key];
  }
  filtered.price_range_removed_count = (Number(items.price_range_removed_count) || 0)
    + Math.max(0, items.length - filtered.length);
  return filtered;
}

function sortableListingPrice(item, missingValue) {
  const price = Number(item?.price);
  return Number.isFinite(price) && price > 100 ? price : missingValue;
}

function siteSearchPolicy(site) {
  return SITE_SEARCH_POLICIES[clean(site, 80)] || Object.freeze({
    minimumPrice: 100,
    priceMaxAgeDays: 90,
    recommendedMaxAgeDays: 45
  });
}

function minimumPriceForSite(site, categoryId) {
  if (categoryId === "free_share") return 0;
  if (categoryId === "books" || categoryId === "tickets") return 100;
  return siteSearchPolicy(site).minimumPrice;
}

function listingAgeDays(item) {
  const postedTime = Date.parse(String(item?.posted_at || ""));
  return Number.isFinite(postedTime) ? Math.max(0, (Date.now() - postedTime) / 86_400_000) : null;
}

function sitePolicyExclusionReason(item, body) {
  const sortMode = requestedSort(body);
  const categoryIds = categoryIdsFromBody(body);
  const categoryId = clean(item?.category_id, 80) || (categoryIds.length === 1 ? categoryIds[0] : "all");
  const price = Number(item?.price);
  const minimumPrice = minimumPriceForSite(item?.site, categoryId);
  if (minimumPrice > 0 && Number.isFinite(price) && price >= 0 && price < minimumPrice) return "site_price_floor";
  const policy = siteSearchPolicy(item?.site);
  const baseMaxAgeDays = sortMode === "recommended" ? policy.recommendedMaxAgeDays : policy.priceMaxAgeDays;
  const categoryMultiplier = ["vehicles", "motorcycle"].includes(categoryId)
    ? 3
    : ["luxury", "furniture", "tools", "books"].includes(categoryId)
      ? 2
      : 1;
  const maxAgeDays = Number.isFinite(baseMaxAgeDays)
    ? (categoryId === "tickets" ? Math.min(baseMaxAgeDays, sortMode === "recommended" ? 14 : 30) : baseMaxAgeDays * categoryMultiplier)
    : null;
  const ageDays = listingAgeDays(item);
  if (Number.isFinite(maxAgeDays) && ageDays !== null && ageDays > maxAgeDays) return "stale_listing";
  return "";
}

function sourceCandidateLimit(body) {
  return Math.min(SOURCE_CANDIDATE_MAX_ITEMS, Math.max(SOURCE_CANDIDATE_MIN_ITEMS, requestedSiteWindow(body)));
}

function sourceFetchLimit(limit, categoryId, queryKeyword) {
  if (!queryKeyword && categoryId === "all") return limit;
  return Math.min(Math.max(limit, 40), SOURCE_CANDIDATE_MAX_ITEMS);
}

function sourceItem({ site, categoryId, title, price, url, imageUrl, seller, postedAt, searchText, description, location }) {
  const cleanTitle = clean(title, 500);
  const baseBySite = {
    joonggonara: "https://web.joongna.com",
    bunjang: "https://m.bunjang.co.kr",
    hellomarket: "https://www.hellomarket.com",
    rethinkmall: "https://web.rethinkmall.com"
  };
  const cleanUrl = absoluteUrl(url, baseBySite[site]);
  if (!cleanTitle || !cleanUrl) return null;
  return {
    id: `${site}:${cleanUrl}`,
    item_id: `${site}:${cleanUrl}`,
    site,
    category_id: categoryId,
    title: cleanTitle,
    price: parsePrice(price),
    currency: "KRW",
    url: cleanUrl,
    image_url: absoluteUrl(imageUrl, cleanUrl) || null,
    seller_name: clean(seller, 200) || null,
    description: clean(description, 320) || null,
    location: clean(location, 120) || null,
    posted_at: parseTimestamp(postedAt, site === "joonggonara" ? 9 * 60 : null),
    updated_at: new Date().toISOString(),
    search_text: clean(searchText, 1000) || cleanTitle
  };
}

function requestHeaders(accept) {
  return {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
    accept,
    "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7"
  };
}

const SEARCH_TERM_ALIASES = Object.freeze({
  iphone: ["iphone", "아이폰"],
  아이폰: ["iphone", "아이폰"],
  ipad: ["ipad", "아이패드"],
  아이패드: ["ipad", "아이패드"],
  galaxy: ["galaxy", "갤럭시"],
  갤럭시: ["galaxy", "갤럭시"],
  samsung: ["samsung", "삼성"],
  airpods: ["airpods", "에어팟"],
  macbook: ["macbook", "맥북"],
  rtx: ["rtx", "지포스", "그래픽카드"],
  mobile: ["mobile", "모바일", "스마트폰", "휴대폰", "태블릿"],
  fashion: ["fashion", "패션", "의류", "옷"]
});

function normalizedSearchText(value) {
  return clean(value, 1000).toLowerCase().replace(/\s+/g, "");
}

function searchTermVariants(term) {
  const normalized = normalizedSearchText(term);
  return SEARCH_TERM_ALIASES[normalized] || [normalized];
}

function matchesRamKeyword(title) {
  const rawTitle = clean(title, 1000).toLowerCase();
  if (!rawTitle) return false;
  if (/(?:\bram\b|(?:^|\s)램)\s*(?:mounts?|마운트)(?:\b|$)/i.test(rawTitle)
    && !/(?:\bddr[345]\b|\d+\s*(?:gb|기가)|노트북|데스크탑|컴퓨터|메모리)/i.test(rawTitle)) return false;
  if (/(?:램\s*(?:스킨|레더|가죽)|리얼\s*램\s*레더)/i.test(rawTitle)
    && !/(?:\bram\b|\bddr[345]\b|\d+\s*(?:gb|기가)|노트북|데스크탑|컴퓨터|메모리)/i.test(rawTitle)) return false;
  if (/\bram\b/i.test(rawTitle)) return true;
  if (/(?:^|[\s()[\]{}.,/+_-])램(?=$|[\s()[\]{}.,/+_0-9a-z-])/i.test(rawTitle)) return true;
  if (/(?:ddr[345]?|노트북|데스크탑|서버|컴퓨터|pc|삼성|하이닉스|튜닝)\s*램/i.test(rawTitle)) return true;
  if (/램\s*(?:\d+\s*(?:gb|g|기가)?|메모리|별도|업글|교체|추가|판매|일괄|세트|\d+개)/i.test(rawTitle)) return true;
  return /(?:\bddr[345]\b|\bsodimm\b|\budimm\b|\bpc[345]-?\d{4,}\b).*(?:\d+\s*(?:gb|기가)|메모리)/i.test(rawTitle)
    || /메모리.*(?:\bddr[345]\b|\d+\s*(?:gb|기가))/i.test(rawTitle);
}

function searchTermMatchesTitle(term, title, normalizedTitle) {
  const normalizedTerm = normalizedSearchText(term);
  if (normalizedTerm === "ram" || normalizedTerm === "램") return matchesRamKeyword(title);
  return searchTermVariants(term).some((variant) => normalizedTitle.includes(normalizedSearchText(variant)));
}

function matchesRequestedKeyword(item, keyword) {
  const terms = clean(keyword, 80).split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  // Search metadata can contain broad tags unrelated to the listing title.
  // Use the title when it exists so an RTX 3080 tagged with "RTX 5070" does
  // not pass an exact RTX 5070 request.
  const title = item?.title || item?.search_text || "";
  const text = normalizedSearchText(title);
  const normalizedKeyword = normalizedSearchText(keyword);
  if (normalizedKeyword === "ps5" && /3ps5/i.test(text)) return false;
  if (normalizedKeyword === "3ps5") return /(?:^|[^a-z0-9])3ps5(?![a-z0-9])/i.test(text);
  const allTermsMatch = terms.every((term) => searchTermMatchesTitle(term, title, text));
  if (!allTermsMatch) return false;
  const numericTerm = terms.find((term) => /^\d{1,4}$/.test(term));
  if (!numericTerm) return true;
  const familyGroups = [
    ["아이폰", "iphone"],
    ["아이패드", "ipad"],
    ["갤럭시", "galaxy"],
    ["rtx"],
    ["gtx"]
  ];
  const queryVariants = terms.flatMap(searchTermVariants).map(normalizedSearchText);
  const family = familyGroups.find((group) => group.some((variant) => queryVariants.includes(normalizedSearchText(variant))));
  if (!family) return true;
  return family.some((variant) => text.includes(`${normalizedSearchText(variant)}${numericTerm}`));
}

function keywordNoiseCategory(categoryId, keyword) {
  if (categoryId && categoryId !== "all") return categoryId;
  const query = normalizedSearchText(keyword);
  if (/(?:아이폰|iphone|갤럭시|galaxy|스마트폰|휴대폰|핸드폰|아이패드|ipad|태블릿|에어팟|airpods|애플워치)/i.test(query)) {
    return "mobile";
  }
  return categoryId || "all";
}

function isObviousKeywordNoise(categoryId, item, keyword) {
  return isKeywordCategoryNoise(keywordNoiseCategory(categoryId, keyword), item, keyword);
}

function isSoftAccessoryMismatch(item, body) {
  const categoryIds = categoryIdsFromBody(body);
  const query = normalizedSearchText(body?.keyword);
  const title = normalizedSearchText(item?.title);
  const inferredApplianceQuery = /(?:다이슨|dyson|청소기|에어컨|냉장고|세탁기|건조기)/i.test(query);
  if (categoryIds.includes("appliances") || inferredApplianceQuery) {
    const accessoryTerms = ["배터리", "모터", "모터헤드", "롤러", "흡입구", "브러시", "브러쉬", "크레비스툴", "콤비네이션툴", "청소툴", "부속", "부품", "거치대", "보관함", "충전기"];
    if (accessoryTerms.some((term) => query.includes(normalizedSearchText(term)))) return false;
    return accessoryTerms.some((term) => title.includes(normalizedSearchText(term)));
  }
  if (/^(?:닌텐도스위치2?|nintendoswitch2?|ps5|플스5|xbox)$/.test(query)) {
    const strongAccessoryTerms = ["터치펜", "키링", "케이블", "카드정리함", "수리", "보호필름"];
    if (strongAccessoryTerms.some((term) => title.includes(normalizedSearchText(term)))) return true;
    const hardwareEvidence = ["본체", "풀박스", "풀세트", "oled", "배터리개선", "라이트", "콘솔", "기기", "네온"];
    if (hardwareEvidence.some((term) => title.includes(normalizedSearchText(term)))) return false;
    const nonHardwareTerms = ["게임", "타이틀", "칩", "알칩", "아미보", "피규어", "케이블", "카드정리함", "수리", "파우치", "케이스", "조이콘", "프로콘", "충전", "보호필름"];
    if (nonHardwareTerms.some((term) => title.includes(normalizedSearchText(term)))) return true;
    // A generic console search should favor listings that actually identify
    // hardware. Ambiguous rows stay available, but follow clear console rows.
    return true;
  }
  return false;
}

export function isClearAccessoryOnlyMismatch(item, body) {
  const query = normalizedSearchText(body?.keyword);
  if (!query) return false;
  const title = normalizedSearchText(item?.title);
  const categoryIds = categoryIdsFromBody(body);
  const includedWithProduct = ["포함", "풀세트", "풀박스", "일괄", "본체와", "본체및", "본체+"]
    .some((term) => title.includes(normalizedSearchText(term)));

  const macbookQuery = /(?:맥북|macbook)(?:에어|air|프로|pro)?(?:m[1-4])?/i.test(query);
  if (macbookQuery) {
    const queryNamesAccessory = ["케이스", "필름", "키스킨", "파우치", "충전기", "어댑터", "허브", "거치대"]
      .some((term) => query.includes(normalizedSearchText(term)));
    if (queryNamesAccessory) return false;
    if (includedWithProduct && ["본체", "gb", "13인치", "15인치"].some((term) => title.includes(normalizedSearchText(term)))) return false;
    return ["케이스", "하드케이스", "필름", "전신필름", "키스킨", "파우치", "슬리브", "충전기", "어댑터", "허브", "거치대", "대여", "렌탈", "임대"]
      .some((term) => title.includes(normalizedSearchText(term)));
  }

  if (categoryIds.includes("games") || /^(?:닌텐도스위치2?|nintendoswitch2?|ps5|플스5|xbox)$/.test(query)) {
    const queryNamesAccessory = ["게임", "타이틀", "칩", "아미보", "조이콘", "프로콘", "케이스", "필름"]
      .some((term) => query.includes(normalizedSearchText(term)));
    if (queryNamesAccessory) return false;
    const strongAccessoryEvidence = ["터치펜", "키링", "카드정리함", "보호필름"];
    if (strongAccessoryEvidence.some((term) => title.includes(normalizedSearchText(term)))) return true;
    const hardwareEvidence = ["본체", "풀박스", "풀세트", "oled", "배터리개선", "라이트", "콘솔", "기기", "네온"];
    if (hardwareEvidence.some((term) => title.includes(normalizedSearchText(term)))) return false;
    const explicitAccessory = ["게임", "타이틀", "칩", "알칩", "게임팩", "카트리지", "아미보", "피규어", "키링", "장패드", "케이블", "카드정리함", "수리", "파우치", "케이스", "조이콘", "프로콘", "충전", "보호필름"]
      .some((term) => title.includes(normalizedSearchText(term)));
    return explicitAccessory || Number(item?.price) < 100_000;
  }

  const applianceQuery = categoryIds.includes("appliances") || /(?:다이슨|dyson).*(?:v\d+|청소기)|(?:v\d+|청소기).*(?:다이슨|dyson)/i.test(query);
  if (applianceQuery) {
    const queryNamesAccessory = ["배터리", "모터헤드", "롤러", "브러시", "브러쉬", "노즐", "툴", "부품", "충전기"]
      .some((term) => query.includes(normalizedSearchText(term)));
    if (queryNamesAccessory) return false;
    if (includedWithProduct && title.includes(normalizedSearchText("청소기")) && !title.includes(normalizedSearchText("청소기용"))) return false;
    return ["배터리", "모터헤드", "소프트롤러", "브러시", "브러쉬", "노즐", "크레비스툴", "콤비네이션툴", "청소툴", "보관함", "악세사리", "악세서리", "액세서리", "부품", "충전기"]
      .some((term) => title.includes(normalizedSearchText(term)));
  }
  return false;
}

function relativePriceFloor(items) {
  const prices = items.map((item) => Number(item?.price))
    .filter((price) => Number.isFinite(price) && price > 100);
  if (prices.length < 4) return 101;
  const referenceMedian = median(prices);
  if (!Number.isFinite(referenceMedian) || referenceMedian <= 0) return 101;
  return Math.max(101, Math.floor((referenceMedian * 0.25) / 100) * 100);
}

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIVE_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function retryAfterMilliseconds(response, attempt) {
  const retryAfter = response.headers.get("retry-after");
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 5_000);
  const retryAt = Date.parse(retryAfter || "");
  if (Number.isFinite(retryAt)) return Math.min(Math.max(0, retryAt - Date.now()), 5_000);
  return LIVE_RETRY_BASE_DELAY_MS * (2 ** Math.max(0, attempt - 1));
}

function isRetryableResponse(response) {
  return response.status === 429 || response.status === 502 || response.status === 503 || response.status === 504;
}

async function fetchWithRetry(url, init = {}) {
  let lastError;
  for (let attempt = 1; attempt <= LIVE_RETRY_MAX_ATTEMPTS; attempt += 1) {
    try {
      await waitForSourceCooldown(url);
      const response = await fetchWithTimeout(url, init);
      if (response.ok || !isRetryableResponse(response) || attempt === LIVE_RETRY_MAX_ATTEMPTS) return response;
      await new Promise((resolve) => setTimeout(resolve, retryAfterMilliseconds(response, attempt)));
    } catch (error) {
      lastError = error;
      if (attempt === LIVE_RETRY_MAX_ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, LIVE_RETRY_BASE_DELAY_MS * attempt));
    }
  }
  throw lastError || new Error("LIVE_REQUEST_FAILED");
}

function sourceCooldownKey(url) {
  try {
    const hostname = new URL(url).hostname;
    return Object.keys(SOURCE_COOLDOWN_MS).find((site) => hostname.includes(site)) || "";
  } catch {
    return "";
  }
}

async function waitForSourceCooldown(url) {
  const source = sourceCooldownKey(url);
  const cooldownMs = source ? SOURCE_COOLDOWN_MS[source] : 0;
  if (!cooldownMs) return;
  const key = source;
  const previous = sourceCooldownChains.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  sourceCooldownChains.set(key, current);
  await previous;
  try {
    const now = Date.now();
    const nextAllowed = sourceRequestNextAllowed.get(key) || 0;
    if (nextAllowed > now) await new Promise((resolve) => setTimeout(resolve, nextAllowed - now));
    sourceRequestNextAllowed.set(key, Date.now() + cooldownMs);
  } finally {
    release();
  }
}

async function collectBunjangCategory(sourceCategoryId, categoryId, limit, sortMode) {
  const url = new URL("https://api.bunjang.co.kr/api/search/v8/web/search");
  url.searchParams.set("categoryId", sourceCategoryId);
  url.searchParams.set("policyKey", "pw.product.category");
  url.searchParams.set("size", String(Math.min(Math.max(limit * 2, 12), 60)));
  url.searchParams.set("order", sortMode === "price_asc" ? "price_asc" : "date");
  const context = Buffer.from(JSON.stringify({
    device: { is_bunjang_webview: false, os: "Windows" }
  }), "utf8").toString("base64");
  const response = await fetchWithRetry(url, {
    headers: {
      ...requestHeaders("application/json, text/plain, */*") ,
      referer: `https://m.bunjang.co.kr/categories/${encodeURIComponent(sourceCategoryId)}`,
      "x-bun-context": context
    }
  });
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  const payload = await response.json();
  const rows = Array.isArray(payload?.data?.responses?.mainGrid?.searchResponse?.data)
    ? payload.data.responses.mainGrid.searchResponse.data
    : [];
  return rows.map((row) => sourceItem({
    site: "bunjang",
    categoryId,
    title: row?.name,
    price: row?.price,
    url: row?.pid ? `https://m.bunjang.co.kr/products/${row.pid}` : "",
    imageUrl: typeof row?.productImage === "string" ? row.productImage.replace("{res}", "640") : "",
    seller: row?.shop?.uid ? `user:${row.shop.uid}` : "",
    postedAt: row?.updatedAt,
    searchText: row?.name
  })).filter(Boolean);
}

export function bunjangKeywordPagePlan(limit, priceRange = { min: null, max: null }) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 1, SOURCE_CANDIDATE_MAX_ITEMS));
  const hasPriceRange = priceRange.min !== null || priceRange.max !== null;
  const needsLowerBoundScan = priceRange.min !== null;
  const pageSize = hasPriceRange
    ? Math.min(Math.max(safeLimit * 3, 20), 60)
    : 20;
  const targetPages = Math.ceil(safeLimit / pageSize);
  return {
    pageSize,
    maxPages: Math.min(Math.max(targetPages, needsLowerBoundScan ? 3 : 1), 32)
  };
}

async function collectBunjangKeyword(keyword, categoryId, limit, queryKeyword = keyword, sortMode = "price_asc", priceRange = { min: null, max: null }) {
  const hasPriceRange = priceRange.min !== null || priceRange.max !== null;
  const { pageSize, maxPages } = bunjangKeywordPagePlan(limit, priceRange);
  const items = [];
  const fallbackItems = [];
  let receivedCount = 0;
  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL("https://api.bunjang.co.kr/api/1/find_v2.json");
    url.searchParams.set("q", keyword);
    url.searchParams.set("n", String(pageSize));
    url.searchParams.set("page", String(page));
    url.searchParams.set("order", sortMode === "price_asc" ? "price_asc" : "date");
    url.searchParams.set("stat_device", "w");
    url.searchParams.set("version", "4");
    const response = await fetchWithRetry(url, { headers: requestHeaders("application/json, text/plain, */*") });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    const payload = await response.json();
    const rows = Array.isArray(payload?.list) ? payload.list : [];
    receivedCount += rows.length;
    const pageItems = rows.map((row) => sourceItem({
      site: "bunjang",
      categoryId,
      title: row?.name,
      price: row?.price,
      url: row?.pid ? `https://m.bunjang.co.kr/products/${row.pid}` : "",
      imageUrl: typeof row?.product_image === "string" ? row.product_image.replace("{res}", "640") : "",
      seller: row?.uid ? `user:${row.uid}` : "",
      postedAt: row?.update_time,
      searchText: `${row?.name || ""} ${row?.tag || ""}`
    })).filter(Boolean).filter((item) => matchesRequestedKeyword(item, queryKeyword || keyword))
      .filter((item) => !isObviousKeywordNoise(categoryId, item, queryKeyword || keyword));
    items.push(...pageItems);
    const usableCount = hasPriceRange ? filterItemsByPriceRange(items, priceRange).length : items.length;
    if (usableCount >= limit) break;
    if (rows.length < pageSize) break;
  }
  if (sortMode === "price_asc") {
    const recentUrl = new URL("https://api.bunjang.co.kr/api/1/find_v2.json");
    recentUrl.searchParams.set("q", keyword);
    recentUrl.searchParams.set("n", String(pageSize));
    recentUrl.searchParams.set("page", "0");
    recentUrl.searchParams.set("order", "date");
    recentUrl.searchParams.set("stat_device", "w");
    recentUrl.searchParams.set("version", "4");
    const recentResponse = await fetchWithRetry(recentUrl, { headers: requestHeaders("application/json, text/plain, */*") });
    if (recentResponse.ok) {
      const recentPayload = await recentResponse.json();
      const recentRows = Array.isArray(recentPayload?.list) ? recentPayload.list : [];
      receivedCount += recentRows.length;
      const recentItems = recentRows.map((row) => sourceItem({
        site: "bunjang",
        categoryId,
        title: row?.name,
        price: row?.price,
        url: row?.pid ? `https://m.bunjang.co.kr/products/${row.pid}` : "",
        imageUrl: typeof row?.product_image === "string" ? row.product_image.replace("{res}", "640") : "",
        seller: row?.uid ? `user:${row.uid}` : "",
        postedAt: row?.update_time,
        searchText: `${row?.name || ""} ${row?.tag || ""}`
      })).filter(Boolean).filter((item) => matchesRequestedKeyword(item, queryKeyword || keyword))
        .filter((item) => !isObviousKeywordNoise(categoryId, item, queryKeyword || keyword));
      const floor = relativePriceFloor(recentItems);
      items.forEach((item) => {
        if (Number(item?.price) > 100 && Number(item.price) < floor) item.price_suspect = true;
      });
      fallbackItems.push(...recentItems);
    }
  }
  const result = dedupeItems(filterItemsByPriceRange([...items, ...fallbackItems], priceRange), limit);
  result.received_count = receivedCount;
  if (sortMode === "price_asc" && fallbackItems.length > 0) {
    result.partial_notice = "가격순 상단의 비정상 가격을 피하기 위해 최신 정상 매물 표본도 함께 비교했습니다";
  }
  return result;
}

async function collectBunjang(keyword, categoryId, limit, queryKeyword = "", sortMode = "price_asc", priceRange = { min: null, max: null }) {
  const categoryIds = sourceCategoryIds("bunjang", categoryId);
  if (categoryIds.length > 0) {
    if (queryKeyword) return collectBunjangKeyword(queryKeyword, categoryId, limit, queryKeyword, sortMode, priceRange);
    const fetchLimit = sourceFetchLimit(limit, categoryId, queryKeyword);
    const settled = await Promise.allSettled(categoryIds.map((sourceCategoryId) => (
      collectBunjangCategory(sourceCategoryId, categoryId, fetchLimit, sortMode)
    )));
    const categoryItems = settled
      .filter((result) => result.status === "fulfilled")
      .flatMap((result) => result.value || []);
    const failed = settled.filter((result) => result.status === "rejected");
    if (!categoryItems.length) {
      if (failed[0]) throw failed[0].reason;
    }
    const keywordItems = categoryItems.filter((item) => matchesRequestedKeyword(item, queryKeyword));
    const result = dedupeItems(filterItemsByPriceRange(keywordItems, priceRange), limit);
    if (failed.length) result.partial_error = `PARTIAL_CATEGORY_FAILURE:${failed.length}`;
    return result;
  }
  return collectBunjangKeyword(keyword, categoryId, limit, queryKeyword || keyword, sortMode, priceRange);
}

function decodeBasicEntities(value) {
  return String(value || "")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&#x0*27;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function parseJoongnaItems(html) {
  const normalized = html.replace(/&quot;/g, '"');
  const patterns = [
    ['\\"items\\":[', '],\\"changedProductFilterType\\"', true],
    ['"items":[', '],"changedProductFilterType"', false]
  ];
  for (const [start, end, escaped] of patterns) {
    const startIndex = normalized.indexOf(start);
    if (startIndex < 0) continue;
    const endIndex = normalized.indexOf(end, startIndex + start.length);
    if (endIndex < 0) continue;
    try {
      const jsonText = `[${normalized.slice(startIndex + start.length, endIndex)}]`;
      const decoded = escaped ? jsonText.replace(/\\"/g, '"') : jsonText;
      const rows = JSON.parse(decoded);
      if (Array.isArray(rows)) return rows;
    } catch {
      // Try the alternate Next.js serialization shape.
    }
  }
  return [];
}

export function joongnaPagePlan(limit) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 1, SOURCE_CANDIDATE_MAX_ITEMS));
  const pageSize = 50;
  return {
    pageSize,
    maxPages: Math.min(Math.max(1, Math.ceil(safeLimit / pageSize)), 13)
  };
}

async function collectJoongna(keyword, categoryId, limit, queryKeyword = "", sortMode = "price_asc", priceRange = { min: null, max: null }) {
  const categoryIds = sourceCategoryIds("joonggonara", categoryId);
  const rawUrls = categoryIds.length > 0 && !queryKeyword
    ? categoryIds.map((sourceCategoryId) => `https://web.joongna.com/search?category=${encodeURIComponent(sourceCategoryId)}`)
    : [`https://web.joongna.com/search/${encodeURIComponent(keyword)}`];
  let referenceItems = [];
  let adaptiveMinPrice = minimumPriceForSite("joonggonara", categoryId);
  if (sortMode === "price_asc" && queryKeyword && rawUrls.length === 1) {
    const recentUrl = new URL(rawUrls[0]);
    recentUrl.searchParams.set("sort", "RECENT_SORT");
    const recentResponse = await fetchWithRetry(recentUrl, { headers: requestHeaders("text/html,application/xhtml+xml,*/*;q=0.8") });
    if (recentResponse.ok) {
      const recentRows = parseJoongnaItems(await recentResponse.text());
      referenceItems = recentRows.map((row) => sourceItem({
        site: "joonggonara",
        categoryId,
        title: row?.title,
        price: row?.price,
        url: row?.articleUrl || (row?.seq ? `/product/${row.seq}` : ""),
        imageUrl: row?.detailImgUrl || row?.url,
        seller: row?.storeSeq ? `store:${row.storeSeq}` : "",
        postedAt: row?.sortDate,
        searchText: row?.title
      })).filter(Boolean).filter((item) => matchesRequestedKeyword(item, queryKeyword))
        .filter((item) => !isObviousKeywordNoise(categoryId, item, queryKeyword));
      adaptiveMinPrice = Math.max(adaptiveMinPrice, relativePriceFloor(referenceItems));
    }
  }
  const { maxPages } = joongnaPagePlan(limit);
  const pagesPerSource = rawUrls.length === 1 ? maxPages : 1;
  const urls = rawUrls.flatMap((rawUrl) => Array.from({ length: pagesPerSource }, (_, pageIndex) => {
    const url = new URL(rawUrl);
    url.searchParams.set("sort", sortMode === "price_asc" ? "PRICE_ASC_SORT" : "RECENT_SORT");
    if (pageIndex > 0) url.searchParams.set("page", String(pageIndex + 1));
    const effectiveMinPrice = priceRange.min !== null
      ? Math.max(priceRange.min, categoryId === "free_share" ? 0 : minimumPriceForSite("joonggonara", categoryId))
      : sortMode === "price_asc" && categoryId !== "free_share"
        ? adaptiveMinPrice
        : 0;
    if (effectiveMinPrice > 0) url.searchParams.set("minPrice", String(effectiveMinPrice));
    if (priceRange.max !== null) url.searchParams.set("maxPrice", String(priceRange.max));
    return url.toString();
  }));
  const settled = await Promise.allSettled(urls.map(async (url) => {
    const response = await fetchWithRetry(url, { headers: requestHeaders("text/html,application/xhtml+xml,*/*;q=0.8") });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    return parseJoongnaItems(await response.text());
  }));
  const pages = settled
    .filter((result) => result.status === "fulfilled")
    .flatMap((result) => result.value || []);
  const failed = settled.filter((result) => result.status === "rejected");
  if (!pages.length) {
    if (failed[0]) throw failed[0].reason;
  }
  const items = pages.flat().map((row) => sourceItem({
    site: "joonggonara",
    categoryId,
    title: row?.title,
    price: row?.price,
    url: row?.articleUrl || (row?.seq ? `/product/${row.seq}` : ""),
    imageUrl: row?.detailImgUrl || row?.url,
    seller: row?.storeSeq ? `store:${row.storeSeq}` : "",
    postedAt: row?.sortDate,
    searchText: row?.title
  })).filter(Boolean);
  const localMinPrice = priceRange.min !== null
    ? Math.max(priceRange.min, categoryId === "free_share" ? 0 : minimumPriceForSite("joonggonara", categoryId))
    : adaptiveMinPrice;
  const priceItems = items.filter((item) => Number(item?.price) >= localMinPrice);
  const uniqueItems = [...new Map([...priceItems, ...referenceItems].map((item) => [item.id, item])).values()];
  const keywordItems = queryKeyword
    ? uniqueItems.filter((item) => matchesRequestedKeyword(item, queryKeyword))
    : uniqueItems;
  const relevantItems = queryKeyword
    ? keywordItems.filter((item) => !isObviousKeywordNoise(categoryId, item, queryKeyword))
    : keywordItems;
  const result = relevantItems.slice(0, limit);
  result.received_count = pages.flat().length + referenceItems.length;
  if (failed.length) result.partial_error = `PARTIAL_CATEGORY_FAILURE:${failed.length}`;
  return result;
}

function stripHtml(value) {
  return decodeBasicEntities(String(value || "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function readClassTexts(fragment, token) {
  const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<[^>]*class=["'](?:[^"']*\\s)?${escapedToken}(?=\\s|["'])[^"']*["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, "gi");
  return [...fragment.matchAll(pattern)].map((match) => stripHtml(match[1])).filter(Boolean);
}

async function enrichHelloImages(items, { concurrency = 4, maxItems = items.length } = {}) {
  items.forEach((item) => {
    if (item && item.image_url && !isLikelyProductImage(item.image_url)) item.image_url = null;
  });
  const workerCount = Math.max(1, Math.floor(concurrency));
  const candidateLimit = Math.max(0, Math.floor(maxItems));
  const candidates = items.filter((item) => item && !item.image_url).slice(0, candidateLimit);
  const enrichItem = async (item) => {
    try {
      const response = await fetchWithRetry(item.url, {
        headers: requestHeaders("text/html,application/xhtml+xml,*/*;q=0.8")
      });
      if (!response.ok) return;
      const html = await response.text();
      const tag = html.match(/<meta\b[^>]*property=["']og:image["'][^>]*>/i)?.[0]
        || html.match(/<meta\b[^>]*name=["']twitter:image["'][^>]*>/i)?.[0]
        || "";
      const image = tag.match(/\bcontent=["']([^"']+)["']/i)?.[1] || "";
      const imageUrl = absoluteUrl(image, item.url);
      if (isLikelyProductImage(imageUrl)) item.image_url = imageUrl;
    } catch {
      // Search cards remain valid when optional image enrichment is unavailable.
    }
  };
  for (let index = 0; index < candidates.length; index += workerCount) {
    await Promise.all(candidates.slice(index, index + workerCount).map(enrichItem));
  }
  return items;
}

function surroundingFragment(html, index, radius = 4500) {
  return html.slice(Math.max(0, index - radius), Math.min(html.length, index + radius));
}

export function helloMarketPagePlan(limit) {
  const pageSize = 20;
  const safeLimit = Math.max(1, Math.min(Number(limit) || 1, SOURCE_CANDIDATE_MAX_ITEMS));
  return { pageSize, maxPages: Math.min(Math.max(1, Math.ceil(safeLimit / pageSize)), 32) };
}

async function collectHelloMarket(keyword, categoryId, limit, queryKeyword = "", sortMode = "price_asc", priceRange = { min: null, max: null }) {
  // Hello's recommendation feed tends to resurface old shop-style posts.
  // Build our recommendation from the current feed and rank it locally.
  const sortValue = sortMode === "price_asc" ? "lowprice" : "current";
  const { pageSize, maxPages } = helloMarketPagePlan(limit);
  const items = [];
  const fallbackItems = [];
  let receivedCount = 0;
  let startTime = Date.now();
  let adaptiveMinPrice = 0;
  if (sortMode === "price_asc") {
    const recentUrl = new URL("https://www.hellomarket.com/api/search/items");
    recentUrl.searchParams.set("q", keyword);
    recentUrl.searchParams.set("page", "1");
    recentUrl.searchParams.set("startTime", String(startTime));
    recentUrl.searchParams.set("sort", "current");
    const recentResponse = await fetchWithRetry(recentUrl, { headers: requestHeaders("application/json, text/plain, */*") });
    if (recentResponse.ok) {
      const recentPayload = await recentResponse.json();
      const recentRows = Array.isArray(recentPayload?.list) ? recentPayload.list : [];
      receivedCount += recentRows.length;
      const upstreamStartTime = Number(recentPayload?.result?.startTime);
      if (Number.isFinite(upstreamStartTime)) startTime = upstreamStartTime;
      const recentItems = recentRows.filter((row) => row?.sellState?.code !== "SoldOut").map((row) => sourceItem({
        site: "hellomarket",
        categoryId,
        title: row?.title,
        price: row?.price,
        url: row?.itemIdx ? `https://www.hellomarket.com/item/${row.itemIdx}` : "",
        imageUrl: row?.imageUrl,
        seller: "",
        postedAt: row?.timestamp,
        searchText: `${row?.title || ""} ${(row?.categories || []).map((value) => value?.name || "").join(" ")}`
      })).filter(Boolean).filter((item) => !queryKeyword || matchesRequestedKeyword(item, queryKeyword))
        .filter((item) => !queryKeyword || !isObviousKeywordNoise(categoryId, item, queryKeyword));
      adaptiveMinPrice = relativePriceFloor(recentItems);
      fallbackItems.push(...recentItems);
    }
  }
  for (let page = 1; page <= maxPages && items.length < limit; page += 1) {
    const apiUrl = new URL("https://www.hellomarket.com/api/search/items");
    apiUrl.searchParams.set("q", keyword);
    apiUrl.searchParams.set("page", String(page));
    apiUrl.searchParams.set("startTime", String(startTime));
    apiUrl.searchParams.set("sort", sortValue);
    const effectiveMinPrice = priceRange.min !== null
      ? priceRange.min
      : sortMode === "price_asc"
        ? adaptiveMinPrice
        : 0;
    if (effectiveMinPrice > 0) apiUrl.searchParams.set("minPrice", String(effectiveMinPrice));
    if (priceRange.max !== null) apiUrl.searchParams.set("maxPrice", String(priceRange.max));
    const response = await fetchWithRetry(apiUrl, { headers: requestHeaders("application/json, text/plain, */*") });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    const payload = await response.json();
    const rows = Array.isArray(payload?.list) ? payload.list : [];
    const upstreamStartTime = Number(payload?.result?.startTime);
    if (Number.isFinite(upstreamStartTime)) startTime = upstreamStartTime;
    receivedCount += rows.length;
    const pageItems = rows.filter((row) => row?.sellState?.code !== "SoldOut").map((row) => sourceItem({
      site: "hellomarket",
      categoryId,
      title: row?.title,
      price: row?.price,
      url: row?.itemIdx ? `https://www.hellomarket.com/item/${row.itemIdx}` : "",
      imageUrl: row?.imageUrl,
      seller: "",
      postedAt: row?.timestamp,
      searchText: `${row?.title || ""} ${(row?.categories || []).map((value) => value?.name || "").join(" ")}`
    })).filter(Boolean).filter((item) => !queryKeyword || matchesRequestedKeyword(item, queryKeyword))
      .filter((item) => !queryKeyword || !isObviousKeywordNoise(categoryId, item, queryKeyword));
    items.push(...pageItems);
    if (rows.length < pageSize) break;
  }
  const result = dedupeItems([...items, ...fallbackItems], limit);
  await enrichHelloImages(result, { maxItems: 20 });
  result.received_count = receivedCount;
  return result;
}

async function collectRethinkMall(keyword, categoryId, limit, queryKeyword = "", sortMode = "price_asc", priceRange = { min: null, max: null }) {
  const fetchLimit = sourceFetchLimit(limit, categoryId, queryKeyword);
  const searchUrl = new URL("https://web.rethinkmall.com/search");
  searchUrl.searchParams.set("utm_source", "bu");
  searchUrl.searchParams.set("keyword", keyword);
  // Broad Rethink categories lose relevance when its full inventory is sorted
  // by price first. Start category browsing from current stock, then apply our
  // local price order. Explicit product keywords can safely use source price.
  const useUpstreamPriceSort = sortMode === "price_asc" && Boolean(queryKeyword);
  searchUrl.searchParams.set("sortBy", useUpstreamPriceSort ? "final_price" : "update_date");
  searchUrl.searchParams.set("sortDirection", useUpstreamPriceSort ? "asc" : "desc");
  const url = searchUrl.toString();
  const response = await fetchWithRetry(url, { headers: requestHeaders("text/html,application/xhtml+xml,*/*;q=0.8") });
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  const html = await response.text();
  const livewireResult = await collectRethinkLivewire(html, response, url, categoryId, fetchLimit, priceRange);
  const suggestedKeyword = (() => {
    try {
      const value = new URL(response.url || url).searchParams.get("suggestedKeyword") || "";
      return value && value.trim().toLowerCase() !== String(keyword || "").trim().toLowerCase() ? value.trim() : "";
    } catch {
      return "";
    }
  })();

  const pattern = /<a\b([^>]*href=["'][^"']*\/goods\/[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi;
  const items = [];
  for (const match of html.matchAll(pattern)) {
    const href = match[1].match(/href=["']([^"']+)["']/i)?.[1] || "";
    const fragment = match[2] || "";
    const title = readClassTexts(fragment, "_ga-goods-title")[0] || "";
    const price = readClassTexts(fragment, "text-base")[0] || stripHtml(fragment);
    const image = fragment.match(/<img\b([^>]*)>/i)?.[1]?.match(/(?:data-src|data-original|src)=["']([^"']+)["']/i)?.[1] || "";
    const item = sourceItem({
      site: "rethinkmall",
      categoryId,
      title,
      price,
      url: href,
      imageUrl: image,
      searchText: `${title} ${stripHtml(fragment)}`
    });
    if (item) items.push(item);
    if (items.length >= fetchLimit) break;
  }
  const combinedItems = [...new Map([...livewireResult.items, ...items].map((item) => [item.id, item])).values()];
  if (combinedItems.length > 0) {
    const directItems = queryKeyword ? combinedItems
      .filter((item) => matchesRequestedKeyword(item, queryKeyword))
      .filter((item) => !isObviousKeywordNoise(categoryId, item, queryKeyword)) : combinedItems;
    const usesSuggestedKeyword = Boolean(suggestedKeyword) && queryKeyword && directItems.length === 0;
    const filteredItems = filterItemsByPriceRange(usesSuggestedKeyword ? combinedItems : directItems, priceRange);
    const visibleItems = filteredItems.slice(0, limit);
    visibleItems.price_range_removed_count = Number(filteredItems.price_range_removed_count) || 0;
    if (usesSuggestedKeyword) {
      visibleItems.forEach((item) => {
        item.upstream_keyword_fallback = true;
        item.upstream_suggested_keyword = suggestedKeyword;
      });
    }
    if (Number.isFinite(livewireResult.total_count) && combinedItems.length < livewireResult.total_count) {
      visibleItems.partial_error = `PARTIAL_SOURCE_RESULTS:${combinedItems.length}/${livewireResult.total_count}`;
    }
    if (suggestedKeyword) visibleItems.partial_notice = `UPSTREAM_SUGGESTED_KEYWORD:${suggestedKeyword}`;
    if (usesSuggestedKeyword) {
      const exactItems = [];
      exactItems.partial_notice = `UPSTREAM_SUGGESTED_KEYWORD:${suggestedKeyword}`;
      exactItems.suggested_items = visibleItems;
      exactItems.suggested_keyword = suggestedKeyword;
      return exactItems;
    }
    if (visibleItems.length > 0 || !livewireResult.error) return visibleItems;
    throw new Error(livewireResult.error);
  }
  if (livewireResult.error) throw new Error(livewireResult.error);
  if (suggestedKeyword) items.partial_notice = `UPSTREAM_SUGGESTED_KEYWORD:${suggestedKeyword}`;
  return items;
}

async function collectRethinkLivewire(html, pageResponse, pageUrl, categoryId, limit, priceRange = { min: null, max: null }) {
  const marker = "goods-catalogs.keyword-goods-pages";
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) return { items: [], error: "" };
  const tagStart = html.lastIndexOf("<div", markerIndex);
  const tagEnd = html.indexOf(">", markerIndex);
  if (tagStart < 0 || tagEnd < 0) return { items: [], error: "LIVEWIRE_COMPONENT_NOT_FOUND" };
  const componentTag = html.slice(tagStart, tagEnd + 1);
  const encodedSnapshot = componentTag.match(/wire:snapshot=["']([^"']+)["']/i)?.[1] || "";
  const lazyToken = componentTag.match(/__lazyLoad\((?:&#039;|')([^']+)(?:&#039;|')\)/i)?.[1] || "";
  const csrfToken = html.match(/<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)["']/i)?.[1] || "";
  if (!encodedSnapshot || !lazyToken || !csrfToken) return { items: [], error: "LIVEWIRE_SNAPSHOT_INCOMPLETE" };

  const snapshot = decodeBasicEntities(encodedSnapshot);
  const cookies = typeof pageResponse.headers.getSetCookie === "function"
    ? pageResponse.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ")
    : String(pageResponse.headers.get("set-cookie") || "")
      .split(/,(?=[^;]+=)/)
      .map((value) => value.split(";", 1)[0].trim())
      .filter(Boolean)
      .join("; ");
  const xsrfCookie = cookies.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/i)?.[1] || "";
  let xsrfToken = xsrfCookie;
  try {
    xsrfToken = decodeURIComponent(xsrfCookie);
  } catch {
    // Keep the raw cookie when the upstream value is not URI-encoded safely.
  }
  const livewireHeaders = {
    ...requestHeaders("*/*"),
    "content-type": "application/json",
    "x-livewire": "",
    "x-csrf-token": csrfToken,
    "x-xsrf-token": xsrfToken,
    origin: "https://web.rethinkmall.com",
    referer: pageUrl,
    cookie: cookies
  };
  async function updateLivewire(currentSnapshot, call) {
    const response = await fetchWithRetry("https://web.rethinkmall.com/livewire/update", {
      method: "POST",
      headers: livewireHeaders,
      body: JSON.stringify({
        _token: csrfToken,
        components: [{ snapshot: currentSnapshot, updates: {}, calls: [call] }]
      })
    });
    if (!response.ok) return { payload: null, error: `HTTP_${response.status}` };
    try {
      return { payload: await response.json(), error: "" };
    } catch {
      return { payload: null, error: "LIVEWIRE_INVALID_JSON" };
    }
  }

  const firstResult = await updateLivewire(snapshot, {
    path: "",
    method: "__lazyLoad",
    params: [decodeBasicEntities(lazyToken)]
  });
  if (firstResult.error) return { items: [], error: firstResult.error };
  const firstComponent = firstResult.payload?.components?.[0];
  const firstHtml = firstComponent?.effects?.html;
  if (typeof firstHtml !== "string") return { items: [], error: "LIVEWIRE_HTML_MISSING" };

  let currentSnapshot = firstComponent.snapshot || snapshot;
  let renderedHtml = firstHtml;
  const items = [];
  let totalCount = null;
  const maximumItems = Math.max(limit, SOURCE_PARSE_MAX_ITEMS);
  const appendRenderedItems = (value) => {
    const pattern = /<a\b([^>]*href=["'][^"']*\/goods\/[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi;
    for (const match of value.matchAll(pattern)) {
      const href = match[1].match(/href=["']([^"']+)["']/i)?.[1] || "";
      const fragment = match[2] || "";
      const title = readClassTexts(fragment, "_ga-goods-title")[0] || "";
      const price = readClassTexts(fragment, "text-base")[0] || "";
      const image = fragment.match(/<img\b([^>]*)>/i)?.[1]?.match(/(?:data-src|data-original|src)=["']([^"']+)["']/i)?.[1] || "";
      const item = sourceItem({
        site: "rethinkmall",
        categoryId,
        title,
        price,
        url: href,
        imageUrl: image,
        searchText: `${title} ${stripHtml(fragment)}`
      });
      if (item) items.push(item);
      if (items.length >= maximumItems) break;
    }
  };
  appendRenderedItems(renderedHtml);

  const hasEnoughItems = () => (
    priceRange.min !== null
      ? filterItemsByPriceRange(items, priceRange).length >= limit
      : items.length >= limit
  );
  const maxAdditionalPages = priceRange.min !== null
    ? Math.min(Math.max(8, Math.ceil(limit / 20)), 32)
    : Math.min(Math.max(4, Math.ceil(limit / 40)), 16);
  for (let page = 0; page < maxAdditionalPages && !hasEnoughItems(); page += 1) {
    const next = renderedHtml.match(/\$wire\.\$parent\.loadMore\((["']?)([^,'")]+)\1,\s*(\d+)\)/);
    if (!next) break;
    const cursor = /^\d+$/.test(next[2]) ? Number(next[2]) : next[2];
    const total = Number(next[3]);
    if (Number.isFinite(total)) totalCount = total;
    if (!Number.isFinite(total) || total <= items.length) break;
    const nextResult = await updateLivewire(currentSnapshot, {
      path: "",
      method: "loadMore",
      params: [cursor, total]
    });
    if (nextResult.error) break;
    const nextComponent = nextResult.payload?.components?.[0];
    if (typeof nextComponent?.effects?.html !== "string") break;
    currentSnapshot = nextComponent.snapshot || currentSnapshot;
    renderedHtml = nextComponent.effects.html;
    appendRenderedItems(renderedHtml);
  }

  const uniqueItems = [...new Map(items.map((item) => [item.id, item])).values()];
  return { items: uniqueItems.slice(0, maximumItems), error: "", total_count: totalCount };
}

async function collectOne(site, keyword, categoryId, limit, queryKeyword = keyword, sortMode = "price_asc", priceRange = { min: null, max: null }) {
  const key = JSON.stringify({ site, keyword, categoryId, limit, queryKeyword, sortMode, priceRange });
  const cached = sourceSearchCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.items;
  if (cached && cached.staleUntil <= Date.now()) sourceSearchCache.delete(key);
  const pending = sourceSearchInflight.get(key);
  if (pending) return pending;
  const promise = (async () => {
    const items = site === "bunjang"
      ? await collectBunjang(keyword, categoryId, limit, queryKeyword, sortMode, priceRange)
      : site === "joonggonara"
        ? await collectJoongna(keyword, categoryId, limit, queryKeyword, sortMode, priceRange)
      : site === "hellomarket"
          ? await collectHelloMarket(keyword, categoryId, limit, queryKeyword, sortMode, priceRange)
          : site === "rethinkmall"
            ? await collectRethinkMall(keyword, categoryId, limit, queryKeyword, sortMode, priceRange)
            : null;
    return filterItemsByPriceRange(items, priceRange);
  })();
  sourceSearchInflight.set(key, promise);
  try {
    const items = await promise;
    if (Array.isArray(items)) {
      const now = Date.now();
      sourceSearchCache.set(key, {
        items,
        expiresAt: now + SOURCE_CACHE_TTL_MS,
        staleUntil: now + SOURCE_STALE_CACHE_TTL_MS
      });
      while (sourceSearchCache.size > SOURCE_CACHE_MAX_ENTRIES) {
        sourceSearchCache.delete(sourceSearchCache.keys().next().value);
      }
    }
    return items;
  } catch (error) {
    if (cached?.staleUntil > Date.now() && Array.isArray(cached.items) && cached.items.length > 0) {
      const staleItems = [...cached.items];
      staleItems.stale_cache = true;
      staleItems.partial_notice = "실시간 조회 실패로 최근 저장 결과를 표시했습니다";
      return staleItems;
    }
    throw error;
  } finally {
    sourceSearchInflight.delete(key);
  }
}

export async function collectLiveSite(site, body, limit, rawKeyword) {
  const sortMode = requestedSort(body);
  const priceRange = requestedPriceRange(body);
  const categoryIds = categorySearchIds(body);
  const settled = await Promise.allSettled(categoryIds.map(async (categoryId) => {
    const categoryBody = {
      ...body,
      category_id: categoryId === "all" ? "" : categoryId,
      category_ids: categoryId === "all" ? [] : [categoryId]
    };
    const siteKeyword = rawKeyword || categoryQuery(categoryBody);
    const rawItems = await collectOne(site, siteKeyword, categoryId, limit, rawKeyword, sortMode, priceRange);
    const items = Array.isArray(rawItems) ? rawItems : [];
    const receivedCount = Number.isFinite(Number(rawItems?.received_count))
      ? Number(rawItems.received_count)
      : items.length;
    const partialError = typeof rawItems?.partial_error === "string" ? rawItems.partial_error : "";
    const partialNotice = typeof rawItems?.partial_notice === "string" ? rawItems.partial_notice : "";
    const suggestedItems = Array.isArray(rawItems?.suggested_items) ? rawItems.suggested_items : [];
    const priceRangeRemovedCount = Number(rawItems?.price_range_removed_count) || 0;
    const staleCache = rawItems?.stale_cache === true;
    const exactKeywordItems = rawKeyword
      ? items.filter((item) => item?.upstream_keyword_fallback === true || matchesRequestedKeyword(item, rawKeyword))
      : items;
    const keywordItems = rawKeyword
      ? exactKeywordItems
      : items;
    const officialCategory = categoryId !== "all" && hasOfficialCategory(site, categoryId);
    // An official source category is authoritative only when we queried that
    // category directly. When a keyword is present, Bunjang/Joongna use their
    // keyword endpoints to keep the requested term visible; those responses
    // can still contain cross-category listings, so apply the local category
    // alias check as well as the source-specific exclusion rules.
    const officialItems = keywordItems.filter((item) => !isCategoryExcluded(categoryId, item));
    const categoryItems = officialCategory
      ? rawKeyword || STRICT_OFFICIAL_TITLE_CATEGORIES.has(categoryId)
        ? filterCategoryItems(officialItems, categoryBody)
        : officialItems
      : filterCategoryItems(keywordItems, categoryBody);
    const filteredItems = categoryItems.filter((item) => !isObviousKeywordNoise(categoryId, item, rawKeyword));
    const removedCount = Math.max(0, receivedCount - filteredItems.length);
    const filterWarning = keywordItems.length < items.length
      ? `키워드 조건으로 ${items.length - keywordItems.length}건을 제외했습니다`
      : filteredItems.length < keywordItems.length
        ? `카테고리 조건으로 ${keywordItems.length - filteredItems.length}건을 제외했습니다`
        : "";
    return {
      categoryId,
      items: filteredItems,
      rawCount: receivedCount,
      removedCount,
      filterWarning,
      partialError,
      partialNotice,
      suggestedItems,
      priceRangeRemovedCount,
      staleCache
    };
  }));
  const fulfilled = settled
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value);
  const errors = settled
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason));
  const partialErrors = fulfilled.map((result) => result.partialError).filter(Boolean);
  const notices = fulfilled.map((result) => result.partialNotice).filter(Boolean);
  const allErrors = [...errors, ...partialErrors];
  const orderedItems = [];
  const categoryBuckets = fulfilled.map((result) => result.items);
  const categoryBucketSize = Math.max(0, ...categoryBuckets.map((items) => items.length));
  for (let index = 0; index < categoryBucketSize; index += 1) {
    for (const bucket of categoryBuckets) {
      if (bucket[index]) orderedItems.push(bucket[index]);
    }
  }
  const uniqueItems = [...new Map(orderedItems.map((item) => [item.id, item])).values()];
  if (!uniqueItems.length && allErrors.length) throw new Error(allErrors[0]);
  return {
    site,
    supported: true,
    items: uniqueItems,
    raw_count: fulfilled.reduce((sum, result) => sum + result.rawCount, 0),
    filtered_count: fulfilled.reduce((sum, result) => sum + result.removedCount, 0),
    filter_warning: fulfilled.map((result) => result.filterWarning).filter(Boolean).join("; "),
    notice: notices.join("; "),
    error: allErrors.join("; "),
    suggested_items: fulfilled.flatMap((result) => result.suggestedItems || []),
    price_range_removed_count: fulfilled.reduce((sum, result) => sum + result.priceRangeRemovedCount, 0),
    stale_cache: fulfilled.some((result) => result.staleCache)
  };
}

function sourceSearchUrls(site, body) {
  const categoryIds = categorySearchIds(body).filter((categoryId) => categoryId !== "all");
  const officialUrls = categoryIds.flatMap((categoryId) => {
    if (site === "bunjang") {
      return sourceCategoryIds(site, categoryId).map((sourceCategoryId) => (
        `https://m.bunjang.co.kr/categories/${encodeURIComponent(sourceCategoryId)}`
      ));
    }
    if (site === "joonggonara") {
      return sourceCategoryIds(site, categoryId).map((sourceCategoryId) => (
        `https://web.joongna.com/search?category=${encodeURIComponent(sourceCategoryId)}`
      ));
    }
    return [];
  });
  if (officialUrls.length) return [...new Set(officialUrls)];
  const keyword = categoryQuery(body);
  if (!keyword) return [];
  const encoded = encodeURIComponent(keyword);
  if (site === "bunjang") return [`https://m.bunjang.co.kr/search/products?keyword=${encoded}`];
  if (site === "joonggonara") return [`https://web.joongna.com/search/${encoded}`];
  if (site === "hellomarket") return [`https://www.hellomarket.com/search?q=${encoded}`];
  if (site === "rethinkmall") return [`https://web.rethinkmall.com/search?utm_source=bu&keyword=${encoded}`];
  return [];
}

function sourceSummary(site, items, mode, reason = "", filteredCount = 0, error = "", searchUrls = []) {
  const warnings = [];
  if (mode === "fallback") warnings.push("실시간 조회 실패로 최근 저장 결과를 표시했습니다");
  if (mode === "suggested") warnings.push("원 사이트 추천 검색어 결과를 표시했습니다");
  if (mode === "rate_limited") warnings.push("원 사이트 접속 제한으로 검색하지 못했습니다");
  if (mode === "unsupported") warnings.push("실시간 조회를 지원하지 않아 최근 저장 결과를 표시했습니다");
  if (mode === "unavailable") warnings.push("실시간 조회 결과가 없습니다");
  if (mode === "live" && items.length === 0) warnings.push("실시간 조회 결과가 없습니다");
  if (reason) warnings.push(reason);
  return {
    key: site,
    name: SOURCE_NAMES[site] || site,
    count: items.length,
    normalized_count: items.length,
    extracted_count: items.length,
    filtered_count: filteredCount,
    visible_count: items.length,
    collection_state: items.length > 0 ? "ready" : "empty",
    status: items.length > 0 ? "ready" : "warning",
    data_source: mode,
    search_urls: searchUrls,
    warnings,
    errors: error ? [error] : []
  };
}

function dedupeItems(items, limit) {
  const uniqueItems = [...new Map(items.filter(Boolean).map((item) => [item.id || canonicalListingKey(item), item])).values()].slice(0, limit);
  for (const key of ["received_count", "partial_error", "partial_notice", "suggested_items", "suggested_keyword", "stale_cache", "price_range_removed_count"]) {
    if (Object.hasOwn(items, key)) uniqueItems[key] = items[key];
  }
  return uniqueItems;
}

function canonicalListingKey(item) {
  const rawUrl = clean(item?.url, 2000);
  if (rawUrl) {
    try {
      const url = new URL(rawUrl);
      [...url.searchParams.keys()].forEach((key) => {
        if (/^(?:utm_|ref$|ref_|source$|tracking|fbclid|gclid)/i.test(key)) url.searchParams.delete(key);
      });
      url.searchParams.sort();
      url.hash = "";
      return `${clean(item?.site, 80)}:${url.toString()}`;
    } catch {
      // Use the source id or title/price fallback below.
    }
  }
  const sourceId = clean(item?.id || item?.item_id, 1000);
  if (sourceId) return `${clean(item?.site, 80)}:${sourceId}`;
  return `${clean(item?.site, 80)}:${normalizedSearchText(item?.title)}:${Number(item?.price) || 0}`;
}

function hardExclusionReason(item, body) {
  const title = clean(item?.title, 500);
  if (!title || !clean(item?.url, 2000)) return "missing_required";
  if (!priceInRange(item, requestedPriceRange(body))) return "price_range";
  if (/(?:판매|거래)\s*(?:완료|종료)|sold\s*out/i.test(title)) return "sold";
  if (/(?:^|[\s([{\/])(?:삽니다|구합니다|구해요|구함|구매글|구매합니다|구매해요|구매원합니다|매입합니다|매입해요)(?=$|[\s)\]}.,!?:\/])|최고가\s*매입|매입\s*문의|(?:팔아|판매해|나눔\s*해)\s*주실\s*분|구해\s*봅니다|구매\s*희망/i.test(title)) return "purchase_request";
  if (/^\s*\[?교환\]?|(?:교환|교신)\s*(?:원합니다|구합니다|해요|합니다|희망|하실\s*분|만|원함|봅니다)(?=$|[\s)\]}.,!?:\/])|(?:^|[\s([{\/])교환(?:만|원함|희망)(?=$|[\s)\]}.,!?:\/])|(?:^|[\s([{\/])교환\s*$/i.test(title)) return "exchange_only";
  if (/(?:^|\s)(?:광고|홍보)(?:\s|$)|구매\s*가이드|시세\s*(?:정보|안내)|가격\s*(?:문의|제시)|0원\s*(?:실화|특가)|요금제\s*(?:가입|조건)|사기\s*(?:당|피해|주의|$)|전\s*색상|선착순\s*(?:한정|특가)|할인\s*특가|특가\s*재고|재고\s*정리|마지막\s*재고|극\s*소량\s*재고|색상\s*별도\s*문의|별도\s*문의/i.test(title)) return "ad_or_guide";
  const categoryIds = categoryIdsFromBody(body);
  const isFreeShare = categoryIds.includes("free_share") || /무료\s*나눔|나눔합니다/i.test(title);
  const price = Number(item?.price);
  if (!isFreeShare && Number.isFinite(price) && price >= 0 && price <= 100) return "placeholder_price";
  if (body?.keyword && !matchesRequestedKeyword(item, body.keyword)) return "keyword_mismatch";
  if (body?.keyword && isKeywordCategoryNoise(keywordNoiseCategory("", body.keyword), item, body.keyword)) return "accessory_only";
  if (isClearAccessoryOnlyMismatch(item, body)) return "accessory_only";
  const policyReason = sitePolicyExclusionReason(item, body);
  if (policyReason) return policyReason;
  return "";
}

function listingQualityScore(item, body, priceMedian, priceSampleSize) {
  const title = normalizedSearchText(item?.title);
  const keyword = normalizedSearchText(body?.keyword);
  const terms = clean(body?.keyword, 80).split(/\s+/).filter(Boolean);
  let relevance = keyword && title.includes(keyword)
    ? 45
    : terms.length && terms.every((term) => searchTermVariants(term).some((variant) => title.includes(normalizedSearchText(variant))))
      ? 40
      : body?.keyword
        ? 30
        : 38;

  const ageDays = listingAgeDays(item);
  const freshness = ageDays === null ? 5 : ageDays <= 1 ? 20 : ageDays <= 7 ? 16 : ageDays <= 30 ? 10 : 4;

  const price = Number(item?.price);
  let priceReliability = Number.isFinite(price) && price > 100 ? 10 : 0;
  if (priceSampleSize >= 8 && Number.isFinite(priceMedian) && priceMedian > 0 && Number.isFinite(price) && price > 0) {
    const ratio = price / priceMedian;
    priceReliability = ratio >= 0.35 && ratio <= 2.8 ? 15 : ratio >= 0.2 && ratio <= 4 ? 7 : 2;
  }

  const completeness = (isLikelyProductImage(item?.image_url) ? 7 : 0) + (clean(item?.seller_name || item?.seller, 200) ? 3 : 0);
  const trust = (/^https:\/\//i.test(clean(item?.url, 2000)) ? 6 : 2)
    + (SUPPORTED_LIVE_SITES.has(item?.site) ? 4 : 0);
  const reservationPenalty = /예약\s*(?:중|완료)/i.test(clean(item?.title, 500)) ? 8 : 0;
  relevance = Math.max(0, relevance - reservationPenalty);
  return relevance + freshness + priceReliability + completeness + trust;
}

function priceQualityRank(item) {
  const price = Number(item?.price);
  if (!Number.isFinite(price) || price <= 100) return 3;
  const fraudRisk = Number(item?.fraud_risk);
  if (item?.noise_filtered === true || (Number.isFinite(fraudRisk) && fraudRisk >= 0 && fraudRisk <= 1 && fraudRisk > 0.45)) return 2;
  if (item?.price_suspect === true || item?.quality_suspect === true) return 1;
  return 0;
}

function priceSuspicionRatio(body, itemCategoryId = "") {
  const categoryIds = categoryIdsFromBody(body);
  const categoryId = keywordNoiseCategory(itemCategoryId || (categoryIds.length === 1 ? categoryIds[0] : ""), body?.keyword);
  // Model-specific phones have a tighter market range than broad fashion or
  // hobby searches. Keep extreme bargains visible, but require confirmation.
  return categoryId === "mobile" ? 0.60 : 0.45;
}

function selectQualifiedItems(items, limit, body) {
  const unique = [];
  const seen = new Set();
  const contentSeen = new Set();
  const dropped = {
    missing_required: 0,
    price_range: 0,
    sold: 0,
    purchase_request: 0,
    exchange_only: 0,
    ad_or_guide: 0,
    placeholder_price: 0,
    keyword_mismatch: 0,
    accessory_only: 0,
    site_price_floor: 0,
    stale_listing: 0,
    duplicate: 0
  };
  for (const item of items.filter(Boolean)) {
    const exclusionReason = hardExclusionReason(item, body);
    if (exclusionReason) {
      dropped[exclusionReason] += 1;
      continue;
    }
    const key = canonicalListingKey(item);
    const normalizedTitle = normalizedSearchText(item?.title);
    const contentKey = normalizedTitle.length >= 20
      ? `${clean(item?.site, 80)}:${normalizedTitle}:${Number(item?.price) || 0}`
      : "";
    if (seen.has(key) || (contentKey && contentSeen.has(contentKey))) {
      dropped.duplicate += 1;
      continue;
    }
    seen.add(key);
    if (contentKey) contentSeen.add(contentKey);
    unique.push(item);
  }

  const requestedCategoryIds = categoryIdsFromBody(body);
  const fallbackCategoryId = requestedCategoryIds.length === 1 ? requestedCategoryIds[0] : "all";
  const priceGroups = new Map();
  unique.forEach((item) => {
    const categoryId = clean(item?.category_id, 80) || fallbackCategoryId;
    const price = Number(item?.price);
    if (!Number.isFinite(price) || price <= 100) return;
    const values = priceGroups.get(categoryId) || [];
    values.push(price);
    priceGroups.set(categoryId, values);
  });
  const ranked = unique.map((item) => {
    const categoryId = clean(item?.category_id, 80) || fallbackCategoryId;
    const prices = priceGroups.get(categoryId) || [];
    const priceMedian = median(prices);
    const suspectRatio = priceSuspicionRatio(body, categoryId);
    const price = Number(item?.price);
    const priceSuspect = prices.length >= 8 && Number.isFinite(priceMedian) && priceMedian > 0 && Number.isFinite(price)
      ? price < priceMedian * suspectRatio
      : false;
    const itemTitle = clean(item?.title, 500);
    const conditionSuspect = /(?:액정\s*불량|파손(?:폰)?|고장(?:폰)?|락\s*걸린|부품용|정크|배터리\s*(?:방전|불량))/i.test(itemTitle);
    const commercialSuspect = /(?:전\s*색상|선착순\s*한정|특가\s*재고|시리즈[^\]]{0,30}(?:새상품|미개봉)|(?:새상품|미개봉)[^\]]{0,30}정품|정품[^\]]{0,30}(?:새상품|미개봉))/i.test(itemTitle);
    const sourceCommercialSuspect = item?.site === "hellomarket"
      ? /(?:새상품[^\]]{0,18}(?:택포|무배|무료배송)|홀복|클럽\s*의상|인기\s*옷)/i.test(itemTitle)
      : item?.site === "bunjang"
        ? /(?:할인\s*특가|재고\s*정리|실시간\s*리뷰|전\s*(?:기종|모델)|(?:13|14|15|16|17)[,\s/]+(?:13|14|15|16|17)[,\s/]+(?:13|14|15|16|17))/i.test(itemTitle)
        : item?.site === "joonggonara"
          ? /(?:이체시\s*\d|전국\s*택배|매장\s*판매)/i.test(itemTitle)
          : false;
    const sourcePriceCommercialSuspect = item?.site === "bunjang"
      && keywordNoiseCategory(categoryIdsFromBody(body)[0] || "", body?.keyword) === "mobile"
      && Number.isFinite(price)
      && price >= 100_000
      && price % 1_000 !== 0;
    return {
      ...item,
      score: listingQualityScore(item, body, priceMedian, prices.length),
      price_suspect: item?.price_suspect === true || priceSuspect,
      quality_suspect: item?.quality_suspect === true
        || (listingAgeDays(item) === null && item?.site !== "rethinkmall")
        || conditionSuspect
        || commercialSuspect
        || sourceCommercialSuspect
        || sourcePriceCommercialSuspect
        || isSoftAccessoryMismatch(item, body)
    };
  });
  const sortMode = requestedSort(body);
  const compareRisk = (left, right) => priceQualityRank(left) - priceQualityRank(right);
  const compareQuality = (left, right) => compareRisk(left, right)
    || (right.score - left.score);
  const compare = sortMode === "recent"
    ? (left, right) => (Date.parse(String(right.posted_at || "")) || 0) - (Date.parse(String(left.posted_at || "")) || 0)
      || compareRisk(left, right)
      || (right.score - left.score)
      || (Number(left.price) || Number.MAX_SAFE_INTEGER) - (Number(right.price) || Number.MAX_SAFE_INTEGER)
    : sortMode === "price_asc"
      ? (left, right) => (Number(left.price) || Number.MAX_SAFE_INTEGER) - (Number(right.price) || Number.MAX_SAFE_INTEGER)
      || compareRisk(left, right)
      || (right.score - left.score)
      || (Date.parse(String(right.posted_at || "")) || 0) - (Date.parse(String(left.posted_at || "")) || 0)
      : sortMode === "price_desc"
        ? (left, right) => sortableListingPrice(right, Number.NEGATIVE_INFINITY) - sortableListingPrice(left, Number.NEGATIVE_INFINITY)
          || compareRisk(left, right)
          || (right.score - left.score)
          || (Date.parse(String(right.posted_at || "")) || 0) - (Date.parse(String(left.posted_at || "")) || 0)
      : (left, right) => compareQuality(left, right)
        || (Date.parse(String(right.posted_at || "")) || 0) - (Date.parse(String(left.posted_at || "")) || 0)
        || (Number(left.price) || Number.MAX_SAFE_INTEGER) - (Number(right.price) || Number.MAX_SAFE_INTEGER);
  const sorted = ranked.sort((left, right) => compare(left, right)
    || canonicalListingKey(left).localeCompare(canonicalListingKey(right)));
  let selected = sorted;
  if (sortMode === "recommended" && new Set(sorted.map((item) => item.site)).size > 1) {
    const sourceCount = new Set(sorted.map((item) => item.site)).size;
    const firstScreenCap = Math.max(2, Math.ceil(requestedLimit(body) / sourceCount));
    const sourceCounts = new Map();
    const firstPass = [];
    const overflow = [];
    sorted.forEach((item) => {
      const count = sourceCounts.get(item.site) || 0;
      if (count < firstScreenCap) {
        firstPass.push(item);
        sourceCounts.set(item.site, count + 1);
      } else {
        overflow.push(item);
      }
    });
    selected = [...firstPass, ...overflow];
  }
  selected = selected.slice(0, limit);
  return {
    items: selected,
    audit: {
      sort: sortMode,
      candidate_count: items.filter(Boolean).length,
      qualified_count: ranked.length,
      selected_count: selected.length,
      soft_price_suspect_count: ranked.filter((item) => item.price_suspect).length,
      soft_quality_suspect_count: ranked.filter((item) => item.quality_suspect).length,
      dropped
    }
  };
}

function liveCursorFingerprint(body) {
  const canonical = JSON.stringify({
    keyword: clean(body?.keyword, 80).toLowerCase(),
    categories: categorySearchIds(body).slice().sort(),
    sites: requestedSites(body).slice().sort(),
    site_window: requestedSiteWindow(body),
    sort: requestedSort(body),
    price_range: requestedPriceRange(body)
  });
  let hash = 0x811c9dc5;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function liveSearchOffset(cursor, body) {
  if (cursor === undefined || cursor === null || cursor === "") return 0;
  const match = typeof cursor === "string" ? cursor.match(/^live-offset:v2:([a-z0-9]+):(\d+)$/) : null;
  if (!match) throw new Error("cursor must be a live search continuation cursor");
  if (match[1] !== liveCursorFingerprint(body)) {
    throw new Error("cursor does not match the current search filters");
  }
  const offset = Number(match[2]);
  const maxWindow = requestedSiteWindow(body) * Math.max(1, requestedSites(body).length);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > maxWindow) {
    throw new Error("cursor is outside the available live search window");
  }
  return offset;
}

function median(values) {
  const sorted = values.filter((value) => typeof value === "number" && value > 0).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function orderSelectedItems(items, body) {
  const sortMode = requestedSort(body);
  if (sortMode === "recommended") return items;
  return [...items].sort((left, right) => {
    const risk = priceQualityRank(left) - priceQualityRank(right);
    const score = (Number(right.score) || 0) - (Number(left.score) || 0);
    if (sortMode === "recent") {
      return (Date.parse(String(right.posted_at || "")) || 0) - (Date.parse(String(left.posted_at || "")) || 0)
        || risk
        || score
        || (Number(left.price) || Number.MAX_SAFE_INTEGER) - (Number(right.price) || Number.MAX_SAFE_INTEGER);
    }
    if (sortMode === "price_desc") {
      return sortableListingPrice(right, Number.NEGATIVE_INFINITY) - sortableListingPrice(left, Number.NEGATIVE_INFINITY)
        || risk
        || score
        || (Date.parse(String(right.posted_at || "")) || 0) - (Date.parse(String(left.posted_at || "")) || 0);
    }
    return (Number(left.price) || Number.MAX_SAFE_INTEGER) - (Number(right.price) || Number.MAX_SAFE_INTEGER)
      || risk
      || score
      || (Date.parse(String(right.posted_at || "")) || 0) - (Date.parse(String(left.posted_at || "")) || 0);
  });
}

function interleaveSelectedItems(sites, selections) {
  const result = [];
  const maximum = Math.max(0, ...selections.map((entry) => entry.items.length));
  for (let index = 0; index < maximum; index += 1) {
    for (const site of sites) {
      const item = selections.find((entry) => entry.site === site)?.items[index];
      if (item) result.push(item);
    }
  }
  return result;
}

function buildLivePayload(body, liveResults, fallbackPayload) {
  const sites = requestedSites(body);
  const limit = requestedLimit(body);
  const siteWindow = requestedSiteWindow(body);
  const sortMode = requestedSort(body);
  const priceRange = requestedPriceRange(body);
  const offset = liveSearchOffset(body?.cursor, body);
  const requestedCategories = categoryIdsFromBody(body);
  const categoryId = requestedCategories.length === 1 ? requestedCategories[0] : "all";
  const fallbackItems = filterCategoryItems(
    Array.isArray(fallbackPayload?.items) ? fallbackPayload.items : [],
    body
  ).filter((item) => !body?.keyword || matchesRequestedKeyword(item, body.keyword));
  const items = [];
  const sources = [];
  const qualityWarnings = [];
  const sourceBySite = new Map(liveResults.map((result) => [result.site, result]));

  for (const site of sites) {
    const live = sourceBySite.get(site);
    const liveItems = Array.isArray(live?.items) ? live.items : [];
    const suggestedItems = Array.isArray(live?.suggested_items) ? live.suggested_items : [];
    const storedItems = fallbackItems.filter((item) => item?.site === site);
    if (liveItems.length > 0) {
      items.push(...liveItems);
      const sourceMode = live?.stale_cache
        ? "fallback"
        : liveItems.some((item) => item?.upstream_keyword_fallback === true)
          ? "suggested"
          : "live";
      const sourceReason = [live?.filter_warning, live?.notice].filter(Boolean).join("; ");
      sources.push(sourceSummary(
        site,
        liveItems,
        sourceMode,
        sourceReason,
        live?.filtered_count || 0,
        live?.error || "",
        sourceSearchUrls(site, body)
      ));
      continue;
    }
    if (suggestedItems.length > 0) {
      const suggestedKeyword = suggestedItems[0]?.upstream_suggested_keyword || live?.suggested_keyword || "";
      const notice = live?.notice || (suggestedKeyword ? `UPSTREAM_SUGGESTED_KEYWORD:${suggestedKeyword}` : "");
      sources.push(sourceSummary(
        site,
        [],
        "suggested",
        notice,
        live?.filtered_count || 0,
        live?.error || "",
        sourceSearchUrls(site, body)
      ));
      qualityWarnings.push(`${site}: suggested_only`);
      continue;
    }
    if (storedItems.length > 0) {
      items.push(...storedItems);
      const mode = live?.supported === false ? "unsupported" : "fallback";
      sources.push(sourceSummary(
        site,
        storedItems,
        mode,
        live?.error ? "사이트 응답을 확인할 수 없습니다" : "",
        0,
        live?.error || "",
        sourceSearchUrls(site, body)
      ));
      qualityWarnings.push(`${site}: ${mode}`);
      continue;
    }
    // A successful live request that becomes empty after category filtering
    // is not an upstream outage. Keep its provenance as live so the UI does
    // not confuse a valid zero-result filter with an unavailable source.
    const mode = live?.supported === false
      ? "unsupported"
      : /^HTTP_429\b/i.test(live?.error || "")
        ? "rate_limited"
        : live?.error
          ? "unavailable"
          : "live";
    const sourceReason = [live?.filter_warning, live?.notice].filter(Boolean).join("; ");
    sources.push(sourceSummary(site, [], mode, sourceReason, 0, live?.error || "", sourceSearchUrls(site, body)));
    qualityWarnings.push(`${site}: ${live?.filter_warning ? "filtered_empty" : mode === "live" ? "live_empty" : mode}`);
    if (live?.notice) qualityWarnings.push(`${site}: ${live.notice}`);
  }

  const selections = sites.map((site) => {
    const siteItems = items.filter((item) => item?.site === site);
    return { site, ...selectQualifiedItems(siteItems, siteWindow, body) };
  });
  const orderedAvailableItems = sortMode === "recommended"
    ? interleaveSelectedItems(sites, selections)
    : orderSelectedItems(selections.flatMap((selection) => selection.items), body);
  const selection = {
    items: orderedAvailableItems,
    audit: {
      sort: sortMode,
      candidate_count: items.filter(Boolean).length,
      qualified_count: selections.reduce((sum, value) => sum + value.audit.qualified_count, 0),
      selected_count: orderedAvailableItems.length,
      soft_price_suspect_count: selections.reduce((sum, value) => sum + value.audit.soft_price_suspect_count, 0),
      soft_quality_suspect_count: selections.reduce((sum, value) => sum + value.audit.soft_quality_suspect_count, 0),
      dropped: Object.fromEntries(Object.keys(selections[0]?.audit.dropped || {}).map((key) => [
        key,
        selections.reduce((sum, value) => sum + (Number(value.audit.dropped[key]) || 0), 0)
      ]))
    }
  };
  selection.audit.dropped.price_range += liveResults.reduce(
    (sum, result) => sum + (Number(result?.price_range_removed_count) || 0),
    0
  );
  const availableItems = selection.items;
  const visibleItems = availableItems.slice(offset, offset + limit);
  const nextOffset = offset + visibleItems.length;
  const hasMore = nextOffset < availableItems.length;
  const visibleCounts = new Map();
  visibleItems.forEach((item) => visibleCounts.set(item.site, (visibleCounts.get(item.site) || 0) + 1));
  const visibleSources = sources.map((source) => {
    const totalCount = availableItems.filter((item) => item.site === source.key).length;
    const visibleCount = visibleCounts.get(source.key) || 0;
    return {
      ...source,
      total_count: totalCount,
      count: visibleCount,
      normalized_count: visibleCount,
      visible_count: visibleCount,
      collection_state: totalCount > 0 ? "ready" : "empty",
      status: totalCount > 0 ? "ready" : "warning"
    };
  });
  const prices = visibleItems.map((item) => item.price).filter((value) => typeof value === "number" && value > 0);
  const liveCount = liveResults.filter((result) => result.items?.length > 0 && !result.stale_cache).length;
  const fallbackCount = sources.filter((source) => source.data_source === "fallback" || source.data_source === "unsupported").length;
  const unavailableCount = sources.filter((source) => source.data_source === "unavailable").length;
  const rateLimitedCount = sources.filter((source) => source.data_source === "rate_limited").length;
  const liveEmptyCount = sources.filter((source) => source.data_source === "live" && source.count === 0).length;
  const suggestedCount = sources.filter((source) => source.data_source === "suggested").length;
  const liveErrorCount = liveResults.filter((result) => result.error).length;
  const dataSource = liveCount > 0 && (fallbackCount > 0 || suggestedCount > 0 || liveErrorCount > 0 || unavailableCount > 0 || rateLimitedCount > 0 || liveEmptyCount > 0)
    ? "mixed"
    : liveCount > 0
      ? "live"
      : liveEmptyCount > 0
        ? "live"
      : fallbackCount > 0
        ? "fallback"
        : suggestedCount > 0
          ? "suggested"
          : rateLimitedCount > 0
          ? "rate_limited"
          : unavailableCount > 0
            ? "unavailable"
            : "none";
  const searchedAt = new Date().toISOString();
  return {
    query: clean(body?.keyword, 80) || categoryQuery(body),
    category: categoryId !== "all" ? { id: categoryId } : null,
    categories: requestedCategories.map((id) => ({ id })),
    pagination: {
      has_more: hasMore,
      next_cursor: hasMore ? `live-offset:v2:${liveCursorFingerprint(body)}:${nextOffset}` : null
    },
    run_id: `live:${Date.now()}`,
    searched_at: searchedAt,
    sources: visibleSources,
    items: visibleItems,
    summary: {
      item_count: visibleItems.length,
      source_count: visibleSources.filter((source) => source.visible_count > 0).length,
      currency: new Set(visibleItems.map((item) => item.currency)).size === 1 ? (visibleItems[0]?.currency || "KRW") : "MIXED",
      median_price: median(prices),
      average_price: prices.length ? Math.round(prices.reduce((sum, value) => sum + value, 0) / prices.length) : null,
      lowest_price: prices.length ? Math.min(...prices) : null,
      highest_price: prices.length ? Math.max(...prices) : null,
      suspect_count: visibleItems.filter((item) => item.price_suspect || item.quality_suspect).length
    },
    market_snapshot: null,
    price_history: null,
    quality: {
      raw_count: liveResults.reduce((sum, result) => sum + (result.raw_count ?? result.items?.length ?? 0), 0),
      normalized_count: visibleItems.length,
      merged_count: visibleItems.length,
      available_count: availableItems.length,
      returned_count: visibleItems.length,
      page_offset: offset,
      page_limit: limit,
      site_window: siteWindow,
      site_count: sites.length,
      price_range: priceRange,
      selection: selection.audit,
      sort: sortMode,
      data_source: dataSource,
      warnings: qualityWarnings.concat(liveResults
        .filter((result) => result.filtered_count > 0)
        .map((result) => `${result.site}: ${result.filter_warning || "category_filter"}`), liveResults
        .filter((result) => result.error)
        .map((result) => `${result.site}: ${result.error}`), liveResults
        .filter((result) => result.notice)
        .map((result) => `${result.site}: ${result.notice}`))
    }
  };
}

function responseJson(status, body, headers = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers }
  });
}

async function readFallbackPayload(fallback, request, body, fallbackSites) {
  if (!fallbackSites.length) return { items: [] };
  const responses = await Promise.all(fallbackSites.map(async (site) => {
    try {
      const fallbackBody = {
        ...body,
        sites: [site],
        limit: requestedSiteWindow(body),
        site_window: requestedSiteWindow(body)
      };
      const fallbackRequest = new Request(request.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(fallbackBody)
      });
      const response = await fallback(fallbackRequest);
      if (!response.ok) return [];
      const payload = await response.json();
      return payload?.status === "success" && Array.isArray(payload?.data?.items) ? payload.data.items : [];
    } catch {
      return [];
    }
  }));
  return { items: responses.flat() };
}

async function liveSearchResponse(request, fallback) {
  let body;
  try {
    body = await request.clone().json();
  } catch {
    return responseJson(400, { status: "error", error: "Request body must be valid JSON" });
  }
  const keyword = categoryQuery(body);
  if (!keyword) return responseJson(400, { status: "error", error: "keyword or category_id is required" });
  const sites = requestedSites(body);
  const requestedSiteList = normalizeTargetSites(Array.isArray(body?.sites) ? body.sites : TARGET_SITES);
  const categoryIds = categoryIdsFromBody(body);
  if (categoryIds.length && Array.isArray(body?.sites)) {
    const unavailableSites = requestedSiteList.filter((site) => !sites.includes(site));
    if (unavailableSites.length > 0) {
      return responseJson(400, {
        status: "error",
        error: `Selected categories are unavailable for site(s): ${unavailableSites.join(", ")}`
      });
    }
  }
  if (categoryIds.length && sites.length === 0) {
    return responseJson(400, { status: "error", error: "No selected site has a verified category path for the requested categories" });
  }
  requestedLimit(body);
  try {
    requestedSiteWindow(body);
    requestedSort(body);
    requestedPriceRange(body);
    liveSearchOffset(body?.cursor, body);
  } catch (error) {
    return responseJson(400, { status: "error", error: error instanceof Error ? error.message : String(error) });
  }
  const liveResults = await Promise.all(sites.map(async (site) => {
    if (!SUPPORTED_LIVE_SITES.has(site)) return { site, supported: false, items: [], error: "unsupported" };
    try {
      return await collectLiveSite(site, body, sourceCandidateLimit(body), clean(body?.keyword, 80));
    } catch (error) {
      return { site, supported: true, items: [], error: error instanceof Error ? error.message : String(error) };
    }
  }));
  const fallbackSites = liveResults
    .filter((result) => !Array.isArray(result.items) || result.items.length === 0)
    .map((result) => result.site);
  const fallbackPayload = await readFallbackPayload(fallback, request, body, fallbackSites);
  const data = buildLivePayload(body, liveResults, fallbackPayload);
  return responseJson(200, { status: "success", data }, {
    "cache-control": `public, max-age=${LIVE_CACHE_TTL_SECONDS}`,
    "x-live-search-data-source": data.quality.data_source
  });
}

async function cacheKeyFor(request) {
  const body = await request.clone().arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", body);
  const hash = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
  return new Request(`https://used-market-live-cache-v2.invalid/api/search?${hash}`, { method: "GET" });
}

export async function fetchThroughLiveSearchCache(request, env, fallback) {
  if (request.method !== "POST" || !globalThis.caches?.default) {
    return liveSearchResponse(request, fallback);
  }
  const cacheKey = await cacheKeyFor(request);
  const cached = await caches.default.match(cacheKey);
  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set("x-live-search-cache", "HIT");
    return new Response(cached.body, { status: cached.status, headers });
  }
  const response = await liveSearchResponse(request, fallback);
  if (response.ok) {
    try {
      const payload = await response.clone().json();
      const sources = Array.isArray(payload?.data?.sources) ? payload.data.sources : [];
      const cacheable = (payload?.data?.items?.length || 0) > 0
        && sources.length > 0
        && sources.every((source) => source?.collection_state === "ready" && source?.data_source === "live");
      if (cacheable) {
        const cachedResponse = new Response(response.clone().body, {
          status: response.status,
          headers: { ...Object.fromEntries(response.headers), "cache-control": `public, max-age=${LIVE_CACHE_TTL_SECONDS}` }
        });
        await caches.default.put(cacheKey, cachedResponse);
      }
    } catch {
      // A response that cannot be cached is still returned to the user.
    }
  }
  const headers = new Headers(response.headers);
  headers.set("x-live-search-cache", "MISS");
  return new Response(response.body, { status: response.status, headers });
}

export { buildCollectionRequest, buildLivePayload, categoryQuery, collectOne, enrichHelloImages, matchesRequestedKeyword, parseJoongnaItems, parseTimestamp, requestedAcquisitionMode, requestedCollectionSites, requestedPriceRange, requestedSiteWindow, requestedSites, requestedSort, requestedViewSites, selectQualifiedItems, sourceCandidateLimit };
