import http from 'node:http';
import { URL } from 'node:url';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { WEB_BACKEND_CONFIG } from './config.js';
import { ROUTE_DRAFTS, parseListingTypes, parseSiteFilters, splitListingTypeTokens } from './routes.js';
import { FeedbackValidationError, getUxFeedbackSummary, saveUxFeedback } from './feedback-service.js';
import { runWebSearch, webSearchCollectionKey, WebSearchValidationError } from './search-service.js';
import { categoryCatalogForApi } from '../../market/logic/category-catalog.js';
// Shared PC facet catalog lives outside dist so the web server and worker use one registry.
// @ts-ignore shared runtime ESM module is loaded from the application root
import { pcPartsCatalogForApi } from '../../../market/logic/pc-parts-catalog.mjs';
// @ts-ignore shared runtime ESM module is loaded from the application root
import { pcCatalogResponse, pcProductsResponse } from '../../../cloudflare/pc-directory-http.mjs';
// Public catalog APIs expose only the seven supported PC-part categories.
// @ts-ignore shared runtime ESM module is loaded from the application root
import { publicPcCatalogForApi, publicPcFacetsForApi, publicPcModelsForApi } from '../../../market/logic/pc-public-catalog.mjs';
// @ts-ignore canonical PC-directory source policy is authored as shared ESM JavaScript
import { OPERATIONAL_PC_DIRECTORY_SITES } from '../../../cloudflare/target-sites.mjs';
import { getPriceHistory } from './price-history-service.js';
import { getEngineStatus } from './engine-status-service.js';
import { getRunnerState, runNamedSchedulerJobs, RunnerIdempotencyConflictError, RunnerValidationError } from './runner-service.js';
import {
  listSearchOnlySourceCatalog,
  runSearchOnly,
  SearchOnlyValidationError
} from './search-only-service.js';
import {
  ApiStatusSummary,
  Component,
  GPUSummary,
  LatestMarketResponse,
  LatestMergedResponse,
  LatestOpportunitiesResponse,
  ListingType,
  MarketByGpuResponse,
  MergedItem,
  TransactionHistoryResponse,
  TransactionRecord,
  TransactionRecordInput
} from './dto.js';

let serverStartTime = Date.now();
const PUBLIC_CATEGORY_SITES = ['joonggonara', 'bunjang', 'hellomarket', 'rethinkmall'] as const;
type PcCategorySeo = {
  label: string;
  title: string;
  description: string;
  canonical: string;
  intro: string;
};

const PC_CATEGORY_SEO: Record<string, PcCategorySeo> = Object.freeze({
  cpu: {
    label: 'CPU',
    title: '중고 CPU 검색 | CPU 중고시세 비교 | USED PICK',
    description: '중고 CPU를 모델별로 검색하세요. AMD Ryzen, Intel Core 등 중고 CPU 매물과 최근 30일 가격을 비교합니다.',
    canonical: 'https://used-pick.com/categories/cpu',
    intro: '중고 CPU 모델을 검색하고 출처별 매물과 최근 30일 CPU 중고시세를 비교하세요.'
  },
  gpu: {
    label: '그래픽카드',
    title: '중고 그래픽카드 검색 | GPU 중고시세 비교 | USED PICK',
    description: '중고 그래픽카드와 GPU를 모델별로 검색하세요. RTX, RX 등 그래픽카드 매물과 최근 30일 중고시세를 비교합니다.',
    canonical: 'https://used-pick.com/categories/gpu',
    intro: '중고 그래픽카드 모델을 검색하고 RTX·RX 등 GPU 매물과 중고시세를 비교하세요.'
  },
  ram: {
    label: 'RAM',
    title: '중고 RAM 검색 | DDR4·DDR5 메모리 중고시세 | USED PICK',
    description: '중고 RAM과 메모리를 DDR 세대·용량별로 검색하세요. DDR4, DDR5 중고 램 매물과 가격을 비교합니다.',
    canonical: 'https://used-pick.com/categories/ram',
    intro: '중고 RAM과 메모리를 DDR 세대·용량별로 검색하고 중고시세를 비교하세요.'
  },
  motherboard: {
    label: '메인보드',
    title: '중고 메인보드 검색 | 메인보드 중고시세 비교 | USED PICK',
    description: '중고 메인보드를 CPU 소켓·칩셋·제조사별로 검색하세요. AM5, AM4, LGA 등 메인보드 매물과 가격을 비교합니다.',
    canonical: 'https://used-pick.com/categories/motherboard',
    intro: '중고 메인보드를 CPU 소켓·칩셋·제조사별로 검색하고 매물과 중고시세를 비교하세요.'
  },
  ssd: {
    label: 'SSD',
    title: '중고 SSD 검색 | NVMe·SATA SSD 중고시세 | USED PICK',
    description: '중고 SSD를 용량·제조사별로 검색하세요. NVMe, M.2, SATA SSD 매물과 최근 중고가격을 비교합니다.',
    canonical: 'https://used-pick.com/categories/ssd',
    intro: '중고 SSD를 용량·제조사별로 검색하고 NVMe·M.2·SATA 매물의 중고시세를 비교하세요.'
  },
  hdd: {
    label: 'HDD',
    title: '중고 HDD 검색 | 하드디스크 중고가격 비교 | USED PICK',
    description: '중고 HDD와 하드디스크를 용량·제조사별로 검색하세요. 1TB, 2TB 등 HDD 중고 매물과 가격을 비교합니다.',
    canonical: 'https://used-pick.com/categories/hdd',
    intro: '중고 HDD와 하드디스크를 용량·제조사별로 검색하고 매물과 중고가격을 비교하세요.'
  },
  psu: {
    label: '파워서플라이',
    title: '중고 파워서플라이 검색 | 중고 파워 시세 비교 | USED PICK',
    description: '중고 파워서플라이와 PC 파워를 정격 출력·제조사별로 검색하세요. 500W, 750W 등 매물과 중고시세를 비교합니다.',
    canonical: 'https://used-pick.com/categories/psu',
    intro: '중고 파워서플라이를 정격 출력·제조사별로 검색하고 PC 파워 매물과 중고시세를 비교하세요.'
  }
});

function publicCategoryCatalog() {
  const catalog = categoryCatalogForApi();
  const sitePlans = Object.fromEntries(PUBLIC_CATEGORY_SITES.map((site) => [site, {
    ...((catalog.site_plans as Record<string, Record<string, unknown>>)[site] || {})
  }]));
  const sourceBindings = Object.fromEntries(PUBLIC_CATEGORY_SITES.map((site) => [site, {
    ...((catalog.source_bindings as Record<string, Record<string, unknown>>)[site] || {})
  }]));
  for (const site of ['hellomarket', 'rethinkmall'] as const) {
    sitePlans[site] = Object.fromEntries(catalog.categories
      .filter((category) => category.id !== 'all')
      .map((category) => [category.id, {
        requestedCategoryId: category.id,
        resolvedCategoryId: null,
        strategy: 'keyword',
        binding: null,
        availability: 'unavailable',
        selectable: false
      }]));
    sourceBindings[site] = {};
  }
  return {
    ...catalog,
    pc_parts: pcPartsCatalogForApi(),
    site_plans: sitePlans,
    source_bindings: sourceBindings
  };
}

type JsonRecord = Record<string, unknown>;

interface LatestModuleResult {
  moduleName: string;
  runId: string;
  output: JsonRecord;
  summary: JsonRecord | null;
}

interface LatestModuleMap {
  collector: LatestModuleResult | null;
  market: LatestModuleResult | null;
  merge: LatestModuleResult | null;
  merged: LatestModuleResult | null;
  MCP: LatestModuleResult | null;
}

interface NormalizedItemView {
  title: string;
  price_value: number;
  components: Component[];
  site?: string;
  listing_type?: ListingType;
}

const DEALER_SELLER_PATTERN = /(store|dealer|shop|official|mall|컴퓨터|업체|매입|총판|상사|리퍼|도소매)/i;

const MAX_REQUEST_BODY_BYTES = 1_048_576;

function positiveInteger(value: number | undefined, fallback: number) {
  return Number.isInteger(value) && (value as number) > 0 ? value as number : fallback;
}

function normalizeOrigin(value: string) {
  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
}

function normalizeOrigins(values: string[]) {
  return new Set(values.map(normalizeOrigin).filter(Boolean));
}

function isSameRequestOrigin(origin: string, req: http.IncomingMessage) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwardedProto || 'http';
  const host = req.headers.host;
  if (!host) return false;
  return normalizeOrigin(origin) === normalizeOrigin(`${protocol}://${host}`);
}

function allowedMethodsForPath(pathname: string, publicApiOnly: boolean) {
  if (pathname === '/health') return ['GET', 'HEAD'];
  if (!pathname.startsWith('/api/')) return ['GET', 'HEAD'];
  if (pathname === '/api/search') return ['POST'];
  if (pathname === '/api/categories') return ['GET'];
  if (pathname === '/api/catalog/categories' || pathname === '/api/catalog/facets' || pathname === '/api/catalog/models') return ['GET'];
  if (pathname === '/api/pc/catalog' || pathname === '/api/pc/products' || pathname === '/api/pc/listings') return ['GET'];
  if (/^\/api\/products\/[^/]+\/price-stats$/u.test(pathname)) return ['GET'];
  if (pathname === '/api/monetization/contextual-offer' || pathname === '/api/monetization/event') return ['POST'];
  if (publicApiOnly) return [];

  const postRoutes = new Set([
    '/api/search-only',
    '/api/feedback',
    '/api/runner/run',
    '/api/transaction/record'
  ]);
  if (postRoutes.has(pathname)) return ['POST'];
  const getRoutes = new Set([
    '/api/search-only/sources',
    '/api/feedback/summary',
    '/api/market/history',
    '/api/engine/status',
    '/api/runner/status',
    '/api/merged/latest',
    '/api/market/latest',
    '/api/market/by-gpu',
    '/api/opportunities/latest',
    '/api/collector/latest',
    '/api/transaction/history',
    '/api/status/summary'
  ]);
  if (getRoutes.has(pathname) || /^\/api\/runs\/[^/]+\/[^/]+$/u.test(pathname)) return ['GET'];
  return [];
}

