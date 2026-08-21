import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const TARGET_SITES = ["bunjang", "joonggonara", "hellomarket", "rethinkmall"];
const MAIN_API_SITES = new Set(TARGET_SITES);
const SITE_NAMES = {
  bunjang: "\uBC88\uAC1C\uC7A5\uD130",
  joonggonara: "\uC911\uACE0\uB098\uB77C",
  hellomarket: "\uD5EC\uB85C\uB9C8\uCF13",
  rethinkmall: "\uB9AC\uC4F9\uD06C\uBAB0"
};
const DEFAULT_KEYWORD = "RTX 5070";
const DEFAULT_CATEGORY_ID = "pc";
const DEFAULT_LIMIT = 10;
const DEFAULT_TIMEOUT_MS = 20_000;

const args = parseArgs(process.argv.slice(2));
const keyword = String(args.keyword || args._[0] || DEFAULT_KEYWORD).trim();
const apiBaseUrl = trimTrailingSlash(
  String(args["api-url"] || process.env.COMPARE_API_URL || process.env.API_URL || `http://127.0.0.1:${process.env.PORT || 8787}`)
);
const requestedMode = String(args.mode || "all").toLowerCase();
const modes = requestedMode === "all"
  ? ["integrated", "individual", "category"]
  : requestedMode.split(",").map((value) => value.trim()).filter(Boolean);
const categoryId = String(args["category-id"] || args.category || process.env.COMPARE_CATEGORY_ID || DEFAULT_CATEGORY_ID).trim();
const limit = clampInteger(args.limit, DEFAULT_LIMIT, 1, 40);
const repeat = clampInteger(args.repeat, 1, 1, 100);
const timeoutMs = clampInteger(args["timeout-ms"], DEFAULT_TIMEOUT_MS, 1_000, 120_000);
const delayMs = clampInteger(args["delay-ms"], 0, 0, 120_000);
const failOnDiff = Boolean(args["fail-on-diff"]);
const sites = parseSites(args.sites);

const modules = await loadOptionalModules();

try {
  const report = await runHarness();
  console.log(JSON.stringify(report, null, 2));
  if (failOnDiff && report.summary.differences > 0) process.exitCode = 1;
} catch (error) {
  console.log(JSON.stringify({
    harness: "real-site-compare",
    status: "failed",
    error: error instanceof Error ? error.message : String(error)
  }, null, 2));
  process.exitCode = 1;
}

async function runHarness() {
  validateModes();
  if (!keyword) throw new Error("keyword is required");

  const category = modes.includes("category")
    ? await resolveCategorySelection()
    : null;
  const iterations = [];

  for (let iteration = 1; iteration <= repeat; iteration += 1) {
    const modeResults = [];
    for (const mode of modes) {
      modeResults.push(await runMode(mode, { category, iteration }));
      if (delayMs > 0 && !(iteration === repeat && mode === modes.at(-1))) {
        await delay(delayMs);
      }
    }
    iterations.push({ iteration, modes: modeResults });
  }

  const siteSummaries = Object.fromEntries(TARGET_SITES.map((site) => {
    const comparisons = iterations.flatMap((iteration) => iteration.modes)
      .flatMap((mode) => mode.sites)
      .filter((result) => result.site === site);
    return [site, summarizeSite(comparisons)];
  }));
  const summary = summarizeReport(iterations);

  return {
    harness: "real-site-compare",
    generated_at: new Date().toISOString(),
    status: summary.failures > 0 ? "completed_with_failures" : summary.differences > 0 ? "completed_with_differences" : "completed",
    configuration: {
      api_base_url: apiBaseUrl,
      keyword,
      sites,
      modes,
      category_id: category?.id ?? null,
      category_label: category?.label ?? null,
      limit,
      repeat,
      timeout_ms: timeoutMs,
      fail_on_diff: failOnDiff,
      source_extractors: {
        public_search_extractors: Boolean(modules.publicSearchExtractors),
        hello_market_probe: Boolean(modules.helloMarketProbe),
        rethinkmall_probe: Boolean(modules.rethinkmallProbe),
        category_catalog: Boolean(modules.categoryCatalog)
      }
    },
    category_catalog_http: category?.catalog_http ?? null,
    iterations,
    site_summaries: siteSummaries,
    summary
  };
}

