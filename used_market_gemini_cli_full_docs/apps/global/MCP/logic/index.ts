#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { loadConfig } from "./config.js";
import { GeminiApiProvider } from "./geminiApiProvider.js";
import { MockProvider } from "./mockProvider.js";
import { Orchestrator } from "./orchestrator.js";
import { buildCliErrorPayload } from "./validation.js";
import { listSupportedSites } from "../../collector/logic/sites.js";
import { writeCentralResult } from "../../merge/logic/resultStore.js";
import { collectLatestModuleRuns } from "../../merge/logic/collectLatest.js";
import { JobRunner } from "../../scheduler/logic/job-runner.js";
import { createSchedulerDaemon, getDaemonDraft, readPersistedDaemonStatus } from "../../scheduler/logic/daemon.js";
import {
  acknowledgeDiscordWatchAlert,
  handleDiscordWatchMessage,
  pullPendingDiscordWatchAlerts,
  pullPendingDiscordWatchDrafts,
  resolveDiscordWatchDraft,
  runDiscordWatchChecks,
} from "../../reporter/logic/discord-watch.js";
import { processDiscordWatchInbox, syncDiscordWatch } from "../../reporter/logic/discord-watch-discord.js";
import { processDiscordTransportOnce } from "../../reporter/logic/discord-transport.js";
import { loadProjectEnv } from "./env.js";
import { applyCliRuntimeFlags, trace, traceError } from "./runtime-trace.js";

type ProviderName = "mock" | "gemini";
type ProviderSummary = {
  provider_name: ProviderName;
  model_name: string;
  auth_mode: string;
  ready: boolean;
  fallback_used: boolean;
};

type RuntimeProviderState = {
  provider: GeminiApiProvider | MockProvider;
  summary: ProviderSummary;
  requested_provider: ProviderName;
  effective_provider: ProviderName;
  gemini_check?: unknown;
};

type ReporterHandler = (action: string) => Promise<unknown>;
type CliOutput = {
  writeStdout(text: string): void;
  writeStderr(text: string): void;
};

let reporterHandlerPromise: Promise<ReporterHandler | null> | null = null;
let runtimeProviderState: RuntimeProviderState | null = null;

const defaultCliOutput: CliOutput = {
  writeStdout(text: string) {
    process.stdout.write(text);
  },
  writeStderr(text: string) {
    process.stderr.write(text);
  }
};

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function extractReady(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (!value || typeof value !== "object") return false;

  const record = value as Record<string, unknown>;
  for (const key of ["ready", "ok", "success", "available"]) {
    const candidate = record[key];
    if (typeof candidate === "boolean") return candidate;
  }

  return false;
}

function normalizeProviderSummary(
  metadata: unknown,
  configProvider: ProviderName,
  requestedProvider: ProviderName,
  ready: boolean,
  fallbackUsed: boolean
): ProviderSummary {
  const record = metadata && typeof metadata === "object" ? metadata as Record<string, unknown> : {};
  const defaultModelName = configProvider === "gemini" ? readString(process.env.GEMINI_MODEL, "gemini-2.5-flash") : "mock";
  const defaultAuthMode = configProvider === "gemini" ? "api_key" : "local";

  return {
    provider_name: requestedProvider,
    model_name: readString(record.model_name ?? record.model ?? record.selected_model, defaultModelName),
    auth_mode: readString(record.auth_mode ?? record.authMode ?? record.mode, defaultAuthMode),
    ready,
    fallback_used: fallbackUsed
  };
}

async function loadReporterHandler(): Promise<ReporterHandler | null> {
  if (!reporterHandlerPromise) {
    reporterHandlerPromise = import("../../reporter/logic/daemon.js")
      .then((module) => (typeof module.handleReporterDaemonAction === "function" ? module.handleReporterDaemonAction as ReporterHandler : null))
      .catch(() => null);
  }

  return reporterHandlerPromise;
}

function getInvocation(argv: string[]) {
  const positional = argv.filter((arg) => !arg.startsWith("-"));
  return {
    command: positional[0] ?? "unknown",
    action: positional[1]
  };
}

function canUseMockFallback(command: string, action?: string) {
  if (command === "provider-check" || command === "merge-latest" || command === "sites" || command === "schedule-plan") {
    return true;
  }

  if (command === "reporter-daemon") {
    return true;
  }

  if (command === "scheduler-daemon") {
    return action === "draft" || action === "status" || action === "stop";
  }

  return false;
}

