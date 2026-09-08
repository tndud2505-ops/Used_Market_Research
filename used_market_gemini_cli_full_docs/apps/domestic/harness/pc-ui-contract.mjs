import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(path.join(appRoot, "web-backend/public/index.html"), "utf8");
const script = readFileSync(path.join(appRoot, "web-backend/public/app.js"), "utf8");
const styles = readFileSync(path.join(appRoot, "web-backend/public/styles.css"), "utf8");
const requireText = (source, value, message) => assert.ok(source.includes(value), message);

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
  "category-select", "model-select", "source-facet-row", "source-filters", "source-filter-summary", "source-more-toggle",
  "model-filters", "model-filter-body", "model-filter-toggle", "facet-rows", "filter-context", "active-filter-summary",
  "active-filter-chips", "reset-filters", "show-matched-models", "model-detail-dialog", "model-detail-close",
  "price-panel-title", "detail-message", "price-summary", "price-chart-disclosure", "stats-section", "stats-groups",
  "active-latest", "active-mean", "active-change", "active-count", "reserved-latest", "reserved-mean",
  "reserved-change", "reserved-count", "sold-latest", "sold-mean", "sold-change", "sold-count",
  "confirmed-latest", "confirmed-mean", "confirmed-change", "confirmed-count", "listing-section", "listing-rows",
  "listing-options", "listing-options-toggle", "listing-pagination", "listing-page-numbers", "listing-page-prev", "listing-page-next",
  "model-detail-open", "price-summary-scope", "price-reset", "price-error",
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

requireText(html, 'class="source-selector-label">사이트</span>', "site scope needs a short visible label");
requireText(script, 'checkbox.type = "checkbox"', "site controls must use checkbox semantics");
requireText(script, '["joonggonara", "bunjang", "danawa"]', "primary Korean marketplaces must appear before extra sites");
requireText(script, "state.selectedSites.add(source.id)", "site filters must support combining sources");
requireText(script, "state.selectedSites.delete(source.id)", "site filters must support disabling one source");
requireText(script, "state.selectedSites.clear()", "the all-sites choice must clear individual scope");
requireText(script, "sourceMoreOpen", "additional sites must remain available behind a compact toggle");
requireText(script, "marketPools", "sources with multiple market pools must preserve every supported pool");
requireText(script, "DEFAULT_QUICK_SOURCE_IDS", "default all-sites listing search must avoid slow optional sources");
requireText(script, 'params.set("sites", sourceIds.join(","))', "default listing searches must pass an explicit fast site scope");

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

requireText(html, "현재 등록 매물의 평균과 확인된 거래가", "the dialog must describe the two honest price concepts");
requireText(html, "실제 체결가와 다를 수 있습니다", "sold last-ask disclosure is required");
requireText(script, '"현재 등록 평균", "확인 거래가"', "site comparison headings must match the rendered metrics");
const compactStats = script.slice(script.indexOf("function compactStatsRow("), script.indexOf("function combineSourceMetric("));
requireText(compactStats, "confirmed_transactions", "site transaction cells must use confirmed transaction evidence");
assert.equal(compactStats.includes("soldMean"), false, "sold asking prices must not be labeled as confirmed transactions");
requireText(script, "sourceRows(data)", "site price rows and charts must use actual per-source evidence");
requireText(script, "renderPriceChart", "the dialog must retain the daily chart renderer");
requireText(script, 'tabindex: 0', "chart points must be keyboard focusable");
requireText(script, '"aria-label"', "chart points must expose exact values accessibly");
requireText(script, "statsHasEvidence", "empty price data must not produce fake price values");

requireText(script, 'scope === "UNIT" ? "개당가격"', "RAM quantity/price-scope labels are required");
requireText(script, 'quantity > 1 ? "일괄가격"', "RAM lot pricing must stay separate from unit pricing");
requireText(script, "listingIsDisplayable", "listing rows must apply integrity eligibility");
requireText(script, 'listing?.price_eligible === false', "ineligible listings must not be comparable offers");
requireText(script, 'condition !== "USED_WORKING"', "broken or untested listings must be excluded");
requireText(script, '["AMBIGUOUS", "UNKNOWN"]', "ambiguous price scope must not look valid");
requireText(script, "listingIdentity", "same-site duplicate rows must collapse");
requireText(script, "listing.image_url", "listing thumbnails must use collected images");
requireText(script, '"이미지 없음"', "missing images need an honest empty state");

requireText(styles, ".model-selector", "the model selector needs a dedicated compact layout");
requireText(styles, ".source-choice", "site checkboxes need a readable inline layout");
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
assert.ok(html.indexOf('id="contextual-offer"') > html.indexOf('id="listing-pagination"'),
  "the affiliate slot must follow organic listings and pagination");
requireText(script, "hasResults: visibleListings.length > 0", "ads must never replace empty search results");
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

const node = () => ({ hidden: false, value: "", textContent: "", attributes: {},
  setAttribute(key, value) { this.attributes[key] = value; },
  removeAttribute(key) { delete this.attributes[key]; },
  replaceChildren() {}, append() {}, focus() {},
});
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
assert.equal(statsRenders, 1, "changing sources must re-scope the already received statistics");

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
Object.assign(statsContext, { clearSelectedPriceTable() {}, renderStatsGroup() {},
  renderPriceSummaryRow(key, block, data, currency) { summaryKeys.push([key, currency]); },
});
statsContext.renderStats();
assert.equal(statsContext.dom.priceSummaryScope.textContent, "국내 개인 중고 · KRW · 최근 30일",
  "out-of-order HTTP responses must not select the overseas summary first");
assert.deepEqual(summaryKeys, [["active", "KRW"], ["reserved", "KRW"], ["sold", "KRW"], ["confirmed", "KRW"]]);

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
