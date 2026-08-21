import { randomUUID } from "node:crypto";
import { getSchedulerPriorityRank, JobRunner, type JobExecutionResult } from "../../scheduler/logic/job-runner.js";
import { getDefaultJobPlans, type JobPlan } from "../../scheduler/logic/jobs.js";
import { validateJob } from "../../scheduler/logic/schedule-config.js";
import { dispatchSchedulerAlertMatches, type SchedulerAlertDispatchSummary } from "../../scheduler/logic/hooks.js";
import { createReporterDaemon } from "../../reporter/logic/daemon.js";
import { updateCentralRunSummary } from "../../merge/logic/resultStore.js";
import { finishRunnerIdempotency, reserveRunnerIdempotency } from "./runner-idempotency.js";
import { acquireSchedulerJobLock } from "../../scheduler/logic/job-lock.js";

const jobRunner = new JobRunner();
const jobPlans = new Map<string, JobPlan>(getDefaultJobPlans().map((job) => [job.name, job]));
const runningJobs = new Set<string>();

export class RunnerValidationError extends Error {
  constructor(public readonly code: "UNKNOWN_JOB" | "EMPTY_JOB_LIST", message: string) {
    super(message);
    this.name = "RunnerValidationError";
  }
}

export class RunnerIdempotencyConflictError extends Error {
  constructor() {
    super('Idempotency-Key was already used for a different scheduler job list');
    this.name = 'RunnerIdempotencyConflictError';
  }
}

interface RunnerPostprocessSummary {
  alert_dispatch: SchedulerAlertDispatchSummary;
  reporter_triggered: boolean;
  warnings: string[];
}

export interface RunnerBatchResult {
  status: "completed" | "partial_success" | "failed";
  job_names: string[];
  results: Array<Awaited<ReturnType<typeof runNamedSchedulerJob>>>;
  error?: string;
}

export async function runNamedSchedulerJob(jobName: string): Promise<{
  status: "completed" | "partial_success" | "failed" | "already_running";
  job_name: string;
  result?: JobExecutionResult;
  postprocess?: RunnerPostprocessSummary;
}> {
  const job = jobPlans.get(jobName);
  if (!job) {
    throw new RunnerValidationError("UNKNOWN_JOB", `Unknown scheduler job: ${jobName}`);
  }

  if (runningJobs.has(job.name)) {
    return { status: "already_running", job_name: job.name };
  }

  const jobLock = await acquireSchedulerJobLock(job.name);
  if (!jobLock) {
    return { status: "already_running", job_name: job.name };
  }

  const jobId = `${job.name}-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  runningJobs.add(job.name);
  try {
    const result = await jobRunner.executeJob(job, jobId);
    const baseStatus = result.status === "failed" || result.status === "validation_failed"
      ? "failed"
      : result.status === "partial_success"
        ? "partial_success"
        : "completed";
    const warnings: string[] = [];
    const alertDispatch = await dispatchSchedulerAlertMatches(job.name, jobId, result.alert_matches);
    if (alertDispatch.failed > 0) {
      warnings.push(`alert_dispatch_failed:${alertDispatch.failed}`);
    }

  let reporterTriggered = false;
    if (job.module_chain.includes("collector") && job.module_chain.includes("market")
      && (result.status === "success" || result.status === "partial_success")) {
      try {
        const reporterResult = await createReporterDaemon().runOnce({
          sendDispatch: true,
          sendSummary: job.name === "full-pc-scan"
        });
        reporterTriggered = reporterResult.status === "success";
        if (reporterResult.status !== "success") {
          warnings.push(`reporter_${reporterResult.status}`);
        }
      } catch (error) {
        warnings.push(`reporter_failed:${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const status = baseStatus === "completed" && warnings.length > 0
      ? "partial_success"
      : baseStatus;
    const postprocess = {
      alert_dispatch: alertDispatch,
      reporter_triggered: reporterTriggered,
      warnings
    } satisfies RunnerPostprocessSummary;
    if (result.result_file) {
      await updateCentralRunSummary(result.result_file, {
        status: status === "completed" ? "success" : status,
        postprocess
      });
    }
    return {
      status,
      job_name: job.name,
      result,
      postprocess
    };
  } finally {
    runningJobs.delete(job.name);
    await jobLock.release();
  }
}

export async function runNamedSchedulerJobs(jobNames: string[], options: { idempotencyKey?: string } = {}): Promise<RunnerBatchResult> {
  const uniqueJobNames = [...new Set(jobNames.map((name) => name.trim()).filter(Boolean))];
  if (uniqueJobNames.length === 0) {
    throw new RunnerValidationError("EMPTY_JOB_LIST", "At least one scheduler job is required");
  }

  const prepared = await Promise.all(uniqueJobNames.map(async (jobName) => {
    const job = jobPlans.get(jobName);
    if (!job) throw new RunnerValidationError("UNKNOWN_JOB", `Unknown scheduler job: ${jobName}`);
    let priority: "high" | "medium" | "low" = "medium";
    try {
      priority = (await validateJob(job)).priority;
    } catch {
      // executeJob persists the validation error; invalid inputs run after valid high-priority jobs.
    }
    return { jobName, priority };
  }));
  prepared.sort((left, right) => getSchedulerPriorityRank(left.priority) - getSchedulerPriorityRank(right.priority));

  const idempotencyKey = options.idempotencyKey?.trim();
  const requestFingerprint = JSON.stringify([...uniqueJobNames].sort());
  const reservation = idempotencyKey ? await reserveRunnerIdempotency(idempotencyKey, requestFingerprint) : null;
  if (reservation?.kind === 'conflict') {
    throw new RunnerIdempotencyConflictError();
  }
  if (reservation?.kind === "replay") {
    return reservation.response as RunnerBatchResult;
  }
  if (reservation?.kind === "running") {
    return {
      status: "partial_success" as const,
      job_names: prepared.map(({ jobName }) => jobName),
      results: prepared.map(({ jobName }) => ({ status: "already_running" as const, job_name: jobName }))
    };
  }
  const activeIdempotencyKey = reservation?.kind === "execute" ? reservation.key : undefined;

  try {
    const results = [];
    for (const { jobName } of prepared) {
      results.push(await runNamedSchedulerJob(jobName));
    }

    const status: RunnerBatchResult["status"] = results.some((result) => result.status === "failed")
      ? "failed"
      : results.some((result) => result.status === "partial_success" || result.status === "already_running")
        ? "partial_success"
        : "completed";

    const response = {
      status,
      job_names: prepared.map(({ jobName }) => jobName),
      results
    };
    if (activeIdempotencyKey) {
      await finishRunnerIdempotency(activeIdempotencyKey, status === "failed" ? "failed" : "completed", response, requestFingerprint);
    }
    return response;
  } catch (error) {
    if (activeIdempotencyKey) {
      await finishRunnerIdempotency(activeIdempotencyKey, "failed", {
        status: "failed",
        job_names: prepared.map(({ jobName }) => jobName),
        error: error instanceof Error ? error.message : String(error)
      }, requestFingerprint);
    }
    throw error;
  }
}

export function getRunnerState() {
  return {
    configured: Boolean(process.env.CLOUDFLARE_RUNNER_TOKEN?.trim()),
    coordination_scope: 'same-host-shared-filesystem',
    coordination_warning: 'Multiple containers or hosts require a shared database, KV, or Durable Object for distributed locking and idempotency.',
    running_jobs: [...runningJobs],
    jobs: [...jobPlans.values()].map((job) => ({
      name: job.name,
      cron_hint: job.cron_hint,
      purpose: job.purpose
    }))
  };
}
