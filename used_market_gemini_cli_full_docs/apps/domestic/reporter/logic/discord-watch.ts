import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { listSupportedSites } from "../../collector/logic/sites.js";
import { type MergedItem, type NormalizedComponent } from "../../MCP/logic/types.js";
import { MockProvider } from "../../MCP/logic/mockProvider.js";
import { Orchestrator } from "../../MCP/logic/orchestrator.js";
import { COMPONENT_PATTERNS, type ComponentPatternEntry } from "../../market/logic/componentCatalog.js";
import { buildRamAwareComponentKey, listSupportedRamBrands } from "../../market/logic/ram-brand.js";

export type DiscordWatchCategory = Extract<ComponentPatternEntry["componentType"], "cpu" | "gpu" | "ram" | "ssd" | "psu" | "motherboard">;

export interface DiscordWatchQuestionOption {
  label: string;
  description: string;
}

export interface DiscordWatchQuestion {
  id: string;
  header: string;
  question: string;
  options: DiscordWatchQuestionOption[];
}

export interface DiscordWatchCommandInput {
  channelId: string;
  guildId: string;
  userId: string;
  message: string;
}

export interface DiscordWatchRecord {
  id: string;
  channel_id: string;
  guild_id: string;
  user_id: string;
  request_text: string;
  category: DiscordWatchCategory;
  model_name: string;
  search_query: string;
  target_price: number;
  site_keys: string[];
  created_at: string;
  updated_at: string;
  last_checked_at: string | null;
  last_seen_price: number | null;
  last_seen_title: string | null;
  last_seen_url: string | null;
  last_notified_at: string | null;
}

interface DiscordWatchListingPreview {
  title: string;
  price: number | null;
  url: string;
  model_name: string;
}

interface DiscordWatchDraftPreview {
  search_query: string;
  category_candidates: DiscordWatchCategory[];
  model_candidates: string[];
  listing_examples: DiscordWatchListingPreview[];
}

interface DiscordWatchDraft {
  id: string;
  mode: "add" | "delete";
  request: DiscordWatchCommandInput;
  target_price: number | null;
  search_query: string;
  category_candidates: DiscordWatchCategory[];
  selected_category: DiscordWatchCategory | null;
  model_candidates: string[];
  selected_model: string | null;
  awaiting: "category" | "model" | "target_price" | "confirm" | null;
  preview: DiscordWatchDraftPreview | null;
  created_at: string;
  updated_at: string;
}

export interface DiscordWatchAlert {
  id: string;
  watch_id: string;
  channel_id: string;
  guild_id: string;
  user_id: string;
  status: "pending" | "sent";
  fingerprint: string;
  created_at: string;
  delivered_at: string | null;
  discord_payload: {
    content: string;
    embeds: Array<{
      title: string;
      description: string;
      color: number;
    }>;
  };
}

interface DiscordWatchState {
  version: 1;
  watches: DiscordWatchRecord[];
  drafts: DiscordWatchDraft[];
  alerts: DiscordWatchAlert[];
}

export type DiscordWatchMessageResult =
  | {
      handled: false;
      reason: "not_watch_command";
    }
  | {
      handled: true;
      status: "completed";
      message: string;
      watch?: DiscordWatchRecord;
      deleted_count?: number;
    }
  | {
      handled: true;
      status: "needs_user_input";
      draft_id: string;
      questions: DiscordWatchQuestion[];
      message: string;
    };

export type DiscordWatchResolveResult = DiscordWatchMessageResult;

export interface DiscordWatchWorkflowRunner {
  runWatchSearch(watch: DiscordWatchRecord): Promise<{
    run_id?: string;
    merged_items: MergedItem[];
  }>;
}

export interface RunDiscordWatchChecksResult {
  checked_watch_count: number;
  due_watch_count: number;
  created_alert_count: number;
  alerts: DiscordWatchAlert[];
}

export interface DiscordWatchDraftSummary {
  draft_id: string;
  mode: "add" | "delete";
  channel_id: string;
  guild_id: string;
  user_id: string;
  awaiting: DiscordWatchDraft["awaiting"];
  category: DiscordWatchCategory | null;
  model_name: string | null;
  target_price: number | null;
  request_text: string;
  created_at: string;
  updated_at: string;
}

const NORMAL_CHECK_INTERVAL_MS = 15 * 60 * 1000;
const FAST_CHECK_INTERVAL_MS = 3 * 60 * 1000;
const NEAR_TARGET_MULTIPLIER = 1.12;
const WATCH_CATEGORY_ORDER: DiscordWatchCategory[] = ["cpu", "gpu", "ram", "ssd", "psu", "motherboard"];
const KOREAN_SITE_KEYS = listSupportedSites()
  .filter((site) => site.locale === "ko-KR")
  .map((site) => site.key);

const RAM_BRAND_ALIASES: Array<{ brand: string; patterns: RegExp[] }> = [
  { brand: "Samsung", patterns: [/\bsamsung\b/i, /삼성/i] },
  { brand: "SK hynix", patterns: [/\bhynix\b/i, /\bsk\s*hynix\b/i, /하이닉스/i] },
  { brand: "Micron", patterns: [/\bmicron\b/i, /\bcrucial\b/i, /마이크론/i, /크루셜/i] },
  { brand: "Corsair", patterns: [/\bcorsair\b/i, /커세어/i] },
  { brand: "G\.SKILL", patterns: [/\bg[\s.-]*skill\b/i, /지스킬/i] },
];

const SSD_BRAND_ALIASES: Array<{ brand: string; patterns: RegExp[] }> = [
  { brand: "Samsung", patterns: [/\bsamsung\b/i, /삼성/i] },
  { brand: "WD", patterns: [/\bwd\b/i, /western digital/i] },
  { brand: "SK hynix", patterns: [/\bhynix\b/i, /\bsk\s*hynix\b/i, /하이닉스/i] },
  { brand: "Crucial", patterns: [/\bcrucial\b/i, /크루셜/i] },
  { brand: "Micron", patterns: [/\bmicron\b/i, /마이크론/i] },
];

