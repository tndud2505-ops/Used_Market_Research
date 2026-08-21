import { listSupportedSites, resolveSite } from '../../collector/logic/sites.js';
import { resolveBrowserSiteAdapter } from '../../collector/logic/sites/index.js';
import { Orchestrator } from '../../MCP/logic/orchestrator.js';
import { MockProvider } from '../../MCP/logic/mockProvider.js';
import { getPriceHistory } from './price-history-service.js';
import { getSourceCategoryBinding, isCategorySelectableForSite, resolveCategory } from '../../market/logic/category-catalog.js';
import { deriveCollectionState } from '../../MCP/logic/collection-state.js';
import { WEB_BACKEND_CONFIG } from './config.js';

export interface WebSearchRequest {
  keyword?: string;
  category_id?: string;
  category_ids?: string[];
  sites?: string[];
  limit?: number;
  cursor?: string;
  sort?: SearchSort;
  min_price?: number;
  max_price?: number;
  refresh_index?: boolean;
}

export type SearchSort = 'recommended' | 'price_asc' | 'price_desc' | 'recent';

export interface SearchControls {
  sort: SearchSort;
  minPrice: number | null;
  maxPrice: number | null;
}

export class WebSearchValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebSearchValidationError";
  }
}

// The local legacy collector only owns these two sources. Production search
// adds Hello Market and Rethink Mall through the AWS runner/search-only path.
const DEFAULT_SITES = ['joonggonara', 'bunjang'];
const KEYWORD_ONLY_SITES = new Set<string>();
const SUPPORTED_WEB_SEARCH_SITES = new Set(DEFAULT_SITES);
const MAX_KEYWORD_LENGTH = 80;
const MAX_LIMIT = 40;
const SEARCH_SORTS = new Set<SearchSort>(['recommended', 'price_asc', 'price_desc', 'recent']);
const orchestrator = new Orchestrator(new MockProvider());

type ValidatedWebSearchRequest = ReturnType<typeof validateWebSearchRequest>;

export interface WebSearchRunnerOptions {
  cacheTtlMs?: number;
  cacheMaxEntries?: number;
  now?: () => number;
  collect?: (request: ValidatedWebSearchRequest) => Promise<Record<string, unknown>>;
}

export function createWebSearchRunner(options: WebSearchRunnerOptions = {}) {
  const cacheTtlMs = positiveInteger(options.cacheTtlMs, WEB_BACKEND_CONFIG.search_cache_ttl_ms);
  const cacheMaxEntries = positiveInteger(options.cacheMaxEntries, WEB_BACKEND_CONFIG.search_cache_max_entries);
  const now = options.now ?? Date.now;
  const collect = options.collect ?? collectWebSearch;
  const cache = new Map<string, { expiresAt: number; payload: Record<string, unknown> }>();
  const inFlight = new Map<string, Promise<Record<string, unknown>>>();

  return async (input: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const request = validateWebSearchRequest(input);
    const key = collectionKeyForValidatedRequest(request);
    const cached = cache.get(key);
    let basePayload: Record<string, unknown> | undefined;

    if (!request.refreshIndex && cached && cached.expiresAt > now()) {
      basePayload = cached.payload;
    } else {
      if (cached) cache.delete(key);
      let collection = inFlight.get(key);
      if (!collection) {
        const collectionRequest = {
          ...request,
          sort: 'recommended' as SearchSort,
          minPrice: null,
          maxPrice: null
        };
        collection = collect(collectionRequest)
          .then((payload) => {
            cache.set(key, { expiresAt: now() + cacheTtlMs, payload });
            while (cache.size > cacheMaxEntries) {
              const oldestKey = cache.keys().next().value as string | undefined;
              if (oldestKey === undefined) break;
              cache.delete(oldestKey);
            }
            return payload;
          })
          .finally(() => {
            inFlight.delete(key);
          });
        inFlight.set(key, collection);
      }
      basePayload = await collection;
    }

    return applyControlsToSearchPayload(basePayload, {
      sort: request.sort,
      minPrice: request.minPrice,
      maxPrice: request.maxPrice
    });
  };
}

const defaultWebSearchRunner = createWebSearchRunner();

export async function runWebSearch(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  return defaultWebSearchRunner(input);
}

export function webSearchCollectionKey(input: Record<string, unknown>) {
  return collectionKeyForValidatedRequest(validateWebSearchRequest(input));
}

async function collectWebSearch(request: ValidatedWebSearchRequest): Promise<Record<string, unknown>> {
  if (request.categories.length > 1) {
    const categoryResults: Array<{ categoryId: string; payload: Record<string, unknown> }> = [];
    for (const category of request.categories) {
      if (Object.prototype.hasOwnProperty.call(request.categoryCursors, category.id) && request.categoryCursors[category.id] === null) {
        continue;
      }
      const categoryCursor = request.categoryCursors[category.id] ?? null;
      const categoryCursorState = decodeCursorEnvelope(categoryCursor ?? undefined);
      const result = await runSingleWebSearch({
        ...request,
        sort: 'recommended',
        minPrice: null,
        maxPrice: null,
        category,
        categoryIds: [category.id],
        categories: [category],
        effectiveKeyword: request.keyword || category.label,
        seenItemKeys: categoryCursorState.seenItemKeys,
        includeSeenCursorItems: false,
        siteCursors: Object.fromEntries(request.sites.map((site) => [site, categoryCursorState.siteCursors[site] ?? null]))
      });
      categoryResults.push({ categoryId: category.id, payload: asRecord(result.data) });
    }
    const data: Record<string, unknown> = mergeCombinedSearchPayload(
      categoryResults.map((result) => result.payload),
      request.categories,
      request.seenItemKeys,
      { sort: request.sort, minPrice: request.minPrice, maxPrice: request.maxPrice }
    );
    data.query = request.effectiveKeyword;
    data.price_history = await getPriceHistory(request.effectiveKeyword, 90);
    return { status: 'success', data };
  }
  return runSingleWebSearch(request);
}

