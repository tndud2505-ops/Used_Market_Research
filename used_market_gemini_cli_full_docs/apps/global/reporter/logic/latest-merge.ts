import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createBrowserSession } from "../../collector/logic/browserSession.js";
import { readMarketHistoryBundle } from "../../market/logic/history-reader.js";
import { buildManualPriceSeedDataset } from "../../market/logic/manual-price-seed.js";
import { isHardPruneNoiseReason } from "../../market/logic/noise-filter.js";
import { classifyCandidate, decisionRank } from "./decision.js";
import type {
  ReporterBuildComponentPrice,
  ReporterCandidate,
  ReporterCandidateComponent,
  ReporterHistoryPoint,
  ReporterPriceWindow,
  ReporterReferenceSource,
  ReporterSourceData
} from "./types.js";

interface RawLatestPayload {
  keyword?: unknown;
  merged_result?: {
    keyword?: unknown;
    merged_items?: Array<Record<string, unknown>>;
  };
  merged_items?: Array<Record<string, unknown>>;
  market_snapshot?: {
    windows?: Array<Record<string, unknown>>;
  };
}

interface KeywordContext {
  raw_keyword: string;
  stripped_keyword: string;
  normalized_keyword: string;
  synthetic_scan: boolean;
  build_like: boolean;
  target_types: Set<string>;
}

interface KeywordPayloadSelection {
  runId: string;
  payload: RawLatestPayload;
  keyword: string;
}

interface MarketReferenceSelection {
  reference_key: string;
  window7d: ReporterPriceWindow | null;
  window30d: ReporterPriceWindow | null;
  window90d: ReporterPriceWindow | null;
}

interface BuildComponentValuation {
  price_7d: number | null;
  price_30d: number | null;
  price_90d: number | null;
  trade_estimate_30d: number | null;
  source_30d: ReporterReferenceSource;
  priced_count: number;
  total_count: number;
  coverage_ratio: number;
  reference_key: string;
  breakdown: ReporterBuildComponentPrice[];
}

function stableItemId(source: string): string {
  return createHash("sha256").update(source).digest("hex").slice(0, 16);
}

function toStringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function toNumberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function toListingType(value: unknown): ReporterCandidate["listing_type"] {
  if (value === "full_pc" || value === "semi_pc" || value === "part") {
    return value;
  }
  return "unknown";
}

function toDemandStrength(value: unknown): ReporterCandidate["demand_strength"] {
  if (value === "high" || value === "medium" || value === "low") {
    return value;
  }
  return "medium";
}

function normalizeComponents(value: unknown): ReporterCandidateComponent[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const record = entry as Record<string, unknown>;
      const canonicalName = toStringValue(record.canonical_name);
      if (!canonicalName) return null;

      return {
        component_type: toStringValue(record.component_type, "unknown"),
        canonical_name: canonicalName,
        confidence: toNumberValue(record.confidence) ?? 0.5,
        source_kind: record.source_kind === "title"
          || record.source_kind === "search_notes"
          || record.source_kind === "detail_body"
          || record.source_kind === "mixed"
          ? record.source_kind
          : "title",
        evidence_level: record.evidence_level === "confirmed" ? "confirmed" : "estimated"
      } satisfies ReporterCandidateComponent;
    })
    .filter((entry): entry is ReporterCandidateComponent => entry !== null);
}

function pickPrimaryComponent(
  components: ReporterCandidateComponent[],
  keyword: string
): { name: string; type: string } {
  const priority = ["gpu", "cpu", "motherboard", "psu", "ram", "ssd"];
  for (const componentType of priority) {
    const match = components.find((component) => component.component_type === componentType);
    if (match) {
      return {
        name: match.canonical_name,
        type: match.component_type
      };
    }
  }

  if (components[0]) {
    return {
      name: components[0].canonical_name,
      type: components[0].component_type
    };
  }

  return {
    name: keyword || "unknown",
    type: "unknown"
  };
}

function buildBundleKey(components: ReporterCandidateComponent[]) {
  const cpu = components.find((component) => component.component_type === "cpu");
  const gpu = components.find((component) => component.component_type === "gpu");
  if (!cpu || !gpu) return null;
  return `${cpu.canonical_name} + ${gpu.canonical_name}`;
}

function hasPortablePcHint(text: string) {
  return /\b(laptop|notebook)\b/i.test(text) || /\uB178\uD2B8\uBD81|\uB7A9\uD0D1/i.test(text);
}

function hasBuildSaleContext(text: string) {
  return /(full\s*pc|gaming\s*(?:pc|desktop)|desktop\s*pc|tower\s*pc|\uBCF8\uCCB4|\uC870\uB9BD\s*pc|\uAC8C\uC774\uBC0D\s*(?:pc|\uCEF4\uD4E8\uD130|\uB370\uC2A4\uD06C\uD0D1)|\uCEF4\uD4E8\uD130\s*(?:\uBCF8\uCCB4|\uC0C8\uC81C\uD488)?|\uB370\uC2A4\uD06C\uD0D1(?!\uC6A9)|\bpc\b.*(?:\uD31D\uB2C8\uB2E4|\uD310\uB9E4)|(?:\uD31D\uB2C8\uB2E4|\uD310\uB9E4).*\bpc\b)/i.test(text);
}

function isConsumerComponentType(componentType: string) {
  return componentType === "cpu"
    || componentType === "gpu"
    || componentType === "ram"
    || componentType === "ssd"
    || componentType === "motherboard"
    || componentType === "psu";
}

function hasCandidateSignal(components: ReporterCandidateComponent[]) {
  return components.some((component) =>
    isConsumerComponentType(component.component_type)
  );
}

function readNoiseFilterReason(raw: Record<string, unknown>) {
  return toStringValue(raw.noise_filter_reason);
}

function getDistinctConsumerComponentTypes(components: ReporterCandidateComponent[]) {
  return new Set(
    components
      .filter((component) => isConsumerComponentType(component.component_type))
      .map((component) => component.component_type)
  );
}

function isReviewableBundledPartRaw(
  raw: Record<string, unknown>,
  components: ReporterCandidateComponent[]
) {
  if (readNoiseFilterReason(raw) !== "bundled_part_offer") {
    return false;
  }

  if (toListingType(raw.listing_type) !== "part") {
    return false;
  }

  const combinedText = [
    toStringValue(raw.title),
    toStringValue(raw.raw_notes),
    toStringValue(raw.detail_excerpt),
    toStringValue(raw.detail_fetch_note)
  ].join(" ").trim();
  if (!combinedText) {
    return false;
  }

  if (hasBuildSaleContext(combinedText)) {
    return false;
  }

  return getDistinctConsumerComponentTypes(components).size >= 2;
}

const STRONG_CPU_GPU_SIGNAL_PATTERN = /(rtx\s*\d{4}(?:\s*ti)?|rx\s*\d{4}(?:\s*xt)?|gtx\s*\d{3,4}|(?:ryzen|i[3579]|ultra)\s*[- ]?\d{0,2}[ ]?\d{4,5}[a-z0-9-]*|\b\d{4,5}(?:x3d|[fgkx])\b)/i;

function hasStrongCpuOrGpuSignal(
  components: ReporterCandidateComponent[],
  text: string
) {
  return components.some((component) =>
    (component.component_type === "cpu" || component.component_type === "gpu")
    && (
      component.evidence_level === "confirmed"
      || component.confidence >= 0.85
    )
  ) || STRONG_CPU_GPU_SIGNAL_PATTERN.test(text);
}

