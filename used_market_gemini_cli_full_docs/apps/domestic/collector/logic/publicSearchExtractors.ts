import {
  SearchResultSchema,
  type SearchCommandInput,
  type SearchItem,
  type SearchResult
} from "../../MCP/logic/types.js";
import { getDaangnSearchAreas } from "./sites/daangn.js";
import type { BrowserSiteAdapter } from "./sites/shared.js";
import { classifySearchOnlyListing } from "./searchOnlyCategoryClassifier.js";

type BunjangApiProduct = {
  pid?: string;
  name?: string;
  price?: string;
  status?: string;
  location?: string;
  uid?: string;
  update_time?: number;
  used?: number;
  tag?: string;
  product_image?: string;
  ad?: boolean;
  proshop?: boolean;
  free_shipping?: boolean;
};

type BunjangApiResponse = {
  result?: string;
  no_result?: boolean;
  no_result_message?: string | null;
  list?: BunjangApiProduct[];
};

type BunjangWebProduct = {
  pid?: number | string;
  name?: string;
  price?: number | string;
  status?: string;
  productImage?: string;
  shop?: { uid?: number | string };
  updatedAt?: string;
  ad?: boolean;
  freeShipping?: boolean;
  location?: string;
};

type BunjangWebSearchResponse = {
  data?: {
    responses?: {
      mainGrid?: {
        searchResponse?: {
          data?: BunjangWebProduct[];
          totalCount?: number;
          cursor?: string;
          nextCursor?: string;
        };
      };
    };
  };
};

type BunjangCategoryCursor = {
  upstreamCursor: string | null;
  itemOffset: number;
};

type JoonggonaraSearchProduct = {
  seq?: number;
  price?: number;
  title?: string;
  state?: number;
  sortDate?: string;
  mainLocationName?: string;
  articleUrl?: string;
  storeSeq?: number;
  chatCount?: number;
  wishCount?: number;
  detailImgUrl?: string;
  url?: string;
  locationNames?: string[];
};

type DaangnLdJsonSeller = {
  name?: string;
};

type DaangnLdJsonOffer = {
  price?: string | number;
  priceCurrency?: string;
  availability?: string;
  seller?: DaangnLdJsonSeller;
};

type DaangnLdJsonProduct = {
  name?: string;
  description?: string;
  image?: string;
  url?: string;
  offers?: DaangnLdJsonOffer;
};

type DaangnLdJsonListItem = {
  position?: number;
  item?: DaangnLdJsonProduct;
};

type DaangnLdJsonItemList = {
  numberOfItems?: number;
  itemListElement?: DaangnLdJsonListItem[];
};

type EbayBrowseItemSummary = {
  itemId?: string;
  title?: string;
  price?: {
    value?: string | number;
    currency?: string;
  };
  seller?: {
    username?: string;
  };
  itemWebUrl?: string;
  image?: {
    imageUrl?: string;
  };
  itemLocation?: {
    city?: string;
    stateOrProvince?: string;
    country?: string;
  };
  condition?: string;
  itemOriginDate?: string;
};

type EbayBrowseSearchResponse = {
  total?: number;
  itemSummaries?: EbayBrowseItemSummary[];
};

type EbayTokenResponse = {
  access_token?: string;
  expires_in?: number;
};

let ebayTokenCache: { token: string; expiresAt: number } | null = null;

export function resetEbayTokenCacheForTests() {
  ebayTokenCache = null;
}

type SearchPaginationDraft = {
  has_more: boolean;
  next_cursor: string | null;
};

type DaangnExtractionResult = {
  items: SearchItem[];
  failedAreas: string[];
};

class BunjangCategoryApiError extends Error {
  constructor(detail: string) {
    super(`BUNJANG_CATEGORY_API_ERROR: ${detail}`);
    this.name = "BunjangCategoryApiError";
  }
}

class BunjangSearchApiError extends Error {
  constructor(detail: string) {
    super(`BUNJANG_SEARCH_API_ERROR: ${detail}`);
    this.name = "BunjangSearchApiError";
  }
}

const BUNJANG_GENERIC_QUERY_TOKENS = new Set([
  "pc",
  "full",
  "gaming",
  "desktop",
  "tower",
  "computer",
  "set",
  "bundle",
  "중고",
  "컴퓨터",
  "게이밍",
  "데스크탑",
  "본체",
  "조립",
  "조립pc",
  "조립컴퓨터",
  "판매"
]);

const BUNJANG_NEGATIVE_VERTICAL_PATTERNS = [
  { label: "car-parts", pattern: /(자동차|차량|오토바이|바이크|car\s*parts|휠|wheel|타이어|tire|브레이크|brake|범퍼|bumper|에어컨\s*컴프레서|aircon\s*compressor|compressor|사이드미러|헤드라이트|headlight|도어|엔진오일|쇼바|서스펜션|머플러)/i },
  { label: "golf", pattern: /(골프|golf|골프채|golf\s*club|golf\s*driver|아이언|iron|우드|wood|유틸|utility|웨지|wedge|퍼터|putter|캐디백|샤프트|shaft)/i },
  { label: "appliance", pattern: /(냉장고|refrigerator|세탁기|washer|건조기|dryer|청소기|vacuum|cleaner|에어컨|air\s*conditioner|공기청정기|전동\s*칫솔|toothbrush|전자레인지|microwave|오븐|oven|밥솥|rice\s*cooker|정수기|식기세척기|dishwasher|가습기|제습기|appliance)/i }
];

