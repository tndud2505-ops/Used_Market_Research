import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeCentralResult } from "../../merge/logic/resultStore.js";
import { buildCandidateAlertFingerprint } from "./alert-score.js";
import { loadReporterConfig } from "./config.js";
import { classifyCandidate, isDispatchableDecision } from "./decision.js";
import type { CandidateDecision } from "./decision.js";
import { DedupeStoreError, ReporterDedupeStore } from "./dedupe-store.js";
import { readLatestMergeCandidates } from "./latest-merge.js";
import { enrichCandidatesWithNaverRetail } from "./naver-shopping.js";
import { syncToSheets } from "./sheets-sync.js";
import { dispatchRecommendationSummary } from "./summary-notification.js";
import { buildPurchaseMessage } from "./template.js";
import { syncDiscordWatch } from "./discord-watch-discord.js";
import {
  getRecommendationFreshnessReferenceTime,
  shouldIncludeUserFacingCandidate
} from "./user-facing-filter.js";
import type {
  DispatchAttempt,
  ReporterCandidate,
  ReporterConfig,
  ReporterDispatchCandidate,
  ReporterRecommendationSummaryResult,
  ReporterRunOptions,
  ReporterRunOutput,
  ReporterRunStats
} from "./types.js";
import { trace, traceError } from "../../MCP/logic/runtime-trace.js";

export interface ReporterDaemonStatus {
  started: boolean;
  daemon_pid?: number;
  daemon_started_at?: string;
  poll_interval_sec: number;
  last_run_at?: string;
  last_status?: "success" | "warning" | "failed";
  last_error?: string;
  last_result_file?: string;
  last_summary_source_run?: string;
  total_runs: number;
}

export type ReporterRunInvocationResult =
  | {
      status: "success" | "warning";
      result_file: string;
      output: ReporterRunOutput;
    }
  | {
      status: "failed";
      result_file: string;
      error?: string;
    };

export class ReporterDaemon {
  private intervalRef?: NodeJS.Timeout;
  private inFlightRun?: Promise<ReporterRunInvocationResult>;
  private started = false;
  private totalRuns = 0;
  private daemonStartedAt?: string;
  private lastRunAt?: string;
  private lastStatus?: "success" | "warning" | "failed";
  private lastError?: string;
  private lastResultFile?: string;
  private lastSummarySourceRun?: string;

  constructor(
    private readonly config: ReporterConfig = loadReporterConfig(),
    private readonly dedupeStore = new ReporterDedupeStore()
  ) {
    this.loadPersistedStatus();
  }

  isStarted(): boolean {
    return this.started;
  }

  getStatusSnapshot(): ReporterDaemonStatus {
    return {
      started: this.started,
      daemon_pid: this.started ? process.pid : undefined,
      daemon_started_at: this.daemonStartedAt,
      poll_interval_sec: this.config.pollIntervalSec,
      last_run_at: this.lastRunAt,
      last_status: this.lastStatus,
      last_error: this.lastError,
      last_result_file: this.lastResultFile,
      last_summary_source_run: this.lastSummarySourceRun,
      total_runs: this.totalRuns
    };
  }

  start(): ReporterDaemonStatus {
    if (this.started) return this.getStatusSnapshot();

    if (this.config.triggerMode !== "poll") {
      throw new Error(`reporter daemon start is disabled when REPORTER_TRIGGER_MODE=${this.config.triggerMode}`);
    }

    this.started = true;
    this.daemonStartedAt = new Date().toISOString();
    trace("reporter.daemon:start", { poll_interval_sec: this.config.pollIntervalSec });
    this.intervalRef = setInterval(() => {
      void this.runOnce();
    }, this.config.pollIntervalSec * 1000);
    this.persistStatus();
    void this.runOnce();

    return this.getStatusSnapshot();
  }

  stop(): void {
    trace("reporter.daemon:stop");
    if (this.intervalRef) {
      clearInterval(this.intervalRef);
      this.intervalRef = undefined;
    }

    this.started = false;
    this.daemonStartedAt = undefined;
    this.persistStatus();
  }

