import {
  SearchResultSchema,
  type SearchCommandInput,
  type SearchItem,
  type SearchResult
} from "../../MCP/logic/types.js";
import type { BrowserSiteAdapter } from "./sites/index.js";

type EbayBrowseItemSummary = {
  itemId?: string;
  title?: string;
  price?: { value?: string | number; currency?: string };
  seller?: { username?: string };
  itemWebUrl?: string;
  image?: { imageUrl?: string };
  itemLocation?: { city?: string; stateOrProvince?: string; country?: string };
  condition?: string;
  itemOriginDate?: string;
};

type EbayBrowseSearchResponse = {
  total?: number;
  itemSummaries?: EbayBrowseItemSummary[];
};

type EbayTokenResponse = {
  access_token?: string;
  expires_in?: number;
};

let ebayTokenCache: { token: string; expiresAt: number } | null = null;

export function resetEbayTokenCacheForTests() {
  ebayTokenCache = null;
}

function parseNumericPrice(value: string | number | null | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const normalized = value.replace(/,/g, "").trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseOffsetCursor(cursor: string | null | undefined) {
  const match = typeof cursor === "string" ? cursor.match(/^offset:(\d+)$/) : null;
  return match ? Math.max(0, Number(match[1])) : 0;
}

function buildResult(
  adapter: BrowserSiteAdapter,
  input: SearchCommandInput,
  items: SearchItem[],
  warnings: string[] = [],
  errors: string[] = [],
  pagination = { has_more: false, next_cursor: null as string | null }
): SearchResult {
  return SearchResultSchema.parse({
    site: adapter.siteKey,
    keyword: input.keyword,
    login_status: "unknown",
    items,
    warnings,
    quality_meta: {
      extracted_count: items.length,
      filtered_count: 0,
      duplicate_count: 0,
      warning_count: warnings.length
    },
    next_action: items.length > 0 ? "normalize" : "inspect_keyword",
    errors,
    pagination
  });
}

async function getEbayBrowseToken(): Promise<string> {
  const configuredToken = process.env.EBAY_BROWSE_API_TOKEN?.trim();
  if (configuredToken) return configuredToken;

  if (ebayTokenCache && ebayTokenCache.expiresAt > Date.now() + 60_000) {
    return ebayTokenCache.token;
  }

  const clientId = process.env.EBAY_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.EBAY_CLIENT_SECRET?.trim() ?? "";
  if (!clientId || !clientSecret) return "";

  const credentials = Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64");
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "https://api.ebay.com/oauth/api_scope"
  });
  const response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Basic ${credentials}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body
  });
  if (!response.ok) throw new Error(`EBAY_OAUTH_ERROR: HTTP ${response.status}`);
  const payload = await response.json() as EbayTokenResponse;
  const token = typeof payload.access_token === "string" ? payload.access_token.trim() : "";
  if (!token) throw new Error("EBAY_OAUTH_ERROR: token response did not include access_token");
  const expiresIn = Number.isFinite(payload.expires_in) ? Math.max(120, Number(payload.expires_in)) : 7200;
  ebayTokenCache = { token, expiresAt: Date.now() + expiresIn * 1000 };
  return token;
}

