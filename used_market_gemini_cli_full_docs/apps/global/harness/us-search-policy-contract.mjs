import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeRawResult } from '../dist/collector/logic/normalize-raw.js';
import { extractSearchListingsFromHtml } from '../dist/collector/logic/browserCollector.js';
import { resolveBrowserSiteAdapter } from '../dist/collector/logic/sites/index.js';
import { deriveCollectionState } from '../dist/MCP/logic/collection-state.js';
import { SearchResultSchema } from '../dist/MCP/logic/types.js';
import { validateWebSearchRequest } from '../dist/web-backend/logic/search-service.js';

const failures = [];
let checks = 0;
const TEST_SESSION = { session_id: '00000000-0000-4000-8000-000000000001', session_generation: 1 };

function checkContract(name, contract) {
  checks += 1;
  try {
    contract();
  } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function siteCursor(site, cursor) {
  return Buffer.from(JSON.stringify({
    version: 1,
    site_cursors: { [site]: cursor }
  }), 'utf8').toString('base64url');
}

function rawResult(site, keyword, titles, qualityMeta = {}) {
  return SearchResultSchema.parse({
    site,
    keyword,
    keyword_is_explicit: true,
    collection_state: 'ready',
    items: titles.map((title, index) => ({
      title,
      price: 20 + index,
      currency: 'USD',
      url: `https://fixtures.example/${site}/${index}`
    })),
    quality_meta: {
      extracted_count: titles.length,
      filtered_count: 0,
      duplicate_count: 0,
      warning_count: 0,
      ...qualityMeta
    },
    pagination: { has_more: false, next_cursor: null }
  });
}

checkContract('eBay offset cursor', () => {
  const request = validateWebSearchRequest({
    ...TEST_SESSION,
    keyword: 'iphone 13',
    sites: ['ebay'],
    cursor: siteCursor('ebay', 'offset:30')
  });
  assert.equal(request.siteCursors.ebay, 'offset:30', 'offset:30 must be accepted for eBay');
});

checkContract('within-page offset cursor', () => {
  const request = validateWebSearchRequest({
    ...TEST_SESSION,
    keyword: 'nike shoes',
    sites: ['vinted'],
    cursor: siteCursor('vinted', 'page:1:offset:30')
  });
  assert.equal(request.siteCursors.vinted, 'page:1:offset:30');
});

checkContract('exhausted source cursor', () => {
  const request = validateWebSearchRequest({
    ...TEST_SESSION,
    keyword: 'iphone 13',
    sites: ['ebay', 'poshmark'],
    cursor: Buffer.from(JSON.stringify({
      version: 1,
      site_cursors: { ebay: 'offset:30', poshmark: 'exhausted:v1' }
    }), 'utf8').toString('base64url')
  });
  assert.equal(request.siteCursors.ebay, 'offset:30');
  assert.equal(request.siteCursors.poshmark, 'exhausted:v1', 'an exhausted source must remain explicit');
});

for (const site of ['vinted', 'unclaimed_baggage']) {
  checkContract(`${site} page cursor URL`, () => {
    const url = new URL(resolveBrowserSiteAdapter(site).searchUrl('nike shoes', 40, 'page:2'));
    assert.equal(url.searchParams.get('page'), '2', 'page:2 must add page=2 to the public search URL');
  });
}

checkContract('Vinted broad Nike candidate', () => {
  const result = normalizeRawResult(rawResult('vinted', 'nike shoes', ['Nike']));
  assert.deepEqual(result.items.map((item) => item.title), ['Nike']);
});

checkContract('Vinted accented Pokemon candidate', () => {
  const result = normalizeRawResult(rawResult('vinted', 'pokemon cards', ['Pokémon']));
  assert.deepEqual(result.items.map((item) => item.title), ['Pokémon']);
});

checkContract('category intent rejects apparel and toys', () => {
  const footwear = normalizeRawResult(rawResult('vinted', 'nike shoes', ['Nike Hoodie', 'Nike Air Max 90 Shoes']));
  assert.deepEqual(footwear.items.map((item) => item.title), ['Nike Air Max 90 Shoes']);
  const cards = normalizeRawResult(rawResult('vinted', 'pokemon cards', ['Pokemon Plush Toy', 'Pokemon TCG Cards']));
  assert.deepEqual(cards.items.map((item) => item.title), ['Pokemon TCG Cards']);
});

checkContract('Unclaimed Baggage footwear candidates', () => {
  const result = normalizeRawResult(rawResult(
    'unclaimed_baggage',
    'nike shoes',
    ['Metcon 6 Athletic Shoes', 'Air Max 90 Shoes', 'Adidas Hoodie']
  ));
  assert.deepEqual(
    result.items.map((item) => item.title),
    ['Metcon 6 Athletic Shoes', 'Air Max 90 Shoes'],
    'known Nike footwear models should remain while an unrelated Adidas hoodie is removed'
  );
});

checkContract('quality count invariant', () => {
  const result = normalizeRawResult(rawResult(
    'unclaimed_baggage',
    'nike shoes',
    ['Adidas Hoodie'],
    { extracted_count: 1, filtered_count: 1 }
  ));
  assert.ok(
    result.quality_meta.filtered_count <= result.quality_meta.extracted_count,
    `filtered_count (${result.quality_meta.filtered_count}) must not exceed extracted_count (${result.quality_meta.extracted_count})`
  );
});

checkContract('eBay replacement parts are not devices', () => {
  const result = normalizeRawResult(rawResult(
    'ebay',
    'iphone 13',
    [
      'Apple iPhone 13 128GB Unlocked',
      'iPhone 13 LCD Screen Replacement Digitizer',
      'Repair Part - OEM Pull Frame with Small Parts for Apple iPhone 13 - Midnight',
      'iPhone 13 Pro Max Spec Ear Speaker Replacement Proximity Sensor Flex Cable OEM'
    ]
  ));
  assert.deepEqual(result.items.map((item) => item.title), ['Apple iPhone 13 128GB Unlocked']);
});

checkContract('device accessories without numeric models are removed', () => {
  const result = normalizeRawResult(rawResult(
    'ebay',
    'iphone se',
    ['Apple iPhone SE 64GB Unlocked with Case', 'iPhone SE Silicone Case']
  ));
  assert.deepEqual(result.items.map((item) => item.title), ['Apple iPhone SE 64GB Unlocked with Case']);
  const pixel = normalizeRawResult(rawResult('ebay', 'pixel fold', ['Google Pixel Fold Case Cover']));
  assert.equal(pixel.items.length, 0);
});

checkContract('RAM means computer memory, not Rams apparel or zodiac items', () => {
  const result = normalizeRawResult(rawResult(
    'poshmark',
    'ram',
    [
      'Corsair Vengeance RGB Pro RAM 16GB 3600MHz',
      'Samsung DDR4 16GB SODIMM Laptop Memory',
      'Los Angeles Rams Hoodie',
      'West Chester University Rams Volleyball T-Shirt',
      'Golden Ram Zodiac Charm'
    ]
  ));
  assert.deepEqual(result.items.map((item) => item.title), [
    'Corsair Vengeance RGB Pro RAM 16GB 3600MHz',
    'Samsung DDR4 16GB SODIMM Laptop Memory'
  ]);
});

checkContract('total high filter rate is degraded', () => {
  const result = normalizeRawResult(rawResult(
    'poshmark',
    'iphone 13',
    ['Apple iPhone 13 128GB', 'Apple iPhone 13 Pro', 'Apple iPhone 13 Mini'],
    { extracted_count: 48, filtered_count: 45 }
  ));
  assert.ok(result.warnings.some((warning) => warning === 'HIGH_FILTER_RATE:45/48'));
  assert.equal(result.collection_state, 'partial');
});

checkContract('informational eBay warning remains ready', () => {
  assert.equal(deriveCollectionState({
    itemCount: 12,
    extractedCount: 12,
    filteredCount: 0,
    warnings: ['EBAY_SALE_STATUS_UNAVAILABLE'],
    errors: []
  }), 'ready');
});

checkContract('ordinary relevance filtering remains ready', () => {
  assert.equal(deriveCollectionState({
    itemCount: 8,
    extractedCount: 12,
    filteredCount: 4,
    warnings: [],
    errors: []
  }), 'ready');
});

const vintedWindowHtml = `<!doctype html><html><body>
  ${['Nike', 'Nike Air', 'Nike Dunk'].map((title, index) => `
    <div class="ItemBox-module__new-item-box__container" data-testid="product-item-id-window-${index}">
      <a href="/items/window-${index}" data-testid="product-item-id-window-${index}--overlay-link"></a>
      <img data-testid="product-item-id-window-${index}--image--img" src="https://images1.vinted.net/window-${index}.webp" alt="${title}" />
      <p data-testid="product-item-id-window-${index}--description-title">${title}</p>
      <p data-testid="product-item-id-window-${index}--description-subtitle">Very good</p>
      <p data-testid="product-item-id-window-${index}--price-text">$${20 + index}.00</p>
    </div>`).join('')}
</body></html>`;

const vintedIrrelevantHtml = `<!doctype html><html><body>
  <div class="ItemBox-module__new-item-box__container" data-testid="product-item-id-irrelevant">
    <a href="/items/irrelevant" data-testid="product-item-id-irrelevant--overlay-link"></a>
    <img data-testid="product-item-id-irrelevant--image--img" src="https://images1.vinted.net/irrelevant.webp" alt="Samsung Galaxy S22" />
    <p data-testid="product-item-id-irrelevant--description-title">Samsung Galaxy S22</p>
    <p data-testid="product-item-id-irrelevant--price-text">$20.00</p>
  </div>
</body></html>`;

checks += 1;
try {
  const firstWindow = await extractSearchListingsFromHtml({
    site: 'vinted', keyword: 'nike shoes', keywordIsExplicit: true, limit: 2
  }, vintedWindowHtml, 'https://www.vinted.com/catalog?search_text=nike%20shoes');
  assert.deepEqual(firstWindow.items.map((item) => item.title), ['Nike', 'Nike Air']);
  const normalizedFirstWindow = normalizeRawResult(firstWindow);
  assert.deepEqual(
    normalizedFirstWindow.items.map((item) => item.title),
    ['Nike', 'Nike Air'],
    'structured selector evidence must not make valid short titles fail category intent'
  );
  assert.equal(firstWindow.pagination.next_cursor, 'page:1:offset:2');
  const secondWindow = await extractSearchListingsFromHtml({
    site: 'vinted', keyword: 'nike shoes', keywordIsExplicit: true, limit: 2, cursor: firstWindow.pagination.next_cursor
  }, vintedWindowHtml, 'https://www.vinted.com/catalog?search_text=nike%20shoes');
  assert.deepEqual(secondWindow.items.map((item) => item.title), ['Nike Dunk']);
  assert.equal(secondWindow.pagination.has_more, false);
} catch (error) {
  failures.push(`within-page result windows: ${error instanceof Error ? error.message : String(error)}`);
}

checks += 1;
try {
  const irrelevant = await extractSearchListingsFromHtml({
    site: 'vinted', keyword: 'iphone 13', keywordIsExplicit: true, limit: 30
  }, vintedIrrelevantHtml, 'https://www.vinted.com/catalog?search_text=iphone%2013');
  assert.equal(irrelevant.items.length, 0);
  assert.deepEqual(irrelevant.errors, [], 'valid but irrelevant rows are not selector drift');
  assert.equal(irrelevant.collection_state, 'filtered_empty');
} catch (error) {
  failures.push(`irrelevant-only result state: ${error instanceof Error ? error.message : String(error)}`);
}

const appSource = await readFile(new URL('../web-backend/public/app.js', import.meta.url), 'utf8');
const orchestratorSource = await readFile(new URL('../MCP/logic/orchestrator.ts', import.meta.url), 'utf8');

checkContract('expandable result window', () => {
  const functionStart = appSource.indexOf('function canExpandResultWindow');
  const functionEnd = appSource.indexOf('async function expandResultWindow', functionStart);
  assert.ok(functionStart >= 0 && functionEnd > functionStart, 'canExpandResultWindow function must exist');
  const functionSource = appSource.slice(functionStart, functionEnd);
  assert.doesNotMatch(functionSource, /return\s+false\s*&&/, 'result-window expansion must not be permanently disabled');
  assert.match(functionSource, /SITE_RESULT_WINDOW_MAX/, 'result-window expansion must stop at the 640-item source window');
});

checkContract('one additional-search action targets 160 more listings', () => {
  const expandStart = appSource.indexOf('async function expandResultWindow');
  const expandEnd = appSource.indexOf('\nfunction ', expandStart + 20);
  const expandSource = appSource.slice(expandStart, expandEnd);
  assert.match(expandSource, /SITE_RESULT_WINDOW_STEP/, 'additional search must use the 160-item step');
  assert.match(expandSource, /targetCount/, 'additional search must keep following cursors until the target count is reached');
  assert.match(expandSource, /MAX_EXPANSION_REQUESTS/, 'additional search must keep a bounded request budget');
});

checkContract('next cursor follow-up request', () => {
  assert.match(
    appSource,
    /requestSearchPage\s*\(\s*\{[\s\S]{0,600}?cursor:\s*state\.data\.pagination\.next_cursor/,
    'a follow-up request must pass pagination.next_cursor back to the search endpoint'
  );
});

checkContract('empty intermediate page keeps continuation available', () => {
  const expandStart = appSource.indexOf('async function expandResultWindow');
  const expandEnd = appSource.indexOf('\nfunction ', expandStart + 20);
  const expandSource = appSource.slice(expandStart, expandEnd);
  assert.doesNotMatch(
    expandSource,
    /expansionExhausted\s*=\s*addedCount\s*===\s*0\s*\|\|/,
    'zero newly-visible items must not discard an advanced continuation cursor'
  );
  assert.match(expandSource, /MAX_EMPTY_CONTINUATION_HOPS|emptyContinuationHops/, 'continuation must be bounded');
});

checkContract('merged result count follows accumulated items', () => {
  const mergeMatch = appSource.match(/function mergeSearchData\(previous, next\)\s*\{([\s\S]*?)\n\}\n\nfunction canonicalItemKey/);
  assert.ok(mergeMatch, 'mergeSearchData function must exist');
  assert.match(mergeMatch[1], /available_count:\s*items\.length/, 'quality.available_count must use the deduplicated accumulated item count');
});

checkContract('ordinary filtering is not shown as partial', () => {
  const summaryMatch = appSource.match(/function renderSourceSummary\(\)\s*\{([\s\S]*?)\n\}\n\nfunction renderResults/);
  assert.ok(summaryMatch, 'renderSourceSummary function must exist');
  assert.doesNotMatch(summaryMatch[1], /partial\s*=\s*Boolean\([\s\S]{0,300}filtered_count/, 'filtered_count alone must not mark a successful source Partial');
});

checkContract('sort reuses the loaded collection', () => {
  const sortHandler = appSource.match(/\$\$\('\[data-sort\]'\)[\s\S]*?\}\)\);/);
  assert.ok(sortHandler, 'sort click handler must exist');
  assert.doesNotMatch(sortHandler[0], /executeSearch\(/, 'sort changes must not discard and recollect loaded pages');
  assert.match(sortHandler[0], /renderAll\(\)/, 'sort changes must rerender the loaded collection');
});

checkContract('price sort uses numeric price before quality warnings', () => {
  assert.match(appSource, /function compareItemPrice\(left, right, direction\)/, 'local price sort must have one numeric comparator');
  assert.match(appSource, /direction === 'desc' \? rightPrice - leftPrice : leftPrice - rightPrice/, 'numeric price must be the primary key in both directions');
  assert.match(appSource, /priceOrder \|\| priceQualityRank\(left\) - priceQualityRank\(right\)/, 'quality may only break equal-price ties');
});

checkContract('price filter reuses the loaded collection', () => {
  const priceHandler = appSource.match(/function applyPriceFilter\(\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(priceHandler, 'applyPriceFilter must exist');
  assert.doesNotMatch(priceHandler[1], /executeSearch\(/, 'price filtering must not discard and recollect loaded pages');
  assert.match(priceHandler[1], /renderAll\(\)/, 'price filtering must rerender the loaded collection');
});

checkContract('visible count follows loaded filters', () => {
  const countHandler = appSource.match(/function availableResultCount\(\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(countHandler, 'availableResultCount must exist');
  assert.match(countHandler[1], /filteredItems\(\)\.length/, 'result count must follow the locally filtered loaded collection');
});

checkContract('login check only when required', () => {
  const loopMatch = orchestratorSource.match(
    /for\s*\(const siteKey of input\.sites\)\s*\{([\s\S]*?)const search = await this\.search/
  );
  assert.ok(loopMatch, 'fullWorkflow per-site loop must exist');
  const loginCallIndex = loopMatch[1].indexOf('this.loginCheck');
  assert.notEqual(loginCallIndex, -1, 'login-required sites must retain a login check');
  assert.match(
    loopMatch[1].slice(0, loginCallIndex),
    /if\s*\(\s*site\.loginRequired\s*\)\s*\{/,
    'this.loginCheck must be guarded by site.loginRequired so public sites skip it'
  );
});

checkContract('exhausted sources are skipped', () => {
  assert.match(
    orchestratorSource,
    /siteCursors\?\.\[siteKey\]\s*===\s*["']exhausted:v1["'][\s\S]{0,220}?continue;/,
    'a source marked exhausted must not restart from page one'
  );
});

if (failures.length > 0) {
  console.error(`global US search policy contract RED (${failures.length}/${checks} failed)`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`global US search policy contract passed (${checks} checks)`);
}
