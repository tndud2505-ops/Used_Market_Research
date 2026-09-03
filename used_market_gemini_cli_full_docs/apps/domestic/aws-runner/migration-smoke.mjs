import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { SEARCH_INDEX_SCHEMA_VERSION, SearchIndex } from "./search-index.mjs";

const filePath = path.resolve(String(process.argv[2] || ""));
if (!process.argv[2]) throw new Error("SQLite path is required");

const startedAt = Date.now();
const index = new SearchIndex({
  filePath,
  backupDir: path.join(path.dirname(filePath), "migration-smoke-backups")
});
index.close();

const database = new DatabaseSync(filePath, { readOnly: true });
const userVersion = Number(database.prepare("PRAGMA user_version").get()?.user_version || 0);
const integrity = String(database.prepare("PRAGMA integrity_check").get()?.integrity_check || "unknown");
database.close();

const passed = userVersion === SEARCH_INDEX_SCHEMA_VERSION && integrity === "ok";
console.log(JSON.stringify({
  status: passed ? "passed" : "failed",
  duration_ms: Date.now() - startedAt,
  user_version: userVersion,
  integrity
}, null, 2));
if (!passed) process.exitCode = 1;
