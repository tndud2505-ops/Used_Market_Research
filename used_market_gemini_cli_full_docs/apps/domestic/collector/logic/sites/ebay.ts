import { createBrowserSiteAdapter } from "./shared.js";

export const ebayAdapter = createBrowserSiteAdapter({
  siteKey: "ebay",
  siteName: "eBay",
  loginUrl: "https://www.ebay.com/",
  loginSelectors: {
    signedIn: ["[aria-label='My eBay']", ".gh-ug-guest", ".gh-ug"],
    signedOut: ["a[href*='signin']", ".signin", "[data-test-id='sign-in']"]
  },
  searchSelectors: {
    item: ".s-item, [data-testid='item-card']",
    title: ".s-item__title, [data-testid='item-title']",
    price: ".s-item__price, [data-testid='item-price']",
    seller: ".s-item__seller-info-text, [data-testid='seller-name']",
    url: "a[href]",
    image: ".s-item__image-img, img",
    location: ".s-item__location, [data-testid='item-location']",
    postedAt: ".s-item__subtitle, [data-testid='posted-at']",
    notes: ".s-item__subtitle, [data-testid='summary']"
  },
  debugNotes: [
    "search results should be pulled from the listing cards before any interpretation",
    "eBay acts as the non-login baseline site"
  ],
  searchPagination: "offset",
  searchUrl(keyword: string, limit: number): string {
    return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(keyword)}&_sop=12&_ipg=${limit}`;
  }
});
