import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/(\w):/, '$1:');
const casesPath = resolve(root, 'harness/cases.json');
const casesConfig = JSON.parse(await readFile(casesPath, 'utf8'));
const args = process.argv.slice(2);
const mode = valueOf('--mode') || casesConfig.default_mode || 'fixture';
const requestedCase = valueOf('--case');
const baseUrl = (process.env.HARNESS_BASE_URL || 'http://localhost:8787').replace(/\/$/, '');
const selectedCases = casesConfig.cases.filter((testCase) => {
  if (requestedCase && testCase.id !== requestedCase) return false;
  return !testCase.mode || testCase.mode === mode;
});

if (selectedCases.length === 0) {
  console.error(`No harness cases found for mode=${mode}${requestedCase ? ` case=${requestedCase}` : ''}`);
  process.exitCode = 2;
} else {
  const results = [];
  for (const testCase of selectedCases) {
    results.push(await runCase(testCase));
  }
  const report = buildReport(results);
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-') }__harness__${mode}`;
  const outputDir = resolve(root, 'merge/result/harness', runId);
  await mkdir(outputDir, { recursive: true });
  await writeFile(resolve(outputDir, 'output.json'), JSON.stringify(report, null, 2), 'utf8');
  await writeFile(resolve(outputDir, 'report.md'), toMarkdown(report), 'utf8');
  console.log(JSON.stringify({ ...report.summary, output_dir: outputDir }, null, 2));
  if (report.status !== 'passed') process.exitCode = 1;
}

