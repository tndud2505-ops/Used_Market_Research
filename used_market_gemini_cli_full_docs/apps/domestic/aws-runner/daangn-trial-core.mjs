import { pcCollectionTargetSetV2, pcCatalogResponse } from '../cloudflare/pc-directory-http.mjs';

export const TRIAL_LIMIT = 100;
export const TRIAL_CATEGORIES = Object.freeze(pcCatalogResponse().categories.map(category => category.code));
export function trialRunOptions(args, day) {
  const requested = args.find(arg => arg.startsWith('--daily-limit='));
  if (!requested) return { dailyLimit: TRIAL_LIMIT, maxMinutes: 50 };
  const limit = Number(requested.split('=')[1]);
  if (limit !== 200 || args.includes('--scheduled') || !args.includes(`--trial-day=${day}`)) {
    throw Error('EXPLICIT_SAME_DAY_200_TRIAL_REQUIRED');
  }
  return { dailyLimit: limit, maxMinutes: 90 };
}

export function categoryTrialTargets(targets = pcCollectionTargetSetV2().targets) {
  return TRIAL_CATEGORIES.flatMap(category => {
    const candidates = targets.filter(target => target.enabled !== false && target.categoryCode === category
      && target.sourceKeys.includes('joonggonara'));
    const ordered = [...candidates.filter(target => target.cadenceClass === 'HOURLY_CATEGORY'),
      ...candidates.filter(target => target.cadenceClass === 'DAILY_MASTER')];
    const queries = new Set();
    return ordered.filter(target => { if (queries.has(target.queryText)) return false; queries.add(target.queryText); return true; })
      .slice(0, 2).map(target => ({ productId: target.canonicalProductId || null,
        category, query: target.queryText, queries: [target.queryText] }));
  });
}
export function kstDay(now = Date.now()) { return new Date(now + 9 * 3600000).toISOString().slice(0, 10); }
export function inTrialWindow(now = Date.now()) {
  const d = new Date(now + 9 * 3600000);
  return d.getUTCHours() >= 2 && d.getUTCHours() < 23;
}

// Every retry consumes a reserved request. Unknown/access/structure errors are
// never automatically resumed; only the operator may inspect a legacy fetch failure.
export function resumeStoppedTrial(state, day, record, { canonicalSearchMigration = false } = {}) {
  let canonicalRedirect = false;
  if (canonicalSearchMigration && record?.error === 'DAANGN_SEARCH_REDIRECT: Redirects are not allowed') {
    const response = record.error_details?.response;
    try {
      const url = new URL(response?.location, 'https://www.daangn.com');
      canonicalRedirect = [301, 308].includes(response.status) && url.origin === 'https://www.daangn.com'
        && url.pathname === '/kr/search/buy-sell/' && !url.hash && !url.username && !url.password
        && [...url.searchParams.keys()].length === 2 && url.searchParams.get('only_on_sale') === 'true'
        && url.searchParams.get('q') === record.target?.query;
    } catch { /* only the observed same-origin canonical migration is accepted */ }
  }
  if (state.day !== day || state.stopped_day !== day || record?.attempt !== state.attempted
    || record.status !== 'FAILED' || !record.target?.query
    || !(record.error_details?.retryable === true
      || (!record.error_details && record.error?.startsWith('DAANGN_SEARCH_FETCH_ERROR:')) || canonicalRedirect)) {
    throw Error('EXPLICIT_TRANSIENT_RECOVERY_ONLY');
  }
  const next = { ...state, pending_target: record.target, retry_failures: 0 };
  delete next.stopped_day;
  delete next.retry_after;
  return next;
}

export function deferTransientTrial(state, target, now = Date.now()) {
  const failures = (state.retry_failures || 0) + 1;
  const deferred = failures % 3 === 0;
  return { state: { ...state, pending_target: target, retry_failures: failures,
    retry_after: new Date(now + (deferred ? 4 * 3600000 : failures % 3 === 1 ? 60000 : 180000)).toISOString() }, deferred };
}

