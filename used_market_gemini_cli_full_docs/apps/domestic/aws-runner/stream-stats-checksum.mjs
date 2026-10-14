import { createHash } from 'node:crypto';
import { statsPublicationKey } from '../cloudflare/public-product-stats.mjs';

// Byte-identical canonical JSON, without a full-publication string and UTF-8 buffer.
export function streamStatsChecksum(rows) {
  const hash = createHash('sha256').update('[');
  let separator = '';
  for (const row of [...rows].sort((a, b) => statsPublicationKey(a).localeCompare(statsPublicationKey(b)))) {
    hash.update(separator).update(JSON.stringify({
      canonical_product_id: String(row.canonical_product_id), market_pool: String(row.market_pool),
      condition_code: String(row.condition_code), currency: String(row.currency), days: Number(row.days),
      stats_json: typeof row.stats_json === 'string' ? row.stats_json : JSON.stringify(row.stats_json), as_of: String(row.as_of)
    }));
    separator = ',';
  }
  return hash.update(']').digest('hex');
}
