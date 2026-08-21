import { mkdir, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";

export interface SchedulerJobLock {
  release(): Promise<void>;
}

function getLockDirectory() {
  return path.resolve(
    process.env.SCHEDULER_LOCK_DIR ?? path.join(process.cwd(), "merge", "result", "scheduler", "locks")
  );
}

function getLockPath(jobName: string) {
  const safeName = jobName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(getLockDirectory(), `${safeName}.lock`);
}

function lockOwnerIsAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function isStaleLock(lockPath: string) {
  try {
    const raw = await readFile(lockPath, "utf8");
    const parsed = JSON.parse(raw) as { pid?: unknown };
    return typeof parsed.pid !== "number" || !lockOwnerIsAlive(parsed.pid);
  } catch {
    return true;
  }
}

export async function acquireSchedulerJobLock(jobName: string): Promise<SchedulerJobLock | null> {
  const lockPath = getLockPath(jobName);
  await mkdir(getLockDirectory(), { recursive: true });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx");
      await handle.writeFile(JSON.stringify({
        pid: process.pid,
        job_name: jobName,
        acquired_at: new Date().toISOString()
      }), "utf8");

      let released = false;
      return {
        async release() {
          if (released) return;
          released = true;
          await handle.close().catch(() => undefined);
          await unlink(lockPath).catch(() => undefined);
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" || !(await isStaleLock(lockPath))) {
        return null;
      }
      await unlink(lockPath).catch(() => undefined);
    }
  }

  return null;
}
