import { readdir, rm } from "node:fs/promises";
import path from "node:path";

const RUN_ID_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z__/;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export interface DatedRunDirectory {
  name: string;
  absolute_path: string;
  timestamp: Date;
  kst_date_key: string;
}

export function toKstDateKey(timestamp: Date): string {
  return new Date(timestamp.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function getRecentKstDateKeys(now: Date, retentionDays: number) {
  const keys = new Set<string>();
  const kstNow = new Date(now.getTime() + KST_OFFSET_MS);
  const currentKstMidnightMs = Date.UTC(
    kstNow.getUTCFullYear(),
    kstNow.getUTCMonth(),
    kstNow.getUTCDate()
  ) - KST_OFFSET_MS;

  for (let index = 0; index < retentionDays; index += 1) {
    keys.add(toKstDateKey(new Date(currentKstMidnightMs - index * 24 * 60 * 60 * 1000)));
  }

  return keys;
}

export function parseRunIdTimestamp(runId: string): Date | null {
  const match = RUN_ID_PATTERN.exec(runId);
  if (!match) return null;

  const [, year, month, day, hour, minute, second, millisecond] = match;
  const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}.${millisecond}Z`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function listDatedRunDirectories(baseDir: string): Promise<DatedRunDirectory[]> {
  try {
    const entries = await readdir(baseDir, { withFileTypes: true });
    const datedRuns = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const timestamp = parseRunIdTimestamp(entry.name);
        if (!timestamp) return null;

        return {
          name: entry.name,
          absolute_path: path.join(baseDir, entry.name),
          timestamp,
          kst_date_key: toKstDateKey(timestamp)
        } satisfies DatedRunDirectory;
      })
      .filter((entry): entry is DatedRunDirectory => entry !== null)
      .sort((left, right) => right.timestamp.getTime() - left.timestamp.getTime());

    return datedRuns;
  } catch {
    return [];
  }
}

export function selectLatestRunPerKstDay(runs: DatedRunDirectory[], lookbackDays: number): DatedRunDirectory[] {
  const selected: DatedRunDirectory[] = [];
  const seenDateKeys = new Set<string>();

  for (const run of runs) {
    if (seenDateKeys.has(run.kst_date_key)) continue;
    seenDateKeys.add(run.kst_date_key);
    selected.push(run);
    if (selected.length >= lookbackDays) break;
  }

  return selected.sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime());
}

export function selectRunsWithinRecentKstDays(runs: DatedRunDirectory[], lookbackDays: number): DatedRunDirectory[] {
  const allowedDateKeys: string[] = [];
  const seenDateKeys = new Set<string>();

  for (const run of runs) {
    if (seenDateKeys.has(run.kst_date_key)) continue;
    seenDateKeys.add(run.kst_date_key);
    allowedDateKeys.push(run.kst_date_key);
    if (allowedDateKeys.length >= lookbackDays) break;
  }

  const allowed = new Set(allowedDateKeys);
  return runs
    .filter((run) => allowed.has(run.kst_date_key))
    .sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime());
}

export async function pruneDatedRunDirectories(
  baseDir: string,
  retentionDays: number,
  now = new Date()
): Promise<string[]> {
  if (!Number.isFinite(retentionDays) || retentionDays < 1) {
    return [];
  }

  const runs = await listDatedRunDirectories(baseDir);
  const allowedDateKeys = getRecentKstDateKeys(now, retentionDays);
  const removed: string[] = [];

  for (const run of runs) {
    if (allowedDateKeys.has(run.kst_date_key)) continue;
    await rm(run.absolute_path, { recursive: true, force: true });
    removed.push(run.name);
  }

  return removed;
}
