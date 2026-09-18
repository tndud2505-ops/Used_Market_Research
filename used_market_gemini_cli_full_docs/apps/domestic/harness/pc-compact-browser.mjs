// Compact-UI successor to tmp/pc-live-v18-browser.mjs. Explicit opt-in only.
// Read the actual global skill before running. No API mocks or DOM/state writes.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const argument = name => { const index = process.argv.indexOf(name); return index < 0 ? '' : process.argv[index + 1] || ''; };
const origin = argument('--origin') || 'https://used-pick.com';
const out = fileURLToPath(new URL(`../tmp/pc-compact-browser-${new Date().toISOString().replace(/[:.]/g, '-')}/`, import.meta.url));
await fs.mkdir(out, { recursive: true });
const report = { checked_at: new Date().toISOString(), evidence: 'Candidate assets and public API; real browser only when explicitly launched',
  origin, browser_started: false, api: [], checks: [], browser_errors: [], failed_first_party_api: [], failed_external_assets: [], layout: [] };
report.full_operator_acceptance = false;
report.additional_acceptance_required = ['complete main-page filter/listing pagination/original-link/favorite matrix',
  'existing pre-release HTTP cache across deployment', 'actual browser storage quota/denial failure',
  'all analysis periods/manufacturers/empty dates and controlled failure-retry scenarios', 'print preview and live advertising at every target width'];
