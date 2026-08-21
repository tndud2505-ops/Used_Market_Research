import assert from 'node:assert/strict';
import { categoryCatalogForApi, getSourceCategoryBinding, resolveCategory, resolveCategoryCollectionPlan } from '../dist/market/logic/category-catalog.js';
import { filterKeywordCategoryItems, filterKnownCategoryItems, mergeCategoryPageResults } from '../dist/collector/logic/browserCollector.js';
import { joonggonaraAdapter } from '../dist/collector/logic/sites/joonggonara.js';
import { bunjangAdapter } from '../dist/collector/logic/sites/bunjang.js';
import { daangnAdapter } from '../dist/collector/logic/sites/daangn.js';
import { normalizeRawResult } from '../dist/collector/logic/normalize-raw.js';
import { buildSearchPagination, filterBunjangCategoryKeywordItems } from '../dist/collector/logic/publicSearchExtractors.js';

const browserCollector = await import('../dist/collector/logic/browserCollector.js');
const daangnEmptyResultHtml = '<script>window.__remixContext = {"state":{"loaderData":{"routes/kr.buy-sell._index":{"allPage":{"fleamarketArticles":[]}}}}};</script>';
assert.equal(browserCollector.hasExplicitEmptySearchEvidence(daangnAdapter, daangnEmptyResultHtml), true);
assert.equal(browserCollector.hasExplicitEmptySearchEvidence(daangnAdapter, '<html><body>search page</body></html>'), false);
assert.equal(browserCollector.hasExplicitEmptySearchEvidence(daangnAdapter, '<html><head><script>window.__remixContext = {"loaderData":{"items":[{"id":"1"}]}}</script></head><body>daangn.com</body></html>'), false);
const exactCategoryResult = filterKnownCategoryItems(
  {
    site: 'bunjang', keyword: '여성 바지', category: resolveCategory('fashion_women_bottoms'),
    items: [{ title: 'Blue item', price: 30000, url: 'https://fixture.invalid/denim' }],
    warnings: [], errors: [], quality_meta: { extracted_count: 1, filtered_count: 0, duplicate_count: 0, warning_count: 0 }
  },
  { site: 'bunjang', keyword: '여성 바지', category: resolveCategory('fashion_women_bottoms'), limit: 4 },
  { strategy: 'source_category', resolvedCategoryId: 'fashion_women_bottoms' }
);
assert.equal(exactCategoryResult.items.length, 1);

const oneCharacterKeywordResult = normalizeRawResult({
  site: 'bunjang', keyword: '옷', category: null,
  items: [
    { title: '옷 판매', price: 10000, seller: '', location: '', posted_at: '', url: 'https://fixture.invalid/clothes', notes: '', listing_type_hint: 'unknown', warnings: [] },
    { title: 'RTX 5070 그래픽카드', price: 600000, seller: '', location: '', posted_at: '', url: 'https://fixture.invalid/gpu', notes: '', listing_type_hint: 'unknown', warnings: [] }
  ],
  warnings: [], errors: [],
  quality_meta: { extracted_count: 2, filtered_count: 0, duplicate_count: 0, warning_count: 0 }
});
assert.deepEqual(oneCharacterKeywordResult.items.map((item) => item.title), ['옷 판매']);