const BUNJANG_COMPONENT_EVIDENCE_PATTERN =
  /(rtx|gtx|rx\s*\d{3,4}|그래픽\s*카드|그래픽카드|gpu|지포스|geforce|라데온|radeon|ryzen|라이젠|intel|cpu|i[3579][\s-]?\d{3,5}[a-z]{0,2}|ddr\d|ram\b|램\b|메모리|ssd|nvme|m\.2|hdd|메인보드|motherboard|mainboard|mobo|am4\b|am5\b|a\d{3,4}m\b|b\d{3,4}m\b|x\d{3,4}\b|z\d{3,4}\b|파워서플라이|power\s*supply|psu|케이스)/i;

const BUNJANG_BROAD_PC_QUERY_PATTERN =
  /(pc|computer|desktop|tower|컴퓨터|데스크탑|조립\s*pc|조립pc|조립\s*컴퓨터|조립컴퓨터|게이밍\s*pc|게이밍pc|게이밍\s*컴퓨터|게이밍컴퓨터|본체)/i;

const BUNJANG_FULL_PC_CONTEXT_PATTERN =
  /(조립\s*pc|조립pc|조립\s*컴퓨터|조립컴퓨터|게이밍\s*pc|게이밍pc|게이밍\s*컴퓨터|게이밍컴퓨터|사무용\s*pc|사무용\s*컴퓨터|컴퓨터\s*본체|데스크탑\s*본체|desktop\s*pc|gaming\s*pc|office\s*pc)/i;

function parseItemStatus(value: string | number | null | undefined): SearchItem["status"] {
  const normalized = String(value ?? "");
  if (normalized === "0" || /^(SELLING|ACTIVE)$/i.test(normalized)) return "active";
  if (normalized === "1" || /^(RESERVED|HOLD)$/i.test(normalized)) return "reserved";
  if (normalized === "2" || /^(SOLD|COMPLETED|CLOSED)$/i.test(normalized)) return "sold";
  return "unknown";
}

function parseSaleStatus(value: string | number | null | undefined): SearchItem["sale_status"] {
  const normalized = String(value ?? "");
  if (normalized === "1" || /^(RESERVED|HOLD)$/i.test(normalized)) return "reserved";
  if (normalized === "2" || /^(SOLD|COMPLETED|CLOSED)$/i.test(normalized)) return "completed";
  return "active";
}

function parseNumericPrice(value: string | number | null | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/,/g, "").trim();
  if (/^\d+(?:\.\d+)?$/.test(normalized)) {
    const parsedNumeric = Number(normalized);
    return Number.isFinite(parsedNumeric) ? parsedNumeric : null;
  }

  const digits = value.replace(/[^\d]/g, "");
  if (digits === "") {
    return null;
  }

  const parsed = Number(digits);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildUploadDate(postedAt: string): string {
  const trimmed = postedAt.trim();
  if (trimmed === "") {
    return "";
  }

  const firstSpace = trimmed.indexOf(" ");
  return firstSpace >= 0 ? trimmed.slice(0, firstSpace) : trimmed.slice(0, 10);
}

function deriveDaangnArticleMonth(imageUrl: string): string {
  const match = imageUrl.match(/\/origin\/article\/(\d{4})(\d{2})\//i);
  if (!match) {
    return "";
  }

  const [, year, month] = match;
  return `${year}-${month}-01`;
}

function parseDaangnAvailability(value: string | undefined): SearchItem["sale_status"] {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized.includes("outofstock") || normalized.includes("soldout")) {
    return "completed";
  }
  return "active";
}

function hasKnownDaangnAvailability(value: string | undefined): boolean {
  const normalized = String(value ?? "").toLowerCase();
  return normalized.includes("instock")
    || normalized.includes("available")
    || normalized.includes("outofstock")
    || normalized.includes("soldout");
}

function ensureAbsoluteUrl(value: string, baseUrl: string): string {
  if (value.trim() === "") {
    return "";
  }

  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  if (value.startsWith("/")) {
    return `${baseUrl}${value}`;
  }

  return `${baseUrl}/${value}`;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function tokenizeComparableText(value: string): string[] {
  return value.toLowerCase().match(/[a-z]+\d+[a-z]*|\d+[a-z]+|[a-z]+|\d+|[가-힣]+/g) ?? [];
}

function compactComparableText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9가-힣]+/g, "");
}

function buildBunjangKeywordTerms(keyword: string): string[] {
  return tokenizeComparableText(keyword)
    .filter((token) => !BUNJANG_GENERIC_QUERY_TOKENS.has(token))
    .filter((token, index, tokens) => tokens.indexOf(token) === index);
}

function isModelLikeKeywordTerm(term: string): boolean {
  return /\d/.test(term) || /[a-z]{3,}/.test(term);
}

function hasBunjangHardwareEvidence(haystack: string): boolean {
  if (BUNJANG_COMPONENT_EVIDENCE_PATTERN.test(haystack)) {
    return true;
  }

  return BUNJANG_FULL_PC_CONTEXT_PATTERN.test(haystack);
}

function detectBunjangNegativeVertical(haystack: string): string | null {
  const matched = BUNJANG_NEGATIVE_VERTICAL_PATTERNS.find(({ pattern }) => pattern.test(haystack));
  return matched?.label ?? null;
}