let browser = null, page = null;
const sha = value => createHash('sha256').update(value).digest('hex');
const money = value => `${Math.round(value).toLocaleString('ko-KR')}원`;
const lineMoney = value => `${value.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}원`;
// Independent expectation: deliberately does not call the application's price
// selector, aggregation or coherence code. A bad API metric fails this audit.
function independentPrice(metric) {
  assert.notEqual(metric?.aggregate_incomplete, true, 'unfinished exact publication is not a price');
  const n = Number(metric?.sample_count || 0);
  assert.ok(Number.isInteger(n) && n >= 0);
  if (n < 3) {
    assert.equal(metric?.mean ?? null, null); assert.equal(metric?.median ?? null, null); assert.equal(metric?.average ?? null, null);
    return null;
  }
  const price = n < 5 ? metric.median : metric.mean ?? metric.median ?? metric.average;
  assert.ok(typeof price === 'number' && Number.isFinite(price) && price > 0, `complete API representative required: n=${n}`);
  assert.ok(price >= metric.min && price <= metric.max);
  return price;
}
async function get(pathname) {
  const response = await fetch(origin + pathname, { signal: AbortSignal.timeout(30000), redirect: 'error', headers: { accept: 'application/json' } });
  const json = await response.json();
  assert.equal(response.status, 200, `${pathname}: ${response.status}`);
  assert.notEqual(json.status, 'error', pathname);
  return json.data ?? json;
}
try {
// The operator must read/apply the repository's actual global skill first.
// No automatic profile, credential, alternate tool or network fallback.
const skillIndex = process.argv.indexOf('--skill-file');
const skillPath = skillIndex >= 0 ? process.argv[skillIndex + 1] : '';
if (!process.argv.includes('--run') || !skillPath || skillPath.startsWith('--')) {
  const error = new Error('BROWSER_SKILL_REQUIRED: read the actual external-ai-orchestrator/SKILL.md, then supply --run --skill-file <actual-path>.');
  error.code = 'BROWSER_SKILL_REQUIRED'; throw error;
}
const skillText = await fs.readFile(skillPath, 'utf8');
assert.ok(skillText.trim(), 'the actual skill file must not be empty');
report.skill_sha256 = sha(skillText);
const parsedOrigin = new URL(origin);
assert.ok((['https://used-pick.com', 'https://www.used-pick.com'].includes(parsedOrigin.origin)
  || (parsedOrigin.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(parsedOrigin.hostname)))
  && parsedOrigin.href === parsedOrigin.origin + '/' && !parsedOrigin.username && !parsedOrigin.password, 'approved production or loopback origin only');
report.candidate_asset_version = 'compact-ui-v1';
report.assets = [];
// Ordinary URLs, no QA/cache-bypass query. Check exact assets before launching.
const assets = [
  ['index.html', '/'], ['computer-builder.html', '/computer-builder.html'], ['price-analysis.html', '/price-analysis.html'],
  ['guide.html', '/guide.html'], ['privacy.html', '/privacy.html'], ['terms.html', '/terms.html'], ['used-market-categories.html', '/categories'],
  ['app.js', '/app.js?v=compact-ui-v1'], ['pc-tools.js', '/pc-tools.js?v=compact-ui-v1'], ['ui-concept-a.css', '/ui-concept-a.css?v=compact-ui-v1'],
  ['pc-tools-data.mjs', '/pc-tools-data.mjs?v=parts-data-v5'], ['pc-tools-core.mjs', '/pc-tools-core.mjs?v=parts-ux-v4'],
  ['pc-tools-catalog.mjs', '/pc-tools-catalog.mjs?v=parts-ux-v4'], ['pc-tools.css', '/pc-tools.css?v=parts-ux-v4'], ['pc-tools-chart.mjs', '/pc-tools-chart.mjs?v=ui-a-v1']
];
for (const [name, route] of assets) {
  const response = await fetch(origin + route, { redirect: 'error', signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, 200, `${name}: HTTP`);
  const live = await response.text(), local = await fs.readFile(new URL(`../web-backend/public/${name}`, import.meta.url));
  report.assets.push({ name, route, live_sha256: sha(live), candidate_sha256: sha(local) });
  assert.equal(sha(live), sha(local), `${name}: candidate not deployed; no browser PASS`);
}
const catalog = await get('/api/pc/catalog');
assert.equal(catalog.master_version, 'public-pc-5');
const products = catalog.tools_catalog.products;
for (const q of ['G.Skill', 'gskill', 'G SKILL', 'G-SKILL', '지스킬']) {
  const data = await get(`/api/pc/products?category_code=RAM&q=${encodeURIComponent(q)}`);
  const count = products.filter(p => p.brand === 'G.Skill').length;
  assert.ok(count > 0); assert.equal(data.products.total, count, q); report.checks.push(`API search ${q}: ${count}`);
  assert.deepEqual(data.products.items.map(p=>p.id||p.canonical_product_id).sort(),
    products.filter(p=>p.brand==='G.Skill').map(p=>p.canonical_product_id).sort(), `${q}: exact registered ID set`);
}
const representative = [
  ['CPU', 'cpu:intel:i5-12400f'], ['GPU', 'gpu:nvidia:rtx-3060-ti'], ['RAM', 'ram:g-skill:ddr4:16gb'],
  ['MOTHERBOARD', 'motherboard:msi:pro-b650m-p'], ['SSD', 'ssd:samsung:capacity-bucket:513-gb-1-tb'],
  ['HDD', 'hdd:western-digital:capacity-bucket:gt-2-tb-le-4-tb'], ['PSU', 'psu:seasonic:watts-bucket:751-850'],
  ['CASE', 'case:facet:mid-tower:fractal-design'], ['COOLING', 'cooling:facet:air-cpu:noctua']
];
const statsById = new Map();
const corsair = products.find(p => p.canonical_display_name === 'Corsair DDR3 8GB Memory Module');
assert.ok(corsair, 'problem model must exist in the actual catalog');
const ids = [...new Set([...products.filter(p => p.brand === 'G.Skill').map(p => p.canonical_product_id), ...representative.map(([, id]) => id), corsair.canonical_product_id])];
for (const id of ids) {
  const data = await get(`/api/products/${encodeURIComponent(id)}/price-stats?days=30&market_pool=KR_C2C_USED&condition=USED_WORKING&currency=KRW`);
  assert.equal(data.canonical_product_id, id);
  assert.equal(data.versions.normalization, 18, `${id}: production normalization version`);
  assert.ok(data.publication_id, `${id}: exact publication required`);
  assert.equal(data.window.to, new Date().toISOString().slice(0, 10), `${id}: current means today's UTC window`);
  assert.equal(data.published_window?.from, data.window.from); assert.equal(data.published_window?.to, data.window.to);
  assert.equal(data.published_window?.days, 30); assert.equal(String(data.as_of).slice(0, 10), data.window.to);
  assert.equal(data.methodology.currency, 'KRW'); assert.equal(data.methodology.market_pool, 'KR_C2C_USED');
  assert.equal(data.methodology.condition, 'USED_WORKING'); assert.equal(data.methodology.days, 30);
  for (const source of data.by_source || []) {
    independentPrice(source.active); independentPrice(source.sold);
  }
  independentPrice(data.active); independentPrice(data.sold);
  statsById.set(id, data);
  report.api.push({ id, publication_id: data.publication_id || null, availability: data.availability ?? null,
    as_of: data.as_of, traceability:data.traceability, active: data.active, sold: data.sold,
    sources: data.by_source.map(s => ({ id: s.source_id, active: s.active.sample_count, sold: s.sold.sample_count })) });
}
const browserPath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const { chromium } = await import('playwright');
browser = await chromium.launch({ headless: true, ...(browserPath ? { executablePath: browserPath } : {}) });
report.browser_started = true;
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'ko-KR' });
  page = await context.newPage();
  const recordBrowserErrors = target => {
    target.on('pageerror', error => report.browser_errors.push(error.message));
    target.on('response', response => {
      if (response.url().startsWith(origin + '/api/') && response.status() >= 400) report.failed_first_party_api.push({ path: new URL(response.url()).pathname, status: response.status() });
      else if (response.status() >= 400 && !response.url().startsWith(origin + '/')) report.failed_external_assets.push({ host: new URL(response.url()).hostname, status: response.status() });
    });
  };
  recordBrowserErrors(page);
  const readyChart = async (expectedId = '') => {
    await page.waitForSelector('#tool-query');
    await page.waitForFunction(id => {
      const chart = document.querySelector('#price-chart');
      const selected = new URL(location.href).searchParams.get('model');
      return chart?.getAttribute('aria-busy') === 'false' && chart.dataset.modelId === (id || selected)
        && ['ready', 'error', 'unavailable'].includes(chart.dataset.priceState);
    }, expectedId, { timeout: 30000 });
    assert.equal(await page.locator('#price-chart').getAttribute('data-price-state'), 'ready',
      await page.locator('#chart-coverage').innerText());
  };
  for (const [category, id] of [...representative, ['problem RAM', corsair.canonical_product_id]]) {
    await page.goto(`${origin}/price-analysis.html?model=${encodeURIComponent(id)}`);
    await readyChart(id);
    assert.equal(await page.locator('#chart-title').innerText(), products.find(p => p.canonical_product_id === id).canonical_display_name);
    const value = independentPrice(statsById.get(id).active);
    if (value != null) assert.ok((await page.locator('#tools-summary').innerText()).includes(money(value)), `${category}: chart headline equals published price`);
    report.checks.push(`${category}: selected model, published summary and chart state`);
  }
  const ramId = 'ram:g-skill:ddr4:16gb';
  await page.goto(`${origin}/price-analysis.html?model=${encodeURIComponent(ramId)}`); await readyChart(ramId);
  await page.selectOption('#tool-manufacturer', 'Samsung');
  await page.selectOption('#tool-manufacturer', 'G.Skill');
  await page.selectOption('#tool-generation', 'DDR4'); await page.selectOption('#tool-capacity', '16');
  await page.fill('#tool-query', '지스킬'); await readyChart(ramId);
  await page.waitForFunction(() => document.querySelectorAll('#model-table tbody tr').length === 1);
  assert.ok((await page.locator('#chart-title').innerText()).includes('G.Skill DDR4 16GB'));
  await page.locator('[data-action="chart-source"][data-source="bunjang"]').click(); await readyChart();
  const source = statsById.get(ramId).by_source.find(s => s.source_id === 'bunjang');
  if (independentPrice(source?.active) != null) assert.ok((await page.locator('#tools-summary').innerText()).includes(money(independentPrice(source.active))));
  await page.locator('[data-action="chart-source"][data-source="ebay"]').click(); await readyChart();
  assert.equal(/\d[\d,.]*원/.test(await page.locator('#tools-summary').innerText()), false, 'eBay is never labelled KRW');
  await page.locator('[data-action="chart-source"][data-source=""]').click(); await readyChart();
  await page.screenshot({ path: path.join(out, 'analysis-desktop.png'), fullPage: true });
  await page.fill('#tool-query', '존재하지않는제품-qa-xyz');
  await page.waitForFunction(() => document.querySelector('#chart-coverage').textContent.includes('선택 조건에 맞는 모델이 없습니다'));
  assert.equal(await page.locator('#tools-summary').innerText(), '');
  await page.fill('#tool-query', 'gskill'); await readyChart(ramId);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(out, 'analysis-mobile.png'), fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  report.checks.push('Korean/English input; manufacturer changes chart; empty search clears old chart; site and currency separation; mobile chart');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${origin}/computer-builder.html`); await page.waitForSelector('#build-table tbody tr');
  await page.locator('[data-action="open-picker"]').click(); await page.waitForSelector('#tool-category');
  await page.selectOption('#tool-category', 'RAM'); await page.selectOption('#tool-generation', 'DDR4');
  await page.selectOption('#tool-capacity', '16'); await page.fill('#tool-query', '지스킬');
  const choose = page.locator(`[data-action="choose"][data-id="${ramId}"]`); await choose.waitFor(); await choose.click();
  const quantity = page.locator(`[data-quantity="${ramId}"]`);
  await quantity.fill('2'); await quantity.press('Tab');
  const ramPrice = independentPrice(statsById.get(ramId).active);
  if (ramPrice != null) await page.waitForFunction(text => document.querySelector('#tools-summary').textContent.includes(text), money(ramPrice * 2));
  else assert.ok((await page.locator('#tools-summary').innerText()).includes('0/2'), 'missing representative price is excluded, not a zero-won completed quote');
  const ramSold = independentPrice(statsById.get(ramId).sold);
  await page.locator(`#build-table .up-model-detail[data-id="${ramId}"]`).click();
  assert.ok((await page.locator('#build-detail-content').innerText()).includes('16GB × 2개 = 총 32GB'));
  if (ramSold != null) assert.ok((await page.locator(`[data-build-price="${ramId}"]`).innerText())
    .includes(`단가 ${lineMoney(ramSold)} × 2 ${Number(ramSold.toFixed(2)) === ramSold ? '=' : '≈'} ${lineMoney(ramSold * 2)}`), 'displayed unit × quantity agrees');
  await page.keyboard.press('Escape');
  await page.locator('[data-action="open-picker"]').click(); await page.locator('[data-action="reset-filters"]').click();
  for (const id of ['tool-manufacturer', 'tool-generation', 'tool-capacity', 'tool-query']) assert.equal(await page.locator(`#${id}`).inputValue(), '');
  assert.equal(await quantity.inputValue(), '2');
  await page.keyboard.press('Escape');
  report.checks.push('Filter reset clears only picker filters; RAM quantity and fractional-won line calculation preserved');
  await page.reload(); await quantity.waitFor(); assert.equal(await quantity.inputValue(), '2');
  for (const invalid of ['0', '-1', '1.5', '', '17']) {
    await quantity.fill(invalid); await quantity.press('Tab'); assert.equal(await quantity.inputValue(), '2', `reject ${JSON.stringify(invalid)}`);
  }
  await page.screenshot({ path: path.join(out, 'builder-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(out, 'builder-mobile.png'), fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.ok(await page.locator('#build-table').evaluate(el => el.scrollWidth > el.clientWidth && getComputedStyle(el).overflowX === 'auto'));
  await page.locator(`[data-action="remove"][data-id="${ramId}"]`).click();
  await page.reload(); await page.waitForSelector('#build-table tbody tr'); assert.equal(await quantity.count(), 0);
  report.checks.push('Production RAM unit price × 2; URL/reload restore; invalid quantity recovery; removal survives reload; readable mobile tables');
  // All nine component categories must feed the same real-data quote, not just
  // a RAM-only example. Deliberately mixed compatibility is not a recommendation.
  const build = representative.map(([category, id]) => ({ id, quantity: category === 'RAM' ? 2 : 1 }));
  const cohortKeys = build.map(entry => {
    const data = statsById.get(entry.id);
    assert.ok(data.publication_id, `${entry.id}: exact publication required for quote audit`);
    assert.equal(data.methodology.currency, 'KRW'); assert.equal(data.methodology.market_pool, 'KR_C2C_USED');
    assert.equal(data.methodology.condition, 'USED_WORKING'); assert.equal(data.methodology.days, 30);
    assert.equal(data.published_window.from, data.window.from); assert.equal(data.published_window.to, data.window.to);
    return JSON.stringify([data.publication_id, data.versions, data.as_of, data.window.from, data.window.to]);
  });
  assert.equal(new Set(cohortKeys).size, 1, 'all nine units share one publication, period, versions and as_of');
  const expected = Object.fromEntries(['active', 'sold'].map(key => {
    let amount = 0, covered = 0;
    for (const entry of build) {
      const value = independentPrice(statsById.get(entry.id)?.[key]);
      if (value != null) { amount += value * entry.quantity; covered += entry.quantity; }
    }
    return [key, { amount: covered ? amount : null, covered }];
  }));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${origin}/computer-builder.html`);
  await page.waitForSelector('#build-table');
  for (const [category, id] of representative) {
    await page.locator(`#build-table tr[data-category="${category}"] [data-action="category"]`).click();
    await page.locator('[data-action="reset-filters"]').click();
    await page.fill('#tool-query', products.find(product => product.canonical_product_id === id).canonical_display_name);
    await page.locator(`[data-action="choose"][data-id="${id}"]`).click();
    if (category === 'RAM') { await quantity.fill('2'); await quantity.press('Tab'); }
  }
  await page.locator('[data-action="save-build"]').click();
  assert.ok((await page.locator('#build-save-status').innerText()).includes('저장되었습니다'));
  await page.locator('[data-action="share-build"]').click();
  const generatedShareUrl = await page.locator('#share-output').inputValue();
  const shared = JSON.parse(new URLSearchParams(new URL(generatedShareUrl).hash.slice(1)).get('build'));
  assert.deepEqual(shared.map(({ id, quantity }) => ({ id, quantity })), build, 'share URL must come from actual selected controls');
  const beforeSummaryHash = new URL(page.url()).hash;
  await page.locator('[data-action="show-summary"]').click(); assert.equal(new URL(page.url()).hash, beforeSummaryHash);
  // A genuinely new context has no saved build; a same-document hash navigation
  // would not prove that the generated URL restores anything.
  await context.close();
  const shareContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'ko-KR' });
  page = await shareContext.newPage(); recordBrowserErrors(page);
  await page.goto(generatedShareUrl);
  await page.waitForFunction(() => document.querySelectorAll('#build-table [data-quantity]').length === 9, null, { timeout: 30000 });
  const renderedBuildCount = await page.locator('#build-table [data-quantity]').count();
  console.log(JSON.stringify({ phase: 'builder_loaded', expected: 9, rendered: renderedBuildCount,
    hash: await page.evaluate(() => location.hash), status: await page.locator('#tools-status').innerText(),
    table: await page.locator('#build-table').innerText() }));
  assert.equal(renderedBuildCount, 9, 'the shared nine-category build must load every line item');
  console.log(JSON.stringify({ phase: 'builder_totals', expected, rendered: await page.locator('#tools-summary').innerText() }));
  for (const [key, total] of [['active', expected.active]]) {
    await page.waitForFunction(({ total }) => {
      const price = document.querySelector('#tools-summary strong');
      return price?.parentElement.textContent.includes(`가격 확인 ${total.covered}/10개`)
        && price.textContent === (total.amount == null ? '' : `${Math.round(total.amount).toLocaleString('ko-KR')}원`);
    }, { key, total });
  }
  assert.equal(await page.locator('#tools-summary strong').count(), 1, 'only one total');
  for (const { id } of build) for (const key of ['active', 'sold']) {
    const unit = independentPrice(statsById.get(id)[key]);
    if (unit != null) assert.equal(await page.locator(`[data-unit-price="${id}"][data-series="${key}"]`).innerText(), lineMoney(unit));
  }
  assert.ok((await page.locator('#build-compatibility').innerText()).includes('충돌'),
    'mixed CPU/board and DDR examples must not be described as a compatible recommended build');
  report.full_build = { categories: 9, units: 10, expected, line_items:build.map(entry=>({ ...entry,
    site:'domestic_all',scope:statsById.get(entry.id).methodology,publication_id:statsById.get(entry.id).publication_id,
    window:statsById.get(entry.id).window,traceability:statsById.get(entry.id).traceability,
    active_unit:independentPrice(statsById.get(entry.id)?.active),sold_unit:independentPrice(statsById.get(entry.id)?.sold),
    active_line:independentPrice(statsById.get(entry.id)?.active)==null?null:independentPrice(statsById.get(entry.id).active)*entry.quantity,
    sold_line:independentPrice(statsById.get(entry.id)?.sold)==null?null:independentPrice(statsById.get(entry.id).sold)*entry.quantity })),
    actual_display:await page.locator('#tools-summary').innerText(), compatibility:await page.locator('#build-compatibility').innerText() };
  report.checks.push('All nine production component prices reach one quote; RAM counted twice; missing prices remain partial; compatibility conflict visible');
  await page.screenshot({ path: path.join(out, 'builder-all-parts-desktop.png'), fullPage: true });
  for (const width of [1440, 1024, 768, 390, 360, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: no page-level horizontal overflow`);
    const layout = await page.locator('#build-table').evaluate(el => ({ scroll: el.scrollWidth, client: el.clientWidth,
      overflow: getComputedStyle(el).overflowX, rows: [...el.querySelectorAll('tbody tr')].map(row => ({
        cells: row.children.length, height: row.getBoundingClientRect().height,
        centers: [...row.children].map(cell => { const box = cell.getBoundingClientRect(); return box.y + box.height / 2; }) })) }));
    assert.equal(layout.rows.length, 9);
    for (const row of layout.rows) { assert.equal(row.cells, 7); assert.ok(row.height >= 40 && row.height <= 48); assert.ok(Math.max(...row.centers) - Math.min(...row.centers) <= 1); }
    if (width <= 768) { assert.ok(layout.scroll > layout.client); assert.equal(layout.overflow, 'auto'); }
    report.layout.push({ width, ...layout });
    await page.screenshot({ path: path.join(out, `builder-${width}.png`), fullPage: true });
  }
  await page.goto(`${origin}/?category_code=RAM&model_id=${encodeURIComponent(ramId)}`);
  await page.waitForFunction(id => document.querySelector('#model-select')?.value === id, ramId);
  report.checks.push('Model-name link reaches the marketplace selection');
  assert.deepEqual(report.browser_errors, []);
  assert.deepEqual(report.failed_first_party_api, []);
  report.status = 'passed_implemented_core_checks';
} catch (error) {
  report.status = error.code === 'BROWSER_SKILL_REQUIRED' ? 'blocked_before_network_and_browser' : 'failed'; report.error = error.stack;
  if (page) await page.screenshot({ path: path.join(out, 'failure.png'), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser?.close(); await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, checked_models: report.api.length, checks: report.checks,
    browser_errors: report.browser_errors, failed_first_party_api: report.failed_first_party_api, report: path.join(out, 'report.json') }, null, 2));
}
