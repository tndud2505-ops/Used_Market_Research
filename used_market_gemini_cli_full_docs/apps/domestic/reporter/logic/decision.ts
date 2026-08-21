import type { ReporterCandidate } from "./types.js";

export type CandidateDecision = "BUY" | "WATCH" | "CHECK" | "PASS";

function getMinimumObservedDays() {
  const parsed = Number(process.env.REPORTER_MIN_OBSERVED_DAYS ?? "2");
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 2;
}

function getPartRetailMaxRatio() {
  const parsed = Number(process.env.REPORTER_PART_RETAIL_MAX_RATIO ?? "0.9");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0.9;
}

function getPartRetailMaxRatioByType(componentType: string) {
  const envKey = `REPORTER_PART_RETAIL_MAX_RATIO_${componentType.toUpperCase()}`;
  const parsed = Number(process.env[envKey] ?? "");
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }

  if (componentType === "cpu") return 0.85;
  if (componentType === "gpu") return 0.8;
  if (componentType === "ram") return 0.75;
  if (componentType === "ssd") return 0.65;
  if (componentType === "motherboard") return 0.8;
  if (componentType === "psu") return 0.6;
  return getPartRetailMaxRatio();
}

function getPartMarketMinRatio() {
  const parsed = Number(process.env.REPORTER_PART_MARKET_MIN_RATIO ?? "0.3");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0.3;
}

function getPartMarketMaxRatio() {
  const parsed = Number(process.env.REPORTER_PART_MARKET_MAX_RATIO ?? "2.4");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 2.4;
}

function hasHistoryReady(candidate: ReporterCandidate) {
  return candidate.observed_day_count >= getMinimumObservedDays();
}

function getReferenceSampleCount(candidate: ReporterCandidate) {
  if (candidate.listing_type === "part") {
    return Math.max(candidate.market_sample_30d, candidate.part_reference_sample_30d);
  }

  return Math.max(candidate.market_sample_30d, candidate.component_priced_count);
}

function getMinimumReferenceSamples(candidate: ReporterCandidate) {
  if (candidate.listing_type === "part") {
    if (
      candidate.primary_component_type === "cpu"
      || candidate.primary_component_type === "gpu"
      || candidate.primary_component_type === "ram"
      || candidate.primary_component_type === "ssd"
      || candidate.primary_component_type === "motherboard"
      || candidate.primary_component_type === "psu"
    ) {
      return 3;
    }

    return 2;
  }

  return 2;
}

function getReferenceSource(candidate: ReporterCandidate) {
  if (candidate.listing_type === "part") {
    if (candidate.market_reference_source_30d !== "missing") {
      return candidate.market_reference_source_30d;
    }
    return candidate.part_reference_source_30d;
  }

  return candidate.market_reference_source_30d !== "missing"
    ? candidate.market_reference_source_30d
    : candidate.component_sum_source_30d;
}

function hasTradeEstimateReference(candidate: ReporterCandidate) {
  if (candidate.listing_type === "part") {
    return candidate.market_trade_estimate_30d !== null
      || candidate.part_reference_trade_estimate_30d !== null;
  }

  return candidate.market_trade_estimate_30d !== null
    || candidate.component_sum_trade_estimate_30d !== null
    || candidate.market_price_30d !== null;
}

function hasReferenceDepth(candidate: ReporterCandidate) {
  return getReferenceSampleCount(candidate) >= getMinimumReferenceSamples(candidate);
}

function hasReliableReferenceSource(candidate: ReporterCandidate) {
  const source = getReferenceSource(candidate);
  return source === "observed" || source === "mixed";
}

function isManualDominatedReference(candidate: ReporterCandidate) {
  const source = getReferenceSource(candidate);
  return source === "manual_seed" || source === "missing";
}

function getReviewFlags(candidate: ReporterCandidate) {
  return candidate.review_flags ?? [];
}

function isReviewOnlyCandidate(candidate: ReporterCandidate) {
  return getReviewFlags(candidate).some((flag) =>
    flag === "bundle_review" || flag === "unknown_but_interesting"
  );
}

function getEdgeRatio(candidate: ReporterCandidate) {
  if (candidate.price_gap_to_market_30d_pct !== null) {
    return candidate.price_gap_to_market_30d_pct;
  }
  return candidate.deviation_rate ?? 0;
}

function hasWeakBuildEvidence(candidate: ReporterCandidate) {
  return candidate.listing_type !== "part"
    && candidate.valuation_mode === "build_bundle"
    && candidate.detail_fetch_status !== "success"
    && candidate.confirmed_component_count === 0
    && candidate.unknown_component_types.length >= 5;
}

function countDistinctComponentOptions(candidate: ReporterCandidate, componentType: string) {
  return new Set(
    candidate.components
      .filter((component) => component.component_type === componentType)
      .map((component) => component.canonical_name)
  ).size;
}

function hasMultiOptionBuild(candidate: ReporterCandidate) {
  return candidate.listing_type !== "part"
    && (
      countDistinctComponentOptions(candidate, "cpu") > 1
      || countDistinctComponentOptions(candidate, "gpu") > 1
      || countDistinctComponentOptions(candidate, "motherboard") > 1
    );
}

