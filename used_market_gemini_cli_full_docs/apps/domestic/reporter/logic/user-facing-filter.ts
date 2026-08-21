import type { CandidateDecision } from "./decision.js";
import type { ReporterCandidate } from "./types.js";

export function isBuildListing(candidate: ReporterCandidate) {
  return candidate.listing_type === "full_pc" || candidate.listing_type === "semi_pc";
}

function isCommercialBuildRecommendation(candidate: ReporterCandidate) {
  if (!isBuildListing(candidate)) {
    return false;
  }

  const combinedText = `${candidate.title} ${candidate.detail_excerpt} ${candidate.detail_fetch_note}`;
  return /(?:\uCD08\uD2B9\uAC00|\uC778\uAE30\uAD6C\uC131|\uACAC\uC801\uAC00\uB2A5|\uAD6C\uB9E4\uAC00\uB2A5|\uB300\uD589\uC124\uCE58|\uB300\uD45C\uC0AC\uC9C4|\uC2DC\uAC01\uC801\uD6A8\uACFC|\uBCC0\uACBD\s*\uC2DC|\uBCC0\uACBD\uAC00\uB2A5|\uC2E0\uD488|\uC0C1\uC138\s*\uC2A4\uD399)/i.test(combinedText);
}

function countModelTokens(text: string) {
  const matches = text.match(
    /(rtx\s*\d{4}(?:\s*ti)?|rx\s*\d{4}(?:\s*xt)?|gtx\s*\d{3,4}|(?:ryzen|i[3579]|ultra)\s*[- ]?\d{0,2}[ ]?\d{4,5}[a-z0-9-]*|\b\d{4,5}(?:x3d|[fgkx])\b)/gi
  );
  return matches?.length ?? 0;
}

function countDistinctComponents(candidate: ReporterCandidate, componentType: string) {
  return new Set(
    candidate.components
      .filter((component) => component.component_type === componentType)
      .map((component) => component.canonical_name)
  ).size;
}

function hasMultiOptionBuild(candidate: ReporterCandidate) {
  return isBuildListing(candidate)
    && (
      countDistinctComponents(candidate, "cpu") > 1
      || countDistinctComponents(candidate, "gpu") > 1
      || countDistinctComponents(candidate, "motherboard") > 1
      || (countModelTokens(candidate.title) >= 4 && candidate.confirmed_component_count <= 4)
    );
}

function hasLowInformationBuild(candidate: ReporterCandidate) {
  return isBuildListing(candidate)
    && (
      (
        candidate.components.length === 0
        && candidate.detail_fetch_status !== "success"
        && candidate.unknown_component_types.length >= 5
      )
      || (
        candidate.component_priced_count <= 1
        && candidate.confirmed_component_count <= 1
        && candidate.unknown_component_types.length >= 5
      )
      || (
        candidate.valuation_mode === "build_bundle"
        && candidate.component_sum_price_30d !== null
        && candidate.price !== null
        && candidate.component_priced_count <= 2
        && candidate.unknown_component_types.length >= 4
        && candidate.price > candidate.component_sum_price_30d * 4
      )
      || (
        candidate.valuation_mode === "build_bundle"
        && candidate.component_priced_count <= 2
        && candidate.confirmed_component_count <= 2
        && candidate.unknown_component_types.length >= 4
      )
    );
}

function shouldShowInUserFacingTabs(candidate: ReporterCandidate) {
  if (!isBuildListing(candidate)) {
    return true;
  }

  if (isCommercialBuildRecommendation(candidate)) {
    return false;
  }

  if (hasLowInformationBuild(candidate)) {
    return false;
  }

  if (hasMultiOptionBuild(candidate)) {
    return false;
  }

  return true;
}