class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly details?: string,
    public readonly suggestion?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function createServer(
  port = WEB_BACKEND_CONFIG.port,
  options: {
    initializeStorage?: boolean;
    searchConcurrencyLimit?: number;
    searchRetryAfterSeconds?: number;
    exposeInternalErrorDetails?: boolean;
    corsAllowedOrigins?: string[];
    publicApiOnly?: boolean;
    runWebSearch?: typeof runWebSearch;
    runSearchOnly?: typeof runSearchOnly;
    listPcListings?: (query: {
      canonicalProductId: string | null;
      canonicalProductIds: string[] | null;
      manufacturer: string | null;
      boardManufacturer: string | null;
      sites: string[];
      sort: string;
      minPrice: number | null;
      maxPrice: number | null;
      limit: number;
      cursor: string | null;
    }) => Promise<Record<string, unknown>> | Record<string, unknown>;
    getPcPriceStats?: (query: {
      canonicalProductId: string;
      marketPool: string;
      condition: string;
      currency: string;
      days: number;
    }) => Record<string, unknown> | null;
  } = {}
) {
  const resolvedOptions = {
    initializeStorage: options.initializeStorage ?? true,
    searchConcurrencyLimit: positiveInteger(options.searchConcurrencyLimit, WEB_BACKEND_CONFIG.search_concurrency_limit),
    searchRetryAfterSeconds: positiveInteger(options.searchRetryAfterSeconds, WEB_BACKEND_CONFIG.search_retry_after_seconds),
    exposeInternalErrorDetails: options.exposeInternalErrorDetails ?? WEB_BACKEND_CONFIG.expose_internal_error_details,
    corsAllowedOrigins: normalizeOrigins(options.corsAllowedOrigins ?? WEB_BACKEND_CONFIG.cors_allowed_origins),
    publicApiOnly: options.publicApiOnly ?? WEB_BACKEND_CONFIG.public_api_only,
    runWebSearch: options.runWebSearch ?? runWebSearch,
    runSearchOnly: options.runSearchOnly ?? runSearchOnly,
    listPcListings: options.listPcListings ?? (() => {
      const asOf = new Date().toISOString();
      return {
        items: [],
        total: 0,
        pagination: { has_more: false, next_cursor: null },
        as_of: asOf,
        freshness: { as_of: asOf, last_collected_at: null, age_seconds: null, state: 'EMPTY' }
      };
    }),
    getPcPriceStats: options.getPcPriceStats
  };

  const activeSearchKeys = new Map<string, number>();

  const acquireSearchSlot = (key: string, shareExisting: boolean) => {
    const activeCount = activeSearchKeys.get(key);
    if (shareExisting && activeCount !== undefined) {
      activeSearchKeys.set(key, activeCount + 1);
      return () => releaseSearchSlot(key);
    }
    if (activeSearchKeys.size >= resolvedOptions.searchConcurrencyLimit) return null;
    activeSearchKeys.set(key, 1);
    return () => releaseSearchSlot(key);
  };

  const releaseSearchSlot = (key: string) => {
    const activeCount = activeSearchKeys.get(key);
    if (activeCount === undefined || activeCount <= 1) activeSearchKeys.delete(key);
    else activeSearchKeys.set(key, activeCount - 1);
  };

  if (resolvedOptions.initializeStorage) {
    initializeResultStorage().catch(console.error);
  }

  const server = http.createServer(async (req, res) => {
    const requestId = randomUUID();
    res.setHeader('X-Used-Market-App', 'domestic');
    res.setHeader('X-Request-Id', requestId);
    const sendJson = (statusCode: number, data: unknown) => {
      const body = JSON.stringify(data, null, 2);
      res.statusCode = statusCode;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      if (statusCode !== 204) res.setHeader('Content-Length', Buffer.byteLength(body));
      res.end(req.method === 'HEAD' || statusCode === 204 ? undefined : body);
    };
    const sendRedirect = (location: string, statusCode = 301) => {
      res.statusCode = statusCode;
      res.setHeader('Location', location);
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      const body = `Moved to ${location}`;
      res.setHeader('Content-Length', Buffer.byteLength(body));
      res.end(req.method === 'HEAD' ? undefined : body);
    };

    const sendSearchCapacityError = () => {
      res.setHeader('Retry-After', String(resolvedOptions.searchRetryAfterSeconds));
      return sendJson(429, {
        status: 'error',
        error: 'Search capacity reached. Retry later.',
        code: 'SEARCH_CONCURRENCY_LIMIT',
        retry_after_seconds: resolvedOptions.searchRetryAfterSeconds
      });
    };

    try {
      const urlObj = new URL(req.url || '/', `http://${req.headers.host ?? 'localhost'}`);
      const pathname = urlObj.pathname;
      const searchParams = urlObj.searchParams;
      const allowedMethods = allowedMethodsForPath(pathname, resolvedOptions.publicApiOnly);
      const origin = typeof req.headers.origin === 'string' ? req.headers.origin : '';
      const originAllowed = origin
        ? isSameRequestOrigin(origin, req) || resolvedOptions.corsAllowedOrigins.has(normalizeOrigin(origin))
        : false;
      if (originAllowed) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
      }

      if (req.method === 'OPTIONS') {
        if (allowedMethods.length === 0) throw new ApiError(404, 'Not found');
        if (origin && !originAllowed) throw new ApiError(403, 'CORS preflight denied');
        const requestedMethod = String(req.headers['access-control-request-method'] || '').toUpperCase();
        if (requestedMethod && !allowedMethods.includes(requestedMethod)) {
          throw new ApiError(404, 'Not found');
        }
        const requestedHeaders = String(req.headers['access-control-request-headers'] || '')
          .split(',')
          .map((header) => header.trim().toLowerCase())
          .filter(Boolean);
        const supportedHeaders = new Set(['content-type', 'authorization', 'idempotency-key']);
        if (requestedHeaders.some((header) => !supportedHeaders.has(header))) {
          throw new ApiError(403, 'CORS preflight denied');
        }
        res.setHeader('Access-Control-Allow-Methods', `${allowedMethods.join(', ')}, OPTIONS`);
        if (requestedHeaders.length > 0) {
          res.setHeader('Access-Control-Allow-Headers', requestedHeaders.join(', '));
        }
        return sendJson(204, {});
      }

      if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'POST') {
        throw new ApiError(404, 'Not found', `Unsupported method: ${req.method ?? 'unknown'}`);
      }
      if (resolvedOptions.publicApiOnly && pathname.startsWith('/api/') && !allowedMethods.includes(req.method)) {
        throw new ApiError(404, 'Not found');
      }

      if (pathname === '/health') {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          throw new ApiError(404, 'Not found', `Unsupported method: ${req.method ?? 'unknown'}`);
        }
        return sendJson(200, {
          ok: true,
          app: 'domestic',
          timestamp: new Date().toISOString(),
          uptime_ms: Date.now() - serverStartTime
        });
      }

      if (pathname === '/used-market-categories.html') {
        return sendRedirect('/categories');
      }
      if (pathname === '/iphone-used-items.html') {
        return sendJson(410, {
          status: 'error',
          error: 'This legacy category is no longer provided',
          replacement: '/'
        });
      }
      const categoryRoute = pathname.match(/^\/categories\/([a-z-]+)$/u);
      if (categoryRoute) {
        const supportedRoutes = new Set(['cpu', 'gpu', 'ram', 'motherboard', 'ssd', 'hdd', 'psu']);
        if (!supportedRoutes.has(categoryRoute[1])) return sendJson(410, { status: 'error', error: 'Unsupported category route' });
        return await serveStaticAsset('/index.html', urlObj, res, req.method === 'HEAD', PC_CATEGORY_SEO[categoryRoute[1]]);
      }
      if (pathname === '/categories') {
        return await serveStaticAsset('/used-market-categories.html', urlObj, res, req.method === 'HEAD');
      }

      if (pathname === '/api/search') {
        if (req.method !== 'POST') {
          throw new ApiError(404, 'Not found', `Unsupported method: ${req.method ?? 'unknown'}`);
        }

        const payload = await readRequestJson(req);
        const releaseSlot = acquireSearchSlot(`web:${webSearchCollectionKey(payload)}`, true);
        if (!releaseSlot) return sendSearchCapacityError();
        try {
          return sendJson(200, await resolvedOptions.runWebSearch(payload));
        } finally {
          releaseSlot();
        }
      }

      if (pathname === '/api/search-only') {
        if (req.method !== 'POST') {
          throw new ApiError(404, 'Not found', `Unsupported method: ${req.method ?? 'unknown'}`);
        }

        const payload = await readRequestJson(req);
        const releaseSlot = acquireSearchSlot(`search-only:${randomUUID()}`, false);
        if (!releaseSlot) return sendSearchCapacityError();
        try {
          const result = await resolvedOptions.runSearchOnly(payload);
          const isPartial = result.data?.state === 'partial';
          return sendJson(result.status === 'success' || isPartial ? 200 : 503, result);
        } finally {
          releaseSlot();
        }
      }

      if (pathname === '/api/search-only/sources') {
        if (req.method !== 'GET') {
          throw new ApiError(404, 'Not found', `Unsupported method: ${req.method ?? 'unknown'}`);
        }

        return sendJson(200, { status: 'success', data: listSearchOnlySourceCatalog() });
      }

      if (pathname === '/api/categories') {
        if (req.method !== 'GET') {
          throw new ApiError(404, 'Not found', `Unsupported method: ${req.method ?? 'unknown'}`);
        }

        return sendJson(200, { status: 'success', data: publicCategoryCatalog() });
      }

      if (pathname === '/api/catalog/categories') {
        if (req.method !== 'GET') {
          throw new ApiError(404, 'Not found', `Unsupported method: ${req.method ?? 'unknown'}`);
        }
        const catalog = publicPcCatalogForApi();
        return sendJson(200, { status: 'success', categories: catalog.categories, data: { categories: catalog.categories } });
      }

      if (pathname === '/api/catalog/facets') {
        if (req.method !== 'GET') {
          throw new ApiError(404, 'Not found', `Unsupported method: ${req.method ?? 'unknown'}`);
        }
        try {
          const result = publicPcFacetsForApi(searchParams);
          return sendJson(200, { status: 'success', ...result, data: result });
        } catch (error) {
          throw new ApiError(400, error instanceof Error ? error.message : String(error));
        }
      }

      if (pathname === '/api/catalog/models') {
        if (req.method !== 'GET') {
          throw new ApiError(404, 'Not found', `Unsupported method: ${req.method ?? 'unknown'}`);
        }
        try {
          const result = publicPcModelsForApi(searchParams);
          const facets = publicPcFacetsForApi(searchParams);
          const payload = { ...result, available_facets: facets.available_facets };
          return sendJson(200, { status: 'success', ...payload, data: payload });
        } catch (error) {
          throw new ApiError(400, error instanceof Error ? error.message : String(error));
        }
      }

      if (pathname === '/api/pc/catalog') {
        return sendJson(200, { status: 'success', data: pcCatalogResponse() });
      }

      if (pathname === '/api/pc/products') {
        try {
          return sendJson(200, { status: 'success', data: pcProductsResponse(urlObj) });
        } catch (error) {
          throw new ApiError(400, error instanceof Error ? error.message : String(error));
        }
      }

      if (pathname === '/api/pc/listings') {
        const sites = [...new Set([...urlObj.searchParams.getAll('sites'), ...urlObj.searchParams.getAll('site')]
          .flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean))];
        const allowedSites = new Set<string>(OPERATIONAL_PC_DIRECTORY_SITES);
        if (sites.some((site) => !allowedSites.has(site))) throw new ApiError(400, 'unsupported site filter');
        const sort = urlObj.searchParams.get('sort') || 'recent';
        if (!new Set(['recent', 'price_asc', 'price_desc']).has(sort)) throw new ApiError(400, 'invalid sort');
        const parsePrice = (name: string) => {
          const raw = urlObj.searchParams.get(name);
          if (raw === null || raw === '') return null;
          const value = Number(raw);
          if (!Number.isFinite(value) || value < 0) throw new ApiError(400, `${name} must be a non-negative number`);
          return value;
        };
        const parseCanonicalPrice = (canonical: string, alias: string) => {
          const canonicalValue = urlObj.searchParams.get(canonical);
          return canonicalValue !== null ? parsePrice(canonical) : parsePrice(alias);
        };
        const minPrice = parseCanonicalPrice('price_min', 'min_price');
        const maxPrice = parseCanonicalPrice('price_max', 'max_price');
        if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) throw new ApiError(400, 'price_min must be <= price_max');
        const requestedLimit = Number(urlObj.searchParams.get('limit') || 30);
        if (!Number.isInteger(requestedLimit) || requestedLimit < 1) throw new ApiError(400, 'limit must be a positive integer');
        const canonicalProductId = urlObj.searchParams.get('canonical_product_id');
        const hasCatalogScope = urlObj.searchParams.has('category_code')
          || urlObj.searchParams.has('q') || urlObj.searchParams.has('query');
        if (canonicalProductId && hasCatalogScope) {
          throw new ApiError(400, 'canonical_product_id cannot be combined with catalog scope filters');
        }
        const catalogModels = hasCatalogScope ? publicPcModelsForApi(urlObj.searchParams).models : null;
        const data = await resolvedOptions.listPcListings({
          canonicalProductId,
          canonicalProductIds: catalogModels?.map((model: Record<string, unknown>) => String(model.canonical_product_id)) ?? null,
          manufacturer: hasCatalogScope ? null : urlObj.searchParams.get('manufacturer'),
          boardManufacturer: urlObj.searchParams.get('board_manufacturer'),
          sites,
          sort,
          minPrice,
          maxPrice,
          limit: Math.min(100, requestedLimit),
          cursor: urlObj.searchParams.get('cursor')
        });
        return sendJson(200, { status: 'success', data });
      }

      if (/^\/api\/products\/[^/]+\/price-stats$/u.test(pathname)) {
        if (req.method !== 'GET') {
          throw new ApiError(404, 'Not found', `Unsupported method: ${req.method ?? 'unknown'}`);
        }
        const originUrl = String(process.env.CLOUDFLARE_ORIGIN_URL || '').trim();
        const canonicalProductId = decodeURIComponent(pathname.split('/')[3] || '');
        const daysValue = Number(urlObj.searchParams.get('days') || 30);
        const days = Number.isInteger(daysValue) && daysValue > 0 ? daysValue : 30;
        const marketPool = urlObj.searchParams.get('market_pool') || 'KR_C2C_USED';
        const condition = urlObj.searchParams.get('condition') || 'USED_WORKING';
        const currency = urlObj.searchParams.get('currency') || 'KRW';
        const localStats = resolvedOptions.getPcPriceStats?.({
          canonicalProductId, marketPool, condition, currency, days
        });
        if (localStats) return sendJson(200, { status: 'success', data: localStats });
        const emptyStats = (reason: string) => ({
          status: 'success',
          data: {
            canonical_product_id: canonicalProductId,
            active: { sample_count: 0, median: null, mean: null },
            sold: { sample_count: 0, median: null, mean: null, disclosure: '실제 거래가격이 아니라 판매완료 직전 마지막 표시가격입니다.' },
            confirmed_transactions: { sample_count: 0, median: null, mean: null },
            by_source: [],
            by_manufacturer: [],
            daily: [],
            reference_price: { amount: null, currency, label: '최근 30일 판매완료 중앙값' },
            confidence: { level: '자료 부족', reasons: ['공개된 30일 표본이 없습니다.'] },
            exclusions: { total: 0, reasons: {} },
            availability: { status: 'unavailable', reason },
            as_of: new Date().toISOString()
          }
        });
        if (!/^https:\/\//u.test(originUrl)) return sendJson(200, emptyStats('LOCAL_PUBLICATION_NOT_CONFIGURED'));
        try {
          const target = new URL(`${pathname}${urlObj.search}`, originUrl);
          const response = await fetch(target, { headers: { accept: 'application/json' } });
          if (!response.ok) return sendJson(200, emptyStats(`PUBLICATION_UPSTREAM_${response.status}`));
          const responseBody = await response.text();
          res.statusCode = 200;
          res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', response.headers.get('cache-control') || 'no-store');
          res.end(responseBody);
          return;
        } catch {
          return sendJson(200, emptyStats('PUBLICATION_UPSTREAM_UNREACHABLE'));
        }
      }

      if (pathname === '/api/monetization/contextual-offer') {
        if (req.method !== 'POST') throw new ApiError(404, 'Not found');
        return sendJson(200, { status: 'success', data: { offer: null } });
      }

      if (pathname === '/api/monetization/event') {
        if (req.method !== 'POST') throw new ApiError(404, 'Not found');
        return sendJson(202, { status: 'accepted' });
      }

      if (pathname === '/api/feedback') {
        if (req.method !== 'POST') {
          throw new ApiError(404, 'Not found', `Unsupported method: ${req.method ?? 'unknown'}`);
        }

        const payload = await readRequestJson(req);
        return sendJson(201, {
          status: 'success',
          data: await saveUxFeedback(payload)
        });
      }

      if (pathname === '/api/feedback/summary') {
        if (req.method !== 'GET') {
          throw new ApiError(404, 'Not found', `Unsupported method: ${req.method ?? 'unknown'}`);
        }

        return sendJson(200, await getUxFeedbackSummary());
      }

      if (pathname === '/api/market/history') {
        if (req.method !== 'GET') {
          throw new ApiError(404, 'Not found', `Unsupported method: ${req.method ?? 'unknown'}`);
        }
        const keyword = searchParams.get('keyword')?.trim();
        if (!keyword) throw new ApiError(400, 'Invalid parameter', 'keyword is required');
        const days = parseOptionalInteger(searchParams.get('days'), 'days', 7, 90, 90) ?? 90;
        return sendJson(200, { status: 'success', data: await getPriceHistory(keyword, days) });
      }

      if (pathname === '/api/engine/status') {
        if (req.method !== 'GET') {
          throw new ApiError(404, 'Not found', `Unsupported method: ${req.method ?? 'unknown'}`);
        }
        return sendJson(200, await getEngineStatus());
      }

      if (pathname === '/api/runner/status') {
        if (req.method !== 'GET') {
          throw new ApiError(404, 'Not found', `Unsupported method: ${req.method ?? 'unknown'}`);
        }
        return sendJson(200, { status: 'success', data: getRunnerState() });
      }

      if (pathname === '/api/runner/run') {
        if (req.method !== 'POST') {
          throw new ApiError(404, 'Not found', `Unsupported method: ${req.method ?? 'unknown'}`);
        }

        const expectedToken = process.env.CLOUDFLARE_RUNNER_TOKEN?.trim();
        const authorization = req.headers.authorization ?? '';
        if (!expectedToken || authorization !== `Bearer ${expectedToken}`) {
          throw new ApiError(401, 'Unauthorized', 'Cloudflare runner token is missing or invalid');
        }

        const payload = await readRequestJson(req);
        const jobNames = Array.isArray(payload.job_names)
          ? payload.job_names.filter((value): value is string => typeof value === 'string').map((value) => value.trim()).filter(Boolean)
          : typeof payload.job_name === 'string' && payload.job_name.trim()
            ? [payload.job_name.trim()]
            : [];
        if (jobNames.length === 0) {
          throw new ApiError(400, 'Invalid runner request', 'job_name or job_names is required');
        }
        const headerIdempotencyKey = req.headers['idempotency-key'];
        const bodyIdempotencyKey = typeof payload.idempotency_key === 'string'
          ? payload.idempotency_key.trim()
          : '';
        const idempotencyKey = bodyIdempotencyKey || (typeof headerIdempotencyKey === 'string' ? headerIdempotencyKey.trim() : '');
        if (idempotencyKey.length > 256) {
          throw new ApiError(400, 'Invalid runner request', 'idempotency-key must be 256 characters or fewer');
        }

        let runnerResult;
        try {
          runnerResult = await runNamedSchedulerJobs(jobNames, { idempotencyKey: idempotencyKey || undefined });
        } catch (error) {
          if (error instanceof RunnerValidationError) {
            throw new ApiError(400, 'Invalid runner request', error.message, 'Use a scheduler job listed by GET /api/runner/status');
          }
          if (error instanceof RunnerIdempotencyConflictError) {
            throw new ApiError(409, 'Idempotency conflict', error.message, 'Use a new idempotency-key for a different scheduler job list');
          }
          throw error;
        }
        const responseStatus = runnerResult.status === 'failed' ? 502 : 200;
        return sendJson(responseStatus, {
          status: runnerResult.status === 'failed'
            ? 'error'
            : runnerResult.status === 'partial_success'
              ? 'warning'
              : 'success',
          data: runnerResult
        });
      }

      if (pathname === '/api/transaction/record') {
        if (req.method !== 'POST') {
          throw new ApiError(404, 'Not found', `Unsupported method: ${req.method ?? 'unknown'}`);
        }

        const payload = await readJsonBody(req);
        const record = await saveTransactionRecord(payload);
        return sendJson(201, {
          status: 'success',
          data: record
        });
      }

      const runIdOverride = searchParams.get('run_id');
      const latest = await readLatestModuleMap(runIdOverride ?? undefined);
      const siteFilters = parseSiteFilters(searchParams.get('site'), searchParams.get('sites'));

      if (pathname === '/api/merged/latest') {
        return sendJson(200, buildLatestMergedResponse(latest, siteFilters));
      }

      if (pathname === '/api/market/latest') {
        if (searchParams.get('group') === 'gpu') {
          const top = parseOptionalInteger(searchParams.get('top'), 'top', 1, 50);
          return sendJson(200, buildMarketByGpuResponse(latest, top, siteFilters));
        }

        return sendJson(200, buildLatestMarketResponse(latest, siteFilters));
      }

      if (pathname === '/api/market/by-gpu') {
        const top = parseOptionalInteger(searchParams.get('top'), 'top', 1, 50);
        return sendJson(200, buildMarketByGpuResponse(latest, top, siteFilters));
      }

      if (pathname === '/api/opportunities/latest') {
        const limit = parseOptionalInteger(
          searchParams.get('limit'),
          'limit',
          1,
        100,
        WEB_BACKEND_CONFIG.default_opportunities_limit
      ) ?? WEB_BACKEND_CONFIG.default_opportunities_limit;
      // 새로운 필터 파라미터
        const threshold = parseOptionalFloat(searchParams.get('threshold'), 'threshold', 0, 1);
        const listingTypeParam = searchParams.get('listing_type');
        const requestedListingTypes = splitListingTypeTokens(listingTypeParam ?? undefined);
        const listingTypes = parseListingTypes(listingTypeParam ?? undefined);
        if (requestedListingTypes && (!listingTypes || listingTypes.length !== requestedListingTypes.length)) {
          throw new ApiError(
            400,
            'Invalid listing_type filter',
            `Unsupported listing_type value: ${listingTypeParam}`,
            'Use one of full_pc, semi_pc, part, unknown'
          );
        }
        return sendJson(
          200,
          buildLatestOpportunitiesResponse(latest, limit, listingTypeParam, runIdOverride, siteFilters, threshold)
        );
      }

      if (pathname === '/api/collector/latest') {
        return sendJson(200, buildLatestCollectorResponse(latest, siteFilters));
      }

      if (pathname === '/api/transaction/history') {
        if (req.method !== 'GET') {
          throw new ApiError(404, 'Not found', `Unsupported method: ${req.method ?? 'unknown'}`);
        }

        const limit = parseOptionalInteger(searchParams.get('limit'), 'limit', 1, 100, 20) ?? 20;
        return sendJson(200, await buildTransactionHistoryResponse(searchParams.get('keyword'), limit));
      }

      if (pathname === '/api/status/summary') {
        return sendJson(200, await buildStatusSummaryResponse(latest));
      }

      const runMatch = pathname.match(/^\/api\/runs\/([^/]+)\/([^/]+)$/);
      if (runMatch) {
        const [, moduleName, runId] = runMatch;
        assertSafePathToken(moduleName, 'module');
        assertSafePathToken(runId, 'runId');
        return sendJson(200, await readSpecificRun(moduleName, runId));
      }

      if (req.method === 'GET' || req.method === 'HEAD') {
        return await serveStaticAsset(pathname, urlObj, res, req.method === 'HEAD');
      }

      throw new ApiError(404, 'Not found', `Unknown route: ${pathname}`);
    } catch (error) {
      if (error instanceof WebSearchValidationError) {
        return sendJson(400, {
          status: 'error',
          error: error.message
        });
      }
      if (error instanceof SearchOnlyValidationError) {
        return sendJson(400, {
          status: 'error',
          error: error.message
        });
      }
      if (error instanceof FeedbackValidationError) {
        return sendJson(400, {
          status: 'error',
          error: error.message
        });
      }
      if (error instanceof ApiError) {
        return sendJson(error.statusCode, {
          status: 'error',
          error: error.message,
          ...(error.details ? { details: error.details } : {}),
          ...(error.suggestion ? { suggestion: error.suggestion } : {})
        });
      }

      const err = error as Error;
      if (resolvedOptions.exposeInternalErrorDetails) {
        console.error('[web-backend] Server error:', err);
      } else {
        console.error('[web-backend] Server error', {
          request_id: requestId,
          error_name: err?.name || 'Error'
        });
      }
      return sendJson(500, {
        status: 'error',
        error: 'Internal error',
        ...(resolvedOptions.exposeInternalErrorDetails
          ? { details: err.message || 'Unexpected server failure' }
          : {})
      });
    }
  });

  server.listen(port, () => {
    console.log(`[web-backend] Listening on port ${port}`);
    console.log('[web-backend] Available endpoints:', ROUTE_DRAFTS);
  });

  return server;
}

