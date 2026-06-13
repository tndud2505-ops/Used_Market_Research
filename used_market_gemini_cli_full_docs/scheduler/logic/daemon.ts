import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import cron from "node-cron";
import type { ScheduledTask } from "node-cron";
import { JobRunner, type SchedulerNotifierEvent } from "./job-runner.js";
import type { JobPlan } from "./jobs.js";
import { dispatchSchedulerAlertMatches } from "./hooks.js";
import { createReporterDaemon } from "../../reporter/logic/daemon.js";
import { trace, traceError } from "../../MCP/logic/runtime-trace.js";

export interface RegisteredJobSchedule {
  job_name: string;
  cron_expression: string;
  cron_hint: string;
  task: ScheduledTask;
}

export interface SchedulerDaemonOptions {
  timezone?: string;
  jobRunner?: JobRunner;
  onJobStart?: (job: JobPlan, runId: string) => void;
  onJobComplete?: (job: JobPlan, runId: string, event: SchedulerNotifierEvent) => void;
  onJobError?: (job: JobPlan, error: unknown) => void;
  runReporterAfterJob?: (job: JobPlan, runId: string, options: { sendDispatch: boolean; sendSummary: boolean }) => Promise<void>;
}

export interface SchedulerJobRuntimeState {
  job_name: string;
  cron_expression: string;
  cron_hint: string;
  is_running: boolean;
  run_count: number;
  last_started_at?: string;
  last_finished_at?: string;
  last_status?: "success" | "failed" | "partial_success" | "validation_failed";
  last_error?: string;
  last_result_file?: string;
  last_notifier_event?: SchedulerNotifierEvent;
}

export interface SchedulerDaemonStatus {
  started: boolean;
  timezone: string;
  total_jobs: number;
  running_jobs: string[];
  daemon_pid?: number;
  daemon_started_at?: string;
  jobs: SchedulerJobRuntimeState[];
}

const CRON_BY_JOB_NAME: Record<string, string> = {
  "gpu-fast-scan": "0 */2 * * *",
  "cpu-scan": "10 */2 * * *",
  "ram-scan": "20 */2 * * *",
  "ssd-scan": "30 */2 * * *",
  "psu-scan": "40 */2 * * *",
  "full-pc-scan": "50 */2 * * *",
  "daily-price-refresh": "0 2 * * *"
};

function shouldTriggerReporterAfterJob(job: JobPlan) {
  return job.module_chain.includes("collector") && job.module_chain.includes("market");
}

function shouldSendSummaryAfterJob(job: JobPlan) {
  return job.name === "full-pc-scan";
}

export function getCronExpressionForJob(job: JobPlan): string {
  const cronExpression = CRON_BY_JOB_NAME[job.name];
  if (!cronExpression) {
    throw new Error(`No cron expression registered for scheduler job: ${job.name}`);
  }

  if (!cron.validate(cronExpression)) {
    throw new Error(`Invalid cron expression for scheduler job ${job.name}: ${cronExpression}`);
  }

  return cronExpression;
}

export class SchedulerDaemon {
  private readonly timezone: string;
  private readonly jobRunner: JobRunner;
  private readonly jobPlans: JobPlan[];
  private readonly runningJobs = new Set<string>();
  private readonly jobStates = new Map<string, SchedulerJobRuntimeState>();
  private daemonStartedAt?: string;
  private registeredSchedules: RegisteredJobSchedule[] = [];
  private started = false;

  constructor(private readonly options: SchedulerDaemonOptions = {}) {
    this.timezone = options.timezone ?? process.env.SCHEDULER_TIMEZONE ?? "Asia/Seoul";
    this.jobRunner = options.jobRunner ?? new JobRunner();
    this.jobPlans = this.jobRunner.getJobPlans();
    this.loadPersistedStatus();
  }

  getJobPlans(): JobPlan[] {
    return [...this.jobPlans];
  }

  getRegisteredSchedules(): Array<Pick<RegisteredJobSchedule, "job_name" | "cron_expression" | "cron_hint">> {
    return this.registeredSchedules.map(({ job_name, cron_expression, cron_hint }) => ({
      job_name,
      cron_expression,
      cron_hint
    }));
  }

