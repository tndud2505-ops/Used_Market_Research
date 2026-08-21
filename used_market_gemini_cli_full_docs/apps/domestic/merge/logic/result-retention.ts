import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { parseRunIdTimestamp, pruneDatedRunDirectories, toKstDateKey } from "./run-retention.js";

interface RetentionTarget {
  relativePath: string;
  retentionDays: number;
  filePattern?: RegExp;
}

function readRetentionDays(value: string | undefined, fallback: number) {
  const parsed = Number(value ?? "");
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : fallback;
}

function getGlobalRetentionDays() {
  return readRetentionDays(process.env.MERGE_RESULT_RETENTION_DAYS, 30);
}

function getModuleRetentionDays(moduleName: string) {
  if (moduleName === "market") {
    return readRetentionDays(process.env.MARKET_HISTORY_RETENTION_DAYS, getGlobalRetentionDays());
  }

  if (moduleName === "scheduler") {
    return readRetentionDays(process.env.SCHEDULER_RESULT_RETENTION_DAYS, 14);
  }

  if (moduleName === "reporter") {
    return readRetentionDays(process.env.REPORTER_RESULT_RETENTION_DAYS, getGlobalRetentionDays());
  }

  return getGlobalRetentionDays();
}

function getRecentKstDateKeys(now: Date, retentionDays: number) {
  const keys = new Set<string>();
  const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const startUtcMs = Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate()) - 9 * 60 * 60 * 1000;

  for (let index = 0; index < retentionDays; index += 1) {
    keys.add(toKstDateKey(new Date(startUtcMs - index * 24 * 60 * 60 * 1000)));
  }

  return keys;
}

async function resolveFileTimestamp(targetPath: string, fileName: string) {
  const withoutExtension = fileName.replace(/\.[^.]+$/u, "");
  const runTimestamp = parseRunIdTimestamp(withoutExtension);
  if (runTimestamp) {
    return runTimestamp;
  }

  const localTimestampMatch = fileName.match(/(\d{4}-\d{2}-\d{2})[_T](\d{2})-(\d{2})-(\d{2})/u);
  if (localTimestampMatch) {
    const [, date, hour, minute, second] = localTimestampMatch;
    const parsed = new Date(`${date}T${hour}:${minute}:${second}+09:00`);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  const fileStat = await stat(targetPath);
  return fileStat.mtime;
}

async function pruneFilesByRecentKstDays(targetDir: string, retentionDays: number, filePattern?: RegExp, now = new Date()) {
  if (!Number.isFinite(retentionDays) || retentionDays < 1) {
    return [] as string[];
  }

  try {
    const entries = await readdir(targetDir, { withFileTypes: true });
    const allowedDateKeys = getRecentKstDateKeys(now, retentionDays);
    const removed: string[] = [];

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (filePattern && !filePattern.test(entry.name)) continue;

      const absolutePath = path.join(targetDir, entry.name);
      const timestamp = await resolveFileTimestamp(absolutePath, entry.name);
      if (allowedDateKeys.has(toKstDateKey(timestamp))) continue;

      await rm(absolutePath, { force: true });
      removed.push(entry.name);
    }

    return removed;
  } catch {
    return [] as string[];
  }
}

export async function applyResultRetention(moduleName: string, resultRoot = path.resolve(process.cwd(), "merge/result"), now = new Date()) {
  const moduleDir = path.join(resultRoot, moduleName);
  const retentionDays = getModuleRetentionDays(moduleName);
  await pruneDatedRunDirectories(moduleDir, retentionDays, now);

  const auxiliaryTargets: RetentionTarget[] = [
    {
      relativePath: path.join("reporter", "sheets-cache"),
      retentionDays: readRetentionDays(process.env.REPORTER_SHEETS_CACHE_RETENTION_DAYS, 7),
      filePattern: /\.json$/iu
    },
    {
      relativePath: path.join("reporter", "sheet-verification"),
      retentionDays: readRetentionDays(process.env.REPORTER_SHEET_VERIFICATION_RETENTION_DAYS, 30),
      filePattern: /\.json$/iu
    },
    {
      relativePath: "automation-logs",
      retentionDays: readRetentionDays(process.env.AUTOMATION_LOG_RETENTION_DAYS, 14),
      filePattern: /\.log$/iu
    }
  ];

  await Promise.all(auxiliaryTargets.map((target) =>
    pruneFilesByRecentKstDays(
      path.join(resultRoot, target.relativePath),
      target.retentionDays,
      target.filePattern,
      now
    )
  ));
}
