import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import { coherentStats, metricValue as representative, metricPresentation, shiftDate } from '../web-backend/public/pc-tools-core.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(path.join(appRoot, "web-backend/public/index.html"), "utf8");
const analysisHtml = readFileSync(path.join(appRoot, "web-backend/public/price-analysis.html"), "utf8");
const builderHtml = readFileSync(path.join(appRoot, "web-backend/public/computer-builder.html"), "utf8");
const guideHtml = readFileSync(path.join(appRoot, "web-backend/public/guide.html"), "utf8");
const script = readFileSync(path.join(appRoot, "web-backend/public/app.js"), "utf8");
const styles = readFileSync(path.join(appRoot, "web-backend/public/styles.css"), "utf8");
const toolsScript = readFileSync(path.join(appRoot, "web-backend/public/pc-tools.js"), "utf8");
const toolsChart = readFileSync(path.join(appRoot, "web-backend/public/pc-tools-chart.mjs"), "utf8");
const toolsStyles = readFileSync(path.join(appRoot, "web-backend/public/pc-tools.css"), "utf8");
const requireText = (source, value, message) => assert.ok(source.includes(value), message);
requireText(toolsScript, 'buildTotals(state.entries', 'builder summary must derive totals from the shared price state');
requireText(toolsScript, '판매중 합계', 'builder must visibly label the active-price partial total');
requireText(toolsScript, '판매완료 합계', 'builder must visibly label the sold-price partial total');
assert.equal(toolsScript.includes('가격 확인 ${total.covered}'), false, 'builder omits repetitive coverage copy');
requireText(toolsScript, 'buildScopeConflict()', 'builder totals must reject mixed publication scopes');
requireText(toolsScript, 'compactBuild(state.entries', 'builder writes must persist compact validated entries');
requireText(toolsScript, 'localStorage.setItem(STORAGE_KEY, raw)', 'builder selection changes must write local storage');
requireText(toolsScript, "history.replaceState(null, '', url)", 'builder selection changes must update the share hash without reloading');

requireText(html, '<a href="/" aria-current="page">중고 시세</a>',
  "the listing page must be the default home navigation target");
requireText(analysisHtml, '<a href="/price-analysis.html" aria-current="page">가격 분석</a>',
  "price analysis must retain its own explicit navigation target");
requireText(builderHtml, '<a href="/price-analysis.html">가격 분석</a>',
  "the builder must link to the explicit price-analysis page");
requireText(analysisHtml, 'href="https://used-pick.com/price-analysis.html"',
  "price analysis must publish its explicit canonical URL");
requireText(html, 'href="https://used-pick.com/"', "the listing home must publish the root canonical URL");

assert.ok(analysisHtml.indexOf('id="analysis-categories"') < analysisHtml.indexOf('id="model-controls"'),
  "analysis component tabs must lead directly into the model filters");
assert.equal(analysisHtml.includes('id="tools-summary"'), false,
  "price analysis uses one source table, not duplicate summary cards");
requireText(analysisHtml, 'id="analysis-title"', 'analysis needs its compact selected-model heading');
requireText(analysisHtml, 'id="analysis-workspace"', 'analysis chart and source table must share one workspace');
requireText(analysisHtml, 'data-action="analysis-pane" data-pane="chart"', 'chart pane must be collapsible');
requireText(analysisHtml, 'data-action="analysis-pane" data-pane="table"', 'source table pane must be collapsible');
requireText(analysisHtml, 'class="sf-source-table-scroll" tabindex="0"', 'source table must scroll inside its own keyboard-focusable region');
assert.equal(analysisHtml.includes('id="chart-scale-'), false, 'zoom belongs to the date and price axes, not separate sliders');
assert.equal(analysisHtml.includes('tools-source-label'), false,
  "analysis source tabs stand alone without a redundant site label");
assert.equal(analysisHtml.includes('id="overview-button"'), false, "overall trend must be removed");
assert.equal(analysisHtml.includes('id="chart-mode"'), false, "price analysis must remain in amount mode");
requireText(toolsScript, "const sourceOrder = ['ebay', 'joonggonara', 'bunjang']",
  "analysis sites must keep the requested visible order after the domestic total");
