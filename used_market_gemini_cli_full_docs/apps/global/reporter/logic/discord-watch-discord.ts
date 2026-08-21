import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { loadReporterConfig } from "./config.js";
import type { ReporterConfig } from "./types.js";
import {
  acknowledgeDiscordWatchAlert,
  handleDiscordWatchMessage,
  pullPendingDiscordWatchAlerts,
  runDiscordWatchChecks,
  type DiscordWatchAlert,
  type DiscordWatchMessageResult,
  type DiscordWatchWorkflowRunner,
  type RunDiscordWatchChecksResult,
} from "./discord-watch.js";

interface DiscordChannelMessage {
  id: string;
  channel_id: string;
  content: string;
  author?: {
    id?: string;
    bot?: boolean;
    username?: string;
  };
  guild_id?: string;
}

interface DiscordInboxCursorState {
  version: 1;
  channels: Record<string, { last_seen_message_id?: string }>;
}

export interface DiscordWatchInboxResult {
  attempted: boolean;
  processed_count: number;
  replied_count: number;
  skipped_count: number;
  reason?: string;
}

export interface DiscordWatchPendingDispatchResult {
  attempted: boolean;
  sent_count: number;
  failed_count: number;
  reason?: string;
}

export interface DiscordWatchSyncResult {
  inbox: DiscordWatchInboxResult;
  checks: RunDiscordWatchChecksResult & {
    attempted: boolean;
    reason?: string;
  };
  pending_dispatch: DiscordWatchPendingDispatchResult;
}

interface DiscordApiOptions {
  apiBaseUrl?: string;
  cursorStateFile?: string;
  watchStateFile?: string;
  workflowRunner?: DiscordWatchWorkflowRunner;
  now?: Date;
}

function getDiscordApiBaseUrl(explicit?: string) {
  return explicit
    ?? process.env.DISCORD_WATCH_API_BASE_URL
    ?? "https://discord.com/api/v10";
}

function getCursorStateFilePath(customStateFile?: string) {
  return customStateFile
    ? path.resolve(customStateFile)
    : path.resolve(process.cwd(), "merge/result/reporter/discord-watch/discord-cursor.json");
}

async function loadCursorState(cursorStateFile?: string): Promise<DiscordInboxCursorState> {
  const resolved = getCursorStateFilePath(cursorStateFile);
  try {
    const raw = await readFile(resolved, "utf-8");
    const parsed = JSON.parse(raw) as Partial<DiscordInboxCursorState>;
    return {
      version: 1,
      channels: parsed.channels && typeof parsed.channels === "object" ? parsed.channels : {},
    };
  } catch {
    return {
      version: 1,
      channels: {},
    };
  }
}

async function saveCursorState(state: DiscordInboxCursorState, cursorStateFile?: string) {
  const resolved = getCursorStateFilePath(cursorStateFile);
  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(resolved, JSON.stringify(state, null, 2), "utf-8");
}

function normalizeWatchCommand(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return { type: "help" as const, message: "" };

  if (/^(help|\?)$/i.test(trimmed)) {
    return { type: "help" as const, message: trimmed };
  }

  if (/^(list|status)$/i.test(trimmed)) {
    return { type: "watch" as const, message: "감시 목록 보여줘" };
  }

  return { type: "watch" as const, message: trimmed };
}

function extractPrefixedCommand(content: string, prefix: string) {
  const trimmed = content.trim();
  if (!trimmed) return null;
  if (!trimmed.toLowerCase().startsWith(prefix.toLowerCase())) return null;
  return trimmed.slice(prefix.length).trim();
}

function formatHelpMessage(prefix: string) {
  return [
    `Use \`${prefix} <request>\` to manage watches.`,
    `Examples: \`${prefix} cpu 5600x 10만원 이하 알림\`, \`${prefix} list\`, \`${prefix} apply\`, \`${prefix} cancel\``,
    "If I ask a follow-up question, reply with the same prefix and your answer.",
  ].join("\n");
}

function formatQuestionOptions(result: Extract<DiscordWatchMessageResult, { status: "needs_user_input" }>) {
  const lines: string[] = [];
  for (const question of result.questions) {
    lines.push(question.question);
    for (const option of question.options) {
      lines.push(`- ${option.label}: ${option.description}`);
    }
  }
  return lines.join("\n");
}

function formatResultMessage(result: DiscordWatchMessageResult, prefix: string, userId: string) {
  if (!result.handled) {
    return `<@${userId}> ${formatHelpMessage(prefix)}`;
  }

  if (result.status === "completed") {
    return `<@${userId}> ${result.message}`;
  }

  return [
    `<@${userId}> ${result.message}`,
    formatQuestionOptions(result),
    `Reply with \`${prefix} <answer>\`. When the preview looks correct, send \`${prefix} apply\`.`,
  ].join("\n\n");
}

