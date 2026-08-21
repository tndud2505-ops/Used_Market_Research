import { ebayAdapter } from "./ebay.js";
import { mercariJpAdapter } from "./mercari-jp.js";
import { poshmarkAdapter } from "./poshmark.js";
import { rakumaAdapter } from "./rakuma.js";
import { unclaimedBaggageAdapter } from "./unclaimed-baggage.js";
import { vintedAdapter } from "./vinted.js";
import { yahooAuctionJpAdapter } from "./yahoo-auction-jp.js";
import { firstDefined, firstMatchingSelector } from "./shared.js";
import type { BrowserSiteAdapter } from "./shared.js";

const SITE_ADAPTERS: BrowserSiteAdapter[] = [
  mercariJpAdapter,
  yahooAuctionJpAdapter,
  rakumaAdapter,
  poshmarkAdapter,
  vintedAdapter,
  unclaimedBaggageAdapter,
  ebayAdapter
];

export function listBrowserSiteAdapters(): BrowserSiteAdapter[] {
  return [...SITE_ADAPTERS];
}

export function resolveBrowserSiteAdapter(siteKey: string): BrowserSiteAdapter {
  const found = SITE_ADAPTERS.find((adapter) => adapter.siteKey === siteKey);
  if (!found) {
    throw new Error(`Unsupported browser site: ${siteKey}`);
  }
  return found;
}

export { firstDefined, firstMatchingSelector };
export type { BrowserSiteAdapter };
