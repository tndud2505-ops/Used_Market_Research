import { LocalCdpBrowserRuntime } from "./cdpBrowserRuntime.js";
import {
  classifySearchOnlyListing,
  summarizeSearchOnlyCategories,
  type SearchOnlyCategorySummary,
  type SearchOnlyCategoryTag
} from "./searchOnlyCategoryClassifier.js";
import { keywordMatchesText } from "./keyword-aliases.js";

export const HELLO_MARKET_BASE_URL = "https://www.hellomarket.com";

export type HelloMarketStatus = "active" | "reserved" | "sold" | "unknown";

export interface HelloMarketListing {
  id: string;
  title: string;
  price: number | null;
  seller: string;
  status: HelloMarketStatus;
  shipping: string;
  posted_at: string;
  url: string;
  image_url: string;
  raw_text: string;
}

export type ClassifiedHelloMarketListing = HelloMarketListing & SearchOnlyCategoryTag;

export interface HelloMarketValidation {
  status: "pass" | "warn" | "fail";
  extracted_count: number;
  structurally_valid_count: number;
  relevant_count: number;
  active_relevant_count: number;
  unknown_relevant_count: number;
  sold_count: number;
  relevance_rate: number;
  duplicate_count: number;
  missing_field_count: number;
  image_unavailable_count: number;
  warnings: string[];
  errors: string[];
}

