export const SOURCE_POLICY_STATUSES = Object.freeze(["REVIEW_REQUIRED", "APPROVED", "DENIED"]);
export const SOURCE_RUNTIME_STATUSES = Object.freeze(["DISABLED", "ADAPTER_READY", "ENABLED", "QUARANTINED"]);

const OPERATOR_ATTESTED_GOVERNANCE_ORIGIN = "REGISTRY_OPERATOR_ATTESTATION";
const OPERATOR_ATTESTED_APPROVAL_BASIS = "OPERATOR_ATTESTED_DIRECT_PERMISSION";
const OPERATOR_ATTESTED_APPROVAL_SCOPE = "PC_PARTS_COLLECTION_AND_PUBLICATION";
const OPERATOR_ATTESTED_ACCESS_CONSTRAINTS = "PUBLIC_ROUTES_ONLY_NO_AUTH_OR_BLOCK_BYPASS";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const MAX_JITTER_SECONDS = 120;
const LIVE_CANARY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const FAILURE_BACKOFF_MS = Object.freeze([5 * 60 * 1000, 15 * 60 * 1000]);
const QUARANTINE_MS = 6 * 60 * 60 * 1000;

function source(config) {
  return Object.freeze({
    ...config,
    market_pools: Object.freeze([...(config.market_pools || [config.market_pool])]),
    cadence: Object.freeze({ ...config.cadence, kst_minutes: Object.freeze([...config.cadence.kst_minutes]) }),
    access: Object.freeze({ ...config.access })
  });
}

