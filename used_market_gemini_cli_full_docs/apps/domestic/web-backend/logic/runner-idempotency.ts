import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { acquireSchedulerJobLock } from "../../scheduler/logic/job-lock.js";

type RunnerIdempotencyStatus = "running" | "completed" | "failed";

interface RunnerIdempotencyRecord {
  status: RunnerIdempotencyStatus;
  updated_at: string;
  request_fingerprint?: string;
  response?: unknown;
}

type RunnerIdempotencyStore = Record<string, RunnerIdempotencyRecord>;

const RECORD_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_RECORDS = 200;

function getStorePath() {
  return path.resolve(
    process.env.RUNNER_IDEMPOTENCY_FILE
      ?? path.join(process.cwd(), "merge", "result", "scheduler", "runner-idempotency.json")
  );
}

async function readStore(): Promise<RunnerIdempotencyStore> {
  try {
    const parsed = JSON.parse(await readFile(getStorePath(), "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as RunnerIdempotencyStore
      : {};
  } catch {
    return {};
  }
}

async function writeStore(store: RunnerIdempotencyStore) {
  const storePath = getStorePath();
  await mkdir(path.dirname(storePath), { recursive: true });
  await writeFile(storePath, JSON.stringify(store, null, 2), "utf8");
}

function pruneStore(store: RunnerIdempotencyStore, now = Date.now()) {
  for (const [key, record] of Object.entries(store)) {
    const updatedAt = Date.parse(record?.updated_at ?? "");
    if (!Number.isFinite(updatedAt) || now - updatedAt > RECORD_TTL_MS) delete store[key];
  }
}

function trimStore(store: RunnerIdempotencyStore) {
  const entries = Object.entries(store)
    .sort((left, right) => Date.parse(right[1].updated_at) - Date.parse(left[1].updated_at))
    .slice(0, MAX_RECORDS);
  return Object.fromEntries(entries);
}

export type RunnerIdempotencyReservation =
  | { kind: "execute"; key: string }
  | { kind: "replay"; key: string; response: unknown }
  | { kind: "running"; key: string }
  | { kind: "conflict"; key: string };

async function acquireIdempotencyLockWithRetry() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const lock = await acquireSchedulerJobLock("runner-idempotency");
      if (lock) return lock;
    } catch (error) {
      if (attempt === 19) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("runner idempotency lock is unavailable");
}

export async function reserveRunnerIdempotency(key: string, requestFingerprint?: string): Promise<RunnerIdempotencyReservation> {
  const lock = await acquireIdempotencyLockWithRetry();

  try {
    const store = await readStore();
    pruneStore(store);
    const existing = store[key];
    if (existing?.request_fingerprint && requestFingerprint && existing.request_fingerprint !== requestFingerprint) {
      return { kind: "conflict", key };
    }
    if (existing?.status === "running") return { kind: "running", key };
    if (existing?.status === "completed" || existing?.status === "failed") {
      return { kind: "replay", key, response: existing.response };
    }

    store[key] = { status: "running", updated_at: new Date().toISOString(), request_fingerprint: requestFingerprint };
    await writeStore(trimStore(store));
    return { kind: "execute", key };
  } finally {
    await lock.release();
  }
}

export async function finishRunnerIdempotency(
  key: string,
  status: Exclude<RunnerIdempotencyStatus, "running">,
  response: unknown,
  requestFingerprint?: string
) {
  const lock = await acquireIdempotencyLockWithRetry();

  try {
    const store = await readStore();
    pruneStore(store);
    store[key] = {
      status,
      updated_at: new Date().toISOString(),
      request_fingerprint: requestFingerprint ?? store[key]?.request_fingerprint,
      response
    };
    await writeStore(trimStore(store));
  } finally {
    await lock.release();
  }
}
