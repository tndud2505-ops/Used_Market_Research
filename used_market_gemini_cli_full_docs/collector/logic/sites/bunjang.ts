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
    item: "[data-role='product-card'], .item-card, .search-result-item",
    title: "[data-role='product-title'], .title, .item-title",
    price: "[data-role='product-price'], .price, .item-price",
    seller: "[data-role='seller-name'], .seller, .nickname",
    url: "a[href]",
    location: "[data-role='location'], .location, .area",
    postedAt: "[data-role='posted-at'], .date, .posted-at",
    notes: "[data-role='product-summary'], .desc, .summary"
  },
  debugNotes: [
    "the visible search page is now treated as a shell while collection pulls actual listings from the public find_v2 API",
    "API search is requested with recent ordering so market windows receive usable posted_at timestamps"
  ],
  searchUrl(keyword: string, limit: number): string {
    return `https://m.bunjang.co.kr/search/products?keyword=${encodeURIComponent(keyword)}&limit=${limit}`;
  }
});
