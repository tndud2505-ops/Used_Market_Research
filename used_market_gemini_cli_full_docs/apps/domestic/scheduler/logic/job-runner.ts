import { collectLatestModuleRuns } from "../../merge/logic/collectLatest.js";
import { writeCentralResult } from "../../merge/logic/resultStore.js";
import { persistMarketWorkflowResult } from "../../market/logic/result-persistence.js";
import { mergeNormalizedResults } from "../../market/logic/opportunity.js";
import { buildMarketSnapshot } from "../../market/logic/pricing.js";
import { readMarketHistoryBundle } from "../../market/logic/history-reader.js";
import { resolveSite } from "../../collector/logic/sites.js";
import path from "node:path";
import { loadConfig } from "../../MCP/logic/config.js";
import { GeminiApiProvider } from "../../MCP/logic/geminiApiProvider.js";
import { MockProvider } from "../../MCP/logic/mockProvider.js";
import { Orchestrator } from "../../MCP/logic/orchestrator.js";
import { trace, traceError } from "../../MCP/logic/runtime-trace.js";
import type { ModelProvider, NormalizedItem, NormalizedResult } from "../../MCP/logic/types.js";
import { getDefaultJobPlans, type JobPlan } from "./jobs.js";
import {
  RETRY_POLICY_TEMPLATES,
  calculateBackoffDelay,
  isRetryableError,
  type RetryPolicy
} from "./retry-policy.js";
import {
  SchedulerValidationError,
  createSchedulerMetadata,
  type SchedulerExecutionMetadata,
  type SchedulerJobStatus,
  type ValidatedJobExecutionInput,
  validateJob
} from "./schedule-config.js";
import { evaluateAlertRules, type AlertMatch } from "./alert-rules.js";

export interface JobExecutionResult {
  job_id: string;
  job_name: string;
  status: SchedulerJobStatus;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  attempts: JobAttempt[];
  error?: string;
  result_file?: string;
  notifier_event: SchedulerNotifierEvent;
  alert_matches: AlertMatch[];
}

export interface SchedulerNotifierEvent {
  run_id: string;
  job_name: string;
  status: "success" | "warning" | "failed";
  finished_at: string;
  result_path: string;
}

export interface JobAttempt {
  attempt: number;
  status: "success" | "failed";
  timestamp: string;
  error?: string;
  error_type?: string;
  delay_ms?: number;
}

export interface BatchExecutionResult extends SchedulerExecutionMetadata {
  batch_id: string;
  job_results: JobExecutionResult[];
}

type WorkflowPayload = {
  keyword?: string;
  normalized_results?: NormalizedResult[];
  merged_result?: {
    merged_items?: unknown[];
  };
  login_results?: Array<{ site?: string; login_status?: string }>;
};

type WorkflowSummary = {
  keyword: string;
  sites: string[];
  merged_items: number;
  logged_out_sites: number;
  alert_matches: Awaited<ReturnType<typeof evaluateAlertRules>>;
  payload: WorkflowPayload;
};

function createDefaultProvider(): ModelProvider {
  const config = loadConfig();
  return config.provider === "gemini" ? new GeminiApiProvider() : new MockProvider();
}

function resolveRetryPolicy(job: JobPlan): RetryPolicy {
  if (job.name.includes("market") || job.name.includes("price")) {
    return RETRY_POLICY_TEMPLATES.transient_error;
  }

  if (job.name.includes("full-pc")) {
    return {
      ...RETRY_POLICY_TEMPLATES.transient_error,
      max_attempts: 2,
      retry_on: ["TIMEOUT", "NETWORK_ERROR"]
    };
  }

  return RETRY_POLICY_TEMPLATES.transient_error;
}

