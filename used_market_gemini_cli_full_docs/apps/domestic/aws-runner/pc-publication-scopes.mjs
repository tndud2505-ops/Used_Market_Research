import { statsPublicationKey } from '../cloudflare/public-product-stats.mjs';

// Reuse scope identities only, never prices from a previous publication. Every
// scope returned here must be rebuilt with the caller's one version and as_of.
export function fullPublicationScopes(db, observedScopes, options = {}) {
  if (!Array.isArray(observedScopes)) throw new Error('PC_STATS_OBSERVED_SCOPES_REQUIRED');
  const previous = db.prepare(`SELECT canonical_product_id, market_pool, condition_code, currency, days
    FROM pc_stored_price_publication_rows
    WHERE publication_id = (SELECT publication_id FROM pc_stored_price_publications
      ORDER BY published_at DESC, publication_id DESC LIMIT 1) AND days = 30`).all();
  // The first exact local publication has no local history. Its predecessor
  // can nevertheless be active on D1: omission is not proof of an empty set.
  // The release owner supplies a fresh read-only D1 manifest, not old prices.
  const external = options.externalActive;
  if (!previous.length && !external) throw new Error('PC_STATS_EXTERNAL_ACTIVE_SCOPES_REQUIRED');
  let externalScopes = [];
  if (external) {
    const checked = Date.parse(external.checked_at);
    const now = Number(options.now ?? Date.now());
    if (!Number.isFinite(checked) || checked > now + 60000 || now - checked > 300000) throw new Error('PC_STATS_EXTERNAL_SCOPE_PROOF_STALE');
    if (!Array.isArray(external.scopes) || !Number.isSafeInteger(external.row_count)
      || external.row_count !== external.scopes.length) throw new Error('PC_STATS_EXTERNAL_SCOPE_COUNT_MISMATCH');
    if (external.row_count === 0) {
      if (external.publication_id !== null || external.checksum !== null) throw new Error('PC_STATS_EXTERNAL_EMPTY_PROOF_INVALID');
    } else if (typeof external.publication_id !== 'string' || !external.publication_id
      || !/^[a-f0-9]{64}$/u.test(external.checksum || '')) throw new Error('PC_STATS_EXTERNAL_PUBLICATION_IDENTITY_REQUIRED');
    if (external.scopes.some(row => row.days !== 30 || row.publication_id != null && row.publication_id !== external.publication_id)) {
      throw new Error('PC_STATS_EXTERNAL_SCOPE_IDENTITY_INVALID');
    }
    if (new Set(external.scopes.map(statsPublicationKey)).size !== external.scopes.length) throw new Error('PC_STATS_EXTERNAL_SCOPE_DUPLICATE');
    externalScopes = external.scopes;
  }
  const scopes = new Map();
  for (const input of [...previous, ...externalScopes, ...observedScopes]) {
    const scope = { canonical_product_id: input.canonical_product_id, market_pool: input.market_pool,
      condition_code: input.condition_code, currency: input.currency, days: 30 };
    if (['canonical_product_id', 'market_pool', 'condition_code', 'currency'].some(key =>
      typeof scope[key] !== 'string' || !scope[key].trim() || scope[key] !== scope[key].trim())
      || input.days != null && input.days !== 30) {
      throw new Error('PC_STATS_SCOPE_IDENTITY_INVALID');
    }
    scopes.set(statsPublicationKey(scope), scope);
  }
  return [...scopes.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, scope]) => scope);
}

export function assertFullPublicationActivation(publication, activated) {
  if (activated?.active !== true || activated.publication_id !== publication.publication_id
    || activated.checksum !== publication.checksum
    || Number(activated.row_count) !== publication.expected_row_count
    || Number(activated.input_row_count) !== publication.expected_row_count
    || Number(activated.scope_key_count) !== publication.expected_row_count
    || Number(activated.preserved_row_count) !== 0 || activated.merged_with_active !== false) {
    throw new Error('D1_STATS_IMPORT_ACTIVATION_MANIFEST_MISMATCH');
  }
}