function shouldKeepBunjangProduct(input: SearchCommandInput, product: BunjangApiProduct): { keep: true } | { keep: false; reason: string } {
  const title = typeof product.name === "string" ? product.name : "";
  const tag = typeof product.tag === "string" ? product.tag : "";
  const haystack = `${title} ${tag}`.trim();
  const compactHaystack = compactComparableText(haystack);
  const keywordTerms = buildBunjangKeywordTerms(input.keyword);
  const matchCount = keywordTerms.filter((term) => compactHaystack.includes(compactComparableText(term))).length;
  const hasHardwareEvidence = hasBunjangHardwareEvidence(haystack);
  const negativeVertical = detectBunjangNegativeVertical(haystack);
  const isHardwareQuery = BUNJANG_BROAD_PC_QUERY_PATTERN.test(input.keyword)
    || BUNJANG_COMPONENT_EVIDENCE_PATTERN.test(input.keyword);

  if (isHardwareQuery && negativeVertical && !hasHardwareEvidence) {
    return { keep: false, reason: `non-pc-${negativeVertical}` };
  }

  const isBroadPcQuery = BUNJANG_BROAD_PC_QUERY_PATTERN.test(input.keyword) || keywordTerms.length === 0;
  if (isHardwareQuery && isBroadPcQuery) {
    return hasHardwareEvidence
      ? { keep: true }
      : { keep: false, reason: "broad-query-without-hardware-evidence" };
  }

  const compactKeyword = compactComparableText(input.keyword);
  if (compactKeyword !== "" && compactHaystack.includes(compactKeyword)) {
    return { keep: true };
  }

  if (keywordTerms.length === 0) {
    return isHardwareQuery && !hasHardwareEvidence
      ? { keep: false, reason: "missing-keyword-terms" }
      : { keep: true };
  }

  if (matchCount === keywordTerms.length) {
    return { keep: true };
  }

  if (matchCount > 0 && hasHardwareEvidence) {
    return { keep: true };
  }

  if (keywordTerms.some(isModelLikeKeywordTerm) && matchCount === 0) {
    return { keep: false, reason: "missing-model-match" };
  }

  return { keep: false, reason: "weak-keyword-relevance" };
}

function buildResult(
  adapter: BrowserSiteAdapter,
  input: SearchCommandInput,
  items: SearchItem[],
  warnings: string[] = [],
  filteredCount = 0,
  errors: string[] = [],
  pagination: SearchPaginationDraft = { has_more: false, next_cursor: null }
): SearchResult {
  return SearchResultSchema.parse({
    site: adapter.siteKey,
    keyword: input.keyword,
    login_status: "unknown",
    items,
    warnings,
    quality_meta: {
      extracted_count: items.length,
      filtered_count: filteredCount,
      duplicate_count: 0,
      warning_count: warnings.length
    },
    next_action: items.length > 0 ? "normalize" : "inspect_keyword",
    errors,
    pagination
  });
}

function readPositiveIntegerEnv(name: string, fallback: number) {
  const parsed = Number(process.env[name] ?? "");
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : fallback;
}

function getDaangnOverfetchMultiplier() {
  return readPositiveIntegerEnv("PUBLIC_SEARCH_DAANGN_OVERFETCH_MULTIPLIER", 2);
}

function getBunjangOverfetchMultiplier() {
  return readPositiveIntegerEnv("PUBLIC_SEARCH_BUNJANG_OVERFETCH_MULTIPLIER", 3);
}

async function getEbayBrowseToken(): Promise<string> {
  const configuredToken = process.env.EBAY_BROWSE_API_TOKEN?.trim();
  if (configuredToken) return configuredToken;
  if (ebayTokenCache && ebayTokenCache.expiresAt > Date.now() + 60_000) return ebayTokenCache.token;

  const clientId = process.env.EBAY_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.EBAY_CLIENT_SECRET?.trim() ?? "";
  if (!clientId || !clientSecret) return "";

  const credentials = Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64");
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "https://api.ebay.com/oauth/api_scope"
  });
  const response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Basic ${credentials}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body
  });
  if (!response.ok) throw new Error(`EBAY_OAUTH_ERROR: HTTP ${response.status}`);
  const payload = await response.json() as EbayTokenResponse;
  const token = typeof payload.access_token === "string" ? payload.access_token.trim() : "";
  if (!token) throw new Error("EBAY_OAUTH_ERROR: token response did not include access_token");
  const expiresIn = Number.isFinite(payload.expires_in) ? Math.max(120, Number(payload.expires_in)) : 7200;
  ebayTokenCache = { token, expiresAt: Date.now() + expiresIn * 1000 };
  return token;
}

function parsePageCursor(cursor: string | null | undefined) {
  const match = typeof cursor === "string" ? cursor.match(/^page:(\d+)$/) : null;
  return match ? Math.max(0, Number(match[1])) : 0;
}

function parseOffsetCursor(cursor: string | null | undefined) {
  const match = typeof cursor === "string" ? cursor.match(/^offset:(\d+)$/) : null;
  return match ? Math.max(0, Number(match[1])) : 0;
}

export function buildSearchPagination(
  adapter: BrowserSiteAdapter,
  input: SearchCommandInput,
  itemCount: number,
  total?: number
): SearchPaginationDraft {
  if (adapter.searchPagination === "page") {
    const hasMore = itemCount >= input.limit;
    const currentPage = parsePageCursor(input.cursor);
    const nextPage = adapter.siteKey === "joonggonara" && currentPage === 0
      ? 2
      : currentPage + 1;
    return { has_more: hasMore, next_cursor: hasMore ? `page:${nextPage}` : null };
  }

  if (adapter.searchPagination === "offset") {
    const offset = parseOffsetCursor(input.cursor);
    const hasMore = typeof total === "number"
      ? offset + itemCount < total
      : itemCount >= input.limit;
    const nextOffset = offset + input.limit;
    return { has_more: hasMore, next_cursor: hasMore ? `offset:${nextOffset}` : null };
  }

  return { has_more: false, next_cursor: null };
}