function collectionKeyForValidatedRequest(request: ValidatedWebSearchRequest) {
  return JSON.stringify({
    keyword: request.keyword,
    effective_keyword: request.effectiveKeyword,
    category_ids: request.categoryIds,
    sites: request.sites,
    limit: request.limit,
    site_cursors: request.siteCursors,
    category_cursors: request.categoryCursors,
    seen_item_keys: request.seenItemKeys
  });
}

function applyControlsToSearchPayload(payload: Record<string, unknown>, controls: SearchControls) {
  if (payload.status !== 'success') return payload;
  const data = asRecord(payload.data);
  const baseItems = asArray(data.items).map(asRecord);
  const controlled = applySearchControls(baseItems, controls);
  const items = controlled.items;
  const sources = asArray(data.sources).map((value) => {
    const source = asRecord(value);
    const sourceKey = readString(source.key, 'unknown');
    const visibleCount = items.filter((item) => item.site === sourceKey).length;
    const warnings = asArray(source.warnings).map(String);
    const errors = asArray(source.errors).map(String);
    const collectionState = deriveCollectionState({
      itemCount: visibleCount,
      extractedCount: readNumber(source.extracted_count, readNumber(source.count, 0)),
      filteredCount: readNumber(source.filtered_count, 0),
      warnings,
      errors
    });
    return {
      ...source,
      visible_count: visibleCount,
      collection_state: collectionState,
      status: collectionState === 'ready' || collectionState === 'empty' ? 'ready' : 'warning',
      warnings,
      errors
    };
  });
  const summary = asRecord(data.summary);
  const quality = asRecord(data.quality);
  return {
    ...payload,
    data: {
      ...data,
      sources,
      items,
      sort_meta: controlled.sort_meta,
      filter_meta: controlled.filter_meta,
      summary: {
        ...summary,
        item_count: items.length,
        source_count: sources.filter((source) => readNumber(source.visible_count, 0) > 0).length,
        ...buildTrustedPriceSummary(items),
        suspect_count: items.filter((item) => item.price_suspect === true || item.noise_filtered === true || (typeof item.fraud_risk === 'number' && item.fraud_risk > 0.45)).length
      },
      quality: {
        ...quality,
        merged_count: baseItems.length,
        available_count: controlled.available_count,
        filtered_out_count: baseItems.length - controlled.available_count
      }
    }
  };
}