// One representative query per model per rotation. Preserve aliases for subsequent rotations.
export function trialTargets(targets = pcCollectionTargetSetV2().targets) {
  const models = new Map();
  for (const t of targets) {
    if (t.enabled === false || t.cadenceClass !== 'DAILY_MASTER'
      || !TRIAL_CATEGORIES.includes(t.categoryCode) || !t.sourceKeys.includes('joonggonara')) continue;
    const p = models.get(t.canonicalProductId) || { productId: t.canonicalProductId, category: t.categoryCode, queries: [] };
    if (!p.queries.includes(t.queryText)) p.queries.push(t.queryText);
    models.set(p.productId, p);
  }
  const groups = TRIAL_CATEGORIES.map(category => [...models.values()].filter(model => model.category === category));
  const ordered = [];
  for (let i = 0; i < Math.max(...groups.map(group => group.length)); i++) {
    for (const group of groups) if (group[i]) ordered.push(group[i]);
  }
  return ordered;
}

export function selectTrialQuery(targets, cursor) {
  if (!targets.length || !Number.isSafeInteger(cursor) || cursor < 0) throw Error('INVALID_TRIAL_CURSOR');
  const model = targets[cursor % targets.length];
  const rotation = Math.floor(cursor / targets.length);
  return { ...model, query: model.queries[rotation % model.queries.length] };
}

export function reserveAttempt(state, day, targets, { dailyLimit = TRIAL_LIMIT, coverageTargets = [] } = {}) {
  if (![100, 200].includes(dailyLimit)) throw Error('INVALID_DAANGN_DAILY_LIMIT');
  if (state.stopped_day === day) return null;
  const current = state.day === day ? state : { ...state, day, attempted: 0 };
  if (state.day !== day) {
    for (const key of ['pending_target', 'retry_after', 'retry_failures', 'stopped_day']) delete current[key];
  }
  if (!Number.isSafeInteger(current.attempted) || current.attempted < 0
    || !Number.isSafeInteger(current.cursor) || current.cursor < 0) throw Error('INVALID_TRIAL_STATE');
  if (current.attempted >= dailyLimit) return null;
  if (current.pending_target) {
    if (typeof current.pending_target.query !== 'string' || !current.pending_target.query.trim()) throw Error('INVALID_RETRY_TARGET');
    return { target: current.pending_target, state: { ...current, attempted: current.attempted + 1 } };
  }
  const coverageCursor = current.coverage_day === day ? current.coverage_cursor : 0;
  if (!Number.isSafeInteger(coverageCursor) || coverageCursor < 0) throw Error('INVALID_DAANGN_COVERAGE_CURSOR');
  const covering = coverageCursor < coverageTargets.length;
  const rotationCursor = current.rotation_cursor ?? current.cursor;
  if (!Number.isSafeInteger(rotationCursor) || rotationCursor < 0) throw Error('INVALID_TRIAL_ROTATION_CURSOR');
  return { target: covering ? coverageTargets[coverageCursor] : selectTrialQuery(targets, rotationCursor),
    state: { ...current, cursor: current.cursor + 1, attempted: current.attempted + 1,
      rotation_cursor: rotationCursor + (covering ? 0 : 1),
      ...(coverageTargets.length ? { coverage_day: day, coverage_cursor: coverageCursor + (covering ? 1 : 0) } : {}) } };
}

export function lockIsHeld(locksText, stats) {
  const keys = new Set(stats.map(s => {
    const d = BigInt(s.dev);
    const major = ((d >> 8n) & 0xfffn) | ((d >> 32n) & 0xfffff000n);
    const minor = (d & 0xffn) | ((d >> 12n) & 0xffffff00n);
    return `${major}:${minor}:${s.ino}`;
  }));
  return locksText.split('\n').some(line => {
    if (line.includes('->')) return false; // a waiter is not a holder
    const m = line.match(/\b([0-9a-f]+):([0-9a-f]+):(\d+)\b/i);
    return m && keys.has(`${parseInt(m[1], 16)}:${parseInt(m[2], 16)}:${m[3]}`);
  });
}
