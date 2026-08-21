import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { getCronExpressionForJob } from '../dist/scheduler/logic/daemon.js';
import { getDefaultJobPlans } from '../dist/scheduler/logic/jobs.js';
import {
  calculateBackoffDelay,
  isRetryableError,
  RETRY_POLICY_TEMPLATES
} from '../dist/scheduler/logic/retry-policy.js';
import { createSchedulerMetadata, validateJob } from '../dist/scheduler/logic/schedule-config.js';
import {
  getSchedulerPriorityRank,
  resolveExecutionRetryPolicy,
  withSchedulerTimeout
} from '../dist/scheduler/logic/job-runner.js';
import { runNamedSchedulerJobs, RunnerValidationError } from '../dist/web-backend/logic/runner-service.js';
import { dispatchSchedulerAlertMatches } from '../dist/scheduler/logic/hooks.js';
import { finishRunnerIdempotency, reserveRunnerIdempotency } from '../dist/web-backend/logic/runner-idempotency.js';
import { acquireSchedulerJobLock } from '../dist/scheduler/logic/job-lock.js';

const plans = getDefaultJobPlans();
assert.equal(plans.length, 7);
assert.equal(new Set(plans.map((plan) => plan.name)).size, 7);
assert.equal(plans.every((plan) => !plan.keywords || new Set(plan.keywords).size === plan.keywords.length), true);
assert.equal(getCronExpressionForJob(plans.find((plan) => plan.name === 'daily-price-refresh')), '0 3 * * *');
assert.equal(getCronExpressionForJob(plans.find((plan) => plan.name === 'full-pc-scan')), '40 */2 * * *');
assert.equal(calculateBackoffDelay(1, RETRY_POLICY_TEMPLATES.transient_error), 0);
assert.equal(calculateBackoffDelay(2, RETRY_POLICY_TEMPLATES.transient_error), 60_000);
assert.equal(isRetryableError('TIMEOUT', RETRY_POLICY_TEMPLATES.transient_error), true);
assert.equal(isRetryableError('VALIDATION_ERROR', RETRY_POLICY_TEMPLATES.transient_error), false);
assert.equal(isRetryableError('LOGIN_REQUIRED', RETRY_POLICY_TEMPLATES.login_required), false);

const gpuInput = await validateJob(plans.find((plan) => plan.name === 'gpu-fast-scan'));
const fullPcPlan = plans.find((plan) => plan.name === 'full-pc-scan');
const fullPcInput = await validateJob(fullPcPlan);
assert.equal(gpuInput.priority, 'high');
assert.equal(gpuInput.retry_count, 2);
assert.equal(gpuInput.timeout_ms, 60_000);
assert.equal(resolveExecutionRetryPolicy(fullPcPlan, fullPcInput).max_attempts, 2);
assert.equal(getSchedulerPriorityRank('high') < getSchedulerPriorityRank('medium'), true);
await assert.rejects(
  withSchedulerTimeout(new Promise((resolve) => setTimeout(resolve, 50)), 5),
  /timed out after 5 ms/
);
let taskAborted = false;
await assert.rejects(
  withSchedulerTimeout((signal) => new Promise((_, reject) => signal.addEventListener('abort', () => {
    taskAborted = signal.aborted;
    reject(new Error('aborted'));
  })), 5),
  /timed out after 5 ms/
);
assert.equal(taskAborted, true);

const previousFetch = globalThis.fetch;
const previousEmailWebhook = process.env.SCHEDULER_ALERT_EMAIL_WEBHOOK_URL;
try {
  process.env.SCHEDULER_ALERT_EMAIL_WEBHOOK_URL = 'https://fixture.invalid/email';
  globalThis.fetch = async () => ({ ok: true, status: 204 });
  const emailDispatch = await dispatchSchedulerAlertMatches('gpu-fast-scan', 'fixture-run', [{
    rule_id: 'fixture-rule',
    rule_name: 'fixture alert',
    channels: ['email'],
    category: 'gpu',
    item_title: 'RTX 3070',
    item_url: 'https://fixture.invalid/item',
    net_profit: 150000,
    fraud_risk_score: 0.1
  }]);
  assert.equal(emailDispatch.sent, 1);
  assert.equal(emailDispatch.failed, 0);
} finally {
  globalThis.fetch = previousFetch;
  if (previousEmailWebhook === undefined) delete process.env.SCHEDULER_ALERT_EMAIL_WEBHOOK_URL;
  else process.env.SCHEDULER_ALERT_EMAIL_WEBHOOK_URL = previousEmailWebhook;
}