const fashion = resolveCategory('fashion');
assert.equal(fashion?.label, '패션의류');
assert.deepEqual(resolveCategory('fashion_men')?.path, ['패션의류', '남성의류']);
assert.equal(getSourceCategoryBinding('joonggonara', 'fashion')?.sourceCategoryId, '2');
assert.equal(getSourceCategoryBinding('bunjang', 'fashion_men')?.sourceCategoryId, '320');
assert.deepEqual(getSourceCategoryBinding('bunjang', 'fashion')?.sourceCategoryIds, ['310', '320']);
assert.equal(getSourceCategoryBinding('bunjang', 'fashion')?.collectionMode, 'aggregate');
assert.equal(getSourceCategoryBinding('bunjang', 'fashion')?.confidence, 'aggregate_exact');
assert.deepEqual(getSourceCategoryBinding('bunjang', 'fashion_goods')?.sourceCategoryIds, ['405', '430', '421', '422', '400']);
assert.deepEqual(getSourceCategoryBinding('bunjang', 'mobile')?.sourceCategoryIds, ['600700', '600710', '600720']);
assert.deepEqual(getSourceCategoryBinding('bunjang', 'pc')?.sourceCategoryIds, ['600100', '600200']);
assert.equal(getSourceCategoryBinding('joonggonara', 'fashion_women_bottoms')?.sourceCategoryId, '1026');
assert.equal(getSourceCategoryBinding('joonggonara', 'fashion_men_bottoms')?.sourceCategoryId, '1035');
assert.deepEqual(getSourceCategoryBinding('joonggonara', 'fashion_women_tops')?.sourceCategoryIds, ['1023', '1024', '1025']);
assert.deepEqual(getSourceCategoryBinding('joonggonara', 'fashion_men_outer')?.sourceCategoryIds, ['1030', '1031']);
assert.equal(joonggonaraAdapter.categoryUrl?.('2', 18), 'https://web.joongna.com/search?category=2');
assert.equal(joonggonaraAdapter.categoryUrl?.('111', 18, 'page:2'), 'https://web.joongna.com/search?category=111&page=2');
assert.equal(joonggonaraAdapter.searchPagination, 'page');
assert.equal(new URL(joonggonaraAdapter.searchUrl('RTX 3070', 18, 'page:2')).searchParams.get('page'), '2');
assert.equal(bunjangAdapter.categoryUrl?.('700', 18), 'https://m.bunjang.co.kr/categories/700');
assert.equal(bunjangAdapter.categoryPagination, 'page');
assert.equal(new URL(bunjangAdapter.categoryUrl?.('310', 18, 'page:2')).searchParams.get('page'), '2');
assert.deepEqual(buildSearchPagination(joonggonaraAdapter, { site: 'joonggonara', keyword: 'fixture', limit: 4, cursor: null }, 4), { has_more: true, next_cursor: 'page:2' });
assert.deepEqual(buildSearchPagination(bunjangAdapter, { site: 'bunjang', keyword: 'fixture', limit: 4, cursor: null }, 4), { has_more: true, next_cursor: 'page:1' });
const bunjangCategoryKeywordFiltered = filterBunjangCategoryKeywordItems(
  { site: 'bunjang', keyword: 'RTX 3070', limit: 4, category: resolveCategory('mobile') },
  [
    { title: 'RTX 3070 그래픽카드', url: 'https://fixture.invalid/rtx', price: 500000 },
    { title: '다마고치 케이스', url: 'https://fixture.invalid/case', price: 7000 },
    { title: 'RTX 3060 그래픽카드', url: 'https://fixture.invalid/rtx3060', price: 300000 }
  ]
);
assert.deepEqual(bunjangCategoryKeywordFiltered.items.map((item) => item.url), ['https://fixture.invalid/rtx']);
assert.equal(bunjangCategoryKeywordFiltered.filteredCount, 2);
const bunjangFashionKeywordFiltered = filterBunjangCategoryKeywordItems(
  { site: 'bunjang', keyword: '남성 바지 데님', limit: 4, category: resolveCategory('fashion_men_bottoms') },
  [
    { title: '남성 바지 데님', url: 'https://fixture.invalid/men-pants', price: 50000 },
    { title: '남성 셔츠', url: 'https://fixture.invalid/men-shirt', price: 40000 },
    { title: '여성 바지', url: 'https://fixture.invalid/women-pants', price: 30000 }
  ]
);
assert.deepEqual(bunjangFashionKeywordFiltered.items.map((item) => item.url), ['https://fixture.invalid/men-pants']);

