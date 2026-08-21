import { createBrowserSiteAdapter } from "./shared.js";

export const vintedAdapter = createBrowserSiteAdapter({
  siteKey: "vinted",
  siteName: "Vinted US",
  countryCode: "US",
  loginUrl: "https://www.vinted.com/",
  loginSelectors: {
    signedIn: ["a[href*='/member/']", "[data-testid='user-menu']"],
    signedOut: ["a[href*='/member/signup']", "a[href*='/member/general/login']"]
  },
  searchSelectors: {
    item: "div[class*='new-item-box__container']",
    title: "p[data-testid$='--description-title']",
    price: "p[data-testid$='--price-text']",
    seller: "[data-testid$='--seller-name']",
    url: "a[data-testid$='--overlay-link']",
    image: "img[data-testid$='--image--img']",
    condition: "p[data-testid$='--description-subtitle']",
    nextPage: "a[data-testid='catalog-pagination--next-page']"
  },
  readySelector: "div[class*='new-item-box__container'] p[data-testid$='--price-text']",
  searchRendering: "static",
  keywordMatch: "compact_model",
  searchPagination: "page",
  priceLabel: "Sale price",
  debugNotes: [
    "the first card price excludes the separate buyer protection total",
    "public rendered cards are read without a Vinted API"
  ],
  searchUrl(keyword: string, _limit: number, cursor?: string | null): string {
    const page = cursor?.match(/^page:(\d+)(?::offset:\d+)?$/)?.[1];
    return `https://www.vinted.com/catalog?search_text=${encodeURIComponent(keyword)}${page ? `&page=${page}` : ""}`;
  }
});
