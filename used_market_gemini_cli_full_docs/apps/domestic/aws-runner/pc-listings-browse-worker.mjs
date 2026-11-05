import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

// Whole-scope listing scans run on one read-only worker, so the HTTP thread
// keeps answering cached pages, models and price reads during a scan.
export function createPcListingsBrowseWorker(filePath, { timeoutMs = 60_000 } = {}) {
  let worker = null;
  let nextId = 0;
  const pending = new Map();
  const failAll = (error) => {
    for (const job of pending.values()) { clearTimeout(job.timer); job.reject(error); }
    pending.clear();
  };
  const stop = (error) => {
    const current = worker;
    worker = null;
    failAll(error);
    if (current) void current.terminate();
  };
  const start = () => {
    const current = new Worker(new URL(import.meta.url), { workerData: { filePath, mode: "pc-listings-browse" } });
    current.unref();
    current.on("message", ({ id, result, error }) => {
      const job = pending.get(id);
      if (!job) return;
      pending.delete(id);
      clearTimeout(job.timer);
      if (error) job.reject(new Error(error));
      else job.resolve(result);
    });
    current.on("error", (error) => { if (worker === current) stop(error); });
    current.on("exit", () => { if (worker === current) stop(new Error("PC_LISTING_WORKER_EXITED")); });
    return current;
  };
  return {
    browse(options) {
      worker ||= start();
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => stop(new Error("PC_LISTING_WORKER_TIMEOUT")), timeoutMs);
        timer.unref?.();
        pending.set(id, { resolve, reject, timer });
        worker.postMessage({ id, options });
      });
    },
    async close() {
      const current = worker;
      worker = null;
      failAll(new Error("PC_LISTING_WORKER_CLOSED"));
      if (current) await current.terminate();
    }
  };
}

if (!isMainThread && workerData?.mode === "pc-listings-browse") {
  const { DatabaseSync } = await import("node:sqlite");
  const { SearchIndex } = await import("./search-index.mjs");
  const db = new DatabaseSync(workerData.filePath, { readOnly: true });
  db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=5000; PRAGMA cache_size=-16384;");
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