export const PC_SOURCE_REGISTRY = Object.freeze([
  source({
    key: "joonggonara",
    name: "중고나라",
    market_pool: "KR_C2C_USED",
    market_pools: ["KR_C2C_USED", "KR_DEALER_USED"],
    policy_status: "APPROVED",
    runtime_status: "ENABLED",
    public_search: true,
    public_search_order: 2,
    directory_source: true,
    directory_order: 2,
    policy_reviewed_at: "2026-08-31",
    policy_basis_url: "https://common.joongna.com/static/terms/TermsOfService_new.html?v=1741641972323",
    policy_note: "Service terms article 20 require prior consent. The USED-PICK operator attests that the source directly permitted PC-parts collection and publication; only normal public routes may be used.",
    approval_basis: "OPERATOR_ATTESTED_DIRECT_PERMISSION",
    approval_attested_at: "2026-08-31",
    approval_scope: "PC_PARTS_COLLECTION_AND_PUBLICATION",
    access_constraints: "PUBLIC_ROUTES_ONLY_NO_AUTH_OR_BLOCK_BYPASS",
    cadence: { timezone: "Asia/Seoul", kst_minutes: [4, 34], jitter_max_seconds: MAX_JITTER_SECONDS },
    access: { strategy: "html_next", adapter_kind: "existing_site_script", api_only_required: false }
  }),
  source({
    key: "bunjang",
    name: "번개장터",
    market_pool: "KR_C2C_USED",
    market_pools: ["KR_C2C_USED", "KR_DEALER_USED"],
    policy_status: "APPROVED",
    runtime_status: "ENABLED",
    public_search: true,
    public_search_order: 1,
    directory_source: true,
    directory_order: 3,
    policy_reviewed_at: "2026-08-31",
    policy_basis_url: "https://terms.bunjang.co.kr/terms/service.html",
    policy_note: "Service terms article 39 prohibit unapproved automation. The USED-PICK operator attests that the source directly permitted PC-parts collection and publication; only normal public routes may be used.",
    approval_basis: "OPERATOR_ATTESTED_DIRECT_PERMISSION",
    approval_attested_at: "2026-08-31",
    approval_scope: "PC_PARTS_COLLECTION_AND_PUBLICATION",
    access_constraints: "PUBLIC_ROUTES_ONLY_NO_AUTH_OR_BLOCK_BYPASS",
    partner_application_url: "https://sell-global.bunjang.co.kr/",
    partner_api_docs_url: "https://api.bgzt.guide/",
    partner_catalog_full_schedule: "03:30 Asia/Seoul",
    partner_catalog_segment_schedule: "hourly at minute 10",
    cadence: { timezone: "Asia/Seoul", kst_minutes: [11], jitter_max_seconds: MAX_JITTER_SECONDS },
    access: { strategy: "public_site_json", adapter_kind: "existing_site_script", api_only_required: false }
  }),
  source({
    key: "daangn",
    name: "당근",
    market_pool: "KR_C2C_USED",
    market_pools: ["KR_C2C_USED", "KR_DEALER_USED"],
    policy_status: "DENIED",
    runtime_status: "ADAPTER_READY",
    public_search: false,
    directory_source: false,
    policy_reviewed_at: "2026-08-31",
    policy_basis_url: "https://www.daangn.com/robots.txt",
    policy_note: "The public marketplace search path /kr/buy-sell/s/ is disallowed; live collection requires an approved feed or written permission.",
    cadence: { timezone: "Asia/Seoul", kst_minutes: [15], jitter_max_seconds: MAX_JITTER_SECONDS },
    access: { strategy: "site_script", adapter_kind: "existing_site_script", api_only_required: false }
  }),
  source({
    key: "danawa",
    name: "다나와 장터",
    market_pool: "KR_C2C_USED",
    market_pools: ["KR_C2C_USED", "KR_DEALER_USED"],
    policy_status: "APPROVED",
    runtime_status: "ENABLED",
    public_search: false,
    directory_source: true,
    directory_order: 1,
    policy_reviewed_at: "2026-08-31",
    policy_basis_url: "https://www.danawa.com/info/provision.html",
    policy_note: "Service terms article 24 require prior consent for commercial reuse. The USED-PICK operator attests scoped permission for PC-parts collection and publication; only normal public routes may be used.",
    approval_basis: "OPERATOR_ATTESTED_DIRECT_PERMISSION",
    approval_attested_at: "2026-08-31",
    approval_scope: "PC_PARTS_COLLECTION_AND_PUBLICATION",
    access_constraints: "PUBLIC_ROUTES_ONLY_NO_AUTH_OR_BLOCK_BYPASS",
    cadence: { timezone: "Asia/Seoul", kst_minutes: [19, 49], jitter_max_seconds: MAX_JITTER_SECONDS },
    access: { strategy: "site_category_json", adapter_kind: "specialist_site_script", api_only_required: false }
  }),
  source({
    key: "hellomarket",
    name: "헬로마켓",
    market_pool: "KR_C2C_USED",
    market_pools: ["KR_C2C_USED", "KR_DEALER_USED"],
    policy_status: "APPROVED",
    runtime_status: "ENABLED",
    public_search: false,
    public_search_order: 3,
    directory_source: true,
    directory_order: 4,
    policy_reviewed_at: "2026-08-31",
    policy_basis_url: "https://hellomarket.com/terms.hm",
    policy_note: "Terms article 22(4) requires prior consent for commercial use. The USED-PICK operator attests scoped permission for PC-parts collection and publication; only normal public routes may be used.",
    approval_basis: "OPERATOR_ATTESTED_DIRECT_PERMISSION",
    approval_attested_at: "2026-08-31",
    approval_scope: "PC_PARTS_COLLECTION_AND_PUBLICATION",
    access_constraints: "PUBLIC_ROUTES_ONLY_NO_AUTH_OR_BLOCK_BYPASS",
    cadence: { timezone: "Asia/Seoul", kst_minutes: [27], jitter_max_seconds: MAX_JITTER_SECONDS },
    access: { strategy: "json_or_rendered_html", adapter_kind: "existing_site_script", api_only_required: false }
  }),
  source({
    key: "rethinkmall",
    name: "리씽크몰",
    market_pool: "KR_REFURB_RETAIL",
    policy_status: "APPROVED",
    runtime_status: "ENABLED",
    public_search: true,
    public_search_order: 4,
    directory_source: true,
    directory_order: 5,
    policy_reviewed_at: "2026-08-31",
    policy_note: "The existing USED-PICK RethinkMall integration is operator-approved for PC-parts collection and publication; refurbished retail remains in its own market pool.",
    approval_basis: "OPERATOR_ATTESTED_DIRECT_PERMISSION",
    approval_attested_at: "2026-08-31",
    approval_scope: "PC_PARTS_COLLECTION_AND_PUBLICATION",
    access_constraints: "PUBLIC_ROUTES_ONLY_NO_AUTH_OR_BLOCK_BYPASS",
    cadence: { timezone: "Asia/Seoul", kst_minutes: [36], jitter_max_seconds: MAX_JITTER_SECONDS },
    access: { strategy: "html_livewire", adapter_kind: "existing_site_script", api_only_required: false }
  }),
  source({
    key: "ebay",
    name: "eBay",
    market_pool: "OVERSEAS_USED",
    policy_status: "APPROVED",
    runtime_status: "ENABLED",
    public_search: true,
    public_search_order: 5,
    directory_source: true,
    directory_order: 6,
    cadence: { timezone: "Asia/Seoul", kst_minutes: [44], jitter_max_seconds: MAX_JITTER_SECONDS },
    access: { strategy: "official_browse_api", adapter_kind: "existing_site_script", api_only_required: false }
  }),
  source({
    key: "coolenjoy",
    name: "쿨엔조이",
    market_pool: "KR_C2C_USED",
    policy_status: "APPROVED",
    runtime_status: "ENABLED",
    public_search: false,
    directory_source: true,
    directory_order: 8,
    policy_reviewed_at: "2026-08-31",
    policy_basis_url: "https://coolenjoy.net/robots.txt",
    policy_note: "The USED-PICK operator attests scoped permission for PC-parts collection and publication. Use normal public routes only; HTTP 403 or captcha responses must enter runtime backoff and quarantine.",
    approval_basis: "OPERATOR_ATTESTED_DIRECT_PERMISSION",
    approval_attested_at: "2026-08-31",
    approval_scope: "PC_PARTS_COLLECTION_AND_PUBLICATION",
    access_constraints: "PUBLIC_ROUTES_ONLY_NO_AUTH_OR_BLOCK_BYPASS",
    cadence: { timezone: "Asia/Seoul", kst_minutes: [52], jitter_max_seconds: MAX_JITTER_SECONDS },
    access: { strategy: "site_html", adapter_kind: "specialist_fixture_parser", api_only_required: false }
  })
]);

