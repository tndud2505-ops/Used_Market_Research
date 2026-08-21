import { classifyCandidate, decisionRank, type CandidateDecision } from "./decision.js";
import { buildManualPriceSeedDataset } from "../../market/logic/manual-price-seed.js";
import type {
  ReporterCandidate,
  ReporterHistoryPoint,
  ReporterPriceWindow,
  ReporterSourceData
} from "./types.js";
import {
  buildGap30d as sharedBuildGap30d,
  getDisplayExpectedPrice as sharedGetDisplayExpectedPrice,
  getDisplayGapPct as sharedGetDisplayGapPct,
  getRecommendationFreshnessReferenceTime as sharedGetRecommendationFreshnessReferenceTime,
  shouldIncludeUserFacingCandidate
} from "./user-facing-filter.js";

type CellValue = string | number | null;

export interface SheetsWorkbookTab {
  title: string;
  values: CellValue[][];
  freezeHeader?: boolean;
  headerRows?: number[];
  freezeRows?: number;
  freezeColumns?: number;
  currencyColumns?: number[];
  percentColumns?: number[];
  wrapColumns?: number[];
  decisionColumn?: number;
  hidden?: boolean;
  hideGridlines?: boolean;
  useFilter?: boolean;
  titleRows?: number[];
  sectionRows?: number[];
  centerColumns?: number[];
  alternateRowBanding?: boolean;
  columnWidths?: Array<{ columnIndex: number; width: number }>;
}

export interface SheetsWorkbook {
  tabs: SheetsWorkbookTab[];
}

interface RecommendationRow {
  candidate: ReporterCandidate;
  decision: CandidateDecision;
  note: string;
}

export interface UserFacingRecommendationEntry {
  candidate: ReporterCandidate;
  decision: CandidateDecision;
  note: string;
}

export interface UserFacingRecommendationGroups {
  recommendations: UserFacingRecommendationEntry[];
  part_recommendations: UserFacingRecommendationEntry[];
}

interface ComponentMarketRow {
  component_type: string;
  component_name: string;
  avg_7d: number | null;
  avg_30d: number | null;
  quick_trade_30d: number | null;
  sample_count_30d: number;
  best_live_price: number | null;
  best_live_gap_pct: number | null;
  live_listings: number;
  source_30d: string;
  history_values: Array<number | null>;
  best_url: string;
  best_title: string;
}

interface AnomalyAuditRow {
  component_type: string;
  component_name: string;
  source_30d: string;
  avg_30d: number | null;
  manual_30d: number | null;
  retail_reference_price: number | null;
  sample_count_30d: number;
  live_listings: number;
  best_live_price: number | null;
  best_live_gap_pct: number | null;
  manual_gap_pct: number | null;
  used_to_retail_ratio: number | null;
  flags: string[];
  action: string;
  best_url: string;
  best_title: string;
}

function isScanLikeComponentKey(componentName: string) {
  return /(?:^|[-_ ])(?:cpu|gpu|ram|ssd|full-pc)-scan$/i.test(componentName)
    || /(?:^|[-_ ])scan$/i.test(componentName);
}

function isGenericPartMarketKey(componentType: string, componentName: string) {
  if (!componentName) return true;
  if (componentType === "unknown") return true;
  if (isScanLikeComponentKey(componentName)) return true;
  if (/\bunknown\b/i.test(componentName)) return true;
  return /^(?:\uB370\uC2A4\uD06C\uD0D1|\uCEF4\uD4E8\uD130|\uBCF8\uCCB4|\uC870\uB9BDpc|desktop|computer|build)$/i.test(componentName);
}

function toColumnLetter(columnIndex: number) {
  let dividend = columnIndex + 1;
  let columnName = "";

  while (dividend > 0) {
    const modulo = (dividend - 1) % 26;
    columnName = String.fromCharCode(65 + modulo) + columnName;
    dividend = Math.floor((dividend - modulo) / 26);
  }

  return columnName;
}

function escapeFormulaText(value: string) {
  return value.replace(/"/g, "\"\"");
}

function buildLinkFormula(url: string, label = "open") {
  if (!url) return "";
  return `=HYPERLINK("${escapeFormulaText(url)}","${escapeFormulaText(label)}")`;
}

function formatNumber(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "n/a";
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}

function formatListingScope(scope: ReporterCandidate["listing_type"]) {
  if (scope === "full_pc") return "build";
  if (scope === "semi_pc") return "semi";
  if (scope === "part") return "part";
  return "market";
}

function isBuildListing(candidate: ReporterCandidate) {
  return candidate.listing_type === "full_pc" || candidate.listing_type === "semi_pc";
}

function getRecommendationFreshnessReferenceTime(recommendations: RecommendationRow[]) {
  return sharedGetRecommendationFreshnessReferenceTime(recommendations.map((entry) => entry.candidate));
}

function getDisplayExpectedPrice(candidate: ReporterCandidate) {
  return sharedGetDisplayExpectedPrice(candidate);
}

function getDisplayGapPct(candidate: ReporterCandidate) {
  return sharedGetDisplayGapPct(candidate);
}

function getBuildEvidencePriority(candidate: ReporterCandidate) {
  if (!isBuildListing(candidate)) {
    return 0;
  }

  if (candidate.valuation_mode === "build_components" && candidate.confirmed_component_count >= 2) {
    return 0;
  }

  if (candidate.detail_fetch_status === "success" && candidate.confirmed_component_count > 0) {
    return 1;
  }

  if (
    candidate.valuation_mode === "build_bundle"
    && candidate.detail_fetch_status !== "success"
    && candidate.confirmed_component_count === 0
    && candidate.unknown_component_types.length >= 5
  ) {
    return 3;
  }

  return 2;
}