function mapEbayBrowseItem(item: EbayBrowseItemSummary, index: number): SearchItem {
  const title = typeof item.title === "string" ? item.title.trim() : "";
  const imageUrl = typeof item.image?.imageUrl === "string" ? item.image.imageUrl : "";
  const location = [item.itemLocation?.city, item.itemLocation?.stateOrProvince, item.itemLocation?.country]
    .filter((value): value is string => typeof value === "string" && value.trim() !== "")
    .join(", ");
  const postedAt = typeof item.itemOriginDate === "string" ? item.itemOriginDate : "";
  const url = typeof item.itemWebUrl === "string" && item.itemWebUrl.trim() !== ""
    ? item.itemWebUrl
    : item.itemId
      ? `https://www.ebay.com/itm/${encodeURIComponent(item.itemId)}`
      : "";

  return {
    title,
    price: parseNumericPrice(item.price?.value),
    currency: typeof item.price?.currency === "string" && item.price.currency.trim() !== ""
      ? item.price.currency
      : "USD",
    price_label: "",
    seller: typeof item.seller?.username === "string" ? item.seller.username : "",
    status: "unknown",
    condition: typeof item.condition === "string" ? item.condition : "",
    shipping: "",
    location,
    posted_at: postedAt,
    url,
    image_url: imageUrl,
    notes: [
      "source=ebay-browse-api",
      `row=${index + 1}`,
      item.itemId ? `item_id=${item.itemId}` : ""
    ].filter(Boolean).join("; "),
    listing_type_hint: "unknown",
    warnings: [
      "SALE_STATUS_UNAVAILABLE",
      ...(item.price?.value == null ? ["PRICE_UNPARSEABLE"] : [])
    ],
    sale_status: "active",
    estimated_deal_price: null,
    price_change_count: 0,
    upload_date: buildUploadDate(postedAt),
    seller_upload_count: 0,
    description_length: title.length,
    has_photo: imageUrl.trim() !== "",
    canonical_category_id: "",
    canonical_category_path: [],
    source_category_id: "",
    source_category_ids: [],
    source_category_path: [],
    category_confidence: "unknown",
    category_mapping_mode: "single",
    category_mapping_confidence: "unknown"
  };
}

async function tryExtractEbayBrowseApiResult(
  adapter: BrowserSiteAdapter,
  input: SearchCommandInput
): Promise<SearchResult | null> {
  try {
    const token = await getEbayBrowseToken();
    if (!token) {
      return SearchResultSchema.parse({
        ...buildResult(adapter, input, [], ["EBAY_CREDENTIALS_REQUIRED: eBay Client ID and Client Secret are not configured"]),
        next_action: "configure_ebay_credentials"
      });
    }

    const url = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
    url.searchParams.set("q", input.keyword.trim() || input.category?.label || "");
    url.searchParams.set("limit", String(Math.min(Math.max(input.limit, 1), 200)));
    const offset = parseOffsetCursor(input.cursor);
    if (offset > 0) url.searchParams.set("offset", String(offset));
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        "x-ebay-c-marketplace-id": "EBAY_US"
      }
    });

    if (!response.ok) {
      return buildResult(
        adapter,
        input,
        [],
        [`EBAY_BROWSE_API_ERROR: HTTP ${response.status}`],
        0,
        [`EBAY_BROWSE_API_ERROR: Browse API returned HTTP ${response.status}`]
      );
    }

    const payload = await response.json() as EbayBrowseSearchResponse;
    const summaries = Array.isArray(payload.itemSummaries) ? payload.itemSummaries : [];
    const items = summaries
      .map(mapEbayBrowseItem)
      .filter((item) => item.title !== "" && item.price !== null && item.url !== "")
      .slice(0, input.limit);
    const warnings = items.length > 0 ? ["EBAY_SALE_STATUS_UNAVAILABLE"] : ["EBAY_BROWSE_API_EMPTY: no items returned"];
    return buildResult(
      adapter,
      input,
      items,
      warnings,
      0,
      [],
      buildSearchPagination(adapter, input, items.length, payload.total)
    );
  } catch (error) {
    const message = error instanceof Error && /^EBAY_[A-Z_]+:/u.test(error.message)
      ? error.message
      : "EBAY_BROWSE_API_ERROR: request failed";
    return buildResult(
      adapter,
      input,
      [],
      [message],
      0,
      [message]
    );
  }
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7"
      }
    });

    if (!response.ok) {
      return null;
    }

    return await response.text();
  } catch {
    return null;
  }
}

function parseJoonggonaraItemsFromHtml(pageHtml: string): JoonggonaraSearchProduct[] {
  const normalizedPageHtml = pageHtml.replace(/&quot;/g, "\"");
  const patterns = [
    { start: "\\\"items\\\":[", end: "],\\\"changedProductFilterType\\\"", escaped: true },
    { start: "\"items\":[", end: "],\"changedProductFilterType\"", escaped: false }
  ];

  for (const pattern of patterns) {
    const start = normalizedPageHtml.indexOf(pattern.start);
    if (start < 0) {
      continue;
    }

    const end = normalizedPageHtml.indexOf(pattern.end, start + pattern.start.length);
    if (end < 0) {
      continue;
    }

    const fragment = normalizedPageHtml.slice(start + pattern.start.length, end);
    const jsonText = `[${pattern.escaped ? fragment.replace(/\\"/g, "\"") : fragment}]`;
    try {
      const parsed = JSON.parse(jsonText) as unknown;
      if (Array.isArray(parsed)) {
        return parsed as JoonggonaraSearchProduct[];
      }
    } catch {
      continue;
    }
  }

  return [];
}

