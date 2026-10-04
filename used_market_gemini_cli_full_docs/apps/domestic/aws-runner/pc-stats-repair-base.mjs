import { getStatsJson } from './pc-stats-publication-client.mjs';
import { verifyStoredStatsOnAws } from './pc-stats-readback.mjs';
import { statsChunkManifestChecksum } from '../cloudflare/public-product-stats.mjs';

export async function readVerifiedRepairBase({ importUrl, token, publicationId, normalizationVersion }) {
  if (!publicationId) throw new Error('REPAIR_BASE_ID_REQUIRED');
  const url = new URL(importUrl);
  if (url.protocol !== 'https:' || url.username || url.password || !token) throw new Error('REPAIR_READBACK_NOT_CONFIGURED');
  url.pathname = '/admin/product-stats-readback'; url.hash = '';
  let metadata, count;
  const chunks = [];
  for (let offset = 0; ; offset += 40) {
    url.search = new URLSearchParams({ publication_id: publicationId, kind: 'chunks', offset: String(offset) });
    const { page } = await getStatsJson(url, token);
    if (!metadata) metadata = page?.publication;
    if (!metadata || metadata.publication_id !== publicationId || ![0, 1].includes(metadata.active)
      || page?.kind !== 'chunks' || page.offset !== offset || page.limit !== 40
      || JSON.stringify(page.publication) !== JSON.stringify(metadata) || !page.items?.length)
      throw new Error('REPAIR_BASE_CHANGED');
    count ??= page.items[0].expected_chunk_count;
    if (!Number.isSafeInteger(count) || count < 1 || count > 100000
      || page.items.length !== Math.min(40, count - offset)) throw new Error('INVALID_REPAIR_CHUNKS');
    chunks.push(...page.items);
    if (chunks.length === count) break;
  }
  const publication = { ...metadata, normalization_version: normalizationVersion,
    expected_chunk_count: count, chunk_manifest_checksum: await statsChunkManifestChecksum(chunks) };
  const result = await verifyStoredStatsOnAws({ importUrl, token, publication,
    expectedActive: metadata.active, includeRows: true });
  const { rows, ...proof } = result;
  return { ...publication, rows, proof };
}