  async runOnce(options: ReporterRunOptions = {}): Promise<ReporterRunInvocationResult> {
    if (this.inFlightRun) {
      trace("reporter.daemon:runOnce:reuse_inflight");
      return this.inFlightRun;
    }

    const runPromise = this.runOnceInternal(options);
    this.inFlightRun = runPromise;

    try {
      return await runPromise;
    } finally {
      if (this.inFlightRun === runPromise) {
        this.inFlightRun = undefined;
      }
    }
  }

  private async runOnceInternal(options: ReporterRunOptions): Promise<ReporterRunInvocationResult> {
    const startedAt = new Date().toISOString();
    const sendDispatch = options.sendDispatch ?? true;
    const sendSummary = options.sendSummary ?? true;
    trace("reporter.daemon:runOnce:start", {
      started_at: startedAt,
      send_dispatch: sendDispatch,
      send_summary: sendSummary
    });
    const dispatchLogs: DispatchAttempt[] = [];
    const summaryCandidates: ReporterDispatchCandidate[] = [];
    const warnings: string[] = [];
    const discordWatch = {
      inbox_attempted: false,
      inbox_processed: 0,
      inbox_replied: 0,
      checks_attempted: false,
      checked_watch_count: 0,
      due_watch_count: 0,
      created_alert_count: 0,
      pending_alerts_sent: 0,
      pending_alerts_failed: 0,
    };
    const stats: ReporterRunStats = {
      processed_candidates: 0,
      dedupe_blocked: 0,
      seller_limit_blocked: 0,
      quiet_hours_blocked: 0,
      kill_switch_blocked: 0,
      sheets_rows_written: 0
    };

    try {
      try {
        const watchSync = await syncDiscordWatch(this.config);
        discordWatch.inbox_attempted = watchSync.inbox.attempted;
        discordWatch.inbox_processed = watchSync.inbox.processed_count;
        discordWatch.inbox_replied = watchSync.inbox.replied_count;
        discordWatch.checks_attempted = watchSync.checks.attempted;
        discordWatch.checked_watch_count = watchSync.checks.checked_watch_count;
        discordWatch.due_watch_count = watchSync.checks.due_watch_count;
        discordWatch.created_alert_count = watchSync.checks.created_alert_count;
        discordWatch.pending_alerts_sent = watchSync.pending_dispatch.sent_count;
        discordWatch.pending_alerts_failed = watchSync.pending_dispatch.failed_count;
      } catch (watchError) {
        warnings.push("discord_watch_sync_failed");
        traceError("reporter.daemon:discord-watch:failed", watchError);
      }

      const latest = await readLatestMergeCandidates();
      const enrichedLatest = {
        ...latest,
        candidates: await enrichCandidatesWithNaverRetail(latest.candidates)
      };
      stats.processed_candidates = enrichedLatest.candidates.length;
      trace("reporter.daemon:latest-merge", {
        run_id: enrichedLatest.source_run_id,
        candidate_count: enrichedLatest.candidates.length
      });
      const summaryFreshnessReferenceTimeMs = getRecommendationFreshnessReferenceTime(enrichedLatest.candidates);

      const sheets = await syncToSheets(
        startedAt.replace(/[:.]/g, "-"),
        enrichedLatest,
        this.config.spreadsheetId,
        this.config.sheetsCredentialsPath
      );

      if (!sheets.success && sheets.reason) {
        warnings.push(`sheets_sync_warning=${sheets.reason}`);
      }
      stats.sheets_rows_written = sheets.rowsWritten;
      const runTimestamp = new Date();
      const quietHoursBlocked = this.isQuietHours(this.config.quietHours, runTimestamp);

      for (const candidate of enrichedLatest.candidates) {
        const decision = classifyCandidate(candidate);
        const fingerprint = buildCandidateAlertFingerprint(candidate);

        if (decision !== "PASS" && shouldIncludeUserFacingCandidate(candidate, decision, summaryFreshnessReferenceTimeMs)) {
          summaryCandidates.push({
            candidate,
            decision: decision as ReporterDispatchCandidate["decision"],
            fingerprint
          });
        }

        if (!this.config.enabled) {
          dispatchLogs.push({
            item_id: candidate.item_id,
            seller: candidate.seller,
            url: candidate.url,
            status: "blocked",
            reason: "reporter_disabled"
          });
          continue;
        }

        if (!isDispatchableDecision(decision, candidate)) {
          dispatchLogs.push({
            item_id: candidate.item_id,
            seller: candidate.seller,
            url: candidate.url,
            status: "blocked",
            reason: `decision_${decision.toLowerCase()}`
          });
          continue;
        }

        if (this.config.killSwitch) {
          stats.kill_switch_blocked += 1;
          dispatchLogs.push({
            item_id: candidate.item_id,
            seller: candidate.seller,
            url: candidate.url,
            status: "blocked",
            reason: "kill_switch"
          });
          continue;
        }

        if (quietHoursBlocked) {
          stats.quiet_hours_blocked += 1;
          dispatchLogs.push({
            item_id: candidate.item_id,
            seller: candidate.seller,
            url: candidate.url,
            status: "blocked",
            reason: "quiet_hours"
          });
          continue;
        }

        try {
          if (this.dedupeStore.isDuplicate(candidate.item_id)) {
            stats.dedupe_blocked += 1;
            dispatchLogs.push({
              item_id: candidate.item_id,
              seller: candidate.seller,
              url: candidate.url,
              status: "blocked",
              reason: "dedupe_ttl"
            });
            continue;
          }

          if (this.dedupeStore.isFingerprintDuplicate(fingerprint)) {
            stats.dedupe_blocked += 1;
            dispatchLogs.push({
              item_id: candidate.item_id,
              seller: candidate.seller,
              url: candidate.url,
              status: "blocked",
              reason: "fingerprint_dedupe_ttl"
            });
            continue;
          }

          const sentCount = this.dedupeStore.countSellerSentToday(candidate.seller);
          if (sentCount >= this.config.maxPerSellerPerDay) {
            stats.seller_limit_blocked += 1;
            dispatchLogs.push({
              item_id: candidate.item_id,
              seller: candidate.seller,
              url: candidate.url,
              status: "blocked",
              reason: "seller_daily_limit"
            });
            continue;
          }

          const sendResult = sendDispatch
            ? await this.dispatchMessage(candidate, decision)
            : {
                item_id: candidate.item_id,
                seller: candidate.seller,
                url: candidate.url,
                status: "blocked" as const,
                reason: "dispatch_disabled_for_run"
              };
          dispatchLogs.push(sendResult);
          if (sendResult.status === "sent") {
            this.dedupeStore.markSent(
              candidate.item_id,
              candidate.seller,
              this.config.dedupeTtlHours,
              new Date(),
              fingerprint
            );
          }
        } catch (error) {
          if (error instanceof DedupeStoreError) {
            warnings.push("dedupe_store_failure_detected");
            dispatchLogs.push({
              item_id: candidate.item_id,
              seller: candidate.seller,
              url: candidate.url,
              status: "blocked",
              reason: "dedupe_store_failure_kill_switch"
            });
            continue;
          }

          dispatchLogs.push({
            item_id: candidate.item_id,
            seller: candidate.seller,
            url: candidate.url,
            status: "failed",
            reason: error instanceof Error ? error.message : String(error)
          });
        }
      }

      let summaryNotification: ReporterRecommendationSummaryResult = {
        attempted: false,
        sent: false,
        item_count: 0
      };

      if (sendSummary && this.config.summaryEnabled) {
        if (enrichedLatest.source_run_id && enrichedLatest.source_run_id === this.lastSummarySourceRun) {
          summaryNotification = {
            attempted: false,
            sent: false,
            item_count: 0,
            reason: "summary_already_sent_for_source_run"
          };
        } else {
          summaryNotification = await dispatchRecommendationSummary(
            this.config,
            enrichedLatest.source_run_id,
            summaryCandidates
          );

          if (summaryNotification.sent && enrichedLatest.source_run_id) {
            this.lastSummarySourceRun = enrichedLatest.source_run_id;
          }
        }
      } else if (!sendSummary) {
        summaryNotification = {
          attempted: false,
          sent: false,
          item_count: 0,
          reason: "summary_disabled_for_run"
        };
      }

      const output: ReporterRunOutput = {
        run_id: startedAt.replace(/[:.]/g, "-"),
        latest_merge_run: enrichedLatest.source_run_id,
        discord_watch: discordWatch,
        sheets_sync: {
          attempted: true,
          success: sheets.success,
          rows_written: sheets.rowsWritten,
          reason: sheets.reason
        },
        dispatch: {
          attempted: latest.candidates.length,
          sent: dispatchLogs.filter((log) => log.status === "sent").length,
          blocked: dispatchLogs.filter((log) => log.status === "blocked").length,
          failed: dispatchLogs.filter((log) => log.status === "failed").length,
          logs: dispatchLogs
        },
        summary_notification: summaryNotification,
        warnings
      };

      const status: "success" | "warning" | "failed" =
        output.dispatch.failed > 0
          ? "warning"
          : warnings.length > 0
            ? "warning"
            : "success";

      const reportLines = [
        `- latest_merge_run: ${latest.source_run_id ?? "none"}`,
        `- discord_watch_inbox_processed: ${discordWatch.inbox_processed}`,
        `- discord_watch_inbox_replied: ${discordWatch.inbox_replied}`,
        `- discord_watch_checked: ${discordWatch.checked_watch_count}`,
        `- discord_watch_due: ${discordWatch.due_watch_count}`,
        `- discord_watch_created_alerts: ${discordWatch.created_alert_count}`,
        `- discord_watch_sent_alerts: ${discordWatch.pending_alerts_sent}`,
        `- discord_watch_failed_alerts: ${discordWatch.pending_alerts_failed}`,
        `- candidates: ${latest.candidates.length}`,
        `- sheets_rows_written: ${output.sheets_sync.rows_written}`,
        `- dispatch_sent: ${output.dispatch.sent}`,
        `- dispatch_blocked: ${output.dispatch.blocked}`,
        `- dispatch_failed: ${output.dispatch.failed}`,
        `- summary_sent: ${output.summary_notification.sent}`,
        `- summary_items: ${output.summary_notification.item_count}`,
        ...(output.summary_notification.reason ? [`- summary_reason: ${output.summary_notification.reason}`] : []),
        `- dedupe_blocked: ${stats.dedupe_blocked}`,
        `- seller_limit_blocked: ${stats.seller_limit_blocked}`,
        `- quiet_hours_blocked: ${stats.quiet_hours_blocked}`,
        `- kill_switch_blocked: ${stats.kill_switch_blocked}`,
        ...(warnings.length > 0 ? warnings.map((warning) => `- warning: ${warning}`) : [])
      ];

      const stored = await writeCentralResult({
        module: "reporter",
        command: "run",
        payload: output,
        notes: reportLines,
        summary: {
          status,
          started_at: startedAt,
          finished_at: new Date().toISOString(),
          processed_candidates: stats.processed_candidates,
          dedupe_blocked: stats.dedupe_blocked,
          seller_limit_blocked: stats.seller_limit_blocked,
          quiet_hours_blocked: stats.quiet_hours_blocked,
          kill_switch_blocked: stats.kill_switch_blocked,
          sheets_rows_written: stats.sheets_rows_written
        }
      });

      this.totalRuns += 1;
      this.lastRunAt = new Date().toISOString();
      this.lastStatus = status;
      this.lastError = undefined;
      this.lastResultFile = stored.baseDir;
      this.persistStatus();
      trace("reporter.daemon:runOnce:complete", {
        status,
        result_file: stored.baseDir,
        sent: output.dispatch.sent,
        blocked: output.dispatch.blocked,
        failed: output.dispatch.failed
      });

      return {
        status,
        result_file: stored.baseDir,
        output
      };
    } catch (error) {
      this.totalRuns += 1;
      this.lastRunAt = new Date().toISOString();
      this.lastStatus = "failed";
      this.lastError = error instanceof Error ? error.message : String(error);
      this.persistStatus();
      traceError("reporter.daemon:runOnce:failed", error);

      const stored = await writeCentralResult({
        module: "reporter",
        command: "run",
        payload: {
          error: this.lastError,
          run_id: startedAt.replace(/[:.]/g, "-")
        },
        notes: [
          "- reporter run failed",
          `- error: ${this.lastError}`
        ],
        summary: {
          status: "failed",
          started_at: startedAt,
          finished_at: new Date().toISOString()
        }
      });

      this.lastResultFile = stored.baseDir;
      this.persistStatus();

      return {
        status: "failed" as const,
        result_file: stored.baseDir,
        error: this.lastError
      };
    }
  }

