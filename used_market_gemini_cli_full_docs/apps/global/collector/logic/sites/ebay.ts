import { createBrowserSiteAdapter } from "./shared.js";

export const ebayAdapter = createBrowserSiteAdapter({
  siteKey: "ebay",
  siteName: "eBay",
  countryCode: "US",
  loginUrl: "https://www.ebay.com/",
  loginSelectors: {
    signedIn: ["#gh-eb-u"],
    signedOut: ["#gh-ug a[href*='signin']"]
  },
  searchSelectors: {
    item: "li.s-item",
    title: ".s-item__title",
    price: ".s-item__price",
    seller: ".s-item__seller-info-text",
    url: ".s-item__link",
    image: ".s-item__image-img",
    condition: ".SECONDARY_INFO"
  },
  searchRendering: "static",
  keywordMatch: "compact_model",
  searchPagination: "offset",
  priceLabel: "Sale price",
  debugNotes: [
    "search results are collected from the official eBay Browse API",
    "the public search URL is retained only as a source link"
  ],
  searchUrl(keyword: string): string {
    return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(keyword)}`;
  }
});