async function runSingleWebSearch(
  request: ReturnType<typeof validateWebSearchRequest> & { includeSeenCursorItems?: boolean }
): Promise<Record<string, unknown>> {
  const workflow = await orchestrator.fullWorkflow({
    keyword: request.effectiveKeyword,
    keywordIsExplicit: Boolean(request.keyword),
    sites: request.sites,
    limit: request.limit,
    category: request.category ?? undefined,
    siteCursors: request.siteCursors,
    persistMarketResult: true
  });

  const searchResults = asArray(workflow.search_results);
  const normalizedResults = asArray(workflow.normalized_results);
  const mergedResult = asRecord(workflow.merged_result);
  const snapshot = asRecord(workflow.market_snapshot);
  const mergedItems = asArray(mergedResult.merged_items);

  const sourceMap = new Map(searchResults.map((value) => {
    const item = asRecord(value);
    return [readString(item.site, 'unknown'), item] as const;
  }));

  const sourceSummaries = request.sites.map((siteKey) => {
    const raw = sourceMap.get(siteKey) ?? {};
    const normalized = normalizedResults
      .map(asRecord)
      .find((value) => readString(value.site, '') === siteKey) ?? {};
    const rawWarnings = asArray(raw.warnings).map(String);
    const normalizedWarnings = asArray(normalized.warnings).map(String);
    const rawErrors = asArray(raw.errors).map(String);
    const normalizedErrors = asArray(normalized.errors).map(String);

    return {
      key: siteKey,
      name: siteName(siteKey),
      search_url: sourceSearchUrl(siteKey, request.effectiveKeyword, request.category?.id),
      search_urls: sourceSearchUrls(siteKey, request.effectiveKeyword, request.category?.id),
      count: asArray(raw.items).length,
      normalized_count: asArray(normalized.normalized_items).length,
      extracted_count: readNumber(asRecord(raw.quality_meta).extracted_count, asArray(raw.items).length),
      filtered_count: Math.max(
        readNumber(asRecord(raw.quality_meta).filtered_count, 0),
        readNumber(asRecord(normalized.quality_meta).filtered_count, 0)
      ),
      collection_state: readString(raw.collection_state, 'empty'),
      warnings: Array.from(new Set([...rawWarnings, ...normalizedWarnings])).slice(0, 3),
      errors: Array.from(new Set([...rawErrors, ...normalizedErrors])).slice(0, 3)
    };
  });

  const nextSiteCursors = Object.fromEntries(
    searchResults
      .map((value) => {
        const result = asRecord(value);
        const pagination = asRecord(result.pagination);
        const nextCursor = pagination.next_cursor;
        return typeof nextCursor === "string" && nextCursor
          ? [readString(result.site, "unknown"), nextCursor]
          : null;
      })
      .filter((value): value is [string, string] => value !== null)
  );
  const hasMore = searchResults.some((value) => asRecord(asRecord(value).pagination).has_more === true);

  const previouslySeen = new Set(request.seenItemKeys);
  const collectionOrder = new Map<string, number>();
  for (const normalizedResult of normalizedResults.map(asRecord)) {
    for (const value of asArray(normalizedResult.normalized_items)) {
      const item = toWebItem(value);
      const key = canonicalWebItemKey(item);
      if (!collectionOrder.has(key)) collectionOrder.set(key, collectionOrder.size);
    }
  }
  const baseItems = mergedItems
    .map(toWebItem)
    .filter((item) => (item.url || item.title) && !previouslySeen.has(canonicalWebItemKey(item)))
    .map((item, index) => ({ item, index }))
    .sort((left, right) => (
      (collectionOrder.get(canonicalWebItemKey(left.item)) ?? Number.MAX_SAFE_INTEGER)
      - (collectionOrder.get(canonicalWebItemKey(right.item)) ?? Number.MAX_SAFE_INTEGER)
      || left.index - right.index
    ))
    .map((entry) => entry.item);
  const priceMedians = priceMediansByCurrency(baseItems);
  const markedItems = baseItems.map((item) => ({
    ...item,
    price_suspect: typeof item.price === 'number'
      && (priceMedians.get(normalizeCurrency(item.currency)) ?? null) !== null
      && item.price < (priceMedians.get(normalizeCurrency(item.currency)) as number) * 0.25
  }));
  const controlled = applySearchControls(markedItems, {
    sort: request.sort,
    minPrice: request.minPrice,
    maxPrice: request.maxPrice
  });
  const items = controlled.items;
  const sources = sourceSummaries.map((source) => {
    const visibleCount = items.filter((item) => item.site === source.key).length;
    const hasErrors = source.errors.length > 0;
    const warnings = [...source.warnings];
    if (!hasErrors && source.count > 0 && visibleCount === 0 && !controlled.filter_meta.applied) {
      warnings.push('수집·분석은 완료됐지만 노출 가능한 활성 매물이 없습니다');
    }

    const collectionState = deriveCollectionState({
      itemCount: visibleCount,
      extractedCount: source.extracted_count,
      filteredCount: source.filtered_count,
      warnings,
      errors: source.errors
    });

    return {
      ...source,
      collection_state: collectionState,
      status: collectionState === 'ready' || collectionState === 'empty' ? 'ready' : 'warning',
      visible_count: visibleCount,
      warnings: warnings.slice(0, 3)
    };
  });
  const priceSummary = buildTrustedPriceSummary(items);

  return {
    status: 'success',
    data: {
      query: request.effectiveKeyword,
      category: request.category,
      pagination: {
        has_more: hasMore,
        next_cursor: hasMore
          ? encodeCursorEnvelope(nextSiteCursors, request.includeSeenCursorItems === false
            ? []
            : Array.from(new Set([
              ...request.seenItemKeys,
              ...items.map((item) => canonicalWebItemKey(item))
            ])).slice(-512))
          : null
      },
      run_id: readNestedString(workflow.market_result_ref, 'run_id'),
      searched_at: new Date().toISOString(),
      sources,
      items,
      sort_meta: controlled.sort_meta,
      filter_meta: controlled.filter_meta,
      summary: {
        item_count: items.length,
        source_count: sources.filter((source) => source.visible_count > 0).length,
        ...priceSummary,
        suspect_count: items.filter((item) => item.price_suspect || item.noise_filtered || (item.fraud_risk !== null && item.fraud_risk > 0.45)).length
      },
      market_snapshot: snapshot,
      price_history: await getPriceHistory(request.effectiveKeyword, 90),
      quality: {
        raw_count: searchResults.reduce<number>((sum, result) => sum + asArray(asRecord(result).items).length, 0),
        normalized_count: normalizedResults.reduce<number>(
          (sum, result) => sum + asArray(asRecord(result).normalized_items).length,
          0
        ),
        merged_count: markedItems.length,
        available_count: controlled.available_count,
        filtered_out_count: markedItems.length - controlled.available_count,
        warnings: searchResults.flatMap((result) => asArray(asRecord(result).warnings).map(String)).slice(0, 8)
      }
    }
  };
}

