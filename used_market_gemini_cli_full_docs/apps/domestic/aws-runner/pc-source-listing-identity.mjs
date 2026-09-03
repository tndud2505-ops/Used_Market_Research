const SOURCE_ID_PATTERNS = Object.freeze({
  bunjang: [/\/products?\/(\d+)(?:[/?#]|$)/iu],
  hellomarket: [/\/item\/(\d+)(?:[/?#]|$)/iu],
  joonggonara: [/\/product\/(\d+)(?:[/?#]|$)/iu],
  ebay: [/^v1\|(\d{8,14})\|/iu, /\/itm\/(?:[^/?#]+\/)?(\d{8,14})(?:[/?#]|$)/iu],
  danawa: [/[?&](?:seq|saleSeq)=([a-z0-9_-]+)(?:[&#]|$)/iu],
  rethinkmall: [/\/goods\/(\d+)(?:[/?#]|$)/iu, /[?&]goodsNo=([a-z0-9_-]+)(?:[&#]|$)/iu],
  coolenjoy: [/\/mart2\/(\d+)(?:[/?#]|$)/iu, /[?&](?:wr_id|no)=(\d+)(?:[&#]|$)/iu]
});

function text(value) {
  return String(value ?? "").trim();
}

export function canonicalSourceListingToken(sourceId, sourceListingId) {
  const site = text(sourceId).toLowerCase();
  const prefix = `${site}:`;
  const raw = text(sourceListingId);
  const candidate = raw.toLowerCase().startsWith(prefix) ? raw.slice(prefix.length) : raw;
  for (const pattern of SOURCE_ID_PATTERNS[site] || []) {
    const match = candidate.match(pattern);
    if (match?.[1]) return match[1].toLowerCase();
  }
  if (/^[a-z0-9_-]+$/iu.test(candidate)) return candidate.toLowerCase();
  throw new Error(`SOURCE_LISTING_ID_UNRESOLVED:${site}:${sourceListingId}`);
}

export function canonicalSourceListingIdentity(sourceId, sourceListingId) {
  const site = text(sourceId).toLowerCase();
  return `${site}\u0000${canonicalSourceListingToken(site, sourceListingId)}`;
}
