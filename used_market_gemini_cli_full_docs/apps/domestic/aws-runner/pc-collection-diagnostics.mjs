import { AsyncLocalStorage } from 'node:async_hooks';
import { channel } from 'node:diagnostics_channel';
import { createHash, randomUUID } from 'node:crypto';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';

const context = new AsyncLocalStorage();
const requests = new WeakMap();
const MINUTE = 60_000;
function resourceCounters() {
  const counters = {};
  if (process.platform !== 'linux') return counters;
  try {
    const io = readFileSync('/proc/self/io', 'utf8');
    for (const key of ['read_bytes', 'write_bytes']) counters[key] = Number(io.match(new RegExp(`^${key}: (\\d+)`, 'm'))?.[1] || 0);
    const group = readFileSync('/proc/self/cgroup', 'utf8').match(/^0::(.+)$/m)?.[1];
    if (group && !group.includes('..')) {
      const base = `/sys/fs/cgroup${group}`;
      counters.cgroup_memory_bytes = Number(readFileSync(`${base}/memory.current`, 'utf8').trim());
      const limit = Number(readFileSync(`${base}/memory.max`, 'utf8').trim());
      counters.cgroup_memory_limit_bytes = Number.isFinite(limit) ? limit : null;
      const stat = readFileSync(`${base}/memory.stat`, 'utf8');
      for (const key of ['anon', 'file', 'pgmajfault']) counters[`cgroup_${key}`] = Number(stat.match(new RegExp(`^${key} (\\d+)`, 'm'))?.[1] || 0);
    }
  } catch {}
  return counters;
}
export function schedulerWatchdogMs(value) {
  const parsed = Number(value);
  return Math.trunc(Math.min(120 * MINUTE, Math.max(5 * MINUTE,
    Number.isFinite(parsed) && parsed > 0 ? parsed : 60 * MINUTE)));
}