function parseDaangnItemsFromHtml(pageHtml: string): DaangnLdJsonProduct[] {
  const scriptMatch = pageHtml.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
  if (!scriptMatch) {
    return [];
  }

  try {
    const parsed = JSON.parse(decodeHtmlEntities(scriptMatch[1])) as DaangnLdJsonItemList;
    if (!Array.isArray(parsed.itemListElement)) {
      return [];
    }

    return parsed.itemListElement
      .map((entry) => entry.item)
      .filter((item): item is DaangnLdJsonProduct => Boolean(item && typeof item.url === "string"));
  } catch {
    return [];
  }
}

function mapJoonggonaraItem(product: JoonggonaraSearchProduct, index: number): SearchItem {
  const postedAt = typeof product.sortDate === "string" ? product.sortDate : "";
  const locationNames = Array.isArray(product.locationNames) ? product.locationNames.filter((value) => typeof value === "string") : [];
  const seq = typeof product.seq === "number" ? String(product.seq) : "";
  const detailUrl = ensureAbsoluteUrl(product.articleUrl ?? "", "https://web.joongna.com")
    || (seq ? `https://web.joongna.com/product/${seq}` : "");
  const notes = [
    "source=next-data",
    "site=joonggonara",
    `row=${index + 1}`,
    typeof product.wishCount === "number" ? `wish_count=${product.wishCount}` : "",
    typeof product.chatCount === "number" ? `chat_count=${product.chatCount}` : ""
  ].filter(Boolean).join("; ");

  return {
    title: typeof product.title === "string" ? product.title : "",
    price: parseNumericPrice(product.price),
    currency: "KRW",
    price_label: "",
    seller: typeof product.storeSeq === "number" ? `store:${product.storeSeq}` : "",
    status: parseItemStatus(product.state),
    condition: "",
    shipping: "",
    location: locationNames[0] ?? (typeof product.mainLocationName === "string" ? product.mainLocationName : ""),
  posted_at: postedAt,
    url: detailUrl,
    image_url: ensureAbsoluteUrl(product.detailImgUrl ?? product.url ?? "", "https://web.joongna.com"),
    notes,
    listing_type_hint: "unknown",
    warnings: [],
    sale_status: parseSaleStatus(product.state),
    estimated_deal_price: null,
    price_change_count: 0,
    upload_date: buildUploadDate(postedAt),
    seller_upload_count: 0,
    description_length: typeof product.title === "string" ? product.title.length : 0,
    has_photo: Boolean((product.detailImgUrl ?? product.url ?? "").trim()),
    canonical_category_id: "",
    canonical_category_path: [],
    source_category_id: "",
    source_category_ids: [],
    source_category_path: [],
    category_confidence: "unknown",
    category_mapping_mode: "single",
    category_mapping_confidence: "unknown"
  };
}

function mapDaangnItem(product: DaangnLdJsonProduct, area: string, index: number): SearchItem {
  const imageUrl = typeof product.image === "string"
    ? ensureAbsoluteUrl(product.image, "https://www.daangn.com")
    : "";
  const description = typeof product.description === "string" ? product.description : "";
  const uploadDate = deriveDaangnArticleMonth(imageUrl);
  const saleStatus = parseDaangnAvailability(product.offers?.availability);
  const availabilityKnown = hasKnownDaangnAvailability(product.offers?.availability);
  const notes = [
    "source=ld-json",
    "site=daangn",
    `area=${area}`,
    `row=${index + 1}`,
    description ? `description=${description.slice(0, 240)}` : "",
    uploadDate ? `derived_upload_month=${uploadDate}` : "",
    saleStatus !== "active" ? `availability=${String(product.offers?.availability ?? "")}` : "",
    !availabilityKnown ? "availability_unverified=true" : ""
  ].filter(Boolean).join("; ");

  return {
    title: typeof product.name === "string" ? product.name : "",
    price: parseNumericPrice(product.offers?.price),
    currency: typeof product.offers?.priceCurrency === "string" ? product.offers.priceCurrency : "KRW",
    price_label: "",
    seller: typeof product.offers?.seller?.name === "string" ? product.offers.seller.name : "",
    status: availabilityKnown ? saleStatus === "completed" ? "sold" : "active" : "unknown",
    condition: "",
    shipping: "",
    location: area,
    posted_at: "",
    url: typeof product.url === "string" ? ensureAbsoluteUrl(product.url, "https://www.daangn.com") : "",
    image_url: imageUrl,
    notes,
    listing_type_hint: "unknown",
    warnings: availabilityKnown ? [] : ["AVAILABILITY_UNAVAILABLE"],
    sale_status: saleStatus,
    estimated_deal_price: null,
    price_change_count: 0,
    upload_date: uploadDate,
    seller_upload_count: 0,
    description_length: description.length,
    has_photo: imageUrl.trim() !== "",
    canonical_category_id: "",
    canonical_category_path: [],
    source_category_id: "",
    source_category_ids: [],
    source_category_path: [],
    category_confidence: "unknown",
    category_mapping_mode: "single",
    category_mapping_confidence: "unknown"
  };
}