async function runCase(testCase) {
  const startedAt = Date.now();
  try {
    const payload = testCase.mode === 'live'
      ? await fetchLive(testCase)
      : JSON.parse(await readFile(resolve(root, 'harness/fixtures', testCase.fixture), 'utf8'));
    const data = payload?.data || {};
    const metrics = evaluate(testCase, payload);
    return {
      id: testCase.id,
      name: testCase.name,
      mode: testCase.mode || mode,
      duration_ms: Date.now() - startedAt,
      status: Object.values(metrics).every((metric) => metric.passed) ? 'passed' : 'failed',
      metrics,
      item_count: Array.isArray(data.items) ? data.items.length : 0
    };
  } catch (error) {
    return {
      id: testCase.id,
      name: testCase.name,
      mode: testCase.mode || mode,
      duration_ms: Date.now() - startedAt,
      status: 'blocked',
      metrics: {},
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function fetchLive(testCase) {
  const response = await fetch(`${baseUrl}/api/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keyword: testCase.query, sites: testCase.sites, limit: testCase.limit || 8 })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

function evaluate(testCase, payload) {
  const data = payload?.data || {};
  const items = Array.isArray(data.items) ? data.items : [];
  const sources = Array.isArray(data.sources) ? data.sources : [];
  const titles = items.map((item) => String(item.title || '').toLowerCase());
  const forbidden = (testCase.must_exclude || []).map((word) => word.toLowerCase());
  const noiseItems = items.filter((item) => forbidden.some((word) => String(item.title || '').toLowerCase().includes(word)));
  const validItems = items.filter((item) => item.title && Number.isFinite(item.price) && item.url);
  const links = items.filter((item) => /^https?:\/\//.test(String(item.url || '')));
  const duplicateKeys = new Set();
  const duplicates = items.filter((item) => {
    const key = item.url || item.id || item.title;
    if (duplicateKeys.has(key)) return true;
    duplicateKeys.add(key);
    return false;
  });
  const requiredWords = (testCase.must_include || []).map((word) => word.toLowerCase());
  const relevant = titles.slice(0, 10).filter((title) => requiredWords.every((word) => title.includes(word))).length;
  const warningSources = sources.filter((source) => source.status === 'warning' || source.errors?.length);
  const transparency = warningSources.length === 0 || Boolean(data.quality?.warnings?.length) || warningSources.every((source) => source.errors?.length);
  const metrics = {
    result_valid_rate: ratio(validItems.length, items.length, items.length === 0 ? 0 : 1),
    link_integrity: ratio(links.length, items.length, items.length === 0 ? 0 : 1),
    hard_noise_leak_rate: ratio(noiseItems.length, items.length, 0),
    duplicate_rate: ratio(duplicates.length, items.length, 0),
    relevance_precision_at_10: ratio(relevant, Math.min(10, items.length), items.length === 0 ? 1 : 0),
    partial_failure_transparency: { value: transparency ? 1 : 0, passed: true }
  };
  if (Array.isArray(testCase.required_sites) && testCase.required_sites.length > 0) {
    const sourceByKey = new Map(sources.map((source) => [source.key, source]));
    const covered = testCase.required_sites.filter((site) => {
      const source = sourceByKey.get(site);
      const visibleCount = Number(source?.visible_count ?? source?.count ?? 0);
      const collectionState = source?.collection_state || (source?.status === 'warning' ? 'failed' : 'ready');
      return source && (visibleCount > 0 || collectionState === 'filtered_empty') && collectionState !== 'failed';
    }).length;
    metrics.site_search_coverage = ratio(covered, testCase.required_sites.length, 0);
    const visibleCovered = testCase.required_sites.filter((site) => {
      const source = sourceByKey.get(site);
      return source && Number(source.visible_count ?? source.count ?? 0) > 0;
    }).length;
    metrics.site_visible_result_coverage = ratio(visibleCovered, testCase.required_sites.length, 0);
    const transparent = testCase.required_sites.every((site) => {
      const source = sourceByKey.get(site);
      const visibleCount = Number(source?.visible_count ?? source?.count ?? 0);
      const collectionState = source?.collection_state || (source?.status === 'warning' ? 'failed' : 'ready');
      return source && visibleCount > 0
        ? true
        : ['filtered_empty', 'unsupported', 'failed', 'partial'].includes(collectionState);
    });
    metrics.site_state_transparency = { value: transparent ? 1 : 0, passed: true };
  }
  if (testCase.require_price_history) {
    const history = data.price_history;
    const points = Array.isArray(history?.points) ? history.points : [];
    metrics.price_history_data_present = { value: points.length >= 2 ? 1 : 0, passed: true };
  }
  return metrics;
}

function ratio(numerator, denominator, emptyValue) {
  return { value: denominator > 0 ? Math.round((numerator / denominator) * 1000) / 1000 : emptyValue, passed: true };
}

function buildReport(results) {
  const thresholds = casesConfig.thresholds;
  for (const result of results) {
    for (const [key, metric] of Object.entries(result.metrics)) {
      const threshold = thresholds[key];
      if (threshold === undefined) continue;
      const value = metric.value;
      metric.passed = key === 'hard_noise_leak_rate' || key === 'duplicate_rate'
        ? value <= threshold
        : value >= threshold;
      metric.threshold = threshold;
    }
    if (result.status === 'passed' && Object.values(result.metrics).some((metric) => !metric.passed)) result.status = 'failed';
  }
  const passed = results.filter((result) => result.status === 'passed').length;
  const failed = results.filter((result) => result.status === 'failed').length;
  const blocked = results.filter((result) => result.status === 'blocked').length;
  return {
    run_id: `${new Date().toISOString()}__harness__${mode}`,
    mode,
    status: failed || blocked ? 'failed' : 'passed',
    summary: { total: results.length, passed, failed, blocked },
    results,
    improvement_proposals: results.filter((result) => result.status !== 'passed').map((result) => ({
      case_id: result.id,
      target: result.error ? 'runtime_or_adapter' : 'search_quality_rule',
      next_action: result.error || 'add fixture or rule-level regression assertion',
      promotion_status: 'needs_review'
    }))
  };
}

function toMarkdown(report) {
  const lines = [`# Search harness report`, ``, `- status: **${report.status}**`, `- mode: ${report.mode}`, `- passed: ${report.summary.passed}/${report.summary.total}`, ``];
  for (const result of report.results) {
    lines.push(`## ${result.id} — ${result.status}`, ``, `- duration: ${result.duration_ms}ms`, `- items: ${result.item_count}`);
    if (result.error) lines.push(`- error: ${result.error}`);
    for (const [key, metric] of Object.entries(result.metrics)) lines.push(`- ${key}: ${metric.value}${metric.threshold !== undefined ? ` (threshold ${metric.threshold})` : ''} ${metric.passed ? '✅' : '❌'}`);
    lines.push('');
  }
  return lines.join('\n');
}

function valueOf(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}
