import { createBrowserSiteAdapter } from "./shared.js";

export const mercariJpAdapter = createBrowserSiteAdapter({
  siteKey: "mercari_jp",
  siteName: "Mercari Japan",
  countryCode: "JP",
  loginUrl: "https://jp.mercari.com/",
  loginSelectors: {
    signedIn: ["a[href*='/mypage']", "[data-testid='mypage-link']"],
    signedOut: ["a[href*='/login']", "[data-testid='login-link']"]
  },
  searchSelectors: {
    item: "li[data-testid='item-cell']",
    title: "[data-testid='thumbnail-item-name']",
    price: ".merPrice",
    seller: "[data-testid='seller-name']",
    url: "a[data-testid='thumbnail-link']",
    image: "img"
  },
  readySelector: "li[data-testid='item-cell'] .merPrice",
  searchRendering: "dynamic",
  keywordMatch: "compact_model",
  searchPagination: "none",
  priceLabel: "Sale price",
  debugNotes: [
    "public rendered search cards only; no private or public API endpoint is called",
    "display currency can be KRW or JPY depending on the visitor locale"
  ],
  searchUrl(keyword: string): string {
    return `https://jp.mercari.com/search?keyword=${encodeURIComponent(keyword)}`;
  }
});
