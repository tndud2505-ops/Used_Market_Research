export const DOMESTIC_USED_POOL = 'KR_DOMESTIC_USED';
export function underlyingMarketPools(pool) {
  return pool === DOMESTIC_USED_POOL ? ['KR_C2C_USED', 'KR_DEALER_USED'] : [pool];
}
export function withDomesticStatsScopes(scopes) {
  const all = [...scopes];
  for (const scope of scopes) {
    if (['KR_C2C_USED', 'KR_DEALER_USED'].includes(scope.market_pool) && scope.currency === 'KRW') {
      all.push({ ...scope, market_pool: DOMESTIC_USED_POOL });
    }
  }
  return [...new Map(all.map(scope => [JSON.stringify([scope.canonical_product_id, scope.market_pool,
    scope.condition_code, scope.currency, scope.days || 30]), scope])).values()];
}