const catalog = categoryCatalogForApi();
assert.ok(catalog.categories.some((category) => category.id === 'fashion'));
assert.equal(catalog.source_bindings.joonggonara.fashion.sourceCategoryId, '2');
assert.deepEqual(catalog.source_bindings.bunjang.fashion.sourceCategoryIds, ['310', '320']);
assert.equal(catalog.source_bindings.bunjang.fashion_men.sourceCategoryId, '320');
assert.equal(catalog.site_plans.bunjang.fashion_women_bottoms.selectable, true);
assert.equal(catalog.site_plans.bunjang.fashion_women_bottoms.availability, 'official');
assert.equal(catalog.site_plans.bunjang.mobile.availability, 'official');
assert.equal(catalog.site_plans.bunjang.pc.availability, 'official');
assert.equal(catalog.site_plans.bunjang.fashion_goods.availability, 'official');
assert.equal(catalog.site_plans.joonggonara.fashion_women_bottoms.availability, 'official');
assert.equal(catalog.site_plans.joonggonara.fashion_women_tops.availability, 'official');
assert.equal(catalog.site_plans.joonggonara.fashion_men_jumpsuit.availability, 'parent_fallback');
assert.equal(catalog.site_plans.joonggonara.fashion_men_jumpsuit.selectable, false);
assert.equal(catalog.site_plans.daangn.fashion_women_bottoms.selectable, false);
assert.equal(catalog.site_plans.daangn.fashion_women_bottoms.availability, 'unavailable');

const nonRootCategories = catalog.categories.filter((category) => category.id !== 'all');
const categoryPlans = ['joonggonara', 'bunjang', 'daangn', 'ebay'].flatMap((siteKey) => (
  nonRootCategories.map((category) => ({
    siteKey,
    categoryId: category.id,
    plan: resolveCategoryCollectionPlan(siteKey, category.id)
  }))
));

const checks = {
  every_category_has_strategy: categoryPlans.every(({ plan }) => plan && ['source_category', 'keyword'].includes(plan.strategy)),
  joonggonara_women_bottoms_uses_official_leaf: resolveCategoryCollectionPlan('joonggonara', 'fashion_women_bottoms')?.resolvedCategoryId === 'fashion_women_bottoms',
  bunjang_mobile_uses_official_category: resolveCategoryCollectionPlan('bunjang', 'mobile')?.strategy === 'source_category',
  daangn_fashion_uses_keyword_fallback: resolveCategoryCollectionPlan('daangn', 'fashion')?.strategy === 'keyword',
  keyword_fallback_filters_cross_category: filterKeywordCategoryItems(
    {
      site: 'daangn',
      keyword: '모바일/태블릿',
      category: resolveCategory('mobile'),
      items: [
        { title: '아이폰 15', url: 'https://fixture.invalid/mobile', price: 500000, notes: '' },
        { title: '소파', url: 'https://fixture.invalid/furniture', price: 100000, notes: '' }
      ],
      warnings: [],
      quality_meta: { filtered_count: 0 }
    },
    { site: 'daangn', keyword: '모바일/태블릿', category: resolveCategory('mobile'), limit: 2 },
    resolveCategoryCollectionPlan('daangn', 'mobile')
  ).items.length === 1
  ,
  keyword_fallback_keeps_luxury_goods: filterKeywordCategoryItems(
    {
      site: 'bunjang',
      keyword: '\uC218\uC785\uBA85\uD488',
      category: resolveCategory('luxury'),
      items: [
        { title: '\uC0E4\uB12C \uAC00\uBC29', url: 'https://fixture.invalid/luxury', price: 500000, notes: '' },
        { title: '\uC18C\uD30C', url: 'https://fixture.invalid/furniture', price: 100000, notes: '' }
      ],
      warnings: [],
      quality_meta: { filtered_count: 0 }
    },
    { site: 'bunjang', keyword: '\uC218\uC785\uBA85\uD488', category: resolveCategory('luxury'), limit: 2 },
    resolveCategoryCollectionPlan('bunjang', 'luxury')
  ).items.length === 1,
  keyword_fallback_keeps_free_share: filterKeywordCategoryItems(
    {
      site: 'bunjang',
      keyword: '\uBB34\uB8CC\uB098\uB214',
      category: resolveCategory('free_share'),
      items: [
        { title: '\uBB34\uB8CC\uB098\uB214 \uC758\uC790', url: 'https://fixture.invalid/free', price: 0, notes: '' },
        { title: '\uC18C\uD30C', url: 'https://fixture.invalid/furniture', price: 100000, notes: '' }
      ],
      warnings: [],
      quality_meta: { filtered_count: 0 }
    },
    { site: 'bunjang', keyword: '\uBB34\uB8CC\uB098\uB214', category: resolveCategory('free_share'), limit: 2 },
    resolveCategoryCollectionPlan('bunjang', 'free_share')
  ).items.length === 1
};
assert.ok(Object.values(checks).every(Boolean));

