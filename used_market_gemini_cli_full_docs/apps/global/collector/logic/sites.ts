import { SiteConfigSchema, type SiteConfig } from "../../MCP/logic/types.js";

const SITE_LIST: SiteConfig[] = [
  SiteConfigSchema.parse({ key: "mercari_jp", name: "Mercari Japan", siteType: "used_market", locale: "ja-JP", currency: "JPY", loginRequired: false }),
  SiteConfigSchema.parse({ key: "yahoo_auction_jp", name: "Yahoo! Auctions Japan", siteType: "auction", locale: "ja-JP", currency: "JPY", loginRequired: false }),
  SiteConfigSchema.parse({ key: "rakuma", name: "Rakuma", siteType: "used_market", locale: "ja-JP", currency: "JPY", loginRequired: false }),
  SiteConfigSchema.parse({ key: "poshmark", name: "Poshmark", siteType: "used_market", locale: "en-US", currency: "USD", loginRequired: false }),
  SiteConfigSchema.parse({ key: "vinted", name: "Vinted US", siteType: "used_market", locale: "en-US", currency: "USD", loginRequired: false }),
  SiteConfigSchema.parse({ key: "unclaimed_baggage", name: "Unclaimed Baggage", siteType: "used_market", locale: "en-US", currency: "USD", loginRequired: false }),
  SiteConfigSchema.parse({ key: "ebay", name: "eBay", siteType: "used_market", locale: "en-US", currency: "USD", loginRequired: false })
];

export function listSupportedSites(): SiteConfig[] {
  return [...SITE_LIST];
}

export function resolveSite(siteKey: string): SiteConfig {
  const found = SITE_LIST.find((site) => site.key === siteKey);
  if (!found) {
    throw new Error(`Unsupported site: ${siteKey}`);
  }
  return found;
}
