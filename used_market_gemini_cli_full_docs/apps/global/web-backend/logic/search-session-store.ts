import { randomUUID } from 'node:crypto';

export const SEARCH_SESSION_TTL_MS = 10 * 60 * 1000;
export const SEARCH_SESSION_MAX_ENTRIES = 32;
export const SEARCH_SESSION_MAX_ITEMS = 1000;
export const SEARCH_SESSION_PAGE_SIZE = 30;

export interface SearchSessionStoreOptions {
  ttlMs?: number;
  maxEntries?: number;
  maxItems?: number;
  now?: () => number;
}

export interface SearchSessionSnapshot {
  id: string;
  identity: string;
  generation: number;
  expiresAt: number;
  windowLimit: number;
  data: Record<string, unknown>;
  items: Record<string, unknown>[];
  sources: Record<string, unknown>[];
  pagination: { has_more: boolean; next_cursor: string | null };
}

export class SearchSessionGenerationMismatchError extends Error {
  constructor() {
    super('Search session generation is stale.');
    this.name = 'SearchSessionGenerationMismatchError';
  }
}

export class SearchSessionWindowInvalidError extends Error {
  constructor() {
    super('Search session window can increase by at most 160 items.');
    this.name = 'SearchSessionWindowInvalidError';
  }
}

interface SearchSessionRecord extends SearchSessionSnapshot {
  createdAt: number;
  lastAccessedAt: number;
}

export class SearchSessionStore {
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly maxItems: number;
  private readonly now: () => number;
  private readonly sessions = new Map<string, SearchSessionRecord>();

  constructor(options: SearchSessionStoreOptions = {}) {
    this.ttlMs = positiveInteger(options.ttlMs, SEARCH_SESSION_TTL_MS);
    this.maxEntries = positiveInteger(options.maxEntries, SEARCH_SESSION_MAX_ENTRIES);
    this.maxItems = positiveInteger(options.maxItems, SEARCH_SESSION_MAX_ITEMS);
    this.now = options.now ?? Date.now;
  }

  get size() {
    this.deleteExpired();
    return this.sessions.size;
  }

  create(identity: string, inputData: Record<string, unknown>): SearchSessionSnapshot {
    this.deleteExpired();
    while (this.sessions.size >= this.maxEntries) {
      const oldestId = this.sessions.keys().next().value as string | undefined;
      if (!oldestId) break;
      this.sessions.delete(oldestId);
    }

    const now = this.now();
    const id = randomUUID();
    const data = normalizeSessionData(inputData, [], this.maxItems);
    const record: SearchSessionRecord = {
      id,
      identity,
      generation: 1,
      createdAt: now,
      lastAccessedAt: now,
      expiresAt: now + this.ttlMs,
      windowLimit: Math.min(data.items instanceof Array ? data.items.length : 0, this.maxItems),
      data,
      items: readItems(data),
      sources: readSources(data),
      pagination: readPagination(data)
    };
    this.sessions.set(id, record);
    return snapshot(record);
  }

  read(id: string): SearchSessionSnapshot | null {
    const record = this.sessions.get(id);
    if (!record) return null;
    const now = this.now();
    if (record.expiresAt <= now) {
      this.sessions.delete(id);
      return null;
    }
    record.lastAccessedAt = now;
    record.expiresAt = now + this.ttlMs;
    this.sessions.delete(id);
    this.sessions.set(id, record);
    return snapshot(record);
  }

  append(id: string, inputData: Record<string, unknown>, expectedGeneration?: number): SearchSessionSnapshot | null {
    const current = this.sessions.get(id);
    if (!current) return null;
    const now = this.now();
    if (current.expiresAt <= now) {
      this.sessions.delete(id);
      return null;
    }
    if (expectedGeneration !== undefined && current.generation !== expectedGeneration) {
      throw new SearchSessionGenerationMismatchError();
    }

    const data = normalizeSessionData(inputData, current.items, this.maxItems, current.data);
    current.generation += 1;
    current.lastAccessedAt = now;
    current.expiresAt = now + this.ttlMs;
    current.data = data;
    current.items = readItems(data);
    current.sources = readSources(data);
    current.pagination = readPagination(data);
    this.sessions.delete(id);
    this.sessions.set(id, current);
    return snapshot(current);
  }

  advanceWindow(id: string, requestedWindow: number): SearchSessionSnapshot | null {
    const current = this.sessions.get(id);
    if (!current) return null;
    const now = this.now();
    if (current.expiresAt <= now) {
      this.sessions.delete(id);
      return null;
    }
    if (requestedWindow > current.windowLimit + 160) {
      throw new SearchSessionWindowInvalidError();
    }
    current.windowLimit = Math.min(this.maxItems, Math.max(current.windowLimit, requestedWindow));
    current.lastAccessedAt = now;
    current.expiresAt = now + this.ttlMs;
    this.sessions.delete(id);
    this.sessions.set(id, current);
    return snapshot(current);
  }