  private async dispatchMessage(candidate: ReporterCandidate, decision: CandidateDecision): Promise<DispatchAttempt> {
    const message = buildPurchaseMessage(candidate);

    if (!this.config.sendEnabled) {
      return {
        item_id: candidate.item_id,
        seller: candidate.seller,
        url: candidate.url,
        status: "blocked",
        reason: "send_disabled_dry_run"
      };
    }

    if (!this.config.messageWebhookUrl) {
      return {
        item_id: candidate.item_id,
        seller: candidate.seller,
        url: candidate.url,
        status: "failed",
        reason: "missing MESSAGE_WEBHOOK_URL"
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(this.config.messageWebhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildDispatchWebhookBody(this.config, candidate, decision, message)),
        signal: controller.signal
      });

      if (!response.ok) {
        return {
          item_id: candidate.item_id,
          seller: candidate.seller,
          url: candidate.url,
          status: "failed",
          reason: `webhook_http_${response.status}`,
          response_code: response.status
        };
      }

      return {
        item_id: candidate.item_id,
        seller: candidate.seller,
        url: candidate.url,
        status: "sent",
        response_code: response.status
      };
    } catch (error) {
      return {
        item_id: candidate.item_id,
        seller: candidate.seller,
        url: candidate.url,
        status: "failed",
        reason: error instanceof Error ? error.message : String(error)
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private isQuietHours(quietHours: string, now: Date): boolean {
    const hour = now.getHours();
    const [startRaw, endRaw] = quietHours.split("-");
    const start = Number(startRaw);
    const end = Number(endRaw);

    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > 23 || end < 0 || end > 23) {
      return false;
    }

    if (start === end) return true;
    if (start < end) {
      return hour >= start && hour < end;
    }

    return hour >= start || hour < end;
  }

  private getPersistencePath(): string {
    return process.env.REPORTER_DAEMON_STATUS_FILE
      ? path.resolve(process.env.REPORTER_DAEMON_STATUS_FILE)
      : path.resolve(process.cwd(), "merge/result/reporter/daemon-status.json");
  }

  private loadPersistedStatus(): void {
    try {
      const raw = readFileSync(this.getPersistencePath(), "utf-8");
      const parsed = JSON.parse(raw) as Partial<ReporterDaemonStatus>;
      this.started = false;
      this.daemonStartedAt = parsed.daemon_started_at;
      this.lastRunAt = parsed.last_run_at;
      this.lastStatus = parsed.last_status;
      this.lastError = parsed.last_error;
      this.lastResultFile = parsed.last_result_file;
      this.lastSummarySourceRun = parsed.last_summary_source_run;
      this.totalRuns = parsed.total_runs ?? 0;
    } catch {
      // No persisted reporter daemon status yet.
    }
  }

  private persistStatus(): void {
    const filePath = this.getPersistencePath();
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(this.getStatusSnapshot(), null, 2), "utf-8");
  }
}