async function resolveProviderState(
  invocation = getInvocation(applyCliRuntimeFlags(process.argv).slice(2))
): Promise<RuntimeProviderState> {
  const config = loadConfig();

  if (config.provider === "mock") {
    const provider = new MockProvider();
    const metadata = await provider.getMetadata();
    return {
      provider,
      summary: normalizeProviderSummary(metadata, "mock", "mock", true, false),
      requested_provider: "mock",
      effective_provider: "mock"
    };
  }

  const geminiProvider = new GeminiApiProvider();
  const [metadata, check] = await Promise.all([
    geminiProvider.getMetadata(),
    Promise.resolve(geminiProvider.providerCheck()).catch(() => ({ ready: false }))
  ]);

  const ready = extractReady(check);
  if (ready) {
    return {
      provider: geminiProvider,
      summary: normalizeProviderSummary(metadata, "gemini", "gemini", true, false),
      requested_provider: "gemini",
      effective_provider: "gemini",
      gemini_check: check
    };
  }

  if (!config.allowMockFallback && !canUseMockFallback(invocation.command, invocation.action)) {
    throw new Error(`gemini provider unavailable and mock fallback disabled for command: ${invocation.command}`);
  }

  const fallbackProvider = new MockProvider();
  const fallbackMetadata = await fallbackProvider.getMetadata();
  return {
    provider: fallbackProvider,
    summary: normalizeProviderSummary(metadata, "gemini", "gemini", false, true),
    requested_provider: "gemini",
    effective_provider: "mock",
    gemini_check: check ?? fallbackMetadata
  };
}

async function writeModuleResult(
  providerSummary: ProviderSummary,
  args: {
    module: string;
    command: string;
    payload: unknown;
    notes: string[];
  }
) {
  await writeCentralResult({ ...args, summary: providerSummary });
}

function printJson(value: unknown, output: CliOutput = defaultCliOutput) {
  const config = loadConfig();
  const text = config.outputPretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);
  output.writeStdout(`${text}
`);
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

