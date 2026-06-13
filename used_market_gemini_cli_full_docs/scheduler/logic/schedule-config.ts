import { readFile } from "node:fs/promises";
import path from "node:path";
import { listSupportedSites } from "../../collector/logic/sites.js";
import { readMarketHistoryBundle } from "../../market/logic/history-reader.js";
import type { JobPlan } from "./jobs.js";

export type SchedulerJobStatus = "success" | "failed" | "partial_success" | "validation_failed";
export type SchedulerJobPriority = "high" | "medium" | "low";

export interface SchedulerExecutionMetadata {
  execution_id: string;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  total_jobs: number;
  successful_jobs: number;
  failed_jobs: number;
  success_ratio: number;
  failed_job_names: string[];
  job_details: Array<{
    job_name: string;
    status: SchedulerJobStatus;
    duration_ms: number;
    error?: string;
  }>;
  notes?: string;
}

export interface SchedulerInputOverride {
  site?: string;
  sites?: string[];
  keyword?: string;
  keywords?: string[];
  limit?: number;
  priority?: SchedulerJobPriority;
  retry_count?: number;
  timeout_ms?: number;
}

export interface ValidatedJobExecutionInput {
  job_name: string;
  sites: string[];
  keywords: string[];
  limit: number;
  priority: SchedulerJobPriority;
  retry_count: number;
  timeout_ms: number;
}

interface SchedulerInputsFile {
  jobs?: Record<string, SchedulerInputOverride>;
}

export class SchedulerValidationError extends Error {
  constructor(
    public readonly code: "INVALID_SITE" | "INVALID_KEYWORDS" | "INVALID_KEYWORD" | "PLACEHOLDER_INPUT" | "INVALID_LIMIT" | "INVALID_PRIORITY" | "INVALID_RETRY_COUNT" | "INVALID_TIMEOUT",
    message: string,
    public readonly suggestion?: string
  ) {
    super(message);
    this.name = "SchedulerValidationError";
  }
}

const PLACEHOLDER_PATTERN = /\{[^}]+\}/;
const VALID_PRIORITIES = new Set<SchedulerJobPriority>(["high", "medium", "low"]);
const DEFAULT_LIMIT = 10;
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_RETRY_COUNT = 2;

function getSupportedSiteKeys() {
  return listSupportedSites().map((site) => site.key);
}

function containsPlaceholder(value: string) {
  return PLACEHOLDER_PATTERN.test(value);
}

async function readSchedulerInputsFile(): Promise<SchedulerInputsFile> {
  const inputPath = process.env.SCHEDULER_INPUTS_FILE
    ? path.resolve(process.env.SCHEDULER_INPUTS_FILE)
    : path.resolve(process.cwd(), "scheduler/inputs.json");

  try {
    const raw = await readFile(inputPath, "utf-8");
    const parsed = JSON.parse(raw) as SchedulerInputsFile;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

function validateSites(jobName: string, sites: string[]) {
  if (sites.length === 0) {
    throw new SchedulerValidationError(
      "INVALID_SITE",
      `Job "${jobName}" must define at least one site`,
      `Use one of: ${getSupportedSiteKeys().join(", ")}`
    );
  }

  const validSites = getSupportedSiteKeys();
  for (const site of sites) {
    if (typeof site !== "string" || site.trim() === "") {
      throw new SchedulerValidationError("INVALID_SITE", `Job "${jobName}" contains an empty site value`);
    }
    if (containsPlaceholder(site)) {
      throw new SchedulerValidationError(
        "PLACEHOLDER_INPUT",
        `Job "${jobName}" contains placeholder site input: ${site}`,
        `Use one of: ${validSites.join(", ")}`
      );
    }
    if (!validSites.includes(site)) {
      throw new SchedulerValidationError(
        "INVALID_SITE",
        `Job "${jobName}" contains unsupported site: ${site}`,
        `Use one of: ${validSites.join(", ")}`
      );
    }
  }
}

function validateKeywords(jobName: string, keywords: string[]) {
  if (keywords.length === 0) {
    throw new SchedulerValidationError(
      "INVALID_KEYWORDS",
      `Job "${jobName}" must define at least one keyword`
    );
  }

  for (const keyword of keywords) {
    if (typeof keyword !== "string" || keyword.trim() === "") {
      throw new SchedulerValidationError(
        "INVALID_KEYWORD",
        `Job "${jobName}" contains an empty keyword`
      );
    }
    if (containsPlaceholder(keyword)) {
      throw new SchedulerValidationError(
        "PLACEHOLDER_INPUT",
        `Job "${jobName}" contains placeholder keyword input: ${keyword}`,
        "Provide concrete search keywords"
      );
    }
  }
}

function validateLimit(jobName: string, limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new SchedulerValidationError(
      "INVALID_LIMIT",
      `Job "${jobName}" limit must be an integer between 1 and 100`,
      `Received: ${String(limit)}`
    );
  }
}

function validatePriority(jobName: string, priority: SchedulerJobPriority) {
  if (!VALID_PRIORITIES.has(priority)) {
    throw new SchedulerValidationError(
      "INVALID_PRIORITY",
      `Job "${jobName}" priority must be high, medium, or low`
    );
  }
}

function validateRetryCount(jobName: string, retryCount: number) {
  if (!Number.isInteger(retryCount) || retryCount < 0 || retryCount > 5) {
    throw new SchedulerValidationError(
      "INVALID_RETRY_COUNT",
      `Job "${jobName}" retry_count must be between 0 and 5`
    );
  }
}

function validateTimeout(jobName: string, timeoutMs: number) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 600_000) {
    throw new SchedulerValidationError(
      "INVALID_TIMEOUT",
      `Job "${jobName}" timeout_ms must be between 1000 and 600000`
    );
  }
}