export function createReporterDaemon() {
  return new ReporterDaemon();
}

export function getReporterDaemonDraft() {
  const config = loadReporterConfig();
  return {
    poll_interval_sec: config.pollIntervalSec,
    quiet_hours: config.quietHours,
    dedupe_ttl_hours: config.dedupeTtlHours,
    max_per_seller_per_day: config.maxPerSellerPerDay,
    send_enabled: config.sendEnabled,
    discord_watch_enabled: config.discordWatchEnabled,
    discord_watch_channels: config.discordWatchChannelIds.length,
    summary_enabled: config.summaryEnabled,
    summary_max_items: config.summaryMaxItems
  };
}

function formatCurrencyForAlert(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "n/a";
  return `${new Intl.NumberFormat("ko-KR").format(Math.round(value))}원`;
}

function formatPercentForAlert(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "n/a";
  return `${(value * 100).toFixed(1)}%`;
}

function getExpectedPriceForAlert(candidate: ReporterCandidate) {
  if (candidate.listing_type === "part") {
    return candidate.market_price_30d ?? candidate.part_reference_price_30d ?? candidate.baseline_price;
  }

  return candidate.market_price_30d
    ?? candidate.component_sum_price_30d
    ?? candidate.part_reference_price_30d
    ?? candidate.baseline_price;
}