function formatValuationMode(candidate: ReporterCandidate) {
  if (candidate.valuation_mode === "part_market") return "part market";
  if (candidate.valuation_mode === "build_components") {
    return candidate.detail_fetch_status === "success" && candidate.unknown_component_types.length === 0
      ? "component sum"
      : "component lower bound";
  }
  if (candidate.valuation_mode === "build_bundle") return "bundle fallback";
  return "missing";
}

function formatBuildResolution(candidate: ReporterCandidate) {
  if (candidate.listing_type === "part") {
    return "part";
  }

  if (candidate.detail_fetch_status === "success") {
    return candidate.unknown_component_types.length > 0
      ? `detail+unknown(${candidate.unknown_component_types.length})`
      : "detail confirmed";
  }

  if (candidate.detail_fetch_status === "unavailable") {
    return "detail unavailable";
  }

  if (candidate.detail_fetch_status === "failed") {
    return "detail failed";
  }

  return "search only";
}

function formatUnknownParts(candidate: ReporterCandidate) {
  if (candidate.unknown_component_types.length === 0) {
    return "";
  }

  return candidate.unknown_component_types.join(", ");
}

function buildDecisionNote(candidate: ReporterCandidate) {
  const notes: string[] = [];

  if (candidate.market_price_30d !== null) {
    notes.push(`${formatListingScope(candidate.listing_type)} ref ${formatNumber(candidate.market_price_30d)}`);
  }

  if (candidate.market_trade_estimate_30d !== null) {
    notes.push(`quick ${formatNumber(candidate.market_trade_estimate_30d)}`);
  }

  if (candidate.price_gap_to_market_30d !== null) {
    notes.push(`gap ${candidate.price_gap_to_market_30d >= 0 ? "+" : ""}${formatNumber(candidate.price_gap_to_market_30d)}`);
  }

  if (candidate.observed_day_count > 0) {
    notes.push(`seen ${candidate.observed_day_count}d`);
  } else {
    notes.push("history thin");
  }

  if (candidate.market_reference_source_30d === "manual_seed") {
    notes.push("manual seed");
  } else if (candidate.market_reference_source_30d === "mixed") {
    notes.push("mixed source");
  }

  if (candidate.retail_reference_price !== null && candidate.retail_reference_price !== undefined) {
    notes.push(`new ref ${formatNumber(candidate.retail_reference_price)}`);
  }

  if (candidate.retail_price_ratio !== null && candidate.retail_price_ratio !== undefined) {
    notes.push(`used/new ${Math.round(candidate.retail_price_ratio * 100)}%`);
  }

  if (isBuildListing(candidate) && candidate.part_reference_price_30d !== null) {
    notes.push(`part ref ${formatNumber(candidate.part_reference_price_30d)}`);
  }

  if (isBuildListing(candidate)) {
    if (candidate.component_sum_price_30d !== null) {
      notes.push(`parts ${candidate.component_priced_count}/${candidate.component_total_count} ${formatNumber(candidate.component_sum_price_30d)}`);
    }
    notes.push(formatValuationMode(candidate));
    notes.push(formatBuildResolution(candidate));
    if (candidate.unknown_component_types.length > 0) {
      notes.push(`unknown ${candidate.unknown_component_types.slice(0, 3).join("/")}`);
    }
  }

  if (candidate.decompose_recommendation === "decompose") {
    notes.push("part-out edge");
  }

  if (candidate.bottleneck_issues.length > 0) {
    notes.push(candidate.bottleneck_issues[0]);
  }

  if (notes.length === 0) {
    notes.push(candidate.score_reason || "needs manual review");
  }

  return notes.slice(0, 5).join(" | ");
}

function sortRecommendations(candidates: ReporterCandidate[]) {
  return [...candidates]
    .map((candidate) => ({
      candidate,
      decision: classifyCandidate(candidate),
      note: buildDecisionNote(candidate)
    }))
    .sort((left, right) => {
      if (decisionRank(left.decision) !== decisionRank(right.decision)) {
        return decisionRank(left.decision) - decisionRank(right.decision);
      }

      const leftEvidencePriority = getBuildEvidencePriority(left.candidate);
      const rightEvidencePriority = getBuildEvidencePriority(right.candidate);
      if (leftEvidencePriority !== rightEvidencePriority) {
        return leftEvidencePriority - rightEvidencePriority;
      }

      if (left.candidate.confirmed_component_count !== right.candidate.confirmed_component_count) {
        return right.candidate.confirmed_component_count - left.candidate.confirmed_component_count;
      }

      if (left.candidate.component_priced_count !== right.candidate.component_priced_count) {
        return right.candidate.component_priced_count - left.candidate.component_priced_count;
      }

      if (left.candidate.unknown_component_types.length !== right.candidate.unknown_component_types.length) {
        return left.candidate.unknown_component_types.length - right.candidate.unknown_component_types.length;
      }

      const rightGap = right.candidate.price_gap_to_market_30d ?? Number.NEGATIVE_INFINITY;
      const leftGap = left.candidate.price_gap_to_market_30d ?? Number.NEGATIVE_INFINITY;
      if (rightGap !== leftGap) {
        return rightGap - leftGap;
      }

      const rightScore = right.candidate.score_hint ?? 0;
      const leftScore = left.candidate.score_hint ?? 0;
      if (rightScore !== leftScore) {
        return rightScore - leftScore;
      }

      return (left.candidate.price ?? Number.MAX_SAFE_INTEGER) - (right.candidate.price ?? Number.MAX_SAFE_INTEGER);
    });
}

function getPrimaryPartKey(candidate: ReporterCandidate) {
  if (candidate.listing_type !== "part") {
    return "";
  }

  const priority = ["gpu", "cpu", "ram", "ssd", "motherboard", "psu"];
  for (const componentType of priority) {
    const match = candidate.components.find((component) => component.component_type === componentType);
    if (match) {
      return `${componentType}:${match.canonical_name}`;
    }
  }

  const first = candidate.components[0];
  if (first) {
    return `${first.component_type}:${first.canonical_name}`;
  }

  return `part:${candidate.title}`;
}

