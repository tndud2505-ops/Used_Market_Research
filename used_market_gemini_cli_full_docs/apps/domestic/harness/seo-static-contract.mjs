import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const publicRoot = new URL('../web-backend/public/', import.meta.url);
const readPublic = (name) => readFile(new URL(name, publicRoot), 'utf8');

const index = await readPublic('index.html');
const app = await readPublic('app.js');
const sitemap = await readPublic('sitemap.xml');

assert.match(index, /<title>중고매물 통합검색 \| USED MARKET<\/title>/u);
assert.match(index, /중고매물 통합검색/u);
assert.match(index, /중고나라·번개장터·헬로마켓·리씽크몰의 중고매물/u);
assert.match(index, /used-market-integration\.html/u);
assert.match(index, /iphone-used-items\.html/u);
assert.match(index, /used-market-categories\.html/u);
assert.match(app, /new URLSearchParams\(window\.location\.search\)/u);
assert.match(app, /presetKeyword/u);

const landingPages = [
  {
    file: 'used-market-integration.html',
    canonical: 'https://used-pick.com/used-market-integration.html',
    phrase: '중고나라 번개장터 통합검색'
  },
  {
    file: 'iphone-used-items.html',
    canonical: 'https://used-pick.com/iphone-used-items.html',
    phrase: '아이폰 중고매물'
  },
  {
    file: 'used-market-categories.html',
    canonical: 'https://used-pick.com/used-market-categories.html',
    phrase: '중고매물 카테고리'
  }
];

for (const page of landingPages) {
  const html = await readPublic(page.file);
  assert.match(html, new RegExp(`<link rel="canonical" href="${page.canonical.replaceAll('.', '\\.')}"`, 'u'));
  assert.match(html, new RegExp(page.phrase, 'u'));
  assert.match(html, /href="\/?\?keyword=/u);
  assert.match(sitemap, new RegExp(`<loc>${page.canonical.replaceAll('.', '\\.')}</loc>`, 'u'));
}

console.log(JSON.stringify({ status: 'passed', landing_pages: landingPages.length }, null, 2));
