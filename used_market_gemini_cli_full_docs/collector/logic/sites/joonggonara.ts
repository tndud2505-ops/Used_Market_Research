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
    location: "[data-role='listing-location'], .location, .area",
    postedAt: "[data-role='listing-date'], .date, .posted-at",
    notes: "[data-role='listing-summary'], .desc, .summary"
  },
  debugNotes: [
    "search pages now resolve from web.joongna.com instead of the old cafe.naver.com path",
    "SSR search payload embeds an items array that the collector can parse before falling back to selectors"
  ],
  searchUrl(keyword: string, _limit: number): string {
    return `https://web.joongna.com/search/${encodeURIComponent(keyword)}`;
  }
});