  isStarted(): boolean {
    return this.started;
  }

  getStatusSnapshot(): SchedulerDaemonStatus {
    return {
      started: this.started,
      timezone: this.timezone,
      total_jobs: this.jobPlans.length,
      running_jobs: [...this.runningJobs],
      daemon_pid: this.started ? process.pid : undefined,
      daemon_started_at: this.daemonStartedAt,
      jobs: this.jobPlans.map((job) => {
        const existing = this.jobStates.get(job.name);
        return existing ?? {
          job_name: job.name,
          cron_expression: getCronExpressionForJob(job),
          cron_hint: job.cron_hint,
          is_running: false,
          run_count: 0
        };
      })
    };
  }

  start(): RegisteredJobSchedule[] {
    if (this.started) {
      trace("scheduler.daemon:start:already-running");
      return [...this.registeredSchedules];
    }

    trace("scheduler.daemon:start", {
      timezone: this.timezone,
      total_jobs: this.jobPlans.length
    });
    this.registeredSchedules = this.jobPlans.map((job) => {
      const cronExpression = getCronExpressionForJob(job);
      this.ensureJobState(job, cronExpression);
      const task = cron.schedule(
        cronExpression,
        () => {
          void this.executeScheduledJob(job);
        },
        {
          timezone: this.timezone
        }
      );

      return {
        job_name: job.name,
        cron_expression: cronExpression,
        cron_hint: job.cron_hint,
        task
      };
    });

    this.started = true;
    this.daemonStartedAt = new Date().toISOString();
    this.persistStatus();
    void this.runAllNow();
    return [...this.registeredSchedules];
  }

  stop(): void {
    trace("scheduler.daemon:stop", { registered_jobs: this.registeredSchedules.length });
    for (const schedule of this.registeredSchedules) {
      schedule.task.stop();
      schedule.task.destroy();
    }

    this.registeredSchedules = [];
    this.runningJobs.clear();
    this.started = false;
    this.daemonStartedAt = undefined;
    this.persistStatus();
  }

  async runAllNow(): Promise<void> {
    trace("scheduler.daemon:runAllNow", { total_jobs: this.jobPlans.length });
    for (const job of this.jobPlans) {
      await this.executeScheduledJob(job);
    }
  }