const BRAND_INFO_KEYWORDS = /(\uBE0C\uB79C\uB4DC|\uC81C\uC870\uC0AC|brand|\uBA54\uC774\uCEE4)/i;
const BRAND_INFO_PROMPT_KEYWORDS = /(\uC5B4\uB5A4|\uBB50|\uBAA9\uB85D|\uC885\uB958|\uC54C\uB824|\uBCF4\uC5EC|\uC788\uC5B4|list|what|show|which|available)/i;

function nowIso() {
  return new Date().toISOString();
}

function formatCategory(category: DiscordWatchCategory) {
  return category.toUpperCase();
}

function formatCurrency(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "unknown";
  }

  return `${new Intl.NumberFormat("ko-KR").format(Math.round(value))}원`;
}

function normalizeText(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function isApplyAnswer(text: string) {
  return /^(apply|confirm|yes|y|ok|등록|적용|맞아|맞습니다|응|네|1)$/i.test(text.trim());
}

function isCancelAnswer(text: string) {
  return /^(cancel|abort|stop|no|n|취소|중단|아니|아니요|0)$/i.test(text.trim());
}

function readJsonSafely<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function getStateFilePath(customStateFile?: string) {
  return customStateFile
    ? path.resolve(customStateFile)
    : path.resolve(process.cwd(), "merge/result/reporter/discord-watch/state.json");
}

async function loadState(stateFile?: string): Promise<DiscordWatchState> {
  const resolved = getStateFilePath(stateFile);
  try {
    const raw = await readFile(resolved, "utf-8");
    const parsed = readJsonSafely<Partial<DiscordWatchState>>(raw, {});
    return {
      version: 1,
      watches: Array.isArray(parsed.watches) ? parsed.watches : [],
      drafts: Array.isArray(parsed.drafts) ? parsed.drafts : [],
      alerts: Array.isArray(parsed.alerts) ? parsed.alerts : [],
    };
  } catch {
    return {
      version: 1,
      watches: [],
      drafts: [],
      alerts: [],
    };
  }
}

async function saveState(state: DiscordWatchState, stateFile?: string) {
  const resolved = getStateFilePath(stateFile);
  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(resolved, JSON.stringify(state, null, 2), "utf-8");
}

function toDraftSummary(draft: DiscordWatchDraft): DiscordWatchDraftSummary {
  return {
    draft_id: draft.id,
    mode: draft.mode,
    channel_id: draft.request.channelId,
    guild_id: draft.request.guildId,
    user_id: draft.request.userId,
    awaiting: draft.awaiting,
    category: draft.selected_category,
    model_name: draft.selected_model,
    target_price: draft.target_price,
    request_text: draft.request.message,
    created_at: draft.created_at,
    updated_at: draft.updated_at,
  };
}

function isListCommand(text: string) {
  return /(감시\s*목록|현재\s*감시|목록\s*보여|감시\s*리스트|watch\s*list|show\s*(?:me\s*)?watch(?:es)?|list\s*watch(?:es)?)/i.test(text);
}

function isDeleteCommand(text: string) {
  return /(감시\s*삭제|감시\s*지워|감시\s*해제|삭제해줘|지워줘|remove\s*watch|delete\s*watch|unwatch)/i.test(text);
}

function isAddCommand(text: string) {
  return /(감시|알려줘|추가해줘|추가|나오면|알림|오면|watch|notify|alert|register|add)/i.test(text);
}

function parseTargetPrice(text: string): number | null {
  const compact = text.replace(/,/g, "");
  const manMatch = compact.match(/(\d+(?:\.\d+)?)\s*만\s*원?/i) ?? compact.match(/(\d+(?:\.\d+)?)\s*만(?=\s|$|이하|아래|밑)/i);
  if (manMatch) {
    return Math.round(Number(manMatch[1]) * 10_000);
  }

  const wonMatch = compact.match(/(\d+)\s*원/i);
  if (wonMatch) {
    return Number(wonMatch[1]);
  }

  const rawNumbers = Array.from(compact.matchAll(/\d+/g))
    .map((match) => Number(match[0]))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (rawNumbers.length > 0) {
    return Math.max(...rawNumbers);
  }

  return null;
}

function cleanSearchQuery(text: string) {
  return text
    .replace(/[,]/g, " ")
    .replace(/(\d+(?:\.\d+)?)\s*만\s*원?/gi, " ")
    .replace(/(\d+)\s*원/gi, " ")
    .replace(/이하|아래|밑|under/gi, " ")
    .replace(/감시\s*(?:목록|리스트)?/gi, " ")
    .replace(/추가해줘|추가|삭제해줘|삭제|지워줘|지워|해제|register|add|remove|delete|unwatch/gi, " ")
    .replace(/보여줘|알려줘|notify|alert|watch/gi, " ")
    .replace(/나오면|오면/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function categoryDescriptions(category: DiscordWatchCategory) {
  if (category === "ram") return "RAM / 메모리 감시";
  if (category === "ssd") return "SSD / NVMe 감시";
  if (category === "gpu") return "GPU / 그래픽카드 감시";
  if (category === "cpu") return "CPU 감시";
  if (category === "psu") return "파워서플라이 감시";
  return "메인보드 감시";
}

function inferCategoryCandidates(text: string): DiscordWatchCategory[] {
  const matched = new Set<DiscordWatchCategory>();
  for (const pattern of COMPONENT_PATTERNS) {
    if (pattern.componentType === "ram" || pattern.componentType === "ssd" || pattern.componentType === "cpu" || pattern.componentType === "gpu" || pattern.componentType === "psu" || pattern.componentType === "motherboard") {
      if (pattern.patterns.some((entry) => entry.test(text))) {
        matched.add(pattern.componentType);
      }
    }
  }

  const normalized = normalizeText(text);
  if (/\bram\b/.test(normalized) || /램|메모리/.test(text)) matched.add("ram");
  if (/\bssd\b/.test(normalized) || /\bnvme\b/.test(normalized) || /스스디/.test(text)) matched.add("ssd");
  if (/\bgpu\b/.test(normalized) || /그래픽|지포스|라데온/.test(text)) matched.add("gpu");
  if (/\bcpu\b/.test(normalized) || /라이젠|코어|프로세서/.test(text)) matched.add("cpu");
  if (/\bpsu\b/.test(normalized) || /파워/.test(text)) matched.add("psu");
  if (/메인보드/.test(text) || /\bmobo\b/.test(normalized) || /\bmotherboard\b/.test(normalized)) matched.add("motherboard");

  return WATCH_CATEGORY_ORDER.filter((category) => matched.has(category));
}

function inferBrand(text: string, aliases: Array<{ brand: string; patterns: RegExp[] }>) {
  for (const alias of aliases) {
    if (alias.patterns.some((pattern) => pattern.test(text))) {
      return alias.brand;
    }
  }

  return null;
}

function extractCatalogBrand(category: DiscordWatchCategory, canonical: string) {
  if (category !== "ssd") {
    return null;
  }

  if (/^SSD\b/i.test(canonical)) {
    return null;
  }

  if (/^SK hynix\b/i.test(canonical)) {
    return "SK hynix";
  }

  return canonical.split(/\s+/)[0] ?? null;
}

function listSupportedBrands(category: DiscordWatchCategory) {
  if (category === "ram") {
    return listSupportedRamBrands();
  }

  if (category === "ssd") {
    return unique(
      COMPONENT_PATTERNS
        .filter((entry) => entry.componentType === "ssd")
        .map((entry) => extractCatalogBrand("ssd", entry.canonical))
        .filter((brand): brand is string => Boolean(brand)),
    );
  }

  return [];
}

function buildBrandExamples(category: DiscordWatchCategory, text: string) {
  if (category === "ram") {
    const capacity = parseCapacityGb(text) ?? 8;
    const generation = text.match(/DDR\s*([45])/i)?.[0]?.toUpperCase().replace(/\s+/g, "") ?? "DDR4";
    return listSupportedBrands("ram")
      .slice(0, 4)
      .map((brand) => `${brand} ${generation} ${capacity}GB`);
  }

  if (category === "ssd") {
    const capacity = parseCapacityGb(text);
    const brandedCanonicals = COMPONENT_PATTERNS
      .filter((entry) => entry.componentType === "ssd")
      .map((entry) => entry.canonical)
      .filter((canonical) => !/^SSD\b/i.test(canonical))
      .filter((canonical) => capacity === null || parseCapacityGb(canonical) === capacity);

    return unique(brandedCanonicals).slice(0, 4);
  }

  return [];
}

function formatBrandHint(category: DiscordWatchCategory, text: string) {
  const brands = listSupportedBrands(category);
  if (brands.length === 0) {
    return null;
  }

  const examples = buildBrandExamples(category, text);
  const lines = [`\uC9C0\uC6D0 \uBE0C\uB79C\uB4DC: ${brands.join(", ")}`];

  if (examples.length > 0) {
    lines.push(`\uC608\uC2DC: ${examples.join(" / ")}`);
  }

  return lines.join("\n");
}

function isBrandInfoCommand(text: string) {
  return BRAND_INFO_KEYWORDS.test(text) && BRAND_INFO_PROMPT_KEYWORDS.test(text);
}

function buildBrandInfoMessage(text: string) {
  const categories = inferCategoryCandidates(text).filter((category) => category === "ram" || category === "ssd");
  if (categories.length === 0) {
    return [
      "\uBE0C\uB79C\uB4DC\uBCC4 \uAC10\uC2DC\uB294 RAM, SSD\uC5D0\uC11C \uC6B0\uC120 \uC9C0\uC6D0\uD569\uB2C8\uB2E4.",
      formatBrandHint("ram", text),
      formatBrandHint("ssd", text),
      `\uC608: "\uC0BC\uC131 \uB7A8 8GB 40000\uC6D0 \uC774\uD558 \uAC10\uC2DC\uD574\uC918", "WD SN550 1TB 60000\uC6D0 \uC774\uD558 \uAC10\uC2DC \uCD94\uAC00\uD574\uC918"`,
    ].filter((line): line is string => Boolean(line)).join("\n");
  }

  return categories.map((category) => {
    const title = `[${formatCategory(category)}]`;
    const hint = formatBrandHint(category, text) ?? "\uB4F1\uB85D\uB41C \uBE0C\uB79C\uB4DC \uC815\uBCF4\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.";
    return `${title} ${hint}`;
  }).join("\n\n");
}

function inferRamModel(text: string, candidate: string) {
  const ramKey = buildRamAwareComponentKey(
    {
      component_type: "ram",
      canonical_name: candidate,
      source_text: text,
    },
    text,
  );
  return ramKey;
}

function inferModelCandidates(text: string, category: DiscordWatchCategory | null): string[] {
  if (!category) return [];

  const candidates = COMPONENT_PATTERNS
    .filter((entry) => entry.componentType === category)
    .filter((entry) => entry.patterns.some((pattern) => pattern.test(text)))
    .map((entry) => entry.canonical);

  const uniqueCandidates = unique(candidates);
  if (category === "ram") {
    return uniqueCandidates.map((candidate) => inferRamModel(text, candidate));
  }

  return uniqueCandidates;
}

function parseCapacityGb(text: string): number | null {
  const tbMatch = text.match(/(\d+(?:\.\d+)?)\s*tb/i);
  if (tbMatch) {
    return Math.round(Number(tbMatch[1]) * 1024);
  }

  const gbMatch = text.match(/(\d+)\s*gb/i);
  if (gbMatch) {
    return Number(gbMatch[1]);
  }

  const gigaMatch = text.match(/(\d+)\s*g\b/i);
  if (gigaMatch) {
    return Number(gigaMatch[1]);
  }

  return null;
}

interface WatchModelShape {
  category: DiscordWatchCategory;
  normalized: string;
  brand: string | null;
  generation: string | null;
  capacity_gb: number | null;
  generic_bucket: boolean;
}

function buildWatchModelShape(category: DiscordWatchCategory, modelName: string): WatchModelShape {
  const normalized = normalizeText(modelName);
  const brand = category === "ram"
    ? inferBrand(modelName, RAM_BRAND_ALIASES)
    : category === "ssd"
      ? inferBrand(modelName, SSD_BRAND_ALIASES)
      : null;
  const generation = category === "ram"
    ? (modelName.match(/DDR\s*([45])/i)?.[0]?.toUpperCase().replace(/\s+/g, "") ?? null)
    : null;
  const capacity = category === "ram" || category === "ssd" ? parseCapacityGb(modelName) : null;
  const genericBucket = category === "ssd"
    ? /^ssd\b/i.test(modelName)
    : category === "ram"
      ? /^(?:samsung\s+|sk hynix\s+|micron\s+|corsair\s+|g\.skill\s+)?ddr[45]\b/i.test(modelName)
      : false;

  return {
    category,
    normalized,
    brand,
    generation,
    capacity_gb: capacity,
    generic_bucket: genericBucket,
  };
}

function buildCandidateComponentKey(category: DiscordWatchCategory, component: NormalizedComponent, item: Pick<MergedItem, "title" | "raw_notes" | "detail_excerpt">) {
  if (category === "ram") {
    return buildRamAwareComponentKey(component, item.title, item.raw_notes, item.detail_excerpt);
  }

  return component.canonical_name;
}

function shapesMatch(requestShape: WatchModelShape, candidateShape: WatchModelShape, allowSubset = false) {
  if (requestShape.category !== candidateShape.category) {
    return false;
  }

  if (requestShape.category === "ram" || requestShape.category === "ssd") {
    if (requestShape.capacity_gb !== null && candidateShape.capacity_gb !== null && requestShape.capacity_gb !== candidateShape.capacity_gb) {
      return false;
    }

    if (requestShape.brand && candidateShape.brand && requestShape.brand !== candidateShape.brand) {
      return false;
    }

    if (requestShape.category === "ram" && requestShape.generation && candidateShape.generation && requestShape.generation !== candidateShape.generation) {
      return false;
    }

    if (requestShape.generic_bucket || allowSubset) {
      return true;
    }
  }

  return candidateShape.normalized === requestShape.normalized
    || candidateShape.normalized.includes(requestShape.normalized)
    || (allowSubset && requestShape.normalized.includes(candidateShape.normalized));
}

function buildPreviewSearchQuery(draft: DiscordWatchDraft) {
  const parts = [
    draft.selected_category ? formatCategory(draft.selected_category) : null,
    draft.selected_model,
    draft.search_query,
    draft.request.message,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim());

  return unique(parts).join(" ").trim() || "used pc parts";
}

function buildPreviewWatchRecord(draft: DiscordWatchDraft): DiscordWatchRecord {
  const now = nowIso();
  return {
    id: draft.id,
    channel_id: draft.request.channelId,
    guild_id: draft.request.guildId,
    user_id: draft.request.userId,
    request_text: draft.request.message,
    category: draft.selected_category ?? "cpu",
    model_name: draft.selected_model ?? (draft.search_query || "preview"),
    search_query: buildPreviewSearchQuery(draft),
    target_price: draft.target_price ?? Number.MAX_SAFE_INTEGER,
    site_keys: KOREAN_SITE_KEYS,
    created_at: now,
    updated_at: now,
    last_checked_at: null,
    last_seen_price: null,
    last_seen_title: null,
    last_seen_url: null,
    last_notified_at: null,
  };
}

function sortPreviewItems(items: MergedItem[], targetPrice: number | null) {
  return [...items].sort((left, right) => {
    const leftBelow = targetPrice !== null && left.price_value !== null ? left.price_value <= targetPrice : false;
    const rightBelow = targetPrice !== null && right.price_value !== null ? right.price_value <= targetPrice : false;
    if (leftBelow !== rightBelow) {
      return leftBelow ? -1 : 1;
    }

    const leftPrice = left.price_value ?? Number.MAX_SAFE_INTEGER;
    const rightPrice = right.price_value ?? Number.MAX_SAFE_INTEGER;
    if (leftPrice !== rightPrice) {
      return leftPrice - rightPrice;
    }

    return (right.score_hint ?? 0) - (left.score_hint ?? 0);
  });
}

async function buildDraftPreview(
  draft: DiscordWatchDraft,
  runner: DiscordWatchWorkflowRunner,
): Promise<DiscordWatchDraftPreview | null> {
  if (draft.mode !== "add" || !draft.selected_category) {
    return null;
  }

  const previewWatch = buildPreviewWatchRecord(draft);
  const result = await runner.runWatchSearch(previewWatch);
  const category = draft.selected_category;
  const matchingItems = sortPreviewItems(
    result.merged_items
      .filter((item) => isCandidateActive(item))
      .filter((item) => item.components.some((component) => component.component_type === category))
      .filter((item) => draft.selected_model ? matchesWatchModel({
        ...previewWatch,
        model_name: draft.selected_model,
      }, item) : true),
    draft.target_price,
  );

  const previewModelCandidates = unique(
    matchingItems
      .flatMap((item) =>
        item.components
          .filter((component) => component.component_type === category)
          .map((component) => buildCandidateComponentKey(category, component, item)),
      ),
  ).slice(0, 8);

  return {
    search_query: previewWatch.search_query,
    category_candidates: draft.category_candidates.length > 0 ? draft.category_candidates : [category],
    model_candidates: previewModelCandidates.length > 0
      ? previewModelCandidates
      : draft.model_candidates,
    listing_examples: matchingItems.slice(0, 5).map((item) => ({
      title: item.title,
      price: item.price_value,
      url: item.url,
      model_name:
        item.components
          .filter((component) => component.component_type === category)
          .map((component) => buildCandidateComponentKey(category, component, item))[0]
        ?? formatCategory(category),
    })),
  };
}

function buildQuestionForCategory(draft: DiscordWatchDraft): DiscordWatchQuestion {
  const options = (draft.category_candidates.length > 0 ? draft.category_candidates : WATCH_CATEGORY_ORDER).map((category) => ({
    label: formatCategory(category),
    description: categoryDescriptions(category),
  }));

  return {
    id: "category",
    header: "분류 확인",
    question: "감시할 부품 분류를 확인해 주세요.",
    options,
  };
}

function formatPreviewExamples(preview: DiscordWatchDraftPreview | null) {
  if (!preview || preview.listing_examples.length === 0) {
    return "Recent listing examples: none yet";
  }

  return [
    "Recent listing examples:",
    ...preview.listing_examples.map((example, index) =>
      `${index + 1}. ${example.model_name} | ${formatCurrency(example.price)} | ${example.title} | ${example.url}`,
    ),
  ].join("\n");
}

function buildDraftSummary(draft: DiscordWatchDraft) {
  const preview = draft.preview;
  const categoryLabels = (preview?.category_candidates ?? draft.category_candidates)
    .map((category) => formatCategory(category))
    .join(", ")
    || "none";
  const modelLabels = (preview?.model_candidates ?? draft.model_candidates)
    .slice(0, 8)
    .join(", ")
    || "none";

  return [
    `Detected categories: ${categoryLabels}`,
    `Possible models: ${modelLabels}`,
    `Target price: ${formatCurrency(draft.target_price)}`,
    `Registration summary: ${draft.selected_category ? formatCategory(draft.selected_category) : "unknown"} / ${draft.selected_model ?? "model not fixed yet"} / ${formatCurrency(draft.target_price)}`,
    `Search query: ${preview?.search_query ?? buildPreviewSearchQuery(draft)}`,
    formatPreviewExamples(preview ?? null),
  ].join("\n");
}

function buildQuestionForModel(draft: DiscordWatchDraft): DiscordWatchQuestion {
  return {
    id: "model",
    header: "Model preview",
    question: [
      draft.preview?.model_candidates?.length
        ? "Pick one of the possible models below, or type your own model name."
        : `Type the model you want to watch for ${formatCategory(draft.selected_category!)}.`,
      buildDraftSummary(draft),
    ].join("\n\n"),
    options: (draft.preview?.model_candidates ?? draft.model_candidates).slice(0, 8).map((candidate) => ({
      label: candidate,
      description: `${formatCategory(draft.selected_category!)} candidate model`,
    })),
  };
}

function buildQuestionForTarget(): DiscordWatchQuestion {
  return {
    id: "target_price",
    header: "Target price",
    question: "Type the target price, for example `40000원` or `4만원`.",
    options: [],
  };
}

function buildQuestionForConfirm(draft: DiscordWatchDraft): DiscordWatchQuestion {
  return {
    id: "confirm",
    header: "Apply watch",
    question: [
      buildDraftSummary(draft),
      "Reply with `apply` to save this watch, or `cancel` to discard it.",
    ].join("\n"),
    options: [
      {
        label: "apply",
        description: "Save the watch with the parsed category, model, and target price.",
      },
      {
        label: "cancel",
        description: "Discard this draft without registering a watch.",
      },
    ],
  };
}

function removeDraft(state: DiscordWatchState, draftId: string) {
  state.drafts = state.drafts.filter((draft) => draft.id !== draftId);
}

function findDraft(state: DiscordWatchState, draftId: string) {
  return state.drafts.find((draft) => draft.id === draftId) ?? null;
}

function findDraftByRequester(state: DiscordWatchState, request: Pick<DiscordWatchCommandInput, "channelId" | "guildId" | "userId">) {
  const matches = state.drafts
    .filter((draft) =>
      draft.request.channelId === request.channelId
      && draft.request.guildId === request.guildId
      && draft.request.userId === request.userId
    )
    .sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at));

  return matches[0] ?? null;
}

function findMatchingWatches(state: DiscordWatchState, draft: DiscordWatchDraft) {
  if (!draft.selected_category || !draft.selected_model) {
    return [];
  }

  const requestShape = buildWatchModelShape(draft.selected_category, draft.selected_model);
  return state.watches.filter((watch) => {
    if (watch.channel_id !== draft.request.channelId) return false;
    if (watch.user_id !== draft.request.userId) return false;
    if (watch.category !== draft.selected_category) return false;
    const watchShape = buildWatchModelShape(watch.category, watch.model_name);
    return shapesMatch(requestShape, watchShape, true);
  });
}

function formatWatchList(watches: DiscordWatchRecord[]) {
  if (watches.length === 0) {
    return "현재 이 Discord 채널에 등록된 감시가 없습니다.";
  }

  return [
    "현재 감시 목록입니다.",
    ...watches.map((watch, index) => {
      const cadence = getWatchPollIntervalMs(watch) === FAST_CHECK_INTERVAL_MS ? "빠름" : "일반";
      return `${index + 1}. [${formatCategory(watch.category)}] ${watch.model_name} | 목표가 ${formatCurrency(watch.target_price)} 이하 | 최근가 ${formatCurrency(watch.last_seen_price)} | 주기 ${cadence}`;
    }),
  ].join("\n");
}

function buildDraftFromMessage(input: DiscordWatchCommandInput, mode: "add" | "delete"): DiscordWatchDraft {
  const cleanedQuery = cleanSearchQuery(input.message);
  const categoryCandidates = inferCategoryCandidates(input.message);
  const selectedCategory = categoryCandidates.length === 1 ? categoryCandidates[0] : null;
  const modelCandidates = inferModelCandidates(input.message, selectedCategory);
  const selectedModel = modelCandidates.length === 1 ? modelCandidates[0] : null;
  const targetPrice = mode === "add" ? parseTargetPrice(input.message) : null;

  let awaiting: DiscordWatchDraft["awaiting"] = null;
  if (!selectedCategory) {
    awaiting = "category";
  } else if (!selectedModel) {
    awaiting = "model";
  } else if (mode === "add" && targetPrice === null) {
    awaiting = "target_price";
  }

  return {
    id: randomUUID(),
    mode,
    request: input,
    target_price: targetPrice,
    search_query: cleanedQuery,
    category_candidates: categoryCandidates,
    selected_category: selectedCategory,
    model_candidates: modelCandidates,
    selected_model: selectedModel,
    awaiting,
    preview: null,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
}

function askForDraftInput(state: DiscordWatchState, draft: DiscordWatchDraft): DiscordWatchMessageResult {
  draft.updated_at = nowIso();
  state.drafts = [...state.drafts.filter((entry) => entry.id !== draft.id), draft];

  const question = draft.awaiting === "category"
    ? buildQuestionForCategory(draft)
    : draft.awaiting === "model"
      ? buildQuestionForModel(draft)
      : draft.awaiting === "target_price"
        ? buildQuestionForTarget()
        : buildQuestionForConfirm(draft);

  return {
    handled: true,
    status: "needs_user_input",
    draft_id: draft.id,
    questions: [question],
    message: "감시 조건이 조금 애매해서 한 가지만 확인할게요.",
  };
}

function finalizeAddWatch(state: DiscordWatchState, draft: DiscordWatchDraft): DiscordWatchMessageResult {
  const searchQuery = draft.search_query || draft.selected_model!;
  const now = nowIso();
  const existing = state.watches.find((watch) =>
    watch.channel_id === draft.request.channelId
    && watch.user_id === draft.request.userId
    && watch.category === draft.selected_category
    && normalizeText(watch.model_name) === normalizeText(draft.selected_model!)
  );

  if (existing) {
    existing.target_price = draft.target_price!;
    existing.search_query = searchQuery;
    existing.request_text = draft.request.message;
    existing.updated_at = now;
    existing.last_checked_at = now;
    removeDraft(state, draft.id);
    return {
      handled: true,
      status: "completed",
      message: `[${formatCategory(existing.category)}] ${existing.model_name} 감시를 목표가 ${formatCurrency(existing.target_price)} 이하로 업데이트했습니다.`,
      watch: existing,
    };
  }

  const created: DiscordWatchRecord = {
    id: randomUUID(),
    channel_id: draft.request.channelId,
    guild_id: draft.request.guildId,
    user_id: draft.request.userId,
    request_text: draft.request.message,
    category: draft.selected_category!,
    model_name: draft.selected_model!,
    search_query: searchQuery,
    target_price: draft.target_price!,
    site_keys: KOREAN_SITE_KEYS,
    created_at: now,
    updated_at: now,
    last_checked_at: now,
    last_seen_price: null,
    last_seen_title: null,
    last_seen_url: null,
    last_notified_at: null,
  };
  state.watches.push(created);
  removeDraft(state, draft.id);
  return {
    handled: true,
    status: "completed",
    message: `[${formatCategory(created.category)}] ${created.model_name} 감시를 저장했습니다. 목표가 ${formatCurrency(created.target_price)} 이하 매물이 나오면 이 채널에 알려드릴게요.`,
    watch: created,
  };
}

function finalizeDeleteWatch(state: DiscordWatchState, draft: DiscordWatchDraft): DiscordWatchMessageResult {
  const matches = findMatchingWatches(state, draft);
  if (matches.length === 0) {
    removeDraft(state, draft.id);
    return {
      handled: true,
      status: "completed",
      message: "삭제할 감시를 찾지 못했습니다.",
      deleted_count: 0,
    };
  }

  const ids = new Set(matches.map((watch) => watch.id));
  state.watches = state.watches.filter((watch) => !ids.has(watch.id));
  removeDraft(state, draft.id);
  return {
    handled: true,
    status: "completed",
    message: `${matches.length}개의 감시를 삭제했습니다: ${matches.map((watch) => `[${formatCategory(watch.category)}] ${watch.model_name}`).join(", ")}`,
    deleted_count: matches.length,
  };
}

function requestDraftConfirmation(state: DiscordWatchState, draft: DiscordWatchDraft): DiscordWatchMessageResult {
  draft.awaiting = "confirm";
  return askForDraftInput(state, draft);
}

async function hydrateDraftPreview(draft: DiscordWatchDraft, runner: DiscordWatchWorkflowRunner) {
  if (draft.mode !== "add" || !draft.selected_category) {
    draft.preview = null;
    return;
  }

  draft.preview = await buildDraftPreview(draft, runner);
  if (!draft.selected_model && draft.preview?.model_candidates.length === 1) {
    draft.selected_model = draft.preview.model_candidates[0];
  }
}

async function finalizeDraft(
  state: DiscordWatchState,
  draft: DiscordWatchDraft,
  runner: DiscordWatchWorkflowRunner,
): Promise<DiscordWatchMessageResult> {
  if (!draft.selected_category) {
    draft.awaiting = "category";
    return askForDraftInput(state, draft);
  }

  await hydrateDraftPreview(draft, runner);

  if (!draft.selected_model) {
    draft.awaiting = "model";
    draft.model_candidates = draft.preview?.model_candidates.length
      ? draft.preview.model_candidates
      : inferModelCandidates(draft.request.message, draft.selected_category);
    return askForDraftInput(state, draft);
  }

  if (draft.mode === "add" && draft.target_price === null) {
    draft.awaiting = "target_price";
    return askForDraftInput(state, draft);
  }

  if (draft.mode === "add" && draft.awaiting !== "confirm") {
    await hydrateDraftPreview(draft, runner);
    return requestDraftConfirmation(state, draft);
  }

  draft.awaiting = null;
  return draft.mode === "add"
    ? finalizeAddWatch(state, draft)
    : finalizeDeleteWatch(state, draft);
}

async function resolveDraftAnswer(
  state: DiscordWatchState,
  draft: DiscordWatchDraft,
  answer: string,
  runner: DiscordWatchWorkflowRunner,
): Promise<DiscordWatchResolveResult> {
  const trimmed = answer.trim();

  if (draft.awaiting === "confirm") {
    if (isCancelAnswer(trimmed)) {
      removeDraft(state, draft.id);
      return {
        handled: true,
        status: "completed",
        message: "Watch registration was cancelled.",
      };
    }

    if (!isApplyAnswer(trimmed)) {
      return requestDraftConfirmation(state, draft);
    }
  } else if (draft.awaiting === "category") {
    const category = WATCH_CATEGORY_ORDER.find((entry) => formatCategory(entry) === trimmed.toUpperCase())
      ?? inferCategoryCandidates(trimmed)[0]
      ?? null;
    draft.selected_category = category;
    draft.model_candidates = inferModelCandidates(`${draft.request.message} ${trimmed}`, category);
    draft.selected_model = draft.model_candidates.length === 1 ? draft.model_candidates[0] : null;
    draft.preview = null;
  } else if (draft.awaiting === "model") {
    const candidates = inferModelCandidates(`${draft.request.message} ${trimmed}`, draft.selected_category);
    if (draft.model_candidates.some((candidate) => candidate === trimmed)) {
      draft.selected_model = trimmed;
    } else if (candidates.length === 1) {
      draft.selected_model = candidates[0];
    } else if (trimmed) {
      draft.model_candidates = candidates;
      draft.selected_model = candidates.length === 1 ? candidates[0] : null;
      if (!draft.selected_model && draft.selected_category) {
        const fallbackCategory = draft.selected_category;
        if (fallbackCategory === "ram") {
          const genericCapacity = parseCapacityGb(trimmed);
          const genericGeneration = trimmed.match(/DDR\s*([45])/i)?.[0]?.toUpperCase().replace(/\s+/g, "") ?? "DDR4";
          const brand = inferBrand(trimmed, RAM_BRAND_ALIASES);
          if (genericCapacity !== null) {
            draft.selected_model = `${brand ? `${brand} ` : ""}${genericGeneration} ${genericCapacity}GB`;
          }
        } else if (fallbackCategory === "ssd") {
          const capacity = parseCapacityGb(trimmed);
          const brand = inferBrand(trimmed, SSD_BRAND_ALIASES);
          if (capacity !== null) {
            const capacityLabel = capacity % 1024 === 0 && capacity >= 1024
              ? `${capacity / 1024}TB`
              : `${capacity}GB`;
            draft.selected_model = brand ? `${brand} ${capacityLabel}` : `SSD ${capacityLabel}`;
          }
        }
      }
    }
    draft.preview = null;
  } else if (draft.awaiting === "target_price") {
    draft.target_price = parseTargetPrice(trimmed);
    draft.preview = null;
  }

  return finalizeDraft(state, draft, runner);
}

export async function handleDiscordWatchMessage(
  input: DiscordWatchCommandInput,
  options?: { stateFile?: string; workflowRunner?: DiscordWatchWorkflowRunner },
): Promise<DiscordWatchMessageResult> {
  const text = input.message.trim();
  if (!text) {
    return {
      handled: false,
      reason: "not_watch_command",
    };
  }

  const state = await loadState(options?.stateFile);
  const activeDraft = findDraftByRequester(state, input);
  const runner = options?.workflowRunner ?? new DefaultDiscordWatchWorkflowRunner();
  let result: DiscordWatchMessageResult;

  if (isBrandInfoCommand(text)) {
    result = {
      handled: true,
      status: "completed",
      message: buildBrandInfoMessage(text),
    };
  } else if (isListCommand(text)) {
    const watches = state.watches.filter((watch) => watch.channel_id === input.channelId);
    result = {
      handled: true,
      status: "completed",
      message: formatWatchList(watches),
    };
  } else if (activeDraft && isCancelAnswer(text)) {
    removeDraft(state, activeDraft.id);
    result = {
      handled: true,
      status: "completed",
      message: "Pending watch draft was cancelled.",
    };
  } else if (activeDraft && !isDeleteCommand(text) && !isAddCommand(text)) {
    result = await resolveDraftAnswer(state, activeDraft, text, runner);
  } else if (isDeleteCommand(text)) {
    const draft = buildDraftFromMessage(input, "delete");
    result = await finalizeDraft(state, draft, runner);
  } else if (isAddCommand(text)) {
    const draft = buildDraftFromMessage(input, "add");
    result = await finalizeDraft(state, draft, runner);
  } else {
    return {
      handled: false,
      reason: "not_watch_command",
    };
  }

  await saveState(state, options?.stateFile);
  return result;
}

export async function resolveDiscordWatchDraft(
  draftId: string,
  answer: string,
  options?: { stateFile?: string; workflowRunner?: DiscordWatchWorkflowRunner },
): Promise<DiscordWatchResolveResult> {
  const state = await loadState(options?.stateFile);
  const draft = findDraft(state, draftId);
  const runner = options?.workflowRunner ?? new DefaultDiscordWatchWorkflowRunner();
  if (!draft) {
    return {
      handled: true,
      status: "completed",
      message: "질문이 만료되어 다시 요청해 주세요.",
    };
  }

  const result = await resolveDraftAnswer(state, draft, answer, runner);
  await saveState(state, options?.stateFile);
  return result;
}

function getWatchPollIntervalMs(watch: Pick<DiscordWatchRecord, "last_seen_price" | "target_price">) {
  if (watch.last_seen_price === null) {
    return FAST_CHECK_INTERVAL_MS;
  }

  if (watch.last_seen_price <= Math.ceil(watch.target_price * NEAR_TARGET_MULTIPLIER)) {
    return FAST_CHECK_INTERVAL_MS;
  }

  return NORMAL_CHECK_INTERVAL_MS;
}

function isWatchDue(watch: DiscordWatchRecord, now = Date.now()) {
  const lastChecked = watch.last_checked_at ? Date.parse(watch.last_checked_at) : 0;
  return lastChecked + getWatchPollIntervalMs(watch) <= now;
}

class DefaultDiscordWatchWorkflowRunner implements DiscordWatchWorkflowRunner {
  private readonly orchestrator = new Orchestrator(new MockProvider());

  async runWatchSearch(watch: DiscordWatchRecord) {
    const result = await this.orchestrator.fullWorkflow({
      keyword: watch.search_query,
      sites: watch.site_keys,
      limit: 12,
    });
    const mergedResult = result.merged_result as { merged_items?: MergedItem[] } | undefined;

    return {
      run_id: typeof result.market_result_ref === "object" && result.market_result_ref && "run_id" in result.market_result_ref
        ? String(result.market_result_ref.run_id)
        : undefined,
      merged_items: Array.isArray(mergedResult?.merged_items)
        ? mergedResult.merged_items
        : [],
    };
  }
}

function isCandidateActive(item: MergedItem) {
  return item.item_status !== "sold" && item.sale_status !== "completed";
}

function matchesWatchModel(watch: DiscordWatchRecord, item: MergedItem) {
  const watchShape = buildWatchModelShape(watch.category, watch.model_name);
  const matchingComponents = item.components.filter((component) => component.component_type === watch.category);

  if (matchingComponents.length === 0) {
    return false;
  }

  return matchingComponents.some((component) => {
    const candidateKey = buildCandidateComponentKey(watch.category, component, item);
    const candidateShape = buildWatchModelShape(watch.category, candidateKey);
    return shapesMatch(watchShape, candidateShape, false);
  });
}

function buildAlertReason(watch: DiscordWatchRecord, item: MergedItem) {
  const baseline = item.baseline_price;
  const delta = baseline !== null && item.price_value !== null ? baseline - item.price_value : null;
  const matchedComponents = item.components
    .filter((component) => component.component_type === watch.category)
    .map((component) => buildCandidateComponentKey(watch.category, component, item));
  const reasons = [
    `분류 ${formatCategory(watch.category)} / 모델 ${watch.model_name} 조건에 일치했습니다.`,
    `현재가 ${formatCurrency(item.price_value)}가 목표가 ${formatCurrency(watch.target_price)} 이하입니다.`,
  ];

  if (matchedComponents.length > 0) {
    reasons.push(`매칭된 모델 해석: ${unique(matchedComponents).join(", ")}`);
  }

  if (delta !== null && delta > 0) {
    reasons.push(`기준가 ${formatCurrency(baseline)} 대비 ${formatCurrency(delta)} 저렴합니다.`);
  } else if (baseline !== null) {
    reasons.push(`기준가 ${formatCurrency(baseline)}를 함께 참고했습니다.`);
  }

  if (item.score_hint !== null) {
    reasons.push(`기회 점수 ${Math.round(item.score_hint)}점을 참고했습니다.`);
  }

  return reasons.join(" ");
}

function buildAlertFingerprint(watch: DiscordWatchRecord, item: MergedItem) {
  return normalizeText(`${watch.id}|${item.url}|${item.price_value ?? "na"}`);
}

function buildDiscordAlert(watch: DiscordWatchRecord, item: MergedItem): DiscordWatchAlert {
  const reason = buildAlertReason(watch, item);
  return {
    id: randomUUID(),
    watch_id: watch.id,
    channel_id: watch.channel_id,
    guild_id: watch.guild_id,
    user_id: watch.user_id,
    status: "pending",
    fingerprint: buildAlertFingerprint(watch, item),
    created_at: nowIso(),
    delivered_at: null,
    discord_payload: {
      content: `<@${watch.user_id}> 목표가 이하 매물을 찾았습니다.`,
      embeds: [
        {
          title: "중고 감시 알림",
          color: 0x16a34a,
          description: [
            `**${item.title}**`,
            `분류: \`${formatCategory(watch.category)}\``,
            `모델명: **${watch.model_name}**`,
            `현재가: **${formatCurrency(item.price_value)}**`,
            `목표가: **${formatCurrency(watch.target_price)}**`,
            `링크: ${item.url}`,
            `판단 근거: ${reason}`,
          ].join("\n"),
        },
      ],
    },
  };
}

export async function runDiscordWatchChecks(
  options?: {
    stateFile?: string;
    workflowRunner?: DiscordWatchWorkflowRunner;
    now?: Date;
  },
): Promise<RunDiscordWatchChecksResult> {
  const state = await loadState(options?.stateFile);
  const runner = options?.workflowRunner ?? new DefaultDiscordWatchWorkflowRunner();
  const createdAlerts: DiscordWatchAlert[] = [];
  const nowDate = options?.now ?? new Date();
  const nowMs = nowDate.getTime();
  let dueWatchCount = 0;

  for (const watch of state.watches) {
    if (!isWatchDue(watch, nowMs)) {
      continue;
    }

    dueWatchCount += 1;
    const result = await runner.runWatchSearch(watch);
    const matchingItems = result.merged_items
      .filter((item) => isCandidateActive(item))
      .filter((item) => item.price_value !== null && item.price_value <= watch.target_price)
      .filter((item) => matchesWatchModel(watch, item))
      .sort((left, right) => {
        const leftPrice = left.price_value ?? Number.MAX_SAFE_INTEGER;
        const rightPrice = right.price_value ?? Number.MAX_SAFE_INTEGER;
        if (leftPrice !== rightPrice) {
          return leftPrice - rightPrice;
        }

        return (right.score_hint ?? 0) - (left.score_hint ?? 0);
      });

    watch.last_checked_at = nowDate.toISOString();
    watch.updated_at = nowDate.toISOString();
    watch.last_seen_price = matchingItems[0]?.price_value ?? watch.last_seen_price;
    watch.last_seen_title = matchingItems[0]?.title ?? watch.last_seen_title;
    watch.last_seen_url = matchingItems[0]?.url ?? watch.last_seen_url;

    const knownFingerprints = new Set(
      state.alerts
        .filter((alert) => alert.watch_id === watch.id)
        .map((alert) => alert.fingerprint),
    );

    for (const item of matchingItems.slice(0, 3)) {
      const fingerprint = buildAlertFingerprint(watch, item);
      if (knownFingerprints.has(fingerprint)) {
        continue;
      }

      const alert = buildDiscordAlert(watch, item);
      state.alerts.push(alert);
      createdAlerts.push(alert);
      knownFingerprints.add(fingerprint);
    }
  }

  await saveState(state, options?.stateFile);
  return {
    checked_watch_count: state.watches.length,
    due_watch_count: dueWatchCount,
    created_alert_count: createdAlerts.length,
    alerts: createdAlerts,
  };
}

export async function pullPendingDiscordWatchAlerts(options?: { stateFile?: string }) {
  const state = await loadState(options?.stateFile);
  return state.alerts.filter((alert) => alert.status === "pending");
}

export async function pullPendingDiscordWatchDrafts(options?: { stateFile?: string }) {
  const state = await loadState(options?.stateFile);
  return state.drafts.map(toDraftSummary);
}

export async function acknowledgeDiscordWatchAlert(alertId: string, options?: { stateFile?: string }) {
  const state = await loadState(options?.stateFile);
  const alert = state.alerts.find((entry) => entry.id === alertId) ?? null;
  if (!alert) {
    return {
      acknowledged: false,
      reason: "alert_not_found",
    };
  }

  alert.status = "sent";
  alert.delivered_at = nowIso();
  const watch = state.watches.find((entry) => entry.id === alert.watch_id);
  if (watch) {
    watch.last_notified_at = alert.delivered_at;
    watch.updated_at = alert.delivered_at;
  }

  await saveState(state, options?.stateFile);
  return {
    acknowledged: true,
    alert_id: alert.id,
  };
}
