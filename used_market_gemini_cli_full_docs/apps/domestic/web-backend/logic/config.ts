function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function commaSeparatedValues(value: string | undefined) {
  return Array.from(new Set((value || '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item && item !== '*')));
}

export const WEB_BACKEND_CONFIG = {
  port: positiveInteger(process.env.PORT, 8787),
  host: process.env.HOST || 'localhost',

  // Keep expensive browser searches bounded on small production hosts.
  search_concurrency_limit: positiveInteger(process.env.SEARCH_CONCURRENCY_LIMIT, 1),
  search_retry_after_seconds: positiveInteger(process.env.SEARCH_RETRY_AFTER_SECONDS, 5),
  search_max_work_units: positiveInteger(process.env.SEARCH_MAX_WORK_UNITS, 12),
  search_cache_ttl_ms: positiveInteger(process.env.SEARCH_CACHE_TTL_SECONDS, 120) * 1_000,
  search_cache_max_entries: positiveInteger(process.env.SEARCH_CACHE_MAX_ENTRIES, 32),
  expose_internal_error_details: process.env.NODE_ENV !== 'production',
  cors_allowed_origins: commaSeparatedValues(process.env.CORS_ALLOWED_ORIGINS),
  public_api_only: process.env.PUBLIC_API_ONLY === 'true',
  // merge/result base directory
  merge_result_base: process.env.MERGE_RESULT_BASE || 'merge/result',
  transaction_result_base: process.env.TRANSACTION_RESULT_BASE || 'merge/result/transactions',
  // Default limits
  default_opportunities_limit: 20,
  default_market_by_gpu_top: 0, // 0 = all
  // API paths
  api_paths: {
    health: '/health',
    merged_latest: '/api/merged/latest',
    market_latest: '/api/market/latest',
    market_by_gpu: '/api/market/by-gpu',
    opportunities_latest: '/api/opportunities/latest',
    collector_latest: '/api/collector/latest',
    runs: '/api/runs/:module/:runId',
    transaction_record: '/api/transaction/record',
    transaction_history: '/api/transaction/history',
    status_summary: '/api/status/summary'
  }
};
