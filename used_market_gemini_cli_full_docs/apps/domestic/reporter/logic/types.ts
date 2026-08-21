export interface ReporterCandidateComponent {
  component_type: string;
  canonical_name: string;
  confidence: number;
  source_kind: "title" | "search_notes" | "detail_body" | "mixed";
  evidence_level: "estimated" | "confirmed";
}

export type ReporterReferenceSource = "observed" | "manual_seed" | "mixed" | "missing";

export interface ReporterPriceWindow {
  component_key: string;
  component_type: string;
  listing_scope: "full_pc" | "semi_pc" | "part" | "unknown";
  window_days: number;
  average_price: number | null;
  sample_count: number;
  trade_estimate: number | null;
  source: "observed" | "manual_seed";
}

export interface ReporterHistoryPoint {
  run_id: string;
  date_key: string;
  date_label: string;
  component_key: string;
  component_type: string;
  listing_scope: "full_pc" | "semi_pc" | "part" | "unknown";
  window_days: number;
  average_price: number | null;
  sample_count: number;
  trade_estimate: number | null;
  source: "observed" | "manual_seed";
}

export interface ReporterBuildComponentPrice {
  component_type: string;
  canonical_name: string;
  price_30d: number | null;
  trade_estimate_30d: number | null;
  source_30d: ReporterReferenceSource;
}

export interface ReporterCandidate {
  item_id: string;
  site: string;
  title: string;
  seller: string;
  price: number | null;
  url: string;
  listing_type: "full_pc" | "semi_pc" | "part" | "unknown";
  posted_at: string;
  components: ReporterCandidateComponent[];
  detail_enriched: boolean;
  detail_fetch_status: "not_needed" | "success" | "unavailable" | "failed";
  detail_fetch_note: string;
  detail_excerpt: string;
  component_resolution: "search_only" | "detail_enriched";
  confirmed_component_count: number;
  unknown_component_types: string[];
  primary_component: string;
  primary_component_type: string;
  bundle_key: string | null;
  baseline_price: number | null;
  deviation_rate: number | null;
  score_hint: number | null;
  score_reason: string;
  fraud_risk_score: number;
  fraud_flags: string[];
  net_profit: number | null;
  profit_margin: number | null;
  estimated_days_to_sell: number;
  demand_strength: "high" | "medium" | "low";
  market_price_7d: number | null;
  market_price_30d: number | null;
  market_price_90d: number | null;
  market_sample_30d: number;
  market_trade_estimate_30d: number | null;
  market_reference_key: string;
  market_reference_source_30d: ReporterReferenceSource;
  part_reference_price_7d: number | null;
  part_reference_price_30d: number | null;
  part_reference_price_90d: number | null;
  part_reference_sample_30d: number;
  part_reference_trade_estimate_30d: number | null;
  part_reference_source_30d: ReporterReferenceSource;
  valuation_mode: "part_market" | "build_components" | "build_bundle" | "missing";
  component_sum_price_7d: number | null;
  component_sum_price_30d: number | null;
  component_sum_price_90d: number | null;
  component_sum_trade_estimate_30d: number | null;
  component_sum_source_30d: ReporterReferenceSource;
  component_priced_count: number;
  component_total_count: number;
  component_coverage_ratio: number;
  component_price_breakdown: ReporterBuildComponentPrice[];
  price_gap_to_market_30d: number | null;
  price_gap_to_market_30d_pct: number | null;
  retail_reference_price?: number | null;
  retail_reference_source?: "naver_shop" | "missing";
  retail_priced_count?: number;
  retail_total_count?: number;
  retail_price_gap?: number | null;
  retail_price_ratio?: number | null;
  observed_run_count: number;
  observed_day_count: number;
  first_seen_at: string;
  last_seen_at: string;
  decompose_recommendation: "keep" | "decompose" | null;
  bottleneck_issues: string[];
  review_flags?: string[];
  model_status: string;
  confidence_penalty: number;
}

export interface ReporterDispatchCandidate {
  candidate: ReporterCandidate;
  decision: "BUY" | "WATCH" | "CHECK";
  fingerprint: string;
}

export interface ReporterAlertScoreBreakdown {
  score: number;
  edge: number;
  confidence: number;
  freshness: number;
  liquidity: number;
  uniqueness: number;
  fingerprint: string;
  normalized_title: string;
}

export interface ReporterDiscoveredKeyword {
  component_type: string;
  canonical_name: string;
  mention_count: number;
  observed_day_count: number;
  auto_search_candidate: boolean;
  example_titles: string[];
}

export interface ReporterHistorySummary {
  lookback_days: number;
  observed_days: number;
  latest_run_id?: string;
  latest_date_key?: string;
  manual_seed_as_of?: string;
  manual_seed_entry_count: number;
}

export interface ReporterSourceData {
  source_run_id?: string;
  keyword?: string;
  candidates: ReporterCandidate[];
  windows: ReporterPriceWindow[];
  history_points: ReporterHistoryPoint[];
  discovered_keywords: ReporterDiscoveredKeyword[];
  history_summary: ReporterHistorySummary;
}

export interface ReporterConfig {
  enabled: boolean;
  killSwitch: boolean;
  triggerMode: "poll" | "scheduler";
  pollIntervalSec: number;
  spreadsheetId?: string;
  sheetsCredentialsPath?: string;
  messageProvider: "webhook";
  messageWebhookUrl?: string;
  templateVersion: "v1";
  maxPerSellerPerDay: number;
  quietHours: string;
  dedupeTtlHours: number;
  sendEnabled: boolean;
  summaryEnabled: boolean;
  summaryWebhookUrl?: string;
  summaryMaxItems: number;
  discordWatchEnabled: boolean;
  discordWatchBotToken?: string;
  discordWatchChannelIds: string[];
  discordWatchGuildId: string;
  discordWatchCommandPrefix: string;
  discordWatchPollLimit: number;
}

export interface DispatchAttempt {
  item_id: string;
  seller: string;
  url: string;
  status: "sent" | "blocked" | "failed";
  reason?: string;
  response_code?: number;
}

export interface SheetsSyncRow {
  run_id: string;
  item_id: string;
  site: string;
  title: string;
  seller: string;
  price: number | null;
  url: string;
}

export interface ReporterRunOutput {
  run_id: string;
  latest_merge_run?: string;
  discord_watch: {
    inbox_attempted: boolean;
    inbox_processed: number;
    inbox_replied: number;
    checks_attempted: boolean;
    checked_watch_count: number;
    due_watch_count: number;
    created_alert_count: number;
    pending_alerts_sent: number;
    pending_alerts_failed: number;
    reason?: string;
  };
  sheets_sync: {
    attempted: boolean;
    success: boolean;
    rows_written: number;
    reason?: string;
  };
  dispatch: {
    attempted: number;
    sent: number;
    blocked: number;
    failed: number;
    logs: DispatchAttempt[];
  };
  summary_notification: {
    attempted: boolean;
    sent: boolean;
    item_count: number;
    reason?: string;
    response_code?: number;
  };
  warnings: string[];
}

export interface ReporterRunStats {
  processed_candidates: number;
  dedupe_blocked: number;
  seller_limit_blocked: number;
  quiet_hours_blocked: number;
  kill_switch_blocked: number;
  sheets_rows_written: number;
}

export interface ReporterRecommendationSummaryResult {
  attempted: boolean;
  sent: boolean;
  item_count: number;
  reason?: string;
  response_code?: number;
}

export interface ReporterRunOptions {
  sendDispatch?: boolean;
  sendSummary?: boolean;
}
