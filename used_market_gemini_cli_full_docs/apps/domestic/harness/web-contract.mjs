import assert from 'node:assert/strict';
import {
  WebSearchValidationError,
  buildTrustedPriceSummary,
  mergeCombinedSearchPayload,
  priceMediansByCurrency,
  validateWebSearchRequest
} from '../dist/web-backend/logic/search-service.js';
import { SearchResultSchema } from '../dist/MCP/logic/types.js';
import { normalizeRawResult } from '../dist/collector/logic/normalize-raw.js';
import { keywordMatchesText } from '../dist/collector/logic/keyword-aliases.js';
import { deriveCollectionState } from '../dist/MCP/logic/collection-state.js';
import { filterKnownCategoryItems } from '../dist/collector/logic/browserCollector.js';
import { classifyNoiseCandidate } from '../dist/market/logic/noise-filter.js';
import {
  listSearchOnlySourceCatalog,
  SearchOnlyValidationError,
  validateSearchOnlyRequest
} from '../dist/web-backend/logic/search-only-service.js';

const invalidInputs = [
  {},
  { category_id: 'not-real' },
  { keyword: 'RTX 3070', limit: 0 },
  { keyword: 'RTX 3070', sites: ['not-real'] }
];

for (const input of invalidInputs) {
  assert.throws(
    () => validateWebSearchRequest(input),
    (error) => error instanceof WebSearchValidationError,
    `invalid web search input should be rejected: ${JSON.stringify(input)}`
  );
}

