import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(path.join(appRoot, "web-backend/public/index.html"), "utf8");
const script = readFileSync(path.join(appRoot, "web-backend/public/app.js"), "utf8");
const styles = readFileSync(path.join(appRoot, "web-backend/public/styles.css"), "utf8");

const requireText = (source, value, message) => assert.ok(source.includes(value), message);

const filterIndex = html.indexOf('class="filter-rail"');
const listingsIndex = html.indexOf('id="listing-section"');
const pricePanelIndex = html.indexOf('class="price-panel"');
assert.ok(filterIndex >= 0 && listingsIndex > filterIndex && pricePanelIndex > listingsIndex,
  "desktop information architecture must be filter → listings → price intelligence");
assert.ok(html.indexOf('id="model-filters"') > html.indexOf('class="catalog-workspace"'),
  "model filters must live beside the model directory, not in the category rail");
assert.ok(html.indexOf('id="source-facet-row"') > listingsIndex
  && html.indexOf('id="source-facet-row"') < html.indexOf('id="listing-controls"'),
"site scope filters must remain visible beside the listing controls");

for (const id of [
  "category-rail", "facet-rows", "filter-context", "source-filters", "model-directory", "listing-section", "listing-rows",
  "model-filters", "model-filter-body", "model-filter-toggle", "filter-category-label", "active-filter-summary", "active-filter-chips", "show-matched-models",
  "price-panel-toggle", "price-panel-content", "listing-options", "listing-options-toggle",
  "price-summary", "active-mean", "active-median", "active-count", "sold-mean", "sold-median", "sold-count",
  "reserved-mean", "reserved-median", "reserved-count",
  "confirmed-mean", "confirmed-median", "confirmed-count",
  "stats-groups",
]) {
  requireText(html, `id="${id}"`, `missing required UI region #${id}`);
  requireText(script, `querySelector("#${id}")`, `app.js must bind #${id}`);
}

requireText(script, 'scope === "UNIT" ? "개당가격"', "RAM quantity/price-scope labels are required");
requireText(script, 'quantity > 1 ? "일괄가격"', "RAM lot pricing must stay separate from unit pricing");
requireText(html, "실제 체결가와 다를 수 있습니다", "sold last-ask disclosure is required");
requireText(script, "state.selectedSites.add(source.id)", "site filters must support selecting multiple sites");
requireText(script, "state.selectedSites.delete(source.id)", "site filters must support independently disabling a site");
requireText(script, "marketPools", "a source with multiple market pools must preserve every supported pool");
requireText(script, "listingCurrencyScope", "mixed-currency price controls must use an explicit comparable currency scope");
requireText(script, "state.sourceCandidates", "blocked or review-required PC sources must remain visibly explained");
requireText(script, '"허가 필요"', "terms-blocked sources must show an honest permission-required state");
requireText(script, '"파트너 승인 필요"', "contract-feed sources must show their distinct activation state");
requireText(script, "source.activationUrl", "a contract-feed candidate must link to its official application path");
requireText(styles, ".source-unavailable", "unavailable source status needs a restrained inline style");
requireText(script, "loadProductDetail()", "site changes must refresh listings and stats together");
requireText(script, "/api/catalog/models?", "model loading must use the public catalog models endpoint");
requireText(script, "setPricePanelOpen", "price intelligence must be reachable from the expandable panel control");
requireText(script, "statsForSelectedSites", "price summaries and charts must use the selected site scope");
requireText(script, 'key: "confirmed_transactions"', "charts must expose confirmed transaction prices separately");
requireText(script, 'key: "reserved"', "charts must expose reserved prices separately");
requireText(script, "dailyAveragePoint", "30-day price charts must plot average values rather than only median summaries");
requireText(script, "function dailyWindow", "30-day charts must preserve empty dates instead of compressing the date axis");
requireText(script, "dailyWindow(data, 30)", "price charts must render an exact 30-day window");
requireText(html, "confirmed-summary", "the UI must distinguish confirmed transaction prices from sold last-ask prices");
requireText(html, "reserved-summary", "the UI must distinguish reserved prices from sold last-ask prices");
requireText(html, "예약중은 제외", "reserved observations must not be presented as confirmed transaction prices");
requireText(styles, ".chart-line.confirmed-series", "confirmed transaction chart series needs a distinct visual encoding");
requireText(script, "FALLBACK_BROWSE_FLOWS", "browse filters must be category-specific");
requireText(script, 'key: "family", label: "제품군"', "CPU and GPU filters must expose real product families");
requireText(script, 'key: "generation", label: "DDR 세대"', "RAM filters must expose the DDR generation");
requireText(script, 'key: "module_capacity_gb", label: "모듈 용량"', "RAM filters must expose module capacity");
requireText(script, "makeFacetCheckboxRow", "category filters must render as multi-select checkbox rows");
requireText(script, 'checkbox.type = "checkbox"', "facet options must use semantic checkboxes");
requireText(script, "buildFacetUniverse", "facet option positions need a category-wide stable baseline");
requireText(script, "const fixedOptions = toArray(state.facetUniverse", "visible facet options must come only from the fixed category-wide baseline");
assert.equal(script.includes("stableFacetOptions"), false,
  "filtered response counts must not mutate the visible facet matrix");
