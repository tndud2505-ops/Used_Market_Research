import type { BrowserSession } from "../browserSession.js";

export interface BrowserLoginSelectors {
  signedIn: string[];
  signedOut: string[];
}

export interface BrowserSearchSelectors {
  item: string;
  title: string;
  price: string;
  seller: string;
  url: string;
  image?: string;
  location?: string;
  postedAt?: string;
  condition?: string;
  shipping?: string;
  notes?: string;
  nextPage?: string;
  titleIndex?: number;
  priceIndex?: number;
  sellerIndex?: number;
  urlOnItem?: boolean;
}

export interface BrowserSiteAdapter {
  readonly siteKey: string;
  readonly siteName: string;
  readonly countryCode?: "JP" | "US";
  readonly loginUrl: string;
  readonly loginSelectors: BrowserLoginSelectors;
  readonly searchSelectors: BrowserSearchSelectors;
  readonly readySelector?: string;
  readonly debugNotes: string[];
  readonly searchRendering?: "static" | "dynamic";
  readonly keywordMatch?: "compact_model";
  readonly priceLabel?: string;
  readonly categoryRendering?: "static" | "dynamic";
  readonly categoryPagination?: "page" | "none";
  readonly searchPagination?: "page" | "offset" | "none";
  searchUrl(keyword: string, limit: number, cursor?: string | null): string;
  categoryUrl?(sourceCategoryId: string, limit: number, cursor?: string | null): string;
}

const FOREIGN_SEARCH_ALIASES: ReadonlyArray<readonly [RegExp, string]> = [
  [/애플\s*워치/giu, "apple watch"],
  [/아이\s*폰/giu, "iphone"],
  [/아이\s*패드/giu, "ipad"],
  [/에어\s*팟/giu, "airpods"],
  [/갤럭시/giu, "galaxy"],
  [/맥\s*북/giu, "macbook"],
  [/구글\s*픽셀/giu, "google pixel"]
];

export function normalizeForeignSearchKeyword(keyword: string): string {
  return FOREIGN_SEARCH_ALIASES.reduce(
    (normalized, [pattern, replacement]) => normalized.replace(pattern, replacement),
    keyword.normalize("NFKC")
  ).replace(/\s+/g, " ").trim();
}

export function createBrowserSiteAdapter(adapter: BrowserSiteAdapter): BrowserSiteAdapter {
  if (!adapter.countryCode) return adapter;
  const buildSearchUrl = adapter.searchUrl.bind(adapter);
  return {
    ...adapter,
    searchUrl(keyword: string, limit: number, cursor?: string | null): string {
      return buildSearchUrl(normalizeForeignSearchKeyword(keyword), limit, cursor);
    }
  };
}

export function firstDefined(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") {
      return value;
    }
  }
  return "";
}

export async function firstMatchingSelector(session: BrowserSession, selectors: string[]): Promise<string | null> {
  for (const selector of selectors) {
    if (await session.exists(selector)) {
      return selector;
    }
  }
  return null;
}