  private async executeScheduledJob(job: JobPlan): Promise<void> {
    if (this.runningJobs.has(job.name)) {
      trace("scheduler.daemon:job:skip-already-running", { job_name: job.name });
      return;
    }

    const runId = `${job.name}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    const state = this.ensureJobState(job);
    state.is_running = true;
    state.last_started_at = new Date().toISOString();
    this.runningJobs.add(job.name);
    this.persistStatus();
    trace("scheduler.daemon:job:start", { job_name: job.name, run_id: runId });
    this.options.onJobStart?.(job, runId);

    try {
      const result = await this.jobRunner.executeJob(job, runId);
      state.run_count += 1;
      state.last_finished_at = new Date().toISOString();
      state.last_status = result.status;
      state.last_error = result.error;
      state.last_result_file = result.result_file;
      state.last_notifier_event = result.notifier_event;
      this.persistStatus();
      const alertDispatch = await dispatchSchedulerAlertMatches(job.name, runId, result.alert_matches);
      let reporterTriggered = false;
      if (shouldTriggerReporterAfterJob(job) && (result.status === "success" || result.status === "partial_success")) {
        const reporterOptions = {
          sendDispatch: true,
          sendSummary: shouldSendSummaryAfterJob(job)
        };
        try {
          if (this.options.runReporterAfterJob) {
            await this.options.runReporterAfterJob(job, runId, reporterOptions);
          } else {
            await createReporterDaemon().runOnce(reporterOptions);
          }
          reporterTriggered = true;
        } catch (reporterError) {
          traceError(`scheduler.daemon:reporter:failed:${job.name}`, reporterError);
        }
      }
      trace("scheduler.daemon:job:complete", {
        job_name: job.name,
        run_id: runId,
        status: result.status,
        result_file: result.result_file,
        alert_matches: result.alert_matches.length,
        alert_sent: alertDispatch.sent,
        alert_failed: alertDispatch.failed,
        reporter_triggered: reporterTriggered
      });
      this.options.onJobComplete?.(job, runId, result.notifier_event);
    } catch (error) {
      state.run_count += 1;
      state.last_finished_at = new Date().toISOString();
      state.last_status = "failed";
      state.last_error = error instanceof Error ? error.message : String(error);
      this.persistStatus();
      traceError(`scheduler.daemon:job:failed:${job.name}`, error);
      this.options.onJobError?.(job, error);
    } finally {
      state.is_running = false;
      this.runningJobs.delete(job.name);
      this.persistStatus();
    }
  }

  private ensureJobState(job: JobPlan, cronExpression = getCronExpressionForJob(job)): SchedulerJobRuntimeState {
    const existing = this.jobStates.get(job.name);
    if (existing) {
      existing.cron_expression = cronExpression;
      existing.cron_hint = job.cron_hint;
      return existing;
    }

    const created: SchedulerJobRuntimeState = {
      job_name: job.name,
      cron_expression: cronExpression,
      cron_hint: job.cron_hint,
      is_running: false,
      run_count: 0
    };
    this.jobStates.set(job.name, created);
    return created;
  }

  private getPersistencePath(): string {
    return process.env.SCHEDULER_DAEMON_STATUS_FILE
      ? path.resolve(process.env.SCHEDULER_DAEMON_STATUS_FILE)
      : path.resolve(process.cwd(), "merge/result/scheduler/daemon-status.json");
  }

  private loadPersistedStatus(): void {
    try {
      const filePath = this.getPersistencePath();
      const raw = readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw) as Partial<SchedulerDaemonStatus>;
      // Persisted flag is historical; runtime should always boot as stopped
      // and register fresh cron tasks in start().
      this.started = false;
      this.daemonStartedAt = parsed.daemon_started_at;

      for (const job of parsed.jobs ?? []) {
        if (!job?.job_name) continue;
        this.jobStates.set(job.job_name, {
          job_name: job.job_name,
          cron_expression: job.cron_expression ?? getCronExpressionForJob(this.jobPlans.find((plan) => plan.name === job.job_name) ?? this.jobPlans[0]),
          cron_hint: job.cron_hint ?? this.jobPlans.find((plan) => plan.name === job.job_name)?.cron_hint ?? "",
          is_running: false,
          run_count: job.run_count ?? 0,
          last_started_at: job.last_started_at,
          last_finished_at: job.last_finished_at,
          last_status: job.last_status,
          last_error: job.last_error,
          last_result_file: job.last_result_file
        });
      }
    } catch {
      // No persisted daemon status yet.
    }
  }

  private persistStatus(): void {
    const filePath = this.getPersistencePath();
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(this.getStatusSnapshot(), null, 2), "utf-8");
  }
}

export function createSchedulerDaemon(options?: SchedulerDaemonOptions) {
  return new SchedulerDaemon(options);
}

export function getDaemonStatusFilePath() {
  return process.env.SCHEDULER_DAEMON_STATUS_FILE
    ? path.resolve(process.env.SCHEDULER_DAEMON_STATUS_FILE)
    : path.resolve(process.cwd(), "merge/result/scheduler/daemon-status.json");
}

export function readPersistedDaemonStatus(): SchedulerDaemonStatus | null {
  try {
    const raw = readFileSync(getDaemonStatusFilePath(), "utf-8");
    return JSON.parse(raw) as SchedulerDaemonStatus;
  } catch {
    return null;
  }
}

export function getDaemonDraft() {
  const daemon = new SchedulerDaemon();
  return {
    timezone: process.env.SCHEDULER_TIMEZONE ?? "Asia/Seoul",
    jobs: daemon.getJobPlans().map((job) => ({
      name: job.name,
      cron_hint: job.cron_hint,
      cron_expression: getCronExpressionForJob(job)
    }))
  };
}