function buildLatestMergedResponse(latest: LatestModuleMap, siteFilters?: string[]): LatestMergedResponse {
  const mergedModule = pickPreferredMergedModule(latest);
  if (!mergedModule) {
    throw new ApiError(404, 'No merged results found', undefined, 'Run merge module first');
  }

  const output = mergedModule.output;
  const mergedItems = coerceMergedItems(
    getArray(output, 'merged_items') ??
      getArray(getObject(output, 'merged_result') ?? {}, 'merged_items') ??
      []
  );
  const filteredItems = filterMergedItemsBySite(mergedItems, siteFilters);

  return {
    status: 'success',
    data: {
      keyword: readKeyword(output),
      run_id: mergedModule.runId,
      modules: buildModuleStats(output),
      merged_items: filteredItems,
      quality_metrics: calculateQualityMetrics(filteredItems),
      api_status: buildApiStatusSummary(output, filteredItems.length)
    }
  };
}

function buildLatestMarketResponse(latest: LatestModuleMap, siteFilters?: string[]): LatestMarketResponse {
  const marketModule = latest.market;
  const mergedModule = latest.merged ?? latest.merge;
  const marketOutput = marketModule?.output ?? {};

  const fallbackMergedItems = mergedModule
    ? coerceMergedItems(
        getArray(mergedModule.output, 'merged_items') ??
          getArray(getObject(mergedModule.output, 'merged_result') ?? {}, 'merged_items') ??
          []
      )
    : [];

  const normalizedItems = filterNormalizedItemsBySite(
    coerceNormalizedItems(marketOutput, fallbackMergedItems),
    siteFilters
  );
  if (!marketModule && !mergedModule) {
    throw new ApiError(404, 'No market data found', undefined, 'Run market or merge module first');
  }

  const prices = normalizedItems
    .map((item) => item.price_value)
    .filter((price): price is number => typeof price === 'number' && price > 0);

  const response: LatestMarketResponse = {
    status: 'success',
    data: {
      keyword: readKeyword(marketOutput, mergedModule?.output),
      run_id: marketModule?.runId ?? mergedModule?.runId ?? 'unknown',
      normalized_items: normalizedItems.map((item) => ({
        title: item.title,
        price_value: item.price_value,
        components: item.components.map((component) => ({
          canonical_name: component.canonical_name
        })),
        ...(item.site ? { site: item.site } : {}),
        ...(item.listing_type ? { listing_type: item.listing_type } : {})
      })),
      statistics: {
        total_count: normalizedItems.length,
        avg_price: average(prices),
        min_price: prices.length > 0 ? Math.min(...prices) : 0,
        max_price: prices.length > 0 ? Math.max(...prices) : 0,
        price_std_dev: standardDeviation(prices)
      },
      api_status: buildApiStatusSummary(marketOutput, normalizedItems.length)
    }
  };

  return response;
}

