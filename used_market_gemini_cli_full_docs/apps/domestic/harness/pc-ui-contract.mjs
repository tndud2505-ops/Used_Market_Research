import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(path.join(appRoot, "web-backend/public/index.html"), "utf8");
const analysisHtml = readFileSync(path.join(appRoot, "web-backend/public/price-analysis.html"), "utf8");
const builderHtml = readFileSync(path.join(appRoot, "web-backend/public/computer-builder.html"), "utf8");
const script = readFileSync(path.join(appRoot, "web-backend/public/app.js"), "utf8");
const styles = readFileSync(path.join(appRoot, "web-backend/public/styles.css"), "utf8");
const requireText = (source, value, message) => assert.ok(source.includes(value), message);

requireText(html, '<a href="/index.html" aria-current="page">중고 시세</a>',
  "the listing page must remain directly reachable after analysis becomes home");
requireText(analysisHtml, '<a href="/" aria-current="page">가격 분석</a>',
  "price analysis must be the default home navigation target");
requireText(builderHtml, '<a href="/">가격 분석</a>',
  "the builder must link back to the default analysis home");

const categoryIndex = html.indexOf('id="category-select"');
const modelIndex = html.indexOf('id="model-select"');
const sourceIndex = html.indexOf('id="source-facet-row"');
const filterIndex = html.indexOf('id="model-filters"');
const listingIndex = html.indexOf('id="listing-section"');
assert.ok(categoryIndex >= 0 && modelIndex > categoryIndex && sourceIndex > modelIndex,
  "the browse toolbar must read as component → matching model → sites");
assert.ok(filterIndex > sourceIndex && listingIndex > filterIndex,
  "filters must precede the current listing results");

for (const id of [
  "category-select", "model-select", "source-facet-row", "source-filters", "source-filter-summary",
  "model-filters", "model-filter-body", "model-filter-toggle", "facet-rows", "filter-context", "active-filter-summary",
  "active-filter-chips", "reset-filters", "show-matched-models", "model-detail-dialog", "model-detail-close",
  "price-panel-title", "detail-message", "chart-source-filter", "chart-source-options", "price-summary", "price-chart-disclosure", "stats-section", "stats-groups",
  "active-latest", "active-mean", "active-count", "sold-latest", "sold-mean", "sold-count",
  "filter-column-resizer", "analysis-column-resizer", "listing-section", "listing-rows",
  "listing-options", "listing-options-toggle", "listing-pagination", "listing-page-numbers", "listing-page-prev", "listing-page-next",
  "model-detail-open", "price-summary-scope", "price-reset", "price-error", "listing-count", "adfit-banner",
]) {
  requireText(html, `id="${id}"`, `missing required UI region #${id}`);
  requireText(script, `querySelector("#${id}")`, `app.js must bind #${id}`);
}

assert.equal(html.includes('id="model-directory"'), false, "the old persistent model table must be removed");
assert.equal(html.includes('class="overview-panels"'), false, "the old two-panel model/price overview must be removed");
assert.equal(html.includes('class="price-panel"'), false, "price insight must not occupy the main results layout");
assert.equal(html.includes('id="model-pagination"'), false, "the removed model table must not retain pagination controls");
requireText(html, '<aside class="model-detail-dialog"', "model insight must use an in-page analysis panel");
assert.equal(html.includes('<dialog class="model-detail-dialog"'), false,
  "the insight panel must not retain modal semantics");
assert.equal(styles.includes(".model-detail-dialog::backdrop"), false,
  "the inline insight panel must not retain backdrop styling");
