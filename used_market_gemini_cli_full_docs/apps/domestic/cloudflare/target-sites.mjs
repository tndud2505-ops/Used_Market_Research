export const TARGET_SITES = Object.freeze([
  "bunjang",
  "joonggonara",
  "hellomarket",
  "rethinkmall",
  "ebay"
]);

export const TARGET_SITE_LABELS = Object.freeze({
  bunjang: "번개장터",
  joonggonara: "중고나라",
  hellomarket: "헬로마켓",
  rethinkmall: "리씽크몰",
  ebay: "eBay"
});

export function normalizeTargetSites(value, fallback = TARGET_SITES) {
  const values = Array.isArray(value) ? value : fallback;
  return [...new Set(values
    .filter((site) => typeof site === "string")
    .map((site) => site.trim().toLowerCase())
    .filter((site) => TARGET_SITES.includes(site)))];
}