function buildMarketByGpuResponse(latest: LatestModuleMap, top?: number, siteFilters?: string[]): MarketByGpuResponse {
  const mergedModule = latest.merged ?? latest.merge;
  const sourceItems = filterMergedItemsBySite(coerceMergedItemsFromAny(latest), siteFilters);

  if (sourceItems.length === 0) {
    throw new ApiError(404, 'No market data found', undefined, 'Run market or merge module first');
  }

  const gpuSummary: Record<string, GPUSummary> = {};

  for (const item of sourceItems) {
    for (const component of item.components ?? []) {
      if (component.component_type !== 'gpu' || !component.canonical_name) continue;

      if (!gpuSummary[component.canonical_name]) {
        gpuSummary[component.canonical_name] = {
          count: 0,
          avg_price: 0,
          min_price: Number.POSITIVE_INFINITY,
          max_price: Number.NEGATIVE_INFINITY,
          sites: [],
          confidence_avg: 0
        };
      }

      const summary = gpuSummary[component.canonical_name];
      summary.count += 1;
      summary.avg_price += numericValue(item.price_value);
      summary.min_price = Math.min(summary.min_price, numericValue(item.price_value));
      summary.max_price = Math.max(summary.max_price, numericValue(item.price_value));
      summary.confidence_avg += numericValue(component.confidence);

      if (item.site && !summary.sites.includes(item.site)) {
        summary.sites.push(item.site);
      }
    }
  }

  for (const summary of Object.values(gpuSummary)) {
    summary.avg_price = summary.count > 0 ? Math.round(summary.avg_price / summary.count) : 0;
    summary.confidence_avg = summary.count > 0 ? round(summary.confidence_avg / summary.count, 2) : 0;
    summary.min_price = Number.isFinite(summary.min_price) ? summary.min_price : 0;
    summary.max_price = Number.isFinite(summary.max_price) ? summary.max_price : 0;
  }

  const sortedEntries = Object.entries(gpuSummary).sort(([, left], [, right]) => {
    if (right.avg_price !== left.avg_price) return right.avg_price - left.avg_price;
    return right.count - left.count;
  });

  const gpu_summary = Object.fromEntries(top ? sortedEntries.slice(0, top) : sortedEntries);

  return {
    status: 'success',
    data: {
      timestamp: new Date().toISOString(),
      gpu_summary,
      api_status: buildApiStatusSummary(mergedModule?.output ?? {}, sourceItems.length)
    }
  };
}

