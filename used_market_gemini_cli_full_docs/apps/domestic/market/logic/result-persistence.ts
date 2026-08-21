import type { MarketSnapshot, MergeResult, NormalizedResult } from "../../MCP/logic/types.js";
import { writeCentralResult } from "../../merge/logic/resultStore.js";

export interface PersistMarketWorkflowInput {
  keyword: string;
  normalizedResults: NormalizedResult[];
  mergedResult: MergeResult;
  marketSnapshot: MarketSnapshot;
}

export async function persistMarketWorkflowResult(input: PersistMarketWorkflowInput) {
  const stored = await writeCentralResult({
    module: "market",
    command: "full-workflow",
    payload: {
      keyword: input.keyword,
      normalized_results: input.normalizedResults,
      merged_result: input.mergedResult,
      market_snapshot: input.marketSnapshot
    },
    notes: [
      `keyword=${input.keyword}`,
      `normalized_sites=${input.normalizedResults.length}`,
      `merged_items=${input.mergedResult.merged_items.length}`,
      `snapshot_windows=${input.marketSnapshot.windows.length}`
    ],
    summary: {
      keyword: input.keyword,
      status: "success",
      normalized_sites: input.normalizedResults.length,
      merged_items: input.mergedResult.merged_items.length
    }
  });

  return stored;
}
