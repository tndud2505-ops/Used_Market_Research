import { createBrowserSiteAdapter } from "./shared.js";

export const poshmarkAdapter = createBrowserSiteAdapter({
  siteKey: "poshmark",
  siteName: "Poshmark",
  countryCode: "US",
  loginUrl: "https://poshmark.com/",
  loginSelectors: {
    signedIn: ["a[href*='/closet/']", "a[href*='/feed']"],
    signedOut: ["a[href='/login']", "a[href*='/signup']"]
  },
  searchSelectors: {
    item: ".tile-grid-redesign",
    title: ".tile-grid-redesign__title",
    price: ".tile-grid-redesign__price-current",
    seller: ".tile-grid-redesign__seller",
    url: "a.tile-grid-redesign__meta-link",
    image: ".tile-grid-redesign__media img",
    condition: ".tile-grid-redesign__condition"
  },
  readySelector: ".tile-grid-redesign .tile-grid-redesign__price-current",
  searchRendering: "static",
  keywordMatch: "compact_model",
  searchPagination: "none",
  priceLabel: "Sale price",
  debugNotes: [
    "public Poshmark listing tiles only; no Poshmark API endpoint is called",
    "accessory titles are filtered when the query contains a device model"
  ],
  searchUrl(keyword: string): string {
    return `https://poshmark.com/search?query=${encodeURIComponent(keyword)}&type=listings&src=dir`;
  }
});