function resolveRetryPolicyForError(job: JobPlan, errorType: string): RetryPolicy {
  if (errorType === "SCHEMA_ERROR" || errorType === "DATA_FORMAT_ERROR") {
    return RETRY_POLICY_TEMPLATES.schema_error;
  }

  if (errorType === "LOGIN_REQUIRED") {
    return RETRY_POLICY_TEMPLATES.login_required;
  }

  return resolveRetryPolicy(job);
}

export function resolveExecutionRetryPolicy(
  job: JobPlan,
  validatedInput?: Pick<ValidatedJobExecutionInput, "retry_count">
): RetryPolicy {
  const basePolicy = resolveRetryPolicy(job);
  if (!validatedInput) {
    return basePolicy;
  }

  // retry_count is the number of retries after the first attempt. Keep the
  // job-specific policy cap so a configuration file cannot accidentally turn
  // a high-frequency job into an unbounded retry loop.
  return {
    ...basePolicy,
    max_attempts: Math.max(1, Math.min(basePolicy.max_attempts, validatedInput.retry_count + 1))
  };
}

const PRIORITY_RANK: Record<ValidatedJobExecutionInput["priority"], number> = {
  high: 0,
  medium: 1,
  low: 2
};

export function getSchedulerPriorityRank(priority: ValidatedJobExecutionInput["priority"]): number {
  return PRIORITY_RANK[priority];
}

