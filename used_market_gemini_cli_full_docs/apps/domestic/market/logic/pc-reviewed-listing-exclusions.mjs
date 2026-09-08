import { canonicalSourceListingToken } from "../../aws-runner/pc-source-listing-identity.mjs";

export const PC_REVIEWED_LISTING_EXCLUSIONS = Object.freeze([
  Object.freeze({
    source_id: "hellomarket",
    source_listing_token: "182653333",
    reason: "FULL_SYSTEM",
    reviewed_at: "2026-09-09",
    evidence: "PUBLIC_DETAIL_DESCRIPTION_AND_KEYWORDS"
  }),
  Object.freeze({
    source_id: "hellomarket",
    source_listing_token: "183908019",
    reason: "QUANTITY_UNKNOWN",
    reviewed_at: "2026-09-09",
    evidence: "PUBLIC_DETAIL_DESCRIPTION"
  })
]);

const EXCLUSION_BY_IDENTITY = new Map(PC_REVIEWED_LISTING_EXCLUSIONS.map((entry) => [
  `${entry.source_id}\u0000${entry.source_listing_token}`,
  entry
]));

export function reviewedPcListingExclusion(sourceId, sourceListingId) {
  const source = String(sourceId || "").trim().toLowerCase();
  if (!source) return null;
  try {
    const token = canonicalSourceListingToken(source, sourceListingId);
    return EXCLUSION_BY_IDENTITY.get(`${source}\u0000${token}`) || null;
  } catch {
    return null;
  }
}