export function mergeCombinedSearchPayload(
  payloads: Record<string, unknown>[],
  categories: Array<{ id: string; label: string; path: string[] }>,
  seenItemKeys: string[] = [],
  controls: SearchControls = { sort: 'recommended', minPrice: null, maxPrice: null }
) {
  const items: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  const previouslySeen = new Set(seenItemKeys);
  for (const payload of payloads) {
    for (const value of asArray(payload.items)) {
      const item = asRecord(value);
      const key = canonicalWebItemKey(item);
      if (previouslySeen.has(key)) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
    }
  }

  const priceMedians = priceMediansByCurrency(items);
  const markedItems: Record<string, unknown>[] = items.map((item) => ({
    ...item,
    price_suspect: typeof item.price === 'number'
      && (priceMedians.get(normalizeCurrency(item.currency)) ?? null) !== null
      && item.price < (priceMedians.get(normalizeCurrency(item.currency)) as number) * 0.25
  }));
  const controlled = applySearchControls(markedItems, controls);
  const visibleItems = controlled.items;

  const sourceMap = new Map<string, Record<string, unknown>>();
  for (const payload of payloads) {
    for (const value of asArray(payload.sources)) {
      const source = asRecord(value);
      const key = readString(source.key, 'unknown');
      const old = sourceMap.get(key);
      if (!old) {
        sourceMap.set(key, {
          ...source,
          count: readNumber(source.count, 0),
          normalized_count: readNumber(source.normalized_count, 0),
          extracted_count: readNumber(source.extracted_count, 0),
          filtered_count: readNumber(source.filtered_count, 0),
          search_urls: asArray(source.search_urls).map(String),
          warnings: asArray(source.warnings).map(String),
          errors: asArray(source.errors).map(String)
        });
        continue;
      }
      sourceMap.set(key, {
        ...old,
        count: readNumber(old.count, 0) + readNumber(source.count, 0),
        normalized_count: readNumber(old.normalized_count, 0) + readNumber(source.normalized_count, 0),
        extracted_count: readNumber(old.extracted_count, 0) + readNumber(source.extracted_count, 0),
        filtered_count: readNumber(old.filtered_count, 0) + readNumber(source.filtered_count, 0),
        search_urls: Array.from(new Set([
          ...asArray(old.search_urls).map(String),
          ...asArray(source.search_urls).map(String)
        ])),
        warnings: Array.from(new Set([...asArray(old.warnings).map(String), ...asArray(source.warnings).map(String)])).slice(0, 3),
        errors: Array.from(new Set([...asArray(old.errors).map(String), ...asArray(source.errors).map(String)])).slice(0, 3)
      });
    }
  }

  const sources: Record<string, unknown>[] = Array.from(sourceMap.values()).map((source) => {
    const visibleCount = visibleItems.filter((item) => item.site === source.key).length;
    const warnings = asArray(source.warnings).map(String);
    const errors = asArray(source.errors).map(String);
    const collectionState = deriveCollectionState({
      itemCount: visibleCount,
      extractedCount: readNumber(source.extracted_count, readNumber(source.count, 0)),
      filteredCount: readNumber(source.filtered_count, 0),
      warnings,
      errors
    });
    return {
      ...source,
      visible_count: visibleCount,
      collection_state: collectionState,
      status: collectionState === 'ready' || collectionState === 'empty' ? 'ready' : 'warning',
      warnings,
      errors
    };
  });

  const priceSummary = buildTrustedPriceSummary(visibleItems);

  const categoryCursors = Object.fromEntries(categories.map((category) => {
    const payload = payloads.find((candidate) => readString(asRecord(candidate.category).id, '') === category.id);
    const nextCursor = payload ? asRecord(payload.pagination).next_cursor : null;
    return [category.id, typeof nextCursor === 'string' && nextCursor.length > 0 ? nextCursor : null];
  }));
  const hasMore = Object.values(categoryCursors).some((cursor) => typeof cursor === 'string' && cursor.length > 0);
  const nextSeenItemKeys = Array.from(new Set([
    ...seenItemKeys,
    ...visibleItems.map((item) => canonicalWebItemKey(item))
  ])).slice(-512);

  const combinedPayload: Record<string, unknown> = {
    query: categories.map((category) => category.label).join(' / '),
    category: null,
    categories,
    pagination: {
      has_more: hasMore,
      next_cursor: hasMore ? encodeCombinedCursor(categoryCursors, nextSeenItemKeys) : null
    },
    run_id: readString(payloads[0]?.run_id, ''),
    searched_at: new Date().toISOString(),
    sources,
    items: visibleItems,
    sort_meta: controlled.sort_meta,
    filter_meta: controlled.filter_meta,
    summary: {
      item_count: visibleItems.length,
      source_count: sources.filter((source) => readNumber(source.visible_count, 0) > 0).length,
      ...priceSummary,
      suspect_count: visibleItems.filter((item) => item.price_suspect === true || item.noise_filtered === true || (typeof item.fraud_risk === 'number' && item.fraud_risk > 0.45)).length
    },
    market_snapshot: payloads.map((payload) => payload.market_snapshot).find(Boolean) ?? null,
    price_history: null,
    quality: {
      raw_count: payloads.reduce((sum, payload) => sum + readNumber(asRecord(payload.quality).raw_count, 0), 0),
      normalized_count: payloads.reduce((sum, payload) => sum + readNumber(asRecord(payload.quality).normalized_count, 0), 0),
      merged_count: markedItems.length,
      available_count: controlled.available_count,
      filtered_out_count: markedItems.length - controlled.available_count,
      warnings: Array.from(new Set(payloads.flatMap((payload) => asArray(asRecord(payload.quality).warnings).map(String)))).slice(0, 8)
    }
  };
  return combinedPayload;
}

