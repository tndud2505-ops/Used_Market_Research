import { createBrowserSiteAdapter } from "./shared.js";

export const unclaimedBaggageAdapter = createBrowserSiteAdapter({
  siteKey: "unclaimed_baggage",
  siteName: "Unclaimed Baggage",
  countryCode: "US",
  loginUrl: "https://www.unclaimedbaggage.com/",
  loginSelectors: {
    signedIn: ["a[href='/account']", "a[href*='/account/logout']"],
    signedOut: ["a[href*='/account/login']"]
  },
  searchSelectors: {
    item: "li.grid__item",
    title: ".card__heading .full-unstyled-link",
    price: ".price-item--sale.price-item--last, .price-item--regular",
    seller: ".card-information .caption-with-letter-spacing",
    url: ".card__heading .full-unstyled-link",
    image: ".card__media img",
    condition: ".condition-badge",
    shipping: ".badge.green",
    nextPage: "a[aria-label='Next']"
  },
  readySelector: "li.grid__item .price-item",
  searchRendering: "static",
  keywordMatch: "compact_model",
  searchPagination: "page",
  priceLabel: "Sale price",
  debugNotes: [
    "public Unclaimed Baggage product cards only; no Shopify or private API endpoint is called",
    "results are retailer inventory rather than peer-to-peer listings"
  ],
  searchUrl(keyword: string, _limit: number, cursor?: string | null): string {
    const page = cursor?.match(/^page:(\d+)(?::offset:\d+)?$/)?.[1];
    return `https://www.unclaimedbaggage.com/search?q=${encodeURIComponent(keyword)}&type=product${page ? `&page=${page}` : ""}`;
  }
});
