import { createBrowserSiteAdapter } from "./shared.js";

export const yahooAuctionJpAdapter = createBrowserSiteAdapter({
  siteKey: "yahoo_auction_jp",
  siteName: "Yahoo! Auctions Japan",
  countryCode: "JP",
  loginUrl: "https://auctions.yahoo.co.jp/",
  loginSelectors: {
    signedIn: ["a[href*='/myauctions']", "a[href*='/watchlist']"],
    signedOut: ["a[href*='login.yahoo.co.jp']"]
  },
  searchSelectors: {
    item: "li.Product",
    title: ".Product__titleLink",
    price: ".Product__priceValue",
    seller: ".Product__seller",
    url: "a.Product__titleLink",
    image: ".Product__imageData",
    postedAt: ".Product__time",
    shipping: ".Product__postage",
    notes: ".Product__priceInfo"
  },
  readySelector: "li.Product .Product__priceValue",
  searchRendering: "dynamic",
  keywordMatch: "compact_model",
  searchPagination: "none",
  priceLabel: "Current bid",
  debugNotes: [
    "the displayed amount is the current bid and is not a final transaction price",
    "shipping and remaining auction time are read from the public result card"
  ],
  searchUrl(keyword: string): string {
    return `https://auctions.yahoo.co.jp/search/search?p=${encodeURIComponent(keyword)}`;
  }
});
