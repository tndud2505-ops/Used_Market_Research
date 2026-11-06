import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

// Whole-scope listing scans run on one read-only worker, so the HTTP thread
// keeps answering cached pages, models and price reads during a scan. Jobs run
// one at a time; the deadline covers a job's own scan, never its queue wait.
export function createPcListingsBrowseWorker(filePath, { timeoutMs = 60_000 } = {}) {
  let worker = null;
  let running = null;
  let nextId = 0;
  const queue = [];
  const failure = (code) => Object.assign(new Error(code), { code });
  const settle = (job, error, result) => {
    clearTimeout(job.timer);
    if (running === job) running = null;
    if (error) job.reject(error);
    else job.resolve(result);
    dispatch();
  };
  // A stuck or crashed worker fails only the scan it was running; queued scans
  // continue on a fresh worker.
  const discard = (current, error) => {
    if (!current || worker !== current) return;
    worker = null;
    void current.terminate();
    if (running) settle(running, error);
  };
  const start = () => {
    const current = new Worker(new URL(import.meta.url), { workerData: { filePath, mode: "pc-listings-browse" } });
    current.unref();
    current.on("message", ({ id, result, error }) => {
      if (worker !== current || running?.id !== id) return;
      settle(running, error ? new Error(error) : null, result);
    });
    current.on("error", (error) => discard(current, error));
    current.on("exit", () => discard(current, failure("PC_LISTING_WORKER_EXITED")));
    return current;
  };
  function dispatch() {
    if (running || queue.length === 0) return;
    const job = queue.shift();
    try { worker ||= start(); }
    catch (error) { job.reject(error); dispatch(); return; }
    running = job;
    const current = worker;
    job.timer = setTimeout(() => discard(current, failure("PC_LISTING_WORKER_TIMEOUT")), timeoutMs);
    job.timer.unref?.();
    current.postMessage({ id: job.id, options: job.options });
  }
  return {
    browse(options) {
      return new Promise((resolve, reject) => {
        queue.push({ id: ++nextId, options, resolve, reject, timer: null });
        dispatch();
      });
    },
    async close() {
      const current = worker;
      worker = null;
      const closed = failure("PC_LISTING_WORKER_CLOSED");
      for (const job of queue.splice(0)) job.reject(closed);
      if (running) { clearTimeout(running.timer); running.reject(closed); running = null; }
      if (current) await current.terminate();
    }
  };
}

if (!isMainThread && workerData?.mode === "pc-listings-browse") {
  const { DatabaseSync } = await import("node:sqlite");
  const { SearchIndex } = await import("./search-index.mjs");
  const db = new DatabaseSync(workerData.filePath, { readOnly: true });
  db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=5000; PRAGMA cache_size=-65536;");
  // The browse read needs only the connection and clock; skip the writer's
  // migration constructor on this read-only connection.
  const reader = Object.create(SearchIndex.prototype);
  reader.db = db;
  reader.now = () => Date.now();
  parentPort.on("message", ({ id, options }) => {
    try { parentPort.postMessage({ id, result: reader.browsePcListings(options) }); }
    catch (error) { parentPort.postMessage({ id, error: error instanceof Error ? error.message : String(error) }); }
  });
}
