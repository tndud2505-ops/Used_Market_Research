import path from "node:path";
import { SearchIndex } from "./search-index.mjs";
import { PcPartsLedger } from "./pc-parts-ledger.mjs";
import { PcShadowPipeline } from "./pc-shadow-pipeline.mjs";

if (!process.argv.includes("--confirm-unavailable-unknown-backfill")) {
  console.error("Refusing to mutate the ledger without --confirm-unavailable-unknown-backfill");
  process.exit(2);
}

const filePath = path.resolve(process.env.RUNNER_INDEX_PATH || "/var/lib/used-market-runner/search-index.sqlite");
const backupDir = path.resolve(process.env.RUNNER_INDEX_DIR || path.dirname(filePath), "backups");
const index = new SearchIndex({ filePath, backupDir });
try {
  const backup = index.createBackup();
  if (!backup) throw new Error("A recovery backup is required before backfill");
  const ledger = new PcPartsLedger({ db: index.db });
  ledger.migrate();
  const pipeline = new PcShadowPipeline({ ledger });
  await pipeline.initialize();
  const result = pipeline.backfillLegacyInactive();
  console.log(JSON.stringify({ status: "success", backup, ...result }, null, 2));
} finally {
  index.close();
}