function isUnknownButInterestingRaw(
  raw: Record<string, unknown>,
  components: ReporterCandidateComponent[]
) {
  if (toListingType(raw.listing_type) !== "unknown") {
    return false;
  }

  const combinedText = [
    toStringValue(raw.title),
    toStringValue(raw.raw_notes),
    toStringValue(raw.detail_excerpt),
    toStringValue(raw.detail_fetch_note)
  ].join(" ").trim();
  if (!combinedText) {
    return false;
  }

  return hasStrongCpuOrGpuSignal(components, combinedText)
    && hasBuildSaleContext(combinedText);
}

function shouldSkipNoiseFilteredRawItem(
  raw: Record<string, unknown>,
  components: ReporterCandidateComponent[]
) {
  if (raw.noise_filtered !== true) {
    return false;
  }

  if (isHardPruneNoiseReason((readNoiseFilterReason(raw) as Parameters<typeof isHardPruneNoiseReason>[0]) ?? null)) {
    return true;
  }

  return !isReviewableBundledPartRaw(raw, components);
}

function normalizeComponentToken(value: string) {
  return value
    .toLowerCase()
    .replace(/^nvidia\s+/i, "")
    .replace(/^amd\s+radeon\s+/i, "")
    .replace(/^amd\s+/i, "")
    .replace(/^intel\s+core\s+/i, "")
    .replace(/\bunknown\b/gi, "")
    .replace(/[^a-z0-9]+/g, "");
}

function stripKeywordScanSuffix(keyword: string) {
  return keyword.replace(/(?:^|\s|[-_/])(scan)(?=$|\s|[-_/])/gi, " ").replace(/\s+/g, " ").trim();
}

function inferKeywordContext(keyword: string): KeywordContext {
  const rawKeyword = keyword.trim();
  const lowered = rawKeyword.toLowerCase();
  const strippedKeyword = stripKeywordScanSuffix(rawKeyword);
  const strippedLowered = strippedKeyword.toLowerCase();
  const targetTypes = new Set<string>();

  const addTargetType = (componentType: string, pattern: RegExp) => {
    if (pattern.test(strippedLowered)) {
      targetTypes.add(componentType);
    }
  };

  addTargetType("gpu", /\b(gpu|rtx|gtx|geforce|radeon|graphics?|graphic|vga)\b|그래픽|글카/);
  addTargetType("cpu", /\b(cpu|ryzen|threadripper|intel|pentium|celeron|ultra|xeon|athlon)\b|코어|라이젠|프로세서/);
  addTargetType("ram", /\b(ram|ddr[345]|memory)\b|램|메모리/);
  addTargetType("ssd", /\b(ssd|nvme|m\.?2|sata)\b|하드|스토리지/);
  addTargetType("motherboard", /\b(motherboard|mainboard|mobo|a\d{3}[a-z0-9-]*|b\d{3}[a-z0-9-]*|x\d{3}[a-z0-9-]*|z\d{3}[a-z0-9-]*|h\d{3}[a-z0-9-]*)\b|메인보드/);
  addTargetType("psu", /\b(psu|power\s*supply)\b|파워|파워서플라이|서플라이/);

  const buildLike = /\b(full\s*pc|gaming\s*(?:pc|desktop)|desktop|tower|build|complete\s*pc)\b|조립\s*pc|조립pc|게이밍\s*(?:pc|컴퓨터|데스크탑)|본체|컴퓨터/.test(strippedLowered);

  return {
    raw_keyword: rawKeyword,
    stripped_keyword: strippedKeyword,
    normalized_keyword: normalizeComponentToken(strippedKeyword),
    synthetic_scan: lowered.includes("-scan"),
    build_like: buildLike,
    target_types: targetTypes
  };
}

function partWindowMatchesKeyword(componentKey: string, keyword: string) {
  const normalizedKey = normalizeComponentToken(componentKey);
  const normalizedKeyword = inferKeywordContext(keyword).normalized_keyword;
  if (!normalizedKey || !normalizedKeyword) {
    return true;
  }

  return normalizedKey === normalizedKeyword
    || normalizedKey.includes(normalizedKeyword)
    || normalizedKeyword.includes(normalizedKey);
}

function windowMatchesKeywordContext(window: ReporterPriceWindow, context: KeywordContext) {
  const keyMatchesKeyword = partWindowMatchesKeyword(window.component_key, context.stripped_keyword || context.raw_keyword);
  const typeMatchesKeyword = context.target_types.size > 0 && context.target_types.has(window.component_type);

  if (window.listing_scope === "part") {
    if (context.synthetic_scan) {
      if (context.build_like && !typeMatchesKeyword && !keyMatchesKeyword) {
        return false;
      }
      if (context.target_types.size === 0) {
        return keyMatchesKeyword;
      }
      return typeMatchesKeyword || keyMatchesKeyword;
    }

    if (context.target_types.size === 0) {
      return true;
    }

    return typeMatchesKeyword || keyMatchesKeyword || window.component_type !== "unknown";
  }

  if (window.listing_scope === "full_pc" || window.listing_scope === "semi_pc") {
    if (context.build_like) {
      return true;
    }
    return context.target_types.size === 0 && keyMatchesKeyword;
  }

  return keyMatchesKeyword || typeMatchesKeyword;
}

function scoreObservedWindowSelection(
  window: ReporterPriceWindow,
  context: KeywordContext,
  recencyRank: number
) {
  const keyMatchesKeyword = partWindowMatchesKeyword(window.component_key, context.stripped_keyword || context.raw_keyword);
  const typeMatchesKeyword = context.target_types.has(window.component_type);
  const buildScope = window.listing_scope === "full_pc" || window.listing_scope === "semi_pc";
  const partScope = window.listing_scope === "part";

  return (typeMatchesKeyword ? 100_000_000 : 0)
    + (keyMatchesKeyword ? 10_000_000 : 0)
    + (context.synthetic_scan && partScope ? 1_000_000 : 0)
    + (context.build_like && buildScope ? 500_000 : 0)
    + (!context.build_like && partScope ? 250_000 : 0)
    + (recencyRank * 1_000)
    + scoreWindowVariant(window);
}

function collectObservedWindowsFromPayloads(payloads: KeywordPayloadSelection[]) {
  const preferred = new Map<string, { window: ReporterPriceWindow; score: number }>();

  for (const [index, payloadSelection] of payloads.entries()) {
    const context = inferKeywordContext(payloadSelection.keyword);
    const recencyRank = payloads.length - index;
    const rawWindows = Array.isArray(payloadSelection.payload.market_snapshot?.windows)
      ? payloadSelection.payload.market_snapshot.windows
      : [];

    for (const rawWindow of rawWindows) {
      if (!rawWindow || typeof rawWindow !== "object") {
        continue;
      }
      const window = normalizeWindow(rawWindow);
      if (!window || !windowMatchesKeywordContext(window, context)) {
        continue;
      }

      const key = `${window.listing_scope}:${window.component_key}:${window.window_days}`;
      const score = scoreObservedWindowSelection(window, context, recencyRank);
      const existing = preferred.get(key);
      if (!existing || score > existing.score) {
        preferred.set(key, { window, score });
      }
    }
  }

  return [...preferred.values()].map((entry) => entry.window);
}

function pickPreferredComponent(current: ReporterCandidateComponent, candidate: ReporterCandidateComponent) {
  const currentToken = normalizeComponentToken(current.canonical_name);
  const candidateToken = normalizeComponentToken(candidate.canonical_name);

  if (candidate.evidence_level === "confirmed" && current.evidence_level !== "confirmed") {
    return candidate;
  }

  if (candidate.evidence_level !== "confirmed" && current.evidence_level === "confirmed") {
    return current;
  }

  if (candidate.confidence !== current.confidence) {
    return candidate.confidence > current.confidence ? candidate : current;
  }

  if (candidateToken.length !== currentToken.length) {
    return candidateToken.length > currentToken.length ? candidate : current;
  }

  return candidate;
}