export function validateWebSearchRequest(input: Record<string, unknown>) {
  const keyword = typeof input.keyword === 'string' ? input.keyword.trim() : '';
  const categoryId = typeof input.category_id === 'string' ? input.category_id.trim() : '';
  if (input.category_ids !== undefined && !Array.isArray(input.category_ids)) {
    throw new WebSearchValidationError('category_ids must be an array');
  }

  const requestedCategoryIds = [
    ...(categoryId ? [categoryId] : []),
    ...(Array.isArray(input.category_ids)
      ? input.category_ids.filter((value): value is string => typeof value === 'string').map((value) => value.trim())
      : [])
  ].filter(Boolean);
  const categoryIds = Array.from(new Set(requestedCategoryIds));
  if (categoryIds.length > 8) {
    throw new WebSearchValidationError('category_ids must contain between 1 and 8 categories');
  }

  const categories = categoryIds.map((requestedId) => {
    const category = resolveCategory(requestedId);
    if (!category) {
      throw new WebSearchValidationError(`Unknown category_id: ${requestedId}`);
    }
    return category;
  });
  if (categories.some((category) => category.id === 'all') && categories.length > 1) {
    throw new WebSearchValidationError('category_id all cannot be combined with other categories');
  }
  const category = categories.length === 1 ? categories[0] : null;
  if (!keyword && category?.id === 'all') {
    throw new WebSearchValidationError('keyword is required when category_id is all');
  }
  if (!keyword && categories.length === 0) {
    throw new WebSearchValidationError(`keyword must be between 1 and ${MAX_KEYWORD_LENGTH} characters`);
  }
  if (keyword.length > MAX_KEYWORD_LENGTH) {
    throw new WebSearchValidationError(`keyword must be between 1 and ${MAX_KEYWORD_LENGTH} characters`);
  }

  const rawSites = Array.isArray(input.sites) ? input.sites : DEFAULT_SITES;
  const sites = rawSites
    .filter((site): site is string => typeof site === 'string')
    .map((site) => site.trim())
    .filter(Boolean);
  let uniqueSites = Array.from(new Set(sites));
  if (uniqueSites.length === 0 || uniqueSites.length > 6) {
    throw new WebSearchValidationError('sites must contain between 1 and 6 supported sites');
  }
  for (const site of uniqueSites) {
    if (!SUPPORTED_WEB_SEARCH_SITES.has(site)) {
      throw new WebSearchValidationError(`Unsupported site: ${site}`);
    }
    try {
      resolveSite(site);
    } catch {
      throw new WebSearchValidationError(`Unsupported site: ${site}`);
    }
  }
  const hasExplicitSites = Array.isArray(input.sites);
  const requestedCategories = categories.filter((candidate) => candidate.id !== 'all');
  if (requestedCategories.length > 0) {
    const unsupportedSites = uniqueSites.filter((site) => (
      !(keyword && KEYWORD_ONLY_SITES.has(site))
      && requestedCategories.some((candidate) => !isCategorySelectableForSite(site, candidate.id))
    ));
    if (unsupportedSites.length > 0 && hasExplicitSites) {
      throw new WebSearchValidationError(`Selected categories are unavailable for site(s): ${unsupportedSites.join(', ')}`);
    }
    uniqueSites = uniqueSites.filter((site) => !unsupportedSites.includes(site));
    if (uniqueSites.length === 0) {
      throw new WebSearchValidationError('No selected site has a verified category path for the requested categories');
    }
  }

  const rawLimit = typeof input.limit === 'number' ? input.limit : 12;
  const limit = Number.isInteger(rawLimit) ? rawLimit : 12;
  if (limit < 1 || limit > MAX_LIMIT) {
    throw new WebSearchValidationError(`limit must be between 1 and ${MAX_LIMIT}`);
  }

  const rawSort = input.sort === undefined ? 'recommended' : input.sort;
  if (typeof rawSort !== 'string' || !SEARCH_SORTS.has(rawSort as SearchSort)) {
    throw new WebSearchValidationError('sort must be one of recommended, price_asc, price_desc, recent');
  }
  const sort = rawSort as SearchSort;
  const minPrice = validateOptionalPriceControl(input.min_price, 'min_price');
  const maxPrice = validateOptionalPriceControl(input.max_price, 'max_price');
  if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) {
    throw new WebSearchValidationError('min_price must be less than or equal to max_price');
  }
  if (input.refresh_index !== undefined && typeof input.refresh_index !== 'boolean') {
    throw new WebSearchValidationError('refresh_index must be a boolean');
  }
  const refreshIndex = input.refresh_index !== false;
  const workUnits = Math.max(1, categories.length) * uniqueSites.length;
  if (workUnits > WEB_BACKEND_CONFIG.search_max_work_units) {
    throw new WebSearchValidationError(
      `search request requires ${workUnits} work units; maximum is ${WEB_BACKEND_CONFIG.search_max_work_units}`
    );
  }

  const decodedCursors = decodeCursorEnvelope(typeof input.cursor === 'string' ? input.cursor : undefined);
  if (categories.length > 1 && Object.keys(decodedCursors.siteCursors).length > 0) {
    throw new WebSearchValidationError('combined category cursor is invalid or expired');
  }
  if (categories.length <= 1 && Object.keys(decodedCursors.categoryCursors).length > 0) {
    throw new WebSearchValidationError('category cursor is invalid or expired');
  }
  for (const site of uniqueSites) {
    const cursor = decodedCursors.siteCursors[site];
    if (cursor !== undefined && cursor !== null) validateSiteCursor(site, cursor);
  }
  const categoryCursors = Object.fromEntries(
    Object.entries(decodedCursors.categoryCursors).map(([categoryId, cursor]) => {
      if (!categories.some((candidate) => candidate.id === categoryId)) {
        throw new WebSearchValidationError('combined category cursor is invalid or expired');
      }
      if (cursor === null) return [categoryId, null];
      const nested = decodeCursorEnvelope(cursor);
      if (Object.keys(nested.categoryCursors).length > 0 || Object.keys(nested.siteCursors).some((site) => !uniqueSites.includes(site))) {
        throw new WebSearchValidationError('combined category cursor is invalid or expired');
      }
      for (const [site, siteCursor] of Object.entries(nested.siteCursors)) {
        if (siteCursor !== null) validateSiteCursor(site, siteCursor);
      }
      return [categoryId, cursor];
    })
  );
  const siteCursors = Object.fromEntries(uniqueSites.map((site) => [site, decodedCursors.siteCursors[site] ?? null]));

  return {
    keyword,
    effectiveKeyword: keyword || categories.map((candidate) => candidate.label).join(' / '),
    category,
    categoryIds,
    categories,
    sites: uniqueSites,
    limit,
    sort,
    minPrice,
    maxPrice,
    refreshIndex,
    workUnits,
    siteCursors,
    categoryCursors,
    seenItemKeys: decodedCursors.seenItemKeys
  };
}