requireText(toolsScript, "const visibleSeries = builder ? SERIES.filter(s => s.key !== 'confirmed_transactions') : [];",
  "analysis model rows must keep only the model and view columns");
requireText(toolsScript, "const link = el('a', 'model-name-link', nameOf(product));",
  "the visible model name must be the direct original-search link");
assert.equal(toolsScript.includes("state.expanded"), false, "flat model rows must not retain expansion state");
assert.equal(toolsScript.includes("동일 모델 묶기"), false, "flat model rows must not expose a grouping toggle");
requireText(toolsScript, "makeTable(['부품', '선택 모델', '수량', '판매중 가격', '판매완료 평균', '변경'])",
  'the search-first builder has one six-column integrated table');
assert.match(builderHtml, /<header class="sf-page-bar sf-builder-bar">[\s\S]*?id="contextual-offer"[\s\S]*?<\/header>/,
  'the contextual ad stays with the builder actions');
assert.equal(toolsScript.includes("el('tfoot')"), true, 'totals share the component table footer');
assert.equal(toolsScript.includes("'원문 검색'"), false,
  "the model name link must not repeat a separate original-search label");
requireText(toolsScript, "[['', '전체']", "analysis must offer all sources with currencies kept separate");
requireText(toolsScript, "state.range.to === state.range.latest ? '' : state.range.to",
  "today must use the latest price publication without an explicit as_of contract");
const requestedPriceAsOfSource = toolsScript.match(/function requestedPriceAsOf\(\) \{[^}]+\}/u)?.[0];
assert.ok(requestedPriceAsOfSource, 'price as_of selection must remain directly testable');
const evaluatePriceAsOf = ({ builder, to, latest }) => {
  const context = vm.createContext({ builder, state: { range: { to, latest } } });
  vm.runInContext(requestedPriceAsOfSource, context);
  return vm.runInContext('requestedPriceAsOf()', context);
};
assert.equal(evaluatePriceAsOf({ builder: false, to: '2026-09-21', latest: '2026-09-21' }), '');
assert.equal(evaluatePriceAsOf({ builder: false, to: '2026-09-20', latest: '2026-09-21' }), '2026-09-20');
assert.equal(evaluatePriceAsOf({ builder: true, to: '2026-09-20', latest: '2026-09-21' }), '');
requireText(toolsScript, "const pageCatalog = builder ? catalog.tools_catalog : catalog.public_catalog",
  "price analysis must use the public catalog while the builder uses the tools catalog");
requireText(toolsScript, "state.sources = (catalog.sources || [])",
  "analysis source tabs must follow the operational catalog instead of per-model evidence");
requireText(toolsScript, "sources.flatMap(item => buildAnalysisSeries",
  "the chart must build each source from its own published currency scope");
requireText(toolsScript, ".filter(id => allowedSources.has(id))",
  "the source table must not revive a disabled source from stale projection rows");
requireText(toolsChart, "item.label || metric?.label",
  "site-specific chart descriptors must provide stable legend and tooltip labels");
requireText(toolsChart, "filter(item => item.points.some(point => point.value != null))",
  "empty sold series must not leave a misleading legend entry");
requireText(guideHtml, '현재 운영 중인 중고나라·번개장터·eBay',
  'the guide must describe the current three-source operating set');
assert.doesNotMatch(guideHtml, /다나와 장터|헬로마켓|리씽크몰|쿨엔조이/u,
  'the guide must not advertise retired sources as currently collected');
assert.equal(toolsScript.includes('state.overview'), false, "removed overall-trend state must not remain reachable");
assert.equal(toolsScript.includes("target.id === 'chart-mode'"), false, "removed index-mode control must not retain an event path");
requireText(toolsChart, "empty.textContent = '가격 자료 없음'", "a source without evidence needs an honest empty state");
requireText(toolsStyles, 'width:min(1536px,100%)', "tool pages must share the listing page container width");

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
  "active-filter-chips", "reset-filters", "show-matched-models",
  "filter-column-resizer", "listing-section", "listing-rows",
  "listing-pagination", "listing-page-numbers", "listing-page-prev", "listing-page-next",
  "model-detail-open", "listing-count", "adfit-banner",
]) {
  requireText(html, `id="${id}"`, `missing required UI region #${id}`);
  requireText(script, `querySelector("#${id}")`, `app.js must bind #${id}`);
}