function buildDiscordDispatchText(candidate: ReporterCandidate, decision: CandidateDecision) {
  const expectedPrice = getExpectedPriceForAlert(candidate);
  const gapAmount = candidate.price_gap_to_market_30d
    ?? (
      candidate.price !== null && expectedPrice !== null
        ? expectedPrice - candidate.price
        : null
    );
  const gapPct = candidate.price_gap_to_market_30d_pct
    ?? (
      candidate.price !== null && expectedPrice !== null && expectedPrice > 0
        ? (expectedPrice - candidate.price) / expectedPrice
        : null
    );

  return [
    `[${decision}] ${candidate.title}`,
    `- 사이트: ${candidate.site}`,
    `- 매물가: ${formatCurrencyForAlert(candidate.price)} | 기준가: ${formatCurrencyForAlert(expectedPrice)}`,
    `- 차액: ${formatCurrencyForAlert(gapAmount)} (${formatPercentForAlert(gapPct)})`,
    `- 판매자: ${candidate.seller}`,
    `- URL: ${candidate.url}`
  ].join("\n").slice(0, 1800);
}

export function buildDispatchWebhookBody(
  config: ReporterConfig,
  candidate: ReporterCandidate,
  decision: CandidateDecision,
  message: string
) {
  if (config.messageWebhookUrl && /discord(?:app)?\.com\/api\/webhooks/i.test(config.messageWebhookUrl)) {
    return {
      content: buildDiscordDispatchText(candidate, decision)
    };
  }

  return {
    template_version: config.templateVersion,
    item_id: candidate.item_id,
    site: candidate.site,
    title: candidate.title,
    seller: candidate.seller,
    price: candidate.price,
    url: candidate.url,
    decision,
    text: message
  };
}

