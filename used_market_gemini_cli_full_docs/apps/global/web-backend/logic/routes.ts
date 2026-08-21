/**
 * Supported route definitions for the web backend.
 */
export const ROUTE_DRAFTS = [
  'GET /health',
  'GET /',
  'POST /api/search',
  'GET /api/categories',
  'POST /api/feedback',
  'GET /api/feedback/summary',
  'GET /api/market/history',
  'GET /api/engine/status',
  'GET /api/runner/status',
  'POST /api/runner/run',
  'GET /api/merged/latest',
  'GET /api/market/latest',
  'GET /api/market/by-gpu',
  'GET /api/opportunities/latest',
  'GET /api/collector/latest',
  'GET /api/runs/:module/:runId',
  'POST /api/transaction/record',
  'GET /api/transaction/history',
  'GET /api/status/summary'
];

export interface QueryParams {
  limit?: number;
  top?: number;
  threshold?: number;
  run_id?: string;
  listing_type?: string | string[];
  site?: string;
  sites?: string | string[];
  group?: string;
  sort?: 'price_asc' | 'price_desc' | 'confidence_asc' | 'confidence_desc';
}

export const VALID_LISTING_TYPES = [
  'full_pc',
  'semi_pc',
  'part',
  'unknown'
] as const;

export function splitListingTypeTokens(param?: string | string[]): string[] | undefined {
  if (!param) return undefined;

  const types = Array.isArray(param)
    ? param
    : param.split(',');

  const normalized = types
    .map((type) => type.trim())
    .filter(Boolean);

  return normalized.length > 0 ? normalized : undefined;
}

export function parseListingTypes(param?: string | string[]): string[] | undefined {
  const types = splitListingTypeTokens(param);
  if (!types) return undefined;
  return types.filter((type) => VALID_LISTING_TYPES.includes(type as (typeof VALID_LISTING_TYPES)[number]));
}

export function isValidRunId(runId: string): boolean {
  const pattern = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z__\w+__\w+$/;
  return pattern.test(runId);
}

export function parseSiteFilters(site?: string | null, sites?: string | string[] | null): string[] | undefined {
  const rawValues: string[] = [];

  if (site) {
    rawValues.push(site);
  }

  if (Array.isArray(sites)) {
    rawValues.push(...sites);
  } else if (typeof sites === 'string') {
    rawValues.push(...sites.split(','));
  }

  const normalized = rawValues
    .map((value) => value.trim())
    .filter(Boolean);

  return normalized.length > 0 ? Array.from(new Set(normalized)) : undefined;
}
