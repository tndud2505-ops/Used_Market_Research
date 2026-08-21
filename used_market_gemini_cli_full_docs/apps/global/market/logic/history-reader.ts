import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  listDatedRunDirectories,
  selectRunsWithinRecentKstDays,
  type DatedRunDirectory
} from "../../merge/logic/run-retention.js";
import {
  MANUAL_PRICE_SEED_AS_OF,
  buildManualPriceSeedDataset,
  getManualPriceSeedSummary
} from "./manual-price-seed.js";
import { COMPONENT_PATTERNS } from "./componentCatalog.js";

export type MarketListingScope = "full_pc" | "semi_pc" | "part" | "unknown";

export interface MarketHistoryComponent {
  component_type: string;
  canonical_name: string;
  confidence: number;
}

export interface MarketHistoryCandidateSnapshot {
  item_id: string;
  site: string;
  title: string;
  seller: string;
  price: number | null;
  url: string;
  listing_type: MarketListingScope;
  posted_at: string;
  components: MarketHistoryComponent[];
  primary_component: string;
  primary_component_type: string;
}

export interface MarketHistoryWindowPoint {
  run_id: string;
  date_key: string;
  date_label: string;
  component_key: string;
  component_type: string;
  listing_scope: MarketListingScope;
  window_days: number;
  average_price: number | null;
  sample_count: number;
  trade_estimate: number | null;
  source: "observed" | "manual_seed";
}

export interface MarketListingOccurrence {
  item_id: string;
  run_count: number;
  observed_day_count: number;
  first_seen_at: string;
  last_seen_at: string;
  min_price: number | null;
  max_price: number | null;
}

export interface MarketDiscoveredKeyword {
  component_type: string;
  canonical_name: string;
  mention_count: number;
  observed_day_count: number;
  example_titles: string[];
  auto_search_candidate: boolean;
}

export interface MarketHistorySummary {
  lookback_days: number;
  observed_days: number;
  latest_run_id?: string;
  latest_date_key?: string;
  manual_seed_as_of?: string;
  manual_seed_entry_count: number;
}

export interface MarketHistoryBundle {
  keyword?: string;
  latest_run_id?: string;
  latest_candidates: MarketHistoryCandidateSnapshot[];
  latest_windows: MarketHistoryWindowPoint[];
  history_points: MarketHistoryWindowPoint[];
  occurrences: Map<string, MarketListingOccurrence>;
  discovered_keywords: MarketDiscoveredKeyword[];
  summary: MarketHistorySummary;
}

interface RawMarketWorkflowPayload {
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

function stableItemId(source: string): string {
  return createHash("sha256").update(source).digest("hex").slice(0, 16);
}

function toStringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function toNumberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toListingScope(value: unknown): MarketListingScope {
  if (value === "full_pc" || value === "semi_pc" || value === "part") {
    return value;
  }
  return "unknown";
}

function normalizeComponentToken(value: string) {
  return value
    .toLowerCase()
    .replace(/^nvidia\s+/i, "")
    .replace(/^amd\s+radeon\s+/i, "")
    .replace(/^amd\s+/i, "")
    .replace(/^intel\s+core\s+/i, "")
    .replace(/[^a-z0-9]+/g, "");
}

function inferComponentType(componentKey: string) {
  return COMPONENT_PATTERNS.find((entry) => entry.canonical === componentKey)?.componentType ?? "unknown";
}

function inferHistoryWindowComponentType(componentKey: string, componentType: string) {
  if (componentType && componentType !== "unknown") {
    return componentType;
  }

  return inferComponentType(componentKey);
}

function partWindowMatchesKeyword(componentKey: string, keyword: string) {
  const normalizedKey = normalizeComponentToken(componentKey);
  const normalizedKeyword = normalizeComponentToken(keyword);
  if (!normalizedKey || !normalizedKeyword) {
    return true;
  }

  return normalizedKey === normalizedKeyword
    || normalizedKey.includes(normalizedKeyword)
    || normalizedKeyword.includes(normalizedKey);
}

function scoreWindowVariant(point: MarketHistoryWindowPoint) {
  const hasAverage = point.average_price !== null ? 1 : 0;
  const typed = point.component_type !== "unknown" ? 1 : 0;
  return (hasAverage * 1_000_000) + (typed * 100_000) + point.sample_count;
}

function shouldReplaceWindowVariant(
  existing: { point: MarketHistoryWindowPoint; timestamp_ms: number },
  candidate: MarketHistoryWindowPoint,
  candidateTimestampMs: number
) {
  if (candidateTimestampMs === existing.timestamp_ms) {
    return scoreWindowVariant(candidate) > scoreWindowVariant(existing.point);
  }

  if (candidateTimestampMs < existing.timestamp_ms) {
    return false;
  }

  if (existing.point.average_price !== null && candidate.average_price === null) {
    return false;
  }

  if (existing.point.component_type !== "unknown" && candidate.component_type === "unknown") {
    return false;
  }

  return true;
}

function normalizeComponents(value: unknown): MarketHistoryComponent[] {
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
        confidence: toNumberValue(record.confidence) ?? 0.5
      } satisfies MarketHistoryComponent;
    })
    .filter((entry): entry is MarketHistoryComponent => entry !== null);
}

