import { LocalCdpBrowserRuntime } from "./cdpBrowserRuntime.js";
import {
  classifySearchOnlyListing,
  summarizeSearchOnlyCategories,
  type SearchOnlyCategorySummary,
  type SearchOnlyCategoryTag
} from "./searchOnlyCategoryClassifier.js";
import { keywordMatchesText } from "./keyword-aliases.js";

export const RETHINKMALL_BASE_URL = "https://web.rethinkmall.com";

export interface RethinkMallListing {
  id: string;
  title: string;
  description: string;
  condition_grade: string;
  discount_rate: number | null;
  sale_price: number | null;
  original_price: number | null;
  currency: "KRW";
  url: string;
  image_url: string;
  raw_text: string;
}

export type ClassifiedRethinkMallListing = RethinkMallListing & SearchOnlyCategoryTag;

export interface RethinkMallValidation {
  status: "pass" | "warn" | "fail";
  extracted_count: number;
  structurally_valid_count: number;
  relevant_count: number;
  relevance_rate: number;
  duplicate_count: number;
  missing_field_count: number;
  warnings: string[];
  errors: string[];
}

export interface RethinkMallProbeResult {
  source: "fixture" | "live";
  keyword: string;
  requested_url: string;
  response_url: string;
  reported_count: number | null;
  items: ClassifiedRethinkMallListing[];
  relevant_items: ClassifiedRethinkMallListing[];
  category_summary: SearchOnlyCategorySummary[];
  uncategorized_count: number;
  validation: RethinkMallValidation;
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

function extractClassHtml(html: string, classTokens: string | string[]): string {
  const requiredTokens = Array.isArray(classTokens) ? classTokens : [classTokens];
  const openingPattern = /<([a-z0-9]+)\b([^>]*)>/gi;
  for (const match of html.matchAll(openingPattern)) {
    const tagName = match[1] ?? "";
    const classValue = readAttribute(match[2] ?? "", "class");
    const tokens = classValue.split(/\s+/).filter(Boolean);
    if (requiredTokens.every((token) => tokens.includes(token))) {
      const contentStart = (match.index ?? 0) + match[0].length;
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
    }
  }
  return "";
}

function readNumber(value: string): number | null {
  const digits = value.replace(/[^\d]/g, "");
  if (!digits) return null;
  const parsed = Number(digits);
  return Number.isFinite(parsed) ? parsed : null;
}

function readUrl(value: string): string {
  if (!value) return "";
  try {
    return new URL(value, RETHINKMALL_BASE_URL).toString();
  } catch {
    return "";
  }
}

function readImageUrl(innerHtml: string): string {
  const match = innerHtml.match(/<img\b([^>]*)>/i);
  if (!match) return "";
  return readUrl(
    readAttribute(match[1], "data-src")
    || readAttribute(match[1], "data-original")
    || readAttribute(match[1], "src")
  );
}

function isRelevant(keyword: string, item: Pick<RethinkMallListing, "title" | "description">): boolean {
  return keywordMatchesText(keyword, `${item.title} ${item.description}`);
}

function extractReportedCount(html: string): number | null {
  const visibleText = normalizeText(html);
  const match = visibleText.match(/총\s*(\d+)\s*개의 상품이 검색되었습니다/);
  return match ? Number(match[1]) : null;
}

export function buildRethinkMallSearchUrl(keyword: string): string {
  const url = new URL(`${RETHINKMALL_BASE_URL}/search`);
  url.searchParams.set("utm_source", "bu");
  url.searchParams.set("keyword", keyword);
  return url.toString();
}

export function parseRethinkMallSearchHtml(html: string): RethinkMallListing[] {
  const listings: RethinkMallListing[] = [];
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchorPattern)) {
    const attributes = match[1] ?? "";
    const innerHtml = match[2] ?? "";
    const url = readUrl(readAttribute(attributes, "href"));
    if (!url.includes("/goods/")) continue;

    const title = normalizeText(extractClassHtml(innerHtml, "_ga-goods-title"));
    const description = normalizeText(extractClassHtml(innerHtml, "break-all"));
    const conditionGrade = normalizeText(extractClassHtml(innerHtml, "inline-flex"));
    const discountRate = readNumber(normalizeText(extractClassHtml(innerHtml, "bg-black")));
    const salePrice = readNumber(normalizeText(extractClassHtml(innerHtml, ["text-base", "lg:text-lg"])));
    const originalPrice = readNumber(normalizeText(extractClassHtml(innerHtml, ["mt-6", "text-blue-500"])));
    const id = url.split("/").filter(Boolean).at(-1) ?? "";

    listings.push({
      id,
      title,
      description,
      condition_grade: conditionGrade,
      discount_rate: discountRate,
      sale_price: salePrice,
      original_price: originalPrice,
      currency: "KRW",
      url,
      image_url: readImageUrl(innerHtml),
      raw_text: normalizeText(innerHtml)
    });
  }

  return listings;
}

