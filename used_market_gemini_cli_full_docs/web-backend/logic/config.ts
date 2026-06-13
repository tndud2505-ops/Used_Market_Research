export const WEB_BACKEND_CONFIG = {
  port: parseInt(process.env.PORT || '8787'),
  host: process.env.HOST || 'localhost',
  
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
