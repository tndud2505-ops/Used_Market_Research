import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

// Only the rebuildable queue is written here, in bounded transactions off the HTTP thread.
export function createLifecycleQueueBootstrap(filePath, onReady = () => {}) {
  let worker = null, busy = false, ready = false;
  return {
    step() {
      if (ready || busy) return;
      if (!worker) {
        const current = new Worker(new URL(import.meta.url), { workerData: { filePath, mode: 'bootstrap' },
          resourceLimits: { maxOldGenerationSizeMb: 64 } });
        worker = current; current.unref();
        current.on('message', result => {
          busy = false;
          if (result.ready) { ready = true; onReady(); }
        });
        current.on('error', () => { busy = false; worker = null; });
        current.on('exit', () => { if (worker === current) { busy = false; worker = null; } });
      }
      busy = true; worker.postMessage('step');
    },
    async close() { ready = true; if (worker) await worker.terminate(); }
  };
}

// Diagnostics must not hold the HTTP event loop while scanning retained history.
// One bounded, read-only worker; no collection, migrations or persistent files.
export function createLifecycleStatusCache(filePath, { ttlMs = 300_000, timeoutMs = 15_000 } = {}) {
  let worker = null, timer = null, retryAt = 0, values = {}, checkedAt = null, failure = null;
  const sources = ['bunjang', 'joonggonara'];
  const finish = (current, error, result) => {
    if (worker !== current) return;
    clearTimeout(timer); worker = null; retryAt = Date.now() + ttlMs; failure = error;
    if (result) { values = result; checkedAt = new Date().toISOString(); }
  };
  return {
    get({ enabled = true } = {}) {
      if (enabled && !worker && Date.now() >= retryAt) {
        const current = new Worker(new URL(import.meta.url), { workerData: { filePath },
          resourceLimits: { maxOldGenerationSizeMb: 64 } });
        worker = current;
        timer = setTimeout(() => {
          finish(current, 'LIFECYCLE_STATUS_TIMEOUT');
          void current.terminate();
        }, timeoutMs);
        timer.unref(); current.unref();
        current.once('message', message => finish(current, message.error || null, message.values));
        current.once('error', () => finish(current, 'LIFECYCLE_STATUS_UNAVAILABLE'));
        current.once('exit', () => finish(current, 'LIFECYCLE_STATUS_INTERRUPTED'));
      }
      return Object.fromEntries(sources.map(source => [source, {
        ...(values[source] || { source_id: source }), checked_at: checkedAt,
        status: failure ? (checkedAt ? 'STALE' : 'UNAVAILABLE') : values[source]?.status || (checkedAt ? 'READY' : 'PENDING'),
        refreshing: Boolean(worker), ...(failure ? { error: failure } : {})
      }]));
    },
    async close() {
      const current = worker; worker = null; clearTimeout(timer);
      if (current) await current.terminate();
    }
  };
}

if (!isMainThread && workerData?.filePath) {
  let db;
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const { PcPartsLedger } = await import('./pc-parts-ledger.mjs');
    db = new DatabaseSync(workerData.filePath, { readOnly: workerData.mode !== 'bootstrap' });
    db.exec('PRAGMA cache_size=-8192;');
    const ledger = new PcPartsLedger({ db });
    if (workerData.mode === 'bootstrap') {
      db.exec('PRAGMA busy_timeout=200;');
      parentPort.on('message', () => {
        try {
          const result = ledger.bootstrapLifecycleQueue(100);
          parentPort.postMessage(result);
          if (result.ready) { db.close(); parentPort.close(); }
        } catch { parentPort.postMessage({ ready: false, error: 'LIFECYCLE_BOOTSTRAP_DEFERRED' }); }
      });
    } else {
    db.exec('PRAGMA query_only=ON;');
    const asOf = new Date();
    const values = Object.fromEntries(['bunjang', 'joonggonara'].map(sourceId =>
      [sourceId, ledger.lifecycleRecheckStatus({ sourceId, asOf })]));
    parentPort.postMessage({ values });
    }
  } catch { parentPort.postMessage({ error: 'LIFECYCLE_STATUS_UNAVAILABLE' }); }
  finally { if (workerData.mode !== 'bootstrap') db?.close(); }
}
