// A disclosure, not a price correction or an eligibility filter. Compare unit
// prices only within the published model/condition/currency/market cohort.
export function listingPriceWarning(listing, data) {
  if (!data?.publication_id || data.availability?.stale === true
    || listing?.canonical_product_id !== data.canonical_product_id
    || listing?.statistics_eligible !== true) return null;
  const scope = data.methodology || {};
  if (listing.currency !== scope.currency || listing.condition_code !== scope.condition) return null;
  const pools = scope.market_pool === 'KR_DOMESTIC_USED'
    ? ['KR_C2C_USED', 'KR_DEALER_USED'] : [scope.market_pool];
  if (!pools.includes(listing.market_pool)) return null;
  const status = String(listing.lifecycle_status || '').toUpperCase();
  const summary = status === 'ACTIVE' ? data.active : status === 'RESERVED' ? data.reserved : null;
  const lower = summary?.outlier_lower_bound, upper = summary?.outlier_upper_bound;
  if (!(summary?.sample_count >= 10) || !Number.isFinite(lower) || !Number.isFinite(upper) || upper <= lower) return null;
  const quantity = listing.quantity;
  const amount = listing.price_value ?? listing.price;
  if (!Number.isInteger(quantity) || quantity < 1 || !Number.isFinite(amount) || amount <= 0
    || !['TOTAL', 'UNIT'].includes(listing.price_scope)) return null;
  const unitPrice = listing.price_scope === 'TOTAL' ? amount / quantity : amount;
  const reason = unitPrice > upper ? 'IQR_HIGH' : unitPrice < lower ? 'IQR_LOW' : null;
  return reason ? { reason, unitPrice, lower, upper, sampleCount: summary.sample_count, asOf: data.as_of } : null;
}