function buildLatestOpportunitiesResponse(
  latest: LatestModuleMap,
  limit: number,
  listingTypeFilter?: string | null,
  runIdOverride?: string | null,
  siteFilters?: string[],
  threshold?: number
): LatestOpportunitiesResponse {
  const mergedModule = pickPreferredMergedModule(latest);
  if (!mergedModule) {
    throw new ApiError(404, 'No merged results found', undefined, 'Run merge module first');
  }

  // listing_type 필터 파싱
  const listingTypes = parseListingTypes(listingTypeFilter ?? undefined);

  let mergedItems = filterMergedItemsBySite(coerceMergedItemsFromAny(latest), siteFilters);
  // listing_type 필터 적용
  if (listingTypes && listingTypes.length > 0) {
    mergedItems = mergedItems.filter((item) => matchesListingTypeFilter(item, listingTypes));
  }

  if (typeof threshold === 'number') {
    mergedItems = mergedItems.filter((item) => computeOpportunityScore(item) >= threshold);
  }

  const recommendedItems = mergedItems.filter((item) => shouldRecommendOpportunity(item));

  const opportunities = recommendedItems
    .map((item) => {
      const score = computeOpportunityScore(item);
      const baselinePrice = item.baseline_price ?? calculateBaselinePrice(item);
      const discountRate = baselinePrice > 0
        ? Math.round(((baselinePrice - item.price_value) / baselinePrice) * 100)
        : 0;
      const scoreReason = item.score_reason ?? buildOpportunityReason(item, score);

      return {
        rank: 0,
        opportunity_score: score,
        score_reason: scoreReason,
        baseline_price: baselinePrice,
        discount_rate: discountRate,
        title: item.title,
        price: numericValue(item.price_value),
        seller: item.seller_name,
        site: item.site,
        url: item.url,
        reason: scoreReason,
        components_count: item.components.length,
        listing_type: item.listing_type
      };
    })
    .sort((left, right) => {
      if (right.opportunity_score !== left.opportunity_score) {
        return right.opportunity_score - left.opportunity_score;
      }
      return left.price - right.price;
    })
    .map((item, index) => ({
      ...item,
      rank: index + 1
    }))
    .slice(0, limit);

  return {
    status: 'success',
    data: {
      opportunities,
      total_count: recommendedItems.length,
      timestamp: new Date().toISOString(),
      api_status: buildApiStatusSummary(mergedModule.output, mergedItems.length),
      filters_applied: {
        ...(listingTypes && listingTypes.length > 0 ? { listing_type: listingTypes as any } : {}),
        ...(runIdOverride ? { run_id: runIdOverride } : {}),
        ...(siteFilters && siteFilters.length > 0 ? { sites: siteFilters } : {}),
        ...(typeof threshold === 'number' ? { threshold } : {})
      }
    }
  };
}

function buildLatestCollectorResponse(latest: LatestModuleMap, siteFilters?: string[]) {
  const collectorModule = latest.collector;
  if (!collectorModule) {
    throw new ApiError(404, 'No collector results found', undefined, 'Run collector search first');
  }

  const output = collectorModule.output;
  const items = filterCollectorItemsBySite(getArray(output, 'items') ?? [], siteFilters);

  return {
    status: 'success',
    data: {
      site: readString(output, 'site', 'unknown'),
      keyword: readString(output, 'keyword', 'unknown'),
      login_status: readString(output, 'login_status', 'unknown'),
      items_count: items.length,
      items,
      api_status: buildApiStatusSummary(output, items.length)
    }
  };
}

function buildModuleStats(output: JsonRecord): Record<string, { status: 'ok' | 'warning' | 'error'; items_count: number; run_id?: string }> {
  const modules = getObject(output, 'modules');
  if (!modules) {
    return {};
  }

  const stats: Record<string, { status: 'ok' | 'warning' | 'error'; items_count: number; run_id?: string }> = {};
  for (const [moduleName, rawValue] of Object.entries(modules)) {
    const moduleValue = isRecord(rawValue) ? rawValue : {};
    const status = normalizeModuleStatus(readString(moduleValue, 'status', 'warning'));
    const items_count = numericValue(moduleValue.items_count);
    const run_id = readOptionalString(moduleValue, 'run_id');

    stats[moduleName] = {
      status,
      items_count,
      ...(run_id ? { run_id } : {})
    };
  }

  return stats;
}

function calculateQualityMetrics(items: MergedItem[]) {
  const sites = new Set(items.map((item) => item.site).filter(Boolean));
  const itemsWithUrl = items.filter((item) => Boolean(item.url)).length;
  const itemsWithPrice = items.filter((item) => numericValue(item.price_value) > 0).length;

  return {
    total_items: items.length,
    sites: sites.size,
    items_with_url: itemsWithUrl,
    items_with_price: itemsWithPrice
  };
}

async function initializeResultStorage() {
  try {
    const now = new Date();
    const isoStr = now.toISOString();
    const runId = `${isoStr.replace(/[:.]/g, '-').split('Z')[0]}Z__web-backend__start`;
    const resultDir = resolve(resultBaseDir(), 'web-backend', runId);
    await mkdir(resultDir, { recursive: true });

    const latest = await readLatestModuleMap();
    const outputJson = {
      timestamp: isoStr,
      available_endpoints: ROUTE_DRAFTS,
      data_source: WEB_BACKEND_CONFIG.merge_result_base,
      server_uptime_ms: 0,
      module_data_status: {
        collector: latest.collector ? 'available' : 'missing',
        market: latest.market ? 'available' : 'missing',
        merge: latest.merge ? 'available' : 'missing',
        merged: latest.merged ? 'available' : 'missing',
        MCP: latest.MCP ? 'available' : 'missing'
      }
    };

    const summaryJson = {
      module: 'web-backend',
      command: 'start',
      status: 'success',
      run_id: runId,
      created_at: isoStr,
      port: WEB_BACKEND_CONFIG.port,
      endpoints_active: ROUTE_DRAFTS.length
    };

    const reportMd = [
      '# Run Report',
      '',
      '- module: web-backend',
      '- command: start',
      `- run_id: ${runId}`,
      `- port: ${WEB_BACKEND_CONFIG.port}`,
      '',
      '## Notes',
      '- startup snapshot written',
      '- output.json and run-summary.json generated'
    ].join('\n');

    await writeFile(resolve(resultDir, 'output.json'), JSON.stringify(outputJson, null, 2), 'utf-8');
    await writeFile(resolve(resultDir, 'run-summary.json'), JSON.stringify(summaryJson, null, 2), 'utf-8');
    await writeFile(resolve(resultDir, 'report.md'), reportMd, 'utf-8');
    console.log(`[web-backend] Result saved to ${resultDir}`);
  } catch (error) {
    console.error('[web-backend] Failed to initialize result storage:', error);
  }
}