function mapEbayBrowseItem(item: EbayBrowseItemSummary, index: number): SearchItem {
  const title = typeof item.title === "string" ? item.title.trim() : "";
  const imageUrl = typeof item.image?.imageUrl === "string" ? item.image.imageUrl.trim() : "";
  const postedAt = typeof item.itemOriginDate === "string" ? item.itemOriginDate : "";
  const location = [item.itemLocation?.city, item.itemLocation?.stateOrProvince, item.itemLocation?.country]
    .filter((value): value is string => typeof value === "string" && value.trim() !== "")
    .join(", ");
  const url = typeof item.itemWebUrl === "string" && item.itemWebUrl.trim() !== ""
    ? item.itemWebUrl.trim()
    : item.itemId ? `https://www.ebay.com/itm/${encodeURIComponent(item.itemId)}` : "";

  return {
    title,
    price: parseNumericPrice(item.price?.value),
    currency: typeof item.price?.currency === "string" && item.price.currency.trim() ? item.price.currency.trim() : "USD",
    price_label: "Sale price",
    seller: "",
    status: "unknown",
    condition: typeof item.condition === "string" ? item.condition : "",
    shipping: "",
    location,
    posted_at: postedAt,
    url,
    image_url: imageUrl,
    notes: ["source=ebay-browse-api", `row=${index + 1}`, item.itemId ? `item_id=${item.itemId}` : ""].filter(Boolean).join("; "),
    listing_type_hint: "unknown",
    warnings: ["SALE_STATUS_UNAVAILABLE", ...(item.price?.value == null ? ["PRICE_UNPARSEABLE"] : [])],
    sale_status: "active",
    estimated_deal_price: null,
    price_change_count: 0,
    upload_date: postedAt ? postedAt.slice(0, 10) : "",
    seller_upload_count: 0,
    description_length: title.length,
    has_photo: imageUrl !== "",
    canonical_category_id: "",
    canonical_category_path: [],
    source_category_id: "",
    source_category_ids: [],
    source_category_path: [],
    category_confidence: "unknown",
    category_mapping_mode: "single",
    category_mapping_confidence: "unknown"
  };
}

async function extractEbayBrowseApiResult(adapter: BrowserSiteAdapter, input: SearchCommandInput): Promise<SearchResult> {
  try {
    const token = await getEbayBrowseToken();
    if (!token) {
      return SearchResultSchema.parse({
        ...buildResult(adapter, input, [], ["EBAY_CREDENTIALS_REQUIRED: Production Client ID and Client Secret are not configured"]),
        next_action: "configure_ebay_credentials"
      });
    }

    const offset = parseOffsetCursor(input.cursor);
    const url = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
    url.searchParams.set("q", input.keyword.trim() || input.category?.label || "");
    url.searchParams.set("limit", String(Math.min(Math.max(input.limit, 1), 200)));
    if (offset > 0) url.searchParams.set("offset", String(offset));
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        "x-ebay-c-marketplace-id": "EBAY_US"
      }
    });
    if (!response.ok) {
      return buildResult(adapter, input, [], [`EBAY_BROWSE_API_ERROR: HTTP ${response.status}`], [`EBAY_BROWSE_API_ERROR: HTTP ${response.status}`]);
    }

    const payload = await response.json() as EbayBrowseSearchResponse;
    const summaries = Array.isArray(payload.itemSummaries) ? payload.itemSummaries : [];
    const items = summaries.map(mapEbayBrowseItem)
      .filter((item) => item.title !== "" && item.price !== null && item.url !== "")
      .slice(0, input.limit);
    const total = typeof payload.total === "number" ? payload.total : offset + summaries.length;
    const nextOffset = offset + summaries.length;
    const hasMore = summaries.length > 0 && nextOffset < total;
    return buildResult(
      adapter,
      input,
      items,
      items.length > 0 ? ["EBAY_SALE_STATUS_UNAVAILABLE"] : ["EBAY_BROWSE_API_EMPTY: no items returned"],
      [],
      { has_more: hasMore, next_cursor: hasMore ? `offset:${nextOffset}` : null }
    );
  } catch (error) {
    const message = error instanceof Error && /^EBAY_[A-Z_]+:/.test(error.message)
      ? error.message
      : "EBAY_BROWSE_API_ERROR: request failed";
    return buildResult(adapter, input, [], [message], [message]);
  }
}

export async function tryExtractPublicSearchResult(
  adapter: BrowserSiteAdapter,
  input: SearchCommandInput,
  _pageHtml: string
): Promise<SearchResult | null> {
  return adapter.siteKey === "ebay" ? extractEbayBrowseApiResult(adapter, input) : null;
}