async function runMode(mode, context) {
  const modeContext = {
    mode,
    keyword,
    limit,
    category: mode === "category" ? context.category : null
  };

  const [originalResults, apiResults] = await Promise.all([
    Promise.all(sites.map((site) => collectOriginalSite(site, modeContext))),
    collectOurApiResults(modeContext)
  ]);
  const originalBySite = new Map(originalResults.map((result) => [result.site, result]));
  const apiBySite = new Map(apiResults.map((result) => [result.site, result]));
  const siteResults = sites.map((site) => compareSite(
    originalBySite.get(site),
    apiBySite.get(site),
    modeContext
  ));
  const summary = summarizeSite(siteResults);

  return {
    mode,
    iteration: context.iteration,
    request_scope: mode === "integrated"
      ? "all four target sites are requested together"
      : mode === "category"
        ? "all four target sites use category_id and the same category filter"
        : "one /api/search request per site",
    category: modeContext.category ? {
      id: modeContext.category.id,
      label: modeContext.category.label,
      path: modeContext.category.path
    } : null,
    sites: siteResults,
    summary
  };
}

async function collectOurApiResults(modeContext) {
  const results = [];
  if (modeContext.mode === "integrated") {
    const requestBody = buildMainApiRequest(sites, modeContext);
    const response = await postJson("/api/search", requestBody);
    for (const site of sites) {
      results.push(buildOurSiteResult(site, response, requestBody, "/api/search", modeContext));
    }
  } else {
    for (const site of sites) {
      const requestBody = buildMainApiRequest([site], modeContext);
      const response = await postJson("/api/search", requestBody);
      results.push(buildOurSiteResult(site, response, requestBody, "/api/search", modeContext));
    }
  }
  return results;
}

function buildMainApiRequest(requestSites, modeContext) {
  const body = {
    keyword: modeContext.keyword,
    sites: requestSites,
    limit: modeContext.limit
  };
  if (modeContext.mode === "category" && modeContext.category?.id) {
    body.category_id = modeContext.category.id;
  }
  return body;
}

function buildOurSiteResult(site, response, requestBody, endpoint, modeContext) {
  const data = asRecord(response.payload?.data);
  const sourceItems = Array.isArray(data.items) ? data.items : [];
  const items = sourceItems.filter((item) => asRecord(item).site === site);
  return {
    site,
    name: SITE_NAMES[site] || site,
    endpoint: `${apiBaseUrl}${endpoint}`,
    request: requestBody,
    http: response.http,
    status: response.http.ok && response.payload ? "ready" : "failed",
    response_status: response.http.status,
    response_error: response.error || null,
    query: data.query || null,
    category: data.category || null,
    reported_count: readNumber(asRecord(data.summary).item_count, null),
    items: items.slice(0, modeContext.limit).map((item) => normalizeItem(site, item)),
    raw_response_summary: {
      item_count: sourceItems.length,
      source_count: Array.isArray(data.sources) ? data.sources.length : 0,
      quality: data.quality || null,
      pagination: data.pagination || null
    }
  };
}