const SOURCE_BY_KEY = new Map(PC_SOURCE_REGISTRY.map((entry) => [entry.key, entry]));

export function getPcSource(sourceKey) {
  const found = SOURCE_BY_KEY.get(String(sourceKey || "").trim());
  if (!found) throw new Error(`UNKNOWN_PC_SOURCE:${sourceKey}`);
  return found;
}

export function operatorAttestedSourceGovernance(sourceOrKey, options = {}) {
  const sourceKey = typeof sourceOrKey === "string" ? sourceOrKey : sourceOrKey?.key;
  const registered = SOURCE_BY_KEY.get(String(sourceKey || "").trim());
  if (!registered || registered.policy_status !== "APPROVED" || registered.runtime_status !== "ENABLED"
    || registered.approval_basis !== OPERATOR_ATTESTED_APPROVAL_BASIS
    || registered.approval_scope !== OPERATOR_ATTESTED_APPROVAL_SCOPE
    || registered.access_constraints !== OPERATOR_ATTESTED_ACCESS_CONSTRAINTS
    || !isIsoDate(registered.approval_attested_at)
    || !isIsoDate(registered.policy_reviewed_at)
    || registered.policy_reviewed_at !== registered.approval_attested_at) {
    return null;
  }
  const checkedAt = options.now instanceof Date
    ? options.now.getTime()
    : isIsoDate(options.now) ? Date.parse(options.now) : Date.now();
  if (Date.parse(registered.approval_attested_at) > checkedAt) return null;
  return Object.freeze({
    governance_origin: OPERATOR_ATTESTED_GOVERNANCE_ORIGIN,
    policy_reviewed_at: registered.policy_reviewed_at,
    approval_attested_at: registered.approval_attested_at,
    approval_basis: registered.approval_basis,
    approval_scope: registered.approval_scope,
    access_constraints: registered.access_constraints,
    approved_access_mode: registered.access.strategy,
    runtime_status: "ENABLED",
    operator_enabled: true
  });
}

