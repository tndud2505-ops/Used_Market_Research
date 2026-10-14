// Identity and statistics eligibility are one classification result. Reconcile
// only the obsolete exact-model reason; preserve all independent review/price
// exclusions, and never change sale scope merely to obtain more samples.
import { PC_PRODUCT_MASTER_V2 } from '../market/data/pc-product-master-v2.mjs';
const products = new Map(PC_PRODUCT_MASTER_V2.map(product => [product.id, product]));
export function reconcileExactModelStatistics(previous, next, currency) {
  const oldReasons=JSON.parse(previous.statistics_exclusion_reasons_json||'[]');
  const reasons=[...new Set([...oldReasons,...next.statisticsExclusionReasons])];
  const unchanged=[['category_code','categoryCode'],['listing_kind','listingKind'],
    ['condition_code','conditionCode'],['quantity','quantity'],['price_scope','priceScope'],['market_pool','marketPool']]
    .every(([oldKey,newKey])=>previous[oldKey]===next[newKey]);
  const oldProduct = products.get(previous.canonical_product_id), newProduct = products.get(next.canonicalProductId);
  const sameIdentity = previous.canonical_product_id === next.canonicalProductId
    || (previous.canonical_product_id?.startsWith('motherboard:platform:') && oldProduct && newProduct
      && oldProduct.manufacturer === newProduct.manufacturer
      && oldProduct.spec?.platform_vendor === newProduct.spec?.platform_vendor);
  const currencyMatches = (['KR_C2C_USED', 'KR_DEALER_USED'].includes(previous.market_pool) && currency === 'KRW')
    || (previous.market_pool === 'OVERSEAS_USED' && currency === 'USD');
  const exactProof=unchanged&&sameIdentity&&currencyMatches&&previous.category_code==='MOTHERBOARD'
    && next.spec?.directory_node_type==='PRODUCT'&&next.spec?.exact_sku===true
    && next.canonicalProductId?.startsWith('motherboard:')
    && next.exactProduct === true;
  const resolved=exactProof&&oldReasons.includes('EXACT_MODEL_REQUIRED')
    && previous.price_eligible&&next.priceEligible
    && !next.statisticsExclusionReasons.includes('EXACT_MODEL_REQUIRED');
  const resolvedSataHdd = unchanged && sameIdentity && currencyMatches
    && previous.category_code === 'HDD' && next.marketSegment === 'SERVER_ENTERPRISE'
    && next.spec?.listing_interface === 'SATA' && next.placement === 'INTERNAL'
    && previous.price_eligible && next.priceEligible && next.statisticsEligible
    && oldReasons.includes('MARKET_SEGMENT_OUT_OF_SCOPE')
    && !next.statisticsExclusionReasons.includes('MARKET_SEGMENT_OUT_OF_SCOPE');
  const remaining=reasons.filter(reason=>!(resolved&&reason==='EXACT_MODEL_REQUIRED')
    && !(resolvedSataHdd&&reason==='MARKET_SEGMENT_OUT_OF_SCOPE'));
  const priorExclusions=JSON.parse(previous.exclusion_reasons_json||'[]');
  const eligible=Boolean(next.statisticsEligible&&remaining.length===0
    && (previous.statistics_eligible||((resolved||resolvedSataHdd)&&priorExclusions.length===0&&next.exclusionReasons.length===0)));
  return {statistics_eligible:eligible?1:0,statistics_exclusion_reasons_json:JSON.stringify(remaining),
    ...(Object.hasOwn(previous,'exact_product')?{exact_product:exactProof?1:previous.exact_product}:{})};
}
