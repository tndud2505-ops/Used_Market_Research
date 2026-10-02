// Bunjang's public web product contract: 2 is deleted, 3 is sold.
export function bunjangLifecycleStatus(value) {
  const status = String(value ?? "").trim().toUpperCase();
  return ({ "0": "ACTIVE", SELLING: "ACTIVE", ACTIVE: "ACTIVE",
    "1": "RESERVED", RESERVED: "RESERVED", "2": "DELETED", DELETED: "DELETED",
    "3": "SOLD", SOLD_OUT: "SOLD", SOLD: "SOLD" })[status] || "UNAVAILABLE_UNKNOWN";
}

export function bunjangProductIdFromListing({ url, sourceListingId } = {}) {
  for (const value of [url, sourceListingId]) {
    const match = String(value || '').match(/(?:^|\/)products\/(\d+)(?:\/?(?:[?#].*)?$)/iu);
    if (match) return match[1];
  }
  return null;
}

export function parseBunjangDetailLifecycle(payload, expectedId) {
  const product = payload?.data?.product;
  if (!/^\d+$/.test(String(expectedId)) || String(product?.pid) !== String(expectedId)) {
    throw new Error("BUNJANG_DETAIL_IDENTITY_MISMATCH");
  }
  const status = bunjangLifecycleStatus(product.saleStatus);
  return {
    status,
    price: Number.isFinite(Number(product.price)) && Number(product.price) > 0 ? Number(product.price) : null,
    description: typeof product.description === 'string' ? product.description.trim().slice(0, 20_000) : null,
    evidence: { type: "STRUCTURED_STATUS", value: status },
    sourceStatus: String(product.saleStatus ?? "")
  };
}

export function bunjangDetailObservationItem(listing, raw, detail, canonicalUrl) {
  const description = detail.description ?? listing.description ?? null;
  return {
    ...raw,
    site: 'bunjang',
    item_id: raw.item_id || raw.id || `bunjang:${listing.source_listing_id}`,
    source_listing_id: listing.source_listing_id,
    title: listing.title,
    description,
    url: canonicalUrl,
    price: detail.price ?? listing.price_value,
    currency: listing.currency,
    status: detail.status,
    lifecycle_status: detail.status,
    availability: ['ACTIVE', 'RESERVED'].includes(detail.status) ? 'AVAILABLE' : 'UNAVAILABLE',
    raw_payload: { ...raw, url: canonicalUrl, description, status: detail.status, bunjang_sale_status: detail.sourceStatus }
  };
}