export function getSourceRuntimeDefaults(sourceKey) {
  const registered = getPcSource(sourceKey);
  return {
    source_key: registered.key,
    runtime_status: registered.runtime_status,
    consecutive_failures: 0,
    backoff_until: null,
    quarantine_until: null,
    incremental_cursor: null,
    last_started_at: null,
    last_succeeded_at: null,
    last_error: null
  };
}

export function sourceRuntimeForScheduler(sourceKey, { persisted = null, governedRuntimeStatus = null } = {}) {
  const defaults = getSourceRuntimeDefaults(sourceKey);
  return {
    ...defaults,
    runtime_status: persisted?.runtime_status || governedRuntimeStatus || defaults.runtime_status,
    consecutive_failures: Number(persisted?.failure_count || 0),
    backoff_until: persisted?.backoff_until || null,
    quarantine_until: persisted?.quarantine_until || null,
    incremental_cursor: persisted?.incremental_cursor || null,
    last_started_at: persisted?.last_started_at || null,
    last_succeeded_at: persisted?.last_succeeded_at || null,
    last_error: persisted?.last_error || null
  };
}

function isIsoDate(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function validateSourceActivation(sourceOrKey, evidence = {}, options = {}) {
  const candidate = typeof sourceOrKey === "string" ? { key: sourceOrKey } : sourceOrKey;
  const registered = candidate?.key ? SOURCE_BY_KEY.get(candidate.key) : null;
  if (!registered) return { ok: false, reason: "UNKNOWN_SOURCE" };
  if (registered.policy_status === "DENIED") return { ok: false, reason: "POLICY_DENIED" };
  if (registered.policy_status !== "APPROVED") return { ok: false, reason: "POLICY_NOT_APPROVED" };
  if (!isIsoDate(evidence.policy_reviewed_at)) return { ok: false, reason: "POLICY_REVIEW_MISSING" };
  const checkedAt = options.now instanceof Date
    ? options.now.getTime()
    : isIsoDate(options.now) ? Date.parse(options.now) : Date.now();
  if (Date.parse(evidence.policy_reviewed_at) > checkedAt) return { ok: false, reason: "POLICY_REVIEW_IN_FUTURE" };
  if (evidence.approved_access_mode !== registered.access.strategy) return { ok: false, reason: "ACCESS_MODE_NOT_APPROVED" };
  const canary = evidence.live_canary;
  if (!canary || typeof canary !== "object" || Array.isArray(canary)) return { ok: false, reason: "LIVE_CANARY_EVIDENCE_MISSING" };
  const canaryObservedAt = isIsoDate(canary.observed_at) ? Date.parse(canary.observed_at) : NaN;
  if (!Number.isFinite(canaryObservedAt) || canaryObservedAt < Date.parse(evidence.policy_reviewed_at)
    || canaryObservedAt > checkedAt || checkedAt - canaryObservedAt > LIVE_CANARY_MAX_AGE_MS) {
    return { ok: false, reason: "LIVE_CANARY_STALE_OR_INVALID" };
  }
  if (canary.request_succeeded !== true || !Number.isInteger(canary.request_count) || canary.request_count < 1) {
    return { ok: false, reason: "LIVE_CANARY_REQUEST_FAILED" };
  }
  if (typeof canary.parser_version !== "string" || !canary.parser_version.trim()) {
    return { ok: false, reason: "LIVE_CANARY_PARSER_VERSION_MISSING" };
  }
  if (!Number.isInteger(canary.http_status) || canary.http_status < 200 || canary.http_status >= 400) {
    return { ok: false, reason: "LIVE_CANARY_HTTP_FAILED" };
  }
  for (const field of ["parsed_count", "parse_failure_count", "http_blocked_count", "captcha_count"]) {
    if (!Number.isInteger(canary[field]) || canary[field] < 0) return { ok: false, reason: "LIVE_CANARY_METRICS_INVALID" };
  }
  if (canary.parse_failure_count > 0 || canary.http_blocked_count > 0 || canary.captcha_count > 0) {
    return { ok: false, reason: "LIVE_CANARY_NOT_PASSED" };
  }
  const passedAssertions = Array.isArray(canary.assertions)
    && canary.assertions.length > 0
    && canary.assertions.every((entry) => entry && typeof entry.name === "string" && entry.name.trim() && entry.passed === true);
  if (canary.parsed_count < 1 && !passedAssertions) return { ok: false, reason: "LIVE_CANARY_NO_PARSE_OR_ASSERTION_EVIDENCE" };
  if (evidence.operator_enabled !== true) return { ok: false, reason: "OPERATOR_ENABLE_REQUIRED" };
  return { ok: true, reason: null };
}

export function validateSourceGovernance(sourceOrKey, evidence = {}, options = {}) {
  if (evidence?.governance_origin !== OPERATOR_ATTESTED_GOVERNANCE_ORIGIN) {
    return validateSourceActivation(sourceOrKey, evidence, options);
  }
  const expected = operatorAttestedSourceGovernance(sourceOrKey, options);
  if (!expected) return { ok: false, reason: "REGISTRY_OPERATOR_ATTESTATION_INVALID" };
  for (const field of [
    "governance_origin", "policy_reviewed_at", "approval_attested_at", "approval_basis",
    "approval_scope", "access_constraints", "approved_access_mode", "runtime_status", "operator_enabled"
  ]) {
    if (evidence[field] !== expected[field]) {
      return { ok: false, reason: "REGISTRY_OPERATOR_ATTESTATION_MISMATCH" };
    }
  }
  return { ok: true, reason: null };
}

export function assertJitterSeconds(value) {
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds < 0 || seconds > MAX_JITTER_SECONDS) {
    throw new Error(`JITTER_OUT_OF_RANGE:${value}`);
  }
  return seconds;
}

