import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  acknowledgeDiscordWatchAlert,
  handleDiscordWatchMessage,
  pullPendingDiscordWatchAlerts,
  resolveDiscordWatchDraft,
  runDiscordWatchChecks,
  type DiscordWatchAlert,
  type DiscordWatchMessageResult,
  type DiscordWatchQuestion,
  type DiscordWatchWorkflowRunner,
} from "./discord-watch.js";

interface TransportUserMessage {
  version: number;
  id: string;
  kind: "user-message";
  channelId: string;
  guildId: string;
  userId: string;
  content: string;
  renderedPrompt: string;
  attachments?: Array<{ filePath: string; kind: "image" | "file" }>;
  createdAt: string;
}

interface TransportQuestionResponse {
  version: number;
  id: string;
  kind: "question-response";
  questionId: string;
  outboxItemId: string;
  answer?: string;
  answers?: string[];
  createdAt: string;
}

type TransportInboxItem = TransportUserMessage | TransportQuestionResponse;

interface DraftStateShape {
  drafts?: Array<{
    id?: string;
    request?: {
      channelId?: string;
      userId?: string;
    };
  }>;
}

export interface UsedMarketDiscordTransportGeneralInput {
  channelId: string;
  guildId: string;
  userId: string;
  content: string;
  renderedPrompt: string;
}

export type UsedMarketDiscordTransportGeneralHandler = (
  input: UsedMarketDiscordTransportGeneralInput,
) => Promise<string>;

export interface ProcessDiscordTransportOptions {
  projectPath?: string;
  watchStateFile?: string;
  workflowRunner?: DiscordWatchWorkflowRunner;
  generalRequestHandler?: UsedMarketDiscordTransportGeneralHandler;
  now?: Date;
}

export interface ProcessDiscordTransportResult {
  processedInboxCount: number;
  createdOutboxCount: number;
  createdAlertCount: number;
}

function getContractPath(projectPath: string, ...parts: string[]) {
  return path.join(projectPath, ".codex-discord", ...parts);
}

async function ensureDir(dirPath: string) {
  await mkdir(dirPath, { recursive: true });
}

async function writeJsonFile(filePath: string, payload: unknown) {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, JSON.stringify(payload, null, 2), "utf-8");
}

async function parseInboxItem(filePath: string): Promise<TransportInboxItem | null> {
  try {
    const payload = JSON.parse(await readFile(filePath, "utf-8")) as Partial<TransportInboxItem>;
    if (payload.kind === "user-message" && payload.channelId && payload.content) {
      return {
        version: Number(payload.version ?? 1),
        id: String(payload.id ?? randomUUID()),
        kind: "user-message",
        channelId: String(payload.channelId),
        guildId: String(payload.guildId ?? ""),
        userId: String(payload.userId ?? ""),
        content: String(payload.content),
        renderedPrompt: String(payload.renderedPrompt ?? payload.content),
        attachments: Array.isArray(payload.attachments) ? payload.attachments : [],
        createdAt: String(payload.createdAt ?? new Date().toISOString()),
      };
    }

    if (payload.kind === "question-response" && payload.outboxItemId) {
      return {
        version: Number(payload.version ?? 1),
        id: String(payload.id ?? randomUUID()),
        kind: "question-response",
        questionId: String(payload.questionId ?? ""),
        outboxItemId: String(payload.outboxItemId),
        answer: typeof payload.answer === "string" ? payload.answer : undefined,
        answers: Array.isArray(payload.answers) ? payload.answers.map((entry) => String(entry)) : undefined,
        createdAt: String(payload.createdAt ?? new Date().toISOString()),
      };
    }

    return null;
  } catch {
    return null;
  }
}

async function findDraftRoutingInfo(draftId: string, stateFile?: string) {
  if (!stateFile) {
    return null;
  }

  try {
    const payload = JSON.parse(await readFile(stateFile, "utf-8")) as DraftStateShape;
    const draft = payload.drafts?.find((entry) => entry.id === draftId);
    const channelId = draft?.request?.channelId;
    const userId = draft?.request?.userId;
    if (!channelId || !userId) {
      return null;
    }

    return { channelId, userId };
  } catch {
    return null;
  }
}

function buildQuestionOutbox(channelId: string, userId: string, draftId: string, question: DiscordWatchQuestion, message: string) {
  return {
    version: 1,
    id: draftId,
    kind: "question",
    channelId,
    createdAt: new Date().toISOString(),
    discordPayload: {
      content: `<@${userId}> ${message}`,
    },
    question: {
      id: question.id,
      header: question.header,
      question: question.question,
      options: question.options,
      multiSelect: false,
    },
  };
}

function buildMessageOutbox(channelId: string, content: string) {
  return {
    version: 1,
    id: randomUUID(),
    kind: "message",
    channelId,
    createdAt: new Date().toISOString(),
    discordPayload: {
      content,
    },
  };
}

function formatDefaultGeneralMessage(content: string) {
  return [
    `Used-market runtime could not classify this as a watch command: ${content}`,
    "Try explicit requests like:",
    "- watch RAM samsung DDR4 8GB 40000 alert",
    "- watch list",
    "- delete watch samsung ddr4 8gb",
  ].join("\n");
}

function formatCompletedMessage(userId: string, message: string) {
  return `<@${userId}> ${message}`;
}