const mergedCategoryPages = mergeCategoryPageResults([
  {
    site: 'joonggonara', keyword: 'fixture', items: [], warnings: ['page one'], errors: [],
    quality_meta: { extracted_count: 4, filtered_count: 4, duplicate_count: 0, warning_count: 1 },
    pagination: { has_more: true, next_cursor: 'page:2' }
  },
  {
    site: 'joonggonara', keyword: 'fixture', items: [{ title: 'fixture pants', price: 10000, url: 'https://fixture.invalid/pants' }],
    warnings: [], errors: [], quality_meta: { extracted_count: 4, filtered_count: 3, duplicate_count: 0, warning_count: 0 },
    pagination: { has_more: true, next_cursor: 'page:3' }
  }
]);
assert.equal(mergedCategoryPages.items.length, 1);
assert.equal(mergedCategoryPages.quality_meta.extracted_count, 8);
assert.equal(mergedCategoryPages.quality_meta.filtered_count, 7);
assert.equal(mergedCategoryPages.pagination.next_cursor, 'page:3');

const womenBottomsPlan = resolveCategoryCollectionPlan('daangn', 'fashion_women_bottoms');
const womenBottomsFiltered = filterKeywordCategoryItems(
  {
    site: 'daangn',
    keyword: '여성 바지',
    category: resolveCategory('fashion_women_bottoms'),
    items: [
      { title: '여성 바지 데님 팬츠', url: 'https://fixture.invalid/women-bottoms', price: 50000, notes: '' },
      { title: '여성 상의 니트', url: 'https://fixture.invalid/women-tops', price: 40000, notes: '' },
      { title: '남성 바지 슬랙스', url: 'https://fixture.invalid/men-bottoms', price: 60000, notes: '' }
    ],
    warnings: [],
    quality_meta: { filtered_count: 0 }
  },
  { site: 'daangn', keyword: '여성 바지', category: resolveCategory('fashion_women_bottoms'), limit: 3 },
  womenBottomsPlan
);
assert.deepEqual(womenBottomsFiltered.items.map((item) => item.url), ['https://fixture.invalid/women-bottoms']);

const jumpsuitPlan = resolveCategoryCollectionPlan('joonggonara', 'fashion_men_jumpsuit');
const jumpsuitFiltered = filterKnownCategoryItems(
  {
    site: 'joonggonara', keyword: '남성 점프수트', category: resolveCategory('fashion_men_jumpsuit'),
    items: [
      { title: '남성 점프수트 올인원', url: 'https://fixture.invalid/jumpsuit', price: 50000 },
      { title: '남성 셔츠', url: 'https://fixture.invalid/shirt', price: 40000 }
    ],
    warnings: [], errors: [], quality_meta: { filtered_count: 0 }
  },
  { site: 'joonggonara', keyword: '남성 점프수트', category: resolveCategory('fashion_men_jumpsuit'), limit: 2 },
  jumpsuitPlan
);
assert.deepEqual(jumpsuitFiltered.items.map((item) => item.url), ['https://fixture.invalid/jumpsuit']);

console.log(JSON.stringify({
  status: 'passed',
  category_count: catalog.categories.length,
  verified: [
    'joonggonara category=2',
    'bunjang aggregate fashion IDs',
    'bunjang category URL contract',
    `category plans=${categoryPlans.length}`
  ],
  category_plan_contract: checks
}, null, 2));
