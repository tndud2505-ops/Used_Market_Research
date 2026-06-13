import { MergeResultSchema, type MergeResult, type MergedItem, type NormalizedItem, type NormalizedResult } from "../../MCP/logic/types.js";
import { trace } from "../../MCP/logic/runtime-trace.js";
import { detectFraud } from "./fraud-detector.js";
import { calculateProfit } from "./profit-calculator.js";
import { analyzeLiquidity } from "./liquidity-analyzer.js";
import { analyzeDecomposition } from "./decompose-analyzer.js";
import { analyzeBottlenecks } from "./bottleneck-analyzer.js";
import { globalBlacklistManager } from "./model-blacklist.js";
import { annotateNoiseCandidate, isHardPruneNoiseReason } from "./noise-filter.js";
import { buildRamAwareComponentKey } from "./ram-brand.js";

function buildKey(item: NormalizedItem, keyword: string) {
  const listingScope = item.listing_type ?? "unknown";
  const componentKey = item.components.length > 0
    ? item.components
      .map((component) => (
        listingScope === "part"
          ? buildRamAwareComponentKey(component, item.title, item.raw_notes, item.detail_excerpt)
          : component.canonical_name
      ))
      .sort()
      .join(" + ")
    : keyword;
  return `${listingScope}:${componentKey}`;
}

function average(values: number[]) {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function mergeNormalizedResults(keyword: string, normalizedResults: NormalizedResult[]): MergeResult {
  trace("market.merge:start", { keyword, result_count: normalizedResults.length });
  const groupedPrices = new Map<string, number[]>();

  for (const result of normalizedResults) {
    for (const item of result.normalized_items) {
      const annotatedItem = annotateNoiseCandidate(item);
      if (isHardPruneNoiseReason((annotatedItem.noise_filter_reason || null) as Parameters<typeof isHardPruneNoiseReason>[0])) continue;
      if (annotatedItem.price_value === null) continue;
      if (annotatedItem.noise_filtered) continue;
      const key = buildKey(annotatedItem, keyword);
      if (!groupedPrices.has(key)) groupedPrices.set(key, []);
      groupedPrices.get(key)!.push(annotatedItem.price_value);
    }
  }

  const mergedItems: MergedItem[] = normalizedResults.flatMap((result) =>
    result.normalized_items.flatMap((item): MergedItem[] => {
      const basePrice = item.price_value ?? 0;
      const componentCount = item.components.length;
      const marginHint = componentCount >= 2 ? Math.round(basePrice * 0.12) : Math.round(basePrice * 0.05);

      const annotatedItem = annotateNoiseCandidate(item);
      if (isHardPruneNoiseReason((annotatedItem.noise_filter_reason || null) as Parameters<typeof isHardPruneNoiseReason>[0])) {
        return [];
      }

      if (annotatedItem.price_value === null) {
        return [{
          site: result.site,
          ...annotatedItem,
          margin_hint: null,
          score_hint: null,
          score_reason: "Price missing - unable to compare against baseline",
          baseline_price: null,
          deviation_rate: null,
          // New fields with defaults
          fraud_risk_score: 0.3,
          fraud_flags: ["Price not specified"],
          estimated_deal_price: null,
          net_profit: null,
          profit_margin: null,
          transaction_fee: 0,
          shipping_cost: 5000,
          repair_cost: 10000,
          similar_items_sold_7d: 0,
          estimated_days_to_sell: 14,
          demand_strength: "medium",
          as_is_price: null,
          decomposed_total: null,
          decompose_cost: 20000,
          decompose_recommendation: null,
          bottleneck_issues: [],
          price_impact: 0,
          model_status: "normal",
          confidence_penalty: 0
        }];
      }

      const key = buildKey(annotatedItem, keyword);
      const baselinePrice = annotatedItem.noise_filtered ? null : average(groupedPrices.get(key) ?? []);
      const deviationRate = baselinePrice && baselinePrice > 0
        ? Number(((baselinePrice - annotatedItem.price_value) / baselinePrice).toFixed(4))
        : null;
      const componentBonus = annotatedItem.listing_type === "full_pc" ? 5 : annotatedItem.listing_type === "semi_pc" ? 2 : 0;
      const scoreHint = baselinePrice === null
        ? 55 + componentBonus
        : Math.max(1, Math.min(100, Math.round(60 + (deviationRate ?? 0) * 100 + componentBonus)));

      const scoreReason = baselinePrice === null
        ? annotatedItem.noise_filtered
          ? `Noise-filtered listing (${annotatedItem.noise_filter_reason || "unknown"}) excluded from baseline comparison`
          : `No comparable baseline; fallback score from listing_type=${annotatedItem.listing_type}`
        : `Price ${annotatedItem.price_value} vs baseline ${baselinePrice} (${Math.round((deviationRate ?? 0) * 100)}% delta) with ${annotatedItem.listing_type} weighting`;

      // Merge base item
      const mergedItem = {
        site: result.site,
        ...annotatedItem,
        margin_hint: marginHint,
        score_hint: scoreHint,
        score_reason: scoreReason,
        baseline_price: baselinePrice,
        deviation_rate: deviationRate
      };

      // B. Fraud Detection
      const fraudResult = detectFraud(mergedItem, {
        baseline_price: baselinePrice,
        price_threshold_ratio: 1.2
      });

      // C. Net Profit Calculation
      const profitResult = calculateProfit(mergedItem, {
        transaction_fee_rate: 0.1,
        shipping_cost: 5000,
        repair_cost: 10000,
        resale_margin_rate: 0.15
      });

      // D. Liquidity Assessment
      const liquidityResult = analyzeLiquidity(mergedItem);

      // E. Full PC Decomposition
      const decomposeResult = analyzeDecomposition(mergedItem);

      // F. Bottleneck Analysis
      const bottleneckResult = analyzeBottlenecks(mergedItem);

      // K. Model Blacklist Check
      const blacklistResult = globalBlacklistManager.checkComponentModels(mergedItem);

      return [{
        ...mergedItem,
        // B. Fraud Detection
        fraud_risk_score: fraudResult.fraud_risk_score,
        fraud_flags: fraudResult.fraud_flags,
        // C. Net Profit
        estimated_deal_price: profitResult.estimated_deal_price,
        net_profit: profitResult.net_profit,
        profit_margin: profitResult.profit_margin,
        transaction_fee: profitResult.transaction_fee,
        shipping_cost: profitResult.shipping_cost,
        repair_cost: profitResult.repair_cost,
        // D. Liquidity
        similar_items_sold_7d: liquidityResult.similar_items_sold_7d,
        estimated_days_to_sell: liquidityResult.estimated_days_to_sell,
        demand_strength: liquidityResult.demand_strength,
        // E. Decomposition
        as_is_price: decomposeResult.as_is_price,
        decomposed_total: decomposeResult.decomposed_total,
        decompose_cost: decomposeResult.decompose_cost,
        decompose_recommendation: decomposeResult.decompose_recommendation,
        // F. Bottleneck
        bottleneck_issues: bottleneckResult.bottleneck_issues,
        price_impact: bottleneckResult.price_impact,
        // K. Model Blacklist
        model_status: blacklistResult.model_status,
        confidence_penalty: blacklistResult.confidence_penalty
      }];
    })
  ).sort((a, b) => (a.price_value ?? Number.MAX_SAFE_INTEGER) - (b.price_value ?? Number.MAX_SAFE_INTEGER));

  const result = MergeResultSchema.parse({ keyword, merged_items: mergedItems, errors: [] });
  trace("market.merge:complete", { keyword, merged_items: result.merged_items.length });
  return result;
}