assert.equal(html.includes('id="model-directory"'), false, "the old persistent model table must be removed");
assert.equal(html.includes('class="overview-panels"'), false, "the old two-panel model/price overview must be removed");
assert.equal(html.includes('class="price-panel"'), false, "price insight must not occupy the main results layout");
assert.equal(html.includes('id="model-pagination"'), false, "the removed model table must not retain pagination controls");
for (const removed of ['model-detail-dialog','price-summary','stats-section','analysis-column-resizer','up-market-chart',
  'catalog-query','up-catalog-search','price-min','price-max','price-reset','price-error','listing-options-toggle']) {
  assert.equal(html.includes(`id="${removed}"`), false, `${removed} must not remain in search`);
}
assert.doesNotMatch(script, /\/price-stats|has-model-insight|function openModelDetail/);
assert.match(html, /<button class="model-detail-open"[^>]*aria-haspopup="dialog"[^>]*aria-controls="listing-price-dialog"/);
assert.equal([...html.matchAll(/>가격 그래프 보기</g)].length, 1, 'one graph action in the result toolbar');
assert.match(html, /<dialog id="listing-price-dialog"/);
assert.doesNotMatch(script, /modelDetailOpen\.href|window\.open\(/);
requireText(script, 'pricePreview.open(product, [...state.selectedSites][0] || "")', 'graph preview keeps the selected model and source without navigation');
requireText(script, 'dom.modelSelect.addEventListener("change"', "the compact model selector must drive exact-model selection");
requireText(script, 'createElement("option"', "matching models must populate native selector options");
requireText(script, "productSpecText(product)", "model choices must retain useful distinguishing specifications");
requireText(script, "availableFacets", "text search must replace whole-category facets with matching-model facets");
requireText(script, "payload?.available_facets", "the model response must drive the visible facet choices");

requireText(html, 'class="source-selector-label">거래 사이트</span>', "site scope needs a short visible label");
requireText(script, 'input.type = "radio"', "site controls must use the same single-selection semantics as price analysis");
requireText(script, 'input.name = "listing-source"', "main listing site tabs must form one radio group");
requireText(script, '["joonggonara", "bunjang", "ebay"]',
  "source toggles must follow domestic total, Joonggonara, Bunjang, eBay order");
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

requireText(script, "openSingleSearchResult", "a unique model scopes listings without opening price analysis");
requireText(script, "state.productTotal !== 1", "one loaded model must not be confused with a total of one");
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
requireText(script, 'params.set("limit", "100")', "one bounded request preloads ten compact listing pages");
requireText(script, "listing-model-action", "broad listing rows must offer direct model insight");
requireText(script, "state.listingRequest", "listing and stats requests need independent cancellation");
requireText(script, "function cancelListingRequest", "scope changes must cancel stale listing requests");

// Search preview and standalone analysis share the same price calculation rules.
requireText(toolsScript, '판매완료 표시가는 실제 체결가가 아닙니다.', 'sold display price remains distinguished');
requireText(toolsScript, "makeTable(['출처','통화','기간'", 'source table includes actual currency and window');
requireText(toolsScript, 'scopedStats(sourceStats(record.data, id)', 'source rows do not repeat aggregate prices');
requireText(toolsScript, 'metric.sample_count >= 0', 'sample counts must be valid before display');
requireText(toolsChart, "svg.setAttribute('tabindex', '0')", 'one accessible chart focus target');
requireText(toolsChart, "['ArrowLeft', 'ArrowRight', 'Enter', ' ']", 'chart remains keyboard operable');
requireText(toolsChart, "if (point.value == null) { drawing = false; return; }", 'missing observations remain gaps');
assert.doesNotMatch(analysisHtml, /up-analysis-aside|이 가격의 비교 기준|매물 조건도 확인하세요|가격 데이터 이용 안내/);

for (const resizer of ["filter-column-resizer"]) {
  requireText(html, `id="${resizer}"`, `missing ${resizer}`);
}
requireText(html, 'role="separator"', "column resize handles need separator semantics");
requireText(script, "setPointerCapture", "column resize handles must support pointer dragging");
requireText(script, 'event.key === "Home"', "column resize handles must support keyboard reset");
requireText(styles, "--filter-column-width", "the filter column width must be adjustable");

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
requireText(script, 'dom.listingSection.hidden = false', 'selected-model listings stay in the results region');
requireText(styles, ".model-facet-values", "catalog facet choices must keep their dedicated grid");
requireText(script, "mobileFacetMedia", "facet disclosures must follow responsive layout");
assert.doesNotMatch(script, /setListingOptionsCollapsed|dom\.price(?:Min|Max|Reset|Error)/,
  "sorting stays visible and removed price inputs cannot retain event paths");

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
assert.equal(context.metricValue({ mean: 150 }, ["mean"], "USD").currency, "USD",
  "a source metric without a nested currency must inherit its market currency");
assert.equal(context.metricValue({ mean: null }, ["mean"], "USD"), null,
  "missing transaction evidence must not become a zero-priced transaction");
const validStats = coherentStats({
  by_source: [
    { source_id: 'valid', active: { sample_count: 5, min: 100, max: 100, mean: 100 } },
    { source_id: 'invalid', active: { sample_count: 5, min: 200, max: 200, mean: 50 } },
  ],
});
assert.equal(validStats.active.sample_count, 5, 'invalid sources cannot contribute samples');
assert.equal(validStats.active.mean, 100, 'invalid sources cannot contribute prices');
assert.equal(validStats.by_source.length, 1);
assert.equal(validStats.integrity_filtered_source_count, 1);
const singleEvidence = { sample_count: 1, min: 50000, max: 50000, mean: null, median: null };
assert.equal(representative(singleEvidence), null, 'one observed price cannot become an aggregate');
assert.match(metricPresentation(singleEvidence).text, /50,000원/);
assert.equal(metricPresentation(singleEvidence).state, 'insufficient');
assert.equal(representative({sample_count:71,min:9000,max:200000,mean:null,average:41777.47,median:null}),41777.47);
const pendingStats = coherentStats({ by_source: [{ source_id:'invalid', active:{ sample_count:5,min:200,max:200,mean:50 } }] });
assert.equal(pendingStats.by_source.length,0);
assert.equal(pendingStats.integrity_filtered_source_count,1);
assert.equal(shiftDate('2024-03-31',-1,'month'),'2024-02-29');
assert.equal(shiftDate('2026-09-08',-1),'2026-09-07');

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
context.applyListingPayload({ items: Array.from({length:100}, (_,id)=>({id})), total:115, next_cursor:'next-batch' }, 1);
assert.equal(context.state.listingPages.size,10);
assert.equal(context.state.listings.length,10);
assert.equal(context.state.listingPages.get(10)[9].id,99);
assert.equal(context.state.listingPageCursors.get(11),'next-batch');
assert.deepEqual([...context.listingPaginationWindow(11,1)], [1,2,3,4,5,6,7,8,9,10]);
context.applyListingPayload({items:Array.from({length:15},(_,id)=>({id:id+100})),total:115},11);
assert.equal(context.state.listingPages.get(12).length,5);
assert.equal(context.state.listingPageCursors.has(13),false);
context.applyListingPayload({items:[{id:'unknown-total'}],total:null,source_counts:{bunjang:999}},1);
assert.equal(context.state.listingTotal,null,'an unknown D1 scoped count must not become a fake exact total');
assert.equal(context.dom.listingCount.textContent,'');

context.state = { listingSort: "price_asc" };
context.dom = { listingSort: node() };
context.dom.listingSortTabs = [];
context.resetListingControls();
assert.equal(context.state.listingSort, "recent");
assert.equal(context.dom.listingSort.value, "recent");

let listingLoads = 0;
let statsRenders = 0;
Object.assign(context, {
  updateFacetSelectionUi() {}, renderSourceFilters() {}, updateStatsMessage() {},
  syncCatalogUrl() {}, updatePriceGraphLink() {},
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

const linkContext = vm.createContext({ Intl, URL, URLSearchParams });
vm.runInContext(declarations, linkContext);
const selected = { canonical_product_id:'cpu:synthetic:test',canonical_display_name:'Synthetic CPU',category_code:'CPU',key_specs:{directory_node_type:'PRODUCT'} };
const searchUrl = new URL('https://example.test/?category_code=CPU&q=Synthetic&sort=price_asc&price_min=100');
Object.assign(linkContext, {
  state:{products:[selected],productTotal:1,selectedProduct:selected,selectedSites:new Set(['ebay']),facets:{},categoryCode:'CPU',query:'Synthetic',listingSort:'price_asc',priceMin:'100',priceMax:'900',
    sources:[{id:'bunjang',currency:'KRW',marketPools:['KR_C2C_USED']},{id:'ebay',currency:'USD',marketPools:['OVERSEAS_USED']}]},
  dom:{modelDetailOpen:node()}, PRODUCT_QUERY_KEYS:new Set(),
  window:{location:searchUrl,history:{replaceState(_a,_b,url){searchUrl.href=new URL(url,searchUrl).href;}}},
});
linkContext.syncCatalogUrl();linkContext.updatePriceGraphLink();
assert.equal(linkContext.dom.modelDetailOpen.href,undefined, 'preview never creates a navigation URL');
assert.equal(linkContext.dom.modelDetailOpen.attributes['aria-label'],'Synthetic CPU 가격 그래프 보기');
assert.equal(linkContext.pricePreviewProduct().canonical_product_id,selected.canonical_product_id);
assert.equal(searchUrl.searchParams.get('q'),'Synthetic');
assert.equal(searchUrl.searchParams.get('sort'),'price_asc');
assert.equal(searchUrl.searchParams.has('price_min'),false,'legacy price bounds cannot become invisible filters');
assert.equal(searchUrl.searchParams.has('price_max'),false);
assert.equal(linkContext.buildListingQuery().has('price_min'),false);
assert.equal(linkContext.buildListingQuery().has('price_max'),false);
assert.equal(linkContext.buildListingQuery().get('currency'),'USD');
assert.equal(linkContext.buildListingQuery().get('market_pool'),'OVERSEAS_USED');
linkContext.state.selectedSites.clear();
assert.equal(linkContext.buildListingQuery().get('currency'),'KRW');
assert.equal(linkContext.buildListingQuery().get('market_pool'),'KR_C2C_USED');
assert.equal(linkContext.buildListingQuery().get('sites'),'bunjang');
linkContext.state.sources=[linkContext.state.sources[1]];
assert.equal(linkContext.listingSourceScope().length,0,'domestic cannot fall back to eBay');
linkContext.state.selectedProduct=null;linkContext.state.productTotal=2;
linkContext.updatePriceGraphLink();assert.equal(linkContext.dom.modelDetailOpen.hidden,true);
let singleSelections=0;linkContext.selectProduct=()=>{singleSelections++;};
assert.equal(linkContext.openSingleSearchResult(),false);
linkContext.state.productTotal=1;assert.equal(linkContext.openSingleSearchResult(),true);
assert.equal(singleSelections,1);
linkContext.state.products=[];linkContext.state.productTotal=0;
linkContext.updatePriceGraphLink();assert.equal(linkContext.dom.modelDetailOpen.hidden,true);

const requestContext = vm.createContext({ URLSearchParams, AbortController, clearTimeout });
vm.runInContext(declarations, requestContext);
const pending = [];
const applied = [];
Object.assign(requestContext, {
  state: { selectedProduct: {}, listingRequest: null }, browseListingTimer: null,
  dom: { listingSection: node(), listingEmpty: node() },
  buildListingQuery: () => new URLSearchParams({ canonical_product_id: "cpu:intel:i5-7400" }),
  fetchJson: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
  renderListings() {}, renderListingPagination() {}, showListingMessage() {},
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
