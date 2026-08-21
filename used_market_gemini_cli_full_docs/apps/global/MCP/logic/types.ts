import { z } from "zod";

export const LoginStatusSchema = z.enum(["logged_in", "logged_out", "unknown"]);
export const ItemStatusSchema = z.enum(["active", "sold", "reserved", "unknown"]);
export const ListingTypeSchema = z.enum(["full_pc", "semi_pc", "part", "unknown"]);
export const MarketListingScopeSchema = z.enum(["full_pc", "semi_pc", "part", "unknown"]);

export const CategorySelectionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  path: z.array(z.string()).default([])
});
export type CategorySelection = z.infer<typeof CategorySelectionSchema>;

export const SearchQualityMetaSchema = z.object({
  extracted_count: z.number().int().min(0).default(0),
  filtered_count: z.number().int().min(0).default(0),
  duplicate_count: z.number().int().min(0).default(0),
  warning_count: z.number().int().min(0).default(0)
});
export type SearchQualityMeta = z.infer<typeof SearchQualityMetaSchema>;

export const SearchPaginationSchema = z.object({
  has_more: z.boolean().default(false),
  next_cursor: z.string().nullable().default(null)
});
export type SearchPagination = z.infer<typeof SearchPaginationSchema>;

export const CategoryMappingModeSchema = z.enum(["single", "aggregate", "keyword"]);
export const CategoryMappingConfidenceSchema = z.enum([
  "exact",
  "aggregate_exact",
  "broader_source",
  "keyword_inferred",
  "unknown"
]);
export const CollectionStateSchema = z.enum([
  "ready",
  "partial",
  "empty",
  "filtered_empty",
  "unsupported",
  "failed"
]);
export type CollectionState = z.infer<typeof CollectionStateSchema>;

export const SearchItemSchema = z.object({
  title: z.string().default(""),
  price: z.number().nullable().default(null),
  currency: z.string().default("USD"),
  price_label: z.string().default(""),
  seller: z.string().default(""),
  status: ItemStatusSchema.default("unknown"),
  condition: z.string().default(""),
  shipping: z.string().default(""),
  location: z.string().default(""),
  posted_at: z.string().default(""),
  url: z.string().default(""),
  image_url: z.string().default(""),
  notes: z.string().default(""),
  listing_type_hint: ListingTypeSchema.default("unknown"),
  warnings: z.array(z.string()).default([]),
  // Item 13-14: Real transaction pricing
  sale_status: z.enum(["active", "reserved", "completed"]).default("active"),
  estimated_deal_price: z.number().nullable().default(null),
  price_change_count: z.number().int().min(0).default(0),
  // Item 15-16: Fraud signal data
  upload_date: z.string().default(""),
  seller_upload_count: z.number().int().min(0).default(0),
  description_length: z.number().int().min(0).default(0),
  has_photo: z.boolean().default(false),
  canonical_category_id: z.string().default(""),
  canonical_category_path: z.array(z.string()).default([]),
  source_category_id: z.string().default(""),
  source_category_ids: z.array(z.string()).default([]),
  source_category_path: z.array(z.string()).default([]),
  category_confidence: z.enum(["source", "inferred", "unknown"]).default("unknown"),
  category_mapping_mode: CategoryMappingModeSchema.default("single"),
  category_mapping_confidence: CategoryMappingConfidenceSchema.default("unknown")
});
export type SearchItem = z.infer<typeof SearchItemSchema>;

export const SearchResultSchema = z.object({
  site: z.string(),
  keyword: z.string(),
  keyword_is_explicit: z.boolean().default(true),
  login_status: LoginStatusSchema.default("unknown"),
  collection_state: CollectionStateSchema.default("empty"),
  items: z.array(SearchItemSchema).default([]),
  warnings: z.array(z.string()).default([]),
  quality_meta: SearchQualityMetaSchema.default({}),
  next_action: z.string().default(""),
  errors: z.array(z.string()).default([]),
  category: CategorySelectionSchema.nullable().default(null),
  pagination: SearchPaginationSchema.default({})
});
export type SearchResult = z.infer<typeof SearchResultSchema>;

