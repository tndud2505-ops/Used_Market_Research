export const SALE_COMPOSITIONS = Object.freeze(['ALL', 'SINGLE', 'COMPLETE_PC', 'BUNDLE']);

export function listingComposition(listing) {
  if (SALE_COMPOSITIONS.includes(listing?.sale_composition) && listing.sale_composition !== 'ALL') return listing.sale_composition;
  return ({ SINGLE_COMPONENT: 'SINGLE', SAME_PRODUCT_LOT: 'BUNDLE', FULL_SYSTEM: 'COMPLETE_PC',
    COMPONENT_BUNDLE: 'BUNDLE' })[listing?.listing_kind] || 'UNKNOWN';
}

export function listingCompositionLabel(listing) {
  return ({ SINGLE: '단품', COMPLETE_PC: '완제품', BUNDLE: '묶음' })[listingComposition(listing)] || '구성 미확인';
}