const valid = validateWebSearchRequest({ category_id: 'fashion_women_bottoms', sites: ['joonggonara'], limit: 4 });
assert.equal(valid.effectiveKeyword, '여성 바지');
assert.deepEqual(valid.siteCursors, { joonggonara: null });
assert.throws(
  () => validateWebSearchRequest({ category_id: 'all', sites: ['joonggonara'] }),
  (error) => error instanceof WebSearchValidationError && /keyword.*all|all.*keyword/i.test(error.message)
);
const multiCategoryRequest = validateWebSearchRequest({
  category_ids: ['fashion_women_tops', 'fashion_women_bottoms'],
  sites: ['joonggonara'],
  limit: 4
});
assert.deepEqual(multiCategoryRequest.categoryIds, ['fashion_women_tops', 'fashion_women_bottoms']);
assert.equal(multiCategoryRequest.categories.length, 2);
const combinedPayload = mergeCombinedSearchPayload([
  {
    query: '여성 상의',
    category: { id: 'fashion_women_tops', label: '여성 상의', path: ['패션의류', '여성의류', '여성 상의'] },
    items: [
      { id: 'https://fixture.invalid/shared', url: 'https://fixture.invalid/shared', title: '공통 매물', site: 'joonggonara', price: 10000 },
      { id: 'https://fixture.invalid/top', url: 'https://fixture.invalid/top', title: '상의 매물', site: 'joonggonara', price: 20000 }
    ],
    sources: [{ key: 'joonggonara', name: '중고나라', count: 2, normalized_count: 2, extracted_count: 2, filtered_count: 0, visible_count: 2, collection_state: 'ready', status: 'ready', warnings: [], errors: [] }],
    summary: { item_count: 2, source_count: 1 },
    quality: { raw_count: 2, normalized_count: 2, merged_count: 2, warnings: [] },
    pagination: { has_more: false, next_cursor: null }
  },
  {
    query: '여성 바지',
    category: { id: 'fashion_women_bottoms', label: '여성 바지', path: ['패션의류', '여성의류', '여성 바지'] },
    items: [
      { id: 'https://fixture.invalid/shared', url: 'https://fixture.invalid/shared', title: '공통 매물', site: 'joonggonara', price: 10000 },
      { id: 'https://fixture.invalid/bottom', url: 'https://fixture.invalid/bottom', title: '바지 매물', site: 'joonggonara', price: 30000 }
    ],
    sources: [{ key: 'joonggonara', name: '중고나라', count: 2, normalized_count: 2, extracted_count: 2, filtered_count: 0, visible_count: 2, collection_state: 'ready', status: 'ready', warnings: [], errors: [] }],
    summary: { item_count: 2, source_count: 1 },
    quality: { raw_count: 2, normalized_count: 2, merged_count: 2, warnings: [] },
    pagination: { has_more: false, next_cursor: null }
  }
], multiCategoryRequest.categories);
assert.deepEqual(combinedPayload.items.map((item) => item.url), [
  'https://fixture.invalid/shared',
  'https://fixture.invalid/top',
  'https://fixture.invalid/bottom'
]);
assert.equal(combinedPayload.categories.length, 2);
assert.equal(combinedPayload.summary.item_count, 3);
assert.equal(combinedPayload.summary.source_count, 1);
assert.deepEqual(priceMediansByCurrency([
  { price: 100000, currency: 'KRW' },
  { price: 120000, currency: 'KRW' },
  { price: 500, currency: 'usd' }
]), new Map([['KRW', 110000], ['USD', 500]]));
assert.deepEqual(buildTrustedPriceSummary([
  { price: 100000, currency: 'KRW', price_suspect: false, noise_filtered: false, fraud_risk: null },
  { price: 500, currency: 'USD', price_suspect: false, noise_filtered: false, fraud_risk: null }
]), { currency: 'MIXED', median_price: null, average_price: null, lowest_price: null, highest_price: null });
const encodeCursor = (value) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
const validBunjangCursor = validateWebSearchRequest({
  category_id: 'mobile',
  sites: ['bunjang'],
  cursor: encodeCursor({ version: 1, site_cursors: { bunjang: 'eyJyaWQiOiJvZmZpY2lhbC1jdXJzb3ItMg' } })
});
assert.equal(validBunjangCursor.siteCursors.bunjang, 'eyJyaWQiOiJvZmZpY2lhbC1jdXJzb3ItMg');
const validBunjangSliceCursor = validateWebSearchRequest({
  category_id: 'mobile',
  sites: ['bunjang'],
  cursor: encodeCursor({ version: 1, site_cursors: { bunjang: 'slice:v1:eyJ1cHN0cmVhbV9jdXJzb3IiOm51bGwsIml0ZW1fb2Zmc2V0IjoyfQ' } })
});
assert.equal(validBunjangSliceCursor.siteCursors.bunjang.startsWith('slice:v1:'), true);
const mobileBunjang = validateWebSearchRequest({ category_id: 'mobile', sites: ['bunjang'], limit: 4 });
assert.equal(mobileBunjang.categories[0].id, 'mobile');
assert.deepEqual(validateWebSearchRequest({ category_id: 'mobile' }).sites, ['joonggonara', 'bunjang']);
assert.throws(
  () => validateWebSearchRequest({ category_id: 'mobile', sites: ['ebay'] }),
  /Unsupported site: ebay/
);
assert.throws(
  () => validateSearchOnlyRequest({ source: 'hellomarket', keyword: 'RTX 3070', limit: 10 }),
  /stable pagination cursor/
);
const combinedCursor = encodeCursor({
  version: 2,
  category_cursors: {
    fashion_women_tops: encodeCursor({ version: 1, site_cursors: { joonggonara: 'page:2' } }),
    fashion_women_bottoms: encodeCursor({ version: 1, site_cursors: { joonggonara: 'page:3' } })
  }
});
const validatedCombinedCursor = validateWebSearchRequest({
  category_ids: ['fashion_women_tops', 'fashion_women_bottoms'],
  sites: ['joonggonara'],
  cursor: combinedCursor
});
assert.deepEqual(validatedCombinedCursor.categoryCursors, {
  fashion_women_tops: encodeCursor({ version: 1, site_cursors: { joonggonara: 'page:2' } }),
  fashion_women_bottoms: encodeCursor({ version: 1, site_cursors: { joonggonara: 'page:3' } })
});
const validatedCombinedSeenCursor = validateWebSearchRequest({
  category_ids: ['fashion_women_tops', 'fashion_women_bottoms'],
  sites: ['joonggonara'],
  cursor: encodeCursor({
    version: 2,
    category_cursors: {
      fashion_women_tops: encodeCursor({ version: 1, site_cursors: { joonggonara: 'page:2' } }),
      fashion_women_bottoms: encodeCursor({ version: 1, site_cursors: { joonggonara: 'page:3' } })
    },
    seen_items: ['joonggonara:https://fixture.invalid/seen']
  })
});
assert.deepEqual(validatedCombinedSeenCursor.seenItemKeys, ['joonggonara:https://fixture.invalid/seen']);
const combinedWithMore = mergeCombinedSearchPayload([
  { ...combinedPayload, category: multiCategoryRequest.categories[0], pagination: { has_more: true, next_cursor: 'tops-next' } },
  { ...combinedPayload, category: multiCategoryRequest.categories[1], pagination: { has_more: false, next_cursor: null } }
], multiCategoryRequest.categories);
assert.equal(combinedWithMore.pagination.has_more, true);
assert.deepEqual(JSON.parse(Buffer.from(combinedWithMore.pagination.next_cursor, 'base64url').toString('utf8')), {
  version: 2,
  category_cursors: { fashion_women_tops: 'tops-next', fashion_women_bottoms: null },
  seen_items: [
    'joonggonara:https://fixture.invalid/shared',
    'joonggonara:https://fixture.invalid/top',
    'joonggonara:https://fixture.invalid/bottom'
  ]
});
const seenKey = 'joonggonara:https://web.joongna.com/product/seen-item';
const combinedWithSeen = mergeCombinedSearchPayload([
  {
    category: multiCategoryRequest.categories[0],
    items: [
      { site: 'joonggonara', url: 'https://web.joongna.com/product/seen-item', title: 'already shown', price: 1000 },
      { site: 'joonggonara', url: 'https://web.joongna.com/product/new-item', title: 'new item', price: 2000 }
    ],
    sources: [],
    pagination: { has_more: true, next_cursor: 'next-page' },
    quality: { raw_count: 2, normalized_count: 2 }
  }
], multiCategoryRequest.categories.slice(0, 1), [seenKey]);
assert.deepEqual(combinedWithSeen.items.map((item) => item.url), ['https://web.joongna.com/product/new-item']);