function componentsConflict(left: ReporterCandidateComponent, right: ReporterCandidateComponent) {
  if (left.component_type !== right.component_type) {
    return false;
  }

  const leftToken = normalizeComponentToken(left.canonical_name);
  const rightToken = normalizeComponentToken(right.canonical_name);
  if (!leftToken || !rightToken) {
    return false;
  }

  return leftToken === rightToken
    || leftToken.startsWith(rightToken)
    || rightToken.startsWith(leftToken);
}

function dedupeComponents(components: ReporterCandidateComponent[]) {
  const deduped = new Map<string, ReporterCandidateComponent>();

  for (const component of components) {
    const key = `${component.component_type}:${component.canonical_name}`;
    const existing = deduped.get(key);
    if (!existing || component.confidence > existing.confidence) {
      deduped.set(key, component);
    }
  }

  const resolved: ReporterCandidateComponent[] = [];

  for (const component of deduped.values()) {
    const conflictIndex = resolved.findIndex((existing) => componentsConflict(existing, component));
    if (conflictIndex < 0) {
      resolved.push(component);
      continue;
    }

    resolved[conflictIndex] = pickPreferredComponent(resolved[conflictIndex], component);
  }

  return resolved;
}

function normalizeWindow(raw: Record<string, unknown>): ReporterPriceWindow | null {
  const componentKey = toStringValue(raw.component_key);
  if (!componentKey) return null;

  const listingScope = raw.listing_scope;
  return {
    component_key: componentKey,
    component_type: toStringValue(raw.component_type, "unknown"),
    listing_scope: listingScope === "full_pc" || listingScope === "semi_pc" || listingScope === "part"
      ? listingScope
      : "unknown",
    window_days: toNumberValue(raw.window_days) ?? 0,
    average_price: toNumberValue(raw.average_price),
    sample_count: toNumberValue(raw.sample_count) ?? 0,
    trade_estimate: toNumberValue(raw.trade_estimate),
    source: "observed"
  };
}

function scoreWindowVariant(window: ReporterPriceWindow) {
  const hasAverage = window.average_price !== null ? 1 : 0;
  const typed = window.component_type !== "unknown" ? 1 : 0;
  const observed = window.source === "observed" ? 1 : 0;
  return (observed * 1_000_000) + (hasAverage * 100_000) + (typed * 10_000) + window.sample_count;
}

function buildWindowLookup(windows: ReporterPriceWindow[]) {
  const lookup = new Map<string, ReporterPriceWindow>();

  for (const window of windows) {
    const key = `${window.listing_scope}:${window.component_key}:${window.window_days}`;
    const existing = lookup.get(key);
    if (!existing || scoreWindowVariant(window) > scoreWindowVariant(existing)) {
      lookup.set(key, window);
    }
  }

  return lookup;
}

function readWindowMetric(
  lookup: Map<string, ReporterPriceWindow>,
  listingScope: ReporterPriceWindow["listing_scope"],
  componentKey: string,
  windowDays: number
) {
  return lookup.get(`${listingScope}:${componentKey}:${windowDays}`) ?? null;
}