export async function withSchedulerTimeout<T>(
  task: Promise<T> | ((signal: AbortSignal) => Promise<T>),
  timeoutMs?: number
): Promise<T> {
  if (!timeoutMs) {
    return typeof task === "function" ? task(new AbortController().signal) : task;
  }

  const controller = new AbortController();
  const operation = typeof task === "function" ? task(controller.signal) : task;
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          const timeoutError = new Error(`Scheduler job timed out after ${timeoutMs} ms`);
          reject(timeoutError);
          controller.abort(timeoutError);
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function toNotifierStatus(status: SchedulerJobStatus): SchedulerNotifierEvent["status"] {
  if (status === "partial_success") {
    return "warning";
  }

  if (status === "validation_failed" || status === "failed") {
    return "failed";
  }

  return "success";
}

function shouldAggregateWorkflowResults(job: JobPlan, workflows: WorkflowSummary[]) {
  return job.module_chain.includes("collector")
    && job.module_chain.includes("market")
    && workflows.length > 1;
}

function buildNormalizedItemKey(site: string, item: Pick<NormalizedItem, "url" | "title" | "seller_name" | "price_value" | "posted_at">) {
  const url = item.url?.trim();
  if (url) {
    return `${site}|${url}`;
  }

  return [
    site,
    item.seller_name?.trim() ?? "",
    item.title?.trim() ?? "",
    item.price_value ?? "na",
    item.posted_at?.trim() ?? ""
  ].join("|");
}

function aggregateNormalizedResults(workflows: WorkflowSummary[], aggregateKeyword: string) {
  const bySite = new Map<string, { items: NormalizedItem[]; warnings: string[]; seen: Set<string> }>();
  let originalItemCount = 0;

  for (const workflow of workflows) {
    for (const result of workflow.payload.normalized_results ?? []) {
      if (!bySite.has(result.site)) {
        bySite.set(result.site, { items: [], warnings: [], seen: new Set<string>() });
      }

      const bucket = bySite.get(result.site)!;
      for (const warning of result.warnings ?? []) {
        if (!bucket.warnings.includes(warning)) {
          bucket.warnings.push(warning);
        }
      }

      for (const item of result.normalized_items ?? []) {
        originalItemCount += 1;
        const key = buildNormalizedItemKey(result.site, item);
        if (bucket.seen.has(key)) {
          continue;
        }

        bucket.seen.add(key);
        bucket.items.push(item);
      }
    }
  }

  const normalizedResults: NormalizedResult[] = Array.from(bySite.entries()).map(([site, bucket]) => ({
    site,
    keyword: aggregateKeyword,
    normalized_items: bucket.items,
    warnings: bucket.warnings,
    next_action: "continue",
    category: null
  }));

  const deduplicatedItemCount = normalizedResults.reduce((sum, result) => sum + result.normalized_items.length, 0);

  return {
    normalizedResults,
    originalItemCount,
    deduplicatedItemCount
  };
}

export class JobRunner {
  private readonly jobPlans = getDefaultJobPlans();
  private readonly orchestrator: Orchestrator;

  constructor(provider: ModelProvider = createDefaultProvider()) {
    this.orchestrator = new Orchestrator(provider);
  }

  getJobPlans(): JobPlan[] {
    return [...this.jobPlans];
  }

  async executeJob(
    job: JobPlan,
    jobId: string,
    prevalidatedInput?: ValidatedJobExecutionInput
  ): Promise<JobExecutionResult> {
    trace("scheduler.job:start", { job_name: job.name, job_id: jobId });
    const startTime = new Date().toISOString();
    const attempts: JobAttempt[] = [];
    let validatedInput = prevalidatedInput;
    let preflightError: unknown;

    if (!validatedInput) {
      try {
        validatedInput = await validateJob(job);
      } catch (error: unknown) {
        // Validation failures are recorded through the same result contract as
        // runtime failures, but never retried.
        preflightError = error;
      }
    }

    const retryPolicy = resolveExecutionRetryPolicy(job, validatedInput);

    let lastError: string | undefined;
    let lastErrorType: string | undefined;
    let lastPayload: unknown;
    let finalStatus: SchedulerJobStatus = "failed";
    let previousRetryPolicy = retryPolicy;

    for (let attempt = 1; attempt <= retryPolicy.max_attempts; attempt++) {
      trace("scheduler.job:attempt:start", { job_name: job.name, job_id: jobId, attempt });
      if (attempt > 1) {
        const delayMs = calculateBackoffDelay(attempt, previousRetryPolicy);
        if (delayMs > 0) {
          trace("scheduler.job:attempt:delay", { job_name: job.name, job_id: jobId, attempt, delay_ms: delayMs });
          await this.sleep(delayMs);
        }
      }

      try {
        if (preflightError) {
          throw preflightError;
        }

        lastPayload = await this.withTimeout(
          (signal) => this.runJobLogic(job, jobId, validatedInput, signal),
          validatedInput?.timeout_ms
        );
        finalStatus = this.inferJobStatus(lastPayload);

        attempts.push({
          attempt,
          status: "success",
          timestamp: new Date().toISOString()
        });
        trace("scheduler.job:attempt:success", { job_name: job.name, job_id: jobId, attempt, status: finalStatus });

        break;
      } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const errorType = this.extractErrorType(error);
        const attemptRetryPolicy = resolveRetryPolicyForError(job, errorType);
        const maxAttemptsForError = Math.min(retryPolicy.max_attempts, attemptRetryPolicy.max_attempts);
        const retryAllowed = isRetryableError(errorType, attemptRetryPolicy)
          && attempt < maxAttemptsForError;

        attempts.push({
          attempt,
          status: "failed",
          timestamp: new Date().toISOString(),
          error: errorMsg,
          error_type: errorType,
          delay_ms: retryAllowed ? calculateBackoffDelay(attempt + 1, attemptRetryPolicy) : undefined
        });

        lastError = errorMsg;
        lastErrorType = errorType;
        finalStatus = error instanceof SchedulerValidationError ? "validation_failed" : "failed";
        traceError("scheduler.job:attempt:failed", error);
        previousRetryPolicy = attemptRetryPolicy;

        if (!retryAllowed) {
          break;
        }
      }
    }

    const finishTime = new Date().toISOString();
    
    const notifierEvent: SchedulerNotifierEvent = {
      run_id: jobId,
      job_name: job.name,
      status: toNotifierStatus(finalStatus),
      finished_at: finishTime,
      result_path: path.posix.join("merge", "result", "scheduler", jobId, "output.json")
    };
    const alertMatches = this.collectAlertMatches(lastPayload);

    const result = {
      job_id: jobId,
      job_name: job.name,
      status: finalStatus,
      started_at: startTime,
      finished_at: finishTime,
      duration_ms: new Date(finishTime).getTime() - new Date(startTime).getTime(),
      attempts,
      error: lastError,
      notifier_event: notifierEvent,
      alert_matches: alertMatches
    } satisfies Omit<JobExecutionResult, "result_file">;

    const stored = await writeCentralResult({
      module: "scheduler",
      command: "job-run",
      payload: {
        job,
        result,
        output: lastPayload ?? null,
        notifier_event: {
          run_id: jobId,
          job_name: job.name,
          status: toNotifierStatus(finalStatus),
          finished_at: finishTime,
          result_path: path.posix.join("merge", "result", "scheduler", jobId, "output.json")
        }
      },
      notes: [
        `job=${job.name}`,
        `job_id=${jobId}`,
        `status=${finalStatus}`,
        ...(lastErrorType ? [`last_error_type=${lastErrorType}`] : [])
      ],
      summary: {
        status: finalStatus,
        job_name: job.name,
        attempts: attempts.length
      }
    });

    return {
      ...result,
      result_file: stored.baseDir,
      notifier_event: notifierEvent,
      alert_matches: alertMatches
    };
  }

  async executeBatch(jobsToRun?: JobPlan[]): Promise<BatchExecutionResult> {
    trace("scheduler.batch:start", { total_jobs: jobsToRun?.length ?? this.jobPlans.length });
    const batchId = `batch-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    const startTime = new Date().toISOString();
    const jobPlans = jobsToRun ?? this.jobPlans;
    const jobResults: JobExecutionResult[] = [];

    const preparedJobs = await Promise.all(jobPlans.map(async (job) => {
      try {
        return { job, validatedInput: await validateJob(job) };
      } catch {
        // Let executeJob persist the validation error. Invalid jobs retain the
        // default medium priority so one bad config does not abort the batch.
        return { job, validatedInput: undefined };
      }
    }));
    preparedJobs.sort((left, right) => {
      const leftRank = left.validatedInput
        ? getSchedulerPriorityRank(left.validatedInput.priority)
        : getSchedulerPriorityRank("medium");
      const rightRank = right.validatedInput
        ? getSchedulerPriorityRank(right.validatedInput.priority)
        : getSchedulerPriorityRank("medium");
      return leftRank - rightRank;
    });

    for (const { job, validatedInput } of preparedJobs) {
      const jobId = `${job.name}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
      try {
        jobResults.push(await this.executeJob(job, jobId, validatedInput));
      } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const status: SchedulerJobStatus = error instanceof SchedulerValidationError
          ? "validation_failed"
          : "failed";
        jobResults.push({
          job_id: jobId,
          job_name: job.name,
          status,
          started_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
          duration_ms: 0,
          attempts: [],
          error: `Unexpected error: ${errorMsg}`,
          notifier_event: {
            run_id: jobId,
            job_name: job.name,
            status: status === "validation_failed" ? "failed" : "failed",
            finished_at: new Date().toISOString(),
            result_path: path.posix.join("merge", "result", "scheduler", jobId, "output.json")
          },
          alert_matches: []
        });
      }
    }

    const finishTime = new Date().toISOString();
    const metadata = createSchedulerMetadata(
      batchId,
      startTime,
      finishTime,
      jobResults.map((result) => ({
        name: result.job_name,
        status: result.status,
        duration_ms: result.duration_ms,
        error: result.error
      }))
    );

    await writeCentralResult({
      module: "scheduler",
      command: "batch-run",
      payload: {
        batch_id: batchId,
        metadata,
        job_results: jobResults
      },
      notes: [
        `batch_id=${batchId}`,
        `jobs=${jobResults.length}`,
        `status=${metadata.status}`,
        `success_ratio=${metadata.success_ratio}`
      ],
      summary: {
        status: metadata.status,
        total_jobs: metadata.total_jobs,
        failed_jobs: metadata.failed_jobs,
        partial_jobs: metadata.partial_jobs
      }
    });

    return {
      ...metadata,
      batch_id: batchId,
      job_results: jobResults
    };
  }

  private async runJobLogic(
    job: JobPlan,
    jobId: string,
    validatedInput?: ValidatedJobExecutionInput,
    signal?: AbortSignal
  ): Promise<unknown> {
    const validated = validatedInput ?? await validateJob(job);

    if (job.name.includes("price-refresh") || job.name.includes("market-snapshot")) {
      const latest = await collectLatestModuleRuns();
      const history = await readMarketHistoryBundle();
      const refreshStatus = latest.market && history.history_points.some((point) => point.source === "observed")
        ? "success"
        : "partial_success";
      const refreshStored = await writeCentralResult({
        module: "market-history",
        command: "refresh",
        payload: {
          job_id: jobId,
          latest_market_run_id: history.latest_run_id ?? null,
          history_summary: history.summary,
          history_points: history.history_points,
          refreshed_at: new Date().toISOString()
        },
        notes: [
          `job=${job.name}`,
          `status=${refreshStatus}`,
          `history_points=${history.history_points.length}`
        ],
        summary: {
          status: refreshStatus,
          latest_market_run_id: history.latest_run_id ?? null,
          history_points: history.history_points.length
        }
      });
      return {
        job_id: jobId,
        job_name: job.name,
        mode: "price-history-refresh",
        validated_input: validated,
        latest_runs: latest,
        price_refresh: {
          status: refreshStatus,
          latest_market_run_id: history.latest_run_id ?? null,
          observed_window_count: history.history_points.filter((point) => point.source === "observed").length,
          refreshed_at: new Date().toISOString(),
          refresh_run_id: refreshStored.runId,
          refresh_base_dir: refreshStored.baseDir
        }
      };
    }

    const workflows: WorkflowSummary[] = [];
    for (const keyword of validated.keywords) {
      signal?.throwIfAborted();
      const workflow = await this.orchestrator.fullWorkflow({
        keyword,
        sites: validated.sites,
        limit: validated.limit
      }, { signal });
      signal?.throwIfAborted();
      const mergedResult = workflow.merged_result as { merged_items?: unknown[] } | undefined;
      const loginResults = workflow.login_results as Array<{ site?: string; login_status?: string }> | undefined;
      const mergedItems = Array.isArray(mergedResult?.merged_items)
        ? mergedResult.merged_items
        : [];
      const alertMatches = await evaluateAlertRules(mergedItems as Parameters<typeof evaluateAlertRules>[0]);

      workflows.push({
        keyword,
        sites: validated.sites,
        merged_items: mergedItems.length,
        logged_out_sites: Array.isArray(loginResults)
          ? loginResults.filter((result) => result.login_status === "logged_out").length
          : 0,
        alert_matches: alertMatches,
        payload: workflow
      });
    }

    let aggregate_market_result_ref: Record<string, unknown> | null = null;
    if (shouldAggregateWorkflowResults(job, workflows)) {
      const aggregateKeyword = job.name;
      const aggregated = aggregateNormalizedResults(workflows, aggregateKeyword);

      if (aggregated.normalizedResults.length > 0 && aggregated.deduplicatedItemCount > 0) {
        const mergedResult = mergeNormalizedResults(aggregateKeyword, aggregated.normalizedResults);
        const marketSnapshot = buildMarketSnapshot(aggregateKeyword, mergedResult);
        const stored = await persistMarketWorkflowResult({
          keyword: aggregateKeyword,
          normalizedResults: aggregated.normalizedResults,
          mergedResult,
          marketSnapshot
        });

        aggregate_market_result_ref = {
          keyword: aggregateKeyword,
          source_keywords: validated.keywords,
          run_id: stored.runId,
          base_dir: stored.baseDir,
          normalized_sites: aggregated.normalizedResults.length,
          original_item_count: aggregated.originalItemCount,
          deduplicated_item_count: aggregated.deduplicatedItemCount,
          merged_items: mergedResult.merged_items.length,
          duplicate_count: aggregated.originalItemCount - aggregated.deduplicatedItemCount
        };
      }
    }

    return {
      job_id: jobId,
      job_name: job.name,
      validated_input: validated,
      workflows,
      aggregate_market_result_ref
    };
  }

  private inferJobStatus(payload: unknown): SchedulerJobStatus {
    const priceRefreshStatus = (payload as { price_refresh?: { status?: SchedulerJobStatus } } | null)?.price_refresh?.status;
    if (priceRefreshStatus) return priceRefreshStatus;
    const workflows = (payload as { workflows?: Array<{ payload?: { login_results?: Array<{ site?: string; login_status?: string }> } }> }).workflows;
    if (!Array.isArray(workflows) || workflows.length === 0) {
      return "success";
    }

    const hasLoggedOutSite = workflows.some((workflow) =>
      Array.isArray(workflow.payload?.login_results) &&
      workflow.payload.login_results.some((result) => {
        if (result.login_status !== "logged_out") {
          return false;
        }

        if (!result.site) {
          return true;
        }

        try {
          return resolveSite(result.site).loginRequired;
        } catch {
          return true;
        }
      })
    );

    return hasLoggedOutSite ? "partial_success" : "success";
  }

  private collectAlertMatches(payload: unknown): AlertMatch[] {
    if (!payload || typeof payload !== "object") {
      return [];
    }

    const workflows = (payload as { workflows?: Array<{ alert_matches?: AlertMatch[] }> }).workflows;
    if (!Array.isArray(workflows)) {
      return [];
    }

    const matches: AlertMatch[] = [];
    const seen = new Set<string>();
    for (const workflow of workflows) {
      for (const match of workflow.alert_matches ?? []) {
        const key = `${match.rule_id}|${match.item_url}|${match.channels.join(",")}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        matches.push(match);
      }
    }

    return matches;
  }

  private extractErrorType(error: unknown): string {
    if (error instanceof SchedulerValidationError) {
      return error.code;
    }

    const errorMsg = error instanceof Error ? error.message : String(error);
    const normalized = errorMsg.toLowerCase();
    if (/timeout|timed out|aborted|aborterror/.test(normalized)) return "TIMEOUT";
    if (/network|fetch failed|econnreset|econnrefused|enotfound|socket/.test(normalized)) return "NETWORK_ERROR";
    if (/rate limit|too many requests|\b429\b/.test(normalized)) return "RATE_LIMIT";
    if (/schema/.test(normalized)) return "SCHEMA_ERROR";
    if (/data[ -]?format|malformed payload|invalid response shape/.test(normalized)) return "DATA_FORMAT_ERROR";
    if (/temporary|temporarily/.test(normalized)) return "TEMPORARY_ERROR";
    if (/login required|logged out|not logged in/.test(normalized)) return "LOGIN_REQUIRED";
    if (/validation/.test(normalized)) return "VALIDATION_ERROR";
    if (/auth|unauthorized|forbidden|\b401\b|\b403\b/.test(normalized)) return "AUTHENTICATION_ERROR";
    if (/not found|enoent|\b404\b/.test(normalized)) return "FILE_NOT_FOUND";
    return "UNKNOWN_ERROR";
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async withTimeout<T>(task: (signal: AbortSignal) => Promise<T>, timeoutMs?: number): Promise<T> {
    return withSchedulerTimeout(task, timeoutMs);
  }
}

export function getJobRunnerDraft() {
  const runner = new JobRunner();
  return {
    runner,
    plans: runner.getJobPlans(),
    notes: ["preflight validation, retry policy, and scheduler result persistence are implemented"]
  };
}