export const LoginCheckResultSchema = z.object({
  site: z.string(),
  login_status: LoginStatusSchema,
  current_page: z.string().default(""),
  notes: z.string().default(""),
  errors: z.array(z.string()).default([])
});
export type LoginCheckResult = z.infer<typeof LoginCheckResultSchema>;

export const NormalizedComponentSchema = z.object({
  component_type: z.string().default("unknown"),
  canonical_name: z.string().default(""),
  confidence: z.number().min(0).max(1).default(0.5),
  source_text: z.string().default(""),
  source_kind: z.enum(["title", "search_notes", "detail_body", "mixed"]).default("title"),
  evidence_level: z.enum(["estimated", "confirmed"]).default("estimated")
});
export type NormalizedComponent = z.infer<typeof NormalizedComponentSchema>;

export const NormalizedItemSchema = z.object({
  title: z.string().default(""),
  price_value: z.number().nullable().default(null),
  currency: z.string().default("USD"),
  price_label: z.string().default(""),
  seller_name: z.string().default(""),
  item_status: ItemStatusSchema.default("unknown"),
  condition: z.string().default(""),
  shipping: z.string().default(""),
  location: z.string().default(""),
  posted_at: z.string().default(""),
  url: z.string().default(""),
  image_url: z.string().default(""),
  raw_notes: z.string().default(""),
  listing_type: ListingTypeSchema.default("unknown"),
  components: z.array(NormalizedComponentSchema).default([]),
  detail_enriched: z.boolean().default(false),
  detail_fetch_status: z.enum(["not_needed", "success", "unavailable", "failed"]).default("not_needed"),
  detail_fetch_note: z.string().default(""),
  detail_excerpt: z.string().default(""),
  component_resolution: z.enum(["search_only", "detail_enriched"]).default("search_only"),
  confirmed_component_count: z.number().int().min(0).default(0),
  unknown_component_types: z.array(z.string()).default([]),
  // Item 13-14: Real transaction pricing
  sale_status: z.enum(["active", "reserved", "completed"]).default("active"),
  estimated_deal_price: z.number().nullable().default(null),
  price_change_count: z.number().int().min(0).default(0),
  // Item 15-16: Fraud signal data
  upload_date: z.string().default(""),
  seller_upload_count: z.number().int().min(0).default(0),
  description_length: z.number().int().min(0).default(0),
  has_photo: z.boolean().default(false),
  noise_filtered: z.boolean().default(false),
  noise_filter_reason: z.string().default(""),
  canonical_category_id: z.string().default(""),
  canonical_category_path: z.array(z.string()).default([]),
  source_category_id: z.string().default(""),
  source_category_ids: z.array(z.string()).default([]),
  source_category_path: z.array(z.string()).default([]),
  category_confidence: z.enum(["source", "inferred", "unknown"]).default("unknown"),
  category_mapping_mode: CategoryMappingModeSchema.default("single"),
  category_mapping_confidence: CategoryMappingConfidenceSchema.default("unknown")
});
export type NormalizedItem = z.infer<typeof NormalizedItemSchema>;

export const NormalizedResultSchema = z.object({
  site: z.string(),
  keyword: z.string(),
  normalized_items: z.array(NormalizedItemSchema).default([]),
  warnings: z.array(z.string()).default([]),
  next_action: z.string().default("continue"),
  category: CategorySelectionSchema.nullable().default(null)
});
export type NormalizedResult = z.infer<typeof NormalizedResultSchema>;

export const MergedItemSchema = NormalizedItemSchema.extend({
  site: z.string(),
  margin_hint: z.number().nullable().default(null),
  score_hint: z.number().nullable().default(null),
  score_reason: z.string().default(""),
  baseline_price: z.number().nullable().default(null),
  deviation_rate: z.number().nullable().default(null),
  // B. Fraud Detection
  fraud_risk_score: z.number().min(0).max(1).default(0),
  fraud_flags: z.array(z.string()).default([]),
  // C. Net Profit Calculation
  estimated_deal_price: z.number().nullable().default(null),
  net_profit: z.number().nullable().default(null),
  profit_margin: z.number().nullable().default(null),
  transaction_fee: z.number().default(0),
  shipping_cost: z.number().default(0),
  repair_cost: z.number().default(0),
  // D. Liquidity Assessment
  similar_items_sold_7d: z.number().default(0),
  estimated_days_to_sell: z.number().default(0),
  demand_strength: z.enum(["high", "medium", "low"]).default("medium"),
  // E. Full PC Decomposition
  as_is_price: z.number().nullable().default(null),
  decomposed_total: z.number().nullable().default(null),
  decompose_cost: z.number().default(20000),
  decompose_recommendation: z.enum(["keep", "decompose"]).nullable().default(null),
  // F. Bottleneck Analysis
  bottleneck_issues: z.array(z.string()).default([]),
  price_impact: z.number().default(0),
  // K. Model Blacklist
  model_status: z.enum(["normal", "cautionary", "blacklisted"]).default("normal"),
  confidence_penalty: z.number().min(0).max(1).default(0)
});
export type MergedItem = z.infer<typeof MergedItemSchema>;

