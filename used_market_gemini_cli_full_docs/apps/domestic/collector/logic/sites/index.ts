import { bunjangAdapter } from "./bunjang.js";
import { daangnAdapter } from "./daangn.js";
import { joonggonaraAdapter } from "./joonggonara.js";
import { firstDefined, firstMatchingSelector } from "./shared.js";
import type { BrowserSiteAdapter } from "./shared.js";

const SITE_ADAPTERS: BrowserSiteAdapter[] = [
  joonggonaraAdapter,
  bunjangAdapter,
  daangnAdapter
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