async function readLatestModuleMap(runIdOverride?: string): Promise<LatestModuleMap> {
  const latest: LatestModuleMap = {
    collector: await readLatestModuleResult('collector'),
    market: await readLatestModuleResult('market'),
    merge: await readLatestModuleResult('merge'),
    merged: await readLatestModuleResult('merged'),
    MCP: await readLatestModuleResult('MCP')
  };

  if (!runIdOverride) {
    return latest;
  }

  const overrideModuleName = getModuleNameFromRunId(runIdOverride);
  if (!overrideModuleName) {
    throw new ApiError(400, 'Invalid parameter', `run_id has invalid format: ${runIdOverride}`);
  }

  const overrideResult = await readRunFiles(overrideModuleName, runIdOverride);
  if (!overrideResult) {
    throw new ApiError(
      404,
      'Run not found',
      `No run data found for run_id='${runIdOverride}'`,
      'Check merge/result and verify the requested run id'
    );
  };

  latest[overrideModuleName] = overrideResult;
  return latest;
}

async function readLatestModuleResult(moduleName: string): Promise<LatestModuleResult | null> {
  const moduleDir = resolve(resultBaseDir(), moduleName);
  const runIds = await listDirectories(moduleDir);
  const latestRunId = runIds.sort().reverse()[0];
  if (!latestRunId) {
    return null;
  }

  return readRunFiles(moduleName, latestRunId);
}

async function readSpecificRun(moduleName: string, runId: string) {
  const runResult = await readRunFiles(moduleName, runId);
  if (!runResult) {
    throw new ApiError(
      404,
      'Run not found',
      `No run data found for module='${moduleName}', runId='${runId}'`,
      'Check merge/result and verify the requested run id'
    );
  }

  return {
    status: readRunStatus(runResult.summary),
    data: {
      run_id: runResult.runId,
      module: runResult.moduleName,
      timestamp: new Date().toISOString(),
      output: runResult.output,
      summary: runResult.summary ?? { error: 'run-summary.json not found' }
    }
  };
}

async function readRunFiles(moduleName: string, runId: string): Promise<LatestModuleResult | null> {
  const runDir = resolve(resultBaseDir(), moduleName, runId);
  if (!isWithinBaseDir(runDir)) {
    throw new ApiError(400, 'Invalid parameter', `Unsafe ${moduleName}/${runId} path requested`);
  }

  const output = await readJsonFile(resolve(runDir, 'output.json'));
  const summary = await readJsonFile(resolve(runDir, 'run-summary.json'));
  if (!output) {
    return null;
  }

  return {
    moduleName,
    runId,
    output,
    summary
  };
}

