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
assert.ok(html.indexOf('id="source-facet-row"') > html.indexOf('id="price-panel-content"'),
  "site scope filters must live inside the expandable price panel beside the charts");

for (const id of [
  "category-rail", "facet-rows", "filter-context", "source-filters", "model-directory", "listing-section", "listing-rows",
  "model-filters",
  "price-panel-toggle", "price-panel-content",
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
requireText(script, "DEFAULT_BROWSE_FLOWS", "browse filters must be category-specific");
requireText(script, 'label: "CPU 시리즈"', "CPU filters must stop at the series level");
requireText(script, 'label: "GPU 시리즈"', "GPU filters must stop at the series level");
requireText(script, 'key: "memory_generation", label: "DDR 세대"', "RAM filters must expose the DDR generation");
requireText(script, 'key: "module_capacity_gb", label: "용량(GB)"', "RAM filters must expose module capacity");
requireText(script, "makeFacetSelect", "category filters must render as compact selection controls");
requireText(script, "state.categories.forEach", "categories must render as a direct shopping-style list");
requireText(script, "category-button", "categories must expose selectable shopping-style controls");
requireText(script, "if (!append) resetDetail()", "loading another product page must not auto-select a model");
requireText(script, "productTotal", "model count must use the directory total, not only the current page size");
requireText(script, "nestedProducts?.total", "model count must read the API directory total when available");
assert.equal(html.includes("제품 유형"), false, "DESKTOP must stay hidden as an internal default");

requireText(script, "listing.image_url", "listing thumbnails must use collected source images");
requireText(script, '"이미지 없음"', "missing source images must have an honest empty state");
requireText(script, '"매물 보기"', "active listings must expose a shopping action");
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
