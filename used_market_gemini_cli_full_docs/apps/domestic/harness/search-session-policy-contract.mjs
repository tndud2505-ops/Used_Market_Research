import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildCollectionRequest,
  requestedAcquisitionMode,
  requestedCollectionSites,
  requestedViewSites
} from "../cloudflare/live-search.mjs";
import { collectionIdentity, SearchIndex } from "../aws-runner/search-index.mjs";

const tempDir = mkdtempSync(path.join(os.tmpdir(), "used-market-search-session-policy-"));
const request = {
  keyword: "아이폰 15",
  category_id: "mobile",
  sites: ["bunjang", "joonggonara"],
  sort: "recommended",
  site_window: 160
};

try {
  assert.deepEqual(requestedViewSites({ ...request, view_sites: ["joonggonara"] }), ["joonggonara"]);
  assert.deepEqual(requestedCollectionSites({
    ...request,
    collect_view: true,
    focus_sites: ["joonggonara"]
  }), ["joonggonara"]);

  const recentCollection = buildCollectionRequest(request, "아이폰 15", 1_000);
  assert.equal(recentCollection.sort, "recent");
  assert.equal(recentCollection.min_price, undefined);
  assert.deepEqual(recentCollection.sites, ["bunjang", "joonggonara"]);

  const forcedPriceCollection = buildCollectionRequest({
    ...request,
    sort: "price_asc",
    acquisition_mode: "price_asc",
    collect_view: true,
    focus_sites: ["joonggonara"],
    min_price: 300_000,
    max_price: 900_000
  }, "아이폰 15", 1_000);
  assert.equal(requestedAcquisitionMode({ acquisition_mode: "price_asc" }), "recent");
  assert.equal(forcedPriceCollection.sort, "recent");
  assert.equal(forcedPriceCollection.min_price, undefined);
  assert.equal(forcedPriceCollection.max_price, undefined);
  assert.deepEqual(forcedPriceCollection.sites, ["joonggonara"]);

  const index = new SearchIndex({
    filePath: path.join(tempDir, "search.sqlite"),
    backupDir: path.join(tempDir, "backups")
  });
  try {
    const items = [
      item("bunjang", 1, 610_000),
      item("joonggonara", 2, 590_000),
      item("bunjang", 3, 570_000),
      item("joonggonara", 4, 550_000),
      item("bunjang", 5, 530_000),
      item("joonggonara", 6, 510_000)
    ];
    index.registerQuery(request);
    index.ingest(request, items, {
      deep: true,
      complete: true,
      successfulSites: request.sites
    });

    const aggregatePage = index.searchPage(request, { limit: 30 });
    const joonggonaraPage = index.searchPage({ ...request, view_sites: ["joonggonara"] }, { limit: 30 });
    assert.equal(aggregatePage.total, 6);
    assert.equal(joonggonaraPage.total, 3);
    assert(joonggonaraPage.items.every((entry) => entry.site === "joonggonara"));
    assert.equal(
      collectionIdentity(request).key,
      collectionIdentity({ ...request, view_sites: ["joonggonara"], sort: "price_asc" }).key,
      "사이트 보기와 정렬은 전체 검색 세션의 수집 키를 바꾸지 않는다"
    );
    assert.throws(
      () => index.searchPage({ ...request, view_sites: ["rethinkmall"] }, { limit: 30 }),
      /view sites must belong to the search collection/u
    );
  } finally {
    index.close();
  }

  const app = readFileSync(new URL("../web-backend/public/app.js", import.meta.url), "utf8");
  const runner = readFileSync(new URL("../aws-runner/runner.mjs", import.meta.url), "utf8");
  assert.match(app, /const preview = previewDataForSite\(site\);[\s\S]{0,500}reason: canReuseCollection \? 'site_filter' : 'search'/u);
  assert.match(app, /collectionData: null[\s\S]{0,100}viewData: new Map\(\)/u);
  assert.match(app, /rememberViewData\(data\);/u);
  assert.match(app, /!\['price_filter', 'sort', 'pagination', 'site_filter'\]\.includes\(reason\)/u);
  assert.match(app, /view_sites: viewSites\.length \? viewSites : undefined/u);
  assert.match(app, /focus_sites: focusSites\.length \? focusSites : undefined/u);
  assert.match(app, /collect_view: MARKET_PROFILE === 'global' \? undefined : collectView/u);
  assert.match(app, /acquisition_mode: MARKET_PROFILE === 'global' \? undefined : acquisitionMode/u);
  assert.match(app, /const SITE_PREFETCH_PAGES = 3;/u);
  assert.match(app, /state\.sort === 'price_asc'[\s\S]{0,300}items\.sort/u);
  assert.match(
    app,
    /renderAll\(\);[\s\S]{0,200}reason === 'price_filter'[\s\S]{0,200}\$\('#search-status'\)\.classList\.remove\('visible'\)/u,
    "가격 범위 검색 완료 후 진행 상태를 닫는다"
  );
  assert.match(app, /function availableResultCount\(data = state\.data\)/u);
  assert.match(app, /targetItemCount = Math\.min\(availableResultCount\(data\), SITE_PREFETCH_PAGES \* RESULT_PAGE_SIZE\)/u);
  assert.match(app, /const pageBeforeCollection = state\.currentPage;/u);
  assert.match(app, /const pageToKeep = Number\.isInteger\(state\.currentPage\) \? state\.currentPage : pageBeforeCollection;/u);
  assert.match(app, /state\.currentPage = clampResultPage\(pageToKeep/u);
  assert.match(app, /const requestedCursor = state\.data\.pagination\.next_cursor;[\s\S]{0,600}!pageResponseMatchesCursor\(state\.data\?\.pagination\?\.next_cursor, requestedCursor\)[\s\S]{0,100}continue;/u);
  const sortHandler = app.slice(app.indexOf("$$('[data-sort]')"), app.indexOf("$('#result-list').addEventListener", app.indexOf("$$('[data-sort]')")));
  assert.match(sortHandler, /renderAll\(\);[\s\S]{0,500}reason: 'sort'/u);
  assert.doesNotMatch(sortHandler, /collectActiveView/u);
  const activeSiteHandler = app.slice(app.indexOf('async function setActiveSite'), app.indexOf('function setActiveCountry'));
  assert.match(activeSiteHandler, /acquisitionMode: 'recent'/u);
  assert.doesNotMatch(activeSiteHandler, /acquisitionMode = state\.sort/u);
  const expansionHandler = app.slice(app.indexOf('async function expandResultWindow'), app.indexOf('function search'));
  assert.match(expansionHandler, /acquisitionMode: 'recent'/u);
  assert.doesNotMatch(expansionHandler, /state\.sort === 'price_asc'/u);
  assert.match(runner, /body\?\.expand_index === true \|\| body\?\.collect_view === true/u);
  assert.match(
    runner,
    /const cachedIndex = searchIndex\.search\(body, \{ maxRows: SEARCH_COLLECTION_MAX_ITEMS, allowStale: true \}\);[\s\S]{0,700}cachedIndex\?\.items\?\.length[\s\S]{0,700}queueIndexedRefresh\(body\)/u
  );
  assert.match(
    runner,
    /INDEX_MODE === "shadow"[\s\S]{0,300}body\?\.refresh_index === false[\s\S]{0,500}buildIndexedPayload\(body, indexed, null, "index_view"\)/u
  );

  console.log(JSON.stringify({ status: "passed", checks: 42 }, null, 2));
} finally {
  const resolved = path.resolve(tempDir);
  const systemTemp = `${path.resolve(os.tmpdir())}${path.sep}`;
  if (resolved.startsWith(systemTemp)) rmSync(resolved, { recursive: true, force: true });
}

function item(site, number, price) {
  return {
    id: `${site}:${number}`,
    site,
    category_id: "mobile",
    title: `아이폰 15 ${number}`,
    price,
    currency: "KRW",
    url: `https://example.test/${site}/${number}`,
    image_url: `https://example.test/${site}/${number}.jpg`,
    posted_at: new Date(Date.now() - number * 60_000).toISOString()
  };
}
