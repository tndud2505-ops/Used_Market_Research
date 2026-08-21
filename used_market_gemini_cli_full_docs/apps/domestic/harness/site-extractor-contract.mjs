import assert from 'node:assert/strict';
import { tryExtractPublicSearchResult } from '../dist/collector/logic/publicSearchExtractors.js';
import { joonggonaraAdapter } from '../dist/collector/logic/sites/joonggonara.js';
import { bunjangAdapter } from '../dist/collector/logic/sites/bunjang.js';
import { daangnAdapter } from '../dist/collector/logic/sites/daangn.js';

const previousFetch = globalThis.fetch;

try {
  const joonggonaraHtml = `<script type="application/json">{"items":[{"seq":101,"price":499000,"title":"RTX 3070 그래픽카드","state":0,"sortDate":"2026-08-12 09:00:00","mainLocationName":"서울","articleUrl":"/product/101","url":"https://img2.joongna.com/media/original/fixture.jpg","storeSeq":7}],"changedProductFilterType":false}</script>`;
  const joonggonaraResult = await tryExtractPublicSearchResult(
    joonggonaraAdapter,
      { site: 'joonggonara', keyword: 'RTX 3070', limit: 1 },
    joonggonaraHtml
  );
  assert.equal(joonggonaraResult?.items.length, 1);
  assert.equal(joonggonaraResult?.items[0].title, 'RTX 3070 그래픽카드');
  assert.equal(joonggonaraResult?.items[0].price, 499000);
  assert.equal(joonggonaraResult?.items[0].url, 'https://web.joongna.com/product/101');
  assert.equal(joonggonaraResult?.items[0].image_url, 'https://img2.joongna.com/media/original/fixture.jpg');
  assert.equal(joonggonaraResult?.items[0].has_photo, true);
  assert.equal(joonggonaraResult?.items[0].sale_status, 'active');
  assert.equal(joonggonaraResult?.pagination.next_cursor, 'page:2');

  let bunjangCategoryUrl = '';
  globalThis.fetch = async (url) => {
    bunjangCategoryUrl = String(url);
    return new Response(JSON.stringify({
      data: {
        responses: {
          mainGrid: {
            searchResponse: {
              data: Array.from({ length: 6 }, (_, index) => ({
                pid: 202 + index,
                name: index === 5 ? '최고가 삽니다 노트북 맥북' : `아이폰 15 프로 ${index + 1}`,
                price: 900000 + index,
                status: 'SELLING',
                productImage: 'https://media.bunjang.co.kr/product/202_1_w{res}.jpg',
                shop: { uid: 9 },
                updatedAt: '2026-08-12T09:00:00Z'
              })),
              totalCount: 61,
              nextCursor: 'bunjang-upstream-cursor-2'
            }
          }
        }
      }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const bunjangResult = await tryExtractPublicSearchResult(
    bunjangAdapter,
    {
      site: 'bunjang',
      keyword: '',
      limit: 2,
      cursor: null,
      sourceCategoryId: '600700',
      category: { id: 'mobile', label: '모바일/태블릿', path: ['모바일/태블릿'] }
    },
    ''
  );
  assert.ok(bunjangCategoryUrl.includes('categoryId=600700'));
  assert.ok(bunjangCategoryUrl.includes('policyKey=pw.product.category'));
  assert.equal(bunjangResult?.items.length, 2);
  assert.deepEqual(bunjangResult?.items.map((item) => item.title), ['아이폰 15 프로 1', '아이폰 15 프로 2']);
  assert.equal(bunjangResult?.items[0].status, 'active');
  assert.equal(bunjangResult?.items[0].has_photo, true);
  assert.ok(bunjangResult?.pagination.next_cursor?.startsWith('slice:v1:'));

  const bunjangSecondResult = await tryExtractPublicSearchResult(
    bunjangAdapter,
    {
      site: 'bunjang',
      keyword: '',
      limit: 2,
      cursor: bunjangResult?.pagination.next_cursor,
      sourceCategoryId: '600700',
      category: { id: 'mobile', label: '모바일/태블릿', path: ['모바일/태블릿'] }
    },
    ''
  );
  assert.deepEqual(bunjangSecondResult?.items.map((item) => item.title), ['아이폰 15 프로 3', '아이폰 15 프로 4']);
  assert.equal(bunjangSecondResult?.quality_meta.filtered_count, 1);

  const bunjangThirdResult = await tryExtractPublicSearchResult(
    bunjangAdapter,
    {
      site: 'bunjang',
      keyword: '',
      limit: 2,
      cursor: bunjangSecondResult?.pagination.next_cursor,
      sourceCategoryId: '600700',
      category: { id: 'mobile', label: '모바일/태블릿', path: ['모바일/태블릿'] }
    },
    ''
  );
  assert.deepEqual(bunjangThirdResult?.items.map((item) => item.title), ['아이폰 15 프로 5']);

  await tryExtractPublicSearchResult(
    bunjangAdapter,
    {
      site: 'bunjang',
      keyword: '',
      limit: 2,
      cursor: bunjangThirdResult?.pagination.next_cursor,
      sourceCategoryId: '600700',
      category: { id: 'mobile', label: '모바일/태블릿', path: ['모바일/태블릿'] }
    },
    ''
  );
  assert.ok(bunjangCategoryUrl.includes('cursor=bunjang-upstream-cursor-2'));

  globalThis.fetch = async () => new Response(JSON.stringify({
    result: 'success',
    list: [{
      pid: 'general-vacuum-1',
      name: '\uB2E4\uC774\uC2A8 \uBB34\uC120\uCCAD\uC18C\uAE30 V7',
      price: '180000',
      status: 'SELLING',
      product_image: 'https://media.bunjang.co.kr/product/vacuum.jpg',
      uid: 'seller-1'
    }]
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  const bunjangGeneralResult = await tryExtractPublicSearchResult(
    bunjangAdapter,
    { site: 'bunjang', keyword: '\uB2E4\uC774\uC2A8 \uCCAD\uC18C\uAE30', limit: 2 },
    ''
  );
  assert.equal(bunjangGeneralResult?.items.length, 1);
  assert.equal(bunjangGeneralResult?.items[0].title, '\uB2E4\uC774\uC2A8 \uBB34\uC120\uCCAD\uC18C\uAE30 V7');
  assert.equal(bunjangGeneralResult?.items[0].price, 180000);
  assert.equal(bunjangGeneralResult?.warnings.some((warning) => warning.includes('non-pc-')), false);

  const areaHtml = (area) => `<script type="application/ld+json">${JSON.stringify({
    itemListElement: [
      {
        position: 1,
        item: {
          name: `RTX 3070 ${area}`,
          description: '중고 그래픽카드',
          image: `https://dnvefa72aowie.cloudfront.net/origin/article/202608/${encodeURIComponent(area)}.jpg`,
          url: `https://www.daangn.com/articles/${encodeURIComponent(area)}`,
          offers: { price: '420000', priceCurrency: 'KRW', availability: 'https://schema.org/InStock', seller: { name: area } }
        }
      }
    ]
  })}</script>`;
  globalThis.fetch = async (url) => new Response(areaHtml(new URL(String(url)).searchParams.get('in') || 'area'), {
    status: 200,
    headers: { 'content-type': 'text/html' }
  });
  const daangnResult = await tryExtractPublicSearchResult(
    daangnAdapter,
    { site: 'daangn', keyword: 'RTX 3070', limit: 3 },
    '<html><body>search shell</body></html>'
  );
  assert.equal(daangnResult?.items.length, 3);
  assert.equal(daangnResult?.items.every((item) => item.title.includes('RTX 3070')), true);
  assert.equal(daangnResult?.items.every((item) => item.price === 420000), true);
  assert.equal(daangnResult?.items.every((item) => item.url.startsWith('https://www.daangn.com/articles/')), true);
  assert.equal(daangnResult?.items.every((item) => item.image_url.includes('cloudfront.net')), true);
  assert.equal(daangnResult?.items.every((item) => item.sale_status === 'active'), true);
  assert.equal(daangnResult?.items.every((item) => item.warnings.length === 0), true);
  assert.ok(daangnResult?.warnings.some((warning) => warning.includes('aggregated across')));
  assert.ok(daangnResult?.warnings.some((warning) => warning.startsWith('PAGINATION_UNAVAILABLE:')));

  globalThis.fetch = async (url) => {
    const area = new URL(String(url)).searchParams.get('in') || 'area';
    if (area === '수원시 우만동') return new Response('', { status: 503 });
    return new Response(areaHtml(area), { status: 200, headers: { 'content-type': 'text/html' } });
  };
  const partialDaangnResult = await tryExtractPublicSearchResult(
    daangnAdapter,
    { site: 'daangn', keyword: 'RTX 3070', limit: 3 },
    '<html><body>search shell</body></html>'
  );
  assert.equal(partialDaangnResult?.items.length, 3);
  assert.ok(partialDaangnResult?.warnings.some((warning) => warning.startsWith('DAANGN_PARTIAL_AREA_RESULTS:')));
} finally {
  globalThis.fetch = previousFetch;
}

console.log(JSON.stringify({
  status: 'passed',
  joonggonara_html_mapping: true,
  bunjang_category_api_mapping: true,
  daangn_ld_json_mapping: true
}, null, 2));
