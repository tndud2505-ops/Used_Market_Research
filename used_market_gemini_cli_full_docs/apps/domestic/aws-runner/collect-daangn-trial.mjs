import { readFile, writeFile, rename, mkdir, readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fetchDaangnSearch, daangnErrorDetails } from '../collector/logic/daangn-public-search.mjs';
import { classifyPcPartListing } from '../market/logic/pc-parts-classifier.mjs';
import { kstDay, inTrialWindow, trialTargets, categoryTrialTargets, trialRunOptions, reserveAttempt, lockIsHeld, resumeStoppedTrial, deferTransientTrial } from './daangn-trial-core.mjs';
import { DaangnTrialPublisher } from './publish-daangn-trial.mjs';

// Bounded operator trial: preserve raw evidence and publish searchable listings.
// This does not attest marketplace permission or enable the general scheduler.
const root = '/var/lib/used-market-runner/daangn-trial';
const lockRoot = '/run/used-market-daangn/kstock';
const scheduled = process.argv.includes('--scheduled');
const start = Date.now();
const day = kstDay(start);
const { dailyLimit, maxMinutes } = trialRunOptions(process.argv.slice(2), day);
const publisher = new DaangnTrialPublisher({ root });
let publicationError = null;
const deadline = start + maxMinutes * 60000;
let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { stopping = true; });
const log = data => console.log(JSON.stringify({ at: new Date().toISOString(), ...data }));
async function json(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
}
async function save(file, value) {
  await writeFile(`${file}.tmp`, JSON.stringify(value), { mode: 0o600, flush: true });
  await rename(`${file}.tmp`, file);
}
async function admission() {
  try {
    const mem = await readFile('/proc/meminfo', 'utf8');
    if (Number(mem.match(/^MemAvailable:\s+(\d+)/m)?.[1] || 0) * 1024 < 2.5 * 1024 ** 3) return 'HOST_MEMORY';
    const cg = '/sys/fs/cgroup/usedpick.slice';
    const [max, used] = await Promise.all(['memory.max', 'memory.current'].map(x => readFile(`${cg}/${x}`, 'utf8')));
    if (Number(max) - Number(used) < 384 * 1024 ** 2) return 'USED_MEMORY';
    const locks = await readFile('/proc/locks', 'utf8');
    const stats = await Promise.all(['linux_morning_pipeline.lock', 'partitioned_heavy_work.lock']
      .map(x => stat(path.join(lockRoot, x), { bigint: true })));
    if (lockIsHeld(locks, stats)) return 'KSTOCK_BUSY';
    const response = await fetch('http://127.0.0.1:8787/health', { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return 'RUNNER_UNHEALTHY';
    const health = await response.json();
    if (!health.pc_parts || typeof health.pc_parts.scheduler_active !== 'boolean'
      || typeof health.pc_parts.publication_active !== 'boolean') return 'UNKNOWN_RUNNER_STATE';
    if (health.maintenance || health.draining || health.pc_parts.publication_active || health.pc_parts.scheduler_active) return 'USED_BUSY';
    // Existing backup maintenance uses a separate cgroup. Do not overlap its compression/checks.
    try {
      const procs = await readFile('/sys/fs/cgroup/usedpick.slice/used-market-backup-storage.service/cgroup.procs', 'utf8');
      if (procs.trim()) return 'STORAGE_BUSY';
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
    return null;
  } catch { return 'ADMISSION_UNAVAILABLE'; }
}

async function publishSavedDay(targetDay = day) {
  const names = await readdir(path.join(root, targetDay));
  const receipt = await json(path.join(root, targetDay, 'publication.json'), { files: {} });
  if ((receipt.day !== undefined && receipt.day !== targetDay) || !receipt.files
    || typeof receipt.files !== 'object' || Array.isArray(receipt.files)) throw Error('INVALID_DAANGN_PUBLICATION_RECEIPT');
  let pending = false;
  for (const name of names.filter(name => /^\d{3}\.json$/u.test(name) && !receipt.files?.[name])) {
    if ((await json(path.join(root, targetDay, name), null))?.status === 'OK') { pending = true; break; }
  }
  if (!pending) { publicationError = null; return; }
  let reason;
  while (!stopping && Date.now() < deadline && (reason = await admission())) {
    log({ event: 'publication_deferred', reason });
    await sleep(15000);
  }
  if (stopping || Date.now() >= deadline) throw Error('DAANGN_PUBLICATION_DEFERRED');
  const result = await publisher.publishDay(targetDay);
  log({ event: 'listings_published', day: targetDay, ...result });
  publicationError = null;
}

async function publishPendingDays() {
  // A restart across midnight must also recover yesterday's saved observations.
  for (const entry of (await readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/u.test(entry.name) || entry.name > day
      || Date.parse(`${entry.name}T00:00:00+09:00`) + 31 * 86400000 < start) continue;
    const receipt = await json(path.join(root, entry.name, 'publication.json'), { files: {} });
    const names = await readdir(path.join(root, entry.name));
    if (names.some(name => /^\d{3}\.json$/u.test(name) && !receipt.files?.[name])) await publishSavedDay(entry.name);
  }
}

if (process.argv.includes('--check-admission')) {
  log({ event: 'admission', reason: await admission() });
} else if (process.argv.includes('--publish-only')) {
  try { await publishPendingDays(); }
  finally { publisher.close(); }
} else if (scheduled && !inTrialWindow()) {
  log({ event: 'skipped', reason: 'OUTSIDE_0200_2300_KST' });
} else {
  await mkdir(path.join(root, day), { recursive: true, mode: 0o700 });
  const statePath = path.join(root, 'state.json');
  let state = await json(statePath, { day, attempted: 0, cursor: 0 });
  const resumeDay = process.argv.find(arg => arg.startsWith('--resume-stopped-day='))?.split('=')[1];
  if (resumeDay) {
    if (scheduled || resumeDay !== day) throw Error('EXPLICIT_SAME_DAY_RECOVERY_REQUIRED');
    const record = await json(path.join(root, day, `${String(state.attempted).padStart(3, '0')}.json`), null);
    const resumed = resumeStoppedTrial(state, day, record,
      { canonicalSearchMigration: process.argv.includes('--canonical-search-migration') });
    await writeFile(path.join(root, day, `recovery-before-${state.attempted}.json`),
      JSON.stringify({ state, summary: await json(path.join(root, day, 'summary.json'), null), at: new Date().toISOString() }),
      { flag: 'wx', mode: 0o600, flush: true });
    state = resumed;
    await save(statePath, state);
    log({ event: 'operator_recovery', day, attempted: state.attempted, query: record.target.query });
  }
  if (state.day === day && (state.attempted >= dailyLimit || state.stopped_day === day)) {
    try { await publishPendingDays(); }
    finally { publisher.close(); }
    // Keep the actual collection receipt; a timer no-op must not replace its duration/results.
    log({ event: 'skipped', day, attempted: state.attempted,
      reason: state.stopped_day === day ? 'PREVIOUS_FAILURE' : 'DAILY_LIMIT' });
    process.exit(0);
  }
  // Preserve the first completed receipt when the operator extends today's budget.
  const previousSummaryPath = path.join(root, day, 'summary.json');
  const previousSummary = await json(previousSummaryPath, null);
  if (previousSummary?.status === 'COMPLETE' && previousSummary.attempted < dailyLimit) {
    const archivedPath = path.join(root, day, `summary-${previousSummary.attempted}.json`);
    try { await writeFile(archivedPath, await readFile(previousSummaryPath), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  const targets = trialTargets();
  const coverageTargets = categoryTrialTargets();
  try { await publishPendingDays(); }
  catch (error) { publicationError = String(error.message).slice(0, 300); log({ event: 'publication_failed', error: publicationError }); }
  let stopReason = state.stopped_day === day ? 'PREVIOUS_FAILURE' : 'DAILY_LIMIT', previousWait = null;
  log({ event: 'started', day, scheduled, models: targets.length, daily_limit: dailyLimit,
    category_queries: coverageTargets.map(target => ({ category: target.category, query: target.query })) });
  while (!stopping && Date.now() < deadline && kstDay() === day) {
    if (scheduled && !inTrialWindow()) { stopReason = 'WINDOW_ENDED'; break; }
    const retryAt = state.day === day ? Date.parse(state.retry_after || '') : NaN;
    if (retryAt > Date.now()) {
      if (retryAt >= deadline) { stopReason = 'TRANSIENT_DEFERRED'; break; }
      await sleep(Math.min(15000, retryAt - Date.now()));
      continue;
    }
    const next = reserveAttempt(state, day, targets, { dailyLimit, coverageTargets });
    if (!next) break;
    const deferred = await admission();
    if (deferred) {
      if (deferred !== previousWait) log({ event: 'deferred', reason: deferred, attempted: state.day === day ? state.attempted : 0 });
      previousWait = deferred;
      await sleep(15000);
      continue;
    }
    previousWait = null;
    state = next.state;
    // Reserve before network I/O. A killed process cannot exceed the daily request ceiling on restart.
    await save(statePath, state);
    const requestedAt = Date.now();
    const attempt = { attempt: state.attempted, requested_at: new Date(requestedAt).toISOString(), target: next.target };
    try {
      const result = await fetchDaangnSearch(next.target.query, {});
      result.items = result.items.map(item => ({ ...item, classification: classifyPcPartListing(item) }));
      await save(path.join(root, day, `${String(state.attempted).padStart(3, '0')}.json`),
        { ...attempt, status: 'OK', ...result });
      for (const key of ['pending_target', 'retry_after', 'retry_failures']) delete state[key];
      await save(statePath, state);
      try {
        if (!await admission()) await publisher.publishFile(day, `${String(state.attempted).padStart(3, '0')}.json`);
      } catch (error) {
        publicationError = String(error.message).slice(0, 300);
        log({ event: 'publication_failed', attempted: state.attempted, error: publicationError });
      }
      log({ event: 'collected', attempted: state.attempted, query: next.target.query,
        candidates: result.items.length, with_region: result.items.filter(x => x.location).length,
        elapsed_ms: Date.now() - requestedAt, rss: process.memoryUsage().rss });
    } catch (e) {
      const details = daangnErrorDetails(e);
      await save(path.join(root, day, `${String(state.attempted).padStart(3, '0')}.json`),
        { ...attempt, status: 'FAILED', error: details.message, error_details: details });
      let deferred = false;
      if (details.retryable) {
        const retry = deferTransientTrial(state, next.target);
        state = retry.state; deferred = retry.deferred;
        stopReason = 'TRANSIENT_DEFERRED';
      } else {
        stopReason = 'REQUEST_FAILED';
        state.stopped_day = day;
      }
      await save(statePath, state);
      log({ event: 'request_failed', attempted: state.attempted, error: details.message,
        error_details: details, retry_after: state.retry_after || null });
      if (!details.retryable || deferred) break;
    }
    await sleep(Math.max(0, 15000 - (Date.now() - requestedAt)));
  }
  if (stopping) stopReason = 'SIGNAL';
  else if (Date.now() >= deadline) stopReason = 'TIME_LIMIT';
  try { await publishSavedDay(); }
  catch (error) { publicationError = String(error.message).slice(0, 300); log({ event: 'publication_failed', error: publicationError }); }
  finally { publisher.close(); }
  const unique = new Map(); let succeeded = 0, failed = 0, observations = 0;
  for (const name of await readdir(path.join(root, day))) {
    if (!/^\d{3}\.json$/.test(name)) continue;
    const record = await json(path.join(root, day, name));
    if (record.status !== 'OK') { failed++; continue; }
    succeeded++;
    for (const item of record.items) { observations++; unique.set(item.id || item.url, item); }
  }
  const kinds = {};
  for (const item of unique.values()) {
    const kind = item.classification?.listing_kind || 'UNKNOWN';
    kinds[kind] = (kinds[kind] || 0) + 1;
  }
  const terminalFailure = state.stopped_day === day;
  const todayAttempted = state.day === day ? state.attempted : 0;
  if (!terminalFailure && todayAttempted >= dailyLimit) stopReason = 'DAILY_LIMIT';
  const missingReceipts = Math.max(0, todayAttempted - succeeded - failed);
  const summary = { day, status: terminalFailure ? 'STOPPED' : todayAttempted >= dailyLimit && succeeded > 0 && !missingReceipts ? 'COMPLETE' : 'PARTIAL', stop_reason: stopReason,
    daily_limit: dailyLimit,
    attempted: todayAttempted, succeeded, failed, missing_receipts: missingReceipts, observations,
    unique_candidates: unique.size, candidates_with_region: [...unique.values()].filter(x => x.location).length,
    listing_kinds: kinds,
    finished_at: new Date().toISOString(), elapsed_ms: Date.now() - start, rss: process.memoryUsage().rss,
    scope: 'CLASSIFIED_TRIAL_CANDIDATES_WITH_LISTING_PUBLICATION', publication_error: publicationError, scheduled };
  await save(path.join(root, day, 'summary.json'), summary);
  log({ event: 'finished', ...summary });
  // Raw observations retain at least 30 days; compact receipts remain. No other storage paths are touched.
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(entry.name)
      || Date.parse(`${entry.name}T00:00:00+09:00`) + 31 * 86400000 >= Date.now()) continue;
    for (const name of await readdir(path.join(root, entry.name))) {
      if (/^\d{3}\.json$/.test(name)) await unlink(path.join(root, entry.name, name));
    }
  }
  if (terminalFailure || publicationError) process.exitCode = 1;
}
