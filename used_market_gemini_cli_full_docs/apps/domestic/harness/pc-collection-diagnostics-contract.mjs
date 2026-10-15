import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createCollectionDiagnostics, collectionError, schedulerWatchdogMs } from '../aws-runner/pc-collection-diagnostics.mjs';
import { runSourceCollection, getSourceRuntimeDefaults, operatorAttestedSourceGovernance } from '../collector/logic/pc-source-registry.mjs';

assert.equal(schedulerWatchdogMs(undefined), 3_600_000);
assert.equal(schedulerWatchdogMs('NaN'), 3_600_000);
assert.equal(schedulerWatchdogMs(1), 300_000);
assert.equal(schedulerWatchdogMs(99_999_999), 7_200_000);
assert.equal(schedulerWatchdogMs('3600000.5'), 3_600_000, 'AbortSignal.timeout requires integer milliseconds');

const events = [];
let now = Date.parse('2026-10-16T00:00:00Z');
const controller = new AbortController();
const diagnostic = createCollectionDiagnostics({ signal: controller.signal, budgetMs: 3_600_000,
  write: line => events.push(JSON.parse(line)), now: () => now, resources: false,
  releaseId: 'test-release', processId: 'test-process' });
diagnostic.sourceEvent({ event: 'started', source_key: 'joonggonara', run_at: '2026-10-15T23:55:00Z' });
const progress = diagnostic.source('joonggonara');
await diagnostic.phase('joonggonara', 'record_items', () => {
  progress.recorded = 17; progress.changed = 3; now += 1000;
});
now += 3_600_000;
const timeout = new DOMException('secret diagnostic must not leak', 'TimeoutError');
await assert.rejects(diagnostic.phase('joonggonara', 'lifecycle_recheck', () => {
  controller.abort(timeout);
  diagnostic.heartbeat();
  throw timeout;
}), { name: 'TimeoutError' });
const failure = events.find(event => event.event === 'pc_collection_phase_failed');
assert.equal(failure.phase, 'lifecycle_recheck');
assert.equal(failure.recorded, 17, 'a later timeout must preserve the completed write count');
assert.equal(failure.timeout_origin, 'scheduler_watchdog');
assert.equal(failure.deadline_exceeded, true);
assert.equal(new Set(events.map(event => event.tick_id)).size, 1);
assert.notEqual(events[0].at, events[0].scheduled_at, 'actual and logical schedule times differ');
assert.equal(events.find(event => event.event === 'pc_collection_progress').active[0].phase, 'lifecycle_recheck');
diagnostic.finish('deadline_exceeded');
const count = events.length;
diagnostic.heartbeat(); diagnostic.finish('completed');
assert.equal(events.length, count, 'late task callbacks must not emit after tick disposal');

let attempted = false;
const source = 'joonggonara';
const runtime = getSourceRuntimeDefaults(source);
const skipped = await runSourceCollection({ sourceKey: source, runtime,
  governance: operatorAttestedSourceGovernance(source), input: { signal: controller.signal },
  adapter: { sourceKey: source, collectIncremental() { attempted = true; } } });
assert.equal(attempted, false);
assert.equal(skipped.status, 'skipped');
assert.equal(skipped.reason, 'TICK_DEADLINE');
assert.equal(skipped.next_runtime.consecutive_failures, runtime.consecutive_failures);
const activeAbort = new AbortController();
const activeMetrics = { crawl_run_id: 'reserved-run', request_count: 4, request_failure_count: 0,
  parsed_count: 12, target_results: [] };
const timedOut = await runSourceCollection({ sourceKey: source, runtime,
  governance: operatorAttestedSourceGovernance(source), input: { signal: activeAbort.signal, collection_metrics: activeMetrics },
  adapter: { sourceKey: source, async collectIncremental() {
    activeAbort.abort(new DOMException('scheduler elapsed', 'TimeoutError'));
    throw activeAbort.signal.reason;
  } } });
assert.equal(timedOut.status, 'failed', 'an attempted run still needs a failure receipt');
assert.equal(timedOut.reason, 'TICK_DEADLINE');
assert.equal(timedOut.next_runtime.consecutive_failures, 0, 'our global deadline must not quarantine a source');
assert.equal(timedOut.metrics.crawl_run_id, 'reserved-run', 'the reserved Danawa audit must be closed');
assert.equal(timedOut.metrics.request_count, 4);
assert.equal(timedOut.metrics.request_failure_count, 0, 'do not invent a network failure for a scheduler timeout');
activeMetrics.request_count = 9;
assert.equal(timedOut.metrics.request_count, 4, 'late adapter work must not change the timeout receipt');

const secret = 'Bearer-PRIVATE-KEY-AND-SELLER-NAME';
const shapeError = new Error(`DANAWA_SEARCH_MARKUP_UNRECOGNIZED:${JSON.stringify({
  status: 200, bytes: 1234, product_card_count: 0, body_sha256: 'a'.repeat(64), content_type: 'text/html',
  url: `https://example.test/?token=${secret}`, body: secret, authorization: secret })}`);
const safeShape = collectionError(shapeError);
assert.equal(safeShape.body_sha256, 'a'.repeat(64));
assert.equal(safeShape.product_card_count, 0);
assert.equal(JSON.stringify(safeShape).includes(secret), false);
assert.equal(JSON.stringify(collectionError(new Error(secret))).includes(secret), false);
assert.equal(JSON.stringify(events).includes('secret diagnostic'), false);

// Exercise native fetch instrumentation against a local fixture, never a marketplace.
const server = http.createServer((_request, response) => {
  response.writeHead(503, { 'content-type': 'application/json', 'x-private': secret });
  response.end(JSON.stringify({ secret }));
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const networkEvents = [];
const network = createCollectionDiagnostics({ budgetMs: 3_600_000, resources: false,
  write: line => networkEvents.push(JSON.parse(line)) });
try {
  await network.target('ebay', { target_id: secret }, async () => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/private/${secret}?token=${secret}`, {
      headers: { authorization: secret }
    });
    await response.json();
    return { items: [] };
  });
  const request = networkEvents.find(event => event.event === 'pc_collection_request');
  assert.equal(request.source_id, 'ebay');
  assert.equal(request.status, 503);
  assert.equal(request.host, '127.0.0.1');
  assert.equal(request.wait_stage, 'body');
  assert.equal(network.network.started, 1);
  assert.equal(network.activeRequests.size, 0);
  assert.equal(JSON.stringify(networkEvents).includes(secret), false, 'no URL path/query, headers, payload, raw target IDs');
} finally { network.finish('completed'); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }

const brokenLogger = createCollectionDiagnostics({ budgetMs: 3_600_000, resources: false, write() { throw new Error('logger failure'); } });
assert.equal(await brokenLogger.phase('ebay', 'collection', () => 42), 42);
brokenLogger.finish('completed');
console.log('PC collection diagnostics contract passed.');