function getMaxRowsPerPartKey() {
  const parsed = Number(process.env.REPORTER_PART_RECOMMENDATION_MAX_PER_KEY ?? "3");
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 3;
}

function getMaxTotalPartRows(hasBuildRows: boolean) {
  const envKey = hasBuildRows
    ? "REPORTER_PART_RECOMMENDATION_MAX_TOTAL_WITH_BUILDS"
    : "REPORTER_PART_RECOMMENDATION_MAX_TOTAL_ONLY_PARTS";
  const fallback = hasBuildRows ? 12 : 16;
  const parsed = Number(process.env[envKey] ?? "");
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : fallback;
}

function getMaxRowsPerSsdKey() {
  const parsed = Number(process.env.REPORTER_PART_RECOMMENDATION_MAX_SSD_PER_KEY ?? "1");
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 1;
}

function getMaxTotalSsdRows() {
  const parsed = Number(process.env.REPORTER_PART_RECOMMENDATION_MAX_SSD_TOTAL ?? "3");
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 3;
}

function balanceRecommendations(recommendations: RecommendationRow[]) {
  const buildRows = recommendations.filter((entry) => isBuildListing(entry.candidate));
  const partRows = recommendations.filter((entry) => entry.candidate.listing_type === "part");
  const otherRows = recommendations.filter((entry) => !isBuildListing(entry.candidate) && entry.candidate.listing_type !== "part");

  const partRowsByKey = new Map<string, number>();
  const partRowsByType = new Map<string, number>();
  const limitedPartRows: RecommendationRow[] = [];
  const maxRowsPerPartKey = getMaxRowsPerPartKey();
  const maxTotalPartRows = getMaxTotalPartRows(buildRows.length > 0);

  for (const entry of partRows) {
    if (limitedPartRows.length >= maxTotalPartRows) {
      break;
    }

    const key = getPrimaryPartKey(entry.candidate);
    const componentType = key.split(":")[0] ?? "";
    const currentCount = partRowsByKey.get(key) ?? 0;
    const maxRowsForKey = componentType === "ssd" ? getMaxRowsPerSsdKey() : maxRowsPerPartKey;
    if (currentCount >= maxRowsForKey) {
      continue;
    }

    const currentTypeCount = partRowsByType.get(componentType) ?? 0;
    const maxRowsForType = componentType === "ssd" ? getMaxTotalSsdRows() : Number.POSITIVE_INFINITY;
    if (currentTypeCount >= maxRowsForType) {
      continue;
    }

    partRowsByKey.set(key, currentCount + 1);
    partRowsByType.set(componentType, currentTypeCount + 1);
    limitedPartRows.push(entry);
  }

  return [...buildRows, ...limitedPartRows, ...otherRows];
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

function readWindow(
  lookup: Map<string, ReporterPriceWindow>,
  listingScope: ReporterPriceWindow["listing_scope"],
  componentKey: string,
  windowDays: number
) {
  return lookup.get(`${listingScope}:${componentKey}:${windowDays}`) ?? null;
}

function buildManualWindowLookup() {
  return buildWindowLookup(
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
}

function getPartAnomalyRatioBounds(componentType: string) {
  if (componentType === "ram") {
    return { minRatio: 0.75, maxRatio: 1.3 };
  }

  if (componentType === "cpu" || componentType === "gpu") {
    return { minRatio: 0.6, maxRatio: 1.3 };
  }

  if (componentType === "ssd") {
    return { minRatio: 0.65, maxRatio: 1.35 };
  }

  return { minRatio: 0.55, maxRatio: 1.5 };
}

function buildPartCandidateMap(candidates: ReporterCandidate[]) {
  const candidateMap = new Map<string, ReporterCandidate[]>();

  for (const candidate of candidates.filter((entry) => entry.listing_type === "part")) {
    const seenKeys = new Set<string>();
    for (const component of candidate.components) {
      const componentKey = `${component.component_type}:${component.canonical_name}`;
      if (seenKeys.has(componentKey)) continue;
      seenKeys.add(componentKey);
      if (!candidateMap.has(componentKey)) {
        candidateMap.set(componentKey, []);
      }
      candidateMap.get(componentKey)!.push(candidate);
    }
  }

  return candidateMap;
}

function buildPartRetailLookup(candidates: ReporterCandidate[]) {
  const retailLookup = new Map<string, number>();

  for (const candidate of candidates) {
    if (candidate.listing_type !== "part") {
      continue;
    }

    if (
      candidate.retail_reference_price === null
      || candidate.retail_reference_price === undefined
      || candidate.retail_reference_price <= 0
    ) {
      continue;
    }

    const key = `${candidate.primary_component_type}:${candidate.primary_component}`;
    const current = retailLookup.get(key);
    if (current === undefined || candidate.retail_reference_price < current) {
      retailLookup.set(key, candidate.retail_reference_price);
    }
  }

  return retailLookup;
}

function classifyPartAnomalyRow(row: Omit<AnomalyAuditRow, "flags" | "action">) {
  const flags: string[] = [];

  if (row.source_30d === "observed" && row.sample_count_30d < 3) {
    flags.push("thin_observed");
  }

  if (row.manual_30d !== null && row.avg_30d !== null && row.manual_30d > 0) {
    const ratio = row.avg_30d / row.manual_30d;
    const { minRatio, maxRatio } = getPartAnomalyRatioBounds(row.component_type);
    if (ratio < minRatio || ratio > maxRatio) {
      flags.push("manual_seed_gap");
    }
  }

  if (row.retail_reference_price !== null && row.avg_30d !== null && row.retail_reference_price > 0) {
    const usedToRetailRatio = row.avg_30d / row.retail_reference_price;
    if (usedToRetailRatio > 1) {
      flags.push("above_new_retail");
    } else if (usedToRetailRatio >= 0.92) {
      flags.push("near_new_retail");
    }
  }

  if (row.source_30d === "observed" && row.live_listings === 0) {
    flags.push("no_live_confirmation");
  }

  if (row.best_live_gap_pct !== null && row.best_live_gap_pct >= 0.3) {
    flags.push("live_market_gap");
  }

  const action = flags.some((flag) =>
    flag === "above_new_retail"
    || flag === "near_new_retail"
    || flag === "manual_seed_gap"
  )
    ? "manual_review"
    : flags.some((flag) => flag === "thin_observed" || flag === "no_live_confirmation" || flag === "live_market_gap")
      ? "watch"
      : "ok";

  return {
    flags,
    action
  };
}

function buildHistoryLabels(historyPoints: ReporterHistoryPoint[]) {
  const labelByDate = new Map<string, string>();

  for (const point of historyPoints) {
    if (point.listing_scope !== "part" || point.window_days !== 30) continue;
    if (isGenericPartMarketKey(point.component_type, point.component_key)) continue;
    if (!labelByDate.has(point.date_key)) {
      labelByDate.set(point.date_key, point.date_label);
    }
  }

  return Array.from(labelByDate.entries())
    .sort((left, right) => left[0].localeCompare(right[0]))
    .slice(-7);
}

function buildHistoryValueLookup(historyPoints: ReporterHistoryPoint[]) {
  const lookup = new Map<string, ReporterHistoryPoint>();

  for (const point of historyPoints) {
    if (point.listing_scope !== "part" || point.window_days !== 30) continue;
    if (isGenericPartMarketKey(point.component_type, point.component_key)) continue;

    const key = `${point.component_type}:${point.component_key}:${point.date_key}`;
    const existing = lookup.get(key);
    if (!existing || (existing.source === "manual_seed" && point.source === "observed")) {
      lookup.set(key, point);
    }
  }

  return lookup;
}

function buildComponentMarketRows(source: ReporterSourceData): { historyLabels: Array<[string, string]>; rows: ComponentMarketRow[] } {
  const candidateMap = buildPartCandidateMap(source.candidates);

  const historyLabels = buildHistoryLabels(source.history_points);
  const historyLookup = buildHistoryValueLookup(source.history_points);
  const windowLookup = buildWindowLookup(source.windows);
  const componentTypeByKey = new Map<string, string>();
  for (const window of source.windows.filter((entry) => entry.listing_scope === "part")) {
    if (isGenericPartMarketKey(window.component_type, window.component_key)) {
      continue;
    }

    const existingType = componentTypeByKey.get(window.component_key);
    if (!existingType || existingType === "unknown") {
      componentTypeByKey.set(window.component_key, window.component_type);
      continue;
    }

    if (window.component_type !== "unknown") {
      componentTypeByKey.set(window.component_key, window.component_type);
    }
  }

  const componentKeys = Array.from(componentTypeByKey.entries())
    .map(([componentName, componentType]) => `${componentType}:${componentName}`)
    .sort((left, right) => left.localeCompare(right));

  const rows = componentKeys.map((compoundKey) => {
    const [componentType, componentName] = compoundKey.split(":", 2);
    const avg7d = readWindow(windowLookup, "part", componentName, 7);
    const avg30d = readWindow(windowLookup, "part", componentName, 30);
    const candidateKey = `${componentType}:${componentName}`;
    const currentMatches = [...(candidateMap.get(candidateKey) ?? [])].sort(
      (left, right) => (left.price ?? Number.MAX_SAFE_INTEGER) - (right.price ?? Number.MAX_SAFE_INTEGER)
    );
    const bestCurrent = currentMatches[0];
    const bestLiveGapPct = avg30d?.average_price !== null
      && avg30d?.average_price
      && bestCurrent !== undefined
      && bestCurrent.price !== null
        ? (avg30d.average_price - bestCurrent.price) / avg30d.average_price
        : null;
    const lowConfidenceObserved = avg30d?.source === "observed"
      && (avg30d.sample_count ?? 0) <= 1
      && currentMatches.length === 0;

    if (lowConfidenceObserved) {
      return null;
    }

    return {
      component_type: componentType,
      component_name: componentName,
      avg_7d: avg7d?.average_price ?? null,
      avg_30d: avg30d?.average_price ?? null,
      quick_trade_30d: avg30d?.trade_estimate ?? null,
      sample_count_30d: avg30d?.sample_count ?? 0,
      best_live_price: bestCurrent?.price ?? null,
      best_live_gap_pct: bestLiveGapPct,
      live_listings: currentMatches.length,
      source_30d: avg30d?.source ?? "",
      history_values: historyLabels.map(([dateKey]) => historyLookup.get(`${componentType}:${componentName}:${dateKey}`)?.average_price ?? null),
      best_url: bestCurrent?.url ?? "",
      best_title: bestCurrent?.title ?? ""
    } satisfies ComponentMarketRow;
  }).filter((row): row is ComponentMarketRow => row !== null);

  return {
    historyLabels,
    rows: rows.sort((left, right) => {
      const rightGap = right.best_live_gap_pct ?? Number.NEGATIVE_INFINITY;
      const leftGap = left.best_live_gap_pct ?? Number.NEGATIVE_INFINITY;
      if (rightGap !== leftGap) {
        return rightGap - leftGap;
      }
      return left.component_name.localeCompare(right.component_name);
    })
  };
}

function buildAnomalyAuditRows(source: ReporterSourceData, rows: ComponentMarketRow[]) {
  const manualLookup = buildManualWindowLookup();
  const retailLookup = buildPartRetailLookup(source.candidates);

  return rows
    .map((row) => {
      const componentKey = `${row.component_type}:${row.component_name}`;
      const manualWindow = readWindow(manualLookup, "part", row.component_name, 30);
      const manualPrice = manualWindow?.average_price ?? null;
      const retailPrice = retailLookup.get(componentKey) ?? null;
      const manualGapPct = row.avg_30d !== null
        && manualPrice !== null
        && manualPrice > 0
          ? (row.avg_30d - manualPrice) / manualPrice
          : null;
      const usedToRetailRatio = row.avg_30d !== null
        && retailPrice !== null
        && retailPrice > 0
          ? row.avg_30d / retailPrice
          : null;

      const baseRow = {
        component_type: row.component_type,
        component_name: row.component_name,
        source_30d: row.source_30d,
        avg_30d: row.avg_30d,
        manual_30d: manualPrice,
        retail_reference_price: retailPrice,
        sample_count_30d: row.sample_count_30d,
        live_listings: row.live_listings,
        best_live_price: row.best_live_price,
        best_live_gap_pct: row.best_live_gap_pct,
        manual_gap_pct: manualGapPct,
        used_to_retail_ratio: usedToRetailRatio,
        best_url: row.best_url,
        best_title: row.best_title
      };

      return {
        ...baseRow,
        ...classifyPartAnomalyRow(baseRow)
      } satisfies AnomalyAuditRow;
    })
    .sort((left, right) => {
      const actionRank = (value: string) => value === "manual_review" ? 0 : value === "watch" ? 1 : 2;
      if (actionRank(left.action) !== actionRank(right.action)) {
        return actionRank(left.action) - actionRank(right.action);
      }

      if (right.flags.length !== left.flags.length) {
        return right.flags.length - left.flags.length;
      }

      const rightGap = Math.abs(right.manual_gap_pct ?? 0);
      const leftGap = Math.abs(left.manual_gap_pct ?? 0);
      if (rightGap !== leftGap) {
        return rightGap - leftGap;
      }

      return left.component_name.localeCompare(right.component_name);
    });
}

function buildAnomalyAuditTab(rows: AnomalyAuditRow[]): SheetsWorkbookTab {
  const header = [
    "component_type",
    "component_name",
    "action",
    "flags",
    "source_30d",
    "avg_30d",
    "manual_30d",
    "manual_gap_pct",
    "retail_reference_price",
    "used_to_retail_ratio",
    "sample_count_30d",
    "live_listings",
    "best_live_price",
    "best_live_gap_pct",
    "best_link",
    "best_title"
  ];

  return {
    title: "anomaly_audit",
    values: [
      header,
      ...rows.map((row) => ([
        row.component_type,
        row.component_name,
        row.action,
        row.flags.join(", "),
        row.source_30d,
        row.avg_30d,
        row.manual_30d,
        row.manual_gap_pct,
        row.retail_reference_price,
        row.used_to_retail_ratio,
        row.sample_count_30d,
        row.live_listings,
        row.best_live_price,
        row.best_live_gap_pct,
        buildLinkFormula(row.best_url),
        row.best_title
      ] satisfies CellValue[]))
    ],
    headerRows: [0],
    freezeRows: 1,
    freezeColumns: 4,
    currencyColumns: [5, 6, 8, 12],
    percentColumns: [7, 9, 13],
    wrapColumns: [3, 15],
    alternateRowBanding: true,
    columnWidths: [
      { columnIndex: 1, width: 220 },
      { columnIndex: 3, width: 220 },
      { columnIndex: 15, width: 360 }
    ]
  };
}

function getBuildDisplayPrice7d(candidate: ReporterCandidate) {
  if (!isBuildListing(candidate)) {
    return candidate.market_price_7d;
  }

  return candidate.market_price_7d ?? candidate.component_sum_price_7d;
}

function findComponentPriceEntry(candidate: ReporterCandidate, componentType: string) {
  const pricedEntries = candidate.component_price_breakdown
    .filter((component) => component.component_type === componentType)
    .sort((left, right) => (right.price_30d ?? Number.NEGATIVE_INFINITY) - (left.price_30d ?? Number.NEGATIVE_INFINITY));
  if (pricedEntries[0]) {
    return pricedEntries[0];
  }

  const fallback = candidate.components.find((component) => component.component_type === componentType);
  if (!fallback) {
    return null;
  }

  return {
    component_type: fallback.component_type,
    canonical_name: fallback.canonical_name,
    price_30d: null,
    trade_estimate_30d: null,
    source_30d: "missing" as const
  };
}

function getComponentDisplay(candidate: ReporterCandidate, componentType: string) {
  const entry = findComponentPriceEntry(candidate, componentType);
  return {
    name: entry?.canonical_name ?? "",
    price30d: entry?.price_30d ?? null
  };
}

function getOtherComponentsPrice30d(candidate: ReporterCandidate) {
  const excluded = new Set(["cpu", "gpu", "ram", "ssd"]);
  const values = candidate.component_price_breakdown
    .filter((component) => !excluded.has(component.component_type) && component.price_30d !== null)
    .map((component) => component.price_30d ?? 0);
  if (values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0);
}

function buildCompactComponentSummary(candidate: ReporterCandidate) {
  const parts: string[] = [];
  const labels: Array<[string, string]> = [
    ["cpu", "CPU"],
    ["gpu", "GPU"],
    ["ram", "RAM"],
    ["ssd", "SSD"]
  ];

  for (const [componentType, label] of labels) {
    const value = getComponentDisplay(candidate, componentType);
    if (!value.name && value.price30d === null) continue;
    parts.push(`${label} ${value.name || "-"} ${formatNumber(value.price30d)}`);
  }

  const otherPrice = getOtherComponentsPrice30d(candidate);
  if (otherPrice !== null) {
    parts.push(`OTHER ${formatNumber(otherPrice)}`);
  }

  if (parts.length === 0) {
    return buildDecisionNote(candidate);
  }

  return parts.join(" / ");
}

function buildGap30d(candidate: ReporterCandidate) {
  return sharedBuildGap30d(candidate);
}

function shouldIncludeRecommendationRow(entry: RecommendationRow, freshnessReferenceTimeMs: number | null) {
  return shouldIncludeUserFacingCandidate(entry.candidate, entry.decision, freshnessReferenceTimeMs);
}

function buildRecommendationsTab(
  generatedAt: string,
  recommendations: RecommendationRow[],
  title = "recommendations"
): SheetsWorkbookTab {
  const header = [
    "updated_at",
    "판정",
    "제목",
    "실매물가",
    "CPU",
    "CPU_30d",
    "GPU",
    "GPU_30d",
    "RAM",
    "RAM_30d",
    "SSD",
    "SSD_30d",
    "기타합_30d",
    "기준가_7d",
    "기준가_30d",
    "차액_30d",
    "차이율_30d",
    "수요",
    "근거요약",
    "링크"
  ];

  const freshnessReferenceTimeMs = getRecommendationFreshnessReferenceTime(recommendations);
  const rows = balanceRecommendations(recommendations)
    .filter((entry) => shouldIncludeRecommendationRow(entry, freshnessReferenceTimeMs))
    .map((entry) => {
      const cpu = getComponentDisplay(entry.candidate, "cpu");
      const gpu = getComponentDisplay(entry.candidate, "gpu");
      const ram = getComponentDisplay(entry.candidate, "ram");
      const ssd = getComponentDisplay(entry.candidate, "ssd");

      return [
        generatedAt,
        entry.decision,
        entry.candidate.title,
        entry.candidate.price,
        cpu.name,
        cpu.price30d,
        gpu.name,
        gpu.price30d,
        ram.name,
        ram.price30d,
        ssd.name,
        ssd.price30d,
        getOtherComponentsPrice30d(entry.candidate),
        getBuildDisplayPrice7d(entry.candidate),
        getDisplayExpectedPrice(entry.candidate),
        buildGap30d(entry.candidate),
        getDisplayGapPct(entry.candidate),
        entry.candidate.demand_strength,
        buildCompactComponentSummary(entry.candidate),
        buildLinkFormula(entry.candidate.url)
      ] satisfies CellValue[];
    });

  return {
    title,
    values: [header, ...rows],
    headerRows: [0],
    freezeRows: 1,
    freezeColumns: 4,
    currencyColumns: [3, 5, 7, 9, 11, 12, 13, 14, 15],
    percentColumns: [16],
    wrapColumns: [2, 18],
    decisionColumn: 1,
    centerColumns: [1, 3, 5, 7, 9, 11, 12, 13, 14, 15, 16, 17, 19],
    alternateRowBanding: true,
    columnWidths: [
      { columnIndex: 2, width: 420 },
      { columnIndex: 4, width: 180 },
      { columnIndex: 6, width: 180 },
      { columnIndex: 8, width: 150 },
      { columnIndex: 10, width: 150 },
      { columnIndex: 18, width: 460 }
    ]
  };
}

export function getUserFacingRecommendationEntries(candidates: ReporterCandidate[]): UserFacingRecommendationEntry[] {
  const recommendations = balanceRecommendations(sortRecommendations(candidates));
  const freshnessReferenceTimeMs = getRecommendationFreshnessReferenceTime(recommendations);
  return recommendations
    .filter((entry) => shouldIncludeRecommendationRow(entry, freshnessReferenceTimeMs))
    .map((entry) => ({
      candidate: entry.candidate,
      decision: entry.decision,
      note: entry.note
    }));
}

export function getUserFacingRecommendationGroups(candidates: ReporterCandidate[]): UserFacingRecommendationGroups {
  const recommendations = sortRecommendations(candidates);
  const buildRecommendations = recommendations.filter((entry) => isBuildListing(entry.candidate));
  const partRecommendations = recommendations.filter((entry) => entry.candidate.listing_type === "part");
  const buildFreshnessReferenceTimeMs = getRecommendationFreshnessReferenceTime(buildRecommendations);
  const partFreshnessReferenceTimeMs = getRecommendationFreshnessReferenceTime(partRecommendations);

  return {
    recommendations: balanceRecommendations(buildRecommendations)
      .filter((entry) => shouldIncludeRecommendationRow(entry, buildFreshnessReferenceTimeMs))
      .map((entry) => ({
        candidate: entry.candidate,
        decision: entry.decision,
        note: entry.note
      })),
    part_recommendations: balanceRecommendations(partRecommendations)
      .filter((entry) => shouldIncludeRecommendationRow(entry, partFreshnessReferenceTimeMs))
      .map((entry) => ({
        candidate: entry.candidate,
        decision: entry.decision,
        note: entry.note
      }))
  };
}

function getMinimumObservedDaysForCriteria() {
  const parsed = Number(process.env.REPORTER_MIN_OBSERVED_DAYS ?? "2");
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 2;
}

function buildCriteriaTab(): SheetsWorkbookTab {
  return {
    title: "criteria",
    values: [
      ["항목", "값", "기준", "설명"],
      ["추천 노출", "본체/세미본체/단품", "decision != PASS and 차액_30d > 0", "메인 추천 탭에는 PASS를 제외하고 기준가 대비 실제 매물가가 더 싼 항목만 노출합니다."],
      ["7일 기준", "기준가_7d", "최근 7일 평균", "단품은 단품 시세, 본체는 최근 7일 기준가를 보는 보조 기준입니다."],
      ["30일 기준", "기준가_30d", "최근 30일 평균", "단품은 단품 시세, 본체는 부품합/기준가이며 차액과 차이율 계산의 기본 기준입니다."],
      ["차액_30d", "기준가_30d - 실매물가", "양수 우선", "양수일수록 현재 매물이 기준가 대비 저렴합니다."],
      ["차이율_30d", "차액_30d / 기준가_30d", "클수록 유리", "30일 기준 대비 몇 퍼센트 저렴한지 보여줍니다."],
      ["수요 high", "HIGH", "full_pc 또는 gpu 포함", "현재 수요 로직은 본체나 GPU 포함 매물을 빠르게 팔리는 쪽으로 둡니다."],
      ["수요 medium", "MEDIUM", "part + cpu/ram/ssd", "단품 중 CPU/RAM/SSD 위주 매물을 중간 수요로 봅니다."],
      ["수요 low", "LOW", "그 외", "기본 수요가 약한 구성으로 봅니다."],
      ["BUY", "즉시 확인", "점수/차이율/사기위험 통과", "가격 메리트가 충분하고 정보가 비교적 확실한 매물입니다."],
      ["WATCH", "관심 유지", "가격 메리트는 있으나 정보 부족", "부품 확인이 덜 됐거나 히스토리가 얇아 추가 확인이 필요합니다."],
      ["WATCH LIST 식별", "canonical_name", "제목/상세 패턴 매칭", "RTX 3060, Ryzen 5600 같은 표준명으로 정규화해서 누적합니다."],
      ["WATCH LIST 추가", "YES", `observed_days >= ${getMinimumObservedDaysForCriteria()}`, "본체/세미본체에서 여러 날 반복 관측된 부품만 다음 검색 후보로 올립니다."]
    ],
    headerRows: [0],
    freezeRows: 1,
    wrapColumns: [2, 3],
    columnWidths: [
      { columnIndex: 0, width: 150 },
      { columnIndex: 1, width: 180 },
      { columnIndex: 2, width: 220 },
      { columnIndex: 3, width: 420 }
    ]
  };
}

function buildComponentTableTab(
  title: string,
  rows: ComponentMarketRow[],
  historyLabels: Array<[string, string]>
): SheetsWorkbookTab {
  const dateHeaders = historyLabels.map(([, label]) => label);
  const header = [
    "component_type",
    "component_name",
    "avg_7d",
    "avg_30d",
    "quick_trade_30d",
    "best_live_price",
    "best_live_gap_pct",
    "live_listings",
    "source_30d",
    "trend_30d",
    ...dateHeaders,
    "best_link",
    "best_title"
  ];
  const dateStartIndex = 10;

  const values = rows.map((row, index) => {
    const rowNumber = index + 2;
    const dateEndIndex = dateStartIndex + dateHeaders.length - 1;
    const trendFormula = dateHeaders.length > 0
      ? `=IF(COUNTA(${toColumnLetter(dateStartIndex)}${rowNumber}:${toColumnLetter(dateEndIndex)}${rowNumber})=0,"",SPARKLINE(${toColumnLetter(dateStartIndex)}${rowNumber}:${toColumnLetter(dateEndIndex)}${rowNumber},{"charttype","line";"linewidth",2;"color","#0F766E"}))`
      : "";

    return [
      row.component_type,
      row.component_name,
      row.avg_7d,
      row.avg_30d,
      row.quick_trade_30d,
      row.best_live_price,
      row.best_live_gap_pct,
      row.live_listings,
      row.source_30d,
      trendFormula,
      ...row.history_values,
      buildLinkFormula(row.best_url),
      row.best_title
    ] satisfies CellValue[];
  });

  const trailingLinkIndex = 10 + dateHeaders.length;

  return {
    title,
    values: [header, ...values],
    headerRows: [0],
    freezeRows: 1,
    freezeColumns: 2,
    currencyColumns: [2, 3, 4, 5, ...dateHeaders.map((_, offset) => dateStartIndex + offset)],
    percentColumns: [6],
    wrapColumns: [1, trailingLinkIndex + 1],
    centerColumns: [0, 6, 7, 8, trailingLinkIndex],
    alternateRowBanding: true,
    columnWidths: [
      { columnIndex: 1, width: 240 },
      { columnIndex: 9, width: 140 },
      { columnIndex: trailingLinkIndex + 1, width: 360 }
    ]
  };
}

function buildKeywordWatchlistTab(source: ReporterSourceData): SheetsWorkbookTab {
  const header = [
    "component_type",
    "canonical_name",
    "observed_days",
    "mentions",
    "next_search_target",
    "example_titles"
  ];

  const rows = source.discovered_keywords.map((keyword) => [
    keyword.component_type,
    keyword.canonical_name,
    keyword.observed_day_count,
    keyword.mention_count,
    keyword.auto_search_candidate ? "YES" : "NO",
    keyword.example_titles.join(" | ")
  ] satisfies CellValue[]);

  return {
    title: "keyword_watchlist",
    values: [header, ...rows],
    headerRows: [0],
    freezeRows: 1,
    freezeColumns: 2,
    wrapColumns: [5],
    centerColumns: [2, 3, 4],
    alternateRowBanding: true,
    columnWidths: [
      { columnIndex: 1, width: 240 },
      { columnIndex: 5, width: 420 }
    ]
  };
}

function buildListingComponentsTab(generatedAt: string, candidates: ReporterCandidate[]): SheetsWorkbookTab {
  const header = [
    "updated_at",
    "decision",
    "listing_type",
    "component_type",
    "component_name",
    "evidence",
    "source_kind",
    "site",
    "price",
    "expected_market_30d",
    "gap_pct_30d",
    "score",
    "observed_days",
    "seller",
    "posted_at",
    "open",
    "title"
  ];

  const rows = candidates
    .flatMap((candidate) => {
      const decision = classifyCandidate(candidate);
      const components = candidate.components.length > 0
        ? candidate.components
        : [{
            component_type: candidate.primary_component_type,
            canonical_name: candidate.primary_component,
            confidence: 0,
            source_kind: "title",
            evidence_level: "estimated"
          }];

      return components.map((component) => ([
        generatedAt,
        decision,
        candidate.listing_type,
        component.component_type,
        component.canonical_name,
        component.evidence_level,
        component.source_kind,
        candidate.site,
        candidate.price,
        candidate.market_price_30d,
        candidate.price_gap_to_market_30d_pct,
        candidate.score_hint,
        candidate.observed_day_count,
        candidate.seller,
        candidate.posted_at,
        buildLinkFormula(candidate.url),
        candidate.title
      ] satisfies CellValue[]));
    })
    .sort((left, right) => {
      const leftDecision = String(left[1] ?? "PASS") as CandidateDecision;
      const rightDecision = String(right[1] ?? "PASS") as CandidateDecision;
      if (decisionRank(leftDecision) !== decisionRank(rightDecision)) {
        return decisionRank(leftDecision) - decisionRank(rightDecision);
      }

      const leftName = String(left[4] ?? "");
      const rightName = String(right[4] ?? "");
      if (leftName !== rightName) {
        return leftName.localeCompare(rightName);
      }

      return Number(left[6] ?? Number.MAX_SAFE_INTEGER) - Number(right[6] ?? Number.MAX_SAFE_INTEGER);
    });

  return {
    title: "listing_components",
    values: [header, ...rows],
    headerRows: [0],
    freezeRows: 1,
    freezeColumns: 4,
    currencyColumns: [8, 9],
    percentColumns: [10],
    wrapColumns: [16],
    decisionColumn: 1,
    hidden: true
  };
}

function buildRawListingsTab(generatedAt: string, candidates: ReporterCandidate[]): SheetsWorkbookTab {
  const header = [
    "updated_at",
    "site",
    "title",
    "listing_type",
    "price",
    "seller",
    "primary_component",
    "bundle_key",
    "score",
    "score_reason",
    "fraud_flags",
    "model_status",
    "resolution",
    "detail_fetch_status",
    "detail_fetch_note",
    "valuation_mode",
    "confirmed_components",
    "priced_parts",
    "component_sum_30d",
    "unknown_parts",
    "observed_days",
    "posted_at",
    "url"
  ];

  const rows = candidates.map((candidate) => [
    generatedAt,
    candidate.site,
    candidate.title,
    candidate.listing_type,
    candidate.price,
    candidate.seller,
    candidate.primary_component,
    candidate.bundle_key ?? "",
    candidate.score_hint,
    candidate.score_reason,
    candidate.fraud_flags.join(" | "),
    candidate.model_status,
    candidate.component_resolution,
    candidate.detail_fetch_status,
    candidate.detail_fetch_note,
    formatValuationMode(candidate),
    candidate.confirmed_component_count,
    `${candidate.component_priced_count}/${candidate.component_total_count}`,
    candidate.component_sum_price_30d,
    formatUnknownParts(candidate),
    candidate.observed_day_count,
    candidate.posted_at,
    candidate.url
  ] satisfies CellValue[]);

  return {
    title: "raw_listings",
    values: [header, ...rows],
    headerRows: [0],
    freezeRows: 1,
    currencyColumns: [4, 18],
    wrapColumns: [2, 9, 10, 14, 19, 21, 22],
    hidden: true
  };
}

function buildRunInfoTab(runId: string, source: ReporterSourceData, generatedAt: string): SheetsWorkbookTab {
  const decisions = source.candidates.map((candidate) => classifyCandidate(candidate));
  const buyCount = decisions.filter((decision) => decision === "BUY").length;
  const watchCount = decisions.filter((decision) => decision === "WATCH").length;
  const checkCount = decisions.filter((decision) => decision === "CHECK").length;
  const passCount = decisions.filter((decision) => decision === "PASS").length;
  const partWindowKeys = new Set(
    source.windows
      .filter((window) => window.listing_scope === "part")
      .map((window) => window.component_key)
  );
  const buildCandidates = source.candidates.filter((candidate) => isBuildListing(candidate));
  const buildDetailSuccessCount = buildCandidates.filter((candidate) => candidate.detail_fetch_status === "success").length;
  const buildDetailPendingCount = buildCandidates.length - buildDetailSuccessCount;

  return {
    title: "run_info",
    values: [
      ["field", "value"],
      ["reporter_run_id", runId],
      ["source_run_id", source.source_run_id ?? ""],
      ["keyword", source.keyword ?? ""],
      ["generated_at", generatedAt],
      ["candidate_count", source.candidates.length],
      ["buy_count", buyCount],
      ["watch_count", watchCount],
      ["check_count", checkCount],
      ["pass_count", passCount],
      ["part_component_count", partWindowKeys.size],
      ["window_row_count", source.windows.length],
      ["history_point_count", source.history_points.length],
      ["history_observed_days", source.history_summary.observed_days],
      ["history_lookback_days", source.history_summary.lookback_days],
      ["manual_seed_as_of", source.history_summary.manual_seed_as_of ?? ""],
      ["manual_seed_entry_count", source.history_summary.manual_seed_entry_count],
      ["discovered_keyword_count", source.discovered_keywords.length],
      ["build_detail_success_count", buildDetailSuccessCount],
      ["build_detail_pending_count", buildDetailPendingCount]
    ],
    headerRows: [0],
    freezeRows: 1,
    wrapColumns: [1],
    hidden: true
  };
}

export function buildSheetsWorkbook(runId: string, source: ReporterSourceData, generatedAt = new Date().toISOString()): SheetsWorkbook {
  const recommendations = sortRecommendations(source.candidates);
  const buildRecommendations = recommendations.filter((entry) => isBuildListing(entry.candidate));
  const partRecommendations = recommendations.filter((entry) => entry.candidate.listing_type === "part");
  const componentModel = buildComponentMarketRows(source);
  const anomalyAuditRows = buildAnomalyAuditRows(source, componentModel.rows);

  return {
    tabs: [
      buildRecommendationsTab(generatedAt, buildRecommendations, "recommendations"),
      buildRecommendationsTab(generatedAt, partRecommendations, "part_recommendations"),
      buildCriteriaTab(),
      buildComponentTableTab("price_history", componentModel.rows, componentModel.historyLabels),
      buildAnomalyAuditTab(anomalyAuditRows),
      buildKeywordWatchlistTab(source),
      buildRunInfoTab(runId, source, generatedAt),
      buildListingComponentsTab(generatedAt, source.candidates),
      buildRawListingsTab(generatedAt, source.candidates)
    ]
  };
}
