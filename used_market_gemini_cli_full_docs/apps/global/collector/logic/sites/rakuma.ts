import { createBrowserSiteAdapter } from "./shared.js";

function searchKeyword(keyword: string): string {
  return /\b(iphone|galaxy|pixel|smartphone|phone)\b/i.test(keyword)
    ? `${keyword} 本体`
    : keyword;
}

export const rakumaAdapter = createBrowserSiteAdapter({
  siteKey: "rakuma",
  siteName: "Rakuma",
  countryCode: "JP",
  loginUrl: "https://fril.jp/",
  loginSelectors: {
    signedIn: ["a[href*='/users/'][href*='/mypage']", "a[href*='/mypage']"],
    signedOut: ["a[href*='/users/sign_in']", "a[href*='/users/sign_up']"]
  },
  searchSelectors: {
    item: ".item-box",
    title: ".link_search_title",
    price: ".price-status__price, .item-box__item-price",
    seller: ".brand-name",
    url: ".link_search_title",
    image: ".link_search_image img"
  },
  readySelector: ".item-box .item-box__item-price",
  searchRendering: "static",
  keywordMatch: "compact_model",
  searchPagination: "none",
  priceLabel: "Sale price",
  debugNotes: [
    "public Rakuma result cards only; no Rakuma API endpoint is called",
    "phone model searches add the Japanese body-only hint to reduce accessory results"
  ],
  searchUrl(keyword: string): string {
    return `https://fril.jp/s?query=${encodeURIComponent(searchKeyword(keyword))}`;
  }
});