export function deriveSourceJitterSeconds(sourceKey, scheduledAt, seed = "pc_parts_v1") {
  const registered = getPcSource(sourceKey);
  const scheduledDate = toDate(scheduledAt, "scheduled_at");
  const input = `${seed}:${registered.key}:${scheduledDate.toISOString()}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash % (MAX_JITTER_SECONDS + 1);
}

function toDate(value, fieldName) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`INVALID_${fieldName.toUpperCase()}`);
  return date;
}

function isScheduledKstMinute(date, minutes) {
  const kst = new Date(date.getTime() + KST_OFFSET_MS);
  return minutes.includes(kst.getUTCMinutes());
}

export function listSourceCadenceEvents({ after, through, jitterBySource = {} }) {
  const afterDate = toDate(after, "after");
  const throughDate = toDate(through, "through");
  if (throughDate <= afterDate) return [];
  const earliestBase = Math.floor((afterDate.getTime() - MAX_JITTER_SECONDS * 1000) / 60_000) * 60_000;
  const latestBase = Math.floor(throughDate.getTime() / 60_000) * 60_000;
  const events = [];

  for (let baseMs = earliestBase; baseMs <= latestBase; baseMs += 60_000) {
    const baseDate = new Date(baseMs);
    for (const registered of PC_SOURCE_REGISTRY) {
      if (!isScheduledKstMinute(baseDate, registered.cadence.kst_minutes)) continue;
      const suppliedJitter = Object.prototype.hasOwnProperty.call(jitterBySource, registered.key)
        ? jitterBySource[registered.key]
        : deriveSourceJitterSeconds(registered.key, baseDate);
      const jitterSeconds = assertJitterSeconds(suppliedJitter);
      const runAt = new Date(baseMs + jitterSeconds * 1000);
      if (runAt <= afterDate || runAt > throughDate) continue;
      events.push({
        source_key: registered.key,
        scheduled_at: baseDate.toISOString(),
        run_at: runAt.toISOString(),
        jitter_seconds: jitterSeconds
      });
    }
  }

  return events.sort((left, right) => left.run_at.localeCompare(right.run_at) || left.source_key.localeCompare(right.source_key));
}

function normalizeRuntime(sourceKey, runtime) {
  const defaults = getSourceRuntimeDefaults(sourceKey);
  let merged = { ...defaults, ...(runtime || {}), source_key: sourceKey };
  if (!SOURCE_RUNTIME_STATUSES.includes(merged.runtime_status)) {
    throw new Error(`INVALID_SOURCE_RUNTIME_STATUS:${merged.runtime_status}`);
  }
  // Older direct recovery runs could persist QUARANTINED without its expiry.
  // Rebuild that missing recovery boundary from the immutable start time rather
  // than leaving the source disabled forever or retrying it immediately.
  if (merged.runtime_status === "QUARANTINED" && !merged.quarantine_until) {
    const startedAt = Date.parse(String(merged.last_started_at || ""));
    if (Number.isFinite(startedAt)) {
      merged = { ...merged, quarantine_until: new Date(startedAt + QUARANTINE_MS).toISOString() };
    }
  }
  return merged;
}

function abortError(signal) {
  return signal?.reason instanceof Error ? signal.reason : new Error("SOURCE_COLLECTION_ABORTED");
}

async function runWithAbortSignal(task, signal) {
  if (!signal) return task();
  if (signal.aborted) throw abortError(signal);
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve()
      .then(task)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", onAbort));
  });
}

function authorizationReason(registered, governance) {
  if (!governance) {
    if (registered.policy_status === "DENIED") return "POLICY_DENIED";
    return registered.policy_status === "APPROVED" ? "POLICY_REVIEW_MISSING" : "POLICY_NOT_APPROVED";
  }
  const activation = validateSourceGovernance(registered, governance);
  return activation.ok ? null : activation.reason;
}

function skipReason(registered, runtime, now, governance) {
  const authorizationBlocked = authorizationReason(registered, governance);
  if (authorizationBlocked) return authorizationBlocked;
  if (runtime.runtime_status === "DISABLED") return "SOURCE_DISABLED";
  if (runtime.runtime_status === "ADAPTER_READY") return "OPERATOR_ENABLE_REQUIRED";
  if (runtime.runtime_status === "QUARANTINED") {
    if (!runtime.quarantine_until || now < new Date(runtime.quarantine_until)) return "SOURCE_QUARANTINED";
  }
  if (runtime.backoff_until && now < new Date(runtime.backoff_until)) return "SOURCE_BACKOFF";
  return null;
}

function failureRuntime(runtime, now, error) {
  const consecutiveFailures = Number(runtime.consecutive_failures || 0) + 1;
  if (consecutiveFailures >= 3) {
    return {
      ...runtime,
      runtime_status: "QUARANTINED",
      consecutive_failures: consecutiveFailures,
      backoff_until: null,
      quarantine_until: new Date(now.getTime() + QUARANTINE_MS).toISOString(),
      last_started_at: now.toISOString(),
      last_error: error instanceof Error ? error.message : String(error)
    };
  }
  const backoffMs = FAILURE_BACKOFF_MS[consecutiveFailures - 1];
  return {
    ...runtime,
    consecutive_failures: consecutiveFailures,
    backoff_until: new Date(now.getTime() + backoffMs).toISOString(),
    quarantine_until: null,
    last_started_at: now.toISOString(),
    last_error: error instanceof Error ? error.message : String(error)
  };
}

export function sourceRuntimeAfterFailure(sourceKey, runtime, error, now = new Date()) {
  return failureRuntime(normalizeRuntime(sourceKey, runtime), toDate(now, "now"), error);
}

export async function runSourceCollection({ sourceKey, adapter, runtime, governance, input = {}, now = new Date() }) {
  const registered = getPcSource(sourceKey);
  const runAt = toDate(now, "now");
  let currentRuntime = normalizeRuntime(sourceKey, runtime);
  const blocked = skipReason(registered, currentRuntime, runAt, governance);
  if (blocked) {
    return { source_key: sourceKey, status: "skipped", reason: blocked, next_runtime: currentRuntime };
  }
  if (!adapter || typeof adapter.collectIncremental !== "function") {
    return { source_key: sourceKey, status: "skipped", reason: "ADAPTER_UNAVAILABLE", next_runtime: currentRuntime };
  }
  if (adapter.sourceKey !== sourceKey) throw new Error(`ADAPTER_SOURCE_MISMATCH:${adapter.sourceKey}:${sourceKey}`);
  if (currentRuntime.runtime_status === "QUARANTINED") {
    currentRuntime = { ...currentRuntime, runtime_status: "ENABLED", consecutive_failures: 0, quarantine_until: null };
  }

  try {
    const result = await runWithAbortSignal(() => adapter.collectIncremental({
      ...input,
      cursor: input.cursor ?? currentRuntime.incremental_cursor ?? null,
      now: input.now ?? runAt.toISOString()
    }), input.signal);
    const requestCount = Math.max(0, Number(result.metrics?.request_count) || 0);
    if (requestCount === 0 && Array.isArray(result.items) && result.items.length === 0) {
      return {
        source_key: sourceKey,
        status: "skipped",
        reason: "NO_DUE_TARGETS",
        next_runtime: currentRuntime
      };
    }
    const failureCount = Math.max(
      Math.max(0, Number(result.metrics?.request_failure_count) || 0),
      Math.max(0, Number(result.metrics?.parse_failure_count) || 0)
    );
    const successRate = requestCount > 0 ? Math.max(0, requestCount - failureCount) / requestCount : 1;
    const singleTargetTolerance = requestCount >= 10 && failureCount === 1
      && Number(result.metrics?.parse_failure_count || 0) === 0
      && Number(result.metrics?.http_blocked_count || 0) === 0
      && Number(result.metrics?.captcha_count || 0) === 0;
    if (requestCount > 0 && successRate < 0.95 && !singleTargetTolerance) {
      const partialError = new Error(`SOURCE_SUCCESS_RATE_BELOW_THRESHOLD:${sourceKey}:${successRate.toFixed(4)}`);
      const accessFailure = Number(result.metrics?.http_blocked_count || 0) > 0
        || Number(result.metrics?.captcha_count || 0) > 0;
      const partialRuntime = accessFailure ? failureRuntime(currentRuntime, runAt, partialError) : {
        ...currentRuntime,
        runtime_status: "ENABLED",
        consecutive_failures: 0,
        backoff_until: null,
        quarantine_until: null,
        last_started_at: runAt.toISOString(),
        last_error: partialError.message
      };
      return {
        source_key: sourceKey,
        status: "partial_success",
        reason: "SOURCE_SUCCESS_RATE_BELOW_THRESHOLD",
        error: partialError.message,
        result,
        next_runtime: partialRuntime
      };
    }
    const nextRuntime = {
      ...currentRuntime,
      runtime_status: "ENABLED",
      consecutive_failures: 0,
      backoff_until: null,
      quarantine_until: null,
      incremental_cursor: result.next_cursor ?? currentRuntime.incremental_cursor ?? null,
      last_started_at: runAt.toISOString(),
      last_succeeded_at: runAt.toISOString(),
      last_error: null
    };
    return { source_key: sourceKey, status: "success", result, next_runtime: nextRuntime };
  } catch (error) {
    return {
      source_key: sourceKey,
      status: "failed",
      reason: "COLLECTION_FAILED",
      error: error instanceof Error ? error.message : String(error),
      metrics: error?.collection_metrics && typeof error.collection_metrics === "object"
        ? error.collection_metrics
        : null,
      next_runtime: failureRuntime(currentRuntime, runAt, error)
    };
  }
}

export async function runDueSourceCollections({
  after,
  through,
  adapters = {},
  runtimeBySource = {},
  governanceBySource = {},
  inputsBySource = {},
  jitterBySource = {}
}) {
  const events = listSourceCadenceEvents({ after, through, jitterBySource });
  // A startup catch-up window can contain several cadence events for one
  // source. Target runtime is committed by the caller after this function
  // returns, so running every event would repeat the same due target batch.
  // Keep only the latest event per source for this tick.
  const latestEventBySource = new Map();
  for (const event of events) latestEventBySource.set(event.source_key, event);
  const dueEvents = [...latestEventBySource.values()]
    .sort((left, right) => left.run_at.localeCompare(right.run_at) || left.source_key.localeCompare(right.source_key));
  const runtimeState = Object.fromEntries(Object.entries(runtimeBySource).map(([key, value]) => [key, { ...value }]));
  const results = [];
  for (const event of dueEvents) {
    const result = await runSourceCollection({
      sourceKey: event.source_key,
      adapter: adapters[event.source_key],
      runtime: runtimeState[event.source_key] ?? getSourceRuntimeDefaults(event.source_key),
      governance: governanceBySource[event.source_key],
      input: { ...(inputsBySource[event.source_key] || {}), now: event.run_at },
      now: event.run_at
    });
    runtimeState[event.source_key] = result.next_runtime;
    results.push({ ...result, scheduled_at: event.scheduled_at, run_at: event.run_at });
  }
  return results;
}
