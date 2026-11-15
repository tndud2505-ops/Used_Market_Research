// One operator-run acceptance flow for desktop, mobile web and the installed Android TWA.
// Candidate mode serves only checked-out static bytes; all price evidence remains public GETs.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from 'playwright';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const origin = 'https://used-pick.com';
const packageId = 'com.usedpick.app';
const models = ['motherboard:asus:rog-crosshair-viii-impact', 'psu:seasonic:watts-bucket:501-650'];
const args = process.argv.slice(2);
const flags = new Set(['--run', '--candidate']);
const values = new Set(['--origin', '--out', '--android-serial', '--adb-server-port', '--android-cdp-port', '--adb']);
const options = {};
for (let i = 0; i < args.length; i++) {
  const key = args[i];
  assert.ok(flags.has(key) || values.has(key), `Unknown argument: ${key}`);
  assert.equal(Object.hasOwn(options, key), false, `Repeated argument: ${key}`);
  if (flags.has(key)) options[key] = true;
  else { assert.ok(args[i + 1] && !args[i + 1].startsWith('--'), `${key} requires a value`); options[key] = args[++i]; }
}
if (!options['--run']) {
  console.log('Operator opt-in: npm run test:release-ui -- [--candidate] --android-serial SERIAL --adb-server-port PORT --android-cdp-port PORT [--adb PATH] [--out PATH]');
  process.exit(0);
}
assert.equal(options['--origin'] || origin, origin, 'Only the approved HTTPS application origin is allowed');
const candidate = Boolean(options['--candidate']);
const serial = options['--android-serial'] || process.env.USED_PICK_ANDROID_SERIAL;
assert.ok(serial && /^[A-Za-z0-9_.:-]+$/.test(serial), 'Explicit --android-serial / USED_PICK_ANDROID_SERIAL required');
function port(flag, variable) {
  const value = options[flag] || process.env[variable];
  assert.ok(value && /^\d+$/.test(value) && Number(value) > 1023 && Number(value) <= 65535, `Explicit ${flag} / ${variable} required (1024..65535)`);
  return Number(value);
}
const adbPort = port('--adb-server-port', 'USED_PICK_ADB_SERVER_PORT');
const cdpPort = port('--android-cdp-port', 'USED_PICK_ANDROID_CDP_PORT');
assert.notEqual(adbPort, cdpPort, 'ADB server and CDP forwarding ports must differ');
const adbName = process.platform === 'win32' ? 'adb.exe' : 'adb';
const sdkRoots = [process.env.ANDROID_SDK_ROOT, process.env.ANDROID_HOME,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk'), path.join(os.homedir(), 'Android', 'Sdk'), path.join(os.homedir(), 'Library', 'Android', 'sdk')].filter(Boolean);
const explicitAdb = options['--adb'] || process.env.USED_PICK_ADB;
const adbPath = explicitAdb || sdkRoots.map(sdk => path.join(sdk, 'platform-tools', adbName)).find(existsSync);
assert.ok(adbPath && existsSync(adbPath), 'Provide --adb / USED_PICK_ADB or an installed Android SDK platform-tools/adb');
const manifest = JSON.parse(await fs.readFile(path.join(root, 'mobile/twa-manifest.json'), 'utf8'));
assert.equal(manifest.packageId, packageId); assert.equal(manifest.host, 'used-pick.com');
const publicRoot = await fs.realpath(path.join(root, 'web-backend/public'));
const out = path.resolve(options['--out'] || path.join(os.tmpdir(), `used-pick-analysis-${Date.now()}`));
await fs.mkdir(out, { recursive: true });
const report = { checked_at: new Date().toISOString(), mode: candidate ? 'candidate' : 'public', origin,
  status: 'running', scenarios: ['selected evidence and reload', 'available source radio round trip', 'comparison hide and restore'],
  app: null, surfaces: [], warnings: [] };
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2' };
const tracking = /https:\/\/(?:www\.googletagmanager\.com|(?:[\w-]+\.)?google-analytics\.com|static\.cloudflareinsights\.com|t1\.kakaocdn\.net\/kas\/)/;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, message, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const result = await check(); if (result) return result; await pause(100); }
  throw new Error(message);
}
async function adb(command, binary = false) {
  const result = await exec(adbPath, ['-P', String(adbPort), '-s', serial, ...command], {
    encoding: binary ? 'buffer' : 'utf8', timeout: 20000, maxBuffer: 16 * 1024 * 1024, windowsHide: true
  });
  return result.stdout;
}
function representative(metric, source) {
  if (!metric || metric.aggregate_incomplete || !(metric.sample_count > 0)) return false;
  if (source === 'danawa') return Number.isFinite(metric.min) && metric.min > 0;
  if (metric.sample_count < 3) return false;
  return (metric.sample_count < 5 ? [metric.median] : [metric.mean, metric.median, metric.average])
    .some(value => Number.isFinite(value) && value > 0 && (metric.min == null || value >= metric.min) && (metric.max == null || value <= metric.max));
}
function sourceEvidence(data, source) {
  const row = data?.by_source?.find(item => (item.source_id || item.id) === source);
  const daily = row?.daily || [];
  const ready = daily.some(day => representative(day.active, source));
  const sampled = daily.some(day => day.active?.sample_count > 0 && !day.active.aggregate_incomplete);
  return { source, expected: ready ? 'ready' : sampled ? 'insufficient' : 'unavailable',
    latest: daily.filter(day => day.active?.sample_count > 0).at(-1)?.date || null };
}
async function preparePage(page) {
  const session = await page.context().newCDPSession(page);
  await session.send('Network.enable');
  await session.send('Network.setBypassServiceWorker', { bypass: true });
  await session.send('Network.setCacheDisabled', { cacheDisabled: true });
  const blocked = new Set();
  const router = async route => {
    const request = route.request(), url = new URL(request.url());
    if (tracking.test(url.href) || (url.origin === origin && !['GET', 'HEAD'].includes(request.method()))) {
      blocked.add(request.url()); await route.abort('blockedbyclient'); return;
    }
    // Public mode never substitutes a static response. APIs are never mocked in either mode.
    if (!candidate || request.method() !== 'GET' || url.origin !== origin || /^\/api(?:\/|$)/.test(url.pathname)) return route.continue();
    const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    if (!mime[path.extname(pathname)]) return route.continue();
    const filename = path.resolve(publicRoot, `.${pathname}`);
    assert.ok(filename.startsWith(publicRoot + path.sep), 'Candidate path escapes the exact public root');
    try {
      const resolved = await fs.realpath(filename);
      assert.ok(resolved.startsWith(publicRoot + path.sep), 'Candidate symlink escapes the public root');
      const bytes = await fs.readFile(resolved);
      await route.fulfill({ status: 200, body: bytes, contentType: mime[path.extname(pathname)], headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await route.fulfill({ status: 404, body: 'Candidate static asset not found', contentType: 'text/plain' });
    }
  };
  await page.route('**/*', router);
  return { blocked, async cleanup() {
    await page.unroute('**/*', router);
    await session.send('Network.setBypassServiceWorker', { bypass: false });
    await session.send('Network.setCacheDisabled', { cacheDisabled: false });
    await session.detach();
  } };
}
function observe(page, blocked) {
  let model, records, pending, changed;
  const errors = [], network = [], consoleErrors = [];
  const identify = request => {
    const url = new URL(request.url());
    const match = url.origin === origin && url.pathname.match(/^\/api\/products\/(.+)\/price-stats$/);
    return match && decodeURIComponent(match[1]) === model && url.searchParams.get('view') === 'daily'
      && url.searchParams.get('days') === '60' ? url : null;
  };
  const request = req => { if (identify(req)) { pending.add(req); changed = Date.now(); } };
  const failed = req => { if (identify(req)) { pending.delete(req); network.push(`${req.url()}: ${req.failure()?.errorText}`); changed = Date.now(); } };
  const response = async res => {
    const req = res.request(), url = identify(req);
    if (!url) return;
    const requestModel = model;
    try {
      const payload = await res.json(), data = payload.data || payload;
      assert.equal(res.status(), 200, `${url.pathname}: HTTP ${res.status()}`);
      assert.notEqual(payload.status, 'error'); assert.equal(data.canonical_product_id, requestModel);
      assert.equal(data.view, 'daily'); assert.equal(data.methodology?.condition, 'USED_WORKING');
      const pool = url.searchParams.get('market_pool');
      assert.equal(data.methodology?.market_pool, pool);
      assert.equal(data.methodology?.currency, pool === 'OVERSEAS_USED' ? 'USD' : 'KRW');
      if (requestModel === model) records.set(pool, data);
    } catch (error) { if (requestModel === model) network.push(error.message); }
    finally { pending.delete(req); changed = Date.now(); }
  };
  const pageError = error => errors.push(error.message);
  const consoleError = message => {
    if (message.type() !== 'error' || blocked.has(message.location().url)) return;
    // Intentionally blocked analytics/resources are not application runtime exceptions.
    if (/Failed to load resource|net::ERR_BLOCKED_BY_CLIENT/.test(message.text())) return;
    consoleErrors.push(message.text());
  };
  page.on('request', request); page.on('requestfailed', failed); page.on('response', response);
  page.on('pageerror', pageError); page.on('console', consoleError);
  return {
    errors, network, consoleErrors,
    reset(id) { model = id; records = new Map(); pending = new Set(); changed = Date.now(); },
    async settled() {
      await until(async () => {
        assert.deepEqual(network, [], 'Public price requests must succeed');
        return records.has('KR_DOMESTIC_USED') && records.has('OVERSEAS_USED') && !pending.size && Date.now() - changed >= 300;
      }, 'Both domestic and overseas daily GETs must settle');
      await page.waitForFunction(id => {
        const chart = document.querySelector('#price-chart');
        return chart?.dataset.modelId === id && chart.getAttribute('aria-busy') === 'false'
          && !['loading', 'empty'].includes(chart.dataset.priceState)
          && !/확인 중|조회 실패/.test(document.querySelector('#analysis-prices')?.textContent || '');
      }, model, { timeout: 60000 });
      return { domestic: records.get('KR_DOMESTIC_USED'), overseas: records.get('OVERSEAS_USED') };
    },
    cleanup() { page.off('request', request); page.off('requestfailed', failed); page.off('response', response); page.off('pageerror', pageError); page.off('console', consoleError); }
  };
}
async function snapshot(page, expected, source) {
  await page.waitForFunction(value => document.querySelector('#price-chart')?.dataset.priceState === value, expected, { timeout: 15000 });
  const state = await page.evaluate(() => ({
    chart: document.querySelector('#price-chart')?.dataset.priceState,
    model: document.querySelector('#price-chart')?.dataset.modelId,
    svg: Boolean(document.querySelector('#price-chart svg')),
    chartText: document.querySelector('#price-chart')?.textContent?.trim().slice(0, 400),
    readout: document.querySelector('#analysis-prices')?.textContent?.trim().slice(0, 900),
    selected: [...document.querySelectorAll('#analysis-prices [data-price-source]:checked')].map(input => input.dataset.priceSource),
    overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
    blank: !document.querySelector('#analysis-workspace') || !document.querySelector('#analysis-model-select')?.textContent?.trim(),
    overlay: Boolean(document.querySelector('vite-error-overlay, nextjs-portal, #webpack-dev-server-client-overlay')),
    error: document.querySelector('#tools-status')?.dataset.error === 'true'
  }));
  assert.equal(new URL(page.url()).origin, origin); assert.equal(state.blank, false); assert.equal(state.overlay, false); assert.equal(state.error, false);
  if (source) assert.deepEqual(state.selected, [source], 'The explicit source radio must remain selected');
  assert.ok(state.readout, 'Actual site price readout must render');
  if (expected === 'ready') assert.equal(state.svg, true, 'Representative evidence requires the rendered chart');
  if (expected === 'insufficient') assert.match(state.chartText, /표본|대표가격|등록가/, 'Sparse evidence needs an insufficient-sample explanation');
  if (state.overflow > 2) report.warnings.push({ surface: page.url(), overflow_px: state.overflow });
  return state;
}
async function checkReadout(page, evidence) {
  const item = page.locator(`#analysis-prices [data-source="${evidence.source}"]`);
  const amount = await item.locator('.market-snapshot-amount').innerText();
  assert.doesNotMatch(amount, /조회 실패|확인 중/);
  if (evidence.expected !== 'unavailable') assert.match(amount, /\d/, 'Observed price evidence must reach the real readout');
  if (evidence.expected === 'insufficient') assert.match(await item.innerText(), /대표가격 아님|표본 부족|등록가 참고/);
}
function scenarioUrl(model, nonce = '') {
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.parse(`${to}T00:00:00Z`) - 59 * 86400000).toISOString().slice(0, 10);
  const url = new URL('/price-analysis.html', origin);
  url.search = new URLSearchParams({ model, from, to, sites: 'joonggonara' });
  if (nonce) url.searchParams.set('release_qa', nonce);
  return url.href;
}
async function runSurface(page, label, nativeScreenshot) {
  const surface = { name: label, models: [], runtime_errors: [], console_errors: [] };
  report.surfaces.push(surface);
  const prepared = await preparePage(page), observer = observe(page, prepared.blocked);
  let compared = false;
  try {
    for (const [index, model] of models.entries()) {
      observer.reset(model);
      const url = scenarioUrl(model);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      const evidence = await observer.settled();
      const jgn = sourceEvidence(evidence.domestic, 'joonggonara');
      await checkReadout(page, jgn);
      const result = { model, as_of: { domestic: evidence.domestic.as_of, overseas: evidence.overseas.as_of },
        selected_evidence: jgn, initial: await snapshot(page, jgn.expected, 'joonggonara') };
      surface.models.push(result);
      const before = new URL(page.url());
      observer.reset(model);
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
      const reloaded = await observer.settled();
      const reloadedJgn = sourceEvidence(reloaded.domestic, 'joonggonara');
      result.reload = await snapshot(page, reloadedJgn.expected, 'joonggonara');
      const after = new URL(page.url());
      for (const key of ['model', 'from', 'to', 'sites']) assert.equal(after.searchParams.get(key), before.searchParams.get(key), `Reload preserves ${key}`);
      await checkReadout(page, reloadedJgn);
      const sources = ['joonggonara', 'bunjang', 'danawa', 'ebay'].map(source => sourceEvidence(source === 'ebay' ? reloaded.overseas : reloaded.domestic, source));
      const available = sources.find(source => source.source === 'ebay' && source.expected === 'ready')
        || sources.find(source => source.source !== 'joonggonara' && source.expected === 'ready');
      if (available) {
        await page.locator(`#price-source-${available.source}`).check();
        result.radio = { source: available.source, state: await snapshot(page, 'ready', available.source) };
        await page.locator('#price-source-joonggonara').check();
        result.returned = await snapshot(page, reloadedJgn.expected, 'joonggonara');
      } else result.radio = { state: 'no alternate representative series in actual responses' };
      if (!compared && sources.some(source => source.expected === 'ready')) {
        await page.locator('[data-action="compare-sources"]').click();
        await page.locator('#analysis-prices input[type="checkbox"]').first().waitFor();
        const on = await snapshot(page, 'ready');
        const ids = await page.locator('#analysis-prices [data-price-source]').evaluateAll(inputs => inputs.map(input => input.dataset.priceSource));
        for (const id of ids) await page.locator(`#price-source-${id}`).setChecked(false);
        const off = await snapshot(page, 'hidden');
        const restore = sources.find(source => source.expected === 'ready').source;
        await page.locator(`#price-source-${restore}`).check();
        const restored = await snapshot(page, 'ready', restore);
        result.comparison = { on: on.chart, off: off.chart, restored: restored.chart, restored_source: restore };
        await page.locator('[data-action="compare-sources"]').click();
        await page.locator('#price-source-joonggonara').check();
        await snapshot(page, reloadedJgn.expected, 'joonggonara');
        compared = true;
      }
      result.screenshot = path.join(out, `${label}-${index + 1}.png`);
      await page.screenshot({ path: result.screenshot, fullPage: false });
      if (nativeScreenshot) {
        result.native_screenshot = path.join(out, `${label}-${index + 1}-native.png`);
        await nativeScreenshot(result.native_screenshot);
      }
      assert.deepEqual(observer.errors, [], 'No application runtime errors');
      assert.deepEqual(observer.consoleErrors, [], 'No application console exceptions');
    }
    if (!compared) report.warnings.push({ surface: label, message: 'No actual representative series available for comparison hide/restore' });
  } finally {
    surface.runtime_errors = [...observer.errors]; surface.console_errors = [...observer.consoleErrors];
    observer.cleanup(); await prepared.cleanup();
  }
}
async function forwarding() {
  return String(await adb(['forward', '--list'])).trim().split(/\r?\n/).filter(Boolean).map(line => line.trim().split(/\s+/));
}
async function nativeIdentity() {
  const dump = String(await adb(['shell', 'dumpsys', 'activity', 'activities']));
  const tasks = dump.split(/(?=^\s*\* Task\{)/m);
  const task = tasks.find(block => /com\.usedpick\.app\/(?:\.LauncherActivity|com\.usedpick\.app\.LauncherActivity)/.test(block)
    && /com\.android\.chrome\/[^\s}]*CustomTabActivity/.test(block));
  assert.ok(task, 'The native USED PICK task must contain its LauncherActivity and Chrome CustomTabActivity');
  return { task_id: task.match(/\bTask\{[^\n]*?#(\d+)/)?.[1] || null,
    host_activity: task.match(/com\.android\.chrome\/[^\s}]*CustomTabActivity/)?.[0] };
}
let desktopBrowser, androidBrowser, appPage, createdForward = false, previousAppUrl;
try {
  assert.equal(String(await adb(['get-state'])).trim(), 'device', 'Exact Android serial must already be connected');
  assert.match(String(await adb(['shell', 'pm', 'path', packageId])), /^package:/m, 'Actual USED PICK app must already be installed');
  const installed = String(await adb(['shell', 'dumpsys', 'package', packageId]));
  const versionCode = Number(installed.match(/\bversionCode=(\d+)/)?.[1]);
  const versionName = installed.match(/\bversionName=([^\s]+)/)?.[1];
  assert.equal(versionCode, manifest.appVersionCode, 'Installed Android version code must match twa-manifest.json');
  assert.equal(versionName, manifest.appVersion, 'Installed Android version name must match twa-manifest.json');
  const mappings = await forwarding();
  const existing = mappings.filter(row => row[1] === `tcp:${cdpPort}`);
  assert.ok(existing.length <= 1 && existing.every(row => row[0] === serial && row[2] === 'localabstract:chrome_devtools_remote'), 'Refusing a foreign CDP forwarding mapping');
  if (!existing.length) { await adb(['forward', '--no-rebind', `tcp:${cdpPort}`, 'localabstract:chrome_devtools_remote']); createdForward = true; }
  // Connect to the existing Chrome socket; never create an emulator or launch a browser substitute.
  androidBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`, { timeout: 30000 });
  const previousPages = new Map(androidBrowser.contexts().flatMap(context => context.pages()).map(page => [page, page.url()]));
  const nonce = randomUUID(), launchUrl = scenarioUrl(models[0], nonce);
  const launched = String(await adb(['shell', 'am', 'start', '-W', '-n', `${packageId}/.LauncherActivity`, '-a', 'android.intent.action.VIEW', '-d', `'${launchUrl}'`]));
  assert.doesNotMatch(launched, /Error:|Exception|unable to resolve/i, 'Exact LauncherActivity must start');
  appPage = await until(() => androidBrowser.contexts().flatMap(context => context.pages()).find(page => {
    try { const url = new URL(page.url()); return url.origin === origin && url.searchParams.get('release_qa') === nonce; } catch { return false; }
  }), 'Cannot identify the exact app-launched TWA tab; other tabs will not be used');
  previousAppUrl = previousPages.get(appPage);
  report.app = { package_id: packageId, serial, adb_server_port: adbPort, cdp_port: cdpPort, version_code: versionCode, version_name: versionName,
    forwarding: createdForward ? 'owned by harness' : 'preexisting identical mapping preserved', ...await nativeIdentity() };
  const browserPath = process.env.USED_PICK_CHROME || [
    'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ].find(existsSync);
  desktopBrowser = await chromium.launch({ headless: true, ...(browserPath ? { executablePath: browserPath } : {}) });
  for (const [label, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }]]) {
    const context = await desktopBrowser.newContext({ viewport, locale: 'ko-KR', serviceWorkers: 'block' });
    try { await runSurface(await context.newPage(), label); } finally { await context.close(); }
  }
  await runSurface(appPage, 'android', async filename => fs.writeFile(filename, await adb(['exec-out', 'screencap', '-p'], true)));
  Object.assign(report.app, await nativeIdentity());
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = error.stack || error.message; process.exitCode = 1;
} finally {
  const cleanupErrors = [];
  const cleanup = async action => { try { await action(); } catch (error) { cleanupErrors.push(error.message); } };
  if (appPage && !appPage.isClosed()) await cleanup(() => previousAppUrl ? appPage.goto(previousAppUrl, { waitUntil: 'domcontentloaded' }) : appPage.close());
  // Browser.close on a connectOverCDP connection disconnects that client; never close the Android default context or send Browser.close via CDP.
  if (androidBrowser) await cleanup(() => androidBrowser.close());
  if (desktopBrowser) await cleanup(() => desktopBrowser.close());
  if (createdForward) await cleanup(async () => {
    const current = (await forwarding()).find(row => row[1] === `tcp:${cdpPort}`);
    assert.ok(!current || current[0] === serial && current[2] === 'localabstract:chrome_devtools_remote', 'Forward ownership changed; foreign mapping retained');
    if (current) await adb(['forward', '--remove', `tcp:${cdpPort}`]);
  });
  if (cleanupErrors.length) { report.cleanup_errors = cleanupErrors; report.status = 'failed'; process.exitCode = 1; }
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, report_file: path.join(out, 'report.json') }, null, 2));
}
