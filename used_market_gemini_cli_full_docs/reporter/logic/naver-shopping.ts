import type { ReporterBuildComponentPrice, ReporterCandidate } from "./types.js";
import { buildManualPriceSeedDataset } from "../../market/logic/manual-price-seed.js";

type NaverShoppingItem = {
  title?: string;
  lprice?: string;
  mallName?: string;
  maker?: string;
  brand?: string;
  category1?: string;
  category2?: string;
  category3?: string;
  category4?: string;
  productType?: string;
};

type NaverShoppingResponse = {
  items?: NaverShoppingItem[];
};

type RetailLookup = {
  price: number | null;
  query: string;
};

const RETAIL_SANITY_MANUAL_LOOKUP = new Map(
  buildManualPriceSeedDataset().windows
    .filter((window) => window.listing_scope === "part" && window.window_days === 30 && window.average_price !== null)
    .map((window) => [`${window.component_type}:${window.component_key}`, window.average_price ?? null])
);

function readNaverCredentials() {
  const clientId = process.env.NAVER_OPENAPI_CLIENT_ID ?? process.env.NAVER_CLIENT_ID ?? "";
  const clientSecret = process.env.NAVER_OPENAPI_CLIENT_SECRET ?? process.env.NAVER_CLIENT_SECRET ?? "";
  return {
    clientId: clientId.trim(),
    clientSecret: clientSecret.trim()
  };
}