  delete(id: string) {
    return this.sessions.delete(id);
  }

  private deleteExpired() {
    const now = this.now();
    for (const [id, record] of this.sessions) {
      if (record.expiresAt <= now) this.sessions.delete(id);
    }
  }
}

export function canonicalSearchSessionItemKey(item: Record<string, unknown>) {
  const rawUrl = readString(item.url);
  if (rawUrl) {
    try {
      const url = new URL(rawUrl);
      url.hash = '';
      for (const key of [...url.searchParams.keys()]) {
        if (/^(?:utm_.+|ref|referrer|tracking|tracking_id|campaign|campaign_id|campid|mkcid|mkevt|toolid|customid|var)$/i.test(key)) {
          url.searchParams.delete(key);
        }
      }
      url.searchParams.sort();
      url.hostname = url.hostname.toLowerCase();
      if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
      return `url:${url.toString()}`;
    } catch {
      return `url:${rawUrl.trim()}`;
    }
  }

  const site = readString(item.site).toLowerCase();
  const id = readString(item.id);
  if (id) return `id:${site}:${id}`;
  const title = readString(item.title).toLowerCase().replace(/\s+/g, ' ').trim();
  const price = typeof item.price === 'number' && Number.isFinite(item.price) ? item.price : '';
  const currency = readString(item.currency).toUpperCase();
  return `fallback:${site}:${title}:${price}:${currency}`;
}

function normalizeSessionData(
  incoming: Record<string, unknown>,
  existingItems: Record<string, unknown>[],
  maxItems: number,
  existingData?: Record<string, unknown>
) {
  const items: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const value of [...existingItems, ...readItems(incoming)]) {
    const key = canonicalSearchSessionItemKey(value);
    if (seen.has(key) || items.length >= maxItems) continue;
    seen.add(key);
    items.push(structuredClone(value));
  }

  const sourceMap = new Map<string, Record<string, unknown>>();
  for (const source of [...readSources(existingData ?? {}), ...readSources(incoming)]) {
    const key = readString(source.key, 'unknown');
    const prior = sourceMap.get(key);
    sourceMap.set(key, prior ? mergeSource(prior, source) : structuredClone(source));
  }
  for (const item of items) {
    const key = readString(item.site, 'unknown');
    if (!sourceMap.has(key)) sourceMap.set(key, { key, name: key, warnings: [], errors: [] });
  }
  const sources = [...sourceMap.values()].map((source) => {
    const key = readString(source.key, 'unknown');
    const total = items.filter((item) => readString(item.site, 'unknown') === key).length;
    return {
      ...source,
      count: total,
      normalized_count: total,
      visible_count: total,
      total_count: total
    };
  });

  const reachedLimit = items.length >= maxItems;
  const incomingPagination = readPagination(incoming);
  const pagination = reachedLimit
    ? { has_more: false, next_cursor: null }
    : incomingPagination;
  const base = structuredClone({ ...(existingData ?? {}), ...incoming });
  return {
    ...base,
    items,
    sources,
    pagination
  };
}

function mergeSource(previous: Record<string, unknown>, next: Record<string, unknown>) {
  return {
    ...previous,
    ...next,
    warnings: uniqueStrings(previous.warnings, next.warnings).slice(0, 8),
    errors: uniqueStrings(previous.errors, next.errors).slice(0, 8),
    search_urls: uniqueStrings(
      previous.search_urls,
      previous.search_url ? [previous.search_url] : [],
      next.search_urls,
      next.search_url ? [next.search_url] : []
    )
  };
}

function snapshot(record: SearchSessionRecord): SearchSessionSnapshot {
  return structuredClone({
    id: record.id,
    identity: record.identity,
    generation: record.generation,
    expiresAt: record.expiresAt,
    windowLimit: record.windowLimit,
    data: record.data,
    items: record.items,
    sources: record.sources,
    pagination: record.pagination
  });
}

function readItems(value: Record<string, unknown>) {
  return Array.isArray(value.items)
    ? value.items.filter(isRecord).map((item) => structuredClone(item))
    : [];
}

function readSources(value: Record<string, unknown>) {
  return Array.isArray(value.sources)
    ? value.sources.filter(isRecord).map((source) => structuredClone(source))
    : [];
}

function readPagination(value: Record<string, unknown>) {
  const pagination = isRecord(value.pagination) ? value.pagination : {};
  const nextCursor = typeof pagination.next_cursor === 'string' && pagination.next_cursor
    ? pagination.next_cursor
    : null;
  return {
    has_more: pagination.has_more === true && nextCursor !== null,
    next_cursor: nextCursor
  };
}

function uniqueStrings(...values: unknown[]) {
  return [...new Set(values.flatMap((value) => Array.isArray(value) ? value : []).map(String).filter(Boolean))];
}

function readString(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positiveInteger(value: number | undefined, fallback: number) {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}