async function fetchBunjangSearchPayload(
  input: SearchCommandInput,
  fetchLimit = input.limit
): Promise<BunjangApiResponse & { list: BunjangApiProduct[] }> {
  const url = new URL("https://api.bunjang.co.kr/api/1/find_v2.json");
  url.searchParams.set("q", input.keyword);
  url.searchParams.set("n", String(Math.max(1, fetchLimit)));
  url.searchParams.set("page", String(parsePageCursor(input.cursor)));
  url.searchParams.set("order", "date");
  url.searchParams.set("stat_device", "w");
  url.searchParams.set("version", "4");

  const response = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      accept: "application/json, text/plain, */*",
      referer: "https://m.bunjang.co.kr/",
      "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7"
    }
  });

  if (!response.ok) {
    throw new BunjangSearchApiError(`HTTP ${response.status}`);
  }

  let payload: BunjangApiResponse;
  try {
    payload = await response.json() as BunjangApiResponse;
  } catch {
    throw new BunjangSearchApiError("invalid JSON response");
  }
  if (!Array.isArray(payload.list)) {
    throw new BunjangSearchApiError("unsupported response shape");
  }
  return payload as BunjangApiResponse & { list: BunjangApiProduct[] };
}

async function fetchBunjangCategorySearchPayload(
  input: SearchCommandInput
): Promise<({ products: BunjangWebProduct[]; total: number | undefined; nextCursor: string | null } & BunjangCategoryCursor) | null> {
  const sourceCategoryId = input.sourceCategoryId?.trim();
  if (!sourceCategoryId) {
    return null;
  }

  const cursor = decodeBunjangCategoryCursor(input.cursor);
  if (!cursor) {
    return null;
  }

  const url = new URL("https://api.bunjang.co.kr/api/search/v8/web/search");
  url.searchParams.set("categoryId", sourceCategoryId);
  url.searchParams.set("policyKey", "pw.product.category");
  url.searchParams.set("size", "60");
  if (cursor.upstreamCursor) {
    url.searchParams.set("cursor", cursor.upstreamCursor);
  }

  const context = Buffer.from(JSON.stringify({
    device: { is_bunjang_webview: false, os: "Windows" }
  }), "utf8").toString("base64");
  const response = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      accept: "application/json, text/plain, */*",
      referer: `https://m.bunjang.co.kr/categories/${encodeURIComponent(sourceCategoryId)}`,
      "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
      "x-bun-context": context
    }
  });

  if (!response.ok) {
    throw new BunjangCategoryApiError(`HTTP ${response.status}`);
  }

  let payload: BunjangWebSearchResponse;
  try {
    payload = await response.json() as BunjangWebSearchResponse;
  } catch {
    throw new BunjangCategoryApiError("invalid JSON response");
  }
  const searchResponse = payload.data?.responses?.mainGrid?.searchResponse;
  if (!searchResponse || !Array.isArray(searchResponse.data)) {
    throw new BunjangCategoryApiError("unsupported response shape");
  }

  return {
    products: searchResponse.data,
    total: typeof searchResponse.totalCount === "number" ? searchResponse.totalCount : undefined,
    nextCursor: typeof searchResponse.nextCursor === "string" && searchResponse.nextCursor.trim() !== ""
      ? searchResponse.nextCursor
      : null,
    upstreamCursor: cursor.upstreamCursor,
    itemOffset: cursor.itemOffset
  };
}

const BUNJANG_CATEGORY_CURSOR_PREFIX = "slice:v1:";

function encodeBunjangCategoryCursor(upstreamCursor: string | null, itemOffset: number): string {
  return `${BUNJANG_CATEGORY_CURSOR_PREFIX}${Buffer.from(JSON.stringify({
    upstream_cursor: upstreamCursor,
    item_offset: Math.max(0, Math.floor(itemOffset))
  }), "utf8").toString("base64url")}`;
}

function decodeBunjangCategoryCursor(cursor: string | null | undefined): BunjangCategoryCursor | null {
  if (!cursor || cursor.startsWith("page:")) {
    return { upstreamCursor: null, itemOffset: 0 };
  }

  if (!cursor.startsWith(BUNJANG_CATEGORY_CURSOR_PREFIX)) {
    return { upstreamCursor: cursor, itemOffset: 0 };
  }

  try {
    const encoded = cursor.slice(BUNJANG_CATEGORY_CURSOR_PREFIX.length);
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as {
      upstream_cursor?: unknown;
      item_offset?: unknown;
    };
    const itemOffset = typeof parsed.item_offset === "number" && Number.isInteger(parsed.item_offset)
      ? Math.max(0, parsed.item_offset)
      : null;
    const upstreamCursor = parsed.upstream_cursor === null || parsed.upstream_cursor === undefined
      ? null
      : typeof parsed.upstream_cursor === "string" && parsed.upstream_cursor.trim() !== ""
        ? parsed.upstream_cursor
        : null;
    return itemOffset === null ? null : { upstreamCursor, itemOffset };
  } catch {
    return null;
  }
}

function filterBunjangProducts(input: SearchCommandInput, products: BunjangApiProduct[]) {
  const kept: BunjangApiProduct[] = [];
  const warnings: string[] = [];
  let filteredCount = 0;

  for (const product of products) {
    const decision = shouldKeepBunjangProduct(input, product);
    if (decision.keep) {
      kept.push(product);
      continue;
    }

    filteredCount += 1;
    const title = typeof product.name === "string" && product.name.trim() !== "" ? product.name.trim() : "(untitled)";
    warnings.push(`Dropped bunjang public result due to ${decision.reason}: ${title}`);
  }

  return {
    kept,
    warnings,
    filteredCount
  };
}

function formatUnixTimestamp(value: number | undefined): string {
  if (!Number.isFinite(value)) {
    return "";
  }

  return new Date(Number(value) * 1000).toISOString();
}