async function discordApiRequest(
  token: string,
  endpoint: string,
  init: RequestInit = {},
  options?: { apiBaseUrl?: string },
) {
  const response = await fetch(`${getDiscordApiBaseUrl(options?.apiBaseUrl)}${endpoint}`, {
    ...init,
    headers: {
      Authorization: `Bot ${token}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  return response;
}

async function fetchChannelMessages(
  token: string,
  channelId: string,
  after: string | undefined,
  limit: number,
  options?: { apiBaseUrl?: string },
) {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  if (after) params.set("after", after);

  const response = await discordApiRequest(
    token,
    `/channels/${channelId}/messages?${params.toString()}`,
    { method: "GET" },
    options,
  );

  if (!response.ok) {
    throw new Error(`discord_fetch_messages_http_${response.status}`);
  }

  const payload = await response.json() as DiscordChannelMessage[];
  return payload
    .filter((message) => typeof message.id === "string" && typeof message.content === "string")
    .sort((left, right) => left.id.localeCompare(right.id));
}

async function postChannelMessage(
  token: string,
  channelId: string,
  content: string,
  options?: { apiBaseUrl?: string },
) {
  const response = await discordApiRequest(
    token,
    `/channels/${channelId}/messages`,
    {
      method: "POST",
      body: JSON.stringify({ content: content.slice(0, 1900) }),
    },
    options,
  );

  if (!response.ok) {
    throw new Error(`discord_post_message_http_${response.status}`);
  }
}

export async function processDiscordWatchInbox(
  config: ReporterConfig = loadReporterConfig(),
  options?: DiscordApiOptions,
): Promise<DiscordWatchInboxResult> {
  if (!config.discordWatchEnabled || !config.discordWatchBotToken) {
    return {
      attempted: false,
      processed_count: 0,
      replied_count: 0,
      skipped_count: 0,
      reason: "discord_watch_disabled",
    };
  }

  const cursorState = await loadCursorState(options?.cursorStateFile);
  let processedCount = 0;
  let repliedCount = 0;
  let skippedCount = 0;

  for (const channelId of config.discordWatchChannelIds) {
    const lastSeen = cursorState.channels[channelId]?.last_seen_message_id;
    const messages = await fetchChannelMessages(
      config.discordWatchBotToken,
      channelId,
      lastSeen,
      config.discordWatchPollLimit,
      { apiBaseUrl: options?.apiBaseUrl },
    );

    for (const message of messages) {
      cursorState.channels[channelId] = { last_seen_message_id: message.id };

      if (message.author?.bot) {
        skippedCount += 1;
        continue;
      }

      const commandBody = extractPrefixedCommand(message.content, config.discordWatchCommandPrefix);
      if (commandBody === null) {
        skippedCount += 1;
        continue;
      }

      const normalized = normalizeWatchCommand(commandBody);
      const reply = normalized.type === "help"
        ? formatHelpMessage(config.discordWatchCommandPrefix)
        : formatResultMessage(
            await handleDiscordWatchMessage(
              {
                channelId,
                guildId: message.guild_id ?? config.discordWatchGuildId,
                userId: message.author?.id ?? "unknown-user",
                message: normalized.message,
              },
              {
                stateFile: options?.watchStateFile,
                workflowRunner: options?.workflowRunner,
              },
            ),
            config.discordWatchCommandPrefix,
            message.author?.id ?? "unknown-user",
          );

      await postChannelMessage(
        config.discordWatchBotToken,
        channelId,
        reply,
        { apiBaseUrl: options?.apiBaseUrl },
      );
      processedCount += 1;
      repliedCount += 1;
    }
  }

  await saveCursorState(cursorState, options?.cursorStateFile);
  return {
    attempted: true,
    processed_count: processedCount,
    replied_count: repliedCount,
    skipped_count: skippedCount,
  };
}

async function dispatchPendingDiscordWatchAlerts(
  config: ReporterConfig = loadReporterConfig(),
  options?: DiscordApiOptions,
): Promise<DiscordWatchPendingDispatchResult> {
  if (!config.discordWatchBotToken) {
    return {
      attempted: false,
      sent_count: 0,
      failed_count: 0,
      reason: "missing_discord_watch_bot_token",
    };
  }

  const alerts = await pullPendingDiscordWatchAlerts({ stateFile: options?.watchStateFile });
  let sentCount = 0;
  let failedCount = 0;

  for (const alert of alerts) {
    try {
      await postChannelMessage(
        config.discordWatchBotToken,
        alert.channel_id,
        formatPendingAlert(alert),
        { apiBaseUrl: options?.apiBaseUrl },
      );
      await acknowledgeDiscordWatchAlert(alert.id, { stateFile: options?.watchStateFile });
      sentCount += 1;
    } catch {
      failedCount += 1;
    }
  }

  return {
    attempted: true,
    sent_count: sentCount,
    failed_count: failedCount,
  };
}

function formatPendingAlert(alert: DiscordWatchAlert) {
  const embed = alert.discord_payload.embeds[0];
  const description = embed?.description ?? "";
  return [alert.discord_payload.content, embed?.title ?? "Watch alert", description]
    .filter(Boolean)
    .join("\n\n");
}

export async function syncDiscordWatch(
  config: ReporterConfig = loadReporterConfig(),
  options?: DiscordApiOptions,
): Promise<DiscordWatchSyncResult> {
  const inbox = await processDiscordWatchInbox(config, options);
  const checks = await runDiscordWatchChecks({
    stateFile: options?.watchStateFile,
    workflowRunner: options?.workflowRunner,
    now: options?.now,
  });
  const pendingDispatch = await dispatchPendingDiscordWatchAlerts(config, options);

  return {
    inbox,
    checks: {
      attempted: true,
      ...checks,
    },
    pending_dispatch: pendingDispatch,
  };
}