function buildBaseKeywords(job: JobPlan, override?: SchedulerInputOverride) {
  if (override?.keywords?.length) return override.keywords;
  if (override?.keyword) return [override.keyword];
  return job.keywords ?? [];
}

async function buildDiscoveredKeywords(job: JobPlan) {
  if (!job.component_type) return [];

  const historyBundle = await readMarketHistoryBundle();
  return historyBundle.discovered_keywords
    .filter((keyword) => keyword.component_type === job.component_type && keyword.auto_search_candidate)
    .map((keyword) => keyword.canonical_name);
}

function buildBaseSites(override?: SchedulerInputOverride) {
  if (override?.sites?.length) return override.sites;
  if (override?.site) return [override.site];
  return getSupportedSiteKeys();
}

export async function validateJob(job: JobPlan): Promise<ValidatedJobExecutionInput> {
  const inputFile = await readSchedulerInputsFile();
  const override = inputFile.jobs?.[job.name];
  const discoveredKeywords = await buildDiscoveredKeywords(job);

  const sites = buildBaseSites(override);
  const keywords = Array.from(new Set([...buildBaseKeywords(job, override), ...discoveredKeywords]));
  const limit = override?.limit ?? DEFAULT_LIMIT;
  const priority = override?.priority ?? "medium";
  const retryCount = override?.retry_count ?? DEFAULT_RETRY_COUNT;
  const timeoutMs = override?.timeout_ms ?? DEFAULT_TIMEOUT_MS;

  validateSites(job.name, sites);
  validateKeywords(job.name, keywords);
  validateLimit(job.name, limit);
  validatePriority(job.name, priority);
  validateRetryCount(job.name, retryCount);
  validateTimeout(job.name, timeoutMs);

  return {
    job_name: job.name,
    sites,
    keywords,
    limit,
    priority,
    retry_count: retryCount,
    timeout_ms: timeoutMs
  };
}

export function createSchedulerMetadata(
  executionId: string,
  startTime: string,
  endTime: string,
  jobResults: Array<{
    name: string;
    status: SchedulerJobStatus;
    duration_ms: number;
    error?: string;
  }>
): SchedulerExecutionMetadata {
  const startMs = new Date(startTime).getTime();
  const endMs = new Date(endTime).getTime();
  const durationMs = endMs - startMs;

  const successfulCount = jobResults.filter((j) => j.status === "success" || j.status === "partial_success").length;
  const failedCount = jobResults.filter((j) => j.status === "failed" || j.status === "validation_failed").length;
  const failedNames = jobResults
    .filter((j) => j.status === "failed" || j.status === "validation_failed")
    .map((j) => j.name);

  return {
    execution_id: executionId,
    started_at: startTime,
    finished_at: endTime,
    duration_ms: durationMs,
    total_jobs: jobResults.length,
    successful_jobs: successfulCount,
    failed_jobs: failedCount,
    success_ratio: jobResults.length > 0 ? successfulCount / jobResults.length : 0,
    failed_job_names: failedNames,
    job_details: jobResults.map((j) => ({
      job_name: j.name,
      status: j.status,
      duration_ms: j.duration_ms,
      error: j.error
    }))
  };
}