function parseRecommendationCandidateDate(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const parsed = new Date(`${trimmed}T00:00:00+09:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)) {
    const parsed = new Date(trimmed.replace(" ", "T") + "+09:00");
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getUserFacingRecommendationMaxAgeDays() {
  const parsed = Number(process.env.REPORTER_USER_FACING_MAX_AGE_DAYS ?? "30");
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 30;
}

export function getRecommendationFreshnessReferenceTime(candidates: ReporterCandidate[]) {
  const timestamps = candidates
    .map((candidate) =>
      parseRecommendationCandidateDate(candidate.posted_at)
      ?? parseRecommendationCandidateDate(candidate.last_seen_at)
      ?? parseRecommendationCandidateDate(candidate.first_seen_at)
    )
    .filter((value): value is Date => value !== null)
    .map((value) => value.getTime());

  if (timestamps.length === 0) {
    return null;
  }

  return Math.max(...timestamps);
}

export function isFreshEnoughForUserFacingRecommendation(candidate: ReporterCandidate, referenceTimeMs: number | null) {
  if (referenceTimeMs === null) {
    return true;
  }

  const candidateDate = parseRecommendationCandidateDate(candidate.posted_at)
    ?? parseRecommendationCandidateDate(candidate.last_seen_at)
    ?? parseRecommendationCandidateDate(candidate.first_seen_at);
  if (!candidateDate) {
    return true;
  }

  const maxAgeMs = getUserFacingRecommendationMaxAgeDays() * 24 * 60 * 60 * 1000;
  return referenceTimeMs - candidateDate.getTime() <= maxAgeMs;
}

export function getDisplayExpectedPrice(candidate: ReporterCandidate) {
  if (!isBuildListing(candidate)) {
    return candidate.market_price_30d;
  }

  return candidate.market_price_30d ?? candidate.component_sum_price_30d ?? candidate.part_reference_price_30d;
}

export function getDisplayGapPct(candidate: ReporterCandidate) {
  if (candidate.price_gap_to_market_30d_pct !== null) {
    return candidate.price_gap_to_market_30d_pct;
  }

  const expectedPrice = getDisplayExpectedPrice(candidate);
  if (candidate.price === null || expectedPrice === null || expectedPrice === 0) {
    return null;
  }

  return (expectedPrice - candidate.price) / expectedPrice;
}

export function buildGap30d(candidate: ReporterCandidate) {
  if (candidate.price_gap_to_market_30d !== null) {
    return candidate.price_gap_to_market_30d;
  }

  const expectedPrice = getDisplayExpectedPrice(candidate);
  if (candidate.price === null || expectedPrice === null) {
    return null;
  }

  return expectedPrice - candidate.price;
}

function isGenericSsdPartCandidate(candidate: ReporterCandidate) {
  return candidate.listing_type === "part"
    && candidate.primary_component_type === "ssd"
    && /^SSD (?:256GB|500GB|1TB|2TB)$/i.test(candidate.primary_component);
}

function isRiskySpecificSsdModel(componentName: string) {
  return /\b(?:pm991a|pm9a1)\b/i.test(componentName);
}

function isStableNamedSsdPartCandidate(candidate: ReporterCandidate) {
  if (candidate.listing_type !== "part" || candidate.primary_component_type !== "ssd") {
    return false;
  }

  if (isGenericSsdPartCandidate(candidate)) {
    return false;
  }

  if (isRiskySpecificSsdModel(candidate.primary_component)) {
    return false;
  }

  return candidate.market_reference_source_30d === "observed"
    && candidate.market_sample_30d >= 2
    && candidate.observed_day_count >= 2;
}

export function shouldIncludeUserFacingCandidate(
  candidate: ReporterCandidate,
  decision: CandidateDecision,
  freshnessReferenceTimeMs: number | null
) {
  if (decision === "PASS") {
    return false;
  }

  const gap30d = buildGap30d(candidate);
  if (gap30d === null || gap30d <= 0) {
    return false;
  }

  if (!isFreshEnoughForUserFacingRecommendation(candidate, freshnessReferenceTimeMs)) {
    return false;
  }

  if (candidate.primary_component_type === "ssd" && candidate.listing_type === "part") {
    return isStableNamedSsdPartCandidate(candidate);
  }

  if (isGenericSsdPartCandidate(candidate)) {
    return false;
  }

  if (!isBuildListing(candidate)) {
    return true;
  }

  return shouldShowInUserFacingTabs(candidate);
}