export interface HelloMarketProbeResult {
  source: "fixture" | "live";
  keyword: string;
  requested_url: string;
  response_url: string;
  reported_count: number | null;
  items: ClassifiedHelloMarketListing[];
  relevant_items: ClassifiedHelloMarketListing[];
  category_summary: SearchOnlyCategorySummary[];
  uncategorized_count: number;
  validation: HelloMarketValidation;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x2F;|&#47;/gi, "/")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function normalizeText(value: string): string {
  return decodeHtmlEntities(value.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readAttribute(attributes: string, name: string): string {
  const match = attributes.match(new RegExp(`\\b${escapeRegExp(name)}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"));
  return match ? decodeHtmlEntities(match[2]) : "";
}

function findElementContents(html: string, openingMatch: RegExpMatchArray): string {
  const tagName = openingMatch[1] ?? "";
  const contentStart = (openingMatch.index ?? 0) + openingMatch[0].length;
  const closingPattern = new RegExp(`<\\/?${escapeRegExp(tagName)}\\b[^>]*>`, "gi");
  closingPattern.lastIndex = contentStart;
  let depth = 1;
  for (const closingMatch of html.matchAll(closingPattern)) {
    if (closingMatch[0].startsWith("</")) {
      depth -= 1;
      if (depth === 0) {
        return html.slice(contentStart, closingMatch.index ?? contentStart);
      }
    } else if (!closingMatch[0].endsWith("/>") && !/^<(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)\b/i.test(closingMatch[0])) {
      depth += 1;
    }
  }
  return "";
}

function extractClassElements(html: string, classTokens: string | string[]): string[] {
  const requiredTokens = Array.isArray(classTokens) ? classTokens : [classTokens];
  const elements: string[] = [];
  const openingPattern = /<([a-z0-9]+)\b([^>]*)>/gi;
  for (const match of html.matchAll(openingPattern)) {
    const classValue = readAttribute(match[2] ?? "", "class");
    const tokens = classValue.split(/\s+/).filter(Boolean);
    if (requiredTokens.every((token) => tokens.includes(token))) {
      elements.push(findElementContents(html, match));
    }
  }
  return elements;
}

function readNumber(value: string): number | null {
  const digits = normalizeText(value).replace(/[^\d]/g, "");
  if (!digits) return null;
  const parsed = Number(digits);
  return Number.isFinite(parsed) ? parsed : null;
}

function readUrl(value: string): string {
  if (!value) return "";
  try {
    const decoded = decodeHtmlEntities(value);
    const normalized = decoded.replace(/\?\[object(?:%20|\s)Object\]$/i, "");
    return new URL(normalized, HELLO_MARKET_BASE_URL).toString();
  } catch {
    return "";
  }
}

function isRelevant(keyword: string, item: Pick<HelloMarketListing, "title">): boolean {
  return keywordMatchesText(keyword, item.title);
}

function extractReportedCount(html: string): number | null {
  const visibleText = normalizeText(html);
  const match = visibleText.match(/(\d[\d,]*)\s*개의 상품이 있습니다/);
  return match ? Number(match[1].replace(/,/g, "")) : null;
}

function extractItemAnchor(cardHtml: string): { attributes: string; href: string } | null {
  const match = cardHtml.match(/<a\b([^>]*)href=["']([^"']*\/item\/[^"']*)["'][^>]*>/i);
  if (!match) return null;
  return { attributes: match[1] ?? "", href: match[2] ?? "" };
}

function isListingImageUrl(value: string): boolean {
  if (!value || /placeholder|empty\/image|no[-_]?image|default/i.test(value)) return false;
  try {
    const url = new URL(value);
    if (/^ccimage\.hellomarket\.com$/i.test(url.hostname) && /^\/img\//i.test(url.pathname)) return false;
  } catch {
    return false;
  }
  return true;
}

function readSrcsetUrls(value: string): string[] {
  return value
    .split(",")
    .map((candidate) => candidate.trim().split(/\s+/)[0] ?? "")
    .filter(Boolean);
}

function extractImageUrl(cardHtml: string): string {
  for (const imageMatch of cardHtml.matchAll(/<(?:img|source)\b([^>]*)>/gi)) {
    const attributes = imageMatch[1] ?? "";
    const candidates = [
      readAttribute(attributes, "data-src"),
      readAttribute(attributes, "data-original"),
      readAttribute(attributes, "data-lazy-src"),
      readAttribute(attributes, "data-image"),
      ...readSrcsetUrls(readAttribute(attributes, "data-srcset")),
      ...readSrcsetUrls(readAttribute(attributes, "data-lazy-srcset")),
      ...readSrcsetUrls(readAttribute(attributes, "srcset")),
      readAttribute(attributes, "src")
    ];
    for (const candidate of candidates) {
      const imageUrl = readUrl(candidate);
      if (isListingImageUrl(imageUrl)) return imageUrl;
    }
  }
  return "";
}

function parseStatus(cardText: string): HelloMarketStatus {
  if (/판매완료|거래완료|sold\s*out/i.test(cardText)) return "sold";
  if (/예약중|예약\s*중|reserved/i.test(cardText)) return "reserved";
  if (/판매중|거래가능|active|판매\s*가능/i.test(cardText)) return "active";
  return "unknown";
}

export function buildHelloMarketSearchUrl(keyword: string): string {
  const url = new URL(`${HELLO_MARKET_BASE_URL}/search`);
  url.searchParams.set("q", keyword);
  return url.toString();
}

export function parseHelloMarketSearchHtml(html: string): HelloMarketListing[] {
  const listings: HelloMarketListing[] = [];
  for (const cardHtml of extractClassElements(html, "sc-2e746fd3-0")) {
    const anchor = extractItemAnchor(cardHtml);
    if (!anchor) continue;

    const priceAndTitle = extractClassElements(cardHtml, "sc-2e746fd3-5").map(normalizeText).filter(Boolean);
    const priceIndex = priceAndTitle.findIndex((value) => /\d[\d,]*\s*원/.test(value));
    const price = priceIndex >= 0 ? readNumber(priceAndTitle[priceIndex]) : null;
    const title = priceAndTitle.find((value, index) => index !== priceIndex && !/^\d[\d,]*\s*원$/.test(value)) ?? "";
    const seller = normalizeText(extractClassElements(cardHtml, "sc-2e746fd3-4")[0] ?? "");
    const postedAt = normalizeText(extractClassElements(cardHtml, "sc-2e746fd3-10")[0] ?? "");
    const rawText = normalizeText(cardHtml);
    const url = readUrl(anchor.href);
    const id = url.split("/").filter(Boolean).at(-1)?.split("?")[0] ?? "";

    listings.push({
      id,
      title,
      price,
      seller,
      status: parseStatus(rawText),
      shipping: rawText.includes("무료배송") ? "무료배송" : "",
      posted_at: postedAt,
      url,
      image_url: extractImageUrl(cardHtml),
      raw_text: rawText
    });
  }
  return listings;
}

export function validateHelloMarketListings(keyword: string, items: HelloMarketListing[]): HelloMarketValidation {
  const missingFieldCount = items.filter((item) => !item.title || !item.url || item.price === null).length;
  const imageUnavailableCount = items.filter((item) => !item.image_url).length;
  const seenUrls = new Set<string>();
  const duplicateCount = items.filter((item) => {
    if (seenUrls.has(item.url)) return true;
    seenUrls.add(item.url);
    return false;
  }).length;
  const structurallyValidCount = items.length - missingFieldCount;
  const relevantItems = items.filter((item) => isRelevant(keyword, item));
  const activeRelevantCount = relevantItems.filter((item) => item.status === "active").length;
  const unknownRelevantCount = relevantItems.filter((item) => item.status === "unknown").length;
  const soldCount = items.filter((item) => item.status === "sold").length;
  const relevanceRate = items.length > 0 ? Math.round((relevantItems.length / items.length) * 1000) / 1000 : 0;
  const warnings: string[] = [];
  const errors: string[] = [];

  if (items.length === 0) warnings.push("NO_ITEMS_EXTRACTED");
  if (missingFieldCount > 0) errors.push(`MISSING_REQUIRED_FIELDS:${missingFieldCount}`);
  if (imageUnavailableCount > 0) warnings.push(`IMAGE_UNAVAILABLE:${imageUnavailableCount}`);
  if (duplicateCount > 0) errors.push(`DUPLICATE_URLS:${duplicateCount}`);
  if (items.length > 0 && relevantItems.length === 0) warnings.push("NO_RELEVANT_ITEMS_FOR_KEYWORD");
  if (relevantItems.length > 0 && activeRelevantCount === 0) {
    warnings.push(unknownRelevantCount > 0 ? "ACTIVE_STATUS_UNAVAILABLE" : "NO_ACTIVE_RELEVANT_ITEMS");
  }

  return {
    status: errors.length > 0 ? "fail" : warnings.length > 0 ? "warn" : "pass",
    extracted_count: items.length,
    structurally_valid_count: structurallyValidCount,
    relevant_count: relevantItems.length,
    active_relevant_count: activeRelevantCount,
    unknown_relevant_count: unknownRelevantCount,
    sold_count: soldCount,
    relevance_rate: relevanceRate,
    duplicate_count: duplicateCount,
    missing_field_count: missingFieldCount,
    image_unavailable_count: imageUnavailableCount,
    warnings,
    errors
  };
}

export function buildHelloMarketProbeResult(
  keyword: string,
  html: string,
  responseUrl: string,
  source: "fixture" | "live"
): HelloMarketProbeResult {
  const items = parseHelloMarketSearchHtml(html);
  const classifiedItems = items.map((item) => ({
    ...item,
    ...classifySearchOnlyListing({ title: item.title, keyword })
  }));
  const relevantItems = classifiedItems.filter((item) => isRelevant(keyword, item));
  const categorySummary = summarizeSearchOnlyCategories(classifiedItems);
  const reportedCount = extractReportedCount(html);
  const validation = validateHelloMarketListings(keyword, classifiedItems);
  if (reportedCount !== null && reportedCount > classifiedItems.length) {
    validation.warnings.push(`PARTIAL_RESULT_PAGE:${classifiedItems.length}/${reportedCount}`);
    if (validation.status === "pass") validation.status = "warn";
  }
  return {
    source,
    keyword,
    requested_url: buildHelloMarketSearchUrl(keyword),
    response_url: responseUrl,
    reported_count: reportedCount,
    items: classifiedItems,
    relevant_items: relevantItems,
    category_summary: categorySummary.category_summary,
    uncategorized_count: categorySummary.uncategorized_count,
    validation
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readMetaImage(html: string): string {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const property = tag.match(/\b(?:property|name)\s*=\s*(["'])(.*?)\1/i)?.[2] ?? "";
    if (!/^(?:og:image|twitter:image)$/i.test(property)) continue;
    const content = tag.match(/\bcontent\s*=\s*(["'])(.*?)\1/i)?.[2] ?? "";
    const imageUrl = readUrl(content);
    if (isListingImageUrl(imageUrl)) return imageUrl;
  }
  return "";
}

type HelloMarketImageResponse = {
  ok: boolean;
  text(): Promise<string>;
};

type HelloMarketImageFetch = (url: string, init: RequestInit) => Promise<HelloMarketImageResponse>;

export async function enrichHelloMarketImages(
  items: HelloMarketListing[],
  options: { concurrency?: number; fetchImpl?: HelloMarketImageFetch; maxItems?: number } = {}
): Promise<void> {
  const maxItems = Number.isFinite(options.maxItems) ? Math.max(0, Math.floor(options.maxItems ?? 0)) : items.length;
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? 4));
  const fetchImpl = options.fetchImpl ?? fetch;
  const candidates = items.filter((item) => item.url && !item.image_url).slice(0, maxItems);
  const enrichItem = async (item: HelloMarketListing): Promise<void> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await fetchImpl(item.url, {
        signal: controller.signal,
        headers: {
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
          accept: "text/html,application/xhtml+xml,*/*;q=0.8"
        }
      });
      if (!response.ok) return;
      const imageUrl = readMetaImage(await response.text());
      if (imageUrl) item.image_url = imageUrl;
    } catch {
      // Optional detail enrichment must not make a valid search fail.
    } finally {
      clearTimeout(timer);
    }
  };
  for (let index = 0; index < candidates.length; index += concurrency) {
    await Promise.all(candidates.slice(index, index + concurrency).map(enrichItem));
  }
}

export async function fetchHelloMarketSearch(
  keyword: string,
  options: { settleMs?: number } = {}
): Promise<HelloMarketProbeResult> {
  const runtime = LocalCdpBrowserRuntime.create({ headless: true });
  if (!runtime) {
    throw new Error(LocalCdpBrowserRuntime.describeUnavailableReason() ?? "LOCAL_BROWSER_RUNTIME_UNAVAILABLE");
  }

  try {
    await runtime.goto(buildHelloMarketSearchUrl(keyword));
    await delay(options.settleMs ?? 1500);
    const snapshot = await runtime.snapshot();
    const result = buildHelloMarketProbeResult(keyword, snapshot.html, snapshot.url, "live");
    await enrichHelloMarketImages(result.items);
    const imageUnavailableCount = result.items.filter((item) => !item.image_url).length;
    result.validation.image_unavailable_count = imageUnavailableCount;
    result.validation.warnings = result.validation.warnings.filter((warning) => !warning.startsWith("IMAGE_UNAVAILABLE:"));
    if (imageUnavailableCount > 0) result.validation.warnings.push(`IMAGE_UNAVAILABLE:${imageUnavailableCount}`);
    result.validation.status = result.validation.errors.length > 0
      ? "fail"
      : result.validation.warnings.length > 0 ? "warn" : "pass";
    return result;
  } finally {
    await runtime.close();
  }
}