export function getReporterDaemonStatusFilePath() {
  return process.env.REPORTER_DAEMON_STATUS_FILE
    ? path.resolve(process.env.REPORTER_DAEMON_STATUS_FILE)
    : path.resolve(process.cwd(), "merge/result/reporter/daemon-status.json");
}

export function readPersistedReporterDaemonStatus(): ReporterDaemonStatus | null {
  try {
    const raw = readFileSync(getReporterDaemonStatusFilePath(), "utf-8");
    return JSON.parse(raw) as ReporterDaemonStatus;
  } catch {
    return null;
  }
}

function isProcessAlive(pid?: number | null) {
  if (!pid || !Number.isInteger(pid) || pid <= 0) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function handleReporterDaemonAction(action: string) {
  const daemon = createReporterDaemon();
  const persisted = readPersistedReporterDaemonStatus();
  const running = isProcessAlive(persisted?.daemon_pid);

  if (action === "draft") {
    return {
      action,
      ...getReporterDaemonDraft()
    };
  }

  if (action === "status") {
    return {
      action,
      running,
      persisted_status: persisted,
      current_status: daemon.getStatusSnapshot()
    };
  }

  if (action === "run-once") {
    const result = await daemon.runOnce();
    return {
      action,
      running: false,
      result,
      status: daemon.getStatusSnapshot()
    };
  }

  if (action === "start") {
    if (running) {
      return {
        action,
        started: false,
        reason: "daemon_already_running",
        persisted_status: persisted
      };
    }

    const status = daemon.start();
    const shutdown = () => {
      daemon.stop();
      process.exit(0);
    };

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);

    return {
      action,
      started: true,
      status,
      keep_alive: true
    };
  }

  if (action === "stop") {
    if (!persisted?.daemon_pid) {
      return {
        action,
        stopped: false,
        reason: "no_persisted_daemon_pid",
        persisted_status: persisted
      };
    }

    if (!running) {
      return {
        action,
        stopped: false,
        reason: "stale_daemon_pid",
        persisted_status: persisted
      };
    }

    process.kill(persisted.daemon_pid, "SIGTERM");
    return {
      action,
      stopped: true,
      signalled_pid: persisted.daemon_pid,
      persisted_status: persisted
    };
  }

  throw new Error(`Unsupported reporter-daemon action: ${action}`);
}

export async function runReporterDaemonCli(argv = process.argv.slice(2)) {
  const action = argv[0] ?? "start";
  const payload = await handleReporterDaemonAction(action);
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);

  if ((payload as { keep_alive?: boolean }).keep_alive) {
    await new Promise(() => {});
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void runReporterDaemonCli().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
