import type { BrowserSession } from "../browserSession.js";

export interface BrowserLoginSelectors {
  signedIn: string[];
  signedOut: string[];
}

export interface BrowserSearchSelectors {
  item: string;
  title: string;
  price: string;
  seller: string;
  url: string;
  location?: string;
  postedAt?: string;
  notes?: string;
}

export interface BrowserSiteAdapter {
  readonly siteKey: string;
  readonly siteName: string;
  readonly loginUrl: string;
  readonly loginSelectors: BrowserLoginSelectors;
  readonly searchSelectors: BrowserSearchSelectors;
  readonly debugNotes: string[];
  searchUrl(keyword: string, limit: number): string;
}

export function createBrowserSiteAdapter(adapter: BrowserSiteAdapter): BrowserSiteAdapter {
  return adapter;
}

export function firstDefined(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") {
      return value;
    }
  }
  return "";
}

export async function firstMatchingSelector(session: BrowserSession, selectors: string[]): Promise<string | null> {
  for (const selector of selectors) {
    if (await session.exists(selector)) {
      return selector;
    }
  }
  return null;
}
