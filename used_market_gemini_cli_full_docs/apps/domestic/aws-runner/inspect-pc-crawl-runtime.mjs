import { DatabaseSync } from "node:sqlite";

const databasePath = String(process.argv[2] || process.env.RUNNER_INDEX_PATH || "").trim();
if (!databasePath) throw new Error("database path is required");
const db = new DatabaseSync(databasePath, { readOnly: true });
try {
  const running = db.prepare(`SELECT source_id, crawl_run_id, run_status, started_at, finished_at,
      request_count, request_failure_count, parsed_count, http_blocked_count, error_message
    FROM crawl_runs WHERE run_status = 'RUNNING' ORDER BY started_at`).all();
  const recent = db.prepare(`SELECT source_id, crawl_run_id, run_status, started_at, finished_at,
      request_count, request_failure_count, parsed_count, http_blocked_count, error_message
    FROM crawl_runs ORDER BY started_at DESC LIMIT 24`).all();
  const sources = db.prepare(`SELECT source_id, runtime_status, last_started_at, last_succeeded_at,
      backoff_until, quarantine_until, failure_count, last_error, updated_at
    FROM source_runtime ORDER BY source_id`).all();
  console.log(JSON.stringify({ running, recent, sources }, null, 2));
} finally {
  db.close();
}