export function validateRethinkMallListings(keyword: string, items: RethinkMallListing[]): RethinkMallValidation {
  const missingFieldCount = items.filter((item) => !item.title || !item.url || item.sale_price === null).length;
  const seenUrls = new Set<string>();
  const duplicateCount = items.filter((item) => {
    if (seenUrls.has(item.url)) return true;
    seenUrls.add(item.url);
    return false;
  }).length;
  const structurallyValidCount = items.length - missingFieldCount;
  const relevantCount = items.filter((item) => isRelevant(keyword, item)).length;
  const relevanceRate = items.length > 0 ? Math.round((relevantCount / items.length) * 1000) / 1000 : 0;
  const warnings: string[] = [];
  const errors: string[] = [];

  if (items.length === 0) warnings.push("NO_ITEMS_EXTRACTED");
  if (missingFieldCount > 0) errors.push(`MISSING_REQUIRED_FIELDS:${missingFieldCount}`);
  if (duplicateCount > 0) errors.push(`DUPLICATE_URLS:${duplicateCount}`);
  if (items.length > 0 && relevantCount === 0) warnings.push("NO_RELEVANT_ITEMS_FOR_KEYWORD");
  if (items.length > 0 && relevantCount > 0 && relevanceRate < 0.5) warnings.push("LOW_RELEVANCE_RATE");

  const hasQualityWarning = warnings.some((warning) => (
    warning === "NO_RELEVANT_ITEMS_FOR_KEYWORD"
    || warning === "NO_ITEMS_EXTRACTED"
    || warning === "LOW_RELEVANCE_RATE"
    || warning.startsWith("PARTIAL_RESULT_PAGE:")
  ));
  return {
    status: errors.length > 0 ? "fail" : hasQualityWarning ? "warn" : "pass",
    extracted_count: items.length,
    structurally_valid_count: structurallyValidCount,
    relevant_count: relevantCount,
    relevance_rate: relevanceRate,
    duplicate_count: duplicateCount,
    missing_field_count: missingFieldCount,
    warnings,
    errors
  };
}

export function buildRethinkMallProbeResult(
  keyword: string,
  html: string,
  responseUrl: string,
  source: "fixture" | "live"
): RethinkMallProbeResult {
  const items = parseRethinkMallSearchHtml(html);
  const classifiedItems = items.map((item) => ({
    ...item,
    ...classifySearchOnlyListing({ title: item.title, description: item.description, keyword })
  }));
  const relevantItems = classifiedItems.filter((item) => isRelevant(keyword, item));
  const categorySummary = summarizeSearchOnlyCategories(classifiedItems);
  const reportedCount = extractReportedCount(html);
  const validation = validateRethinkMallListings(keyword, classifiedItems);
  if (reportedCount !== null && reportedCount > classifiedItems.length) {
    validation.warnings.push(`PARTIAL_RESULT_PAGE:${classifiedItems.length}/${reportedCount}`);
    if (validation.status === "pass") validation.status = "warn";
  }
  return {
    source,
    keyword,
    requested_url: buildRethinkMallSearchUrl(keyword),
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

export async function fetchRethinkMallSearch(
  keyword: string,
  options: { settleMs?: number } = {}
): Promise<RethinkMallProbeResult> {
  const runtime = LocalCdpBrowserRuntime.create({ headless: true });
  if (!runtime) {
    throw new Error(LocalCdpBrowserRuntime.describeUnavailableReason() ?? "LOCAL_BROWSER_RUNTIME_UNAVAILABLE");
  }

  try {
    await runtime.goto(buildRethinkMallSearchUrl(keyword));
    await delay(options.settleMs ?? 3000);
    const snapshot = await runtime.snapshot();
    return buildRethinkMallProbeResult(keyword, snapshot.html, snapshot.url, "live");
  } finally {
    await runtime.close();
  }
}
