import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

type JsonRecord = Record<string, any>;

export interface LocalPcListingQuery {
  canonicalProductId: string | null;
  canonicalProductIds: string[] | null;
  manufacturer: string | null;
  boardManufacturer: string | null;
  sites: string[];
  sort: string;
  minPrice: number | null;
  maxPrice: number | null;
  limit: number;
  cursor: string | null;
}

export interface LocalPcStatsQuery {
  canonicalProductId: string;
  marketPool: string;
  condition: string;
  currency: string;
  days: number;
}

interface PublicationFiles {
  listingsPath: string;
  statsPath: string;
  asOf: string | null;
}

interface CachedJson {
  path: string;
  mtimeMs: number;
  value: JsonRecord;
}

function normalize(value: unknown): string {
  return String(value ?? '').normalize('NFKC').trim();
}

function same(left: unknown, right: unknown): boolean {
  return normalize(left).toUpperCase() === normalize(right).toUpperCase();
}

function optionalPath(value: unknown): string | null {
  const text = normalize(value);
  return text ? resolve(text) : null;
}

function candidateRoots(): string[] {
  const roots = [
    process.env.PC_LOCAL_PUBLICATION_DIR,
    process.env.PC_LOCAL_RUN_DIR,
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'UsedPick') : null,
    join(homedir(), 'AppData', 'Local', 'UsedPick'),
    join(tmpdir(), 'UsedPick')
  ].map(optionalPath).filter((value): value is string => Boolean(value));
  return [...new Set(roots)];
}

function isProductionWithoutExplicitPath(): boolean {
  return normalize(process.env.NODE_ENV).toLowerCase() === 'production'
    && !normalize(process.env.PC_LOCAL_PUBLICATION_DIR)
    && !normalize(process.env.PC_LOCAL_RUN_DIR)
    && !normalize(process.env.PC_LISTINGS_PUBLICATION_PATH)
    && !normalize(process.env.PC_STATS_PUBLICATION_PATH);
}

function publicationFiles(): PublicationFiles | null {
  const explicitListings = optionalPath(process.env.PC_LISTINGS_PUBLICATION_PATH);
  const explicitStats = optionalPath(process.env.PC_STATS_PUBLICATION_PATH);
  if (explicitListings || explicitStats) {
    const listingsPath = explicitListings || join(dirname(explicitStats as string), 'pc-listings-publication.json');
    const statsPath = explicitStats || join(dirname(explicitListings as string), 'pc-stats-publication.json');
    return { listingsPath, statsPath, asOf: null };
  }
  if (isProductionWithoutExplicitPath()) return null;

  const runs: Array<{ directory: string; mtimeMs: number }> = [];
  for (const root of candidateRoots()) {
    try {
      const rootStat = statSync(root);
      if (!rootStat.isDirectory()) continue;
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || !entry.name.startsWith('pc-local-scan-')) continue;
        const directory = join(root, entry.name);
        const listingsPath = join(directory, 'pc-listings-publication.json');
        const statsPath = join(directory, 'pc-stats-publication.json');
        try {
          const mtimeMs = Math.max(statSync(listingsPath).mtimeMs, statSync(statsPath).mtimeMs);
          runs.push({ directory, mtimeMs });
        } catch {
          // Incomplete local runs are ignored; the previous complete publication remains usable.
        }
      }
    } catch {
      // A missing local publication directory is a valid empty-state in development.
    }
  }
  const latest = runs.sort((left, right) => right.mtimeMs - left.mtimeMs)[0];
  if (!latest) return null;
  let asOf: string | null = null;
  try {
    const manifest = JSON.parse(readFileSync(join(latest.directory, 'manifest.json'), 'utf8')) as JsonRecord;
    asOf = normalize(manifest.created_at) || null;
  } catch {
    // The publication mtime is used when the manifest is unavailable.
  }
  return {
    listingsPath: join(latest.directory, 'pc-listings-publication.json'),
    statsPath: join(latest.directory, 'pc-stats-publication.json'),
    asOf
  };
}

let listingsCache: CachedJson | null = null;
let statsCache: CachedJson | null = null;

function readPublication(path: string): JsonRecord | null {
  try {
    const mtimeMs = statSync(path).mtimeMs;
    const cached = path.endsWith('pc-listings-publication.json') ? listingsCache : statsCache;
    if (cached?.path === path && cached.mtimeMs === mtimeMs) return cached.value;
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as JsonRecord;
    if (!parsed || typeof parsed !== 'object') return null;
    const next = { path, mtimeMs, value: parsed };
    if (path.endsWith('pc-listings-publication.json')) listingsCache = next;
    else statsCache = next;
    return parsed;
  } catch {
    return null;
  }
}