function isBunjangCategoryConflict(categoryId: string, title: string): boolean {
  const inferredCategoryId = classifySearchOnlyListing({ title }).canonical_category_id;
  if (!inferredCategoryId) return false;

  const strictVerticals = new Set([
    "mobile",
    "appliances",
    "pc",
    "camera",
    "furniture",
    "living",
    "games",
    "books",
    "tickets",
    "sports",
    "motorcycle",
    "tools"
  ]);
  if (strictVerticals.has(categoryId)) {
    return inferredCategoryId !== categoryId;
  }

  if (categoryId === "fashion") {
    return !inferredCategoryId.startsWith("fashion") && inferredCategoryId !== "luxury";
  }
  if (categoryId === "fashion_women") {
    return inferredCategoryId === "fashion_men" || inferredCategoryId.startsWith("fashion_men_");
  }
  if (categoryId === "fashion_men") {
    return inferredCategoryId === "fashion_women" || inferredCategoryId.startsWith("fashion_women_");
  }

  return false;
}

function isBunjangCategoryBrowseQuery(input: SearchCommandInput) {
  const keyword = input.keyword.trim();
  const categoryLabel = input.category?.label.trim() ?? "";
  return keyword === "" || keyword === categoryLabel;
}

function shouldKeepBunjangCategoryKeyword(input: SearchCommandInput, title: string) {
  if (isBunjangCategoryBrowseQuery(input)) return true;

  const categoryTerms = new Set(buildBunjangKeywordTerms(input.category?.label ?? ""));
  const terms = buildBunjangKeywordTerms(input.keyword)
    .filter((term) => !categoryTerms.has(term));
  if (terms.length === 0) return true;

  const compactTitle = compactComparableText(title);
  return terms.every((term) => compactTitle.includes(compactComparableText(term)));
}

export function filterBunjangCategoryKeywordItems(input: SearchCommandInput, items: SearchItem[]) {
  const filteredItems = items.filter((item) => shouldKeepBunjangCategoryKeyword(input, item.title));
  return {
    items: filteredItems,
    filteredCount: items.length - filteredItems.length
  };
}

function filterBunjangCategoryItems(categoryId: string, items: SearchItem[]) {
  const filteredItems = items.filter((item) => !isBunjangCategoryConflict(categoryId, item.title));
  return {
    items: filteredItems,
    filteredCount: items.length - filteredItems.length
  };
}

function normalizeListingImageUrl(value: string | undefined): string {
  return typeof value === "string" ? value.replace(/\{res\}/gi, "640") : "";
}

async function extractDaangnItems(input: SearchCommandInput, _pageHtml: string): Promise<DaangnExtractionResult> {
  const areas = getDaangnSearchAreas();
  const targetPoolSize = Math.max(input.limit, input.limit * getDaangnOverfetchMultiplier());
  const perAreaLimit = Math.max(1, Math.ceil(targetPoolSize / Math.max(areas.length, 1)));
  const fetched = await Promise.all(areas.map(async (area) => {
    const url = new URL("https://www.daangn.com/kr/buy-sell/");
    url.searchParams.set("search", input.keyword);
    url.searchParams.set("in", area);
    return {
      area,
      html: await fetchText(url.toString())
    };
  }));

  const htmlByArea = new Map<string, string>();
  for (const result of fetched) {
    if (typeof result.html === "string" && result.html.trim() !== "") {
      htmlByArea.set(result.area, result.html);
    }
  }

  const items: SearchItem[] = [];
  const seenUrls = new Set<string>();
  for (const area of areas) {
    const html = htmlByArea.get(area);
    if (!html) {
      continue;
    }

    const areaItems = parseDaangnItemsFromHtml(html)
      .slice(0, perAreaLimit)
      .map((item, index) => mapDaangnItem(item, area, index));

    for (const item of areaItems) {
      if (item.url === "" || seenUrls.has(item.url)) {
        continue;
      }

      seenUrls.add(item.url);
      items.push(item);
      if (items.length >= targetPoolSize) {
        return {
          items: items.slice(0, input.limit),
          failedAreas: areas.filter((candidate) => !htmlByArea.has(candidate))
        };
      }
    }
  }

  return {
    items: items.slice(0, input.limit),
    failedAreas: areas.filter((area) => !htmlByArea.has(area))
  };
}

function mapBunjangItem(product: BunjangApiProduct, index: number): SearchItem {
  const postedAt = formatUnixTimestamp(product.update_time);
  const imageUrl = normalizeListingImageUrl(product.product_image);
  const notes = [
    "source=public-api",
    "site=bunjang",
    `row=${index + 1}`,
    product.ad ? "ad=true" : "",
    product.proshop ? "proshop=true" : "",
    typeof product.tag === "string" && product.tag.trim() !== "" ? `tag=${product.tag}` : ""
  ].filter(Boolean).join("; ");

  return {
    title: typeof product.name === "string" ? product.name : "",
    price: parseNumericPrice(product.price),
    currency: "KRW",
    price_label: "",
    seller: typeof product.uid === "string" ? `user:${product.uid}` : "",
    status: parseItemStatus(product.status),
    condition: typeof product.used === "number" ? String(product.used) : "",
    shipping: product.free_shipping ? "free_shipping" : "",
    location: typeof product.location === "string" ? product.location : "",
    posted_at: postedAt,
    url: typeof product.pid === "string" ? `https://m.bunjang.co.kr/products/${product.pid}` : "",
    image_url: imageUrl,
    notes,
    listing_type_hint: "unknown",
    warnings: product.ad ? ["PROMOTED_LISTING"] : [],
    sale_status: parseSaleStatus(product.status),
    estimated_deal_price: null,
    price_change_count: 0,
    upload_date: buildUploadDate(postedAt),
    seller_upload_count: 0,
    description_length: typeof product.tag === "string" ? product.tag.length : 0,
    has_photo: imageUrl.trim() !== "",
    canonical_category_id: "",
    canonical_category_path: [],
    source_category_id: "",
    source_category_ids: [],
    source_category_path: [],
    category_confidence: "unknown",
    category_mapping_mode: "single",
    category_mapping_confidence: "unknown"
  };
}