const metadata = createSchedulerMetadata(
  'fixture-batch',
  '2026-01-01T00:00:00.000Z',
  '2026-01-01T00:01:00.000Z',
  [
    { name: 'ok', status: 'success', duration_ms: 10 },
    { name: 'failed', status: 'failed', duration_ms: 20, error: 'fixture failure' }
  ]
);
assert.equal(metadata.successful_jobs, 1);
assert.equal(metadata.failed_jobs, 1);
assert.deepEqual(metadata.failed_job_names, ['failed']);
const partialMetadata = createSchedulerMetadata(
  'fixture-partial',
  '2026-01-01T00:00:00.000Z',
  '2026-01-01T00:01:00.000Z',
  [{ name: 'partial', status: 'partial_success', duration_ms: 20 }]
);
assert.equal(partialMetadata.status, 'partial_success');
assert.equal(partialMetadata.partial_jobs, 1);

await assert.rejects(
  runNamedSchedulerJobs(['not-a-real-job']),
  (error) => error instanceof RunnerValidationError && error.code === 'UNKNOWN_JOB'
);

const previousIdempotencyFile = process.env.RUNNER_IDEMPOTENCY_FILE;
const previousLockDirectory = process.env.SCHEDULER_LOCK_DIR;
const idempotencyFile = path.resolve(process.cwd(), 'merge/result/scheduler', `runner-idempotency-contract-${process.pid}.json`);
const lockDirectory = path.resolve(process.cwd(), 'merge/result/scheduler', `lock-contract-${process.pid}`);
process.env.RUNNER_IDEMPOTENCY_FILE = idempotencyFile;
process.env.SCHEDULER_LOCK_DIR = lockDirectory;
try {
  const locks = await Promise.all([
    acquireSchedulerJobLock('gpu-fast-scan'),
    acquireSchedulerJobLock('gpu-fast-scan')
  ]);
  assert.equal(locks.filter(Boolean).length, 1);
  await locks.find(Boolean).release();

  const reservations = await Promise.all([
    reserveRunnerIdempotency('contract-key', '["gpu-fast-scan"]'),
    reserveRunnerIdempotency('contract-key', '["gpu-fast-scan"]')
  ]);
  assert.equal(reservations.filter((reservation) => reservation.kind === 'execute').length, 1);
  assert.equal(reservations.filter((reservation) => reservation.kind === 'running').length, 1);
  await finishRunnerIdempotency('contract-key', 'completed', {
    status: 'completed',
    job_names: ['gpu-fast-scan'],
    results: []
  }, '["gpu-fast-scan"]');
  const replay = await reserveRunnerIdempotency('contract-key', '["gpu-fast-scan"]');
  assert.equal(replay.kind, 'replay');
  const conflict = await reserveRunnerIdempotency('contract-key', '["different-job"]');
  assert.equal(conflict.kind, 'conflict');
} finally {
  if (previousIdempotencyFile === undefined) delete process.env.RUNNER_IDEMPOTENCY_FILE;
  else process.env.RUNNER_IDEMPOTENCY_FILE = previousIdempotencyFile;
  if (previousLockDirectory === undefined) delete process.env.SCHEDULER_LOCK_DIR;
  else process.env.SCHEDULER_LOCK_DIR = previousLockDirectory;
  await rm(idempotencyFile, { force: true });
  await rm(lockDirectory, { force: true, recursive: true });
}

console.log(JSON.stringify({
  status: 'passed',
  jobs: plans.length,
  retry_contract: true,
  failure_metadata_contract: true
}, null, 2));