function toWebItem(value: unknown) {
  const item = asRecord(value);
  const price = typeof item.price_value === 'number' && Number.isFinite(item.price_value)
    ? item.price_value
    : null;
  const components = asArray(item.components).map((component) => {
    const record = asRecord(component);
    return {
      type: readString(record.component_type, 'unknown'),
      name: readString(record.canonical_name, ''),
      confidence: typeof record.confidence === 'number' ? record.confidence : 0
    };
  }).filter((component) => component.name);

  return {
    id: readString(item.url, readString(item.title, cryptoSafeId(item))),
    title: readString(item.title, '제목 없음'),
    price,
    site: readString(item.site, 'unknown'),
    price_label: readString(item.price_label, ''),
    seller: readString(item.seller_name, ''),
    condition: readString(item.condition, ''),
    location: readString(item.location, ''),
    posted_at: readString(item.posted_at, readString(item.upload_date, '')),
    image_url: readString(item.image_url, ''),
    shipping: readString(item.shipping, ''),
    currency: readString(item.currency, 'KRW'),
    status: readString(item.sale_status, readString(item.item_status, 'unknown')),
    listing_type: readString(item.listing_type, 'unknown'),
    score: typeof item.score_hint === 'number' ? item.score_hint : null,
    baseline_price: typeof item.baseline_price === 'number' ? item.baseline_price : null,
    deviation_rate: typeof item.deviation_rate === 'number' ? item.deviation_rate : null,
    fraud_risk: typeof item.fraud_risk_score === 'number' ? item.fraud_risk_score : null,
    net_profit: typeof item.net_profit === 'number' ? item.net_profit : null,
    demand: readString(item.demand_strength, ''),
    noise_filtered: item.noise_filtered === true,
    noise_reason: readString(item.noise_filter_reason, ''),
    components,
    price_suspect: false,
    url: readString(item.url, '')
    ,category_id: readString(item.canonical_category_id, '')
    ,category_path: asArray(item.canonical_category_path).map(String)
    ,source_category_id: readString(item.source_category_id, '')
    ,source_category_ids: asArray(item.source_category_ids).map(String)
    ,source_category_path: asArray(item.source_category_path).map(String)
    ,category_mapping_mode: readString(item.category_mapping_mode, 'single')
    ,category_mapping_confidence: readString(item.category_mapping_confidence, 'unknown')
  };
}

function encodeCursorEnvelope(siteCursors: Record<string, string>, seenItemKeys: string[] = []) {
  const payload: Record<string, unknown> = { version: 1, site_cursors: siteCursors };
  if (seenItemKeys.length > 0) payload.seen_items = seenItemKeys.slice(-512);
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function encodeCombinedCursor(categoryCursors: Record<string, string | null>, seenItemKeys: string[] = []) {
  const payload: Record<string, unknown> = { version: 2, category_cursors: categoryCursors };
  if (seenItemKeys.length > 0) payload.seen_items = seenItemKeys.slice(-512);
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeCursorEnvelope(cursor: string | undefined) {
  if (!cursor) return { siteCursors: {}, categoryCursors: {}, seenItemKeys: [] as string[] };
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!isPlainRecord(parsed)) {
      throw new Error("invalid cursor shape");
    }
    const siteCursors: Record<string, string | null> = {};
    const categoryCursors: Record<string, string | null> = {};
    const seenItemKeys = parsed.seen_items === undefined
      ? []
      : Array.isArray(parsed.seen_items) && parsed.seen_items.every((value) => typeof value === "string")
        ? parsed.seen_items.slice(-512) as string[]
        : null;
    if (seenItemKeys === null) throw new Error("invalid seen item keys");
    if (parsed.version === 1 && isPlainRecord(parsed.site_cursors)) {
      for (const [site, value] of Object.entries(parsed.site_cursors)) {
        if (value !== null && typeof value !== "string") throw new Error("invalid site cursor");
        siteCursors[site] = value;
      }
      return { siteCursors, categoryCursors, seenItemKeys };
    }
    if (parsed.version === 2 && isPlainRecord(parsed.category_cursors)) {
      for (const [categoryId, value] of Object.entries(parsed.category_cursors)) {
        if (value !== null && typeof value !== "string") throw new Error("invalid category cursor");
        categoryCursors[categoryId] = value;
      }
      return { siteCursors, categoryCursors, seenItemKeys };
    }
    throw new Error("invalid cursor shape");
  } catch {
    throw new WebSearchValidationError("cursor is invalid or expired");
  }
}

function validateSiteCursor(site: string, cursor: string) {
  const valid = site === 'bunjang'
    ? /^(?:page:\d+|aggregate:v1:[A-Za-z0-9_-]{1,12000}|slice:v1:[A-Za-z0-9_-]{1,12000}|[A-Za-z0-9_-]{20,12000})$/.test(cursor)
    : /^(?:page:\d+|aggregate:v1:[A-Za-z0-9_-]{1,12000})$/.test(cursor);
  if (!valid) throw new WebSearchValidationError(`cursor is invalid or expired for ${site}`);
}

