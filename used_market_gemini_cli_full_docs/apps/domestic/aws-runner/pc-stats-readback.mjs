import { getStatsJson } from './pc-stats-publication-client.mjs';
import { verifyProductStatsReadback } from '../cloudflare/public-product-stats.mjs';

// Called only by the authenticated runner route. Fetch targets come from the
// protected server configuration, never from the activation request.
export async function verifyStoredStatsOnAws({ importUrl, token, publication }) {
  const started = performance.now();
  const cpuStarted = process.cpuUsage();
  if (!Number.isSafeInteger(publication.expected_row_count) || publication.expected_row_count < 1
    || publication.expected_row_count > 100_000 || !Number.isSafeInteger(publication.expected_chunk_count)
    || publication.expected_chunk_count < 1 || publication.expected_chunk_count > publication.expected_row_count)
    throw new Error('INVALID_PUBLICATION_READBACK_SIZE');
  const base = new URL(importUrl);
  if (base.protocol !== 'https:' || base.username || base.password || !token) throw new Error('READBACK_NOT_CONFIGURED');
  base.pathname = '/admin/product-stats-readback';
  base.search = ''; base.hash = '';
  let pages = 0;
  let identities = [];
  const d1Usage = { rows_read: 0, rows_written: 0 };
  async function page(kind, offset, count, limit, afterRowid = null) {
    if (performance.now() - started > 80_000) throw new Error('PUBLICATION_READBACK_TIMEOUT');
    const url = new URL(base);
    url.searchParams.set('publication_id', publication.publication_id);
    url.searchParams.set('kind', kind);
    url.searchParams.set('offset', String(offset));
    if (afterRowid !== null) url.searchParams.set('after_rowid', String(afterRowid));
    if (kind === 'rows') url.searchParams.set('row_ids', identities.slice(offset, offset + limit).map(row => row.storage_rowid).join(','));
    const result = (await getStatsJson(url, token, 15_000)).page;
    const stored = result?.publication;
    if (!stored || stored.active !== 0 || result.kind !== kind || result.offset !== offset || result.limit !== limit
      || !Array.isArray(result.items) || result.items.length !== Math.min(limit, count - offset))
      throw new Error('PUBLICATION_READBACK_PAGE_INVALID');
    for (const key of ['publication_id', 'checksum', 'expected_row_count', 'expected_non_empty_scope_count',
      'parser_version', 'rule_version', 'filter_version', 'created_at']) {
      if (stored[key] !== publication[key]) throw new Error('PUBLICATION_READBACK_IDENTITY_CHANGED');
    }
    pages += 1;
    d1Usage.rows_read += Number(result.d1_usage?.rows_read || 0);
    d1Usage.rows_written += Number(result.d1_usage?.rows_written || 0);
    return result.items;
  }
  async function readAll(kind, count, limit) {
    const values = [];
    // Each Worker request reads only a few rows; bounded concurrency keeps the
    // callback below the origin response timeout without a CPU-heavy Worker.
    for (let offset = 0; offset < count; offset += limit * 4) {
      const requests = [];
      for (let at = offset; at < Math.min(count, offset + limit * 4); at += limit)
        requests.push(page(kind, at, count, limit));
      values.push(...(await Promise.all(requests)).flat());
    }
    return values;
  }
  // Inventory only integer row IDs first, then use indexed point reads. Using
  // OFFSET on every large stats page would spend the free D1 read quota on scans.
  // Seek the last verified storage ID. OFFSET would revisit and sort the same
  // publication on every page, multiplying reads as the directory grows.
  for (let offset = 0; offset < publication.expected_row_count; offset += 100) {
    const after = identities.at(-1)?.storage_rowid || 0;
    const items = await page('identities', offset, publication.expected_row_count, 100, after);
    if (items.some((row, index) => row.storage_rowid <= (items[index - 1]?.storage_rowid ?? after)))
      throw new Error('PUBLICATION_READBACK_IDENTITIES_INVALID');
    identities.push(...items);
  }
  if (new Set(identities.map(row => row.storage_rowid)).size !== identities.length
    || identities.some(row => !Number.isSafeInteger(row.storage_rowid) || row.storage_rowid < 1))
    throw new Error('PUBLICATION_READBACK_IDENTITIES_INVALID');
  const rows = await readAll('rows', publication.expected_row_count, 4);
  const chunks = await readAll('chunks', publication.expected_chunk_count, 40);
  const proof = await verifyProductStatsReadback(publication, rows, chunks);
  const cpu = process.cpuUsage(cpuStarted);
  return { ...proof, pages, d1_usage: d1Usage, elapsed_ms: Math.round(performance.now() - started),
    process_cpu_ms: Math.round((cpu.user + cpu.system) / 1000) };
}
