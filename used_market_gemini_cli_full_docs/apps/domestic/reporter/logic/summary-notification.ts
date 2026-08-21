import { buildAlertScoreBreakdown } from "./alert-score.js";
import { decisionRank } from "./decision.js";
import type {
  ReporterAlertScoreBreakdown,
  ReporterCandidate,
  ReporterConfig,
  ReporterDispatchCandidate,
  ReporterRecommendationSummaryResult
} from "./types.js";
import {
  getRecommendationFreshnessReferenceTime,
  shouldIncludeUserFacingCandidate
} from "./user-facing-filter.js";

interface SummaryEntry {
  candidate: ReporterCandidate;
  decision: ReporterDispatchCandidate["decision"];
  expectedPrice: number | null;
  gapAmount: number | null;
  gapPct: number | null;
  breakdown: ReporterAlertScoreBreakdown;
}

function isBuildListing(candidate: ReporterCandidate) {
  return candidate.listing_type === "full_pc" || candidate.listing_type === "semi_pc";
}

function formatWon(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "n/a";
  return `${new Intl.NumberFormat("ko-KR").format(Math.round(value))}\uC6D0`;
}

function formatPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "n/a";
  return `${(value * 100).toFixed(1)}%`;
}

function buildEvidenceLine(candidate: ReporterCandidate) {
  const priority = ["cpu", "gpu", "ram", "ssd", "motherboard", "psu"];
  const parts: string[] = [];
  for (const componentType of priority) {
    const match = candidate.component_price_breakdown.find((entry) => entry.component_type === componentType);
    if (!match?.canonical_name) continue;
    const label = componentType.toUpperCase();
    const price = formatWon(match.price_30d);
    parts.push(`${label} ${match.canonical_name}${match.price_30d !== null ? ` ${price}` : ""}`);
  }

  if (parts.length === 0 && candidate.primary_component) {
    parts.push(`${candidate.primary_component_type.toUpperCase()} ${candidate.primary_component}`);
  }

  return parts.slice(0, 4).join(" / ");
}

function buildRiskLine(candidate: ReporterCandidate) {
  const parts: string[] = [];

  if (candidate.unknown_component_types.length > 0) {
    parts.push(`\uBBF8\uD655\uC778 ${candidate.unknown_component_types.slice(0, 3).join(", ")}`);
  }

  if (candidate.bottleneck_issues.length > 0) {
    parts.push(candidate.bottleneck_issues.slice(0, 2).join(", "));
  }

  if ((candidate.review_flags ?? []).length > 0) {
    parts.push((candidate.review_flags ?? []).slice(0, 2).join(", "));
  }

  if (candidate.observed_day_count <= 1) {
    parts.push(`history ${candidate.observed_day_count}\uC77C`);
  }

  return parts.length > 0 ? parts.join(" | ") : null;
}

function getExpectedPrice(candidate: ReporterCandidate) {
  if (candidate.listing_type === "part") {
    return candidate.market_price_30d ?? candidate.part_reference_price_30d ?? candidate.baseline_price;
  }

  return candidate.market_price_30d
    ?? candidate.component_sum_price_30d
    ?? candidate.part_reference_price_30d
    ?? candidate.baseline_price;
}