function pickPrimaryComponent(
  components: MarketHistoryComponent[],
  keyword: string
): { name: string; type: string } {
  const priority = ["gpu", "cpu", "ram", "ssd"];
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

function toHistoryCandidate(raw: Record<string, unknown>, keyword: string): MarketHistoryCandidateSnapshot {
  const site = toStringValue(raw.site, "unknown");
  const title = toStringValue(raw.title);
  const seller = toStringValue(raw.seller_name ?? raw.seller, "unknown") || "unknown";
  const url = toStringValue(raw.url);
  const price = toNumberValue(raw.price_value ?? raw.price);
  const listingType = toListingScope(raw.listing_type);
  const components = normalizeComponents(raw.components);
  const primaryComponent = pickPrimaryComponent(components, keyword);
  const itemIdSource = url || `${site}|${seller}|${title}|${price ?? "na"}`;

  return {
    item_id: stableItemId(itemIdSource),
    site,
    title,
    seller,
    price,
    url,
    listing_type: listingType,
    posted_at: toStringValue(raw.posted_at),
    components,
    primary_component: primaryComponent.name,
    primary_component_type: primaryComponent.type
  };
}

function toHistoryWindowPoint(
  raw: Record<string, unknown>,
  run: DatedRunDirectory
): MarketHistoryWindowPoint | null {
  const componentKey = toStringValue(raw.component_key);
  if (!componentKey) return null;
  const componentType = inferHistoryWindowComponentType(
    componentKey,
    toStringValue(raw.component_type, "unknown")
  );

  return {
    run_id: run.name,
    date_key: run.kst_date_key,
    date_label: run.kst_date_key.slice(5),
    component_key: componentKey,
    component_type: componentType,
    listing_scope: toListingScope(raw.listing_scope),
    window_days: toNumberValue(raw.window_days) ?? 0,
    average_price: toNumberValue(raw.average_price),
    sample_count: toNumberValue(raw.sample_count) ?? 0,
    trade_estimate: toNumberValue(raw.trade_estimate),
    source: "observed"
  };
}

function getMergedItems(payload: RawMarketWorkflowPayload): Array<Record<string, unknown>> {
  if (Array.isArray(payload.merged_result?.merged_items)) {
    return payload.merged_result.merged_items;
  }

  if (Array.isArray(payload.merged_items)) {
    return payload.merged_items;
  }

  return [];
}

function getKeyword(payload: RawMarketWorkflowPayload) {
  return toStringValue(payload.keyword ?? payload.merged_result?.keyword, "");
}

function buildOccurrences(
  historicalCandidates: Array<{ run: DatedRunDirectory; candidate: MarketHistoryCandidateSnapshot }>
) {
  const occurrenceMap = new Map<string, {
    run_count: number;
    day_keys: Set<string>;
    first_seen_at: string;
    last_seen_at: string;
    prices: number[];
  }>();

  for (const { run, candidate } of historicalCandidates) {
    if (!occurrenceMap.has(candidate.item_id)) {
      occurrenceMap.set(candidate.item_id, {
        run_count: 0,
        day_keys: new Set<string>(),
        first_seen_at: run.timestamp.toISOString(),
        last_seen_at: run.timestamp.toISOString(),
        prices: []
      });
    }

    const existing = occurrenceMap.get(candidate.item_id)!;
    existing.run_count += 1;
    existing.day_keys.add(run.kst_date_key);
    if (run.timestamp.toISOString() < existing.first_seen_at) {
      existing.first_seen_at = run.timestamp.toISOString();
    }
    if (run.timestamp.toISOString() > existing.last_seen_at) {
      existing.last_seen_at = run.timestamp.toISOString();
    }
    if (candidate.price !== null) {
      existing.prices.push(candidate.price);
    }
  }

  return new Map(
    Array.from(occurrenceMap.entries()).map(([itemId, entry]) => [
      itemId,
      {
        item_id: itemId,
        run_count: entry.run_count,
        observed_day_count: entry.day_keys.size,
        first_seen_at: entry.first_seen_at,
        last_seen_at: entry.last_seen_at,
        min_price: entry.prices.length > 0 ? Math.min(...entry.prices) : null,
        max_price: entry.prices.length > 0 ? Math.max(...entry.prices) : null
      } satisfies MarketListingOccurrence
    ])
  );
}

function buildDiscoveredKeywords(
  historicalCandidates: Array<{ run: DatedRunDirectory; candidate: MarketHistoryCandidateSnapshot }>,
  minObservedDays: number
) {
  const discoveryMap = new Map<string, {
    component_type: string;
    canonical_name: string;
    mention_count: number;
    day_keys: Set<string>;
    example_titles: Set<string>;
  }>();

  for (const { run, candidate } of historicalCandidates) {
    if (candidate.listing_type !== "full_pc" && candidate.listing_type !== "semi_pc") continue;

    for (const component of candidate.components) {
      const discoveryKey = `${component.component_type}:${component.canonical_name}`;
      if (!discoveryMap.has(discoveryKey)) {
        discoveryMap.set(discoveryKey, {
          component_type: component.component_type,
          canonical_name: component.canonical_name,
          mention_count: 0,
          day_keys: new Set<string>(),
          example_titles: new Set<string>()
        });
      }

      const existing = discoveryMap.get(discoveryKey)!;
      existing.mention_count += 1;
      existing.day_keys.add(run.kst_date_key);
      if (existing.example_titles.size < 3 && candidate.title) {
        existing.example_titles.add(candidate.title);
      }
    }
  }

  return Array.from(discoveryMap.values())
    .map((entry) => ({
      component_type: entry.component_type,
      canonical_name: entry.canonical_name,
      mention_count: entry.mention_count,
      observed_day_count: entry.day_keys.size,
      example_titles: Array.from(entry.example_titles),
      auto_search_candidate: entry.day_keys.size >= minObservedDays
    } satisfies MarketDiscoveredKeyword))
    .sort((left, right) => {
      if (right.observed_day_count !== left.observed_day_count) {
        return right.observed_day_count - left.observed_day_count;
      }
      if (right.mention_count !== left.mention_count) {
        return right.mention_count - left.mention_count;
      }
      return left.canonical_name.localeCompare(right.canonical_name);
    });
}

async function loadRunPayload(run: DatedRunDirectory): Promise<RawMarketWorkflowPayload | null> {
  try {
    const outputPath = path.join(run.absolute_path, "output.json");
    return JSON.parse(await readFile(outputPath, "utf-8")) as RawMarketWorkflowPayload;
  } catch {
    return null;
  }
}

function getLookbackDays() {
  const parsed = Number(process.env.MARKET_HISTORY_LOOKBACK_DAYS ?? "7");
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 7;
}

function getDiscoveryMinObservedDays() {
  const parsed = Number(process.env.SCHEDULER_DISCOVERY_MIN_DAYS ?? "2");
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 2;
}

export async function readMarketHistoryBundle(
  marketBaseDir = path.resolve(process.cwd(), "merge/result/market"),
  lookbackDays = getLookbackDays()
): Promise<MarketHistoryBundle> {
  const manualSeedSummary = getManualPriceSeedSummary();
  const manualSeedDataset = buildManualPriceSeedDataset();
  const manualSeedWindows = manualSeedDataset.windows.map((window) => ({
    run_id: `manual-seed-${MANUAL_PRICE_SEED_AS_OF}`,
    date_key: MANUAL_PRICE_SEED_AS_OF,
    date_label: MANUAL_PRICE_SEED_AS_OF.slice(5),
    ...window
  }));
  const manualSeedHistoryPoints = manualSeedDataset.history_points.map((point) => ({
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
  } satisfies MarketHistoryWindowPoint));
  const allRuns = await listDatedRunDirectories(marketBaseDir);
  const selectedRuns = selectRunsWithinRecentKstDays(allRuns, lookbackDays);
  const historicalCandidates: Array<{ run: DatedRunDirectory; candidate: MarketHistoryCandidateSnapshot }> = [];
  const historyPointMap = new Map<string, { point: MarketHistoryWindowPoint; timestamp_ms: number }>();
  const latestWindowMap = new Map<string, { point: MarketHistoryWindowPoint; timestamp_ms: number }>();

  let latestRunId: string | undefined;
  let latestKeyword = "";
  let latestCandidates: MarketHistoryCandidateSnapshot[] = [];

  for (const run of selectedRuns) {
    const payload = await loadRunPayload(run);
    if (!payload) continue;

    const keyword = getKeyword(payload);
    const candidates = getMergedItems(payload).map((item) => toHistoryCandidate(item, keyword));
    const windows = Array.isArray(payload.market_snapshot?.windows)
      ? payload.market_snapshot.windows
          .map((window) => toHistoryWindowPoint(window, run))
          .filter((window): window is MarketHistoryWindowPoint => window !== null)
      : [];

    for (const candidate of candidates) {
      historicalCandidates.push({ run, candidate });
    }
    for (const window of windows) {
      if (window.listing_scope === "part" && !partWindowMatchesKeyword(window.component_key, keyword)) {
        continue;
      }

      const timestampMs = run.timestamp.getTime();
      const historyKey = `${window.date_key}:${window.listing_scope}:${window.component_key}:${window.window_days}`;
      const existingHistory = historyPointMap.get(historyKey);
      if (!existingHistory || shouldReplaceWindowVariant(existingHistory, window, timestampMs)) {
        historyPointMap.set(historyKey, {
          point: window,
          timestamp_ms: timestampMs
        });
      }

      const latestKey = `${window.listing_scope}:${window.component_key}:${window.window_days}`;
      const existingLatest = latestWindowMap.get(latestKey);
      if (!existingLatest || shouldReplaceWindowVariant(existingLatest, window, timestampMs)) {
        latestWindowMap.set(latestKey, {
          point: window,
          timestamp_ms: timestampMs
        });
      }
    }

    latestRunId = run.name;
    latestKeyword = keyword;
    latestCandidates = candidates;
  }

  const historyPoints = Array.from(historyPointMap.values()).map((entry) => entry.point);
  const latestWindows = Array.from(latestWindowMap.values()).map((entry) => entry.point);

  const latestWindowKeys = new Set(
    latestWindows.map((window) => `${window.listing_scope}:${window.component_key}:${window.window_days}`)
  );
  const mergedLatestWindows = [
    ...latestWindows,
    ...manualSeedWindows.filter(
      (window) => !latestWindowKeys.has(`${window.listing_scope}:${window.component_key}:${window.window_days}`)
    )
  ];

  const historyPointKeys = new Set(
    historyPoints.map((window) => `${window.date_key}:${window.listing_scope}:${window.component_key}:${window.window_days}`)
  );
  for (const seedWindow of manualSeedHistoryPoints) {
    const key = `${seedWindow.date_key}:${seedWindow.listing_scope}:${seedWindow.component_key}:${seedWindow.window_days}`;
    if (!historyPointKeys.has(key)) {
      historyPoints.push(seedWindow);
    }
  }

  historyPoints.sort((left, right) => {
    if (left.date_key !== right.date_key) {
      return left.date_key.localeCompare(right.date_key);
    }
    if (left.listing_scope !== right.listing_scope) {
      return left.listing_scope.localeCompare(right.listing_scope);
    }
    if (left.component_type !== right.component_type) {
      return left.component_type.localeCompare(right.component_type);
    }
    if (left.component_key !== right.component_key) {
      return left.component_key.localeCompare(right.component_key);
    }
    return left.window_days - right.window_days;
  });

  return {
    keyword: latestKeyword || undefined,
    latest_run_id: latestRunId,
    latest_candidates: latestCandidates,
    latest_windows: mergedLatestWindows,
    history_points: historyPoints,
    occurrences: buildOccurrences(historicalCandidates),
    discovered_keywords: buildDiscoveredKeywords(historicalCandidates, getDiscoveryMinObservedDays()),
    summary: {
      lookback_days: lookbackDays,
      observed_days: new Set(selectedRuns.map((run) => run.kst_date_key)).size,
      latest_run_id: latestRunId,
      latest_date_key: selectedRuns.length > 0 ? selectedRuns[selectedRuns.length - 1].kst_date_key : undefined,
      manual_seed_as_of: manualSeedSummary.as_of,
      manual_seed_entry_count: manualSeedSummary.entry_count
    }
  };
}