function siteName(siteKey: string) {
  return listSupportedSites().find((site) => site.key === siteKey)?.name || siteKey;
}

function sourceSearchUrl(siteKey: string, keyword: string, categoryId?: string) {
  const encoded = encodeURIComponent(keyword);
  const binding = categoryId ? getSourceCategoryBinding(siteKey, categoryId) : null;
  const sourceCategoryId = binding?.sourceCategoryIds?.[0] ?? binding?.sourceCategoryId;
  return sourceSearchUrlForCategory(siteKey, encoded, sourceCategoryId);
}

function sourceSearchUrls(siteKey: string, keyword: string, categoryId?: string) {
  const encoded = encodeURIComponent(keyword);
  const binding = categoryId ? getSourceCategoryBinding(siteKey, categoryId) : null;
  const sourceCategoryIds = binding?.sourceCategoryIds?.length
    ? binding.sourceCategoryIds
    : binding?.sourceCategoryId
      ? [binding.sourceCategoryId]
      : [];
  return Array.from(new Set(sourceCategoryIds.length > 0
    ? sourceCategoryIds.map((sourceCategoryId) => sourceSearchUrlForCategory(siteKey, encoded, sourceCategoryId))
    : [sourceSearchUrlForCategory(siteKey, encoded, undefined)]));
}

function sourceSearchUrlForCategory(siteKey: string, encodedKeyword: string, sourceCategoryId?: string) {
  if (sourceCategoryId) {
    try {
      const adapter = resolveBrowserSiteAdapter(siteKey);
      if (adapter.categoryUrl) return adapter.categoryUrl(sourceCategoryId, 40);
    } catch {
      // An API-only site can still use the generic keyword URL below.
    }
  }
  if (siteKey === 'joonggonara') return `https://web.joongna.com/search/${encodedKeyword}`;
  if (siteKey === 'bunjang') return `https://m.bunjang.co.kr/search/products?keyword=${encodedKeyword}`;
  try {
    return resolveBrowserSiteAdapter(siteKey).searchUrl(decodeURIComponent(encodedKeyword), 40);
  } catch {
    // Unknown sources do not have a public search URL.
  }
  return '';
}

function canonicalWebItemKey(item: Record<string, unknown>) {
  const site = readString(item.site, 'unknown');
  const rawUrl = readString(item.url, '');
  if (rawUrl) {
    try {
      const url = new URL(rawUrl);
      if (/^(?:m\.)?bunjang\.co\.kr$/i.test(url.hostname) && /^\/products\/\d+$/i.test(url.pathname)) {
        return `${site}:${url.hostname.toLowerCase()}${url.pathname}`;
      }
      return `${site}:${url.origin}${url.pathname}`;
    } catch {
      return `${site}:${rawUrl}`;
    }
  }
  return `${site}:${readString(item.title, '')}:${readString(item.price, '')}`;
}

function cryptoSafeId(item: Record<string, unknown>) {
  return `${readString(item.site, 'item')}:${readString(item.posted_at, 'unknown')}:${readString(item.title, 'unknown')}`;
}

function readNestedString(value: unknown, key: string) {
  return readString(asRecord(value)[key], '');
}