const noiseOnlyPage = normalizeRawResult(SearchResultSchema.parse({
  site: 'bunjang',
  keyword: 'RTX 3070',
  items: [{
    title: 'RTX3060 게이밍PC',
    price: 500000,
    url: 'https://fixture.invalid/noise-only',
    notes: 'source=public-api; site=bunjang'
  }],
  pagination: { has_more: true, next_cursor: 'page:2' }
}));
assert.equal(noiseOnlyPage.items.length, 0);
assert.equal(noiseOnlyPage.pagination.has_more, true);
assert.equal(noiseOnlyPage.pagination.next_cursor, 'page:2');
assert.equal(noiseOnlyPage.collection_state, 'filtered_empty');
assert.equal(deriveCollectionState({ itemCount: 0 }), 'empty');
assert.equal(deriveCollectionState({ itemCount: 3, warnings: ['CATEGORY_PARENT_FALLBACK: parent'] }), 'partial');
assert.equal(deriveCollectionState({ itemCount: 0, warnings: ['CATEGORY_COLLECTION_UNAVAILABLE: missing'] }), 'unsupported');
assert.equal(deriveCollectionState({ itemCount: 0, errors: ['SEARCH_EXTRACTION_FAILED'] }), 'failed');
const womenBottomsFiltered = filterKnownCategoryItems(SearchResultSchema.parse({
  site: 'joonggonara',
  keyword: '여성 바지',
  category: { id: 'fashion_women_bottoms', label: '여성 바지', path: ['패션의류', '여성의류', '여성 바지'] },
  items: [
    { title: '데님 와이드 팬츠', price: 10000, url: 'https://fixture.invalid/pants' },
    { title: '여성 니트 가디건', price: 10000, url: 'https://fixture.invalid/cardigan' },
    { title: '브랜드 단독 상품', price: 10000, url: 'https://fixture.invalid/unknown' }
  ]
}), {
  site: 'joonggonara',
  keyword: '여성 바지',
  limit: 10,
  category: { id: 'fashion_women_bottoms', label: '여성 바지', path: ['패션의류', '여성의류', '여성 바지'] }
});
assert.deepEqual(womenBottomsFiltered.items.map((item) => item.title), ['데님 와이드 팬츠']);