function mapBunjangWebItem(product: BunjangWebProduct, index: number): SearchItem {
  const updatedAt = typeof product.updatedAt === "string" ? product.updatedAt : "";
  const updateTime = updatedAt ? Date.parse(updatedAt) / 1000 : undefined;
  return mapBunjangItem({
    pid: product.pid == null ? undefined : String(product.pid),
    name: product.name,
    price: product.price == null ? undefined : String(product.price),
    status: product.status,
    location: product.location,
    uid: product.shop?.uid == null ? undefined : String(product.shop.uid),
    update_time: Number.isFinite(updateTime) ? updateTime : undefined,
    product_image: product.productImage,
    ad: product.ad,
    free_shipping: product.freeShipping
  }, index);
}

export async function tryExtractPublicSearchResult(
  adapter: BrowserSiteAdapter,
  input: SearchCommandInput,
  pageHtml: string
): Promise<SearchResult | null> {
  if (adapter.siteKey === "daangn") {
    const extraction = await extractDaangnItems(input, pageHtml);
    if (extraction.items.length === 0) {
      return null;
    }

    const warnings = [
      `daangn public search aggregated across ${getDaangnSearchAreas().length} areas`,
      "PAGINATION_UNAVAILABLE: daangn public area search has no stable page cursor"
    ];
    if (extraction.failedAreas.length > 0) {
      warnings.push(`DAANGN_PARTIAL_AREA_RESULTS: ${extraction.failedAreas.join(", ")}`);
    }
    if (extraction.items.some((item) => item.warnings.includes("AVAILABILITY_UNAVAILABLE"))) {
      warnings.push("DAANGN_AVAILABILITY_UNAVAILABLE: listing sale status is not verified");
    }
    return buildResult(adapter, input, extraction.items, warnings);
  }

  if (adapter.siteKey === "joonggonara") {
    const products = parseJoonggonaraItemsFromHtml(pageHtml);
    if (products.length === 0) {
      return null;
    }

     const items = products.slice(0, input.limit).map(mapJoonggonaraItem);
     return buildResult(adapter, input, items, [], 0, [], buildSearchPagination(adapter, input, items.length));
  }

  if (adapter.siteKey === "ebay") {
    return tryExtractEbayBrowseApiResult(adapter, input);
  }

  if (adapter.siteKey === "bunjang") {
    if (input.category) {
      try {
        const payload = await fetchBunjangCategorySearchPayload(input);
        if (!payload) {
          return null;
        }

        const mappedItemsBeforeCategoryFilter = payload.products
          .map(mapBunjangWebItem)
          .filter((item) => item.title !== "" && item.price !== null && item.url !== "");
        const categoryFiltered = filterBunjangCategoryItems(input.category.id, mappedItemsBeforeCategoryFilter);
        const keywordFiltered = filterBunjangCategoryKeywordItems(input, categoryFiltered.items);
        const mappedItems = keywordFiltered.items;
        const filteredCount = categoryFiltered.filteredCount + keywordFiltered.filteredCount;
        const pageStart = Math.min(payload.itemOffset, mappedItems.length);
        const items = mappedItems.slice(pageStart, pageStart + input.limit);
        const pageEnd = pageStart + items.length;
        const nextCursor = pageEnd < mappedItems.length
          ? encodeBunjangCategoryCursor(payload.upstreamCursor, pageEnd)
          : payload.nextCursor
            ? encodeBunjangCategoryCursor(payload.nextCursor, 0)
            : null;
        return buildResult(
          adapter,
          input,
          items,
          [
            ...(items.length === 0 ? ["bunjang category API returned no usable items"] : []),
            ...(categoryFiltered.filteredCount > 0 ? [`CATEGORY_SOURCE_FILTER: removed ${categoryFiltered.filteredCount} incompatible result(s)`] : []),
            ...(keywordFiltered.filteredCount > 0 ? [`CATEGORY_KEYWORD_FILTER: removed ${keywordFiltered.filteredCount} non-matching result(s)`] : [])
          ],
          filteredCount,
          [],
          { has_more: Boolean(nextCursor), next_cursor: nextCursor }
        );
      } catch (error) {
        const message = error instanceof BunjangCategoryApiError
          ? error.message
          : "BUNJANG_CATEGORY_API_ERROR: network request failed";
        return buildResult(adapter, input, [], [message], 0, [message]);
      }
    }
    try {
      const payload = await fetchBunjangSearchPayload(
        input,
        Math.min(Math.max(input.limit * getBunjangOverfetchMultiplier(), input.limit), 100)
      );
      const baseWarnings = payload.no_result && payload.no_result_message
        ? [`bunjang reported no results: ${payload.no_result_message}`]
        : [];
      const filtered = filterBunjangProducts(input, payload.list);
      const items = filtered.kept.slice(0, input.limit).map(mapBunjangItem);
      const fetchLimit = Math.min(Math.max(input.limit * getBunjangOverfetchMultiplier(), input.limit), 100);
      return buildResult(
        adapter,
        input,
        items,
        [...baseWarnings, ...filtered.warnings],
        filtered.filteredCount,
        [],
        buildSearchPagination(adapter, input, payload.list.length >= fetchLimit ? input.limit : items.length)
      );
    } catch (error) {
      const message = error instanceof BunjangSearchApiError
        ? error.message
        : "BUNJANG_SEARCH_API_ERROR: network request failed";
      return buildResult(adapter, input, [], [message], 0, [message]);
    }
  }

  return null;
}