assert.equal(script.includes("checkbox.disabled ="), false,
  "a result with zero matches must not disable a fixed facet option");
requireText(script, 'rowKey: "generation-intel"', "CPU filters must keep an independent fixed Intel generation row");
requireText(script, 'rowKey: "generation-amd"', "CPU filters must keep an independent fixed AMD generation row");
requireText(script, "renderActiveFilterSummary", "selected filters must remain removable outside the fixed option grid");
requireText(html, '<span class="active-filter-label">현재 조건</span>', "the filter summary row must reserve stable space before and after selection");
assert.equal(html.includes('id="active-filter-summary" hidden'), false,
  "the current-condition row must not appear late and shift the result list");
requireText(script, '"active-filter-empty", "전체"', "an unfiltered category must show an explicit stable current-condition state");
requireText(script, "updateFacetSelectionUi", "facet selection must update in place without rebuilding the option matrix");
const updateFacetBlock = script.slice(script.indexOf("function updateFacet("), script.indexOf("function selectCategory("));
assert.equal(updateFacetBlock.includes("renderFacets()"), false,
  "checking a facet must not rebuild the filter matrix");
const loadProductsBlock = script.slice(script.indexOf("async function loadProducts("), script.indexOf("function resetDetail("));
assert.equal(loadProductsBlock.includes("renderFacets()"), false,
  "model responses must not rebuild or recalculate the visible filter matrix");
requireText(script, "params.append(key, value)", "facet URL requests must preserve repeated values");
requireText(script, "syncCatalogUrl", "facet selections must persist in the shareable URL");
requireText(script, "mobileFacetMedia", "facet disclosure semantics must follow the responsive layout");
requireText(script, "setListingOptionsCollapsed", "mobile results must keep source and price controls in an accessible disclosure");
requireText(styles, ".model-facet-values", "the model filter matrix needs a dedicated option grid");
requireText(styles, "grid-template-columns: repeat(5, minmax(0, 1fr))", "desktop filter rows must use five aligned option slots");
requireText(styles, ".active-filter-chip-remove", "selected facet chips need a visible removal control");
assert.match(styles, /@media \(max-width: 640px\)[\s\S]*?\.model-facet-values\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\);/u,
  "mobile facet options must use a stable single-column flow");