function createCountMap(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function getSellerKey(candidate: ReporterCandidate) {
  return `${candidate.site}:${candidate.seller.trim().toLowerCase()}`;
}

function getComponentKey(candidate: ReporterCandidate) {
  return `${candidate.primary_component_type}:${candidate.primary_component.trim().toLowerCase()}`;
}

function buildSummaryEntries(candidates: ReporterDispatchCandidate[]) {
  const sellerCounts = createCountMap(candidates.map(({ candidate }) => getSellerKey(candidate)));
  const titleCounts = createCountMap(candidates.map(({ fingerprint }) => fingerprint.split("|")[1] ?? ""));
  const componentCounts = createCountMap(candidates.map(({ candidate }) => getComponentKey(candidate)));

  return candidates
    .map(({ candidate, decision, fingerprint }) => {
      const expectedPrice = getExpectedPrice(candidate);
      const gapAmount = candidate.price_gap_to_market_30d
        ?? (
          candidate.price !== null && expectedPrice !== null
            ? expectedPrice - candidate.price
            : null
        );
      const gapPct = candidate.price_gap_to_market_30d_pct
        ?? (
          candidate.price !== null && expectedPrice !== null && expectedPrice > 0
            ? (expectedPrice - candidate.price) / expectedPrice
            : null
        );
      const breakdown = buildAlertScoreBreakdown(candidate, {
        sellerCounts,
        titleCounts,
        componentCounts,
        recentFingerprints: new Set<string>(),
        now: new Date()
      });

      return {
        candidate,
        decision,
        expectedPrice,
        gapAmount,
        gapPct,
        breakdown: {
          ...breakdown,
          fingerprint
        }
      } satisfies SummaryEntry;
    })
    .sort((left, right) => {
      if (right.breakdown.score !== left.breakdown.score) {
        return right.breakdown.score - left.breakdown.score;
      }

      const decisionDiff = decisionRank(left.decision) - decisionRank(right.decision);
      if (decisionDiff !== 0) return decisionDiff;

      const buildBias = Number(isBuildListing(right.candidate)) - Number(isBuildListing(left.candidate));
      if (buildBias !== 0) return buildBias;

      const rightGap = right.gapAmount ?? Number.NEGATIVE_INFINITY;
      const leftGap = left.gapAmount ?? Number.NEGATIVE_INFINITY;
      if (rightGap !== leftGap) return rightGap - leftGap;

      return (right.candidate.score_hint ?? 0) - (left.candidate.score_hint ?? 0);
    });
}

function selectDiverseEntries(entries: SummaryEntry[], maxItems: number) {
  const selected: SummaryEntry[] = [];
  const deferred: SummaryEntry[] = [];
  const sellerCounts = new Map<string, number>();
  const titleCounts = new Map<string, number>();
  const componentCounts = new Map<string, number>();
  let selectedPartCount = 0;

  for (const entry of entries) {
    const sellerKey = getSellerKey(entry.candidate);
    const titleKey = entry.breakdown.normalized_title;
    const componentKey = getComponentKey(entry.candidate);
    const isPart = entry.candidate.listing_type === "part";

    const violatesStrictCap = (
      (sellerCounts.get(sellerKey) ?? 0) >= 1
      || (titleCounts.get(titleKey) ?? 0) >= 1
      || (componentCounts.get(componentKey) ?? 0) >= 1
      || (isPart && selectedPartCount >= 2)
    );

    if (violatesStrictCap) {
      deferred.push(entry);
      continue;
    }

    selected.push(entry);
    sellerCounts.set(sellerKey, (sellerCounts.get(sellerKey) ?? 0) + 1);
    titleCounts.set(titleKey, (titleCounts.get(titleKey) ?? 0) + 1);
    componentCounts.set(componentKey, (componentCounts.get(componentKey) ?? 0) + 1);
    if (isPart) {
      selectedPartCount += 1;
    }

    if (selected.length >= maxItems) {
      return selected;
    }
  }

  for (const entry of deferred) {
    if (selected.length >= maxItems) break;

    const sellerKey = getSellerKey(entry.candidate);
    const titleKey = entry.breakdown.normalized_title;
    if ((sellerCounts.get(sellerKey) ?? 0) >= 1 || (titleCounts.get(titleKey) ?? 0) >= 1) {
      continue;
    }

    selected.push(entry);
    sellerCounts.set(sellerKey, (sellerCounts.get(sellerKey) ?? 0) + 1);
    titleCounts.set(titleKey, (titleCounts.get(titleKey) ?? 0) + 1);
  }

  return selected;
}

function buildSummaryText(sourceRunId: string | undefined, candidates: ReporterDispatchCandidate[], maxItems: number) {
  const freshnessReferenceTimeMs = getRecommendationFreshnessReferenceTime(candidates.map(({ candidate }) => candidate));
  const filteredCandidates = candidates.filter(({ candidate, decision }) =>
    shouldIncludeUserFacingCandidate(candidate, decision, freshnessReferenceTimeMs)
  );
  const entries = buildSummaryEntries(filteredCandidates);
  const selected = selectDiverseEntries(entries, maxItems);
  const buildCount = entries.filter((entry) => isBuildListing(entry.candidate)).length;
  const partCount = entries.filter((entry) => entry.candidate.listing_type === "part").length;

  const lines = [
    `[\uC911\uACE0 \uCD94\uCC9C \uC694\uC57D] ${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}`,
    `run: ${sourceRunId ?? "unknown"}`,
    `actionable ${entries.length}\uAC74 (\uBCF8\uCCB4 ${buildCount} / \uBD80\uD488 ${partCount})`
  ];

  selected.forEach((entry, index) => {
    const { candidate, breakdown } = entry;
    const riskLine = buildRiskLine(candidate);

    lines.push(
      "",
      `${index + 1}. [${entry.decision}] ${candidate.title}`,
      `- \uAC00\uACA9: ${formatWon(candidate.price)} | \uAE30\uC900: ${formatWon(entry.expectedPrice)} | \uCC28\uC561: ${formatWon(entry.gapAmount)} (${formatPercent(entry.gapPct)})`,
      `- alert_score: ${breakdown.score.toFixed(2)} | edge ${breakdown.edge.toFixed(2)} | confidence ${breakdown.confidence.toFixed(2)} | freshness ${breakdown.freshness.toFixed(2)} | liquidity ${breakdown.liquidity.toFixed(2)} | uniqueness ${breakdown.uniqueness.toFixed(2)}`,
      `- \uADFC\uAC70: ${buildEvidenceLine(candidate) || "\uADFC\uAC70 \uC5C6\uC74C"}`,
      riskLine ? `- \uC8FC\uC758: ${riskLine}` : `- \uC0C1\uD0DC: observed ${candidate.observed_day_count}\uC77C | demand ${candidate.demand_strength}`,
      `- URL: ${candidate.url}`
    );
  });

  if (entries.length > selected.length) {
    lines.push("", `+${entries.length - selected.length}\uAC74\uC740 \uB2E4\uC591\uC131 cap \uB54C\uBB38\uC5D0 \uC694\uC57D\uC5D0\uC11C \uC81C\uC678`);
  }

  return {
    text: lines.join("\n").slice(0, 1900),
    itemCount: entries.length
  };
}

function buildWebhookBody(webhookUrl: string, text: string, sourceRunId: string | undefined, itemCount: number) {
  if (/discord(?:app)?\.com\/api\/webhooks/i.test(webhookUrl)) {
    return {
      content: text
    };
  }

  return {
    text,
    source_run_id: sourceRunId,
    item_count: itemCount,
    generated_at: new Date().toISOString()
  };
}

export async function dispatchRecommendationSummary(
  config: ReporterConfig,
  sourceRunId: string | undefined,
  candidates: ReporterDispatchCandidate[]
): Promise<ReporterRecommendationSummaryResult> {
  if (!config.summaryEnabled) {
    return {
      attempted: false,
      sent: false,
      item_count: 0,
      reason: "summary_disabled"
    };
  }

  if (!config.summaryWebhookUrl) {
    return {
      attempted: true,
      sent: false,
      item_count: 0,
      reason: "missing REPORTER_SUMMARY_WEBHOOK_URL"
    };
  }

  if (candidates.length === 0) {
    return {
      attempted: false,
      sent: false,
      item_count: 0,
      reason: "no_post_gating_candidates"
    };
  }

  const summary = buildSummaryText(sourceRunId, candidates, config.summaryMaxItems);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(config.summaryWebhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildWebhookBody(config.summaryWebhookUrl, summary.text, sourceRunId, summary.itemCount)),
      signal: controller.signal
    });

    if (!response.ok) {
      return {
        attempted: true,
        sent: false,
        item_count: summary.itemCount,
        reason: `summary_webhook_http_${response.status}`,
        response_code: response.status
      };
    }

    return {
      attempted: true,
      sent: true,
      item_count: summary.itemCount,
      response_code: response.status
    };
  } catch (error) {
    return {
      attempted: true,
      sent: false,
      item_count: summary.itemCount,
      reason: error instanceof Error ? error.message : String(error)
    };
  } finally {
    clearTimeout(timeout);
  }
}
