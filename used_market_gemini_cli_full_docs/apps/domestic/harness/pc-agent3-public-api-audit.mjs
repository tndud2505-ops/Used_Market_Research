// Read-only live audit: directory and stored price GETs only; never /api/search,
// marketplace URLs, admin routes, collection or database writes.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { inspectPriceStats, independentQuoteLine, independentQuoteTotals } from './lib/pc-independent-price-audit.mjs';

export async function runPublicPriceAudit(args = process.argv.slice(2)) {
  const arg = name => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };
  const phase = args.includes('--after') ? 'after' : 'before';
  const base = 'https://used-pick.com';
  const started = new Date().toISOString();
  const stamp = started.replace(/[:.]/gu, '-');
  const output = new URL(`../tmp/pc-agent3-public-${phase}-${stamp}/`, import.meta.url);
  await mkdir(output, { recursive: true });
  // These are the declared handoff contract, not a claim about deployed code.
  // A subsequent release must pass its explicit manifest; never infer it from
  // the very response being tested or silently force production back to v18.
  const manifest = arg('--manifest') ? JSON.parse(await readFile(arg('--manifest'), 'utf8')) : {
    expectation_source: '2026-09-17 role handoff', catalog: 'public-pc-5', public_count: 732,
    tools_count: 798, price_count: 788, browse_count: 10,
    versions: { normalization: 18, parser: 'pc-parser-v8', rule: 'pc-rules-v18', filter: 'pc-filter-v7' },
    allowedSources: ['bunjang', 'joonggonara', 'ebay'], publication_id: arg('--publication-id')
  };
  if (!manifest.catalog || !Number.isInteger(manifest.versions?.normalization)
    || ['parser', 'rule', 'filter'].some(key => !manifest.versions?.[key])) throw new Error('EXPLICIT_RELEASE_EXPECTATIONS_REQUIRED');
  const expected = { days: 30, marketPool: 'KR_C2C_USED', condition: 'USED_WORKING', currency: 'KRW',
    versions: manifest.versions, publicationId: manifest.publication_id || undefined, allowedSources: manifest.allowedSources };
  let stopped = null;
  const requests = [];
  async function get(route) {
    if (stopped) throw new Error(stopped);
    if (!/^\/api\/(?:pc\/(?:catalog|products)(?:\?|$)|products\/[^/]+\/price-stats\?)/u.test(route)) throw new Error('READ_ONLY_ROUTE_REQUIRED');
    const t = Date.now();
    const response = await fetch(base + route, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    const text = await response.text();
    let payload; try { payload = JSON.parse(text); } catch { payload = { error: 'NON_JSON_RESPONSE' }; }
    const headers = Object.fromEntries(['date', 'age', 'cf-cache-status', 'cache-control', 'cf-ray', 'x-search-data-source'].map(name => [name, response.headers.get(name)]));
    const result = { http: response.status, data: payload.data ?? payload, headers, elapsed_ms: Date.now() - t };
    requests.push({ route, http: result.http, headers, elapsed_ms: result.elapsed_ms, sha256: createHash('sha256').update(text).digest('hex') });
    if ([401, 403, 429].includes(response.status) || /captcha|challenge-platform/iu.test(text.slice(0, 1000))) {
      stopped = `ACCESS_BOUNDARY_STOP:${response.status}`;
      throw new Error(stopped);
    }
    return result;
  }
  const pathFor = (id, extras = {}) => `/api/products/${encodeURIComponent(id)}/price-stats?${new URLSearchParams({ days: '30', market_pool: 'KR_C2C_USED', condition: 'USED_WORKING', currency: 'KRW', ...extras })}`;
  const catalogResponse = await get('/api/pc/catalog');
  const catalog = catalogResponse.data;
  const products = catalog.tools_catalog?.products;
  if (catalogResponse.http !== 200 || !products?.length) throw new Error('PUBLIC_CATALOG_UNAVAILABLE');
  const rows = [], rawById = new Map();
  let next = 0;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (next < products.length && !stopped) {
      const product = products[next++], id = product.canonical_product_id;
      const browseOnly = product.category_code === 'MOTHERBOARD' && product.key_specs?.directory_node_type === 'BROWSE_FACET';
      try {
        const response = await get(pathFor(id));
        const audit = inspectPriceStats(response.data, { ...expected, productId: id, browseOnly });
        rawById.set(id, response.data);
        rows.push({ id, category: product.category_code, brand: product.brand, browse_only: browseOnly,
          http: response.http, headers: response.headers, ...audit, exclusions: response.data.exclusions,
          active: audit.metrics.active.sample_count, sold: audit.metrics.sold.sample_count,
          active_price: audit.exact_ready ? audit.metrics.active.value : null,
          sold_price: audit.exact_ready ? audit.metrics.sold.value : null,
          ...(response.http === 200 ? {} : { error: response.data.error || `HTTP_${response.http}` }) });
      } catch (error) { rows.push({ id, category: product.category_code, brand: product.brand, browse_only: browseOnly, http: null, error: error.message, problems: [error.message] }); }
      if (rows.length % 100 === 0) console.log(JSON.stringify({ phase: 'agent3_audit_progress', checked: rows.length, total: products.length }));
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }));
  rows.sort((a, b) => a.id.localeCompare(b.id));
  const searches = [];
  for (const q of ['G.Skill', 'gskill', 'G SKILL', 'G-SKILL', '지스킬']) {
    if (stopped) break;
    try { const response = await get(`/api/pc/products?category_code=RAM&q=${encodeURIComponent(q)}`);
      searches.push({ q, http: response.http, total: response.data.products?.total, ids: (response.data.products?.items || []).map(row => row.id || row.canonical_product_id).sort() });
    } catch (error) { searches.push({ q, error: error.message }); }
  }
  const selections = [
    ['CPU', 'cpu:intel:i5-12400f'], ['GPU', 'gpu:nvidia:rtx-3060-ti'], ['RAM', 'ram:g-skill:ddr4:16gb'],
    ['MOTHERBOARD', 'motherboard:msi:pro-b650m-p'], ['SSD', 'ssd:samsung:capacity-bucket:513-gb-1-tb'],
    ['HDD', 'hdd:western-digital:capacity-bucket:gt-2-tb-le-4-tb'], ['PSU', 'psu:seasonic:watts-bucket:751-850'],
    ['CASE', 'case:facet:mid-tower:fractal-design'], ['COOLING', 'cooling:facet:air-cpu:noctua']
  ];
  const quoteLines = selections.map(([category, id]) => ({ category, ...independentQuoteLine({ id,
    stats: rawById.get(id), quantity: category === 'RAM' ? 2 : 1, expected }) }));
  const quoteTotals = independentQuoteTotals(quoteLines);
  const probes = [];
  const yesterday = new Date(Date.parse(started) - 86400000).toISOString().slice(0, 10);
  for (const [label, id, extras] of [
    ['historical', selections[2][1], { as_of: yesterday }],
    ['currency-separation', selections[2][1], { market_pool: 'OVERSEAS_USED', currency: 'USD' }],
    ['normal-url-repeat', selections[2][1], {}]
  ]) {
    if (stopped) break;
    try {
      const response = await get(pathFor(id, extras));
      const audit = inspectPriceStats(response.data, { ...expected, productId: id,
        marketPool: extras.market_pool || expected.marketPool, currency: extras.currency || expected.currency,
        ...(extras.as_of ? { asOfDate: extras.as_of, publicationId: undefined } : {}) });
      const explicitHistoricalUnavailable = label === 'historical' && response.http === 503
        && JSON.stringify(response.data).includes('HISTORICAL_PRICE_STATS_UNAVAILABLE');
      const unchanged = label !== 'normal-url-repeat' || JSON.stringify([response.data.versions, response.data.publication_id, response.data.active, response.data.sold, response.data.traceability])
        === JSON.stringify([rawById.get(id)?.versions, rawById.get(id)?.publication_id, rawById.get(id)?.active, rawById.get(id)?.sold, rawById.get(id)?.traceability]);
      probes.push({ label, id, http: response.http, headers: response.headers, explicit_historical_unavailable: explicitHistoricalUnavailable,
        normal_url_consistent: unchanged, status: explicitHistoricalUnavailable || response.http === 200 && !audit.problems.length && unchanged ? 'PASS' : 'FAIL',
        cause: audit.cause, problems: explicitHistoricalUnavailable ? [] : audit.problems,
        publication_id: response.data.publication_id || null, as_of: response.data.as_of || null });
    } catch (error) { probes.push({ label, status: 'BLOCKED', error: error.message }); }
  }
  const catalogAfter = stopped ? null : (await get('/api/pc/catalog')).data;
  const gskillIds = products.filter(product => product.brand === 'G.Skill').map(product => product.canonical_product_id).sort();
  const failures = [
    ...(catalog.master_version === manifest.catalog ? [] : ['CATALOG_VERSION_MISMATCH']),
    ...(products.length === manifest.tools_count && catalog.public_catalog?.products?.length === manifest.public_count ? [] : ['CATALOG_COUNTS_MISMATCH']),
    ...(rows.length === products.length ? [] : ['CATALOG_AUDIT_NOT_FINISHED']),
    ...rows.flatMap(row => [...(row.http === 200 ? [] : [`HTTP:${row.id}:${row.http}`]), ...(row.problems || []).map(problem => `${row.id}:${problem}`)]),
    ...searches.filter(row => row.http !== 200 || row.total !== 27 || JSON.stringify(row.ids) !== JSON.stringify(gskillIds)).map(row => `GSKILL_SEARCH:${row.q}`),
    ...(searches.length === 5 ? [] : ['GSKILL_SEARCH_INCOMPLETE']),
    ...probes.filter(probe => probe.status !== 'PASS').map(probe => `PROBE:${probe.label}:${probe.status}`),
    ...(catalogAfter?.master_version === catalog.master_version ? [] : ['CATALOG_CHANGED_DURING_AUDIT'])
  ];
  const browseCount = products.filter(product => product.category_code === 'MOTHERBOARD' && product.key_specs?.directory_node_type === 'BROWSE_FACET').length;
  if (browseCount !== manifest.browse_count || products.length - browseCount !== manifest.price_count) failures.push('PRICE_AND_BROWSE_COUNTS_MISMATCH');
  const categories = Object.fromEntries([...new Set(products.map(product => product.category_code))].sort().map(category => {
    const subset = rows.filter(row => row.category === category);
    return [category, { catalog: subset.length, browse_only: subset.filter(row => row.browse_only).length,
      http_200: subset.filter(row => row.http === 200).length, exact_published: subset.filter(row => row.exact_ready).length,
      with_active_price: subset.filter(row => row.active_price != null).length, with_sold_price: subset.filter(row => row.sold_price != null).length,
      unpublished_empty_not_verified: subset.filter(row => row.cause === 'UNPUBLISHED_EMPTY_NOT_VERIFIED').length,
      failures: subset.filter(row => row.http !== 200 || row.problems?.length).length }];
  }));
  const gskill = rows.filter(row => gskillIds.includes(row.id)).map(row => ({ ...row,
    alias_membership: Object.fromEntries(searches.map(search => [search.q, search.ids?.includes(row.id) || false])),
    current_raw_collection_evidence: 'BLOCKED_SEPARATE_SQLITE_READ_REQUIRED',
    independent_unique_listing_recount: 'NOT_EXECUTED_PUBLIC_API_COUNTS_ONLY' }));
  const report = { phase, status: failures.length ? 'failed' : 'passed', validation_scope: 'public API contract; not UI or raw-ledger recount',
    actual_after_release: phase === 'after', expected_manifest: manifest, started_at: started, finished_at: new Date().toISOString(),
    production_mutations: false, app_aggregation_imports: 0, no_cache_bypass: true, stopped,
    master_version: catalog.master_version, public_count: catalog.public_catalog.products.length, tools_count: products.length,
    price_selection_count: products.length - browseCount, separate_browse_only_board_count: browseCount,
    release_failures: failures, categories, searches, gskill, probes, quote_lines: quoteLines, quote_totals: quoteTotals,
    quote_disclosure: 'Independent API arithmetic; intentionally not a compatibility recommendation; screen comparison belongs to agent 2',
    rows, requests };
  await writeFile(new URL('report.json', output), JSON.stringify(report, null, 2), { flag: 'wx' });
  await writeFile(new URL('public-api-responses.json', output), JSON.stringify(Object.fromEntries(rawById)), { flag: 'wx' });
  console.log(JSON.stringify({ phase, status: report.status, output: output.pathname, master_version: report.master_version,
    categories, failures: failures.length, first_failures: failures.slice(0, 15), probes, quote_totals: quoteTotals }, null, 2));
  if (failures.length) process.exitCode = 1;
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runPublicPriceAudit();
