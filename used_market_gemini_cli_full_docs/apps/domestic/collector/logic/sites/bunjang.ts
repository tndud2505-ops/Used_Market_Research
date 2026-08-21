import { createBrowserSiteAdapter } from "./shared.js";

export const bunjangAdapter = createBrowserSiteAdapter({
  siteKey: "bunjang",
  siteName: "번개장터",
  loginUrl: "https://m.bunjang.co.kr",
  loginSelectors: {
    signedIn: ["a[href='/my']", "[data-testid='user-menu']"],
    signedOut: ["a[href*='login']", "button[aria-label='로그인']"]
  },
  searchSelectors: {
    item: "a[href*='/products/'], [data-role='product-card'], .item-card, .search-result-item",
    title: "[data-role='product-title'], .title, .item-title, p",
    price: "[data-role='product-price'], .price, .item-price, p",
    seller: "[data-role='seller-name'], .seller, .nickname",
    url: "a[href]",
    image: "img",
    location: "[data-role='location'], .location, .area",
    postedAt: "[data-role='posted-at'], .date, .posted-at",
    notes: "[data-role='product-summary'], .desc, .summary",
    titleIndex: 1,
    priceIndex: 0,
    urlOnItem: true
  },
  debugNotes: [
    "the visible search page is now treated as a shell while collection pulls actual listings from the public find_v2 API",
    "API search is requested with recent ordering so market windows receive usable posted_at timestamps"
  ],
  categoryRendering: "dynamic",
  categoryPagination: "page",
  searchPagination: "page",
  searchUrl(keyword: string, limit: number, _cursor?: string | null): string {
    return `https://m.bunjang.co.kr/search/products?keyword=${encodeURIComponent(keyword)}&limit=${limit}`;
  },
  categoryUrl(sourceCategoryId: string, _limit: number, cursor?: string | null): string {
    const url = new URL(`https://m.bunjang.co.kr/categories/${encodeURIComponent(sourceCategoryId)}`);
    const page = parsePageCursor(cursor);
    if (page > 0) url.searchParams.set("page", String(page));
    if (cursor && !/^page:\d+$/.test(cursor)) url.searchParams.set("cursor", cursor);
    return url.toString();
  }
});

function parsePageCursor(cursor?: string | null) {
  const match = typeof cursor === "string" ? cursor.match(/^page:(\d+)$/) : null;
  return match ? Number(match[1]) : 0;
}