function readString(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function readNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function validateOptionalPriceControl(value: unknown, field: 'min_price' | 'max_price') {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new WebSearchValidationError(`${field} must be a finite number greater than or equal to 0`);
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function median(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function normalizeCurrency(value: unknown) {
  const currency = String(value || 'KRW').trim().toUpperCase();
  return currency || 'KRW';
}

function positiveInteger(value: number | undefined, fallback: number) {
  return Number.isInteger(value) && (value as number) > 0 ? value as number : fallback;
}

export function priceMediansByCurrency(items: Array<{ price?: unknown; currency?: unknown }>) {
  const grouped = new Map<string, number[]>();
  for (const item of items) {
    if (typeof item.price !== 'number' || !Number.isFinite(item.price) || item.price <= 0) continue;
    const values = grouped.get(normalizeCurrency(item.currency)) ?? [];
    values.push(item.price);
    grouped.set(normalizeCurrency(item.currency), values);
  }
  return new Map(Array.from(grouped.entries()).map(([currency, prices]) => [currency, median(prices)]));
}

export function applySearchControls<T extends Record<string, unknown>>(
  inputItems: readonly T[],
  controls: SearchControls
) {
  const minPrice = controls.minPrice ?? null;
  const maxPrice = controls.maxPrice ?? null;
  const filterRequested = minPrice !== null || maxPrice !== null;
  const initialCurrency = comparableCurrency(inputItems);
  let items = [...inputItems];
  let filterApplied = false;
  let filterReason = 'not_requested';

  if (filterRequested && initialCurrency.currency === 'MIXED') {
    filterReason = 'mixed_currency';
  } else if (filterRequested) {
    items = items.filter((item) => {
      const price = comparablePrice(item.price);
      if (price === null) return false;
      if (minPrice !== null && price < minPrice) return false;
      if (maxPrice !== null && price > maxPrice) return false;
      return true;
    });
    filterApplied = true;
    filterReason = 'applied';
  }

  const indexed = items.map((item, index) => ({ item, index }));
  const currency = comparableCurrency(items);
  let sortApplied = false;
  let sortReason = 'not_requested';

  if (controls.sort === 'recommended') {
    indexed.sort((left, right) => compareRecommended(left.item, right.item) || left.index - right.index);
    sortApplied = true;
    sortReason = 'quality_signals';
  } else if (controls.sort === 'recent') {
    const validDateCount = indexed.reduce((count, entry) => count + (absoluteDateTimestamp(entry.item.posted_at) === null ? 0 : 1), 0);
    if (validDateCount > 0) {
      indexed.sort((left, right) => {
        const leftTime = absoluteDateTimestamp(left.item.posted_at);
        const rightTime = absoluteDateTimestamp(right.item.posted_at);
        if (leftTime === null && rightTime === null) return left.index - right.index;
        if (leftTime === null) return 1;
        if (rightTime === null) return -1;
        return rightTime - leftTime || left.index - right.index;
      });
      sortApplied = true;
      sortReason = 'applied';
    } else {
      sortReason = 'no_valid_dates';
    }
  } else if (currency.currency === 'MIXED') {
    sortReason = 'mixed_currency';
  } else if (currency.comparableCount === 0) {
    sortReason = 'no_comparable_prices';
  } else {
    const direction = controls.sort === 'price_desc' ? -1 : 1;
    indexed.sort((left, right) => {
      const leftPrice = comparablePrice(left.item.price);
      const rightPrice = comparablePrice(right.item.price);
      if (leftPrice === null && rightPrice === null) return left.index - right.index;
      if (leftPrice === null) return 1;
      if (rightPrice === null) return -1;
      return (leftPrice - rightPrice) * direction || left.index - right.index;
    });
    sortApplied = true;
    sortReason = 'applied';
  }

  const sortedItems = indexed.map((entry) => entry.item);
  return {
    items: sortedItems,
    available_count: sortedItems.length,
    sort_meta: {
      requested: controls.sort,
      applied: sortApplied,
      reason: sortReason,
      currency: currency.currency
    },
    filter_meta: {
      requested: filterRequested,
      applied: filterApplied,
      reason: filterReason,
      min_price: minPrice,
      max_price: maxPrice,
      currency: initialCurrency.currency,
      before_count: inputItems.length,
      after_count: sortedItems.length
    }
  };
}

function comparablePrice(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function comparableCurrency(items: readonly Record<string, unknown>[]) {
  const currencies = new Set<string>();
  let comparableCount = 0;
  for (const item of items) {
    if (comparablePrice(item.price) === null) continue;
    comparableCount += 1;
    currencies.add(normalizeCurrency(item.currency));
  }
  return {
    currency: currencies.size > 1 ? 'MIXED' : currencies.size === 1 ? Array.from(currencies)[0] : null,
    comparableCount
  };
}

function compareRecommended(left: Record<string, unknown>, right: Record<string, unknown>) {
  const leftSignals = recommendationSignals(left);
  const rightSignals = recommendationSignals(right);
  return rightSignals.trusted - leftSignals.trusted
    || rightSignals.score - leftSignals.score
    || rightSignals.completeness - leftSignals.completeness
    || leftSignals.fraudRisk - rightSignals.fraudRisk;
}

function recommendationSignals(item: Record<string, unknown>) {
  const fraudRisk = typeof item.fraud_risk === 'number' && Number.isFinite(item.fraud_risk)
    ? Math.max(0, Math.min(1, item.fraud_risk))
    : 0;
  const trusted = item.noise_filtered === true || item.price_suspect === true || fraudRisk > 0.45 ? 0 : 1;
  const score = typeof item.score === 'number' && Number.isFinite(item.score) ? item.score : Number.NEGATIVE_INFINITY;
  const completeness = ['title', 'price', 'url', 'image_url', 'condition', 'seller']
    .reduce((count, field) => {
      const value = item[field];
      return count + (typeof value === 'number' && Number.isFinite(value) || typeof value === 'string' && value.trim() ? 1 : 0);
    }, 0);
  return { trusted, score, completeness, fraudRisk };
}

function absoluteDateTimestamp(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const calendarMatch = /^(\d{4})-(\d{2})-(\d{2})(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(trimmed);
  if (!calendarMatch) return null;
  const year = Number(calendarMatch[1]);
  const month = Number(calendarMatch[2]);
  const day = Number(calendarMatch[3]);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (calendarDate.getUTCFullYear() !== year || calendarDate.getUTCMonth() !== month - 1 || calendarDate.getUTCDate() !== day) return null;
  const timestamp = Date.parse(trimmed.includes(' ') ? trimmed.replace(' ', 'T') : trimmed);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function buildTrustedPriceSummary(items: Array<{
  price?: unknown;
  currency?: unknown;
  price_suspect?: boolean;
  noise_filtered?: boolean;
  fraud_risk?: number | null;
}>) {
  const currencies = new Set(items.map((item) => normalizeCurrency(item.currency)).filter(Boolean));
  const currency = currencies.size === 1 ? Array.from(currencies)[0] : currencies.size > 1 ? 'MIXED' : 'KRW';
  if (currency === 'MIXED') {
    return { currency, median_price: null, average_price: null, lowest_price: null, highest_price: null };
  }
  const prices = items
    .filter((item) => !item.price_suspect && item.noise_filtered !== true && (item.fraud_risk === null || typeof item.fraud_risk !== 'number' || item.fraud_risk <= 0.45))
    .map((item) => item.price)
    .filter((price): price is number => typeof price === 'number' && Number.isFinite(price) && price > 0);
  return {
    currency,
    median_price: median(prices),
    average_price: prices.length > 0 ? Math.round(prices.reduce((sum, price) => sum + price, 0) / prices.length) : null,
    lowest_price: prices.length > 0 ? Math.min(...prices) : null,
    highest_price: prices.length > 0 ? Math.max(...prices) : null
  };
}
