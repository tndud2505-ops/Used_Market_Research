import { createBrowserSiteAdapter } from "./shared.js";

export const joonggonaraAdapter = createBrowserSiteAdapter({
  siteKey: "joonggonara",
  siteName: "중고나라",
  loginUrl: "https://web.joongna.com",
  loginSelectors: {
    signedIn: ["a[href='/mystore']", "[data-testid='profile-button']"],
    signedOut: ["a[href*='login']", "button[aria-label='로그인']"]
  },
  searchSelectors: {
    item: "[data-role='listing-card'], .search-result-item, .item-card",
    title: "[data-role='listing-title'], .title, .item-title",
    price: "[data-role='listing-price'], .price, .item-price",
    seller: "[data-role='seller-name'], .seller, .nickname",
    url: "a[href]",
    image: "img",
    location: "[data-role='listing-location'], .location, .area",
    postedAt: "[data-role='listing-date'], .date, .posted-at",
    notes: "[data-role='listing-summary'], .desc, .summary"
  },
  debugNotes: [
    "search pages now resolve from web.joongna.com instead of the old cafe.naver.com path",
    "SSR search payload embeds an items array that the collector can parse before falling back to selectors"
  ],
  categoryPagination: "page",
  searchPagination: "page",
  searchUrl(keyword: string, _limit: number, cursor?: string | null): string {
    const url = new URL(`https://web.joongna.com/search/${encodeURIComponent(keyword)}`);
    const page = parsePageCursor(cursor);
    if (page > 0) url.searchParams.set("page", String(page));
    return url.toString();
  },
  categoryUrl(sourceCategoryId: string, _limit: number, cursor?: string | null): string {
    const url = new URL("https://web.joongna.com/search");
    url.searchParams.set("category", sourceCategoryId);
    const page = parsePageCursor(cursor);
    if (page > 0) url.searchParams.set("page", String(page));
    return url.toString();
  }
});

function parsePageCursor(cursor?: string | null) {
  const match = typeof cursor === "string" ? cursor.match(/^page:(\d+)$/) : null;
  return match ? Number(match[1]) : 0;
}