requireText(script, "dom.modelDetailDialog.hidden = false", "selecting a model must reveal the inline insight panel");
requireText(script, "dom.modelDetailDialog.hidden = true", "the inline insight panel must be closable");
requireText(script, 'document.addEventListener("keydown"', "the modeless panel must retain an Escape close action");
requireText(script, 'event.key === "Escape"', "Escape must close the insight panel accessibly");
requireText(script, 'dom.modelDetailOpen.focus({ preventScroll: true })', "closing analysis must restore focus to its reopen action");
requireText(script, 'dom.modelSelect.addEventListener("change"', "the compact model selector must drive exact-model selection");
requireText(script, 'createElement("option"', "matching models must populate native selector options");
requireText(script, "productSpecText(product)", "model choices must retain useful distinguishing specifications");
requireText(script, "availableFacets", "text search must replace whole-category facets with matching-model facets");
requireText(script, "payload?.available_facets", "the model response must drive the visible facet choices");

requireText(html, 'class="source-selector-label">사이트</span>', "site scope needs a short visible label");
requireText(script, 'input.type = "radio"', "site controls must use the same single-selection semantics as price analysis");
requireText(script, 'input.name = "listing-source"', "main listing site tabs must form one radio group");
requireText(script, '["ebay", "joonggonara", "bunjang", "hellomarket", "coolenjoy", "danawa"]',
  "eBay must stay visible before the individual domestic marketplaces");
requireText(script, 'source.id === "ebay" ? "eBay (USD)"', "the overseas tab must state its separate currency");
requireText(script, "state.selectedSites.add(source.id)", "a site tab must apply one exact source");
requireText(script, "state.selectedSites.clear()", "the all-sites choice must clear individual scope");
assert.equal(script.includes("sourceMoreOpen"), false, "site tabs must not hide eBay behind a more toggle");
requireText(script, "marketPools", "sources with multiple market pools must preserve every supported pool");
requireText(script, "source.currency === \"KRW\"", "default all-sites listing search must include every enabled domestic source");
requireText(script, 'source.id === "ebay"', "eBay must remain directly selectable outside the domestic default scope");
requireText(script, 'params.set("sites", sourceIds.join(","))', "default listing searches must pass an explicit fast site scope");
requireText(script, "availableSourceCounts", "site controls must follow actual whole-query listing coverage");
requireText(script, "payload?.source_counts", "listing source counts must reach the site selector");
requireText(script, "payload?.total", "listing result count must use the API total rather than the current page size");
requireText(script, 'source.id === "ebay" || source.currency === "KRW"',
  "switching market scope must not make the other site tabs disappear");

requireText(script, "openSingleSearchResult", "a unique text result must still open directly");
requireText(script, "showScopedListings", "category/facet search must return listings without choosing one model");
requireText(script, "return total > 0;",
  "every non-empty category, facet, or text scope must load current listings without a model-count gate");
assert.equal(script.includes("LISTING_AUTORUN_MODEL_LIMIT"), false,
  "broad listing searches must not stop at an arbitrary matching-model threshold");
requireText(script, 'url.search = ""', "model search must drop stale facet query params");
requireText(script, 'if (state.categoryCode) url.searchParams.set("category_code", state.categoryCode);',
  "text search must preserve the selected component category when one is active");
requireText(script, 'params.set("category_code", state.categoryCode)', "broad listing search must preserve the category");
requireText(script, "params.append(key, value)", "broad listing search must preserve repeated facets");
requireText(script, 'params.set("canonical_product_id", productId(state.selectedProduct))', "model selection must use an exact listing query");
requireText(script, 'params.set("limit", "10")', "listing pages must stay compact enough to expose numbered navigation");
requireText(script, "listing-model-action", "broad listing rows must offer direct model insight");
requireText(script, "state.listingRequest", "listing and stats requests need independent cancellation");
requireText(script, "function cancelListingRequest", "scope changes must cancel stale listing requests");

requireText(html, "등록 매물 평균과 판매완료 표시가", "the dialog must describe the two visible price concepts");
requireText(html, "실제 체결가와 다를 수 있습니다", "sold last-ask disclosure is required");
requireText(script, "sourceEvidenceRow", "site comparison must stay compact without another wide table");
const compactStats = script.slice(script.indexOf("function sourceEvidenceRow("), script.indexOf("function combineSourceMetric("));
requireText(compactStats, 'label: "판매완료"', "sold asking prices must stay visibly distinct from confirmed transactions");
assert.equal(compactStats.includes("confirmed_transactions"), false,
  "site evidence must show only listed and sold-complete price series");