// Never serialize an Error, URL, request, response or raw caller-provided object.
export function collectionError(error) {
  const name = ['Error', 'TypeError', 'SyntaxError', 'TimeoutError', 'AbortError', 'RangeError'].includes(error?.name)
    ? error.name : 'Error';
  const message = String(error?.message || '');
  const code = message.match(/^(DANAWA_SEARCH_(?:MARKUP_UNRECOGNIZED|NO_CARDS_UNVERIFIED|BLOCKED|HTTP_\d{3})|ALL_PC_QUERIES_FAILED|SOURCE_(?:RESPONSE_UNRECOGNIZED|ACCESS_BLOCKED|SUCCESS_RATE_BELOW_THRESHOLD)|PC_SCHEDULER_ABORTED|LIFECYCLE_QUEUE_INITIALIZING)(?=:|$)/u)?.[1]
    || (['SQLITE_BUSY', 'SQLITE_FULL', 'SQLITE_IOERR', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'].includes(error?.code) ? error.code : name);
  const output = { error_name: name, error_code: code };
  const frame = String(error?.stack || '').split('\n').slice(1).find(line => /[/\\][a-z0-9-]+\.mjs:\d+:\d+/iu.test(line));
  const location = frame?.match(/[/\\]([a-z0-9-]+\.mjs:\d+:\d+)/iu)?.[1];
  if (location) output.error_location = location;
  if (code.startsWith('DANAWA_SEARCH_')) {
    try {
      const shape = JSON.parse(message.slice(message.indexOf(':') + 1));
      for (const key of ['status', 'bytes', 'product_card_count', 'retry_after_seconds']) {
        if (Number.isFinite(shape[key])) output[key] = shape[key];
      }
      for (const key of ['body_sha256', 'prefix_sha256']) {
        if (/^[a-f0-9]{64}$/u.test(shape[key] || '')) output[key] = shape[key];
      }
      if (['text/html', 'application/json', 'text/plain'].includes(shape.content_type)) output.content_type = shape.content_type;
      for (const key of ['challenge_marker', 'challenge_header']) if (typeof shape[key] === 'boolean') output[key] = shape[key];
    } catch {}
  }
  return output;
}

// Native fetch emits these without wrapping global fetch or consuming its body.
// The WeakMap keeps only safe metadata; URLs, headers and payloads never enter logs.
function subscribe(name, callback) {
  channel(name).subscribe(message => { try { callback(message); } catch {} });
}
subscribe('undici:request:create', ({ request }) => {
  const scope = context.getStore();
  if (!scope || scope.diagnostic.closed) return;
  let host;
  try { host = new URL(String(request.origin)).hostname; } catch { host = 'unknown'; }
  const record = { scope, host, start: Date.now(), state: 'headers', status: null,
    id: ++scope.diagnostic.requestSequence };
  requests.set(request, record);
  scope.diagnostic.activeRequests.add(record);
  scope.diagnostic.network.started += 1;
});
subscribe('undici:request:headers', ({ request, response }) => {
  const record = requests.get(request);
  if (!record) return;
  record.state = 'body'; record.status = response.statusCode;
  record.headersMs = Date.now() - record.start;
});
function finishRequest(request, error) {
  const record = requests.get(request);
  if (!record) return;
  requests.delete(request);
  const diagnostic = record.scope.diagnostic;
  diagnostic.activeRequests.delete(record);
  if (diagnostic.closed) return;
  const elapsed = Date.now() - record.start;
  diagnostic.network.completed += 1;
  diagnostic.network.failed += error || record.status >= 400 ? 1 : 0;
  diagnostic.network.max_ms = Math.max(diagnostic.network.max_ms, elapsed);
  // Successful detail rechecks are aggregated. Errors and slow requests are bounded.
  if ((error || record.status >= 400 || elapsed >= 5000) && diagnostic.networkEvents++ < 100) {
    diagnostic.emit('pc_collection_request', {
      source_id: record.scope.source, phase: record.scope.phase,
      target_ref: record.scope.target, request_id: record.id, host: record.host,
      status: record.status, wait_stage: record.state, elapsed_ms: elapsed,
      headers_ms: record.headersMs ?? null, ...(error ? collectionError(error) : {})
    });
  }
}
subscribe('undici:request:trailers', ({ request }) => finishRequest(request));
subscribe('undici:request:error', ({ request, error }) => finishRequest(request, error));

export function createCollectionDiagnostics({ signal, budgetMs, releaseId, processId,
  write = line => console.log(line), now = Date.now, heartbeatMs = 30_000, resources = true } = {}) {
  const started = now();
  const tickId = randomUUID();
  const active = new Map();
  const targets = new Map();
  const sources = new Map();
  const delay = resources ? monitorEventLoopDelay({ resolution: 50 }) : null;
  delay?.enable();
  let lastHeartbeat = started;
  let cpu = process.cpuUsage();
  let visible = false;
  let previousCounters = resources ? resourceCounters() : {};
  const diagnostic = {
    closed: false, requestSequence: 0, networkEvents: 0, activeRequests: new Set(),
    network: { started: 0, completed: 0, failed: 0, max_ms: 0 },
    emit(event, fields = {}) {
      if (diagnostic.closed) return;
      try { write(JSON.stringify({ event, at: new Date(now()).toISOString(), tick_id: tickId,
        process_id: processId, release_id: releaseId, tick_elapsed_ms: now() - started,
        budget_ms: budgetMs, remaining_ms: Math.max(0, budgetMs - (now() - started)),
        deadline_exceeded: Boolean(signal?.aborted), ...fields })); } catch {}
    },
    source(source) {
      if (!sources.has(source)) sources.set(source, { collected: 0, recorded: 0, changed: 0, projected: 0,
        targets_started: 0, targets_finished: 0, targets_failed: 0, recheck_attempted: 0, recheck_verified: 0,
        max_record_ms: 0, operation_ms: {}, phase_ms: {} });
      return sources.get(source);
    },
    sourceEvent(event) {
      visible = true;
      const progress = diagnostic.source(event.source_key);
      if (event.event === 'started') active.set(event.source_key, { phase: 'collection', since: now(), scheduled_at: event.run_at });
      else {
        const running = active.get(event.source_key);
        progress.phase_ms.collection = running ? now() - running.since : 0;
        progress.collected = event.item_count || 0;
        active.delete(event.source_key);
      }
      diagnostic.emit(`pc_collection_source_${event.event}`, { source_id: event.source_key,
        scheduled_at: event.run_at, status: event.status, reason: event.reason, ...progress });
    },
    run(source, phase, task, target) {
      return context.run({ diagnostic, source, phase, target }, task);
    },
    async phase(source, phase, task, extra = {}) {
      visible = true;
      const begin = now();
      diagnostic.source(source).last_phase = phase;
      active.set(source, { phase, since: begin, ...extra });
      diagnostic.emit('pc_collection_phase_started', { source_id: source, phase, ...extra });
      try {
        const result = await diagnostic.run(source, phase, task);
        diagnostic.emit('pc_collection_phase_finished', { source_id: source, phase, elapsed_ms: now() - begin,
          ...diagnostic.source(source) });
        return result;
      } catch (error) {
        diagnostic.emit('pc_collection_phase_failed', { source_id: source, phase, elapsed_ms: now() - begin,
          timeout_origin: signal?.aborted ? 'scheduler_watchdog' : ['TimeoutError', 'AbortError'].includes(error?.name) ? 'request_or_operation' : null,
          ...diagnostic.source(source), ...collectionError(error) });
        throw error;
      } finally {
        diagnostic.source(source).phase_ms[phase] = now() - begin;
        active.delete(source);
      }
    },
    async target(source, target, task) {
      const ref = createHash('sha256').update(String(target.target_id)).digest('hex').slice(0, 16);
      const progress = diagnostic.source(source);
      const begin = now();
      progress.targets_started += 1;
      targets.set(`${source}:${ref}`, { source_id: source, target_ref: ref, since: begin });
      diagnostic.emit('pc_collection_target_started', { source_id: source, target_ref: ref });
      try {
        const result = await diagnostic.run(source, 'collection', task, ref);
        diagnostic.emit('pc_collection_target_finished', { source_id: source, target_ref: ref,
          elapsed_ms: now() - begin, item_count: result.items?.length || 0,
          stale_cache: Boolean(result.items?.stale_cache), tick_network: { ...diagnostic.network } });
        return result;
      } catch (error) {
        progress.targets_failed += 1;
        diagnostic.emit('pc_collection_target_failed', { source_id: source, target_ref: ref,
          elapsed_ms: now() - begin, ...collectionError(error) });
        throw error;
      } finally { progress.targets_finished += 1; targets.delete(`${source}:${ref}`); }
    },
    heartbeat() {
      if (!visible) return;
      const current = now();
      const nextCpu = process.cpuUsage();
      const counters = resources ? resourceCounters() : {};
      diagnostic.emit('pc_collection_progress', {
        active: [...active].map(([source, value]) => ({ source_id: source, ...value,
          phase_elapsed_ms: current - value.since, ...diagnostic.source(source) })),
        network: { ...diagnostic.network, active: diagnostic.activeRequests.size },
        targets: [...targets.values()].slice(0, 8).map(target => ({ ...target, elapsed_ms: current - target.since })),
        requests: [...diagnostic.activeRequests].slice(0, 8).map(r => ({ request_id: r.id, source_id: r.scope.source,
          phase: r.scope.phase, target_ref: r.scope.target, host: r.host, wait_stage: r.state, elapsed_ms: Date.now() - r.start })),
        rss_bytes: process.memoryUsage().rss, cpu_ms: ((nextCpu.user - cpu.user) + (nextCpu.system - cpu.system)) / 1000,
        ...counters,
        disk_read_delta_bytes: (counters.read_bytes || 0) - (previousCounters.read_bytes || 0),
        disk_write_delta_bytes: (counters.write_bytes || 0) - (previousCounters.write_bytes || 0),
        heartbeat_gap_ms: current - lastHeartbeat,
        event_loop_max_ms: delay ? Math.round(delay.max / 1e6) : null
      });
      cpu = nextCpu; lastHeartbeat = current; delay?.reset();
      previousCounters = counters;
    },
    finish(status) {
      if (diagnostic.closed) return;
      if (visible) diagnostic.emit('pc_collection_tick_finished', { status,
        sources: Object.fromEntries(sources), network: { ...diagnostic.network } });
      diagnostic.closed = true;
      clearInterval(timer); signal?.removeEventListener('abort', onAbort); delay?.disable();
      diagnostic.activeRequests.clear();
    }
  };
  const onAbort = () => { if (visible) {
    diagnostic.emit('pc_collection_deadline', { timeout_origin: 'scheduler_watchdog',
      active: [...active].map(([source, value]) => ({ source_id: source, ...value, ...diagnostic.source(source) })) });
    diagnostic.heartbeat();
  } };
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setInterval(() => diagnostic.heartbeat(), heartbeatMs);
  timer.unref();
  return diagnostic;
}
