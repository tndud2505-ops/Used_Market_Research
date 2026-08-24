import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  RESULT_PAGE_SIZE,
  RESULT_WINDOW_MAX,
  clampResultPage,
  maxNavigableResultPage,
  pageResponseMatchesCursor,
  paginationItems,
  resultPageCount
} from "../web-backend/public/pagination.mjs";

assert.equal(RESULT_PAGE_SIZE, 30);
assert.equal(RESULT_WINDOW_MAX, 1000);
assert.equal(resultPageCount(0), 0);
assert.equal(resultPageCount(1), 1);
assert.equal(resultPageCount(41), 2);
assert.equal(resultPageCount(60), 2);
assert.equal(resultPageCount(100), 4);
assert.equal(resultPageCount(800), 27);
assert.equal(resultPageCount(1000), 34);
assert.equal(resultPageCount(1200), 34);
assert.equal(clampResultPage(-1, 4), 0);
assert.equal(clampResultPage(9, 4), 3);
assert.equal(pageResponseMatchesCursor("index:v2:one", "index:v2:one"), true);
assert.equal(pageResponseMatchesCursor("index:v2:two", "index:v2:one"), false);
assert.equal(pageResponseMatchesCursor(null, "index:v2:one"), false);
assert.equal(maxNavigableResultPage(30, 1000, true), 1);
assert.equal(maxNavigableResultPage(30, 1000, false), 0);
assert.equal(maxNavigableResultPage(60, 1000, true), 2);
assert.equal(maxNavigableResultPage(1000, 1000, false), 33);
assert.equal(maxNavigableResultPage(0, 0, false), 0);
assert.deepEqual(paginationItems(0, 7), [0, 1, 2, 3, 4, 5, 6]);
assert.deepEqual(paginationItems(0, 27), [0, 1, "ellipsis", 26]);
assert.deepEqual(paginationItems(13, 27), [0, "ellipsis", 12, 13, 14, "ellipsis", 26]);
assert.deepEqual(paginationItems(26, 27), [0, "ellipsis", 25, 26]);
assert.deepEqual(paginationItems(0, 27, 2), [0, 1, 2, "ellipsis", 26]);
assert.deepEqual(paginationItems(0, 27, 3), [0, 1, 2, 3, "ellipsis", 26]);
assert.deepEqual(paginationItems(0, 27, 7), [0, 1, "ellipsis", 7, "ellipsis", 26]);
assert.deepEqual(paginationItems(5, 27, 7), [0, "ellipsis", 4, 5, 6, 7, "ellipsis", 26]);

const html = await readFile(new URL("../web-backend/public/index.html", import.meta.url), "utf8");
const app = await readFile(new URL("../web-backend/public/app.js", import.meta.url), "utf8");
const styles = await readFile(new URL("../web-backend/public/styles.css", import.meta.url), "utf8");
assert.match(html, /\/styles\.css\?v=domestic-pagination-v6/);
assert.match(html, /\/app\.js\?v=domestic-ebay-v10/);
assert.match(app, /pagination\.mjs\?v=pagination-v7/);
assert.doesNotMatch(html, /data-site-tab="daangn"/u);
assert.doesNotMatch(app, /DEFAULT_SITES\s*=\s*\[[^\]]*daangn/u);
assert.match(html, /id="pagination-controls"/);
assert.doesNotMatch(html, /id="load-more-button"/);
assert.match(app, /pagination-page/);
assert.match(app, /pagination-page-preview/);
assert.match(app, /pagination-page-preview[\s\S]{0,180}aria-disabled="true"/u);
assert.match(app, /paginationItems\(state\.currentPage, pageCount, maxNavigablePage\)/u);
assert.doesNotMatch(app, /aria-current="page" disabled/u);
const loadResultPageSource = app.match(/async function loadResultPage\(pageIndex\) \{[\s\S]*?\n\}\n\nfunction canExpandResultWindow/u)?.[0] || "";
assert.ok(loadResultPageSource);
assert.match(loadResultPageSource, /if \(loadedCount >= targetItemCount\) \{[\s\S]{0,180}renderAll\(\);[\s\S]{0,100}return;/u);
assert.doesNotMatch(loadResultPageSource, /while \(/u);
assert.equal((loadResultPageSource.match(/await requestSearchPage\(/gu) || []).length, 1);
assert.match(styles, /\.result-pagination \{[^}]*flex-wrap:\s*wrap;/u);
assert.doesNotMatch(styles, /body \{[^}]*min-width:\s*320px/u);
assert.match(app, /aria-current/);
assert.doesNotMatch(app, /다음 매물 더 찾기/u);
assert.match(app, />\$\{uiText\('이전', 'Previous'\)\}<\/button>/u);
assert.match(app, />\$\{uiText\('다음', 'Next'\)\}<\/button>/u);
assert.match(app, /if \(!canExpandResultWindow\(\) \|\| state\.loading \|\| state\.viewCollectionController\) return;/u);
assert.match(app, /SITE_RESULT_WINDOW_INITIAL = 160/u);
assert.match(app, /SITE_RESULT_WINDOW_MAX = 640/u);
assert.match(app, /data-expand-results/u);
assert.match(app, /expand_index: expandIndex/u);
assert.match(app, /async function expandResultWindow\(\)/u);
assert.match(app, /SEARCH_ONLY_SITES/);
assert.match(app, /hasExplicitKeyword && SEARCH_ONLY_SITES\.has\(site\)/);
assert.doesNotMatch(app, /부분 실패/);
assert.match(app, /일부 확인/);
assert.match(app, /function applyPriceFilter\(\) \{\s*if \(state\.loading\) return;/u);
assert.match(app, /function updateResultControls\(\)/u);
assert.match(app, /control\.disabled = state\.loading \|\| unavailable/u);
assert.match(app, /\$\$\('\[data-sort\]'\)[\s\S]{0,120}if \(state\.loading\) return;/u);
assert.match(app, /function setLoading\([\s\S]{0,500}if \(state\.data\) renderPagination\(\);/u);
assert.doesNotMatch(app, /\$\$\('#pagination-controls button'\)[\s\S]{0,160}pageButton\.disabled/u);

console.log(JSON.stringify({ status: "passed", checks: 67 }, null, 2));
