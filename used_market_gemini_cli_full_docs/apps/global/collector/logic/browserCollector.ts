import {
  LoginCheckResultSchema,
  SearchResultSchema,
  type LoginCheckResult,
  type SearchCommandInput,
  type SearchItem,
  type SearchResult
} from "../../MCP/logic/types.js";
import { trace } from "../../MCP/logic/runtime-trace.js";
import { createBrowserFixtureSession, createBrowserSession, BrowserRuntimeUnavailableError, type BrowserFailureKind, type BrowserSession } from "./browserSession.js";
import { tryExtractPublicSearchResult } from "./publicSearchExtractors.js";
import { resolveBrowserSiteAdapter, type BrowserSiteAdapter, firstDefined, firstMatchingSelector } from "./sites/index.js";
import { normalizeForeignSearchKeyword } from "./sites/shared.js";
import { resolveSite } from "./sites.js";
import { classifySearchOnlyListing } from "./searchOnlyCategoryClassifier.js";
import {
  resolveCategoryCollectionPlan,
  type CategoryCollectionPlan,
  type CategoryCollectionStrategy,
  type SourceCategoryBinding
} from "../../market/logic/category-catalog.js";

function buildUnavailableReason(step: string, adapter: BrowserSiteAdapter, session: BrowserSession): string {
  return `${step}: BROWSER_RUNTIME_UNAVAILABLE: ${session.unavailableReason ?? "browser runtime unavailable"} (site=${adapter.siteKey})`;
}

function buildSearchWarnings(adapter: BrowserSiteAdapter, reason: string): string[] {
  return [
    `Browser-first extraction unavailable for ${adapter.siteKey}: ${reason}`,
    `Selectors prepared: ${adapter.searchSelectors.item}`,
    `Adapter notes: ${adapter.debugNotes.join(" | ")}`
  ];
}

function buildLoginWarnings(adapter: BrowserSiteAdapter, reason: string): string[] {
  return [
    `Browser-first login check unavailable for ${adapter.siteKey}: ${reason}`,
    `Login selectors prepared: ${adapter.loginSelectors.signedIn.join(" | ")}`,
    `Adapter notes: ${adapter.debugNotes.join(" | ")}`
  ];
}

function hasBlockedPageSignals(html: string): boolean {
  return /(captcha|access denied|verify you are human|unusual traffic|temporarily blocked|bot detection|forbidden|cf-chl|cloudflare)/i.test(html);
}