function publicationAsOf(files: PublicationFiles): string {
  if (files.asOf) return files.asOf;
  try {
    return new Date(statSync(files.listingsPath).mtimeMs).toISOString();
  } catch {
    return new Date().toISOString();
  }
}

function cursorOffset(cursor: string | null): number {
  const value = normalize(cursor);
  if (!value) return 0;
  const encoded = value.startsWith('offset:') ? value.slice('offset:'.length) : value;
  const offset = Number(encoded);
  return Number.isInteger(offset) && offset >= 0 ? offset : 0;
}

function emptyListings(asOf: string, reason: string) {
  return {
    items: [],
    total: 0,
    pagination: { has_more: false, next_cursor: null },
    next_cursor: null,
    as_of: asOf,
    freshness: { as_of: asOf, last_collected_at: null, age_seconds: null, state: 'EMPTY', reason }
  };
}

export function createLocalPcPublicationReader() {
  const listPcListings = (query: LocalPcListingQuery): Record<string, unknown> => {
    const files = publicationFiles();
    if (!files) return emptyListings(new Date().toISOString(), 'LOCAL_PUBLICATION_NOT_CONFIGURED');
    const publication = readPublication(files.listingsPath);
    const allItems = Array.isArray(publication?.items) ? publication.items : [];
    const sites = new Set(query.sites.map(normalize).filter(Boolean));
    const canonicalProductIds = Array.isArray(query.canonicalProductIds)
      ? new Set(query.canonicalProductIds.map(normalize).filter(Boolean))
      : null;
    let items = allItems.filter((item: JsonRecord) => {
      if (query.canonicalProductId && !same(item.canonical_product_id, query.canonicalProductId)) return false;
      if (canonicalProductIds && !canonicalProductIds.has(normalize(item.canonical_product_id))) return false;
      if (sites.size && !sites.has(normalize(item.site))) return false;
      if (query.manufacturer && !same(item.canonical_manufacturer || item.manufacturer, query.manufacturer)) return false;
      if (query.boardManufacturer && !same(item.board_manufacturer, query.boardManufacturer)) return false;
      const price = Number(item.price_value);
      if (!Number.isFinite(price) || price <= 0) return false;
      if (query.minPrice !== null && price < query.minPrice) return false;
      if (query.maxPrice !== null && price > query.maxPrice) return false;
      return item.lifecycle_status === undefined || same(item.lifecycle_status, 'ACTIVE');
    });
    if (query.sort === 'price_asc') items.sort((left, right) => Number(left.price_value) - Number(right.price_value));
    else if (query.sort === 'price_desc') items.sort((left, right) => Number(right.price_value) - Number(left.price_value));
    else items.sort((left, right) => String(right.updated_at || right.posted_at || '').localeCompare(String(left.updated_at || left.posted_at || '')));
    const total = items.length;
    const offset = cursorOffset(query.cursor);
    const page = items.slice(offset, offset + query.limit);
    const nextOffset = offset + page.length;
    const asOf = publicationAsOf(files);
    return {
      items: page,
      total,
      pagination: { has_more: nextOffset < total, next_cursor: nextOffset < total ? `offset:${nextOffset}` : null },
      next_cursor: nextOffset < total ? `offset:${nextOffset}` : null,
      as_of: asOf,
      freshness: {
        as_of: asOf,
        last_collected_at: asOf,
        age_seconds: Math.max(0, Math.floor((Date.now() - Date.parse(asOf)) / 1000)),
        state: page.length ? 'FRESH' : 'EMPTY'
      }
    };
  };

  const getPriceStats = ({ canonicalProductId, marketPool, condition, currency, days }: LocalPcStatsQuery): JsonRecord | null => {
    const files = publicationFiles();
    if (!files) return null;
    const publication = readPublication(files.statsPath);
    const rows = Array.isArray(publication?.rows) ? publication.rows : [];
    const row = rows.find((candidate: JsonRecord) => (
      same(candidate.canonical_product_id, canonicalProductId)
      && same(candidate.market_pool, marketPool)
      && same(candidate.condition_code, condition)
      && same(candidate.currency, currency)
      && Number(candidate.days || days) === days
    ));
    const stats = row?.stats_json;
    return stats && typeof stats === 'object' ? { ...stats, canonical_product_id: canonicalProductId } : null;
  };

  return { listPcListings, getPriceStats };
}