requireText(script, "sourceRows(data)", "site price rows and charts must use actual per-source evidence");
requireText(script, "sourceRowsWithEvidence", "sites without price evidence must not render in analysis");
requireText(script, "sourceRowsWithCoherentSummary", "contradictory source averages must stay out of the visible comparison");
requireText(script, "metricHasCoherentSummary", "valid one- or two-listing site evidence must remain selectable without inventing an average");
requireText(script, "statsWithCoherentSources", "invalid source summaries must be removed before chart and summary aggregation");
requireText(script, "mean < minimum", "a source average below its minimum must be rejected");
requireText(script, "renderPriceChart", "the dialog must retain the daily chart renderer");
requireText(script, 'tabindex: -1', "chart points must use a roving keyboard focus target");
requireText(script, 'focusNode.setAttribute("tabindex", isActiveTab ? "0" : "-1")',
  "the selected chart date must remain keyboard reachable without creating dozens of tab stops");
requireText(script, "event.stopPropagation()", "chart-point arrow keys must move only one evidence date");
requireText(script, '"aria-label"', "chart points must expose exact values accessibly");
requireText(script, "statsHasEvidence", "empty price data must not produce fake price values");
requireText(script, "price-chart-scroll", "older dates need an intentional horizontal scroll region");
requireText(script, "selectDate", "the chart must expose one selected date with all available price series");
requireText(html, "30일 보기 · 최대 2년 기록", "the chart must explain its fixed window and maximum history");
assert.equal(html.includes("data-chart-days"), false, "the fixed thirty-day window must not retain obsolete range toggles");
const chartRenderer = script.slice(script.indexOf("function renderPriceChart("), script.indexOf("function renderChartSourceFilter("));
requireText(chartRenderer, 'key: "active"', "the chart needs the listed-price series");
requireText(chartRenderer, 'key: "sold"', "the chart needs the sold-complete series");
assert.equal(chartRenderer.includes('key: "confirmed_transactions"'), false,
  "confirmed transaction prices must not remain as a chart series");
assert.equal(chartRenderer.includes('key: "reserved"'), false,
  "reserved prices must not remain as a chart series");
for (const label of ["−1개월", "−1일", "+1일", "+1개월"]) requireText(script, label, `missing chart navigation ${label}`);
requireText(script, "PRICE_HISTORY_DAYS = 730", "chart history must be bounded to two years");
requireText(script, 'params.set("as_of", state.chartAnchorDate)', "historical chart windows must request an explicit end date");
requireText(script, "statsForChartSource", "chart site toggles must scope statistics independently from listing filters");
requireText(script, 'input.name = "chart-source"', "chart sites must use single-selection radio semantics");

for (const resizer of ["filter-column-resizer", "analysis-column-resizer"]) {
  requireText(html, `id="${resizer}"`, `missing ${resizer}`);
}
requireText(html, 'role="separator"', "column resize handles need separator semantics");
requireText(script, "setPointerCapture", "column resize handles must support pointer dragging");
requireText(script, 'event.key === "Home"', "column resize handles must support keyboard reset");
requireText(styles, "--filter-column-width", "the filter column width must be adjustable");
requireText(styles, "--analysis-column-width", "the analysis column width must be adjustable");

requireText(script, 'scope === "UNIT" ? "개당가격"', "RAM quantity/price-scope labels are required");
requireText(script, 'quantity > 1 ? "일괄가격"', "RAM lot pricing must stay separate from unit pricing");
requireText(script, "listingIsDisplayable", "listing rows must apply integrity eligibility");
requireText(script, 'listing?.price_eligible === false', "ineligible listings must not be comparable offers");
requireText(script, 'condition !== "USED_WORKING"', "broken or untested listings must be excluded");
requireText(script, '["AMBIGUOUS", "UNKNOWN"]', "ambiguous price scope must not look valid");
requireText(script, "listingIdentity", "same-site duplicate rows must collapse");
requireText(script, "listingFavoriteStorageKey", "listing interest must use stable browser-local storage keys");
requireText(script, "이 브라우저에 관심 저장", "browser-only interest must not imply account synchronization");
requireText(script, "listing-sale-state", "current listings must expose their sale state beside the price");
requireText(script, "listing-spec", "listing rows must retain concise model specifications");
requireText(script, "const postedAtRaw = firstDefined(listing.posted_at, listing.created_at)",
  "listing time must prefer the source posting time over a later observation time");
