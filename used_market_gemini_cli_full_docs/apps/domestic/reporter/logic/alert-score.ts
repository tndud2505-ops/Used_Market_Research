import type { ReporterAlertScoreBreakdown, ReporterCandidate } from "./types.js";

interface AlertScoreContext {
  now?: Date;
  recentFingerprints?: Set<string>;
  sellerCounts?: ReadonlyMap<string, number>;
  titleCounts?: ReadonlyMap<string, number>;
  componentCounts?: ReadonlyMap<string, number>;
}

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeAlertText(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizeSellerKey(candidate: ReporterCandidate) {
  return `${candidate.site}:${normalizeAlertText(candidate.seller || "unknown-seller")}`;
}

function normalizePrimaryComponentKey(candidate: ReporterCandidate) {
  const component = candidate.primary_component || candidate.primary_component_type || candidate.listing_type;
  return `${candidate.primary_component_type}:${normalizeAlertText(component)}`;
}

function toPriceBand(price: number | null) {
  if (price === null || !Number.isFinite(price)) return "na";
  return String(Math.round(price / 10_000) * 10_000);
}

function parseCandidateTimestamp(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? `${trimmed}T00:00:00+09:00`
    : /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)
      ? trimmed.replace(" ", "T") + "+09:00"
      : trimmed;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getCandidateAgeHours(candidate: ReporterCandidate, now: Date) {
  const timestamps = [
    candidate.posted_at,
    candidate.last_seen_at,
    candidate.first_seen_at
  ]
    .map((value) => parseCandidateTimestamp(value))
    .filter((value): value is Date => value !== null)
    .sort((left, right) => left.getTime() - right.getTime());

  if (timestamps.length === 0) return null;
  return Math.max(0, (now.getTime() - timestamps[0].getTime()) / (60 * 60 * 1000));
}

function computeEdgeScore(candidate: ReporterCandidate) {
  const gapPct = candidate.price_gap_to_market_30d_pct ?? candidate.deviation_rate ?? 0;
  return clamp(gapPct / 0.25);
}

function computeConfidenceScore(candidate: ReporterCandidate) {
  let score = candidate.listing_type === "part" ? 0.58 : 0.38;

  if (candidate.detail_fetch_status === "success") {
    score += 0.18;
  }

  if (candidate.confirmed_component_count >= 4) {
    score += 0.18;
  } else if (candidate.confirmed_component_count >= 2) {
    score += 0.12;
  } else if (candidate.confirmed_component_count >= 1) {
    score += 0.06;
  }

  if (candidate.listing_type === "part") {
    score += candidate.primary_component ? 0.1 : 0;
  } else {
    score += clamp(candidate.component_coverage_ratio, 0, 1) * 0.2;
  }

  score -= Math.min(0.36, candidate.unknown_component_types.length * 0.09);
  score -= clamp(candidate.confidence_penalty, 0, 0.45);

  if ((candidate.review_flags ?? []).length > 0) {
    score -= 0.1;
  }

  if (
    candidate.listing_type !== "part"
    && candidate.valuation_mode === "build_bundle"
    && candidate.confirmed_component_count === 0
  ) {
    score -= 0.12;
  }

  return clamp(score, 0.05, 1);
}

function computeFreshnessScore(candidate: ReporterCandidate, now: Date) {
  const ageHours = getCandidateAgeHours(candidate, now);
  if (ageHours === null) return 0.55;
  if (ageHours <= 6) return 1;
  if (ageHours <= 24) return 0.88;
  if (ageHours <= 48) return 0.7;
  if (ageHours <= 72) return 0.52;
  if (ageHours <= 120) return 0.34;
  return 0.18;
}

function computeLiquidityScore(candidate: ReporterCandidate) {
  const demandScore = candidate.demand_strength === "high"
    ? 1
    : candidate.demand_strength === "medium"
      ? 0.78
      : 0.55;
  const speedScore = candidate.estimated_days_to_sell <= 0
    ? 0.45
    : candidate.estimated_days_to_sell <= 7
      ? 1
      : candidate.estimated_days_to_sell <= 14
        ? 0.86
        : candidate.estimated_days_to_sell <= 21
          ? 0.72
          : candidate.estimated_days_to_sell <= 30
            ? 0.56
            : 0.38;
  const sampleScore = candidate.market_sample_30d >= 12
    ? 1
    : candidate.market_sample_30d >= 6
      ? 0.86
      : candidate.market_sample_30d >= 3
        ? 0.72
        : candidate.market_sample_30d >= 1
          ? 0.56
          : 0.4;
  const observedScore = candidate.observed_day_count >= 5
    ? 1
    : candidate.observed_day_count >= 3
      ? 0.84
      : candidate.observed_day_count >= 2
        ? 0.7
        : candidate.observed_day_count >= 1
          ? 0.54
          : 0.38;

  return clamp((demandScore * 0.3) + (speedScore * 0.3) + (sampleScore * 0.2) + (observedScore * 0.2), 0.1, 1);
}

function computeUniquenessScore(
  candidate: ReporterCandidate,
  fingerprint: string,
  normalizedTitle: string,
  context: AlertScoreContext
) {
  let score = 1;
  const sellerKey = normalizeSellerKey(candidate);
  const componentKey = normalizePrimaryComponentKey(candidate);
  const sellerCount = context.sellerCounts?.get(sellerKey) ?? 0;
  const titleCount = context.titleCounts?.get(normalizedTitle) ?? 0;
  const componentCount = context.componentCounts?.get(componentKey) ?? 0;

  if (sellerCount > 1) {
    score *= 0.72 ** (sellerCount - 1);
  }

  if (titleCount > 1) {
    score *= 0.5 ** (titleCount - 1);
  }

  if (componentCount > 1) {
    score *= 0.82 ** (componentCount - 1);
  }

  if (candidate.observed_day_count <= 1) {
    score *= 0.72;
  }

  if (context.recentFingerprints?.has(fingerprint)) {
    score *= 0.28;
  }

  return clamp(score, 0.08, 1);
}

export function buildCandidateAlertFingerprint(candidate: ReporterCandidate) {
  const normalizedTitle = normalizeAlertText(candidate.title);
  return [
    normalizeSellerKey(candidate),
    normalizedTitle,
    toPriceBand(candidate.price),
    normalizePrimaryComponentKey(candidate)
  ].join("|");
}

export function buildAlertScoreBreakdown(
  candidate: ReporterCandidate,
  context: AlertScoreContext = {}
): ReporterAlertScoreBreakdown {
  const now = context.now ?? new Date();
  const normalizedTitle = normalizeAlertText(candidate.title);
  const fingerprint = buildCandidateAlertFingerprint(candidate);
  const edge = computeEdgeScore(candidate);
  const confidence = computeConfidenceScore(candidate);
  const freshness = computeFreshnessScore(candidate, now);
  const liquidity = computeLiquidityScore(candidate);
  const uniqueness = computeUniquenessScore(candidate, fingerprint, normalizedTitle, context);
  const score = Number((100 * edge * confidence * freshness * liquidity * uniqueness).toFixed(2));

  return {
    score,
    edge,
    confidence,
    freshness,
    liquidity,
    uniqueness,
    fingerprint,
    normalized_title: normalizedTitle
  };
}
