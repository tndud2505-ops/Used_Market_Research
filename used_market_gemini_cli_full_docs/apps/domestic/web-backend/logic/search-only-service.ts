import {
  buildHelloMarketSearchUrl,
  fetchHelloMarketSearch
} from '../../collector/logic/helloMarketProbe.js';
import {
  buildRethinkMallSearchUrl,
  fetchRethinkMallSearch
} from '../../collector/logic/rethinkmallProbe.js';
import {
  listSearchOnlySources,
  type SearchOnlySourceConfig,
  type SearchOnlySourceKey
} from '../../collector/logic/searchOnlySources.js';
// Shared source policy is authored as ESM JavaScript and enforced here so a
// legacy endpoint cannot bypass the same approval gate as the PC directory.
// @ts-ignore no declaration file for the canonical source registry
import { PC_SOURCE_REGISTRY } from '../../../collector/logic/pc-source-registry.mjs';

const MAX_KEYWORD_LENGTH = 80;
const OPERATIONAL_SEARCH_ONLY_KEYS = new Set(
  (PC_SOURCE_REGISTRY as Array<Record<string, unknown>>)
    .filter((source) => source.public_search === true
      && source.policy_status === 'APPROVED'
      && source.runtime_status === 'ENABLED')
    .map((source) => String(source.key))
);

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1] + sorted[middle]) / 2)
    : sorted[middle];
}

function buildSearchOnlySummary(items: Array<Record<string, unknown>>) {
  const prices = items
    .map((item) => typeof item.price === 'number' ? item.price : item.sale_price)
    .filter((price): price is number => typeof price === 'number' && price > 0);
  return {
    item_count: items.length,
    priced_item_count: prices.length,
    currency: prices.length > 0 && items.every((item) => !item.currency || item.currency === 'KRW') ? 'KRW' : null,
    median_price: median(prices),
    average_price: prices.length > 0 ? Math.round(prices.reduce((sum, price) => sum + price, 0) / prices.length) : null,
    lowest_price: prices.length > 0 ? Math.min(...prices) : null,
    highest_price: prices.length > 0 ? Math.max(...prices) : null
  };
}

export class SearchOnlyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SearchOnlyValidationError';
  }
}

function findSource(sourceKey: string): SearchOnlySourceConfig | null {
  return listSearchOnlySources().find((source) => source.key === sourceKey) ?? null;
}

export function validateSearchOnlyRequest(input: Record<string, unknown>) {
  const sourceKey = typeof input.source === 'string' ? input.source.trim() : '';
  const source = sourceKey ? findSource(sourceKey) : null;
  if (!source) {
    throw new SearchOnlyValidationError('source must be one of: hellomarket, rethinkmall');
  }
  if (!OPERATIONAL_SEARCH_ONLY_KEYS.has(source.key)) {
    throw new SearchOnlyValidationError(`source is not approved for live collection: ${source.key}`);
  }

  const keyword = typeof input.keyword === 'string' ? input.keyword.trim() : '';
  if (!keyword || keyword.length > MAX_KEYWORD_LENGTH) {
    throw new SearchOnlyValidationError(`keyword must be between 1 and ${MAX_KEYWORD_LENGTH} characters`);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'limit') || Object.prototype.hasOwnProperty.call(input, 'cursor')) {
    throw new SearchOnlyValidationError('search-only sources do not provide a stable pagination cursor; open the original search link for more results');
  }

  return {
    source,
    sourceKey: source.key,
    keyword
  };
}

function buildRequestedUrl(sourceKey: SearchOnlySourceKey, keyword: string) {
  return sourceKey === 'hellomarket'
    ? buildHelloMarketSearchUrl(keyword)
    : buildRethinkMallSearchUrl(keyword);
}

function unavailableData(
  source: SearchOnlySourceConfig,
  sourceKey: SearchOnlySourceKey,
  keyword: string,
  error: unknown
) {
  const reason = error instanceof Error ? error.message : String(error);
  return {
    source,
    source_key: sourceKey,
    keyword,
    requested_url: buildRequestedUrl(sourceKey, keyword),
    response_url: '',
    reported_count: null,
    raw_items: [],
    items: [],
    relevant_items: [],
    pagination: { has_more: false, next_cursor: null },
    category_summary: [],
    uncategorized_count: 0,
    validation: {
      status: 'warn' as const,
      extracted_count: 0,
      structurally_valid_count: 0,
      relevant_count: 0,
      active_relevant_count: 0,
      relevance_rate: 0,
      duplicate_count: 0,
      missing_field_count: 0,
      warnings: ['SEARCH_ONLY_SOURCE_UNAVAILABLE'],
      errors: [`SEARCH_ONLY_SOURCE_UNAVAILABLE: ${reason}`]
    },
    state: 'unavailable' as const
  };
}

export async function runSearchOnly(input: Record<string, unknown>) {
  const request = validateSearchOnlyRequest(input);

  try {
    const result = request.sourceKey === 'hellomarket'
      ? await fetchHelloMarketSearch(request.keyword)
      : await fetchRethinkMallSearch(request.keyword);
    const {
      source: _probeSource,
      items: rawItems,
      relevant_items: relevantItems,
      ...probeData
    } = result;
    return {
      status: result.validation.status === 'pass' ? 'success' as const : 'warning' as const,
      data: {
        source: request.source,
        source_key: request.sourceKey,
        state: result.validation.status === 'pass' ? 'ready' as const : 'partial' as const,
        raw_items: rawItems,
        items: relevantItems,
        relevant_items: relevantItems,
        pagination: { has_more: false, next_cursor: null },
        summary: buildSearchOnlySummary(relevantItems as unknown as Array<Record<string, unknown>>),
        ...probeData
      }
    };
  } catch (error) {
    return {
      status: 'warning' as const,
      data: unavailableData(request.source, request.sourceKey, request.keyword, error)
    };
  }
}

export function listSearchOnlySourceCatalog() {
  return {
    sources: listSearchOnlySources().filter((source) => OPERATIONAL_SEARCH_ONLY_KEYS.has(source.key)),
    mode: 'search_only' as const,
    note: '메인 검색에 통합되어 있으며, 공식 카테고리 ID 대신 명시 검색어와 결과 분류 필터를 사용합니다.'
  };
}
