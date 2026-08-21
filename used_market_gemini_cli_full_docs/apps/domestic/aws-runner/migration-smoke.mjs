import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { SearchIndex } from "./search-index.mjs";

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

console.log(JSON.stringify({
  status: userVersion === 4 && integrity === "ok" ? "passed" : "failed",
  duration_ms: Date.now() - startedAt,
  user_version: userVersion,
  integrity
}, null, 2));