assert.match(styles, /@media \(max-width: 640px\)[\s\S]*?\.model-table\s*\{[\s\S]*?min-width:\s*0;/u,
  "the mobile model directory must not keep the desktop 700px minimum width");
requireText(script, "state.categories.forEach", "categories must render as a direct shopping-style list");
requireText(script, "category-button", "categories must expose selectable shopping-style controls");
requireText(script, "openSingleSearchResult", "a unique model search result must open its listings and price insight directly");
requireText(script, "state.productTotal !== 1", "a single filtered model may open its price insight directly");
requireText(script, "showScopedListings", "category and facet results must expose listings before a model is selected");
requireText(script, "listing-model-action", "broad listing rows must provide a direct path to the model price insight");
const refreshBrowseBlock = script.slice(script.indexOf("function refreshBrowseScope("), script.indexOf("function setPricePanelOpen("));
assert.ok(refreshBrowseBlock.indexOf("loadProducts(false)") >= 0
  && refreshBrowseBlock.indexOf("showScopedListings") > refreshBrowseBlock.indexOf("loadProducts(false)"),
"model and listing requests must start together instead of hiding listings behind the model response");
requireText(script, "state.listingRequest", "broad listing requests must not share the price-stat request controller");
requireText(script, "function cancelListingRequest", "scope changes must cancel delayed or in-flight broad listing requests");
const selectProductBlock = script.slice(script.indexOf("function selectProduct("), script.indexOf("function buildListingQuery("));
requireText(selectProductBlock, "cancelListingRequest()", "single-model selection must cancel the pending broad listing timer");
const listingQueryBlock = script.slice(script.indexOf("function buildListingQuery("), script.indexOf("function buildStatsUrl("));
requireText(listingQueryBlock, 'params.set("category_code", state.categoryCode)', "multi-model listing browse must preserve the selected category");
requireText(listingQueryBlock, "params.append(key, value)", "multi-model listing browse must preserve repeated facet values");
requireText(listingQueryBlock, 'params.set("canonical_product_id", productId(state.selectedProduct))', "a selected model must retain the exact listing query");
requireText(script, 'if (!state.selectedProduct && canonicalModel)', "combined listing rows must identify their canonical model");
requireText(styles, ".listing-section { order: 4; }", "current listings must appear before the optional model directory");
requireText(styles, ".model-directory { order: 5; }", "matching models must remain available as an optional narrowing step");
assert.match(styles, /@media \(min-width: 1121px\)[\s\S]*?grid-template-areas:\s*"\. heading"\s*"filters message"\s*"filters listings"\s*"filters directory";/u,
  "desktop results must place current listings before optional model narrowing");
assert.match(styles, /@media \(max-width: 1120px\) and \(min-width: 641px\)[\s\S]*?\.model-directory\s*\{\s*order:\s*5;[\s\S]*?\.listing-section\s*\{\s*order:\s*4;/u,
  "tablet and zoomed layouts must not move current listings below the model table");
assert.ok(html.indexOf('id="listing-section"') < html.indexOf('id="model-directory"'),
  "DOM reading order must place immediate listing results before optional model narrowing");
assert.match(styles, /@media \(max-width: 1120px\)[\s\S]*?body\.has-selected-product \.model-directory\s*\{[\s\S]*?display:\s*none;/u,
  "mobile and tablet selection must place the price panel directly after the selected model listings");
assert.equal(script.includes("dom.modelDirectory.hidden = true"), false,
  "the filtered model context must remain visible after selecting one model");
requireText(script, "stackedLayoutMedia", "price insight must adapt at the stacked layout boundary");
requireText(script, "productTotal", "model count must use the directory total, not only the current page size");
requireText(script, "nestedProducts?.total", "model count must read the API directory total when available");
assert.equal(html.includes("제품 유형"), false, "DESKTOP must stay hidden as an internal default");
assert.equal(html.includes("contextual-offer"), false, "the public model and listing flow must not include ads");
assert.equal(script.includes("/api/monetization/"), false, "the public UI must not request monetization APIs");
assert.equal(/['"`]\/api\/search(?:-only)?(?:[?'"`])/u.test(script), false, "the public UI must not call generic used-market search APIs");
assert.equal(script.includes("원화와 해외 통화를 함께 가격순으로 비교할 수 없습니다"), false,
  "price controls must submit a comparable currency scope instead of refusing the request");

requireText(script, "listing.image_url", "listing thumbnails must use collected source images");
requireText(script, '"이미지 없음"', "missing source images must have an honest empty state");
requireText(script, '"매물 보기"', "active listings must expose a shopping action");
requireText(script, "listing?.price_value", "listing prices must read the D1 listings API price field");
requireText(script, "listingIsDisplayable", "listing rows must apply data-integrity eligibility before rendering");
requireText(script, 'listing?.price_eligible === false', "ineligible listings must not be rendered as comparable shopping rows");
requireText(script, 'condition !== "USED_WORKING"', "broken, mined, or untested listings must not appear as purchasable shopping rows");
requireText(script, '["AMBIGUOUS", "UNKNOWN"]', "ambiguous price scope must not be rendered as a valid offer");
requireText(script, "listingIdentity", "same-site duplicate rows must be collapsed in the public view");

requireText(script, "renderPriceChart", "30-day chart renderer is required");
requireText(script, 'tabindex: 0', "daily chart points must be keyboard focusable");
requireText(script, '"aria-label"', "daily chart points must expose exact values accessibly");
requireText(styles, ".listing-media img", "shopping thumbnail layout is required");
requireText(styles, ".price-summary", "current/sold price summary layout is required");
requireText(styles, "grid-template-columns: var(--rail-width)", "desktop column layout is required");

assert.equal(html.includes("�"), false, "index.html contains replacement characters");
assert.equal(script.includes("�"), false, "app.js contains replacement characters");
assert.equal(styles.includes("�"), false, "styles.css contains replacement characters");

console.log("PC UI contract passed");
