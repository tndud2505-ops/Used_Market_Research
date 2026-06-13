import {
  LoginCheckResultSchema,
  SearchResultSchema,
  type LoginCheckResult,
  type SearchCommandInput,
  type SearchItem,
  type SearchResult
} from "../../MCP/logic/types.js";
import { trace } from "../../MCP/logic/runtime-trace.js";
import { createBrowserSession, BrowserRuntimeUnavailableError, type BrowserFailureKind, type BrowserSession } from "./browserSession.js";
import { tryExtractPublicSearchResult } from "./publicSearchExtractors.js";
import { resolveBrowserSiteAdapter, type BrowserSiteAdapter, firstDefined, firstMatchingSelector } from "./sites/index.js";

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

function parsePrice(text: string): number | null {
  const digits = text.replace(/[^\d]/g, "");
  if (digits === "") {
    return null;
  }
  const value = Number(digits);
  return Number.isFinite(value) ? value : null;
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

async function extractSearchItems(session: BrowserSession, adapter: BrowserSiteAdapter, input: SearchCommandInput): Promise<SearchResult> {
  const url = adapter.searchUrl(input.keyword, input.limit);
  await session.goto(url);
  await session.waitForIdle();
  const pageHtml = await session.html();
  const publicSearchResult = await tryExtractPublicSearchResult(adapter, input, pageHtml);
  if (publicSearchResult) {
    return publicSearchResult;
  }

  if (hasBlockedPageSignals(pageHtml)) {
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

  const rows = await session.queryAll(adapter.searchSelectors.item);
  const items: SearchItem[] = [];
  for (const [index, row] of rows.entries()) {
    if (items.length >= input.limit) {
      break;
    }

    const title = await row.text(adapter.searchSelectors.title);
    const priceText = await row.text(adapter.searchSelectors.price);
    const seller = await row.text(adapter.searchSelectors.seller);
    const href = await row.attr(adapter.searchSelectors.url, "href");
    const location = adapter.searchSelectors.location ? await row.text(adapter.searchSelectors.location) : "";
    const postedAt = adapter.searchSelectors.postedAt ? await row.text(adapter.searchSelectors.postedAt) : "";
    const notes = adapter.searchSelectors.notes ? await row.text(adapter.searchSelectors.notes) : "";
    const price = parsePrice(priceText);
    const urlValue = firstDefined(href, "");

    items.push({
      title,
      price,
      currency: "KRW",
      seller,
      status: "unknown",
      condition: "",
      shipping: "",
      location,
      posted_at: postedAt,
      url: urlValue,
      notes: `${notes}${notes ? " | " : ""}${buildEvidenceNote(adapter, row.selector, index)}`,
      listing_type_hint: "unknown",
      warnings: price === null ? ["PRICE_UNPARSEABLE"] : [],
      sale_status: "active",
      estimated_deal_price: null,
      price_change_count: 0,
      upload_date: "",
      seller_upload_count: 0,
      description_length: notes.length,
      has_photo: false
    });
  }

  const usableItems = items.filter((item) => item.title !== "" && item.price !== null && item.url !== "");
  if (rows.length > 0 && usableItems.length === 0) {
    const warnings = [`Extracted rows did not expose the required search fields for ${adapter.siteKey}`, ...buildSearchWarnings(adapter, "selector drift")];
    return SearchResultSchema.parse({
      site: adapter.siteKey,
      keyword: input.keyword,
      login_status: "unknown",
      items,
      warnings,
      quality_meta: {
        extracted_count: items.length,
        filtered_count: 0,
        duplicate_count: 0,
        warning_count: warnings.length
      },
      next_action: "inspect_selectors",
      errors: ["SELECTOR_DRIFT: required fields were missing from extracted rows"]
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

  return SearchResultSchema.parse({
    site: adapter.siteKey,
    keyword: input.keyword,
    login_status: "unknown",
    items,
    warnings: [],
    quality_meta: {
      extracted_count: items.length,
      filtered_count: 0,
      duplicate_count: 0,
      warning_count: 0
    },
    next_action: "normalize",
    errors: []
  });
}

export async function collectLoginCheck(siteKey: string, options: { showBrowser?: boolean } = {}): Promise<LoginCheckResult> {
  const adapter = resolveBrowserSiteAdapter(siteKey);
  const session = createBrowserSession(options);
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

export async function collectSearchListings(input: SearchCommandInput, options: { showBrowser?: boolean } = {}): Promise<SearchResult> {
  const adapter = resolveBrowserSiteAdapter(input.site);
  const session = createBrowserSession(options);
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