function stripHtmlTags(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeSearchTokens(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .filter((token) => !["nvidia", "amd", "intel", "geforce", "radeon"].includes(token));
}

function scoreShoppingItem(item: NaverShoppingItem, query: string) {
  const title = stripHtmlTags(item.title ?? "").toLowerCase();
  const tokens = normalizeSearchTokens(query);
  const matchedCount = tokens.filter((token) => title.includes(token)).length;
  const categories = [
    item.category1,
    item.category2,
    item.category3,
    item.category4
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLowerCase();

  let score = matchedCount * 10;
  if (tokens.length > 0 && matchedCount === tokens.length) {
    score += 20;
  }

  if (/(컴퓨터|pc|주변기기|메모리|그래픽카드|cpu|메인보드|저장장치)/i.test(categories)) {
    score += 5;
  }

  if (/(외장|portable|passport|elements|케이스\s*포함|노트북|laptop)/i.test(title)) {
    score -= 12;
  }

  return score;
}

function parseLowestPrice(value: string | undefined) {
  if (!value) return null;
  const parsed = Number(value.replace(/[^\d]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function isRetailPricePlausible(componentType: string, canonicalName: string, retailPrice: number | null) {
  if (retailPrice === null || retailPrice <= 0) {
    return false;
  }

  const manualReferencePrice = RETAIL_SANITY_MANUAL_LOOKUP.get(`${componentType}:${canonicalName}`) ?? null;
  if (manualReferencePrice === null || manualReferencePrice <= 0) {
    return true;
  }

  return retailPrice >= Math.round(manualReferencePrice * 0.35);
}

function isRetailEligible(componentType: string, canonicalName: string) {
  if (!canonicalName || /\bunknown\b/i.test(canonicalName)) {
    return false;
  }

  if (componentType === "cpu" || componentType === "gpu") {
    return true;
  }

  if (componentType === "ram") {
    return /ddr\d/i.test(canonicalName);
  }

  if (componentType === "motherboard") {
    return true;
  }

  if (componentType === "ssd") {
    return !/^ssd\s+\d/i.test(canonicalName.toLowerCase());
  }

  return false;
}

function toRetailQuery(componentType: string, canonicalName: string) {
  if (!isRetailEligible(componentType, canonicalName)) {
    return null;
  }

  if (componentType === "gpu") {
    return canonicalName
      .replace(/^NVIDIA\s+/i, "")
      .replace(/^AMD\s+Radeon\s+/i, "Radeon ");
  }

  return canonicalName;
}

async function fetchNaverShoppingLowestPrice(query: string): Promise<number | null> {
  const credentials = readNaverCredentials();
  if (!credentials.clientId || !credentials.clientSecret) {
    return null;
  }

  const url = new URL("https://openapi.naver.com/v1/search/shop.json");
  url.searchParams.set("query", query);
  url.searchParams.set("display", "15");
  url.searchParams.set("sort", "asc");
  url.searchParams.set("exclude", "used:rental:cbshop");

  const response = await fetch(url, {
    headers: {
      "X-Naver-Client-Id": credentials.clientId,
      "X-Naver-Client-Secret": credentials.clientSecret,
      accept: "application/json"
    }
  });

  if (!response.ok) {
    return null;
  }

  const payload = await response.json() as NaverShoppingResponse;
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (items.length === 0) {
    return null;
  }

  const ranked = items
    .map((item) => ({
      item,
      price: parseLowestPrice(item.lprice),
      score: scoreShoppingItem(item, query)
    }))
    .filter((entry) => entry.price !== null)
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }
      return (left.price ?? Number.MAX_SAFE_INTEGER) - (right.price ?? Number.MAX_SAFE_INTEGER);
    });

  return ranked[0]?.price ?? null;
}

function buildPartRetailCandidate(componentType: string, canonicalName: string): RetailLookup | null {
  const query = toRetailQuery(componentType, canonicalName);
  if (!query) {
    return null;
  }

  return {
    query,
    price: null
  };
}

function getRetailComponents(candidate: ReporterCandidate) {
  if (candidate.listing_type === "part") {
    const retailCandidate = buildPartRetailCandidate(candidate.primary_component_type, candidate.primary_component);
    return retailCandidate
      ? [{ component_type: candidate.primary_component_type, canonical_name: candidate.primary_component, query: retailCandidate.query }]
      : [];
  }

  return candidate.component_price_breakdown
    .map((entry: ReporterBuildComponentPrice) => {
      const query = toRetailQuery(entry.component_type, entry.canonical_name);
      return query
        ? { component_type: entry.component_type, canonical_name: entry.canonical_name, query }
        : null;
    })
    .filter((entry): entry is { component_type: string; canonical_name: string; query: string } => entry !== null);
}

function applyRetailReference(
  candidate: ReporterCandidate,
  queryPriceMap: Map<string, number | null>
): ReporterCandidate {
  const retailComponents = getRetailComponents(candidate);
  const prices = retailComponents
    .map((entry) => ({
      ...entry,
      price: queryPriceMap.get(entry.query) ?? null
    }))
    .filter((entry) => isRetailPricePlausible(entry.component_type, entry.canonical_name, entry.price));

  const retailPrice = prices.length > 0
    ? prices.reduce((sum, entry) => sum + (entry.price ?? 0), 0)
    : null;

  return {
    ...candidate,
    retail_reference_price: retailPrice,
    retail_reference_source: retailPrice !== null ? "naver_shop" : "missing",
    retail_priced_count: prices.length,
    retail_total_count: retailComponents.length,
    retail_price_gap: candidate.price !== null && retailPrice !== null
      ? retailPrice - candidate.price
      : null,
    retail_price_ratio: candidate.price !== null && retailPrice !== null && retailPrice > 0
      ? Number((candidate.price / retailPrice).toFixed(4))
      : null
  };
}

export async function enrichCandidatesWithNaverRetail(
  candidates: ReporterCandidate[]
): Promise<ReporterCandidate[]> {
  const credentials = readNaverCredentials();
  if (!credentials.clientId || !credentials.clientSecret || candidates.length === 0) {
    return candidates;
  }

  const uniqueQueries = new Set<string>();
  for (const candidate of candidates) {
    for (const component of getRetailComponents(candidate)) {
      uniqueQueries.add(component.query);
    }
  }

  const queryPriceMap = new Map<string, number | null>();
  for (const query of uniqueQueries) {
    queryPriceMap.set(query, await fetchNaverShoppingLowestPrice(query));
  }

  return candidates.map((candidate) => applyRetailReference(candidate, queryPriceMap));
}
