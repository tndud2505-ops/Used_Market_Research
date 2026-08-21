import assert from 'node:assert/strict';
import {
  CATEGORY_HARNESS,
  CATEGORY_SITE_KEYS,
  categoryCatalogForApi,
  createCategoryHarness,
  listCategoryNodes
} from '../dist/market/logic/category-catalog.js';
import { listSupportedSites } from '../dist/collector/logic/sites.js';
import { resolveBrowserSiteAdapter } from '../dist/collector/logic/sites/index.js';

const validation = CATEGORY_HARNESS.validate();
assert.equal(validation.ok, true, validation.errors.join('\n'));
assert.equal(validation.siteCount, CATEGORY_SITE_KEYS.length);
assert.equal(validation.categoryCount, listCategoryNodes().length - 1);
assert.deepEqual(
  CATEGORY_SITE_KEYS,
  listSupportedSites().map((site) => site.key),
  'every collection site must have a category harness registration'
);

const catalog = categoryCatalogForApi();
for (const siteKey of CATEGORY_SITE_KEYS) {
  assert.ok(catalog.site_plans[siteKey], `${siteKey} must expose site_plans`);
  assert.equal(Object.keys(catalog.site_plans[siteKey]).length, validation.categoryCount);
  const adapter = resolveBrowserSiteAdapter(siteKey);
  if (Object.keys(catalog.source_bindings[siteKey]).length > 0) {
    assert.equal(typeof adapter.categoryUrl, 'function', `${siteKey} has official mappings but no categoryUrl adapter`);
  }
}
assert.ok(catalog.site_plans.daangn.mobile);
assert.equal(catalog.site_plans.daangn.mobile.availability, 'unavailable');
assert.equal(catalog.site_plans.daangn.mobile.selectable, false);

const futureHarness = createCategoryHarness(
  [
    { id: 'all', label: '전체', description: '' },
    { id: 'fashion', label: '패션의류', description: '' },
    { id: 'fashion_men', label: '남성의류', description: '', parentId: 'fashion' },
    { id: 'mobile', label: '모바일/태블릿', description: '' }
  ],
  [{
    siteKey: 'future-market',
    bindings: {
      fashion: {
        sourceCategoryId: 'fashion-root',
        sourceCategoryPath: ['패션의류']
      }
    }
  }]
);

const futureValidation = futureHarness.validate();
assert.equal(futureValidation.ok, true, futureValidation.errors.join('\n'));
assert.equal(futureHarness.isCategorySelectableForSite('future-market', 'fashion'), true);
assert.equal(futureHarness.isCategorySelectableForSite('future-market', 'fashion_men'), false);
assert.equal(
  futureHarness.resolveCategoryCollectionPlan('future-market', 'fashion_men')?.binding?.confidence,
  'broader_source'
);
assert.equal(
  futureHarness.categoryPlansForApi()['future-market'].fashion_men.availability,
  'parent_fallback'
);
assert.equal(
  futureHarness.categoryPlansForApi()['future-market'].mobile.availability,
  'unavailable'
);

const invalidHarness = createCategoryHarness(
  [
    { id: 'all', label: '전체', description: '' },
    { id: 'fashion', label: '패션의류', description: '' }
  ],
  [{
    siteKey: 'broken-market',
    bindings: {
      unknown_category: {
        sourceCategoryId: '',
        sourceCategoryPath: []
      }
    }
  }]
);
const invalidValidation = invalidHarness.validate();
assert.equal(invalidValidation.ok, false);
assert.ok(invalidValidation.errors.some((error) => error.includes('unknown category')));
assert.ok(invalidValidation.errors.some((error) => error.includes('sourceCategoryId')));

console.log(JSON.stringify({
  status: 'passed',
  registered_sites: CATEGORY_SITE_KEYS,
  checked_category_count: validation.categoryCount,
  checked_plan_count: validation.planCount,
  future_site_registration: {
    official_parent: true,
    child_parent_fallback_is_gray: true,
    missing_category_is_gray: true,
    invalid_registration_is_rejected: true
  }
}, null, 2));
