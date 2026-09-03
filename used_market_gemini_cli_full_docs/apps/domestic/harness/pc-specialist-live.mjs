import { collectDanawaCategoryListings } from "../collector/logic/pc-source-adapters.mjs";
import { PC_PART_CATEGORY_CODES, trustedSpecialistCategory } from "../collector/logic/pc-specialist-targets.mjs";
import { classifyPcPartListing } from "../market/logic/pc-parts-classifier.mjs";

function hasValidListingIdentity(item) {
  if (typeof item?.source_listing_id !== "string" || !item.source_listing_id.trim()) return false;
  try {
    return /^https?:$/u.test(new URL(item.url).protocol);
  } catch {
    return false;
  }
}

function hasPositivePrice(item) {
  return Number.isFinite(Number(item?.price)) && Number(item.price) > 0;
}

const results = [];
for (const categoryCode of PC_PART_CATEGORY_CODES) {
  const startedAt = Date.now();
  try {
    const collected = await collectDanawaCategoryListings({ categoryCode });
    const classified = collected.items.map((item) => {
      const text = classifyPcPartListing(item);
      const trusted = trustedSpecialistCategory(item);
      return trusted && !["COMPONENT_BUNDLE", "FULL_SYSTEM"].includes(text.listing_kind)
        ? { ...text, category_code: trusted }
        : text;
    });
    const counts = classified.reduce((summary, item) => {
      summary[item.category_code] = (summary[item.category_code] || 0) + 1;
      return summary;
    }, {});
    const validIdentityCount = collected.items.filter(hasValidListingIdentity).length;
    const positivePriceCount = collected.items.filter(hasPositivePrice).length;
    const validListingCount = collected.items.filter((item) => hasValidListingIdentity(item) && hasPositivePrice(item)).length;
    const anomalyCount = collected.items.length - validListingCount;
    const anomalyRatio = collected.items.length > 0 ? anomalyCount / collected.items.length : 0;
    const warnings = [];
    if (anomalyCount > 0) warnings.push(`INVALID_LISTING_FIELDS:${anomalyCount}/${collected.items.length}`);
    if (Number(counts[categoryCode] || 0) < collected.items.length) {
      warnings.push(`CATEGORY_MISMATCH:${collected.items.length - Number(counts[categoryCode] || 0)}/${collected.items.length}`);
    }
    results.push({
      category_code: categoryCode,
      request_count: collected.diagnostics.length,
      reported_count: collected.diagnostics.reduce((sum, item) => sum + item.reported_count, 0),
      parsed_count: collected.items.length,
      target_classified_count: Number(counts[categoryCode] || 0),
      valid_identity_count: validIdentityCount,
      positive_price_count: positivePriceCount,
      valid_listing_count: validListingCount,
      anomaly_count: anomalyCount,
      anomaly_ratio: Number(anomalyRatio.toFixed(4)),
      warnings,
      classification_counts: counts,
      elapsed_ms: Date.now() - startedAt,
      samples: collected.items.slice(0, 3).map((item) => ({ id: item.source_listing_id, url: item.url, price: item.price, title: item.title }))
    });
  } catch (error) {
    results.push({ category_code: categoryCode, error: error instanceof Error ? error.message : String(error), elapsed_ms: Date.now() - startedAt });
  }
}

const failed = results.filter((entry) => entry.error
  || entry.parsed_count < 1
  || entry.target_classified_count < 1
  || entry.valid_identity_count < 1
  || entry.positive_price_count < 1
  || entry.valid_listing_count < 1);
console.log(JSON.stringify({
  source: "danawa",
  checked_at: new Date().toISOString(),
  category_count: results.length,
  categories_with_items: results.filter((entry) => entry.parsed_count > 0).length,
  failed_category_codes: failed.map((entry) => entry.category_code),
  results
}, null, 2));
if (failed.length > 0) process.exitCode = 2;
