import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../web-backend/public/index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../web-backend/public/styles.css', import.meta.url), 'utf8');

assert.doesNotMatch(html, /gbxsopvdEO|쿠팡 추천 새상품 보기|class="coupang-affiliate"/);
assert.match(html, /href="https:\/\/link\.coupang\.com\/a\/gbzRxu5ZU4"/);
assert.match(html, /rel="sponsored noopener"/);
assert.match(html, /referrerpolicy="unsafe-url"/);
assert.match(html, /ads-partners\.coupang\.com\/banners\/1017393\?trackingCode=AF1654530&amp;subId=/);
assert.match(html, /이 게시물은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다\./);
assert.ok(html.indexOf('class="coupang-banner"') > html.indexOf('id="recent-viewed-list"'));
assert.match(css, /\.coupang-banner/);
assert.doesNotMatch(css, /\.coupang-affiliate/);

console.log(JSON.stringify({ status: 'passed', affiliate_disclosure: true }, null, 2));