export function hasExplicitEmptySearchEvidence(adapter: BrowserSiteAdapter, pageHtml: string): boolean {
  if (pageHtml.trim() === "" || hasBlockedPageSignals(pageHtml)) {
    return false;
  }

  return /(?:searchResults|search_results|items)\s*["']?\s*:\s*\[\s*\]/i.test(pageHtml)
    || /no\s+(?:results|listings|items)\s+(?:found|available)/i.test(pageHtml);
}

function classifySearchFailure(html: string, rowCount: number): BrowserFailureKind | null {
  if (hasBlockedPageSignals(html)) {
    return "blocked_page";
  }

  if (rowCount === 0) {
    if (/(application\/json|__INITIAL_DATA__|__NEXT_DATA__|window\.__|ld\+json)/i.test(html)) {
      return "unsupported_evidence_shape";
    }
    return "empty_results";
  }

  return "selector_drift";
}

export function parsePrice(text: string): number | null {
  const match = text.replace(/\u00a0/g, " ").match(/\d[\d\s.,]*/);
  if (!match) {
    return null;
  }

  let numeric = match[0].replace(/\s+/g, "");
  const lastComma = numeric.lastIndexOf(",");
  const lastDot = numeric.lastIndexOf(".");
  const lastSeparator = Math.max(lastComma, lastDot);
  const fractionDigits = lastSeparator >= 0 ? numeric.length - lastSeparator - 1 : 0;

  if (lastComma >= 0 && lastDot >= 0 && fractionDigits > 0 && fractionDigits <= 2) {
    const decimalSeparator = lastComma > lastDot ? "," : ".";
    const thousandsSeparator = decimalSeparator === "," ? "." : ",";
    numeric = numeric.replaceAll(thousandsSeparator, "").replace(decimalSeparator, ".");
  } else if (lastSeparator >= 0 && fractionDigits > 0 && fractionDigits <= 2) {
    numeric = numeric.replace(lastComma >= 0 ? "," : ".", ".");
  } else {
    numeric = numeric.replace(/[.,]/g, "");
  }

  const value = Number(numeric);
  return Number.isFinite(value) ? value : null;
}

export function parseCurrency(text: string, fallback: string): string {
  if (/\bKRW\b|₩|원/i.test(text)) return "KRW";
  if (/\bJPY\b|[¥￥円]/i.test(text)) return "JPY";
  if (/\bEUR\b|€/i.test(text)) return "EUR";
  if (/\bGBP\b|£/i.test(text)) return "GBP";
  if (/\bSGD\b|S\$/i.test(text)) return "SGD";
  if (/\bUSD\b|\$/i.test(text)) return fallback === "CAD" || fallback === "AUD" ? fallback : "USD";
  return fallback;
}

function parseSrcset(value: string | null): string {
  return value?.split(",")[0]?.trim().split(/\s+/)[0] ?? "";
}

function absoluteUrl(value: string, baseUrl: string) {
  if (!value) return "";
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}

interface ListingUrlSignals {
  conditionOverride: string;
  definiteAccessory: boolean;
  notes: string;
}

export interface ListingTitleSignals {
  conditionOverride: string;
  notes: string;
}

function listingUrlSignals(value: string): ListingUrlSignals {
  let pathname = "";
  try {
    pathname = decodeURIComponent(new URL(value).pathname).toLowerCase();
  } catch {
    return { conditionOverride: "", definiteAccessory: false, notes: "" };
  }

  const slug = pathname.replace(/[._/\-]+/g, " ").replace(/\s+/g, " ").trim();
  const signals: string[] = [];
  const addSignal = (matched: boolean, label: string) => {
    if (matched) signals.push(label);
    return matched;
  };
  const forParts = addSignal(/\bfor parts\b/.test(slug), "for parts");
  const notWorking = addSignal(/\bnot working\b/.test(slug), "not working");
  const noPower = addSignal(/\bno power\b/.test(slug), "no power");
  const icloud = /\bicloud\b/.test(slug);
  const activationLocked = /\bactivation locked\b/.test(slug);
  const carrierLocked = /\bcarrier locked\b/.test(slug);
  const locked = /\blocked\b/.test(slug);
  if (icloud && locked) signals.push("iCloud locked");
  else if (icloud) signals.push("iCloud mentioned");
  if (activationLocked) signals.push("activation locked");
  if (carrierLocked) signals.push("carrier locked");
  if (locked && !icloud && !activationLocked && !carrierLocked) signals.push("locked");
  const emptyBox = addSignal(/\bempty box\b/.test(slug), "empty box");
  const boxOnly = addSignal(/\bbox only\b/.test(slug), "box only");
  const noDevice = addSignal(/\bno device\b/.test(slug), "no device");
  const accessoryCase = addSignal(/\bcase\b/.test(slug), "case/accessory");

  const conditionOverride = forParts || notWorking || noPower
    ? "For parts / Not working"
    : (icloud && locked) || activationLocked || carrierLocked || locked
      ? "Locked / Restricted"
      : "";
  return {
    conditionOverride,
    definiteAccessory: emptyBox || boxOnly || noDevice || accessoryCase,
    notes: signals.length > 0 ? `URL signals: ${signals.join(", ")}` : ""
  };
}

export function listingTitleSignals(value: string): ListingTitleSignals {
  const title = String(value || "").normalize("NFKC").trim();
  if (!title) return { conditionOverride: "", notes: "" };

  const signals: string[] = [];
  const forParts = /(ジャンク|部品取(?:り|用)?|動作(?:未確認|不良)|電源(?:不良|入らない)|使用不能|充電端子不良)/i.test(title);
  const explicitlyUnlocked = /(SIM\s*ロック\s*(?:解除(?:済み?)?|なし)|SIM\s*フリー|利用制限\s*[◯○])/i.test(title);
  const locked = !explicitlyUnlocked && /(iCloud\s*ロック|アクティベーション\s*ロック|SIM\s*ロック|利用制限\s*[△×])/i.test(title);
  const displayUnit = /(デモ機|展示品|店頭展示)/i.test(title);
  if (forParts) signals.push("Japanese junk/parts signal");
  if (locked) signals.push("Japanese lock/restriction signal");
  if (displayUnit) signals.push("Japanese demo/display signal");

  const conditionOverride = forParts
    ? "For parts / Not working"
    : locked
      ? "Locked / Restricted"
      : displayUnit
        ? "Demo / Display unit"
        : "";
  return {
    conditionOverride,
    notes: signals.length > 0 ? `Title signals: ${signals.join(", ")}` : ""
  };
}

function chooseConditionOverride(...values: string[]) {
  const priority = new Map<string, number>([
    ["For parts / Not working", 3],
    ["Locked / Restricted", 2],
    ["Demo / Display unit", 1]
  ]);
  return values
    .filter(Boolean)
    .sort((left, right) => (priority.get(right) ?? 0) - (priority.get(left) ?? 0))[0] ?? "";
}

function matchesAdapterKeyword(
  adapter: BrowserSiteAdapter,
  keyword: string,
  title: string,
  urlSignals: ListingUrlSignals
): boolean {
  if (adapter.keywordMatch !== "compact_model") return true;
  if (urlSignals.definiteAccessory) return false;

  const matchingKeyword = adapter.countryCode ? normalizeForeignSearchKeyword(keyword) : keyword;
  const originalKeyword = keyword.normalize("NFKC").replace(/\s+/g, " ").trim();
  const usedForeignAlias = adapter.countryCode && matchingKeyword.toLowerCase() !== originalKeyword.toLowerCase();
  const compactKeyword = matchingKeyword.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (!/[a-z]/.test(compactKeyword) || (!/\d/.test(compactKeyword) && !usedForeignAlias)) return true;
  const compactTitle = title.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (!compactTitle.includes(compactKeyword)) return false;

  const definiteAccessorySignal = /\b(casekoo|cases? collection|all cases?|empty box|box only|no device|no phone|s(?:c)?reen protectors?|protectors? only)\b|箱のみ|空箱|本体なし/i;
  if (definiteAccessorySignal.test(title)) return false;
  if (/\ball for\b/i.test(title) && /\b(coach|kate spade|casetify)\b/i.test(title)) return false;
  const accessorySignal = /\b(cases?|covers?|screen protectors?|tempered glass|chargers?|charging cables?|cables?|phone holders?|wallet cases?|skins?|bumpers?)\b|ケース|カバー|フィルム|保護ガラス|充電器|ケーブル/i;
  const deviceSignal = /\b(unlocked|sim[- ]?free|\d{2,4}\s*gb|battery|icloud|verizon|t-mobile|at&t)\b|本体|simフリー|バッテリー|ジャンク/i;
  return !accessorySignal.test(title) || deviceSignal.test(title);
}

function buildEvidenceNote(adapter: BrowserSiteAdapter, rowSelector: string, index: number): string {
  return [
    `site=${adapter.siteKey}`,
    `row=${index + 1}`,
    `item=${rowSelector}`,
    `title=${adapter.searchSelectors.title}`,
    `price=${adapter.searchSelectors.price}`,
    `seller=${adapter.searchSelectors.seller}`
  ].join("; ");
}

function buildUnavailableLoginResult(adapter: BrowserSiteAdapter, session: BrowserSession, reason: string): LoginCheckResult {
  const warnings = buildLoginWarnings(adapter, reason);
  return LoginCheckResultSchema.parse({
    site: adapter.siteKey,
    login_status: "unknown",
    current_page: adapter.loginUrl,
    notes: warnings.join(" | "),
    errors: [buildUnavailableReason("loginCheck", adapter, session)]
  });
}

function buildUnavailableSearchResult(adapter: BrowserSiteAdapter, input: SearchCommandInput, session: BrowserSession, reason: string): SearchResult {
  const warnings = buildSearchWarnings(adapter, reason);
  return SearchResultSchema.parse({
    site: adapter.siteKey,
    keyword: input.keyword,
    login_status: "unknown",
    items: [],
    warnings,
    quality_meta: {
      extracted_count: 0,
      filtered_count: 0,
      duplicate_count: 0,
      warning_count: warnings.length
    },
    next_action: "attach_browser_runtime",
    errors: [buildUnavailableReason("search", adapter, session)]
  });
}

function categoryPagination(adapter: BrowserSiteAdapter, input: SearchCommandInput, result: Pick<SearchResult, "items" | "quality_meta" | "pagination">) {
  const observedCount = Math.max(result.items.length, result.quality_meta.extracted_count);
  const hasMore = Boolean(
    input.category
    && adapter.categoryPagination === "page"
    && (result.pagination.has_more || observedCount >= input.limit)
  );
  const existingCursor = result.pagination.next_cursor;
  const currentPage = input.cursor?.match(/^page:(\d+)$/)?.[1];
  const nextPage = currentPage ? Number(currentPage) + 1 : 2;
  return {
    next_cursor: hasMore && nextPage <= 50 ? existingCursor ?? `page:${nextPage}` : null,
    has_more: hasMore && nextPage <= 50
  };
}

export function mergeCategoryPageResults(results: SearchResult[]): SearchResult {
  if (results.length === 0) {
    throw new Error("at least one category page is required");
  }

  const first = results[0];
  const last = results[results.length - 1];
  const seen = new Set<string>();
  const items = results.flatMap((result) => result.items).filter((item) => {
    const key = item.url || `${item.title}:${item.price}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const warnings = [...new Set(results.flatMap((result) => result.warnings))];
  const errors = [...new Set(results.flatMap((result) => result.errors))];

  return SearchResultSchema.parse({
    ...first,
    items,
    warnings,
    errors,
    quality_meta: {
      extracted_count: results.reduce((sum, result) => sum + result.quality_meta.extracted_count, 0),
      filtered_count: results.reduce((sum, result) => sum + result.quality_meta.filtered_count, 0),
      duplicate_count: results.reduce((sum, result) => sum + result.quality_meta.duplicate_count, 0),
      warning_count: warnings.length
    },
    pagination: last.pagination,
    next_action: items.length > 0 ? "normalize" : last.next_action
  });
}

const MAX_PARENT_CATEGORY_PREFETCH_PAGES = 3;

function encodeAggregateCategoryCursor(sourceCursors: Record<string, string | null>) {
  return `aggregate:v1:${Buffer.from(JSON.stringify({ source_cursors: sourceCursors }), "utf8").toString("base64url")}`;
}

function decodeAggregateCategoryCursor(cursor: string | null | undefined, sourceCategoryIds: string[]) {
  const fallback = Object.fromEntries(sourceCategoryIds.map((sourceCategoryId) => [sourceCategoryId, cursor ?? null]));
  if (typeof cursor !== "string" || !cursor.startsWith("aggregate:v1:")) {
    return fallback;
  }

  try {
    const encoded = cursor.slice("aggregate:v1:".length);
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as { source_cursors?: Record<string, unknown> };
    return Object.fromEntries(sourceCategoryIds.map((sourceCategoryId) => {
      const value = parsed.source_cursors?.[sourceCategoryId];
      return [sourceCategoryId, typeof value === "string" && value.trim() !== "" ? value : null];
    }));
  } catch {
    return fallback;
  }
}

async function prefetchBroaderCategoryPages(
  session: BrowserSession,
  adapter: BrowserSiteAdapter,
  input: SearchCommandInput,
  plan: CategoryCollectionPlan,
  binding: SourceCategoryBinding | null,
  sourceCategoryId: string,
  firstPage: SearchResult
) {
  if (
    !input.category
    || plan.strategy !== "source_category"
    || plan.resolvedCategoryId === input.category.id
    || input.cursor
    || firstPage.items.length > 0
    || !firstPage.pagination.has_more
    || !firstPage.pagination.next_cursor
  ) {
    return firstPage;
  }

  const pages = [firstPage];
  let currentPage = firstPage;
  for (let index = 0; index < MAX_PARENT_CATEGORY_PREFETCH_PAGES; index += 1) {
    const nextCursor = currentPage.pagination.next_cursor;
    if (!nextCursor) break;
    currentPage = await extractSearchItems(session, adapter, { ...input, cursor: nextCursor });
    pages.push(currentPage);
    if (currentPage.items.length > 0 || !currentPage.pagination.has_more) break;
  }
  return pages.length > 1
    ? mergeCategoryPageResults(pages)
    : withCategoryMetadata(firstPage, input, binding, sourceCategoryId, adapter, plan);
}

function categoryMetadata(
  binding: SourceCategoryBinding | null,
  sourceCategoryId: string,
  strategy: CategoryCollectionStrategy | null = null
) {
  if (strategy === "keyword") {
    return {
      source_category_id: "",
      source_category_ids: [] as string[],
      source_category_path: [] as string[],
      category_mapping_mode: "keyword",
      category_mapping_confidence: "keyword_inferred"
    } as const;
  }

  const sourceCategoryIds = binding?.sourceCategoryIds?.length
    ? binding.sourceCategoryIds
    : binding?.sourceCategoryId
      ? [binding.sourceCategoryId]
      : [];
  return {
    source_category_id: sourceCategoryId,
    source_category_ids: sourceCategoryIds,
    source_category_path: binding?.sourceCategoryPaths?.[sourceCategoryId]
      ?? binding?.sourceCategoryPath
      ?? [],
    category_mapping_mode: binding?.collectionMode ?? "single",
    category_mapping_confidence: binding?.confidence ?? "unknown"
  } as const;
}

function categoryPlanWarnings(input: SearchCommandInput, plan: CategoryCollectionPlan | null): string[] {
  if (!input.category || input.category.id === "all" || !plan) return [];
  if (plan.strategy === "keyword") {
    return [`CATEGORY_KEYWORD_FALLBACK: ${input.category.label} has no verified source category ID; searched by category label`];
  }
  if (plan.resolvedCategoryId !== input.category.id) {
    return [`CATEGORY_PARENT_FALLBACK: ${input.category.label} used the verified parent category ${plan.binding?.sourceCategoryPath.join(" / ") ?? ""}`];
  }
  return [];
}

export function filterKeywordCategoryItems(result: SearchResult, input: SearchCommandInput, plan: CategoryCollectionPlan): SearchResult {
  if (!input.category || plan.strategy !== "keyword") return result;
  const requestedPath = input.category.path.length > 0
    ? input.category.path
    : [input.category.label];
  const filteredItems = result.items.filter((item) => {
    const inferred = classifySearchOnlyListing({ title: item.title, description: item.notes });
    return requestedPath.every((segment, index) => inferred.canonical_category_path[index] === segment);
  });
  const removedCount = result.items.length - filteredItems.length;
  return SearchResultSchema.parse({
    ...result,
    items: filteredItems,
    warnings: removedCount > 0
      ? [...result.warnings, `CATEGORY_KEYWORD_FILTER: removed ${removedCount} cross-category result(s)`]
      : result.warnings,
    quality_meta: {
      ...result.quality_meta,
      filtered_count: result.quality_meta.filtered_count + removedCount
    },
    next_action: filteredItems.length > 0 ? result.next_action : "inspect_keyword"
  });
}

function matchesKnownCategoryText(categoryId: string, title: string) {
  const text = title.toLowerCase();
  const bottoms = /바지|팬츠|청바지|슬랙스|레깅스|반바지|하의|쇼츠|데님|pants|jeans|shorts|denim|trousers/i.test(text);
  const tops = /티셔츠|셔츠|후드|니트|블라우스|맨투맨|스웨터|top|shirt|hoodie|sweater/i.test(text);
  const outer = /아우터|코트|패딩|자켓|재킷|점퍼|가디건|무스탕|베스트|outer|coat|jacket|jumper|cardigan/i.test(text);
  const skirts = /치마|스커트|skirt/i.test(text);
  const jumpsuit = /점프\s*수트|점프수트|올인원|jumpsuit|romper/i.test(text);
  const women = /여성|여자|우먼|women/i.test(text);
  const men = /남성|남자|맨즈|men(?:'s|s)?/i.test(text);

  if (categoryId === "fashion_women_bottoms" || categoryId === "fashion_men_bottoms") {
    if (!bottoms || /원피스|드레스|스커트|치마|티셔츠|셔츠|후드|니트|블라우스|코트|패딩|자켓|재킷|가디건|무스탕|dress|skirt|shirt|hoodie|coat|jacket/i.test(text)) return false;
    return categoryId === "fashion_women_bottoms" ? !men : !women;
  }
  if (categoryId === "fashion_women_tops" || categoryId === "fashion_men_tops") {
    if (!tops || bottoms || outer || skirts) return false;
    return categoryId === "fashion_women_tops" ? !men : !women;
  }
  if (categoryId === "fashion_women_outer" || categoryId === "fashion_men_outer") {
    if (!outer || bottoms || skirts) return false;
    return categoryId === "fashion_women_outer" ? !men : !women;
  }
  if (categoryId === "fashion_women_skirts") return skirts && !bottoms && !tops && !outer && !men;
  if (categoryId === "fashion_men_jumpsuit") return jumpsuit && !women;
  if (categoryId === "fashion_women") return !men;
  if (categoryId === "fashion_men") return !women;
  return true;
}

export function filterKnownCategoryItems(
  result: SearchResult,
  input: SearchCommandInput,
  plan?: CategoryCollectionPlan
): SearchResult {
  if (!input.category || !input.category.id.startsWith("fashion_")) return result;
  if (plan?.strategy === "source_category" && plan.resolvedCategoryId === input.category.id) return result;
  const filteredItems = result.items.filter((item) => matchesKnownCategoryText(input.category!.id, item.title));
  const removedCount = result.items.length - filteredItems.length;
  return SearchResultSchema.parse({
    ...result,
    items: filteredItems,
    warnings: removedCount > 0
      ? [...result.warnings, `CATEGORY_TEXT_FILTER: removed ${removedCount} title(s) that did not match ${input.category.label}`]
      : result.warnings,
    quality_meta: {
      ...result.quality_meta,
      filtered_count: result.quality_meta.filtered_count + removedCount
    },
    next_action: filteredItems.length > 0 ? result.next_action : "inspect_category_text"
  });
}

function withCategoryMetadata(
  result: SearchResult,
  input: SearchCommandInput,
  binding: SourceCategoryBinding | null,
  sourceCategoryId: string,
  adapter: BrowserSiteAdapter,
  plan: CategoryCollectionPlan
) {
  if (!input.category) return result;
  const filteredResult = filterKnownCategoryItems(filterKeywordCategoryItems(result, input, plan), input, plan);
  const metadata = categoryMetadata(binding, sourceCategoryId, plan.strategy);
  const warnings = [...filteredResult.warnings, ...categoryPlanWarnings(input, plan)];
  const categoryConfidence = plan.strategy === "source_category" && plan.resolvedCategoryId === input.category.id
    ? "source"
    : "inferred";
  return SearchResultSchema.parse({
    ...filteredResult,
    category: input.category,
    warnings,
    quality_meta: {
      ...filteredResult.quality_meta,
      warning_count: warnings.length
    },
    pagination: categoryPagination(adapter, input, filteredResult),
    items: filteredResult.items.map((item) => ({
      ...item,
      canonical_category_id: input.category?.id ?? "",
      canonical_category_path: input.category?.path ?? [],
      ...metadata,
      category_confidence: categoryConfidence
    }))
  });
}

async function readIndexedText(row: import("./browserSession.js").BrowserNodeRef, selector: string, index?: number) {
  if (index === undefined) return row.text(selector);
  const matches = await row.queryAll(selector);
  return matches[index] ? matches[index].text() : "";
}

async function extractLoginStatus(session: BrowserSession, adapter: BrowserSiteAdapter): Promise<LoginCheckResult> {
  await session.goto(adapter.loginUrl);
  await session.waitForIdle();
  const pageHtml = await session.html();

  if (hasBlockedPageSignals(pageHtml)) {
    return LoginCheckResultSchema.parse({
      site: adapter.siteKey,
      login_status: "unknown",
      current_page: await session.currentUrl(),
      notes: `blocked page detected while checking login for ${adapter.siteKey}`,
      errors: ["BLOCKED_PAGE: login response indicates an access challenge"]
    });
  }

  const signedInSelector = await firstMatchingSelector(session, adapter.loginSelectors.signedIn);
  if (signedInSelector) {
    return LoginCheckResultSchema.parse({
      site: adapter.siteKey,
      login_status: "logged_in",
      current_page: await session.currentUrl(),
      notes: `signed-in selector matched: ${signedInSelector}`,
      errors: []
    });
  }

  const signedOutSelector = await firstMatchingSelector(session, adapter.loginSelectors.signedOut);
  return LoginCheckResultSchema.parse({
    site: adapter.siteKey,
    login_status: signedOutSelector ? "logged_out" : "unknown",
    current_page: await session.currentUrl(),
    notes: signedOutSelector
      ? `signed-out selector matched: ${signedOutSelector}`
      : `No login selectors matched for ${adapter.siteKey}`,
    errors: signedOutSelector ? [] : ["LOGIN_STATE_UNCLEAR: no login selector matched"]
  });
}

async function extractSearchItems(
  session: BrowserSession,
  adapter: BrowserSiteAdapter,
  input: SearchCommandInput,
  sourceCategoryIdOverride?: string,
  options: { skipNavigation?: boolean } = {}
): Promise<SearchResult> {
  const plannedCategory = input.category && input.category.id !== "all"
    ? resolveCategoryCollectionPlan(adapter.siteKey, input.category.id)
    : null;
  const categoryPlan: CategoryCollectionPlan | null = plannedCategory
    && plannedCategory.strategy === "source_category"
    && !adapter.categoryUrl
    ? {
        requestedCategoryId: plannedCategory.requestedCategoryId,
        resolvedCategoryId: null,
        strategy: "keyword",
        binding: null
      }
    : plannedCategory;
  const categoryBinding = categoryPlan?.strategy === "source_category" ? categoryPlan.binding : null;

  if (
    categoryBinding?.collectionMode === "aggregate"
    && !sourceCategoryIdOverride
  ) {
    const sourceCategoryIds = categoryBinding.sourceCategoryIds ?? [categoryBinding.sourceCategoryId];
    const sourceCursors = decodeAggregateCategoryCursor(input.cursor, sourceCategoryIds);
    const sourceResults: SearchResult[] = [];
    for (const sourceCategoryId of sourceCategoryIds) {
      sourceResults.push(await extractSearchItems(
        session,
        adapter,
        { ...input, cursor: sourceCursors[sourceCategoryId] ?? null },
        sourceCategoryId
      ));
    }

    const seenUrls = new Set<string>();
    const itemBuckets = sourceResults.map((result) => [...result.items]);
    const items: SearchItem[] = [];
    for (let index = 0; items.length < input.limit && itemBuckets.some((bucket) => bucket.length > 0); index += 1) {
      for (const bucket of itemBuckets) {
        const item = bucket.shift();
        if (!item || !item.url || seenUrls.has(item.url)) continue;
        seenUrls.add(item.url);
        items.push(item);
        if (items.length >= input.limit) break;
      }
    }
    const warnings = sourceResults.flatMap((result) => result.warnings);
    const errors = sourceResults.flatMap((result) => result.errors);
    const nextSourceCursors = Object.fromEntries(sourceCategoryIds.map((sourceCategoryId, index) => [
      sourceCategoryId,
      sourceResults[index]?.pagination.next_cursor ?? null
    ]));
    const hasMore = Object.values(nextSourceCursors).some((cursor) => typeof cursor === "string" && cursor.length > 0);
    return SearchResultSchema.parse({
      site: adapter.siteKey,
      keyword: input.keyword,
      category: input.category ?? null,
      login_status: sourceResults.some((result) => result.login_status === "logged_in") ? "logged_in" : "unknown",
      items,
      warnings: warnings.length > 0 ? [`Combined ${sourceResults.length} marketplace category IDs.`, ...warnings] : [],
      quality_meta: {
        extracted_count: sourceResults.reduce((sum, result) => sum + result.quality_meta.extracted_count, 0),
        filtered_count: sourceResults.reduce((sum, result) => sum + result.quality_meta.filtered_count, 0),
        duplicate_count: sourceResults.reduce((sum, result) => sum + result.quality_meta.duplicate_count, 0),
        warning_count: warnings.length
      },
      next_action: "normalize",
      errors,
      pagination: {
        has_more: hasMore,
        next_cursor: hasMore ? encodeAggregateCategoryCursor(nextSourceCursors) : null
      }
    });
  }

  const sourceCategoryId = sourceCategoryIdOverride ?? categoryBinding?.sourceCategoryId ?? "";
  const categoryKeyword = input.keyword.trim() || input.category?.label || "";

  const url = categoryPlan?.strategy === "source_category" && categoryBinding && adapter.categoryUrl
    ? adapter.categoryUrl(sourceCategoryId, input.limit, input.cursor)
    : adapter.searchUrl(categoryKeyword, input.limit, input.cursor);
  if (!options.skipNavigation) {
    await session.goto(url);
    await session.waitForIdle(adapter.readySelector ?? adapter.searchSelectors.item);
  }
  const pageHtml = await session.html();
  const publicSearchResult = await tryExtractPublicSearchResult(adapter, input, pageHtml);
  if (publicSearchResult) {
    if (!categoryPlan) return publicSearchResult;
    const categorized = withCategoryMetadata(publicSearchResult, input, categoryBinding, sourceCategoryId, adapter, categoryPlan);
    return prefetchBroaderCategoryPages(
      session,
      adapter,
      input,
      categoryPlan,
      categoryBinding,
      sourceCategoryId,
      categorized
    );
  }

  const rows = await session.queryAll(adapter.searchSelectors.item);
  if (hasBlockedPageSignals(pageHtml) && rows.length === 0) {
    const warnings = [`Blocked page detected while searching ${adapter.siteKey}`, ...buildSearchWarnings(adapter, "blocked page")];
    return SearchResultSchema.parse({
      site: adapter.siteKey,
      keyword: input.keyword,
      login_status: "unknown",
      items: [],
      warnings,
      quality_meta: {
        extracted_count: 0,
        filtered_count: 0,
        duplicate_count: 0,
        warning_count: warnings.length
      },
      next_action: "inspect_blocked_page",
      errors: ["BLOCKED_PAGE: search response indicates an access challenge"]
    });
  }

  const items: SearchItem[] = [];
  let incompleteRowCount = 0;
  let irrelevantRowCount = 0;
  let inspectedRowCount = 0;
  let matchedRowCount = 0;
  let hasMoreWithinSearchPage = false;
  const searchCursorMatch = input.cursor?.match(/^page:(\d+)(?::offset:(\d+))?$/);
  const currentSearchPage = Number(searchCursorMatch?.[1] ?? "1");
  const currentSearchOffset = Number(searchCursorMatch?.[2] ?? "0");
  const fallbackCurrency = resolveSite(adapter.siteKey).currency;
  const pageUrl = await session.currentUrl();
  for (const [index, row] of rows.entries()) {
    if (items.length >= input.limit) {
      hasMoreWithinSearchPage = true;
      break;
    }
    inspectedRowCount += 1;

    let title = await readIndexedText(row, adapter.searchSelectors.title, adapter.searchSelectors.titleIndex);
    if (!title && adapter.searchSelectors.image) {
      title = firstDefined(
        await row.attr(adapter.searchSelectors.image, "alt"),
        await row.attr(adapter.searchSelectors.image, "aria-label")
      ).replace(/(?:のサムネイル|\s+thumbnail)$/i, "").trim();
    }
    const priceText = await readIndexedText(row, adapter.searchSelectors.price, adapter.searchSelectors.priceIndex);
    const seller = await readIndexedText(row, adapter.searchSelectors.seller, adapter.searchSelectors.sellerIndex);
    const href = adapter.searchSelectors.urlOnItem
      ? await row.attrSelf("href")
      : await row.attr(adapter.searchSelectors.url, "href");
    const imageSrc = adapter.searchSelectors.image ? await row.attr(adapter.searchSelectors.image, "src") : "";
    const imageDataSrc = adapter.searchSelectors.image ? await row.attr(adapter.searchSelectors.image, "data-src") : "";
    const imageOriginal = adapter.searchSelectors.image ? await row.attr(adapter.searchSelectors.image, "data-original") : "";
    const imageSrcset = adapter.searchSelectors.image ? await row.attr(adapter.searchSelectors.image, "srcset") : "";
    const imageUrl = absoluteUrl(firstDefined(imageDataSrc, imageOriginal, imageSrc, parseSrcset(imageSrcset)), pageUrl);
    const location = adapter.searchSelectors.location ? await row.text(adapter.searchSelectors.location) : "";
    const postedAt = adapter.searchSelectors.postedAt ? await row.text(adapter.searchSelectors.postedAt) : "";
    const condition = adapter.searchSelectors.condition ? await row.text(adapter.searchSelectors.condition) : "";
    const shipping = adapter.searchSelectors.shipping ? await row.text(adapter.searchSelectors.shipping) : "";
    const notes = adapter.searchSelectors.notes ? await row.text(adapter.searchSelectors.notes) : "";
    const price = parsePrice(priceText);
    const currency = parseCurrency(priceText, fallbackCurrency);
    const urlValue = absoluteUrl(firstDefined(href, ""), pageUrl);
    const urlSignals = listingUrlSignals(urlValue);
    const titleSignals = listingTitleSignals(title);

    if (title === "" || price === null || urlValue === "") {
      incompleteRowCount += 1;
      continue;
    }
    if (!matchesAdapterKeyword(adapter, input.keyword, title, urlSignals)) {
      irrelevantRowCount += 1;
      continue;
    }

    if (matchedRowCount < currentSearchOffset) {
      matchedRowCount += 1;
      continue;
    }
    matchedRowCount += 1;

    const itemNotes = [notes, urlSignals.notes, titleSignals.notes, buildEvidenceNote(adapter, row.selector, index)]
      .filter(Boolean)
      .join(" | ");

    items.push({
      title,
      price,
      currency,
      price_label: adapter.priceLabel ?? "",
      seller,
      status: "unknown",
      condition: chooseConditionOverride(urlSignals.conditionOverride, titleSignals.conditionOverride) || condition,
      shipping,
      location,
      posted_at: postedAt,
      url: urlValue,
      image_url: firstDefined(imageUrl, ""),
      notes: itemNotes,
      listing_type_hint: "unknown",
      warnings: price === null ? ["PRICE_UNPARSEABLE"] : [],
      sale_status: "active",
      estimated_deal_price: null,
      price_change_count: 0,
      upload_date: "",
      seller_upload_count: 0,
      description_length: itemNotes.length,
      has_photo: Boolean(imageUrl),
      canonical_category_id: input.category?.id ?? "",
      canonical_category_path: input.category?.path ?? [],
      ...categoryMetadata(categoryBinding, sourceCategoryId, categoryPlan?.strategy ?? null),
      category_confidence: categoryPlan
        ? categoryPlan.strategy === "source_category" && categoryPlan.resolvedCategoryId === input.category?.id ? "source" : "inferred"
        : "unknown"
    });
  }

  const hasNextSearchPage = Boolean(
    adapter.searchPagination === "page"
    && adapter.searchSelectors.nextPage
    && currentSearchPage < 50
    && await session.exists(adapter.searchSelectors.nextPage)
  );

  if (rows.length > 0 && items.length === 0 && irrelevantRowCount > 0) {
    const warnings = [`NO_RELEVANT_RESULTS: ${irrelevantRowCount} valid listings did not match the requested keyword`];
    return SearchResultSchema.parse({
      site: adapter.siteKey,
      keyword: input.keyword,
      category: input.category ?? null,
      collection_state: "filtered_empty",
      login_status: "unknown",
      items: [],
      warnings,
      quality_meta: {
        extracted_count: Math.max(inspectedRowCount, incompleteRowCount + irrelevantRowCount),
        filtered_count: incompleteRowCount + irrelevantRowCount,
        duplicate_count: 0,
        warning_count: warnings.length
      },
      next_action: hasNextSearchPage ? "continue_search" : "inspect_keyword",
      errors: [],
      pagination: {
        has_more: hasNextSearchPage,
        next_cursor: hasNextSearchPage ? `page:${currentSearchPage + 1}` : null
      }
    });
  }

  if (rows.length > 0 && items.length === 0) {
    const warnings = [`Extracted rows did not expose the required search fields for ${adapter.siteKey}`, ...buildSearchWarnings(adapter, "selector drift")];
    return SearchResultSchema.parse({
      site: adapter.siteKey,
      keyword: input.keyword,
      login_status: "unknown",
      items,
      warnings,
      quality_meta: {
        extracted_count: rows.length,
        filtered_count: incompleteRowCount + irrelevantRowCount,
        duplicate_count: 0,
        warning_count: warnings.length
      },
      next_action: "inspect_selectors",
      errors: ["SELECTOR_DRIFT: required fields were missing from extracted rows"]
    });
  }

  if (items.length === 0 && hasExplicitEmptySearchEvidence(adapter, pageHtml)) {
    return SearchResultSchema.parse({
      site: adapter.siteKey,
      keyword: input.keyword,
      category: input.category ?? null,
      login_status: "unknown",
      items: [],
      warnings: [],
      quality_meta: {
        extracted_count: 0,
        filtered_count: 0,
        duplicate_count: 0,
        warning_count: 0
      },
      next_action: "inspect_keyword",
      errors: [],
      pagination: {
        has_more: false,
        next_cursor: null
      }
    });
  }

  if (items.length === 0) {
    const failureKind = classifySearchFailure(pageHtml, rows.length);
    const errorCode =
      failureKind === "blocked_page"
        ? "BLOCKED_PAGE: search response indicates an access challenge"
        : failureKind === "unsupported_evidence_shape"
          ? "UNSUPPORTED_EVIDENCE_SHAPE: search payload did not match the selector contract"
          : "EMPTY_RESULTS: browser extractor found no rows";
    const nextAction =
      failureKind === "blocked_page"
        ? "inspect_blocked_page"
        : failureKind === "unsupported_evidence_shape"
          ? "inspect_payload_shape"
          : "inspect_selectors";
    const warnings = [
      failureKind === "unsupported_evidence_shape"
        ? `Unsupported evidence shape for ${adapter.siteKey}; selectors did not match the captured payload`
        : `No search rows matched selector: ${adapter.searchSelectors.item}`,
      ...buildSearchWarnings(adapter, failureKind ?? "empty results")
    ];
    return SearchResultSchema.parse({
      site: adapter.siteKey,
      keyword: input.keyword,
      login_status: "unknown",
      items: [],
      warnings,
      quality_meta: {
        extracted_count: 0,
        filtered_count: 0,
        duplicate_count: 0,
        warning_count: warnings.length
      },
      next_action: nextAction,
      errors: [errorCode]
    });
  }

  const result = SearchResultSchema.parse({
    site: adapter.siteKey,
    keyword: input.keyword,
    category: input.category ?? null,
    login_status: "unknown",
    items,
    warnings: [],
    quality_meta: {
      extracted_count: Math.max(inspectedRowCount, items.length + incompleteRowCount + irrelevantRowCount),
      filtered_count: incompleteRowCount + irrelevantRowCount,
      duplicate_count: 0,
      warning_count: 0
    },
    next_action: "normalize",
    errors: [],
    pagination: {
      has_more: hasMoreWithinSearchPage || hasNextSearchPage,
      next_cursor: hasMoreWithinSearchPage
        ? `page:${currentSearchPage}:offset:${currentSearchOffset + items.length}`
        : hasNextSearchPage ? `page:${currentSearchPage + 1}` : null
    }
  });
  return categoryPlan
    ? withCategoryMetadata(result, input, categoryBinding, sourceCategoryId, adapter, categoryPlan)
    : result;
}

export async function collectLoginCheck(siteKey: string, options: { showBrowser?: boolean; signal?: AbortSignal } = {}): Promise<LoginCheckResult> {
  options.signal?.throwIfAborted();
  const adapter = resolveBrowserSiteAdapter(siteKey);
  const session = createBrowserSession({ showBrowser: options.showBrowser });
  trace("collector.browser.loginCheck:start", {
    site: siteKey,
    available: session.available,
    mode: session.mode,
    showBrowser: session.showBrowser
  });

  if (!session.available) {
    return buildUnavailableLoginResult(adapter, session, session.unavailableReason ?? "browser runtime unavailable");
  }

  try {
    return await extractLoginStatus(session, adapter);
  } catch (error) {
    if (error instanceof BrowserRuntimeUnavailableError) {
      return buildUnavailableLoginResult(adapter, session, error.message);
    }
    return LoginCheckResultSchema.parse({
      site: adapter.siteKey,
      login_status: "unknown",
      current_page: adapter.loginUrl,
      notes: `login extraction failed: ${error instanceof Error ? error.message : String(error)}`,
      errors: ["LOGIN_EXTRACTION_FAILED"]
    });
  } finally {
    await session.close();
  }
}

export async function collectSearchListings(input: SearchCommandInput, options: { showBrowser?: boolean; signal?: AbortSignal } = {}): Promise<SearchResult> {
  options.signal?.throwIfAborted();
  const adapter = resolveBrowserSiteAdapter(input.site);
  const directPublicResult = await tryExtractPublicSearchResult(adapter, input, "");
  if (directPublicResult) return directPublicResult;
  const useHeadlessDynamicBrowser = Boolean(
    !options.showBrowser
    && (
      adapter.searchRendering === "dynamic"
      || (input.category && adapter.categoryRendering === "dynamic")
    )
  );
  const session = createBrowserSession({ showBrowser: options.showBrowser, headless: useHeadlessDynamicBrowser });
  trace("collector.browser.search:start", {
    site: input.site,
    keyword: input.keyword,
    limit: input.limit,
    available: session.available,
    mode: session.mode,
    showBrowser: session.showBrowser
  });

  if (!session.available) {
    return buildUnavailableSearchResult(adapter, input, session, session.unavailableReason ?? "browser runtime unavailable");
  }

  try {
    return await extractSearchItems(session, adapter, input);
  } catch (error) {
    if (error instanceof BrowserRuntimeUnavailableError) {
      return buildUnavailableSearchResult(adapter, input, session, error.message);
    }
    return SearchResultSchema.parse({
      site: adapter.siteKey,
      keyword: input.keyword,
      login_status: "unknown",
      items: [],
      warnings: [`search extraction failed: ${error instanceof Error ? error.message : String(error)}`],
      quality_meta: {
        extracted_count: 0,
        filtered_count: 0,
        duplicate_count: 0,
        warning_count: 1
      },
      next_action: "inspect_selectors",
      errors: ["SEARCH_EXTRACTION_FAILED"]
    });
  } finally {
    await session.close();
  }
}

export async function extractSearchListingsFromHtml(
  input: SearchCommandInput,
  html: string,
  pageUrl: string
): Promise<SearchResult> {
  const adapter = resolveBrowserSiteAdapter(input.site);
  const session = createBrowserFixtureSession(html, pageUrl);
  try {
    return await extractSearchItems(session, adapter, input, undefined, { skipNavigation: true });
  } finally {
    await session.close();
  }
}
