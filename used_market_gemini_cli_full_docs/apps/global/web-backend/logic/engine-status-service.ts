import { readFile, stat } from 'node:fs/promises';
import { getDefaultJobPlans } from '../../scheduler/logic/jobs.js';
import { getDaemonStatusFilePath } from '../../scheduler/logic/daemon.js';

type EngineJob = {
  job_name: string;
  last_status?: string;
  is_running?: boolean;
  run_count?: number;
  last_finished_at?: string;
  last_error?: string;
};

type EngineStatusFile = {
  started?: boolean;
  timezone?: string;
  jobs?: EngineJob[];
};

export async function getEngineStatus() {
  const status = await readStatusFile();
  const draft = status?.jobs?.length ? null : await readDraft();
  const fileInfo = await readStatusFileInfo();
  const jobs = status?.jobs ?? draft?.jobs ?? [];
  const lastFinished = jobs
    .map((job) => job.last_finished_at)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;

  return {
    status: 'success',
    data: {
      engine: 'computer-price-engine',
      running: Boolean(status?.started),
      state: status ? (status.started ? 'running' : 'stopped') : 'not_started',
      timezone: status?.timezone ?? 'Asia/Seoul',
      schedule: 'PC·GPU·CPU·RAM·SSD 수집 / 2시간 주기',
      last_finished_at: lastFinished,
      status_file_updated_at: fileInfo?.mtime.toISOString() ?? null,
      jobs: jobs.map((job) => ({
        name: job.job_name,
        status: job.last_status ?? 'waiting',
        is_running: Boolean(job.is_running),
        run_count: job.run_count ?? 0,
        last_finished_at: job.last_finished_at ?? null,
        last_error: job.last_error ?? null
      }))
    }
  };
}

async function readStatusFile() {
  try {
    return JSON.parse(await readFile(getDaemonStatusFilePath(), 'utf-8')) as EngineStatusFile;
  } catch {
    return null;
  }
}

async function readStatusFileInfo() {
  try {
    return await stat(getDaemonStatusFilePath());
  } catch {
    return null;
  }
}

async function readDraft() {
  return {
    jobs: getDefaultJobPlans().map((job) => ({
      job_name: job.name,
      last_status: 'waiting',
      is_running: false,
      run_count: 0
    })) as EngineJob[]
  };
}
