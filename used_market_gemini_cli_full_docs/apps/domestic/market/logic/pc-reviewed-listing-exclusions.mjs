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
  }),
  Object.freeze({
    source_id: "joonggonara",
    source_listing_token: "232154630",
    reason: "FULL_SYSTEM",
    reviewed_at: "2026-09-09",
    evidence: "PUBLIC_TITLE_MULTI_COMPONENT_CONFIGURATION"
  }),
  Object.freeze({
    source_id: "joonggonara",
    source_listing_token: "231821019",
    reason: "FULL_SYSTEM",
    reviewed_at: "2026-09-09",
    evidence: "PUBLIC_TITLE_ASUS_VIVOBOOK"
  }),
  Object.freeze({
    source_id: "joonggonara",
    source_listing_token: "231873683",
    reason: "FULL_SYSTEM",
    reviewed_at: "2026-09-09",
    evidence: "PUBLIC_TITLE_LENOVO_IDEAPAD"
  }),
  Object.freeze({
    source_id: "ebay",
    source_listing_token: "178468318702",
    reason: "QUANTITY_UNNORMALIZED",
    reviewed_at: "2026-09-09",
    evidence: "PUBLIC_TITLE_LOT_OF_2"
  }),
  Object.freeze({
    source_id: "ebay",
    source_listing_token: "307163286429",
    reason: "QUANTITY_UNNORMALIZED",
    reviewed_at: "2026-09-09",
    evidence: "PUBLIC_TITLE_LOT_OF_3"
  }),
  Object.freeze({
    source_id: "ebay",
    source_listing_token: "318229011395",
    reason: "QUANTITY_UNNORMALIZED",
    reviewed_at: "2026-09-09",
    evidence: "PUBLIC_TITLE_LOT_OF_6"
  }),
  Object.freeze({
    source_id: "ebay",
    source_listing_token: "327343241050",
    reason: "QUANTITY_UNNORMALIZED",
    reviewed_at: "2026-09-09",
    evidence: "PUBLIC_TITLE_LOT_OF_6"
  }),
  Object.freeze({
    source_id: "ebay",
    source_listing_token: "366656620371",
    reason: "QUANTITY_UNNORMALIZED",
    reviewed_at: "2026-09-09",
    evidence: "PUBLIC_TITLE_LOT_OF_12_RAM"
  }),
  Object.freeze({
    source_id: "ebay",
    source_listing_token: "147559704399",
    reason: "QUANTITY_UNNORMALIZED",
    reviewed_at: "2026-09-09",
    evidence: "PUBLIC_TITLE_LOT_OF_10_SSD"
  }),
  Object.freeze({
    source_id: "ebay",
    source_listing_token: "307169159533",
    reason: "QUANTITY_UNNORMALIZED",
    reviewed_at: "2026-09-09",
    evidence: "PUBLIC_TITLE_LOT_OF_12_RAM"
  }),
  Object.freeze({
    source_id: "joonggonara",
    source_listing_token: "232143652",
    reason: "FULL_SYSTEM",
    reviewed_at: "2026-09-09",
    evidence: "PUBLIC_TITLE_SURFACE_BOOK"
  }),
  Object.freeze({
    source_id: "hellomarket",
    source_listing_token: "183525555",
    reason: "FULL_SYSTEM",
    reviewed_at: "2026-09-09",
    evidence: "PUBLIC_TITLE_ASUS_ZENBOOK"
  }),
  Object.freeze({
    source_id: "hellomarket",
    source_listing_token: "183525566",
    reason: "FULL_SYSTEM",
    reviewed_at: "2026-09-09",
    evidence: "PUBLIC_TITLE_ASUS_ZENBOOK"
  }),
  Object.freeze({
    source_id: "joonggonara",
    source_listing_token: "231055683",
    reason: "FULL_SYSTEM",
    reviewed_at: "2026-09-09",
    evidence: "PUBLIC_TITLE_LG_GRAM"
  }),
  Object.freeze({
    source_id: "joonggonara",
    source_listing_token: "232184355",
    reason: "FULL_SYSTEM",
    reviewed_at: "2026-09-09",
    evidence: "PUBLIC_TITLE_ASUS_TUF_A14"
  }),
  Object.freeze({
    source_id: "joonggonara",
    source_listing_token: "222435564",
    reason: "FULL_SYSTEM",
    reviewed_at: "2026-09-09",
    evidence: "PUBLIC_TITLE_ASUS_VIVOBOOK"
  }),
  Object.freeze({
    source_id: "joonggonara",
    source_listing_token: "231697538",
    reason: "FULL_SYSTEM",
    reviewed_at: "2026-09-09",
    evidence: "PUBLIC_TITLE_HP_ELITEDESK"
  }),
  Object.freeze({
    source_id: "joonggonara",
    source_listing_token: "231813778",
    reason: "FULL_SYSTEM",
    reviewed_at: "2026-09-09",
    evidence: "PUBLIC_TITLE_XEON_GPU_STORAGE_CONFIGURATION"
  }),
  Object.freeze({
    source_id: "joonggonara",
    source_listing_token: "231969556",
    reason: "OPTION_AD",
    reviewed_at: "2026-09-09",
    evidence: "PUBLIC_TITLE_MULTIPLE_CPU_MODELS"
  }),
  Object.freeze({
    source_id: "ebay",
    source_listing_token: "307169179138",
    reason: "QUANTITY_UNNORMALIZED",
    reviewed_at: "2026-09-09",
    evidence: "PUBLIC_TITLE_3X_UNITS"
  }),
  Object.freeze({
    source_id: "joonggonara",
    source_listing_token: "232254753",
    reason: "FULL_SYSTEM",
    reviewed_at: "2026-09-09",
    evidence: "PUBLIC_TITLE_HP_ELITEDESK_MINI"
  }),
  Object.freeze({
    source_id: "joonggonara",
    source_listing_token: "232254789",
    reason: "FULL_SYSTEM",
    reviewed_at: "2026-09-09",
    evidence: "PUBLIC_TITLE_HP_ELITEDESK_MINI"
  }),
  Object.freeze({
    source_id: "joonggonara",
    source_listing_token: "229173484",
    reason: "FULL_SYSTEM",
    reviewed_at: "2026-09-09",
    evidence: "PUBLIC_TITLE_HP_ELITEDESK_MINI"
  }),
  Object.freeze({
    source_id: "joonggonara",
    source_listing_token: "229432509",
    reason: "FULL_SYSTEM",
    reviewed_at: "2026-09-09",
    evidence: "PUBLIC_TITLE_HP_ELITEDESK_MINI"
  }),
  Object.freeze({
    source_id: "joonggonara",
    source_listing_token: "220268305",
    reason: "FULL_SYSTEM",
    reviewed_at: "2026-09-09",
    evidence: "PUBLIC_TITLE_LG_GRAM"
  }),
  Object.freeze({
    source_id: "joonggonara",
    source_listing_token: "228508216",
    reason: "FULL_SYSTEM",
    reviewed_at: "2026-09-09",
    evidence: "PUBLIC_TITLE_LG_GRAM"
  }),
  Object.freeze({
    source_id: "joonggonara",
    source_listing_token: "228717853",
    reason: "FULL_SYSTEM",
    reviewed_at: "2026-09-09",
    evidence: "PUBLIC_TITLE_LG_GRAM"
  }),
  Object.freeze({
    source_id: "joonggonara",
    source_listing_token: "231024366",
    reason: "FULL_SYSTEM",
    reviewed_at: "2026-09-09",
    evidence: "PUBLIC_TITLE_DESKTOP_CONFIGURATION"
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
