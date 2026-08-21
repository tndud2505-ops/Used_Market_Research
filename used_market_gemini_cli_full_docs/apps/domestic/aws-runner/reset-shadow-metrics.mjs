import { DatabaseSync } from "node:sqlite";

if (process.argv[2] !== "--confirm-shadow-metrics-only") {
  console.error("Refusing to reset metrics without --confirm-shadow-metrics-only");
  process.exit(2);
}

const filePath = process.env.RUNNER_INDEX_PATH || "/var/lib/used-market-runner/search-index.sqlite";
const db = new DatabaseSync(filePath);
try {
  const before = Number(db.prepare("SELECT COUNT(*) AS count FROM comparison_runs").get()?.count || 0);
  db.exec("DELETE FROM comparison_runs");
  console.log(JSON.stringify({ status: "success", removed_comparison_runs: before, listings_unchanged: true }));
} finally {
  db.close();
}