async function handleSchedulerDaemonAction(
  action: string,
  provider: GeminiApiProvider | MockProvider
) {
  const daemon = createSchedulerDaemon({ jobRunner: new JobRunner(provider) });
  const persisted = readPersistedDaemonStatus();
  const running = isProcessAlive(persisted?.daemon_pid);

  if (action === "draft") {
    return {
      action,
      ...getDaemonDraft()
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
    await daemon.runAllNow();
    return {
      action,
      running: false,
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

    const registered = daemon.start();
    const status = daemon.getStatusSnapshot();

    const shutdown = () => {
      daemon.stop();
      process.exit(0);
    };

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);

    return {
      action,
      started: true,
      registered_jobs: registered.map(({ job_name, cron_expression, cron_hint }) => ({
        job_name,
        cron_expression,
        cron_hint
      })),
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

  throw new Error(`Unsupported scheduler-daemon action: ${action}`);
}

function formatCurrency(value: number | null | undefined, currency = "USD") {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "unknown";
  }

  try {
    return new Intl.NumberFormat(currency === "JPY" ? "ja-JP" : "en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: currency === "JPY" ? 0 : 2
    }).format(value);
  } catch {
    return `${new Intl.NumberFormat("en-US").format(value)} ${currency}`;
  }
}

function getDefaultDiscordSites() {
  return listSupportedSites()
    .map((site) => site.key);
}

function formatDiscordRuntimeSummary(requestText: string, payload: unknown) {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const mergedResult = record.merged_result && typeof record.merged_result === "object"
    ? record.merged_result as Record<string, unknown>
    : {};
  const mergedItems = Array.isArray(mergedResult.merged_items)
    ? mergedResult.merged_items as Array<Record<string, unknown>>
    : [];
  const marketResultRef = record.market_result_ref && typeof record.market_result_ref === "object"
    ? record.market_result_ref as Record<string, unknown>
    : {};
  const runId = typeof marketResultRef.run_id === "string" ? marketResultRef.run_id : null;

  const lines = [
    `Used-market summary for: ${requestText}`,
    runId ? `run: ${runId}` : null,
  ].filter((entry): entry is string => Boolean(entry));

  if (mergedItems.length === 0) {
    lines.push("No active listings matched right now.");
    return lines.join("\n");
  }

  mergedItems.slice(0, 5).forEach((item, index) => {
    const title = typeof item.title === "string" ? item.title : "unknown";
    const url = typeof item.url === "string" ? item.url : "";
    const site = typeof item.site === "string" ? item.site : "unknown";
    const price = typeof item.price_value === "number" ? item.price_value : null;
    const currency = typeof item.currency === "string" ? item.currency : "USD";
    lines.push(`${index + 1}. ${title}`);
    lines.push(`price: ${formatCurrency(price, currency)} | site: ${site}`);
    if (url) {
      lines.push(url);
    }
  });

  return lines.join("\n");
}

export async function runCli(rawArgv = process.argv, output: CliOutput = defaultCliOutput) {
  loadProjectEnv();
  const runtimeArgv = applyCliRuntimeFlags(rawArgv);
  runtimeProviderState = null;
  runtimeProviderState = await resolveProviderState(getInvocation(runtimeArgv.slice(2)));
  const provider = runtimeProviderState.provider;
  const providerSummary = runtimeProviderState.summary;
  const orchestrator = new Orchestrator(provider);
  const program = new Command();
  trace("cli.main:start", { argv: runtimeArgv.slice(2), provider: providerSummary });
  const print = (value: unknown) => {
    printJson(value, output);
  };

  program.name("used-market").description("Gemini API based used market workspace").version("2.0.0");

  program.command("sites").action(async () => {
    trace("cli.command:sites");
    const payload = { supported_sites: listSupportedSites() };
    await writeModuleResult(providerSummary, { module: "MCP", command: "sites", payload, notes: ["supported site list"] });
    print(payload);
  });

  program.command("login-check")
    .requiredOption("--site <site>")
    .option("--show-browser", "open a visible browser for collector commands")
    .action(async (opts) => {
      trace("cli.command:login-check", opts);
      const payload = await orchestrator.loginCheck(opts.site, { showBrowser: opts.showBrowser });
      await writeModuleResult(providerSummary, { module: "collector", command: "login-check", payload, notes: [`site=${opts.site}`] });
      print(payload);
    });

  program.command("search")
    .requiredOption("--site <site>")
    .requiredOption("--keyword <keyword>")
    .option("--limit <limit>", "number of items", "10")
    .option("--show-browser", "open a visible browser for collector commands")
    .action(async (opts) => {
      trace("cli.command:search", opts);
      const payload = await orchestrator.search(
        { site: opts.site, keyword: opts.keyword, limit: Number(opts.limit) },
        { showBrowser: opts.showBrowser }
      );
      await writeModuleResult(providerSummary, { module: "collector", command: "search", payload, notes: [`site=${opts.site}`, `keyword=${opts.keyword}`] });
      print(payload);
    });

  program.command("normalize")
    .requiredOption("--site <site>")
    .requiredOption("--keyword <keyword>")
    .option("--limit <limit>", "number of items", "10")
    .option("--show-browser", "open a visible browser for collector commands")
    .action(async (opts) => {
      trace("cli.command:normalize", opts);
      const search = await orchestrator.search(
        { site: opts.site, keyword: opts.keyword, limit: Number(opts.limit) },
        { showBrowser: opts.showBrowser }
      );
      const payload = await orchestrator.normalize(opts.site, opts.keyword, search);
      await writeModuleResult(providerSummary, { module: "market", command: "normalize", payload, notes: [`site=${opts.site}`, `keyword=${opts.keyword}`] });
      print(payload);
    });

  program.command("market-snapshot")
    .requiredOption("--sites <sites>")
    .requiredOption("--keyword <keyword>")
    .option("--limit <limit>", "number of items per site", "10")
    .option("--show-browser", "open a visible browser for collector commands")
    .action(async (opts) => {
      trace("cli.command:market-snapshot", opts);
      const payload = await orchestrator.fullWorkflow({
        keyword: opts.keyword,
        sites: String(opts.sites).split(",").map((v: string) => v.trim()).filter(Boolean),
        limit: Number(opts.limit)
      }, { showBrowser: opts.showBrowser });
      await writeModuleResult(providerSummary, { module: "market", command: "market-snapshot", payload, notes: [`keyword=${opts.keyword}`] });
      print(payload);
    });

  program.command("schedule-plan")
    .action(async () => {
      trace("cli.command:schedule-plan");
      const payload = orchestrator.schedulePlan();
      await writeModuleResult(providerSummary, { module: "scheduler", command: "schedule-plan", payload, notes: ["default job plans"] });
      print(payload);
    });

  program.command("scheduler-daemon")
    .argument("<action>", "draft | status | run-once | start | stop")
    .action(async (action) => {
      trace("cli.command:scheduler-daemon", { action: String(action) });
      const payload = await handleSchedulerDaemonAction(String(action), provider);
      await writeModuleResult(providerSummary, {
        module: "scheduler",
        command: `scheduler-daemon-${String(action)}`,
        payload,
        notes: [`action=${String(action)}`]
      });
      print(payload);

      if (action === "start" && (payload as { keep_alive?: boolean }).keep_alive) {
        await new Promise(() => {});
      }
    });

  program.command("discord-runtime")
    .argument("<action>", "run-once")
    .action(async (action) => {
      trace("cli.command:discord-runtime", { action: String(action) });
      if (action !== "run-once") {
        throw new Error(`Unsupported discord-runtime action: ${String(action)}`);
      }

      const payload = await processDiscordTransportOnce({
        workflowRunner: {
          async runWatchSearch(watch) {
            const result = await orchestrator.fullWorkflow({
              keyword: watch.search_query,
              sites: watch.site_keys,
              limit: 12,
            });

            const record = result as Record<string, unknown>;
            const marketResultRef = record.market_result_ref && typeof record.market_result_ref === "object"
              ? record.market_result_ref as Record<string, unknown>
              : {};
            const mergedResult = record.merged_result && typeof record.merged_result === "object"
              ? record.merged_result as Record<string, unknown>
              : {};

            return {
              run_id: typeof marketResultRef.run_id === "string" ? marketResultRef.run_id : undefined,
              merged_items: Array.isArray(mergedResult.merged_items) ? mergedResult.merged_items as any[] : [],
            };
          },
        },
        generalRequestHandler: async (input) => {
          const result = await orchestrator.fullWorkflow({
            keyword: input.content,
            sites: getDefaultDiscordSites(),
            limit: 8,
          });
          return formatDiscordRuntimeSummary(input.content, result);
        },
      });

      await writeModuleResult(providerSummary, {
        module: "reporter",
        command: "discord-runtime-run-once",
        payload,
        notes: ["controller contract sync"],
      });
      print(payload);
    });

  program.command("reporter-daemon")
    .argument("<action>", "draft | status | run-once | start | stop")
    .action(async (action) => {
      trace("cli.command:reporter-daemon", { action: String(action) });
      const handler = await loadReporterHandler();
      const payload = handler
        ? await handler(String(action))
        : {
            action: String(action),
            status: "blocked",
            reason: "reporter_daemon_unavailable"
          };

      await writeModuleResult(providerSummary, {
        module: "reporter",
        command: `reporter-daemon-${String(action)}`,
        payload,
        notes: [`action=${String(action)}`, handler ? "reporter available" : "reporter unavailable"]
      });
      print(payload);

      if (action === "start" && (payload as { keep_alive?: boolean }).keep_alive) {
        await new Promise(() => {});
      }
    });

  program.command("discord-watch")
    .argument("<action>", "message | resolve | run-once | pending-alerts | pending-drafts | ack-alert | inbox-once | sync")
    .option("--channel-id <channelId>")
    .option("--guild-id <guildId>")
    .option("--user-id <userId>")
    .option("--message <message>")
    .option("--draft-id <draftId>")
    .option("--answer <answer>")
    .option("--alert-id <alertId>")
    .action(async (action, opts) => {
      trace("cli.command:discord-watch", { action: String(action), ...opts });

      let payload: unknown;
      if (action === "message") {
        if (!opts.message || !opts.channelId || !opts.guildId || !opts.userId) {
          throw new Error("discord-watch message requires --message, --channel-id, --guild-id, and --user-id");
        }
        payload = await handleDiscordWatchMessage({
          channelId: String(opts.channelId),
          guildId: String(opts.guildId),
          userId: String(opts.userId),
          message: String(opts.message),
        });
      } else if (action === "resolve") {
        if (!opts.draftId || !opts.answer) {
          throw new Error("discord-watch resolve requires --draft-id and --answer");
        }
        payload = await resolveDiscordWatchDraft(String(opts.draftId), String(opts.answer));
      } else if (action === "run-once") {
        payload = await runDiscordWatchChecks();
      } else if (action === "inbox-once") {
        payload = await processDiscordWatchInbox();
      } else if (action === "sync") {
        payload = await syncDiscordWatch();
      } else if (action === "pending-alerts") {
        payload = {
          alerts: await pullPendingDiscordWatchAlerts(),
        };
      } else if (action === "pending-drafts") {
        payload = {
          drafts: await pullPendingDiscordWatchDrafts(),
        };
      } else if (action === "ack-alert") {
        if (!opts.alertId) {
          throw new Error("discord-watch ack-alert requires --alert-id");
        }
        payload = await acknowledgeDiscordWatchAlert(String(opts.alertId));
      } else {
        throw new Error(`Unsupported discord-watch action: ${String(action)}`);
      }

      await writeModuleResult(providerSummary, {
        module: "reporter",
        command: `discord-watch-${String(action)}`,
        payload,
        notes: [`action=${String(action)}`],
      });
      print(payload);
    });

  program.command("provider-check")
    .action(async () => {
      trace("cli.command:provider-check");
      const mockProvider = new MockProvider();
      const geminiProvider = new GeminiApiProvider();
      const [mockCheck, geminiCheck] = await Promise.all([
        Promise.resolve(mockProvider.providerCheck()).catch(() => ({ ready: false })),
        Promise.resolve(geminiProvider.providerCheck()).catch(() => ({ ready: false }))
      ]);

      const summary = runtimeProviderState?.summary ?? normalizeProviderSummary(
        loadConfig().provider === "mock" ? await mockProvider.getMetadata() : await geminiProvider.getMetadata(),
        loadConfig().provider === "mock" ? "mock" : "gemini",
        loadConfig().provider,
        extractReady(geminiCheck),
        loadConfig().provider === "gemini" && !extractReady(geminiCheck)
      );

      const payload = {
        active_provider: runtimeProviderState?.effective_provider ?? loadConfig().provider,
        provider_name: summary.provider_name,
        model_name: summary.model_name,
        auth_mode: summary.auth_mode,
        ready: summary.ready,
        fallback_used: summary.fallback_used,
        checks: {
          mock: mockCheck,
          gemini: geminiCheck
        }
      };
      await writeModuleResult(summary, { module: "MCP", command: "provider-check", payload, notes: ["provider readiness check"] });
      print(payload);
    });

  program.command("full")
    .requiredOption("--sites <sites>")
    .requiredOption("--keyword <keyword>")
    .option("--limit <limit>", "number of items per site", "10")
    .option("--show-browser", "open a visible browser for collector commands")
    .option("--draft-site <site>")
    .option("--draft-title <title>")
    .option("--draft-price <price>")
    .option("--draft-seller <seller>")
    .option("--draft-url <url>")
    .action(async (opts) => {
      trace("cli.command:full", opts);
      const goodPriceInput = opts.draftSite && opts.draftTitle && opts.draftSeller && opts.draftUrl
        ? {
            site: opts.draftSite,
            title: opts.draftTitle,
            price: opts.draftPrice ? Number(opts.draftPrice) : null,
            seller: opts.draftSeller,
            url: opts.draftUrl
          }
        : undefined;

      const payload = await orchestrator.fullWorkflow({
        keyword: opts.keyword,
        sites: String(opts.sites).split(",").map((v: string) => v.trim()).filter(Boolean),
        limit: Number(opts.limit),
        goodPriceInput
      }, { showBrowser: opts.showBrowser });

      await writeModuleResult(providerSummary, {
        module: "merge",
        command: "full",
        payload,
        notes: [`keyword=${opts.keyword}`, `sites=${opts.sites}`],
      });
      print(payload);
    });

  program.command("merge-latest")
    .action(async () => {
      trace("cli.command:merge-latest");
      const payload = await collectLatestModuleRuns();
      await writeModuleResult(providerSummary, { module: "merge", command: "merge-latest", payload, notes: ["latest outputs by module"] });
      print(payload);
    });

  await program.parseAsync(runtimeArgv);
}

function inferCommand(argv: string[]) {
  return argv.find((arg) => !arg.startsWith("-")) ?? "unknown";
}

async function handleCliFailure(error: unknown, rawArgv = process.argv, output: CliOutput = defaultCliOutput) {
  const runtimeArgv = applyCliRuntimeFlags(rawArgv);
  traceError("cli.main:failed", error);
  const payload = buildCliErrorPayload(error);
  const providerState = runtimeProviderState ?? await resolveProviderState(getInvocation(runtimeArgv.slice(2))).catch(() => null);
  const summary = providerState?.summary ?? {
    provider_name: "mock" as const,
    model_name: "mock",
    auth_mode: "local",
    ready: false,
    fallback_used: true
  };

  try {
    await writeCentralResult({
      module: "MCP",
      command: inferCommand(runtimeArgv.slice(2)),
      payload,
      notes: ["command failed"],
      summary: {
        ...summary,
        status: "failed"
      }
    });
  } catch (writeError) {
    output.writeStderr(`${writeError instanceof Error ? writeError.message : String(writeError)}
`);
  }

  output.writeStderr(`${JSON.stringify(payload, null, 2)}
`);
  process.exitCode = 1;
}

function isDirectExecution() {
  return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isDirectExecution()) {
  runCli().catch(async (error) => {
    await handleCliFailure(error);
  });
}
