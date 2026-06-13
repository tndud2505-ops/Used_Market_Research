// Component structure
export interface Component {
  component_type: string;
  canonical_name: string;
  confidence: number;
}

export interface ApiStatusSummary {
  item_count: number;
  warnings_count: number;
  errors_count: number;
  provider_status?: string;
}

// Listing type: normalized scopes emitted by the current merge pipeline.
export type ListingType = 'full_pc' | 'semi_pc' | 'part' | 'unknown';

// Merged item from merge module
export interface MergedItem {
  site: string;
  title: string;
  price_value: number;
  currency: string;
  seller_name: string;
  location?: string;
  url: string;
  components: Component[];
  opportunity_score?: number;
  listing_type?: ListingType;
  score_reason?: string;
  baseline_price?: number;
  deviation_rate?: number;
  noise_filtered?: boolean;
  noise_filter_reason?: string;
  seller_upload_count?: number;
  fraud_risk_score?: number;
  fraud_flags?: string[];
}

// Module stats
export interface ModuleStats {
  status: 'ok' | 'warning' | 'error';
  items_count: number;
  run_id?: string;
}

// Merged result response
export interface LatestMergedResponse {
  status: string;
  data?: {
    keyword: string;
    run_id: string;
    modules: Record<string, ModuleStats>;
    merged_items: MergedItem[];
    quality_metrics: {
      total_items: number;
      sites: number;
      items_with_url: number;
      items_with_price: number;
    };
    api_status?: ApiStatusSummary;
  };
  error?: string;
  suggestion?: string;
}

// Market snapshot response
export interface LatestMarketResponse {
  status: string;
  data?: {
    keyword: string;
    run_id: string;
    normalized_items: Array<{
      title: string;
      price_value: number;
      components: Array<{ canonical_name: string }>;
      site?: string;
      listing_type?: ListingType;
    }>;
    statistics: {
      total_count: number;
      avg_price: number;
      min_price: number;
      max_price: number;
      price_std_dev: number;
    };
    api_status?: ApiStatusSummary;
  };
  error?: string;
}

// Collector response
export interface LatestCollectorResponse {
  status: string;
  data?: {
    site: string;
    keyword: string;
    login_status: string;
    items_count: number;
    items: Array<{
      title: string;
      price: number;
      seller: string;
      url: string;
    }>;
    api_status?: ApiStatusSummary;
  };
  error?: string;
}

// Opportunity item with explanation fields
export interface OpportunityItem {
  rank: number;
  opportunity_score: number;
  score_reason?: string;           // 점수 산출 근거
  baseline_price?: number;         // 기준 가격
  discount_rate?: number;          // 할인율 (%)
  title: string;
  price: number;
  seller: string;
  site: string;
  url: string;
  reason?: string;
  components_count: number;
  listing_type?: ListingType;      // 상품 타입
}

// Opportunities response with filtering support
export interface LatestOpportunitiesResponse {
  status: string;
  data?: {
    opportunities: OpportunityItem[];
    total_count: number;
    timestamp: string;
    api_status?: ApiStatusSummary;
    filters_applied?: {
      listing_type?: ListingType[];
      run_id?: string;
      sites?: string[];
    };
  };
  error?: string;
}

// GPU Summary
export interface GPUSummary {
  count: number;
  avg_price: number;
  min_price: number;
  max_price: number;
  sites: string[];
  confidence_avg: number;
}

// Market by GPU response
export interface MarketByGpuResponse {
  status: string;
  data?: {
    timestamp: string;
    gpu_summary: Record<string, GPUSummary>;
    api_status?: ApiStatusSummary;
  };
  error?: string;
}

// Run detail response for GET /api/runs/:module/:runId
export interface RunDetailResponse {
  status: string;
  data?: {
    run_id: string;
    module: string;
    timestamp: string;
    output: Record<string, unknown>;
    summary?: Record<string, unknown>;
  };
  error?: string;
  suggestion?: string;
}

export interface TransactionRecordInput {
  item_id: string;
  actual_deal_price: number;
  actual_sell_price: number;
  days_to_sell: number;
  final_net_profit: number;
  issues: string[];
  keyword?: string;
  site?: string;
  title?: string;
  listing_type?: ListingType;
}

export interface TransactionRecord extends TransactionRecordInput {
  record_id: string;
  margin: number;
  created_at: string;
  date_key: string;
}

export interface TransactionHistoryRecord {
  item_id: string;
  actual_deal_price: number;
  actual_sell_price: number;
  days_to_sell: number;
  final_net_profit: number;
  recorded_at: string;
}

export interface TransactionHistoryResponse {
  status: string;
  data?: {
    keyword: string | null;
    total_count: number;
    records: TransactionHistoryRecord[];
    summary: {
      avg_margin: number;
      avg_days_to_sell: number;
      profitable_count: number;
    };
  };
  error?: string;
}
