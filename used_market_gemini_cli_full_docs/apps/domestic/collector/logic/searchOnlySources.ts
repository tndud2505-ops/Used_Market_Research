import {
  fetchHelloMarketSearch,
  type HelloMarketProbeResult
} from "./helloMarketProbe.js";
import {
  fetchRethinkMallSearch,
  type RethinkMallProbeResult
} from "./rethinkmallProbe.js";
import { listSearchOnlyCategoryRules } from "./searchOnlyCategoryClassifier.js";
import type { CanonicalCategoryId } from "../../market/logic/category-catalog.js";

export type SearchOnlySourceKey = "hellomarket" | "rethinkmall";

export interface SearchOnlySourceConfig {
  key: SearchOnlySourceKey;
  name: string;
  market_kind: "used_market" | "refurb_retail";
  login_required: boolean;
  ui_registered: true;
  main_search_registered: true;
  category_mode: "keyword_inferred";
  classifiable_category_ids: CanonicalCategoryId[];
}

const CLASSIFIABLE_CATEGORY_IDS = listSearchOnlyCategoryRules();

const SEARCH_ONLY_SOURCES: SearchOnlySourceConfig[] = [
  {
    key: "hellomarket",
    name: "헬로마켓",
    market_kind: "used_market",
    login_required: false,
    ui_registered: true,
    main_search_registered: true,
    category_mode: "keyword_inferred",
    classifiable_category_ids: CLASSIFIABLE_CATEGORY_IDS
  },
  {
    key: "rethinkmall",
    name: "리씽크몰",
    market_kind: "refurb_retail",
    login_required: false,
    ui_registered: true,
    main_search_registered: true,
    category_mode: "keyword_inferred",
    classifiable_category_ids: CLASSIFIABLE_CATEGORY_IDS
  }
];

export type SearchOnlyProbeResult = HelloMarketProbeResult | RethinkMallProbeResult;

export function listSearchOnlySources(): SearchOnlySourceConfig[] {
  return SEARCH_ONLY_SOURCES.map((source) => ({
    ...source,
    classifiable_category_ids: [...source.classifiable_category_ids]
  }));
}

export async function fetchSearchOnlySource(
  sourceKey: SearchOnlySourceKey,
  keyword: string,
  options: { settleMs?: number } = {}
): Promise<SearchOnlyProbeResult> {
  if (sourceKey === "hellomarket") {
    return await fetchHelloMarketSearch(keyword, options);
  }
  return await fetchRethinkMallSearch(keyword, options);
}
