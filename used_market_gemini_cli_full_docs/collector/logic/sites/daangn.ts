import { createBrowserSiteAdapter } from "./shared.js";

function parseConfiguredDaangnAreas(value: string | undefined) {
  if (!value) {
    return [];
  }

  return value
    .split(/[,\n;]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export const DEFAULT_DAANGN_SEARCH_AREAS = [
  "수원시 우만동",
  "수원시 인계동",
  "수원시 매탄동",
  "수원시 원천동"
] as const;

export function getDaangnSearchAreas() {
  const configured = parseConfiguredDaangnAreas(
    process.env.PUBLIC_SEARCH_DAANGN_AREAS ?? process.env.DAANGN_SEARCH_AREAS
  );

  return configured.length > 0
    ? configured
    : [...DEFAULT_DAANGN_SEARCH_AREAS];
}

export const daangnAdapter = createBrowserSiteAdapter({
  siteKey: "daangn",
  siteName: "당근",
  loginUrl: "https://www.daangn.com/kr/",
  loginSelectors: {
    signedIn: ["[data-role='user-menu']", ".user-menu", ".header-profile"],
    signedOut: ["a[href*='login']", ".login", "[data-role='login-link']"]
  },
  searchSelectors: {
    item: "[data-role='search-result-card'], .search-result-item, .card",
    title: "[data-role='title'], .title, .card-title",
    price: "[data-role='price'], .price, .card-price",
    seller: "[data-role='seller'], .seller, .nickname",
    url: "a[href]",
    location: "[data-role='location'], .location, .area",
    postedAt: "[data-role='posted-at'], .date, .posted-at",
    notes: "[data-role='summary'], .desc, .summary"
  },
  debugNotes: [
    "list search should prefer the public marketplace search landing page",
    `default search areas: ${DEFAULT_DAANGN_SEARCH_AREAS.join(", ")}`,
    "detail-page fallback is still target-only"
  ],
  searchUrl(keyword: string, _limit: number): string {
    const url = new URL("https://www.daangn.com/kr/buy-sell/");
    url.searchParams.set("search", keyword);
    url.searchParams.set("in", getDaangnSearchAreas()[0] ?? DEFAULT_DAANGN_SEARCH_AREAS[0]);
    return url.toString();
  }
});