function formatAlertMessage(alert: DiscordWatchAlert) {
  const embed = alert.discord_payload.embeds[0];
  return [alert.discord_payload.content, embed?.title ?? "Used-market alert", embed?.description ?? ""]
    .filter(Boolean)
    .join("\n\n");
}

async function writeOutboxPayload(projectPath: string, payload: unknown) {
  const outboxPendingDir = getContractPath(projectPath, "outbox", "pending");
  await writeJsonFile(path.join(outboxPendingDir, `${Date.now()}-${randomUUID()}.json`), payload);
}

async function writeResultToOutbox(
  projectPath: string,
  channelId: string,
  userId: string,
  result: DiscordWatchMessageResult,
): Promise<number> {
  if (!result.handled) {
    return 0;
  }

  if (result.status === "completed") {
    await writeOutboxPayload(projectPath, buildMessageOutbox(channelId, formatCompletedMessage(userId, result.message)));
    return 1;
  }

  const question = result.questions[0];
  await writeOutboxPayload(projectPath, buildQuestionOutbox(channelId, userId, result.draft_id, question, result.message));
  return 1;
}

async function processUserMessage(
  projectPath: string,
  item: TransportUserMessage,
  options: ProcessDiscordTransportOptions,
): Promise<number> {
  const watchResult = await handleDiscordWatchMessage(
    {
      channelId: item.channelId,
      guildId: item.guildId,
      userId: item.userId,
      message: item.content,
    },
    {
      stateFile: options.watchStateFile,
      workflowRunner: options.workflowRunner,
    },
  );

  if (watchResult.handled) {
    return writeResultToOutbox(projectPath, item.channelId, item.userId, watchResult);
  }

  const generalHandler = options.generalRequestHandler;
  const content = generalHandler
    ? await generalHandler({
        channelId: item.channelId,
        guildId: item.guildId,
        userId: item.userId,
        content: item.content,
        renderedPrompt: item.renderedPrompt,
      }).catch((error: unknown) => `Used-market request failed: ${error instanceof Error ? error.message : String(error)}`)
    : formatDefaultGeneralMessage(item.content);

  await writeOutboxPayload(projectPath, buildMessageOutbox(item.channelId, content));
  return 1;
}

async function processQuestionResponse(
  projectPath: string,
  item: TransportQuestionResponse,
  options: ProcessDiscordTransportOptions,
): Promise<number> {
  const draftRouting = await findDraftRoutingInfo(item.outboxItemId, options.watchStateFile);
  const answer = item.answer ?? item.answers?.[0] ?? "";
  const resolved = await resolveDiscordWatchDraft(
    item.outboxItemId,
    answer,
    {
      stateFile: options.watchStateFile,
      workflowRunner: options.workflowRunner,
    },
  );

  return writeResultToOutbox(
    projectPath,
    draftRouting?.channelId ?? "",
    draftRouting?.userId ?? "",
    resolved,
  );
}

async function processInboxItem(
  projectPath: string,
  item: TransportInboxItem,
  options: ProcessDiscordTransportOptions,
): Promise<number> {
  if (item.kind === "user-message") {
    return processUserMessage(projectPath, item, options);
  }

  return processQuestionResponse(projectPath, item, options);
}

export async function processDiscordTransportOnce(
  options: ProcessDiscordTransportOptions = {},
): Promise<ProcessDiscordTransportResult> {
  const projectPath = path.resolve(options.projectPath ?? process.cwd());
  const inboxPendingDir = getContractPath(projectPath, "inbox", "pending");
  const inboxProcessingDir = getContractPath(projectPath, "inbox", "processing");
  const inboxProcessedDir = getContractPath(projectPath, "inbox", "processed");

  await Promise.all([
    ensureDir(inboxPendingDir),
    ensureDir(inboxProcessingDir),
    ensureDir(inboxProcessedDir),
    ensureDir(getContractPath(projectPath, "outbox", "pending")),
  ]);

  let processedInboxCount = 0;
  let createdOutboxCount = 0;
  const inboxFiles = (await readdir(inboxPendingDir)).filter((entry) => entry.endsWith(".json")).sort();

  for (const fileName of inboxFiles) {
    const pendingPath = path.join(inboxPendingDir, fileName);
    const processingPath = path.join(inboxProcessingDir, fileName);
    const processedPath = path.join(inboxProcessedDir, fileName);

    try {
      await rename(pendingPath, processingPath);
    } catch {
      continue;
    }

    const item = await parseInboxItem(processingPath);
    if (item) {
      createdOutboxCount += await processInboxItem(projectPath, item, options);
      processedInboxCount += 1;
    }

    await rename(processingPath, processedPath);
  }

  const checks = await runDiscordWatchChecks({
    stateFile: options.watchStateFile,
    workflowRunner: options.workflowRunner,
    now: options.now,
  });

  const pendingAlerts = await pullPendingDiscordWatchAlerts({ stateFile: options.watchStateFile });
  for (const alert of pendingAlerts) {
    await writeOutboxPayload(projectPath, buildMessageOutbox(alert.channel_id, formatAlertMessage(alert)));
    await acknowledgeDiscordWatchAlert(alert.id, { stateFile: options.watchStateFile });
    createdOutboxCount += 1;
  }

  return {
    processedInboxCount,
    createdOutboxCount,
    createdAlertCount: checks.created_alert_count,
  };
}
