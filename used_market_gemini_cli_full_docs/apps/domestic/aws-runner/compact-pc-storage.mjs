import { createHash } from "node:crypto";
import { existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { PcPartsLedger } from "./pc-parts-ledger.mjs";

function option(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function requiredOption(argv, name) {
  const value = String(option(argv, name) || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function planChecksum(plan) {
  return createHash("sha256").update(JSON.stringify(plan)).digest("hex");
}

function retentionDays(argv) {
  const value = Number(option(argv, "--observation-retention-days") || 1);
  if (!Number.isInteger(value) || value < 1 || value > 30) {
    throw new Error("--observation-retention-days must be an integer between 1 and 30");
  }
  return value;
}

async function main(argv) {
  const filePath = path.resolve(requiredOption(argv, "--db"));
  if (!existsSync(filePath)) throw new Error(`SQLite file does not exist: ${filePath}`);
  const apply = argv.includes("--apply");
  const asOf = option(argv, "--as-of") || new Date().toISOString();
  const options = { asOf, observationRetentionDays: retentionDays(argv) };

  if (!apply) {
    const db = new DatabaseSync(filePath, { readOnly: true });
    const ledger = new PcPartsLedger({ db });
    try {
      const plan = ledger.storageCompactionPlan(options);
      console.log(JSON.stringify({ mode: "dry-run", plan, plan_checksum: planChecksum(plan) }, null, 2));
    } finally {
      ledger.clearStorageCompactionPlan();
      db.close();
    }
    return;
  }

  if (!argv.includes("--confirm-observation-prune")) {
    throw new Error("Refusing to mutate without --confirm-observation-prune");
  }
  const expectedChecksum = requiredOption(argv, "--confirm-plan-checksum");
  if (!/^[a-f0-9]{64}$/u.test(expectedChecksum)) throw new Error("--confirm-plan-checksum must be a SHA-256 checksum");

  const db = new DatabaseSync(filePath);
  const ledger = new PcPartsLedger({ db });
  try {
    const backupDir = path.join(path.dirname(filePath), "backups");
    mkdirSync(backupDir, { recursive: true });
    const existingBackupOption = option(argv, "--existing-recovery-backup");
    const backup = existingBackupOption
      ? path.resolve(existingBackupOption)
      : path.join(backupDir,
        `search-index-pre-observation-compaction-${new Date().toISOString().replace(/[:.]/gu, "-")}.sqlite`);
    if (existingBackupOption) {
      if (path.dirname(backup) !== backupDir
        || !/^search-index-pre-observation-compaction-.+\.sqlite$/u.test(path.basename(backup))
        || !existsSync(backup) || statSync(backup).size <= 0) {
        throw new Error("--existing-recovery-backup must identify a non-empty compaction backup in the database backup directory");
      }
    } else {
      db.exec(`VACUUM INTO '${backup.replaceAll("'", "''")}'`);
    }
    if (!existsSync(backup)) throw new Error("A recovery backup is required before storage compaction");
    ledger.migrate();
    const plan = ledger.storageCompactionPlan(options);
    ledger.clearStorageCompactionPlan();
    const actualChecksum = planChecksum(plan);
    if (actualChecksum !== expectedChecksum) {
      throw new Error(`STORAGE_COMPACTION_PLAN_CHANGED:${expectedChecksum}:${actualChecksum}`);
    }
    const result = ledger.compactStorage({ ...options, pruneObservationDetails: true });
    const integrityAudit = ledger.runIntegrityAudit();
    if (argv.includes("--vacuum")) db.exec("VACUUM");
    console.log(JSON.stringify({
      mode: "apply",
      plan_checksum: actualChecksum,
      backup,
      vacuumed: argv.includes("--vacuum"),
      result,
      integrity_audit: integrityAudit
    }, null, 2));
  } finally {
    db.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
