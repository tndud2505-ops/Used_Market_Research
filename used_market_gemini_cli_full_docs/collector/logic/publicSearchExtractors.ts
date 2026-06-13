import {
  SearchResultSchema,
  type SearchCommandInput,
  type SearchItem,
  type SearchResult
} from "../../MCP/logic/types.js";
import { getDaangnSearchAreas } from "./sites/daangn.js";
import type { BrowserSiteAdapter } from "./sites/shared.js";

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
  if (normalized === "0") return "active";
  if (normalized === "1") return "reserved";
  if (normalized === "2") return "sold";
  return "unknown";
}

function parseSaleStatus(value: string | number | null | undefined): SearchItem["sale_status"] {
  const normalized = String(value ?? "");
  if (normalized === "1") return "reserved";
  if (normalized === "2") return "completed";
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
    return Number.isFinite(parsedNumeric) ? Math.round(parsedNumeric) : null;
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
  return value.toLowerCase().match(/[a-z]+\d+[a-z]*|\d+[a-z]+|[a-z]+|\d+|[가-힣]{2,}/g) ?? [];
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

  if (negativeVertical && !hasHardwareEvidence) {
    return { keep: false, reason: `non-pc-${negativeVertical}` };
  }

  const isBroadPcQuery = BUNJANG_BROAD_PC_QUERY_PATTERN.test(input.keyword) || keywordTerms.length === 0;
  if (isBroadPcQuery) {
    return hasHardwareEvidence
      ? { keep: true }
      : { keep: false, reason: "broad-query-without-hardware-evidence" };
  }

  const compactKeyword = compactComparableText(input.keyword);
  if (compactKeyword !== "" && compactHaystack.includes(compactKeyword)) {
    return { keep: true };
  }

  if (keywordTerms.length === 0) {
    return hasHardwareEvidence ? { keep: true } : { keep: false, reason: "missing-keyword-terms" };
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
  filteredCount = 0
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
    errors: []
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
    seller: typeof product.storeSeq === "number" ? `store:${product.storeSeq}` : "",
    status: parseItemStatus(product.state),
    condition: "",
    shipping: "",
    location: locationNames[0] ?? (typeof product.mainLocationName === "string" ? product.mainLocationName : ""),
    posted_at: postedAt,
    url: detailUrl,
    notes,
    listing_type_hint: "unknown",
    warnings: [],
    sale_status: parseSaleStatus(product.state),
    estimated_deal_price: null,
    price_change_count: 0,
    upload_date: buildUploadDate(postedAt),
    seller_upload_count: 0,
    description_length: typeof product.title === "string" ? product.title.length : 0,
    has_photo: Boolean((product.detailImgUrl ?? "").trim() || (product.url ?? "").trim())
  };
}

function mapDaangnItem(product: DaangnLdJsonProduct, area: string, index: number): SearchItem {
  const imageUrl = typeof product.image === "string" ? product.image : "";
  const uploadDate = deriveDaangnArticleMonth(imageUrl);
  const saleStatus = parseDaangnAvailability(product.offers?.availability);
  const notes = [
    "source=ld-json",
    "site=daangn",
    `area=${area}`,
    `row=${index + 1}`,
    uploadDate ? `derived_upload_month=${uploadDate}` : "",
    saleStatus !== "active" ? `availability=${String(product.offers?.availability ?? "")}` : ""
  ].filter(Boolean).join("; ");

  return {
    title: typeof product.name === "string" ? product.name : "",
    price: parseNumericPrice(product.offers?.price),
    currency: typeof product.offers?.priceCurrency === "string" ? product.offers.priceCurrency : "KRW",
    seller: typeof product.offers?.seller?.name === "string" ? product.offers.seller.name : "",
    status: saleStatus === "completed" ? "sold" : "active",
    condition: "",
    shipping: "",
    location: area,
    posted_at: "",
    url: typeof product.url === "string" ? product.url : "",
    notes,
    listing_type_hint: "unknown",
    warnings: [],
    sale_status: saleStatus,
    estimated_deal_price: null,
    price_change_count: 0,
    upload_date: uploadDate,
    seller_upload_count: 0,
    description_length: typeof product.description === "string" ? product.description.length : 0,
    has_photo: imageUrl.trim() !== ""
  };
}

async function fetchBunjangSearchPayload(
  input: SearchCommandInput,
  fetchLimit = input.limit
): Promise<BunjangApiResponse | null> {
  const url = new URL("https://api.bunjang.co.kr/api/1/find_v2.json");
  url.searchParams.set("q", input.keyword);
  url.searchParams.set("n", String(Math.max(1, fetchLimit)));
  url.searchParams.set("page", "0");
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
    return null;
  }

  return await response.json() as BunjangApiResponse;
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

async function extractDaangnItems(input: SearchCommandInput, _pageHtml: string): Promise<SearchItem[]> {
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
        return items;
      }
    }
  }

  return items.slice(0, input.limit);
}

function mapBunjangItem(product: BunjangApiProduct, index: number): SearchItem {
  const postedAt = formatUnixTimestamp(product.update_time);
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
    seller: typeof product.uid === "string" ? `user:${product.uid}` : "",
    status: parseItemStatus(product.status),
    condition: typeof product.used === "number" ? String(product.used) : "",
    shipping: product.free_shipping ? "free_shipping" : "",
    location: typeof product.location === "string" ? product.location : "",
    posted_at: postedAt,
    url: typeof product.pid === "string" ? `https://m.bunjang.co.kr/products/${product.pid}` : "",
    notes,
    listing_type_hint: "unknown",
    warnings: product.ad ? ["PROMOTED_LISTING"] : [],
    sale_status: parseSaleStatus(product.status),
    estimated_deal_price: null,
    price_change_count: 0,
    upload_date: buildUploadDate(postedAt),
    seller_upload_count: 0,
    description_length: typeof product.tag === "string" ? product.tag.length : 0,
    has_photo: typeof product.product_image === "string" && product.product_image.trim() !== ""
  };
}

export async function tryExtractPublicSearchResult(
  adapter: BrowserSiteAdapter,
  input: SearchCommandInput,
  pageHtml: string
): Promise<SearchResult | null> {
  if (adapter.siteKey === "daangn") {
    const items = await extractDaangnItems(input, pageHtml);
    if (items.length === 0) {
      return null;
    }

    return buildResult(adapter, input, items, [`daangn public search aggregated across ${getDaangnSearchAreas().length} areas`]);
  }

  if (adapter.siteKey === "joonggonara") {
    const products = parseJoonggonaraItemsFromHtml(pageHtml);
    if (products.length === 0) {
      return null;
    }

    return buildResult(adapter, input, products.slice(0, input.limit).map(mapJoonggonaraItem));
  }

  if (adapter.siteKey === "bunjang") {
    try {
      const payload = await fetchBunjangSearchPayload(
        input,
        Math.min(Math.max(input.limit * getBunjangOverfetchMultiplier(), input.limit), 100)
      );
      if (!payload || !Array.isArray(payload.list)) {
        return null;
      }

      const baseWarnings = payload.no_result && payload.no_result_message
        ? [`bunjang reported no results: ${payload.no_result_message}`]
        : [];
      const filtered = filterBunjangProducts(input, payload.list);
      const items = filtered.kept.slice(0, input.limit).map(mapBunjangItem);
      return buildResult(adapter, input, items, [...baseWarnings, ...filtered.warnings], filtered.filteredCount);
    } catch {
      return null;
    }
  }

  return null;
}
