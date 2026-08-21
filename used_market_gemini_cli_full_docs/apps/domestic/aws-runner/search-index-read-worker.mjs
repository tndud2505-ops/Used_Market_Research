import { parentPort, workerData } from "node:worker_threads";
import { performance } from "node:perf_hooks";
import { SearchIndex } from "./search-index.mjs";

const index = new SearchIndex({ filePath: workerData.filePath });
try {
  const started = performance.now();
  const result = index.search(workerData.query, { maxRows: 200 });
  parentPort.postMessage({
    elapsed_ms: Number((performance.now() - started).toFixed(2)),
    count: result.items.length
  });
} finally {
  index.close();
}
