import type { ReporterConfig } from "./types.js";

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value.toLowerCase() === "true";
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseMessageProvider(value: string | undefined): "webhook" {
  return value === "webhook" ? value : "webhook";
}

function parseTemplateVersion(value: string | undefined): "v1" {
  return value === "v1" ? value : "v1";
}

function parseTriggerMode(value: string | undefined): "poll" | "scheduler" {
  return value === "poll" ? "poll" : "scheduler";
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeWebhookUrl(value: string | undefined): string | undefined {
  const trimmed = normalizeOptionalString(value);
  if (!trimmed) return undefined;
  if (/^https?:\/\/example\.com\/webhook\/?$/i.test(trimmed)) return undefined;
  return trimmed;
}

function parseCsvList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function loadReporterConfig(): ReporterConfig {
  const summaryWebhookUrl = normalizeWebhookUrl(process.env.REPORTER_SUMMARY_WEBHOOK_URL);
  const rawMessageWebhookUrl = normalizeOptionalString(process.env.MESSAGE_WEBHOOK_URL);
  const messageWebhookUrl = normalizeWebhookUrl(rawMessageWebhookUrl)
    ?? (summaryWebhookUrl && rawMessageWebhookUrl ? summaryWebhookUrl : rawMessageWebhookUrl);
  const discordWatchBotToken = normalizeOptionalString(process.env.DISCORD_WATCH_BOT_TOKEN);
  const discordWatchChannelIds = parseCsvList(process.env.DISCORD_WATCH_CHANNEL_IDS);
  const discordWatchGuildId = normalizeOptionalString(process.env.DISCORD_WATCH_GUILD_ID) ?? "discord-watch";
  const discordWatchCommandPrefix = normalizeOptionalString(process.env.DISCORD_WATCH_COMMAND_PREFIX) ?? "!watch";
  const discordWatchPollLimit = Math.min(100, Math.max(5, parseNumber(process.env.DISCORD_WATCH_POLL_LIMIT, 25)));
  const discordWatchEnabled = parseBoolean(process.env.DISCORD_WATCH_ENABLED, false)
    && !!discordWatchBotToken
    && discordWatchChannelIds.length > 0;

  return {
    enabled: parseBoolean(process.env.REPORTER_ENABLED, true),
    killSwitch: parseBoolean(process.env.REPORTER_KILL_SWITCH, false),
    triggerMode: parseTriggerMode(process.env.REPORTER_TRIGGER_MODE),
    pollIntervalSec: Math.max(10, parseNumber(process.env.REPORTER_POLL_INTERVAL_SEC, 300)),
    spreadsheetId: normalizeOptionalString(process.env.GOOGLE_SHEETS_SPREADSHEET_ID),
    sheetsCredentialsPath: normalizeOptionalString(process.env.GOOGLE_SHEETS_CREDENTIALS_JSON),
    messageProvider: parseMessageProvider(process.env.MESSAGE_PROVIDER),
    messageWebhookUrl,
    templateVersion: parseTemplateVersion(process.env.MESSAGE_TEMPLATE_VERSION),
    maxPerSellerPerDay: Math.max(1, parseNumber(process.env.REPORTER_MAX_PER_SELLER_PER_DAY, 2)),
    quietHours: process.env.REPORTER_QUIET_HOURS || "23-08",
    dedupeTtlHours: Math.max(1, parseNumber(process.env.REPORTER_DEDUPE_TTL_HOURS, 720)),
    sendEnabled: parseBoolean(process.env.REPORTER_SEND_ENABLED, false),
    summaryEnabled: parseBoolean(process.env.REPORTER_SUMMARY_ENABLED, false),
    summaryWebhookUrl,
    summaryMaxItems: Math.max(1, parseNumber(process.env.REPORTER_SUMMARY_MAX_ITEMS, 6)),
    discordWatchEnabled,
    discordWatchBotToken,
    discordWatchChannelIds,
    discordWatchGuildId,
    discordWatchCommandPrefix,
    discordWatchPollLimit,
  };
}
