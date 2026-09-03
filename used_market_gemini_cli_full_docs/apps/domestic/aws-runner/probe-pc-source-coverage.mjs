import { collectOne } from "../cloudflare/live-search.mjs";
import { pcCollectionTargetSetV2 } from "../cloudflare/pc-directory-http.mjs";
import { getPcSource } from "../collector/logic/pc-source-registry.mjs";
import { SPECIALIST_FIXTURE_PARSERS } from "../collector/logic/pc-source-adapters.mjs";
import { classifyPcPartListing } from "../market/logic/pc-parts-classifier.mjs";

const sourceKey = String(process.env.PC_PROBE_SOURCE || "joonggonara").trim().toLowerCase();
const limit = Math.min(20, Math.max(1, Number(process.env.PC_PROBE_LIMIT || 8) || 8));
const source = getPcSource(sourceKey);

if (source.policy_status !== "APPROVED" || source.runtime_status !== "ENABLED") {
  throw new Error(`PC_PROBE_SOURCE_NOT_OPERATIONAL:${sourceKey}:${source.policy_status}:${source.runtime_status}`);
}
if (source.directory_source !== true) throw new Error(`PC_PROBE_SOURCE_NOT_DIRECTORY:${sourceKey}`);

const targets = pcCollectionTargetSetV2().targets.filter((target) => target.sourceKeys.includes(sourceKey));
if (targets.length === 0) throw new Error(`PC_PROBE_TARGETS_MISSING:${sourceKey}`);
if (targets.some((target) => /MONITOR|모니터/iu.test(`${target.categoryCode} ${target.queryText}`))) {
  throw new Error(`PC_PROBE_MONITOR_TARGET_FORBIDDEN:${sourceKey}`);
}

const specialistSearchUrls = Object.freeze({
  coolenjoy: "https://coolenjoy.net/bbs/mart2?sfl=wr_subject&stx={query}&sop=and"
});
const specialistHosts = Object.freeze({
  coolenjoy: new Set(["coolenjoy.net", "www.coolenjoy.net"])
});

async function collectTargetItems(target) {
  const parser = SPECIALIST_FIXTURE_PARSERS[sourceKey];
  if (!parser || !specialistSearchUrls[sourceKey]) {
    return collectOne(
      sourceKey,
      target.queryText,
      sourceKey === "ebay" ? target.categoryCode : "pc",
      limit,
      target.queryText,
      "recent",
      { min: null, max: null }
    );
  }
  const url = new URL(specialistSearchUrls[sourceKey].replace("{query}", encodeURIComponent(target.queryText)));
  if (!specialistHosts[sourceKey].has(url.hostname.toLowerCase())) {
    throw new Error(`PC_PROBE_SPECIALIST_HOST_NOT_ALLOWED:${sourceKey}`);
  }
  const response = await fetch(url, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "accept-language": "ko-KR,ko;q=0.9,en;q=0.7",
      referer: "https://used-pick.com/",
      "user-agent": "USED-PICK-PC-Collector/2.0 (+https://used-pick.com/)"
    },
    signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) throw new Error(`PC_PROBE_SPECIALIST_HTTP_${response.status}:${sourceKey}`);
  return parser(await response.text()).slice(0, limit);
}

const rows = [];
for (const target of targets) {
  try {
    const items = await collectTargetItems(target);
    const classified = items.map((item) => classifyPcPartListing(item));
    rows.push({
      target_id: target.targetId,
      category_code: target.categoryCode,
      query_text: target.queryText,
      received_count: items.length,
      category_match_count: classified.filter((item) => item.category_code === target.categoryCode).length,
      price_eligible_count: classified.filter((item) => item.category_code === target.categoryCode && item.price_eligible === true).length,
      samples: items.slice(0, 2).map((item) => ({ title: item.title, url: item.url }))
    });
  } catch (error) {
    rows.push({
      target_id: target.targetId,
      category_code: target.categoryCode,
      query_text: target.queryText,
      error: error instanceof Error ? error.message : String(error)
    });
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
}

const expectedCategories = [...new Set(targets.map((target) => target.categoryCode))].sort();
const coveredCategories = [...new Set(rows
  .filter((row) => Number(row.category_match_count || 0) > 0)
  .map((row) => row.category_code))].sort();
const missingCategories = expectedCategories.filter((category) => !coveredCategories.includes(category));
const report = {
  source_key: sourceKey,
  checked_at: new Date().toISOString(),
  target_count: targets.length,
  expected_categories: expectedCategories,
  covered_categories: coveredCategories,
  missing_categories: missingCategories,
  monitor_target_count: 0,
  rows
};

console.log(JSON.stringify(report, null, 2));
if (missingCategories.length > 0) process.exitCode = 2;