function parseHistoryDateKey(dateKey: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return null;
  }

  const parsed = new Date(`${dateKey}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function average(values: number[]) {
  if (values.length === 0) {
    return null;
  }

  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function getConservativePartFeeRate() {
  const parsed = Number(process.env.REPORTER_PART_TRANSACTION_FEE_RATE ?? "0.1");
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0.1;
}

function getConservativePartShippingCost() {
  const parsed = Number(process.env.REPORTER_PART_SHIPPING_COST ?? "5000");
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 5_000;
}

function getConservativePartRepairCost() {
  const parsed = Number(process.env.REPORTER_PART_REPAIR_COST ?? "10000");
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 10_000;
}

function calculateConservativePartProfit(
  price: number | null,
  resaleReference: number | null
) {
  if (price === null || resaleReference === null || resaleReference <= 0) {
    return {
      netProfit: null,
      margin: null
    };
  }

  const fee = Math.round(resaleReference * getConservativePartFeeRate());
  const carryingCosts = fee + getConservativePartShippingCost() + getConservativePartRepairCost();
  const netProfit = resaleReference - price - carryingCosts;

  return {
    netProfit,
    margin: resaleReference > 0 ? Number((netProfit / resaleReference).toFixed(4)) : null
  };
}

function getObservedVsManualBounds(window: ReporterPriceWindow) {
  const sampleCount = window.sample_count;
  const componentType = window.component_type;

  if (
    window.listing_scope === "part"
    && componentType === "ssd"
    && /^SSD (?:256GB|500GB|1TB|2TB)$/i.test(window.component_key)
  ) {
    return {
      maxRatio: sampleCount <= 1 ? 1.12 : sampleCount <= 2 ? 1.18 : 1.25,
      minRatio: sampleCount <= 1 ? 0.7 : sampleCount <= 2 ? 0.65 : 0.6
    };
  }

  if (componentType === "ram") {
    return {
      maxRatio: sampleCount <= 1 ? 1.2 : sampleCount <= 2 ? 1.3 : 1.45,
      minRatio: sampleCount <= 1 ? 0.8 : sampleCount <= 2 ? 0.75 : 0.7
    };
  }

  if (componentType === "cpu" || componentType === "gpu") {
    return {
      maxRatio: sampleCount <= 1 ? 1.25 : sampleCount <= 2 ? 1.3 : 1.35,
      minRatio: sampleCount <= 1 ? 0.65 : sampleCount <= 2 ? 0.6 : 0.55
    };
  }

  return {
    maxRatio: sampleCount <= 1 ? 1.35 : sampleCount <= 2 ? 1.6 : 2,
    minRatio: sampleCount <= 1 ? 0.65 : sampleCount <= 2 ? 0.6 : 0.5
  };
}

function getRepresentativePartMinimumObservedSamples(window: ReporterPriceWindow) {
  if (window.listing_scope !== "part") {
    return 1;
  }

  if (
    window.component_type === "cpu"
    || window.component_type === "gpu"
    || window.component_type === "ram"
    || window.component_type === "ssd"
  ) {
    return 3;
  }

  return 2;
}

function buildRecentObservedConsensusLookup(historyPoints: ReporterHistoryPoint[]) {
  const observedPartPoints = historyPoints.filter((point) =>
    point.listing_scope === "part"
    && point.source === "observed"
    && point.average_price !== null
    && point.average_price > 0
  );
  const latestObservedDate = observedPartPoints
    .map((point) => parseHistoryDateKey(point.date_key))
    .filter((value): value is Date => value !== null)
    .sort((left, right) => right.getTime() - left.getTime())[0] ?? null;

  if (!latestObservedDate) {
    return new Map<string, ReporterPriceWindow>();
  }

  const recentThresholdMs = latestObservedDate.getTime() - (6 * 24 * 60 * 60 * 1000);
  const grouped = new Map<string, ReporterHistoryPoint[]>();

  for (const point of observedPartPoints) {
    const parsedDate = parseHistoryDateKey(point.date_key);
    if (!parsedDate || parsedDate.getTime() < recentThresholdMs) {
      continue;
    }

    const key = `${point.listing_scope}:${point.component_key}:${point.window_days}`;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push(point);
  }

  const lookup = new Map<string, ReporterPriceWindow>();
  for (const [key, points] of grouped.entries()) {
    const distinctDateCount = new Set(points.map((point) => point.date_key)).size;
    if (distinctDateCount < 3) {
      continue;
    }

    const prices = points
      .map((point) => point.average_price)
      .filter((value): value is number => value !== null && value > 0)
      .sort((left, right) => left - right);
    if (prices.length < 3) {
      continue;
    }

    const minPrice = prices[0] ?? 0;
    const maxPrice = prices[prices.length - 1] ?? 0;
    if (minPrice <= 0 || maxPrice / minPrice > 1.35) {
      continue;
    }

    const midpointIndex = Math.floor(prices.length / 2);
    const consensusAverage = prices.length % 2 === 1
      ? prices[midpointIndex] ?? null
      : average([prices[midpointIndex - 1] ?? prices[0] ?? 0, prices[midpointIndex] ?? prices[prices.length - 1] ?? 0]);
    const samplePoint = points[0];
    if (consensusAverage === null || !samplePoint) {
      continue;
    }

    lookup.set(key, {
      component_key: samplePoint.component_key,
      component_type: samplePoint.component_type,
      listing_scope: samplePoint.listing_scope,
      window_days: samplePoint.window_days,
      average_price: consensusAverage,
      sample_count: distinctDateCount,
      trade_estimate: Math.round(consensusAverage * 0.95),
      source: "observed"
    });
  }

  return lookup;
}

function chooseStablePartWindow(
  observedWindow: ReporterPriceWindow | null,
  manualWindow: ReporterPriceWindow | null
) {
  if (!observedWindow) return manualWindow;
  if (!manualWindow) return observedWindow;

  const observedAverage = observedWindow.average_price;
  const manualAverage = manualWindow.average_price;
  if (
    observedAverage === null
    || observedAverage <= 0
    || observedWindow.sample_count <= 0
  ) {
    return manualWindow;
  }
  if (
    manualAverage === null
    || manualAverage <= 0
  ) {
    return observedWindow;
  }

  if (observedWindow.sample_count < getRepresentativePartMinimumObservedSamples(observedWindow)) {
    return manualWindow;
  }

  const ratio = observedAverage / manualAverage;
  const { maxRatio, minRatio } = getObservedVsManualBounds(observedWindow);

  if (ratio > maxRatio || ratio < minRatio) {
    return manualWindow;
  }

  return observedWindow;
}

function resolveStablePartWindow(
  observedWindow: ReporterPriceWindow | null,
  manualWindow: ReporterPriceWindow | null,
  recentObservedWindow: ReporterPriceWindow | null
) {
  const stableWindow = chooseStablePartWindow(observedWindow, manualWindow);
  if (!observedWindow || !recentObservedWindow) {
    return stableWindow;
  }

  const observedAverage = observedWindow.average_price;
  const recentAverage = recentObservedWindow.average_price;
  if (
    observedAverage === null
    || observedAverage <= 0
    || recentAverage === null
    || recentAverage <= 0
    || recentObservedWindow.sample_count < 3
  ) {
    return stableWindow;
  }

  const ratio = Math.max(observedAverage, recentAverage) / Math.min(observedAverage, recentAverage);
  if (ratio > 1.15) {
    return stableWindow;
  }

  if (stableWindow?.source === "manual_seed") {
    const manualAverage = manualWindow?.average_price;
    if (manualAverage === null || manualAverage === undefined || manualAverage <= 0) {
      return recentObservedWindow;
    }

    if (recentAverage <= manualAverage) {
      return recentObservedWindow;
    }

    const { maxRatio } = getObservedVsManualBounds(recentObservedWindow);
    if ((recentAverage / manualAverage) <= maxRatio) {
      return recentObservedWindow;
    }
  }

  return stableWindow;
}

function readStablePartWindow(
  observedLookup: Map<string, ReporterPriceWindow>,
  manualLookup: Map<string, ReporterPriceWindow>,
  recentObservedLookup: Map<string, ReporterPriceWindow>,
  componentKey: string,
  windowDays: number
) {
  return resolveStablePartWindow(
    readWindowMetric(observedLookup, "part", componentKey, windowDays),
    readWindowMetric(manualLookup, "part", componentKey, windowDays),
    readWindowMetric(recentObservedLookup, "part", componentKey, windowDays)
  );
}

function mergeWindows(
  observedWindows: ReporterPriceWindow[],
  fallbackWindows: ReporterPriceWindow[],
  recentObservedLookup: Map<string, ReporterPriceWindow>
) {
  const lookup = buildWindowLookup(observedWindows);
  for (const window of fallbackWindows) {
    const key = `${window.listing_scope}:${window.component_key}:${window.window_days}`;
    const existing = lookup.get(key);
    if (!existing) {
      lookup.set(key, window);
      continue;
    }

    if (
      window.listing_scope === "part"
      && existing.listing_scope === "part"
      && existing.source !== window.source
    ) {
      const observedWindow = existing.source === "observed" ? existing : window;
      const manualWindow = existing.source === "manual_seed" ? existing : window;
      const stableWindow = resolveStablePartWindow(
        observedWindow,
        manualWindow,
        readWindowMetric(recentObservedLookup, "part", observedWindow.component_key, observedWindow.window_days)
      );
      if (stableWindow) {
        lookup.set(key, stableWindow);
      }
    }
  }
  return [...lookup.values()];
}

function stabilizeObservedWindows(
  windows: ReporterPriceWindow[],
  manualLookup: Map<string, ReporterPriceWindow>,
  recentObservedLookup: Map<string, ReporterPriceWindow>
) {
  return windows.map((window) => {
    if (window.listing_scope !== "part" || window.source !== "observed") {
      return window;
    }

    return resolveStablePartWindow(
      window,
      readWindowMetric(manualLookup, "part", window.component_key, window.window_days),
      readWindowMetric(recentObservedLookup, "part", window.component_key, window.window_days)
    ) ?? window;
  });
}

function pickReferenceSource(sources: Array<ReporterPriceWindow["source"] | null | undefined>): ReporterReferenceSource {
  const nonEmpty = sources.filter((source): source is ReporterPriceWindow["source"] => Boolean(source));
  if (nonEmpty.length === 0) return "missing";
  if (nonEmpty.every((source) => source === "observed")) return "observed";
  if (nonEmpty.every((source) => source === "manual_seed")) return "manual_seed";
  return "mixed";
}

function selectMarketReference(
  lookup: Map<string, ReporterPriceWindow>,
  listingType: ReporterCandidate["listing_type"],
  primaryComponent: string,
  bundleKey: string | null
): MarketReferenceSelection {
  const candidates: Array<{ scope: ReporterPriceWindow["listing_scope"]; key: string }> = [];

  if (bundleKey && (listingType === "full_pc" || listingType === "semi_pc")) {
    candidates.push({ scope: listingType, key: bundleKey });
    if (listingType === "semi_pc") {
      candidates.push({ scope: "full_pc", key: bundleKey });
    }
  }

  candidates.push({ scope: listingType, key: primaryComponent });

  for (const candidate of candidates) {
    const window30d = readWindowMetric(lookup, candidate.scope, candidate.key, 30);
    if (!window30d) continue;

    return {
      reference_key: candidate.key,
      window7d: readWindowMetric(lookup, candidate.scope, candidate.key, 7),
      window30d,
      window90d: readWindowMetric(lookup, candidate.scope, candidate.key, 90)
    };
  }

  return {
    reference_key: bundleKey ?? primaryComponent,
    window7d: readWindowMetric(lookup, listingType, primaryComponent, 7),
    window30d: readWindowMetric(lookup, listingType, primaryComponent, 30),
    window90d: readWindowMetric(lookup, listingType, primaryComponent, 90)
  };
}

function buildComponentValuation(
  lookup: Map<string, ReporterPriceWindow>,
  manualLookup: Map<string, ReporterPriceWindow>,
  recentObservedLookup: Map<string, ReporterPriceWindow>,
  components: ReporterCandidateComponent[]
): BuildComponentValuation {
  const dedupedComponents = dedupeComponents(components);
  if (dedupedComponents.length === 0) {
    return {
      price_7d: null,
      price_30d: null,
      price_90d: null,
      trade_estimate_30d: null,
      source_30d: "missing",
      priced_count: 0,
      total_count: 0,
      coverage_ratio: 0,
      reference_key: "",
      breakdown: []
    };
  }

  let price7d = 0;
  let price30d = 0;
  let price90d = 0;
  let trade30d = 0;
  let has7d = false;
  let has30d = false;
  let has90d = false;
  let hasTrade30d = false;
  let pricedCount = 0;
  const breakdown: ReporterBuildComponentPrice[] = [];
  const source30dParts: Array<ReporterPriceWindow["source"] | null> = [];

  for (const component of dedupedComponents) {
    const window7d = readStablePartWindow(lookup, manualLookup, recentObservedLookup, component.canonical_name, 7);
    const window30d = readStablePartWindow(lookup, manualLookup, recentObservedLookup, component.canonical_name, 30);
    const window90d = readStablePartWindow(lookup, manualLookup, recentObservedLookup, component.canonical_name, 90);

    breakdown.push({
      component_type: component.component_type,
      canonical_name: component.canonical_name,
      price_30d: window30d?.average_price ?? null,
      trade_estimate_30d: window30d?.trade_estimate ?? null,
      source_30d: pickReferenceSource([window30d?.source])
    });

    source30dParts.push(window30d?.source ?? null);

    if (window7d?.average_price !== null && window7d?.average_price !== undefined) {
      price7d += window7d.average_price;
      has7d = true;
    }

    if (window30d?.average_price !== null && window30d?.average_price !== undefined) {
      price30d += window30d.average_price;
      pricedCount += 1;
      has30d = true;
    }

    if (window90d?.average_price !== null && window90d?.average_price !== undefined) {
      price90d += window90d.average_price;
      has90d = true;
    }

    if (window30d?.trade_estimate !== null && window30d?.trade_estimate !== undefined) {
      trade30d += window30d.trade_estimate;
      hasTrade30d = true;
    }
  }

  return {
    price_7d: has7d ? price7d : null,
    price_30d: has30d ? price30d : null,
    price_90d: has90d ? price90d : null,
    trade_estimate_30d: hasTrade30d ? trade30d : null,
    source_30d: pickReferenceSource(source30dParts),
    priced_count: pricedCount,
    total_count: dedupedComponents.length,
    coverage_ratio: dedupedComponents.length > 0 ? Number((pricedCount / dedupedComponents.length).toFixed(2)) : 0,
    reference_key: dedupedComponents.map((component) => component.canonical_name).join(" + "),
    breakdown
  };
}

function shouldUseComponentPricing(
  listingType: ReporterCandidate["listing_type"],
  valuation: BuildComponentValuation,
  confirmedComponentCount: number,
  unknownComponentTypes: string[]
) {
  if (listingType === "part") return false;
  if (valuation.price_30d === null || valuation.priced_count < 2) return false;
  const pricedTypes = new Set(
    valuation.breakdown
      .filter((entry) => entry.price_30d !== null)
      .map((entry) => entry.component_type)
  );

  if (listingType === "full_pc" && pricedTypes.has("cpu") && pricedTypes.has("gpu")) return true;
  if (listingType === "full_pc" && valuation.priced_count >= 3) return true;
  if (listingType === "semi_pc" && valuation.priced_count >= 2) return true;
  if (confirmedComponentCount >= 3) return true;
  if (unknownComponentTypes.length <= 2 && valuation.coverage_ratio >= 0.5) return true;
  return false;
}

function clampScore(value: number) {
  return Math.max(1, Math.min(100, Math.round(value)));
}

function extractSourceSite(raw: Record<string, unknown>) {
  const directSite = toStringValue(raw.site);
  if (directSite) {
    return directSite;
  }

  const rawNotes = toStringValue(raw.raw_notes);
  const match = rawNotes.match(/\bsite=([a-z0-9_-]+)/i);
  return match?.[1] ?? "unknown";
}

function toCandidate(
  raw: Record<string, unknown>,
  keyword: string,
  windowLookup: Map<string, ReporterPriceWindow>,
  manualLookup: Map<string, ReporterPriceWindow>,
  recentObservedLookup: Map<string, ReporterPriceWindow>,
  historyBundle: Awaited<ReturnType<typeof readMarketHistoryBundle>>
): ReporterCandidate {
  const site = extractSourceSite(raw);
  const title = toStringValue(raw.title);
  const seller = toStringValue(raw.seller_name ?? raw.seller, "unknown") || "unknown";
  const url = toStringValue(raw.url);
  const price = toNumberValue(raw.price_value ?? raw.price);
  const components = dedupeComponents(normalizeComponents(raw.components));
  const rawListingType = toListingType(raw.listing_type);
  const reviewFlags: string[] = [];
  const interestingUnknown = isUnknownButInterestingRaw(raw, components);
  const reviewableBundle = isReviewableBundledPartRaw(raw, components);
  if (interestingUnknown) {
    reviewFlags.push("unknown_but_interesting");
  }
  if (reviewableBundle) {
    reviewFlags.push("bundle_review");
  }
  const listingType = rawListingType !== "part" && hasPortablePcHint(`${title} ${toStringValue(raw.detail_excerpt)}`)
    ? "unknown"
    : interestingUnknown
      ? "full_pc"
      : reviewableBundle
        ? "semi_pc"
        : rawListingType;
  const primaryComponent = pickPrimaryComponent(components, keyword);
  const bundleKey = buildBundleKey(components);
  const marketReference = selectMarketReference(windowLookup, listingType, primaryComponent.name, bundleKey);
  const detailFetchStatus = raw.detail_fetch_status === "success"
    || raw.detail_fetch_status === "unavailable"
    || raw.detail_fetch_status === "failed"
    ? raw.detail_fetch_status
    : "not_needed";
  const reviewNote = reviewFlags.length > 0 ? reviewFlags.join(", ") : "";
  const componentResolution = raw.component_resolution === "detail_enriched" ? "detail_enriched" : "search_only";
  const confirmedComponentCount = toNumberValue(raw.confirmed_component_count) ?? 0;
  const unknownComponentTypes = toStringArray(raw.unknown_component_types);
  const componentValuation = listingType === "part"
    ? {
        price_7d: null,
        price_30d: null,
        price_90d: null,
        trade_estimate_30d: null,
        source_30d: "missing" as const,
        priced_count: 0,
        total_count: 0,
        coverage_ratio: 0,
        reference_key: "",
        breakdown: [] as ReporterBuildComponentPrice[]
      }
    : buildComponentValuation(windowLookup, manualLookup, recentObservedLookup, components);
  const useComponentPricing = shouldUseComponentPricing(
    listingType,
    componentValuation,
    confirmedComponentCount,
    unknownComponentTypes
  );
  const partReference7d = readStablePartWindow(windowLookup, manualLookup, recentObservedLookup, primaryComponent.name, 7);
  const partReference30d = readStablePartWindow(windowLookup, manualLookup, recentObservedLookup, primaryComponent.name, 30);
  const partReference90d = readStablePartWindow(windowLookup, manualLookup, recentObservedLookup, primaryComponent.name, 90);
  if (listingType === "part") {
    marketReference.window7d = partReference7d;
    marketReference.window30d = partReference30d;
    marketReference.window90d = partReference90d;
  }
  const itemIdSource = url || `${site}|${seller}|${title}|${price ?? "na"}`;
  const itemId = stableItemId(itemIdSource);
  const occurrence = historyBundle.occurrences.get(itemId);
  const hasLowerBoundFallback = listingType !== "part" && !useComponentPricing && componentValuation.price_30d !== null;
  const marketPrice7d = useComponentPricing
    ? componentValuation.price_7d
    : marketReference.window7d?.average_price ?? componentValuation.price_7d ?? null;
  const marketAverage30d = useComponentPricing
    ? componentValuation.price_30d
    : marketReference.window30d?.average_price ?? componentValuation.price_30d ?? null;
  const marketPrice90d = useComponentPricing
    ? componentValuation.price_90d
    : marketReference.window90d?.average_price ?? componentValuation.price_90d ?? null;
  const marketTradeEstimate30d = useComponentPricing
    ? componentValuation.trade_estimate_30d
    : marketReference.window30d?.trade_estimate ?? componentValuation.trade_estimate_30d ?? null;
  const marketReferenceKey = useComponentPricing || hasLowerBoundFallback
    ? componentValuation.reference_key || marketReference.reference_key
    : marketReference.reference_key;
  const marketReferenceSource30d = useComponentPricing
    ? componentValuation.source_30d
    : marketReference.window30d?.source ?? (hasLowerBoundFallback ? componentValuation.source_30d : "missing");
  const valuationMode: ReporterCandidate["valuation_mode"] = listingType === "part"
    ? "part_market"
    : useComponentPricing
      ? "build_components"
      : marketReference.window30d
        ? "build_bundle"
        : "missing";
  const priceGapToMarket30d = price !== null && marketAverage30d !== null
    ? marketAverage30d - price
    : null;
  const priceGapToMarket30dPct = priceGapToMarket30d !== null
    && marketAverage30d
    ? priceGapToMarket30d / marketAverage30d
    : null;
  const rawScore = toNumberValue(raw.score_hint);
  const confidencePenalty = toNumberValue(raw.confidence_penalty) ?? 0;
  const adjustedScore = listingType === "part"
    ? rawScore
    : valuationMode === "build_components"
      ? clampScore(
          60
          + ((priceGapToMarket30dPct ?? 0) * 100)
          + confirmedComponentCount * 4
          - unknownComponentTypes.length * 5
          - confidencePenalty * 20
          - (detailFetchStatus === "success" ? 0 : 8)
        )
      : clampScore(Math.min(rawScore ?? 55, unknownComponentTypes.length >= 4 ? 65 : 72));
  const adjustedScoreReason = listingType === "part"
    ? toStringValue(raw.score_reason)
    : valuationMode === "build_components"
      ? `component lower bound ${componentValuation.priced_count}/${componentValuation.total_count} parts (${marketReferenceSource30d})`
      : `bundle fallback with ${componentValuation.priced_count}/${componentValuation.total_count} priced parts`;
  const rawNetProfit = toNumberValue(raw.net_profit);
  const rawProfitMargin = toNumberValue(raw.profit_margin);
  const conservativePartReference = marketTradeEstimate30d
    ?? partReference30d?.trade_estimate
    ?? marketAverage30d
    ?? partReference30d?.average_price
    ?? toNumberValue(raw.baseline_price);
  const conservativePartProfit = calculateConservativePartProfit(price, conservativePartReference);
  const adjustedNetProfit = listingType === "part"
    ? conservativePartProfit.netProfit ?? rawNetProfit
    : price !== null && marketAverage30d !== null
      ? marketAverage30d - price
      : rawNetProfit;
  const adjustedProfitMargin = listingType === "part"
    ? conservativePartProfit.margin ?? rawProfitMargin
    : adjustedNetProfit !== null && marketAverage30d
      ? Number((adjustedNetProfit / marketAverage30d).toFixed(4))
      : rawProfitMargin;
  const adjustedDecomposeRecommendation = listingType === "full_pc"
    && componentValuation.price_30d !== null
    && price !== null
    ? (componentValuation.price_30d - 20_000 > price ? "decompose" : "keep")
    : raw.decompose_recommendation === "decompose" || raw.decompose_recommendation === "keep"
      ? raw.decompose_recommendation
      : null;

  return {
    item_id: itemId,
    site,
    title,
    seller,
    price,
    url,
    listing_type: listingType,
    posted_at: toStringValue(raw.posted_at),
    components,
    detail_enriched: raw.detail_enriched === true,
    detail_fetch_status: detailFetchStatus,
    detail_fetch_note: [toStringValue(raw.detail_fetch_note), reviewNote].filter((value) => value.length > 0).join(" | "),
    detail_excerpt: toStringValue(raw.detail_excerpt),
    component_resolution: componentResolution,
    confirmed_component_count: confirmedComponentCount,
    unknown_component_types: unknownComponentTypes,
    primary_component: primaryComponent.name,
    primary_component_type: primaryComponent.type,
    bundle_key: bundleKey,
    baseline_price: marketAverage30d ?? toNumberValue(raw.baseline_price),
    deviation_rate: priceGapToMarket30dPct ?? toNumberValue(raw.deviation_rate),
    score_hint: adjustedScore,
    score_reason: adjustedScoreReason,
    fraud_risk_score: toNumberValue(raw.fraud_risk_score) ?? 0,
    fraud_flags: toStringArray(raw.fraud_flags),
    net_profit: adjustedNetProfit,
    profit_margin: adjustedProfitMargin,
    estimated_days_to_sell: toNumberValue(raw.estimated_days_to_sell) ?? 0,
    demand_strength: toDemandStrength(raw.demand_strength),
    market_price_7d: marketPrice7d,
    market_price_30d: marketAverage30d,
    market_price_90d: marketPrice90d,
    market_sample_30d: useComponentPricing
      ? componentValuation.priced_count
      : marketReference.window30d?.sample_count ?? (hasLowerBoundFallback ? componentValuation.priced_count : 0),
    market_trade_estimate_30d: marketTradeEstimate30d,
    market_reference_key: marketReferenceKey,
    market_reference_source_30d: marketReferenceSource30d,
    part_reference_price_7d: partReference7d?.average_price ?? null,
    part_reference_price_30d: partReference30d?.average_price ?? null,
    part_reference_price_90d: partReference90d?.average_price ?? null,
    part_reference_sample_30d: partReference30d?.sample_count ?? 0,
    part_reference_trade_estimate_30d: partReference30d?.trade_estimate ?? null,
    part_reference_source_30d: partReference30d?.source ?? "missing",
    valuation_mode: valuationMode,
    component_sum_price_7d: componentValuation.price_7d,
    component_sum_price_30d: componentValuation.price_30d,
    component_sum_price_90d: componentValuation.price_90d,
    component_sum_trade_estimate_30d: componentValuation.trade_estimate_30d,
    component_sum_source_30d: componentValuation.source_30d,
    component_priced_count: componentValuation.priced_count,
    component_total_count: componentValuation.total_count,
    component_coverage_ratio: componentValuation.coverage_ratio,
    component_price_breakdown: componentValuation.breakdown,
    price_gap_to_market_30d: priceGapToMarket30d,
    price_gap_to_market_30d_pct: priceGapToMarket30dPct,
    observed_run_count: occurrence?.run_count ?? 0,
    observed_day_count: occurrence?.observed_day_count ?? 0,
    first_seen_at: occurrence?.first_seen_at ?? "",
    last_seen_at: occurrence?.last_seen_at ?? "",
    decompose_recommendation: adjustedDecomposeRecommendation,
    bottleneck_issues: toStringArray(raw.bottleneck_issues),
    review_flags: reviewFlags,
    model_status: toStringValue(raw.model_status, "normal"),
    confidence_penalty: confidencePenalty
  };
}

function shouldKeepReporterCandidate(candidate: ReporterCandidate, keyword: string) {
  if (candidate.listing_type === "unknown") {
    return false;
  }

  const keywordLooksSynthetic = keyword.includes("-scan");
  const hasSignal = hasCandidateSignal(candidate.components);

  if (candidate.listing_type === "part") {
    if (!hasSignal || candidate.primary_component_type === "unknown") {
      return false;
    }

    if (candidate.bundle_key || hasBuildSaleContext(candidate.title)) {
      return false;
    }

    if (
      keywordLooksSynthetic
      && (candidate.primary_component === keyword || candidate.market_reference_key === keyword)
    ) {
      return false;
    }

    return true;
  }

  if (!hasSignal && candidate.confirmed_component_count <= 0) {
    return false;
  }

  if (
    keywordLooksSynthetic
    && candidate.primary_component_type === "unknown"
    && candidate.market_reference_key === keyword
  ) {
    return false;
  }

  return true;
}

function isBuildCandidate(candidate: ReporterCandidate) {
  return candidate.listing_type === "full_pc" || candidate.listing_type === "semi_pc";
}

function isSingleConsumerPartCarryoverCandidate(candidate: ReporterCandidate) {
  if (candidate.listing_type !== "part") {
    return false;
  }

  if (candidate.components.length !== 1) {
    return false;
  }

  if (candidate.observed_day_count > 2) {
    return false;
  }

  return candidate.primary_component_type === "cpu"
    || candidate.primary_component_type === "gpu"
    || candidate.primary_component_type === "ram"
    || candidate.primary_component_type === "ssd"
    || candidate.primary_component_type === "motherboard"
    || candidate.primary_component_type === "psu";
}

function shouldRevalidateCarryoverCandidate(candidate: ReporterCandidate) {
  if (!isBuildCandidate(candidate) && !isSingleConsumerPartCarryoverCandidate(candidate)) {
    return false;
  }

  if (classifyCandidate(candidate) === "PASS") {
    return false;
  }

  if ((candidate.price_gap_to_market_30d ?? 0) <= 0) {
    return false;
  }

  return candidate.url.trim().length > 0;
}

function withCarryoverNote(candidate: ReporterCandidate) {
  const note = candidate.detail_fetch_note.trim();
  const suffix = "revalidated carry-over";
  if (note.includes(suffix)) {
    return candidate;
  }

  return {
    ...candidate,
    detail_fetch_note: note ? `${note} | ${suffix}` : suffix
  };
}

function carryoverRecencyTimestamp(candidate: ReporterCandidate) {
  const lastSeen = Date.parse(candidate.last_seen_at ?? "");
  if (Number.isFinite(lastSeen)) {
    return lastSeen;
  }

  const firstSeen = Date.parse(candidate.first_seen_at ?? "");
  if (Number.isFinite(firstSeen)) {
    return firstSeen;
  }

  const postedAt = Date.parse(candidate.posted_at ?? "");
  if (Number.isFinite(postedAt)) {
    return postedAt;
  }

  return 0;
}

function sortCarryoverCandidates(candidates: ReporterCandidate[]) {
  return [...candidates].sort((left, right) => {
    const leftDecisionRank = decisionRank(classifyCandidate(left));
    const rightDecisionRank = decisionRank(classifyCandidate(right));
    if (leftDecisionRank !== rightDecisionRank) {
      return leftDecisionRank - rightDecisionRank;
    }

    const rightGap = right.price_gap_to_market_30d ?? Number.NEGATIVE_INFINITY;
    const leftGap = left.price_gap_to_market_30d ?? Number.NEGATIVE_INFINITY;
    if (rightGap !== leftGap) {
      return rightGap - leftGap;
    }

    const rightObservedDays = right.observed_day_count ?? 0;
    const leftObservedDays = left.observed_day_count ?? 0;
    if (rightObservedDays !== leftObservedDays) {
      return rightObservedDays - leftObservedDays;
    }

    const rightScore = right.score_hint ?? 0;
    const leftScore = left.score_hint ?? 0;
    if (rightScore !== leftScore) {
      return rightScore - leftScore;
    }

    return carryoverRecencyTimestamp(right) - carryoverRecencyTimestamp(left);
  });
}

async function revalidateCandidateUrl(url: string) {
  const session = createBrowserSession();
  if (!session.available) {
    return false;
  }

  try {
    await session.goto(url);
    await session.waitForIdle();
    const bodyText = await session.text("body");
    const bodyHtml = await session.html("body");
    const currentUrl = await session.currentUrl();
    let combined = `${currentUrl}\n${bodyText}\n${bodyHtml}`;
    combined = combined.replace(/([0-9])404([0-9])/g, "$1$2");
    const hasKoreanClosedSignals = /(?:\uD310\uB9E4\s*\uC644\uB8CC|\uAC70\uB798\s*\uC644\uB8CC|\uC608\uC57D\s*\uC911|\uC608\uC57D\uC911|\uC874\uC7AC\uD558\uC9C0\s*\uC54A\uB294|\uCC3E\uC744\s*\uC218\s*\uC5C6\uB294|\uBE44\uACF5\uAC1C|\uC885\uB8CC\s*\uC0C1\uD488)/i.test(combined);
    const hasActiveDetailSignals = /\uC2DC\uC138\uC870\uD68C/i.test(combined)
      && /\uC0C1\uD488\s*\uC0C1\uD0DC/i.test(combined)
      && /\uC0C1\uD488\s*\uC815\uBCF4/i.test(combined);
    if (hasActiveDetailSignals && !hasKoreanClosedSignals) {
      return true;
    }

    if (/(?:판매완료|거래완료|예약중|삭제된\s*상품|존재하지\s*않|찾을\s*수\s*없|비공개|숨김|종료된\s*상품|sold\s*out|reserved|not\s*found|404)/i.test(combined)) {
      return false;
    }

    return true;
  } catch {
    return false;
  } finally {
    await session.close();
  }
}

async function readCarryoverCandidates(
  marketBaseDir: string,
  currentRunIds: Set<string>,
  currentCandidates: ReporterCandidate[],
  windowLookup: Map<string, ReporterPriceWindow>,
  manualLookup: Map<string, ReporterPriceWindow>,
  recentObservedLookup: Map<string, ReporterPriceWindow>,
  historyBundle: Awaited<ReturnType<typeof readMarketHistoryBundle>>
) {
  const currentUrls = new Set(currentCandidates.map((candidate) => candidate.url));
  const runDirs = await safeList(marketBaseDir);
  const carryoverPool = new Map<string, ReporterCandidate>();
  const maxRunCount = 600;
  const maxCarryovers = 20;
  const maxCarryoverPoolSize = 250;

  let scannedRuns = 0;
  for (const runId of runDirs) {
    if (currentRunIds.has(runId)) {
      continue;
    }
    if (scannedRuns >= maxRunCount || carryoverPool.size >= maxCarryoverPoolSize) {
      break;
    }
    scannedRuns += 1;

    try {
      const outputPath = path.join(marketBaseDir, runId, "output.json");
      const payload = JSON.parse(await readFile(outputPath, "utf-8")) as RawLatestPayload;
      const runKeyword = toStringValue(payload.keyword ?? payload.merged_result?.keyword, "");
      const mergedItems = Array.isArray(payload.merged_result?.merged_items)
        ? payload.merged_result.merged_items
        : Array.isArray(payload.merged_items)
          ? payload.merged_items
          : [];

      for (const rawItem of mergedItems) {
        if (
          rawItem
          && typeof rawItem === "object"
          && shouldSkipNoiseFilteredRawItem(rawItem, dedupeComponents(normalizeComponents(rawItem.components)))
        ) {
          continue;
        }

        const candidate = toCandidate(rawItem, runKeyword, windowLookup, manualLookup, recentObservedLookup, historyBundle);
        if (!shouldKeepReporterCandidate(candidate, runKeyword)) {
          continue;
        }
        if (!shouldRevalidateCarryoverCandidate(candidate)) {
          continue;
        }
        if (currentUrls.has(candidate.url) || carryoverPool.has(candidate.url)) {
          continue;
        }

        carryoverPool.set(candidate.url, candidate);
        if (carryoverPool.size >= maxCarryoverPoolSize) {
          break;
        }
      }
    } catch {
      continue;
    }
  }

  const revalidated: ReporterCandidate[] = [];
  const prioritizedCarryovers = sortCarryoverCandidates([...carryoverPool.values()]).slice(0, maxCarryovers);
  for (const candidate of prioritizedCarryovers) {
    if (candidate.listing_type === "part" && candidate.observed_day_count > 2) {
      continue;
    }
    if (await revalidateCandidateUrl(candidate.url)) {
      revalidated.push(withCarryoverNote(candidate));
    }
  }

  return revalidated;
}

async function safeList(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse();
  } catch {
    return [];
  }
}

async function readLatestPayload(baseDir: string): Promise<{ runId?: string; payload?: RawLatestPayload }> {
  const runDirs = await safeList(baseDir);
  if (runDirs.length === 0) {
    return {};
  }

  for (const runId of runDirs) {
    try {
      const outputPath = path.join(baseDir, runId, "output.json");
      const payload = JSON.parse(await readFile(outputPath, "utf-8")) as RawLatestPayload;
      return {
        runId,
        payload
      };
    } catch {
      continue;
    }
  }

  return {
    runId: runDirs[0]
  };
}

async function readLatestPayloadsByKeyword(
  baseDir: string,
  maxKeywordCount = 24,
  maxRunScan = 160
): Promise<KeywordPayloadSelection[]> {
  const runDirs = await safeList(baseDir);
  const latestByKeyword = new Map<string, KeywordPayloadSelection>();
  let scannedRuns = 0;

  for (const runId of runDirs) {
    if (scannedRuns >= maxRunScan || latestByKeyword.size >= maxKeywordCount) {
      break;
    }
    scannedRuns += 1;

    try {
      const outputPath = path.join(baseDir, runId, "output.json");
      const payload = JSON.parse(await readFile(outputPath, "utf-8")) as RawLatestPayload;
      const keyword = toStringValue(payload.keyword ?? payload.merged_result?.keyword, runId);
      if (!latestByKeyword.has(keyword)) {
        latestByKeyword.set(keyword, { runId, payload, keyword });
      }
    } catch {
      continue;
    }
  }

  return [...latestByKeyword.values()];
}

export async function readLatestMergeCandidates(
  marketBaseDir = path.resolve(process.cwd(), "merge/result/market"),
  mergeBaseDir = path.resolve(process.cwd(), "merge/result/merge")
): Promise<ReporterSourceData> {
  const historyBundle = await readMarketHistoryBundle(marketBaseDir);
  const recentObservedLookup = buildRecentObservedConsensusLookup(historyBundle.history_points);
  const manualLookup = buildWindowLookup(
    buildManualPriceSeedDataset().windows.map((window) => ({
      component_key: window.component_key,
      component_type: window.component_type,
      listing_scope: window.listing_scope,
      window_days: window.window_days,
      average_price: window.average_price,
      sample_count: window.sample_count,
      trade_estimate: window.trade_estimate,
      source: window.source
      }))
  );
  const marketPayloads = await readLatestPayloadsByKeyword(marketBaseDir);
  const market = marketPayloads[0] ?? null;
  const merge = market ? null : await readLatestPayload(mergeBaseDir);
  const payload = market?.payload ?? merge?.payload;
  const sourceRunId = market?.runId ?? merge?.runId ?? historyBundle.latest_run_id;

  if (!payload) {
    return {
      source_run_id: sourceRunId,
      keyword: historyBundle.keyword,
      windows: historyBundle.latest_windows.map((window) => ({
        component_key: window.component_key,
        component_type: window.component_type,
        listing_scope: window.listing_scope,
        window_days: window.window_days,
        average_price: window.average_price,
        sample_count: window.sample_count,
        trade_estimate: window.trade_estimate,
        source: window.source
      })),
      candidates: [],
      history_points: historyBundle.history_points.map((point) => ({
        run_id: point.run_id,
        date_key: point.date_key,
        date_label: point.date_label,
        component_key: point.component_key,
        component_type: point.component_type,
        listing_scope: point.listing_scope,
        window_days: point.window_days,
        average_price: point.average_price,
        sample_count: point.sample_count,
        trade_estimate: point.trade_estimate,
        source: point.source
      }) satisfies ReporterHistoryPoint),
      discovered_keywords: historyBundle.discovered_keywords,
      history_summary: historyBundle.summary
    };
  }

  const keyword = toStringValue(payload.keyword ?? payload.merged_result?.keyword, "");
  const payloadWindows = marketPayloads.length > 0
    ? collectObservedWindowsFromPayloads(marketPayloads)
    : Array.isArray(payload.market_snapshot?.windows)
      ? payload.market_snapshot.windows
          .map((entry) => normalizeWindow(entry))
          .filter((entry): entry is ReporterPriceWindow => entry !== null)
      : [];
  const fallbackWindows = historyBundle.latest_windows.map((window) => ({
    component_key: window.component_key,
    component_type: window.component_type,
    listing_scope: window.listing_scope,
    window_days: window.window_days,
    average_price: window.average_price,
    sample_count: window.sample_count,
    trade_estimate: window.trade_estimate,
    source: window.source
  }));
  const windows = stabilizeObservedWindows(
    mergeWindows(payloadWindows, fallbackWindows, recentObservedLookup),
    manualLookup,
    recentObservedLookup
  );
  const windowLookup = buildWindowLookup(windows);
  const candidatePayloads = marketPayloads.length > 0
    ? marketPayloads
    : payload
      ? [{
          runId: sourceRunId ?? "fallback",
          payload,
          keyword
        }]
      : [];

  const currentCandidatesByUrl = new Map<string, ReporterCandidate>();
  const currentCandidatesFallback = new Map<string, ReporterCandidate>();

  for (const candidatePayload of candidatePayloads) {
    const mergedItems = Array.isArray(candidatePayload.payload.merged_result?.merged_items)
      ? candidatePayload.payload.merged_result.merged_items
      : Array.isArray(candidatePayload.payload.merged_items)
        ? candidatePayload.payload.merged_items
        : [];

    for (const item of mergedItems) {
      if (
        item
        && typeof item === "object"
        && shouldSkipNoiseFilteredRawItem(item, dedupeComponents(normalizeComponents(item.components)))
      ) {
        continue;
      }

      const candidate = toCandidate(item, candidatePayload.keyword, windowLookup, manualLookup, recentObservedLookup, historyBundle);
      if (candidate.title.length === 0 || !shouldKeepReporterCandidate(candidate, candidatePayload.keyword)) {
        continue;
      }

      const urlKey = candidate.url.trim();
      if (urlKey) {
        if (!currentCandidatesByUrl.has(urlKey)) {
          currentCandidatesByUrl.set(urlKey, candidate);
        }
        continue;
      }

      if (!currentCandidatesFallback.has(candidate.item_id)) {
        currentCandidatesFallback.set(candidate.item_id, candidate);
      }
    }
  }

  const currentCandidates = [
    ...currentCandidatesByUrl.values(),
    ...currentCandidatesFallback.values()
  ];

  const carryoverCandidates = await readCarryoverCandidates(
    marketBaseDir,
    new Set(candidatePayloads.map((candidatePayload) => candidatePayload.runId)),
    currentCandidates,
    windowLookup,
    manualLookup,
    recentObservedLookup,
    historyBundle
  );

  return {
    source_run_id: sourceRunId,
    keyword,
    windows,
    history_points: historyBundle.history_points.map((point) => ({
      run_id: point.run_id,
      date_key: point.date_key,
      date_label: point.date_label,
      component_key: point.component_key,
      component_type: point.component_type,
      listing_scope: point.listing_scope,
      window_days: point.window_days,
      average_price: point.average_price,
      sample_count: point.sample_count,
      trade_estimate: point.trade_estimate,
      source: point.source
    }) satisfies ReporterHistoryPoint),
    candidates: [...currentCandidates, ...carryoverCandidates],
    discovered_keywords: historyBundle.discovered_keywords,
    history_summary: historyBundle.summary
  };
}