export const MergeResultSchema = z.object({
  keyword: z.string(),
  merged_items: z.array(MergedItemSchema).default([]),
  errors: z.array(z.string()).default([])
});
export type MergeResult = z.infer<typeof MergeResultSchema>;

export const MessageDraftSchema = z.object({
  site: z.string(),
  language: z.string(),
  message_draft: z.string(),
  send_recommended: z.boolean().default(true)
});
export type MessageDraft = z.infer<typeof MessageDraftSchema>;

export const ValidationResultSchema = z.object({
  site: z.string(),
  validated: z.boolean(),
  item: z.object({
    title: z.string().default(""),
    price: z.number().nullable().default(null),
    seller: z.string().default(""),
    status: z.string().default("unknown"),
    url: z.string().default("")
  }),
  message_ready: z.boolean(),
  warnings: z.array(z.string()).default([]),
  errors: z.array(z.string()).default([])
});
export type ValidationResult = z.infer<typeof ValidationResultSchema>;

export const SiteConfigSchema = z.object({
  key: z.string(),
  name: z.string(),
  siteType: z.enum(["used_market", "marketplace", "auction"]),
  locale: z.string().default("en-US"),
  currency: z.string().default("USD"),
  loginRequired: z.boolean().default(true)
});
export type SiteConfig = z.infer<typeof SiteConfigSchema>;

export const PriceWindowStatsSchema = z.object({
  component_key: z.string(),
  component_type: z.string().default("unknown"),
  listing_scope: MarketListingScopeSchema.default("unknown"),
  window_days: z.number(),
  average_price: z.number().nullable(),
  sample_count: z.number(),
  trade_estimate: z.number().nullable().default(null)
});
export type PriceWindowStats = z.infer<typeof PriceWindowStatsSchema>;

export const MarketSnapshotSchema = z.object({
  keyword: z.string(),
  windows: z.array(PriceWindowStatsSchema).default([]),
  notes: z.array(z.string()).default([])
});
export type MarketSnapshot = z.infer<typeof MarketSnapshotSchema>;

export interface ModelRequest {
  systemPrompt?: string;
  prompt: string;
  timeoutMs?: number;
}

export interface ProviderMetadata {
  provider_name: string;
  model_name: string;
  auth_mode: string;
}

export interface ProviderCheckResult {
  provider_name: string;
  ready: boolean;
  command: string | null;
  model_name: string;
  auth_mode: string;
  checked_at: string;
  notes: string[];
}

export interface ModelProvider {
  readonly name: string;
  runJson<T>(request: ModelRequest, schema: z.ZodType<T>): Promise<T>;
  getMetadata(): Promise<ProviderMetadata> | ProviderMetadata;
  providerCheck(): Promise<ProviderCheckResult> | ProviderCheckResult;
}

export interface SearchCommandInput {
  site: string;
  keyword: string;
  keywordIsExplicit?: boolean;
  limit: number;
  category?: CategorySelection;
  sourceCategoryId?: string;
  cursor?: string | null;
}

export interface FullWorkflowInput {
  keyword: string;
  keywordIsExplicit?: boolean;
  sites: string[];
  limit: number;
  category?: CategorySelection;
  siteCursors?: Record<string, string | null>;
  persistMarketResult?: boolean;
  goodPriceInput?: {
    site: string;
    title: string;
    price: number | null;
    seller: string;
    url: string;
  };
}