requireText(script, "listing.image_url", "listing thumbnails must use collected images");
requireText(script, '"이미지 없음"', "missing images need an honest empty state");

requireText(styles, ".model-selector", "the model selector needs a dedicated compact layout");
requireText(styles, ".source-choice", "site tabs need a readable inline layout");
requireText(styles, '.source-choice input:checked + span', "the selected site tab needs the same active underline treatment as analysis");
requireText(styles, "grid-column: 1 / -1", "site filters must wrap below model controls instead of clipping at zoomed widths");
requireText(styles, "body.has-selected-product .results-flow", "selected listings and analysis need a shared layout");
requireText(styles, ".model-detail-dialog:not([hidden])", "the inline analysis panel needs explicit visible-state styling");
requireText(styles, "position: sticky", "the desktop analysis panel must remain visible beside listings");
assert.match(styles, /@media \(max-width: 1180px\)[\s\S]*?\.model-detail-dialog:not\(\[hidden\]\)\s*\{[\s\S]*?position: static/u,
  "the analysis panel must return to document flow on narrower screens");
requireText(styles, ".model-facet-values", "catalog facet choices must keep their dedicated grid");
requireText(script, "mobileFacetMedia", "facet disclosures must follow responsive layout");
requireText(script, "setListingOptionsCollapsed", "mobile sort/price controls must remain collapsible");

assert.equal(html.includes('class="category-button"'), false, "all components must not return as a crowded tab rail");
assert.equal(html.includes('id="product-count"'), false, "duplicate model-count copy must stay removed");
requireText(html, 'id="contextual-offer"', "approved PC affiliate offers need one isolated slot");
assert.ok(html.indexOf('id="contextual-offer"') > html.indexOf('class="listing-heading"')
  && html.indexOf('id="contextual-offer"') < html.indexOf('id="listing-message"'),
  "the affiliate slot must stay compact at the top of loaded listing results");
requireText(script, "hasResults: visibleListings.length > 0", "ads must never replace empty search results");
requireText(script, "adfit.setEligible(visibleListings.length > 0)", "AdFit must follow the same organic-result visibility boundary");
assert.equal(/['"`]\/api\/search(?:-only)?(?:[?'"`])/u.test(script), false, "the public UI must not call generic used-market search APIs");
assert.equal(html.includes("�") || script.includes("�") || styles.includes("�"), false, "public UI files contain replacement characters");

// Run UI functions without network or browser dependencies; rendered flows are checked separately.
const declarations = [...script.matchAll(/^(?:async )?function \w+\([\s\S]*?^\}/gm)]
  .map((match) => match[0]).join("\n");
const context = vm.createContext({ Intl, URLSearchParams, AbortController, clearTimeout });
vm.runInContext(declarations, context);
assert.equal(context.readPriceRange("5,000", "100,000").min, "5000");
assert.equal(context.readPriceRange("50000", "10000").field, "max");
assert.equal(context.readPriceRange("0", "0").error, "");
assert.equal(context.readPriceRange("", "").error, "");
for (const invalid of ["-100", "1.5", "1e5", "가격없음", "999999999999999999999"]) {
  assert.notEqual(context.readPriceRange(invalid, "").error, "", "invalid prices must not silently become another amount");
}
assert.equal(context.metricValue({ mean: 150 }, ["mean"], "USD").currency, "USD",
  "a source metric without a nested currency must inherit its market currency");
assert.equal(context.metricValue({ mean: null }, ["mean"], "USD"), null,
  "missing transaction evidence must not become a zero-priced transaction");
const coherentStats = context.statsWithCoherentSources({
  active: { sample_count: 2, min: 100, max: 200, mean: 125 },
  by_source: [
    {
      source_id: "valid", active: { sample_count: 1, min: 100, max: 100, mean: 100 },
      daily: [{ date: "2026-09-08", active: { sample_count: 1, min: 100, max: 100, mean: 100 } }],
    },
    {
      source_id: "invalid", active: { sample_count: 1, min: 200, max: 200, mean: 50 },
      daily: [{ date: "2026-09-08", active: { sample_count: 1, min: 200, max: 200, mean: 50 } }],
    },
  ],
});
assert.equal(coherentStats.active.sample_count, 1,
  "invalid source summaries must not contribute samples to the visible average");
assert.equal(coherentStats.active.mean, 100,
  "invalid source summaries must not contribute prices to the visible average");
assert.equal(coherentStats.by_source.length, 1,
  "invalid sources must not remain in the visible source comparison");
assert.equal(coherentStats.integrity_filtered_source_ids[0], "invalid",
  "a removed source must remain identifiable as awaiting a statistics refresh");
assert.equal(context.metricHasCoherentSummary({ sample_count: 1, min: 50000, max: 50000, mean: null, median: null }), true,
  "one exact asking price is valid site evidence even when no aggregate average is published");
assert.equal(context.metricHasCoherentSummary({
  sample_count: 71, min: 9000, max: 200000, mean: null, average: 41777.47, median: null
}), true, "a valid published average must remain usable when the legacy mean field is null");
assert.equal(context.metricDisplayValue({ sample_count: 1, min: 50000, max: 50000, mean: null, median: null }, "KRW").amount, 50000,
  "one exact asking price must be displayed as evidence without being promoted to an aggregate mean");
const pendingStats = context.statsWithCoherentSources({
  by_source: [{ source_id: "invalid", active: { sample_count: 1, min: 200, max: 200, mean: 50 } }],
});
assert.equal(pendingStats.by_source.length, 0,
  "an entirely invalid source set must not leak into visible price statistics");
assert.equal(pendingStats.integrity_filtered_source_ids[0], "invalid",
  "an entirely invalid source set must remain visible as awaiting a refresh");
context.state = { chartSourceId: "invalid" };
assert.equal(context.statsForChartSource(pendingStats).selected_chart_source, "invalid",
  "selecting only a pending source must retain its honest refresh state");
assert.equal(context.shiftMonthKey("2024-03-31", -1), "2024-02-29",
  "month navigation must clamp to the leap-year month end");
assert.equal(context.shiftDateKey("2026-09-08", -1), "2026-09-07",
  "day navigation must move exactly one UTC calendar day");

const node = () => ({ hidden: false, value: "", textContent: "", attributes: {},
  setAttribute(key, value) { this.attributes[key] = value; },
  removeAttribute(key) { delete this.attributes[key]; },
  replaceChildren() {}, append() {}, focus() {},
});
context.state = {
  listings: [], listingPage: 1, listingCursor: "", listingPages: new Map(), listingPageCursors: new Map([[1, ""]]),
  listingNextCursors: new Map(), availableSourceCounts: null, listingTotal: null, detailStats: [],
};
context.dom = { listingCount: node() };
Object.assign(context, { renderSourceFilters() {}, renderListings() {}, renderStats() {} });
context.applyListingPayload({ items: [{ id: "page-item" }], total: 42, source_counts: { a: 20, b: 22 } }, 1);
assert.equal(context.state.listingTotal, 42,
  "the displayed listing total must come from the API rather than the current page length");
assert.equal(context.dom.listingCount.textContent, "42건");

context.state = { priceMin: "100", priceMax: "200", listingSort: "price_asc", listingOptionsCollapsed: true };
context.mobileFacetMedia = { matches: true };
context.dom = Object.fromEntries(["priceMin", "priceMax", "priceError", "priceReset", "listingSort", "listingOptions", "listingOptionsToggle"]
  .map((key) => [key, node()]));
context.dom.listingSortTabs = [];
context.resetListingControls();
assert.equal(context.state.priceMin, "");
assert.equal(context.state.priceMax, "");
assert.equal(context.state.listingSort, "recent");
assert.equal(context.dom.priceReset.hidden, true);
assert.equal(context.dom.listingOptionsToggle.textContent.includes("적용 중"), false);

let listingLoads = 0;
let statsRenders = 0;
Object.assign(context, {
  updateFacetSelectionUi() {}, renderSourceFilters() {}, updateStatsMessage() {},
  window: { requestAnimationFrame() {} },
  renderStats() { statsRenders += 1; },
  loadListings() { listingLoads += 1; },
  loadProductDetail() { assert.fail("listing controls must not restart price-stat requests"); },
});
context.state.selectedProduct = { id: "cpu:intel:i5-7400" };
context.reloadListingsForControls();
assert.equal(listingLoads, 1);
assert.equal(statsRenders, 0, "sorting must keep the current chart intact");
context.reloadListingsForControls("ebay");
assert.equal(listingLoads, 2);
assert.equal(statsRenders, 0, "listing source filters must not change the independently selected chart site");

const statsContext = vm.createContext({ Intl });
vm.runInContext(declarations, statsContext);
statsContext.COHORTS = [
  { marketPool: "KR_C2C_USED", currency: "KRW", label: "국내 개인 중고" },
  { marketPool: "OVERSEAS_USED", currency: "USD", label: "해외 중고" },
];
statsContext.state = { selectedProduct: {}, selectedSites: new Set(), detailStats: statsContext.COHORTS
  .map((cohort) => ({ cohort, data: { active: { sample_count: 2, mean: 100 }, confirmed_transactions: { sample_count: 0, mean: null } } })).reverse() };
statsContext.dom = Object.fromEntries(["statsGroups", "priceSummary", "priceSummaryScope", "statsSection", "priceChartDisclosure", "statsAsOf"]
  .map((key) => [key, node()]));
const summaryKeys = [];
Object.assign(statsContext, { clearSelectedPriceTable() {}, renderStatsGroup() {}, renderChartSourceFilter() {},
  renderPriceSummaryRow(key, block, data, currency) { summaryKeys.push([key, currency]); },
});
statsContext.renderStats();
assert.equal(statsContext.dom.priceSummaryScope.textContent, "국내 개인 중고 · KRW · 최근 30일",
  "out-of-order HTTP responses must not select the overseas summary first");
assert.deepEqual(summaryKeys, [["active", "KRW"], ["sold", "KRW"]]);

const requestContext = vm.createContext({ URLSearchParams, AbortController, clearTimeout });
vm.runInContext(declarations, requestContext);
const pending = [];
const applied = [];
Object.assign(requestContext, {
  state: { selectedProduct: {}, listingRequest: null }, browseListingTimer: null,
  dom: { listingSection: node(), listingEmpty: node() },
  buildListingQuery: () => new URLSearchParams({ canonical_product_id: "cpu:intel:i5-7400" }),
  fetchJson: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
  renderListings() {}, showListingMessage() {},
  applyListingPayload: (payload) => applied.push(payload.id),
});
const oldRequest = requestContext.requestListingPage(1);
assert.equal(requestContext.dom.listingEmpty.hidden, true, "loading must not show a no-listings claim");
const newRequest = requestContext.requestListingPage(1);
pending[1].resolve({ id: "new" });
await newRequest;
pending[0].resolve({ id: "old" });
await oldRequest;
assert.deepEqual(applied, ["new"], "late same-scope responses must not overwrite the latest page");
const failedRequest = requestContext.requestListingPage(1);
pending[2].reject(new Error("fixture failure"));
await failedRequest;
assert.equal(requestContext.dom.listingEmpty.hidden, true, "a request failure must not claim there are no listings");

console.log("PC UI contract passed");