function countModelTokens(title: string) {
  const matches = title.match(
    /(rtx\s*\d{4}(?:\s*ti)?|rx\s*\d{4}(?:\s*xt)?|gtx\s*\d{3,4}|(?:ryzen|i[3579]|ultra)\s*[- ]?\d{0,2}[ ]?\d{4,5}[a-z0-9-]*|\b\d{4,5}(?:x3d|[fgkx])\b)/gi
  );
  return matches?.length ?? 0;
}

function hasAmbiguousMultiModelBuild(candidate: ReporterCandidate) {
  return candidate.listing_type !== "part"
    && countModelTokens(candidate.title) >= 4
    && candidate.confirmed_component_count <= 3;
}

function hasWeakRetailEdge(candidate: ReporterCandidate) {
  if (candidate.listing_type !== "part") {
    return false;
  }

  if (candidate.price === null || candidate.retail_reference_price === null || candidate.retail_reference_price === undefined) {
    return false;
  }

  const ratio = candidate.retail_price_ratio
    ?? (candidate.retail_reference_price > 0 ? candidate.price / candidate.retail_reference_price : null);

  if (ratio === null) {
    return false;
  }

  return ratio >= getPartRetailMaxRatioByType(candidate.primary_component_type);
}

function hasPartMarketSanityFailure(candidate: ReporterCandidate) {
  if (candidate.listing_type !== "part") {
    return false;
  }

  const referencePrice = candidate.market_price_30d ?? candidate.part_reference_price_30d ?? candidate.baseline_price;
  if (candidate.price === null || referencePrice === null || referencePrice <= 0) {
    return false;
  }

  const ratio = candidate.price / referencePrice;
  return ratio < getPartMarketMinRatio() || ratio > getPartMarketMaxRatio();
}

export function classifyCandidate(candidate: ReporterCandidate): CandidateDecision {
  const score = candidate.score_hint ?? 0;
  const edgeRatio = getEdgeRatio(candidate);
  const fraudRisk = candidate.fraud_risk_score;
  const netProfit = candidate.net_profit ?? 0;
  const fastEnoughToFlip = candidate.estimated_days_to_sell > 0 && candidate.estimated_days_to_sell <= 21;
  const decomposeEdge = candidate.decompose_recommendation === "decompose";
  const heavyBottleneck = candidate.bottleneck_issues.length >= 2;
  const historyReady = hasHistoryReady(candidate);
  const referenceDepthReady = hasReferenceDepth(candidate);
  const reliableReferenceSource = hasReliableReferenceSource(candidate);
  const manualDominatedReference = isManualDominatedReference(candidate);
  const tradeEstimateReady = hasTradeEstimateReference(candidate);
  const referenceReadyForBuy = historyReady
    && referenceDepthReady
    && reliableReferenceSource
    && tradeEstimateReady;
  const referenceNeedsCaution = !referenceDepthReady
    || !reliableReferenceSource
    || !tradeEstimateReady
    || manualDominatedReference;
  const buildNeedsVerification = candidate.listing_type !== "part"
    && (
      candidate.detail_fetch_status !== "success"
      || candidate.confirmed_component_count < 2
      || candidate.unknown_component_types.length >= 4
    );

  if (hasWeakBuildEvidence(candidate)) {
    return "PASS";
  }

  if (hasMultiOptionBuild(candidate)) {
    return "PASS";
  }

  if (hasAmbiguousMultiModelBuild(candidate)) {
    return "PASS";
  }

  if (!isReviewOnlyCandidate(candidate) && hasWeakRetailEdge(candidate)) {
    return "PASS";
  }

  if (!isReviewOnlyCandidate(candidate) && hasPartMarketSanityFailure(candidate)) {
    return "PASS";
  }

  let decision: CandidateDecision;
  if (
    score >= 80
    && fraudRisk <= 0.25
    && (edgeRatio >= 0.12 || netProfit >= 50_000 || decomposeEdge)
    && !heavyBottleneck
    && !buildNeedsVerification
  ) {
    decision = referenceReadyForBuy ? "BUY" : "WATCH";
  } else if (
    score >= 65
    && fraudRisk <= 0.45
    && (edgeRatio >= 0 || netProfit >= 0 || decomposeEdge || fastEnoughToFlip)
  ) {
    if (buildNeedsVerification || referenceNeedsCaution) {
      decision = "WATCH";
    } else {
      decision = historyReady ? "CHECK" : "WATCH";
    }
  } else {
    decision = "PASS";
  }

  if (isReviewOnlyCandidate(candidate) && decision === "BUY") {
    return historyReady ? "CHECK" : "WATCH";
  }

  return decision;
}

export function decisionRank(decision: CandidateDecision) {
  if (decision === "BUY") return 0;
  if (decision === "WATCH") return 1;
  if (decision === "CHECK") return 2;
  return 3;
}

export function isDispatchableDecision(decision: CandidateDecision, candidate?: ReporterCandidate) {
  if (decision === "BUY") {
    return true;
  }

  if (!candidate || !isReviewOnlyCandidate(candidate)) {
    return false;
  }

  return decision === "WATCH" || decision === "CHECK";
}
