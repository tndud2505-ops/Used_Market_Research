import { SiteConfigSchema, type SiteConfig } from "../../MCP/logic/types.js";

const SITE_LIST: SiteConfig[] = [
  SiteConfigSchema.parse({ key: "joonggonara", name: "중고나라", siteType: "used_market", locale: "ko-KR", currency: "KRW", loginRequired: false }),
  SiteConfigSchema.parse({ key: "bunjang", name: "번개장터", siteType: "used_market", locale: "ko-KR", currency: "KRW", loginRequired: false }),
  SiteConfigSchema.parse({ key: "daangn", name: "당근", siteType: "marketplace", locale: "ko-KR", currency: "KRW", loginRequired: false }),
  SiteConfigSchema.parse({ key: "ebay", name: "eBay", siteType: "auction", locale: "en-US", currency: "USD", loginRequired: false })
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