async function readJsonFile(filePath: string): Promise<JsonRecord | null> {
  try {
    const raw = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(stripBom(raw)) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function listDirectories(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

function resultBaseDir() {
  return resolve(process.cwd(), WEB_BACKEND_CONFIG.merge_result_base);
}

function isWithinBaseDir(targetPath: string) {
  const baseDir = resultBaseDir();
  const relative = targetPath.slice(baseDir.length);
  return targetPath === baseDir || (targetPath.startsWith(baseDir) && !relative.startsWith('..'));
}

function assertSafePathToken(value: string, name: string) {
  if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new ApiError(400, 'Invalid parameter', `${name} contains unsupported characters`);
  }
}

function parseOptionalInteger(
  rawValue: string | null,
  fieldName: string,
  min: number,
  max: number,
  defaultValue?: number
) {
  if (rawValue === null || rawValue === '') {
    return defaultValue;
  }

  if (!/^\d+$/.test(rawValue)) {
    throw new ApiError(400, 'Invalid parameter', `${fieldName} must be an integer between ${min} and ${max}`);
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (parsed < min || parsed > max) {
    throw new ApiError(400, 'Invalid parameter', `${fieldName} must be between ${min} and ${max}`);
  }

  return parsed;
}

function parseOptionalFloat(
  rawValue: string | null,
  fieldName: string,
  min: number,
  max: number
) {
  if (rawValue === null || rawValue === '') {
    return undefined;
  }

  const parsed = Number.parseFloat(rawValue);
  if (!Number.isFinite(parsed)) {
    throw new ApiError(400, 'Invalid parameter', `${fieldName} must be a number between ${min} and ${max}`);
  }

  if (parsed < min || parsed > max) {
    throw new ApiError(400, 'Invalid parameter', `${fieldName} must be between ${min} and ${max}`);
  }

  return parsed;
}

function coerceMergedItemsFromAny(latest: LatestModuleMap) {
  const mergedOutput = pickPreferredMergedModule(latest)?.output ?? {};
  return coerceMergedItems(
    getArray(mergedOutput, 'merged_items') ??
      getArray(getObject(mergedOutput, 'merged_result') ?? {}, 'merged_items') ??
      []
  );
}

function coerceMergedItems(rawItems: unknown[]): MergedItem[] {
  return rawItems
    .filter(isRecord)
    .map((item) => ({
      site: readString(item, 'site', ''),
      title: readString(item, 'title', ''),
      price_value: numericValue(item.price_value),
      currency: readString(item, 'currency', 'KRW'),
      seller_name: readString(item, 'seller_name', ''),
      location: readOptionalString(item, 'location'),
      url: readString(item, 'url', ''),
      components: coerceComponents(item.components),
      listing_type: readListingType(item.listing_type),
      opportunity_score:
        typeof item.opportunity_score === 'number'
          ? item.opportunity_score
          : typeof item.score_hint === 'number'
            ? round(item.score_hint / 100, 2)
            : undefined,
      score_reason: readOptionalString(item, 'score_reason'),
      baseline_price: readOptionalNumber(item, 'baseline_price'),
      deviation_rate: readOptionalNumber(item, 'deviation_rate'),
      noise_filtered: readOptionalBoolean(item, 'noise_filtered'),
      noise_filter_reason: readOptionalString(item, 'noise_filter_reason'),
      seller_upload_count: readOptionalNumber(item, 'seller_upload_count'),
      fraud_risk_score: readOptionalNumber(item, 'fraud_risk_score'),
      fraud_flags: readStringArray(item, 'fraud_flags')
    }));
}

function coerceNormalizedItems(marketOutput: JsonRecord, fallbackMergedItems: MergedItem[]): NormalizedItemView[] {
  const normalizedResults = getArray(marketOutput, 'normalized_results');
  if (normalizedResults && normalizedResults.length > 0) {
    return normalizedResults
      .filter(isRecord)
      .flatMap((result) => {
        const normalizedItems = getArray(result, 'normalized_items') ?? [];
        return normalizedItems
          .filter(isRecord)
          .map((item) => ({
            title: readString(item, 'title', ''),
            price_value: numericValue(item.price_value),
            components: coerceComponents(item.components),
            site: readOptionalString(result, 'site'),
            listing_type: readListingType(item.listing_type)
          }));
      });
  }

  const mergedItems = getArray(getObject(marketOutput, 'merged_result') ?? {}, 'merged_items');
  if (mergedItems) {
    return coerceMergedItems(mergedItems).map((item) => ({
      title: item.title,
      price_value: item.price_value,
      components: item.components,
      site: item.site,
      listing_type: item.listing_type
    }));
  }

  return fallbackMergedItems.map((item) => ({
    title: item.title,
    price_value: item.price_value,
    components: item.components,
    site: item.site,
    listing_type: item.listing_type
  }));
}

function coerceComponents(rawValue: unknown): Component[] {
  if (!Array.isArray(rawValue)) {
    return [];
  }

  return rawValue.filter(isRecord).map((component) => ({
    component_type: readString(component, 'component_type', 'unknown'),
    canonical_name: readString(component, 'canonical_name', ''),
    confidence: typeof component.confidence === 'number' ? component.confidence : 0
  }));
}

function filterMergedItemsBySite(items: MergedItem[], siteFilters?: string[]) {
  if (!siteFilters || siteFilters.length === 0) {
    return items;
  }

  return items.filter((item) => siteFilters.includes(item.site));
}

function compareRunIds(left?: string, right?: string) {
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  return left.localeCompare(right);
}

function pickPreferredMergedModule(latest: LatestModuleMap) {
  if (!latest.merged) return latest.merge;
  if (!latest.merge) return latest.merged;
  return compareRunIds(latest.merged.runId, latest.merge.runId) >= 0 ? latest.merged : latest.merge;
}

function matchesListingTypeFilter(item: MergedItem, listingTypes: string[]) {
  const normalizedListingType = item.listing_type ?? 'unknown';
  return listingTypes.some((type) => normalizedListingType === type);
}

function filterNormalizedItemsBySite(items: NormalizedItemView[], siteFilters?: string[]) {
  if (!siteFilters || siteFilters.length === 0) {
    return items;
  }

  return items.filter((item) => item.site && siteFilters.includes(item.site));
}

function filterCollectorItemsBySite(items: unknown[], siteFilters?: string[]) {
  if (!siteFilters || siteFilters.length === 0) {
    return items;
  }

  return items.filter((item) => {
    if (!isRecord(item)) return false;
    const sourceSite = readOptionalString(item, 'site');
    return sourceSite ? siteFilters.includes(sourceSite) : true;
  });
}

function buildApiStatusSummary(output: JsonRecord, itemCount: number): ApiStatusSummary {
  const warnings = getArray(output, 'warnings') ?? [];
  const errors = getArray(output, 'errors') ?? [];
  const providerStatus =
    readOptionalString(output, 'login_status') ??
    readOptionalString(getObject(output, 'provider_check') ?? {}, 'status');

  return {
    item_count: itemCount,
    warnings_count: warnings.length,
    errors_count: errors.length,
    ...(providerStatus ? { provider_status: providerStatus } : {})
  };
}

function computeOpportunityScore(item: MergedItem) {
  if (item.noise_filtered) {
    return 0;
  }

  const baseScore = typeof item.opportunity_score === 'number'
    ? round(item.opportunity_score, 2)
    : (() => {
        const price = numericValue(item.price_value);
        const priceScore = price > 0 ? Math.max(0.1, Math.min(1, 1 - price / 1000000)) : 0.1;
        const componentScore = Math.min(0.35, item.components.length * 0.08);
        const confidenceScore =
          item.components.length > 0
            ? Math.min(
                0.25,
                item.components.reduce((sum, component) => sum + numericValue(component.confidence), 0) /
                  item.components.length /
                  4
              )
            : 0;

        return round(Math.min(0.99, priceScore * 0.5 + componentScore + confidenceScore), 2);
      })();

  const sellerUploadCount = numericValue(item.seller_upload_count);
  const uploadPenalty =
    sellerUploadCount >= 7 ? 0.25
      : sellerUploadCount >= 4 ? 0.12
      : sellerUploadCount >= 3 ? 0.06
      : 0;
  const dealerPenalty = hasDealerLikeSellerName(item) ? 0.1 : 0;
  const fraudPenalty = Math.min(0.2, numericValue(item.fraud_risk_score) * 0.25);

  return round(Math.max(0.01, Math.min(0.99, baseScore - uploadPenalty - dealerPenalty - fraudPenalty)), 2);
}

function hasDealerLikeSellerName(item: Pick<MergedItem, 'seller_name'>) {
  return DEALER_SELLER_PATTERN.test(item.seller_name ?? '');
}

function shouldRecommendOpportunity(item: MergedItem) {
  if (item.noise_filtered) {
    return false;
  }

  const sellerUploadCount = numericValue(item.seller_upload_count);
  if (sellerUploadCount >= 7) {
    return false;
  }

  if (sellerUploadCount >= 3 && hasDealerLikeSellerName(item)) {
    return false;
  }

  return true;
}

/**
 * 기준 가격 계산 (동일한 부품 구성을 가진 상품들의 평균)
 */
function calculateBaselinePrice(item: MergedItem): number {
  // 부품이 없으면 현재 가격의 120%를 기준으로
  if (item.components.length === 0) {
    return Math.round(numericValue(item.price_value) * 1.2);
  }

  // GPU 구성이 있는 경우 일반적인 상대 가격 가이드라인 기반 계산
  const hasGpu = item.components.some(c => c.component_type === 'gpu');
  const hasMultiComponent = item.components.length >= 3;

  if (hasGpu && hasMultiComponent) {
    // 멀티 부품 + GPU: 현재 가격의 125%
    return Math.round(numericValue(item.price_value) * 1.25);
  } else if (hasGpu) {
    // GPU만: 현재 가격의 120%
    return Math.round(numericValue(item.price_value) * 1.20);
  } else if (hasMultiComponent) {
    // 멀티 부품 (GPU 없음): 현재 가격의 115%
    return Math.round(numericValue(item.price_value) * 1.15);
  }

  // 단품: 현재 가격의 110%
  return Math.round(numericValue(item.price_value) * 1.10);
}

function buildOpportunityReason(item: MergedItem, score: number) {
  const reasons: string[] = [];
  if (item.components.length >= 3) reasons.push('multi-component listing');
  if (numericValue(item.price_value) > 0 && numericValue(item.price_value) <= 200000) reasons.push('lower price band');
  if (item.components.some((component) => component.component_type === 'gpu')) reasons.push('GPU detected');
  if (reasons.length === 0) reasons.push('ranked by merged listing heuristics');
  return `${reasons.join(', ')} (score ${score})`;
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function standardDeviation(values: number[]) {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / values.length;
  return Math.round(Math.sqrt(variance));
}

function readKeyword(...outputs: Array<JsonRecord | undefined>) {
  for (const output of outputs) {
    if (!output) continue;
    const metadata = getObject(output, 'metadata');
    if (metadata && typeof metadata.keyword === 'string') {
      return metadata.keyword;
    }

    if (typeof output.keyword === 'string') {
      return output.keyword;
    }

    const mergedResult = getObject(output, 'merged_result');
    if (mergedResult && typeof mergedResult.keyword === 'string') {
      return mergedResult.keyword;
    }

    const marketSnapshot = getObject(output, 'market_snapshot');
    if (marketSnapshot && typeof marketSnapshot.keyword === 'string') {
      return marketSnapshot.keyword;
    }
  }

  return 'unknown';
}

function normalizeModuleStatus(value: string): 'ok' | 'warning' | 'error' {
  if (value === 'ok' || value === 'warning' || value === 'error') {
    return value;
  }

  if (value === 'success') return 'ok';
  return 'warning';
}

function numericValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function stripBom(value: string) {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getObject(source: JsonRecord, key: string) {
  const value = source[key];
  return isRecord(value) ? value : null;
}

function getArray(source: JsonRecord, key: string) {
  const value = source[key];
  return Array.isArray(value) ? value : null;
}

function readString(source: JsonRecord, key: string, fallback: string) {
  return typeof source[key] === 'string' ? (source[key] as string) : fallback;
}

function readOptionalString(source: JsonRecord, key: string) {
  return typeof source[key] === 'string' ? (source[key] as string) : undefined;
}

async function readRequestJson(req: http.IncomingMessage): Promise<JsonRecord> {
  const declaredLength = Number(req.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BODY_BYTES) {
    throw new ApiError(413, 'Payload too large', `Request body must be ${MAX_REQUEST_BODY_BYTES} bytes or fewer`);
  }
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > MAX_REQUEST_BODY_BYTES) {
      throw new ApiError(413, 'Payload too large', `Request body must be ${MAX_REQUEST_BODY_BYTES} bytes or fewer`);
    }
    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString('utf-8').trim();
  if (!raw) {
    throw new ApiError(400, 'Invalid parameter', 'Request body must be a JSON object');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ApiError(400, 'Invalid parameter', 'Request body must be valid JSON');
  }

  if (!isRecord(parsed)) {
    throw new ApiError(400, 'Invalid parameter', 'Request body must be a JSON object');
  }

  return parsed;
}

function readRunStatus(summary: JsonRecord | null) {
  const status = typeof summary?.status === 'string' ? summary.status : 'success';
  if (status === 'failed' || status === 'validation_failed') return 'error';
  if (status === 'partial_success') return 'warning';
  return 'success';
}

async function readJsonBody(req: http.IncomingMessage): Promise<TransactionRecordInput> {
  return validateTransactionInput(await readRequestJson(req));
}

function escapeHtml(value: string) {
  return value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;');
}

function applyPcCategorySeo(html: string, seo: PcCategorySeo) {
  const title = escapeHtml(seo.title);
  const description = escapeHtml(seo.description);
  const canonical = escapeHtml(seo.canonical);
  const intro = escapeHtml(seo.intro);
  let result = html
    .replace(/<meta name="description" content="[^"]*" \/>/u, `<meta name="description" content="${description}" />`)
    .replace(/<link rel="canonical" href="[^"]*" \/>/u, `<link rel="canonical" href="${canonical}" />`)
    .replace(/<meta property="og:title" content="[^"]*" \/>/u, `<meta property="og:title" content="${title}" />`)
    .replace(/<meta property="og:description" content="[^"]*" \/>/u, `<meta property="og:description" content="${description}" />`)
    .replace(/<meta property="og:url" content="[^"]*" \/>/u, `<meta property="og:url" content="${canonical}" />`)
    .replace(/<meta name="twitter:title" content="[^"]*" \/>/u, `<meta name="twitter:title" content="${title}" />`)
    .replace(/<meta name="twitter:description" content="[^"]*" \/>/u, `<meta name="twitter:description" content="${description}" />`)
    .replace(/<title>[^<]*<\/title>/u, `<title>${title}</title>`)
    .replace(/<h1 id="workspace-title">[^<]*<\/h1>/u, `<h1 id="workspace-title">${escapeHtml(`중고 ${seo.label} 검색`)}</h1>`)
    .replace(/<p class="workspace-intro" id="workspace-intro">[^<]*<\/p>/u, `<p class="workspace-intro" id="workspace-intro">${intro}</p>`);

  const structuredDataMatch = result.match(/(<script type="application\/ld\+json">\s*)([\s\S]*?)(\s*<\/script>)/u);
  if (structuredDataMatch) {
    try {
      const structuredData = JSON.parse(structuredDataMatch[2]) as Record<string, unknown>;
      structuredData.url = seo.canonical;
      structuredData['@id'] = `${seo.canonical}#website`;
      structuredData.name = seo.title;
      structuredData.description = seo.description;
      result = result.replace(
        structuredDataMatch[0],
        `${structuredDataMatch[1]}${JSON.stringify(structuredData, null, 2)}${structuredDataMatch[3]}`
      );
    } catch {
      // Keep the original document if structured-data parsing ever encounters a hand-edited page.
    }
  }

  return result;
}

async function serveStaticAsset(
  pathname: string,
  requestUrl: URL,
  res: http.ServerResponse,
  headOnly = false,
  pageSeo?: PcCategorySeo
) {
  const defaultPublic = resolve(process.cwd(), 'web-backend/public');
  const domesticPublic = resolve(process.cwd(), 'used_market_gemini_cli_full_docs/apps/domestic/web-backend/public');
  const publicRoot = existsSync(defaultPublic) ? defaultPublic : domesticPublic;
  const requestedPath = pathname === '/' ? '/index.html' : pathname;
  const filePath = resolve(publicRoot, `.${requestedPath}`);
  if (filePath !== publicRoot && !filePath.startsWith(`${publicRoot}\\`) && !filePath.startsWith(`${publicRoot}/`)) {
    throw new ApiError(403, 'Forbidden');
  }

  let fileInfo;
  try {
    fileInfo = await stat(filePath);
  } catch {
    throw new ApiError(404, 'Not found', `Unknown route: ${pathname}`);
  }
  if (!fileInfo.isFile()) {
    throw new ApiError(404, 'Not found', `Unknown route: ${pathname}`);
  }

  const contentTypes: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.xml': 'application/xml; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.webp': 'image/webp'
  };
  const extension = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  let content = await readFile(filePath);
  if (pageSeo && extension === '.html') {
    content = Buffer.from(applyPcCategorySeo(content.toString('utf8'), pageSeo), 'utf8');
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', contentTypes[extension] ?? 'application/octet-stream');
  res.setHeader('Cache-Control', extension === '.html' ? 'no-store' : 'public, max-age=300');
  res.setHeader('Content-Length', content.length);
  res.end(headOnly ? undefined : content);
}

function validateTransactionInput(input: JsonRecord): TransactionRecordInput {
  const itemId = readOptionalString(input, 'item_id');
  if (!itemId) {
    throw new ApiError(400, 'Invalid parameter', 'item_id is required');
  }

  const actualDealPrice = readOptionalNumber(input, 'actual_deal_price');
  const actualSellPrice = readOptionalNumber(input, 'actual_sell_price');
  const daysToSell = readOptionalNumber(input, 'days_to_sell');

  if (actualDealPrice === undefined || actualDealPrice <= 0) {
    throw new ApiError(400, 'Invalid parameter', 'actual_deal_price must be a positive number');
  }

  if (actualSellPrice === undefined || actualSellPrice < 0) {
    throw new ApiError(400, 'Invalid parameter', 'actual_sell_price must be zero or greater');
  }

  if (daysToSell === undefined || daysToSell < 0 || !Number.isInteger(daysToSell)) {
    throw new ApiError(400, 'Invalid parameter', 'days_to_sell must be a non-negative integer');
  }

  const finalNetProfit = readOptionalNumber(input, 'final_net_profit');
  if (finalNetProfit === undefined) {
    throw new ApiError(400, 'Invalid parameter', 'final_net_profit is required');
  }

  if (!Array.isArray(input.issues)) {
    throw new ApiError(400, 'Invalid parameter', 'issues must be an array');
  }

  const issues = input.issues.map((issue, index) => {
    if (typeof issue !== 'string') {
      throw new ApiError(400, 'Invalid parameter', `issues[${index}] must be a string`);
    }

    return issue;
  });

  return {
    item_id: itemId,
    actual_deal_price: actualDealPrice,
    actual_sell_price: actualSellPrice,
    days_to_sell: daysToSell,
    final_net_profit: finalNetProfit,
    issues,
    keyword: readOptionalString(input, 'keyword'),
    site: readOptionalString(input, 'site'),
    title: readOptionalString(input, 'title'),
    listing_type: readListingType(input.listing_type)
  };
}

async function saveTransactionRecord(input: TransactionRecordInput): Promise<TransactionRecord> {
  const createdAt = new Date().toISOString();
  const dateKey = createdAt.slice(0, 10);
  const recordId = `${createdAt.replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const record: TransactionRecord = {
    ...input,
    record_id: recordId,
    margin: input.actual_sell_price - input.actual_deal_price,
    created_at: createdAt,
    date_key: dateKey
  };

  const targetDir = resolve(process.cwd(), WEB_BACKEND_CONFIG.transaction_result_base, dateKey);
  await mkdir(targetDir, { recursive: true });
  await writeFile(resolve(targetDir, `${recordId}.json`), JSON.stringify(record, null, 2), 'utf-8');

  return record;
}

async function buildTransactionHistoryResponse(keyword: string | null, limit: number): Promise<TransactionHistoryResponse> {
  const records = await readTransactionHistory();
  const filteredRecords = keyword
    ? records.filter((record) => matchesKeyword(record, keyword))
    : records;
  const sliced = filteredRecords
    .sort((left, right) => right.created_at.localeCompare(left.created_at))
    .slice(0, limit);

  return {
    status: 'success',
    data: {
      keyword: keyword ?? null,
      total_count: filteredRecords.length,
      records: sliced.map((record) => ({
        item_id: record.item_id,
        actual_deal_price: record.actual_deal_price,
        actual_sell_price: record.actual_sell_price,
        days_to_sell: record.days_to_sell,
        final_net_profit: record.final_net_profit,
        recorded_at: record.created_at
      })),
      summary: {
        avg_margin: average(sliced.map((record) => record.margin)),
        avg_days_to_sell: average(sliced.map((record) => record.days_to_sell)),
        profitable_count: sliced.filter((record) => record.margin > 0).length
      }
    }
  };
}

async function buildStatusSummaryResponse(latest: LatestModuleMap) {
  const records = await readTransactionHistory();
  const now = Date.now();
  const last24hRecords = records.filter((record) => now - Date.parse(record.created_at) <= 24 * 60 * 60 * 1000);
  const last30dRecords = records.filter((record) => now - Date.parse(record.created_at) <= 30 * 24 * 60 * 60 * 1000);

  return {
    status: 'success',
    data: {
      latest_transaction_count_24h: last24hRecords.length,
      avg_days_to_sell_30d: average(last30dRecords.map((record) => record.days_to_sell)),
      profitable_ratio_30d:
        last30dRecords.length > 0
          ? round(last30dRecords.filter((record) => (record.final_net_profit ?? record.margin) > 0).length / last30dRecords.length, 2)
          : 0,
      modules: {
        collector: latest.collector ? 'available' : 'missing',
        market: latest.market ? 'available' : 'missing',
        merge: latest.merge || latest.merged ? 'available' : 'missing',
        MCP: latest.MCP ? 'available' : 'missing'
      }
    }
  };
}

async function readTransactionHistory(): Promise<TransactionRecord[]> {
  const baseDir = resolve(process.cwd(), WEB_BACKEND_CONFIG.transaction_result_base);
  const dateDirs = await listDirectories(baseDir);
  const records: TransactionRecord[] = [];

  for (const dateDir of dateDirs) {
    const recordDir = resolve(baseDir, dateDir);
    const files = await listFiles(recordDir);

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const record = await readJsonFile(resolve(recordDir, file));
      if (record && isTransactionRecord(record)) {
        records.push(record);
      }
    }
  }

  return records;
}

async function listFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

function matchesKeyword(record: TransactionRecord, keyword: string) {
  const target = keyword.toLowerCase();
  return [
    record.keyword,
    record.title,
    record.item_id,
    record.site
  ]
    .filter((value): value is string => typeof value === 'string')
    .some((value) => value.toLowerCase().includes(target));
}

function isTransactionRecord(value: unknown): value is TransactionRecord {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.record_id === 'string' &&
    typeof value.item_id === 'string' &&
    typeof value.actual_deal_price === 'number' &&
    typeof value.actual_sell_price === 'number' &&
    typeof value.days_to_sell === 'number' &&
    typeof value.final_net_profit === 'number' &&
    Array.isArray(value.issues) &&
    value.issues.every((issue) => typeof issue === 'string') &&
    typeof value.margin === 'number' &&
    typeof value.created_at === 'string' &&
    typeof value.date_key === 'string'
  );
}

function readOptionalNumber(source: JsonRecord, key: string) {
  return typeof source[key] === 'number' && Number.isFinite(source[key] as number)
    ? (source[key] as number)
    : undefined;
}

function readOptionalBoolean(source: JsonRecord, key: string) {
  return typeof source[key] === 'boolean' ? (source[key] as boolean) : undefined;
}

function readStringArray(source: JsonRecord, key: string) {
  return Array.isArray(source[key])
    ? (source[key] as unknown[]).filter((value): value is string => typeof value === 'string')
    : [];
}

function readListingType(value: unknown): ListingType | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const validTypes: ListingType[] = ['full_pc', 'semi_pc', 'part', 'unknown'];
  return validTypes.includes(value as ListingType) ? (value as ListingType) : undefined;
}

function getModuleNameFromRunId(runId: string): keyof LatestModuleMap | null {
  const match = runId.match(
    /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z__(collector|market|merge|merged|MCP)__[A-Za-z0-9_-]+$/
  );
  return match ? (match[1] as keyof LatestModuleMap) : null;
}