async function collectOriginalSite(site, modeContext) {
  const sourceUrls = buildOriginalUrls(site, modeContext);
  // Keep the original-site side independent from the production live-search
  // collector. Reusing collectOne here turns this harness into a self-compare
  // and can hide parser/filter regressions. Only direct HTTP evidence, the
  // public HTML extractors, and the standalone source probes below are valid
  // original-site evidence.
  if (site === "rethinkmall" && modules.rethinkmallProbe?.fetchRethinkMallSearch) {
    const pageEvidence = await Promise.all(sourceUrls.map((url) => requestHttp(url, { headers: sourceHeaders(url) })));
    try {
      const probe = await modules.rethinkmallProbe.fetchRethinkMallSearch(modeContext.keyword);
      const normalizedItems = deduplicateItems((probe.items || []).map((item) => normalizeItem(site, item)));
      return {
        site,
        name: SITE_NAMES[site] || site,
        search_urls: sourceUrls,
        http_results: pageEvidence.map((result) => result.http),
        parser: "rethinkmallProbeBrowser",
        status: pageEvidence.some((result) => result.http.ok) && normalizedItems.length > 0 ? "ready" : "warning",
        reported_count: probe.reported_count,
        extracted_count: normalizedItems.length,
        warnings: uniqueStrings(probe.validation?.warnings || []),
        errors: uniqueStrings([
          ...(probe.validation?.errors || []),
          ...pageEvidence.filter((result) => !result.http.ok).map((result) => `HTTP ${result.http.status || "request_failed"}`)
        ]),
        items: normalizedItems.slice(0, modeContext.limit)
      };
    } catch (error) {
      return {
        site,
        name: SITE_NAMES[site] || site,
        search_urls: sourceUrls,
        http_results: pageEvidence.map((result) => result.http),
        parser: "rethinkmallProbeBrowser",
        status: "failed",
        reported_count: null,
        extracted_count: 0,
        warnings: ["독립 브라우저 원본 추출 실패"],
        errors: [error instanceof Error ? error.message : String(error)],
        items: []
      };
    }
  }
  const httpResults = [];
  const extractedItems = [];
  const extractionErrors = [];
  const extractionWarnings = [];
  let reportedCount = null;
  let parser = "fallback";

  for (const [index, url] of sourceUrls.entries()) {
    const page = await requestHttp(url, { headers: sourceHeaders(url) });
    httpResults.push(page.http);
    if (!page.http.ok) {
      extractionErrors.push(`${url}: HTTP ${page.http.status || "request_failed"}`);
      continue;
    }

    try {
      if (site === "hellomarket" && modules.helloMarketProbe) {
        const probe = modules.helloMarketProbe.buildHelloMarketProbeResult(
          modeContext.keyword,
          page.text,
          page.http.response_url || url,
          "live"
        );
        parser = "helloMarketProbe";
        extractedItems.push(...probe.items);
        reportedCount = addNullableCount(reportedCount, probe.reported_count);
        extractionWarnings.push(...probe.validation.warnings);
        extractionErrors.push(...probe.validation.errors);
        continue;
      }

      if (site === "rethinkmall" && modules.rethinkmallProbe) {
        const probe = modules.rethinkmallProbe.buildRethinkMallProbeResult(
          modeContext.keyword,
          page.text,
          page.http.response_url || url,
          "live"
        );
        parser = "rethinkmallProbe";
        extractedItems.push(...probe.items);
        reportedCount = addNullableCount(reportedCount, probe.reported_count);
        extractionWarnings.push(...probe.validation.warnings);
        extractionErrors.push(...probe.validation.errors);
        continue;
      }

      if (modules.publicSearchExtractors && modules.siteAdapters) {
        const adapter = modules.siteAdapters.resolveBrowserSiteAdapter(site);
        const sourceCategoryId = getSourceCategoryIds(site, modeContext.category)[index] || undefined;
        const input = {
          site,
          keyword: modeContext.keyword,
          limit: modeContext.limit,
          cursor: null,
          category: modeContext.category ? {
            id: modeContext.category.id,
            label: modeContext.category.label,
            path: modeContext.category.path
          } : undefined,
          sourceCategoryId
        };
        const extracted = await modules.publicSearchExtractors.tryExtractPublicSearchResult(adapter, input, page.text);
        if (extracted) {
          parser = "publicSearchExtractors";
          extractedItems.push(...extracted.items);
          extractionWarnings.push(...extracted.warnings);
          extractionErrors.push(...extracted.errors);
          continue;
        }
      }

      const fallback = extractGenericHtmlItems(page.text, page.http.response_url || url, site);
      parser = "genericHtmlFallback";
      extractedItems.push(...fallback);
    } catch (error) {
      extractionErrors.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (site === "bunjang") {
    const evidence = await collectBunjangApiEvidence(modeContext);
    httpResults.push(...evidence.httpResults);
    extractedItems.push(...evidence.items);
    if (evidence.reportedCount !== null) reportedCount = evidence.reportedCount;
  }

  const uniqueItems = deduplicateItems(extractedItems.map((item) => normalizeItem(site, item)));
  return {
    site,
    name: SITE_NAMES[site] || site,
    search_urls: sourceUrls,
    http_results: httpResults,
    parser,
    status: httpResults.some((http) => http.ok) ? "ready" : "failed",
    reported_count: reportedCount,
    extracted_count: uniqueItems.length,
    warnings: uniqueStrings(extractionWarnings),
    errors: uniqueStrings(extractionErrors),
    items: uniqueItems.slice(0, modeContext.limit)
  };
}

async function collectBunjangApiEvidence(modeContext) {
  const categoryIds = getSourceCategoryIds("bunjang", modeContext.category);
  const urls = categoryIds.length > 0
    ? categoryIds.map((sourceCategoryId) => buildBunjangCategoryApiUrl(sourceCategoryId))
    : [buildBunjangSearchApiUrl(modeContext.keyword, modeContext.limit)];
  const httpResults = [];
  const items = [];
  let reportedCount = null;

  for (const url of urls) {
    const result = await requestHttp(url, { headers: sourceHeaders(url, true) });
    httpResults.push({
      ...result.http,
      role: "bunjang_public_api",
      result_count: countBunjangPayload(result.text)
    });
    items.push(...parseBunjangPayloadItems(result.text));
    const count = countBunjangPayload(result.text);
    if (count !== null) reportedCount = (reportedCount || 0) + count;
  }
  return { httpResults, reportedCount, items };
}

function buildOriginalUrls(site, modeContext) {
  const sourceCategoryIds = getSourceCategoryIds(site, modeContext.category);
  if (sourceCategoryIds.length > 0 && MAIN_API_SITES.has(site)) {
    return sourceCategoryIds.map((sourceCategoryId) => site === "bunjang"
      ? `https://m.bunjang.co.kr/categories/${encodeURIComponent(sourceCategoryId)}`
      : `https://web.joongna.com/search?category=${encodeURIComponent(sourceCategoryId)}`
    );
  }

  const encodedKeyword = encodeURIComponent(modeContext.keyword);
  if (site === "bunjang") return [`https://m.bunjang.co.kr/search/products?keyword=${encodedKeyword}&limit=${modeContext.limit}`];
  if (site === "joonggonara") return [`https://web.joongna.com/search/${encodedKeyword}`];
  if (site === "hellomarket") return [`https://www.hellomarket.com/search?q=${encodedKeyword}`];
  if (site === "rethinkmall") return [`https://web.rethinkmall.com/search?utm_source=bu&keyword=${encodedKeyword}`];
  return [];
}

function getSourceCategoryIds(site, category) {
  if (!category || !MAIN_API_SITES.has(site) || !modules.categoryCatalog?.getSourceCategoryBinding) return [];
  const binding = modules.categoryCatalog.getSourceCategoryBinding(site, category.id);
  if (!binding) return [];
  if (Array.isArray(binding.sourceCategoryIds) && binding.sourceCategoryIds.length > 0) return binding.sourceCategoryIds;
  return binding.sourceCategoryId ? [binding.sourceCategoryId] : [];
}

async function resolveCategorySelection() {
  const response = await getJson("/api/categories");
  const data = asRecord(response.payload?.data);
  const categories = Array.isArray(data.categories) ? data.categories : [];
  const found = categories.find((candidate) => asRecord(candidate).id === categoryId);
  if (found) {
    return {
      id: String(found.id),
      label: String(found.label || found.id),
      path: Array.isArray(found.path) ? found.path.map(String) : [],
      catalog_http: response.http
    };
  }
  return {
    id: categoryId,
    label: categoryId,
    path: [],
    catalog_http: response.http,
    warning: `category_id was not found in /api/categories: ${categoryId}`
  };
}

async function postJson(pathname, body) {
  return requestJson(`${apiBaseUrl}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body)
  });
}

async function getJson(pathname) {
  return requestJson(`${apiBaseUrl}${pathname}`, {
    method: "GET",
    headers: { accept: "application/json" }
  });
}

async function requestJson(url, options) {
  const result = await requestHttp(url, options);
  let payload = null;
  let error = null;
  if (result.text) {
    try {
      payload = JSON.parse(result.text);
    } catch (parseError) {
      error = `invalid_json: ${parseError instanceof Error ? parseError.message : String(parseError)}`;
    }
  }
  return { http: result.http, payload, error };
}

async function requestHttp(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      ...options,
      signal: controller.signal,
      headers: {
        "user-agent": "used-market-real-site-compare/1.0",
        ...options.headers
      }
    });
    const text = await response.text();
    return {
      text,
      http: {
        requested_url: url,
        response_url: response.url,
        status: response.status,
        ok: response.ok,
        content_type: response.headers.get("content-type") || "",
        content_length: response.headers.get("content-length") || null,
        bytes: Buffer.byteLength(text, "utf8"),
        sha256: createHash("sha256").update(text).digest("hex"),
        body_excerpt: compactWhitespace(text).slice(0, 240)
      }
    };
  } catch (error) {
    return {
      text: "",
      http: {
        requested_url: url,
        response_url: "",
        status: 0,
        ok: false,
        content_type: "",
        content_length: null,
        bytes: 0,
        sha256: null,
        body_excerpt: "",
        error: error instanceof Error ? error.message : String(error)
      }
    };
  } finally {
    clearTimeout(timer);
  }
}

function compareSite(original, ours, modeContext) {
  const integratedPerSiteLimit = modeContext.mode === "integrated"
    ? Math.ceil(modeContext.limit / Math.max(1, sites.length))
    : modeContext.limit;
  const sourceItems = (original?.items || []).slice(0, integratedPerSiteLimit);
  const ourItems = ours?.items || [];
  const sourceRelevant = sourceItems.filter((item) => isComparable(item, modeContext));
  const ourRelevant = ourItems.filter((item) => isComparable(item, modeContext));
  const sourceNonRelevant = sourceItems.filter((item) => !isComparable(item, modeContext));
  const ourNonRelevant = ourItems.filter((item) => !isComparable(item, modeContext));
  const sourceDuplicates = duplicateItems(sourceItems);
  const ourDuplicates = duplicateItems(ourItems);
  const matches = matchItems(sourceRelevant, ourRelevant);
  const missing = matches.filter((match) => !match.our).map((match) => match.source);
  const extra = matches.filter((match) => !match.source).map((match) => match.our);
  const mismatches = matches
    .filter((match) => match.source && match.our && !sameCoreFields(match.source, match.our))
    .map((match) => ({ source: compactItem(match.source), ours: compactItem(match.our) }));
  const diffCount = missing.length + extra.length + ourNonRelevant.length + mismatches.length;
  const failed = !original || !ours || original.status === "failed" || ours.status === "failed";

  return {
    site: original?.site || ours?.site,
    name: SITE_NAMES[original?.site || ours?.site] || original?.site || ours?.site,
    status: failed ? "failed" : diffCount > 0 ? "different" : "matched",
    original: original ? {
      search_urls: original.search_urls,
      http_results: original.http_results,
      parser: original.parser,
      status: original.status,
      reported_count: original.reported_count,
      extracted_count: original.extracted_count,
      relevant_count: sourceRelevant.length,
      non_relevant_count: sourceNonRelevant.length,
      warnings: original.warnings,
      errors: original.errors,
      items: sourceItems.map(compactItem)
    } : null,
    ours: ours ? {
      endpoint: ours.endpoint,
      request: ours.request,
      http: ours.http,
      status: ours.status,
      response_status: ours.response_status,
      response_error: ours.response_error,
      query: ours.query,
      category: ours.category,
      reported_count: ours.reported_count,
      extracted_count: ourItems.length,
      relevant_count: ourRelevant.length,
      non_relevant_count: ourNonRelevant.length,
      raw_response_summary: ours.raw_response_summary,
      items: ourItems.map(compactItem)
    } : null,
    comparison: {
      match_strategy: ["canonical_url", "title_and_price", "title"],
      source_count: sourceItems.length,
      source_relevant_count: sourceRelevant.length,
      ours_count: ourItems.length,
      ours_relevant_count: ourRelevant.length,
      omitted_from_our_results: missing.map(compactItem),
      extra_in_our_results: extra.map(compactItem),
      source_non_relevant_results: sourceNonRelevant.map(compactItem),
      ours_non_relevant_results: ourNonRelevant.map(compactItem),
      field_mismatches: mismatches,
      duplicate_urls: {
        original: sourceDuplicates,
        ours: ourDuplicates
      },
      difference_count: diffCount,
      category_filtering: modeContext.mode === "category"
        ? MAIN_API_SITES.has(original?.site || ours?.site) ? "api_category_id" : "harness_filter_on_category_metadata"
        : "not_applied"
    }
  };
}

function matchItems(sourceItems, ourItems) {
  const remaining = ourItems.slice();
  const matches = [];
  for (const source of sourceItems) {
    const index = remaining.findIndex((candidate) => sameItem(source, candidate));
    if (index < 0) {
      matches.push({ source, our: null });
    } else {
      matches.push({ source, our: remaining[index] });
      remaining.splice(index, 1);
    }
  }
  for (const our of remaining) matches.push({ source: null, our });
  return matches;
}

function sameItem(left, right) {
  const leftUrl = canonicalUrl(left.url);
  const rightUrl = canonicalUrl(right.url);
  if (leftUrl && rightUrl && leftUrl === rightUrl) return true;
  const leftTitle = normalizeText(left.title);
  const rightTitle = normalizeText(right.title);
  if (!leftTitle || !rightTitle || leftTitle !== rightTitle) return false;
  return left.price === right.price || left.price === null || right.price === null;
}

function sameCoreFields(left, right) {
  return normalizeText(left.title) === normalizeText(right.title)
    && (left.price === right.price || left.price === null || right.price === null);
}

function isComparable(item, modeContext) {
  const keywordMatch = keywordMatches(item, modeContext.keyword);
  if (!keywordMatch) return false;
  if (modeContext.mode !== "category" || !modeContext.category) return true;
  const categoryMatch = categoryMatches(item, modeContext.category);
  return categoryMatch !== false;
}

function keywordMatches(item, value) {
  const query = normalizeText(value);
  if (!query) return true;
  const text = normalizeText(`${item.title || ""} ${item.description || ""} ${item.notes || ""}`);
  const compactQuery = query.replace(/\s+/g, "");
  const compactText = text.replace(/\s+/g, "");
  if (compactText.includes(compactQuery)) return true;
  const aliases = {
    iphone: ["아이폰"],
    ipad: ["아이패드"],
    airpods: ["에어팟"],
    galaxy: ["갤럭시"],
    smartphone: ["스마트폰", "휴대폰", "핸드폰"],
    laptop: ["노트북"],
    computer: ["컴퓨터", "PC"]
  }[query] || [];
  if (aliases.some((alias) => compactText.includes(normalizeText(alias)))) return true;
  return query.split(" ").filter(Boolean).every((term) => compactText.includes(term));
}

function categoryMatches(item, category) {
  const categoryValue = item.category_id || item.canonical_category_id || "";
  if (categoryValue) return categoryValue === category.id;
  const path = Array.isArray(item.category_path)
    ? item.category_path.map(String)
    : Array.isArray(item.canonical_category_path)
      ? item.canonical_category_path.map(String)
      : [];
  if (path.length > 0) return path.includes(category.label) || category.path.some((segment) => path.includes(segment));
  return null;
}

function normalizeItem(site, item) {
  const record = asRecord(item);
  return {
    site,
    id: String(record.id || record.url || record.pid || ""),
    title: String(record.title || record.name || "").trim(),
    description: String(record.description || "").trim(),
    notes: String(record.notes || record.raw_text || "").trim(),
    price: firstNumber(record.price, record.sale_price, record.price_value, record.original_price),
    currency: String(record.currency || "KRW"),
    url: String(record.url || "").trim(),
    image_url: String(record.image_url || "").trim(),
    category_id: String(record.category_id || record.canonical_category_id || "").trim(),
    category_path: Array.isArray(record.category_path)
      ? record.category_path.map(String)
      : Array.isArray(record.canonical_category_path)
        ? record.canonical_category_path.map(String)
        : [],
    status: String(record.status || record.sale_status || "unknown")
  };
}

function compactItem(item) {
  return {
    site: item.site,
    id: item.id,
    title: item.title,
    price: item.price,
    currency: item.currency,
    url: item.url,
    canonical_url: canonicalUrl(item.url),
    category_id: item.category_id || null,
    category_path: item.category_path,
    status: item.status
  };
}

function deduplicateItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = canonicalUrl(item.url) || `${normalizeText(item.title)}|${item.price ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function duplicateItems(items) {
  const seen = new Set();
  const duplicates = [];
  for (const item of items) {
    const key = canonicalUrl(item.url);
    if (key && seen.has(key)) duplicates.push(key);
    if (key) seen.add(key);
  }
  return duplicates;
}

function summarizeSite(results) {
  return {
    checks: results.length,
    matched: results.filter((result) => result.status === "matched").length,
    different: results.filter((result) => result.status === "different").length,
    failures: results.filter((result) => result.status === "failed").length,
    differences: results.reduce((sum, result) => sum + (result.comparison?.difference_count || 0), 0),
    omitted: results.reduce((sum, result) => sum + (result.comparison?.omitted_from_our_results?.length || 0), 0),
    non_relevant: results.reduce((sum, result) => sum + (result.comparison?.ours_non_relevant_results?.length || 0), 0)
  };
}

function summarizeReport(iterations) {
  const results = iterations.flatMap((iteration) => iteration.modes).flatMap((mode) => mode.sites);
  return {
    checks: results.length,
    matched: results.filter((result) => result.status === "matched").length,
    different: results.filter((result) => result.status === "different").length,
    failures: results.filter((result) => result.status === "failed").length,
    differences: results.reduce((sum, result) => sum + (result.comparison?.difference_count || 0), 0),
    omitted: results.reduce((sum, result) => sum + (result.comparison?.omitted_from_our_results?.length || 0), 0),
    non_relevant: results.reduce((sum, result) => sum + (result.comparison?.ours_non_relevant_results?.length || 0), 0)
  };
}

function extractGenericHtmlItems(html, responseUrl, site) {
  const items = [];
  const anchorPattern = /<a\b([^>]*)href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchorPattern)) {
    const href = absoluteUrl(decodeEntities(match[2]), responseUrl);
    if (!/(\/product\/|\/products\/|\/item\/|\/goods\/)/i.test(href)) continue;
    const title = normalizeText(stripTags(match[3]));
    if (!title) continue;
    items.push({ title, price: firstNumber(title), url: href });
  }
  return deduplicateItems(items.map((item) => normalizeItem(site, item)));
}

function countBunjangPayload(text) {
  try {
    const payload = JSON.parse(text);
    if (Array.isArray(payload.list)) return payload.list.length;
    const data = asRecord(payload.data);
    const responses = asRecord(data.responses);
    const grid = asRecord(responses.mainGrid);
    const searchResponse = asRecord(grid.searchResponse);
    if (Array.isArray(searchResponse.data)) return searchResponse.data.length;
  } catch {
    return null;
  }
  return null;
}

function parseBunjangPayloadItems(text) {
  try {
    const payload = JSON.parse(text);
    const rows = Array.isArray(payload?.list)
      ? payload.list
      : Array.isArray(payload?.data?.responses?.mainGrid?.searchResponse?.data)
        ? payload.data.responses.mainGrid.searchResponse.data
        : [];
    return rows.map((row) => {
      const pid = String(row?.pid || row?.product_id || row?.id || "").trim();
      const title = String(row?.name || row?.product_name || row?.title || "").trim();
      if (!pid || !title) return null;
      return {
        site: "bunjang",
        id: `https://m.bunjang.co.kr/products/${pid}`,
        title,
        price: row?.price ?? row?.sale_price ?? null,
        url: `https://m.bunjang.co.kr/products/${pid}`,
        image_url: String(row?.product_image || row?.productImage || "").replace("{res}", "640"),
        status: row?.status || row?.sale_status || "unknown",
        posted_at: row?.updatedAt || row?.updated_at || ""
      };
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function buildBunjangSearchApiUrl(query, fetchLimit) {
  const url = new URL("https://api.bunjang.co.kr/api/1/find_v2.json");
  url.searchParams.set("q", query);
  url.searchParams.set("n", String(Math.min(Math.max(fetchLimit, 1), 100)));
  url.searchParams.set("page", "0");
  url.searchParams.set("order", "date");
  url.searchParams.set("stat_device", "w");
  url.searchParams.set("version", "4");
  return url.toString();
}

function buildBunjangCategoryApiUrl(sourceCategoryId) {
  const url = new URL("https://api.bunjang.co.kr/api/search/v8/web/search");
  url.searchParams.set("categoryId", sourceCategoryId);
  url.searchParams.set("policyKey", "pw.product.category");
  url.searchParams.set("size", "60");
  return url.toString();
}

function sourceHeaders(url, isApi = false) {
  const headers = {
    accept: isApi ? "application/json, text/plain, */*" : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7"
  };
  if (url.includes("bunjang")) headers.referer = "https://m.bunjang.co.kr/";
  return headers;
}

function canonicalUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";
    url.hostname = url.hostname.toLowerCase();
    if (url.hostname === "m.bunjang.co.kr" && /^\/products\/\d+$/.test(url.pathname)) {
      return `https://m.bunjang.co.kr${url.pathname}`;
    }
    return `${url.origin}${url.pathname}`.replace(/\/$/, "");
  } catch {
    return String(value).trim().replace(/[?#].*$/, "").replace(/\/$/, "");
  }
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/<[^>]*>/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function stripTags(value) {
  return String(value || "").replace(/<[^>]*>/g, " ");
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function absoluteUrl(value, baseUrl) {
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}

function firstNumber(...values) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const digits = value.replace(/[^\d]/g, "");
      if (digits) return Number(digits);
    }
  }
  return null;
}

function readNumber(value, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function addNullableCount(current, value) {
  return typeof value === "number" && Number.isFinite(value) ? (current || 0) + value : current;
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean).map(String))];
}

function parseSites(value) {
  if (!value) return [...TARGET_SITES];
  const requested = String(value).split(",").map((site) => site.trim()).filter(Boolean);
  const unsupported = requested.filter((site) => !TARGET_SITES.includes(site));
  if (unsupported.length > 0) throw new Error(`unsupported site(s): ${unsupported.join(", ")}`);
  if (requested.length === 0) throw new Error("sites must not be empty");
  return [...new Set(requested)];
}

function validateModes() {
  const supported = new Set(["integrated", "individual", "category"]);
  const unsupported = modes.filter((mode) => !supported.has(mode));
  if (unsupported.length > 0) throw new Error(`unsupported mode(s): ${unsupported.join(", ")}`);
}

function parseArgs(argv) {
  const parsed = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      parsed._.push(value);
      continue;
    }
    const key = value.slice(2);
    if (key === "fail-on-diff") {
      parsed[key] = true;
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      parsed[key] = next;
      index += 1;
    } else {
      parsed[key] = true;
    }
  }
  return parsed;
}

function clampInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function loadOptionalModules() {
  const [publicSearchExtractors, siteAdapters, helloMarketProbe, rethinkmallProbe, categoryCatalog] = await Promise.all([
    importOptional("dist/collector/logic/publicSearchExtractors.js"),
    importOptional("dist/collector/logic/sites/index.js"),
    importOptional("dist/collector/logic/helloMarketProbe.js"),
    importOptional("dist/collector/logic/rethinkmallProbe.js"),
    importOptional("dist/market/logic/category-catalog.js")
  ]);
  return { publicSearchExtractors, siteAdapters, helloMarketProbe, rethinkmallProbe, categoryCatalog };
}

async function importOptional(relativePath) {
  try {
    return await import(pathToFileURL(resolve(root, relativePath)).href);
  } catch {
    return null;
  }
}