const koreanKeywordResult = normalizeRawResult(SearchResultSchema.parse({
  site: 'joonggonara',
  keyword: '\uC5EC\uC131 \uBC14\uC9C0',
  items: [
    { title: '\uC5EC\uC131 \uB370\uB2D8 \uBC14\uC9C0', price: 30000, url: 'https://fixture.invalid/women-pants' },
    { title: '\uB0A8\uC131 \uC2E0\uBC1C', price: 30000, url: 'https://fixture.invalid/men-shoes' }
  ],
  quality_meta: { extracted_count: 10, filtered_count: 3, duplicate_count: 2, warning_count: 0 },
  pagination: { has_more: true, next_cursor: 'page:2' }
}));
assert.deepEqual(koreanKeywordResult.items.map((item) => item.title), ['\uC5EC\uC131 \uB370\uB2D8 \uBC14\uC9C0']);
assert.equal(koreanKeywordResult.pagination.next_cursor, 'page:2');
assert.equal(koreanKeywordResult.quality_meta.extracted_count, 10);
assert.equal(koreanKeywordResult.quality_meta.filtered_count, 4);
assert.equal(koreanKeywordResult.quality_meta.duplicate_count, 2);

const englishAliasResult = normalizeRawResult(SearchResultSchema.parse({
  site: 'joonggonara',
  keyword: 'iPhone 15',
  keyword_is_explicit: true,
  items: [
    { title: '아이폰 15 프로', price: 500000, url: 'https://fixture.invalid/iphone-15' },
    { title: '갤럭시  S24', price: 500000, url: 'https://fixture.invalid/galaxy-s24' }
  ]
}));
assert.deepEqual(englishAliasResult.items.map((item) => item.title), ['아이폰 15 프로']);
assert.equal(keywordMatchesText('iPhone 15', '아이폰15 프로'), true);

const trackingDuplicateResult = normalizeRawResult(SearchResultSchema.parse({
  site: 'bunjang',
  keyword: 'same product',
  items: [
    { title: 'same product', price: 30000, url: 'https://m.bunjang.co.kr/products/123?imp_id=first&content_position=0' },
    { title: 'same product', price: 30000, url: 'https://m.bunjang.co.kr/products/123?imp_id=second&content_position=4' }
  ]
}));
assert.equal(trackingDuplicateResult.items.length, 1);
assert.equal(trackingDuplicateResult.quality_meta.duplicate_count, 1);

assert.equal(classifyNoiseCandidate({
  title: 'RTX 3070 \uACE0\uC7A5 \uBD80\uD488\uC6A9',
  raw_notes: '',
  detail_excerpt: '',
  listing_type: 'part',
  components: [{ component_type: 'gpu', canonical_name: 'RTX 3070', confidence: 0.9 }],
  price_value: 100000,
  seller_upload_count: 0,
  item_status: 'active',
  sale_status: 'active',
  posted_at: '',
  upload_date: '',
  canonical_category_id: 'pc'
}), 'faulty_or_parts_only');

for (const invalidCursor of ['bogus', 'offset:2']) {
  assert.throws(
    () => validateWebSearchRequest({ keyword: 'RTX 3070', sites: ['bunjang'], cursor: encodeCursor({ version: 1, site_cursors: { bunjang: invalidCursor } }) }),
    (error) => error instanceof WebSearchValidationError
  );
}
assert.throws(
  () => validateWebSearchRequest({ keyword: 'RTX 3070', sites: ['ebay'], cursor: encodeCursor({ version: 1, site_cursors: { ebay: 'page:2' } }) }),
  (error) => error instanceof WebSearchValidationError
);

const searchOnlyRequest = validateSearchOnlyRequest({ source: 'hellomarket', keyword: 'RTX 3070' });
assert.equal(searchOnlyRequest.sourceKey, 'hellomarket');
assert.equal(listSearchOnlySourceCatalog().sources.length, 2);
assert.throws(
  () => validateSearchOnlyRequest({ source: 'ebay', keyword: 'RTX 3070' }),
  (error) => error instanceof SearchOnlyValidationError
);

console.log(JSON.stringify({
  status: 'passed',
  invalid_cases: invalidInputs.length,
  valid_category_request: true
}, null, 2));
