import { stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PC_SOURCE_REGISTRY } from "../collector/logic/pc-source-registry.mjs";

const indexPathValue = String(process.env.RUNNER_INDEX_PATH || "").trim();
const outputPathValue = String(process.env.PC_LISTINGS_IMPORT_OUTPUT || "").trim();
if (!indexPathValue) throw new Error("RUNNER_INDEX_PATH is required");
if (!outputPathValue) throw new Error("PC_LISTINGS_IMPORT_OUTPUT is required");
const indexPath = path.resolve(indexPathValue);
const outputPath = path.resolve(outputPathValue);
await stat(indexPath);

const allowedSources = new Set(PC_SOURCE_REGISTRY
  .filter((source) => source.directory_source === true
    && source.policy_status === "APPROVED" && source.runtime_status === "ENABLED")
  .map((source) => source.key));

function parseJson(value) {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function redactPublicText(value, maximum = 1_000) {
  return String(value || "").normalize("NFKC").replace(/\s+/gu, " ").trim().slice(0, maximum)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "[EMAIL]")
    .replace(/(?<!\d)(?:\+?82[-.\s]?)?0?1[016789][-.\s]?\d{3,4}[-.\s]?\d{4}(?!\d)/gu, "[PHONE]");
}

function httpUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    return ["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

const db = new DatabaseSync(indexPath, { readOnly: true });
try {
  const rows = db.prepare(`SELECT item_id, site, category_id, title, search_text, price_value, currency,
      url, image_url, posted_at, last_seen_at, active, pc_metadata_json
    FROM listings WHERE active = 1 ORDER BY site, item_id`).all();
  const items = [];
  for (const row of rows) {
    const metadata = parseJson(row.pc_metadata_json);
    if (!allowedSources.has(row.site)
      || metadata.price_eligible !== true
      || metadata.lifecycle_status !== "ACTIVE"
      || metadata.condition_code !== "USED_WORKING"
      || !["SINGLE_COMPONENT", "SAME_PRODUCT_LOT"].includes(metadata.listing_kind)
      || !metadata.canonical_product_id
      || !Number.isFinite(Number(row.price_value)) || Number(row.price_value) <= 0
      || !httpUrl(row.url)) continue;
    const title = redactPublicText(row.title, 500);
    if (/\bmonitor\b|모니터/iu.test(title) || /삽니다|구매합니다|구해요/u.test(title)) continue;
    items.push({
      item_id: row.item_id,
      site: row.site,
      category_id: row.category_id || "pc",
      title,
      search_text: redactPublicText(row.search_text || row.title, 1_000),
      price_value: Number(row.price_value),
      currency: row.currency,
      url: row.url,
      image_url: httpUrl(row.image_url) ? row.image_url : null,
      seller_name: null,
      posted_at: row.posted_at || null,
      updated_at: row.last_seen_at,
      canonical_product_id: metadata.canonical_product_id,
      canonical_display_name: metadata.canonical_display_name || null,
      canonical_manufacturer: metadata.canonical_manufacturer || null,
      board_manufacturer: metadata.board_manufacturer || null,
      listing_kind: metadata.listing_kind,
      pc_category_code: metadata.category_code || null,
      quantity: metadata.quantity || null,
      price_scope: metadata.price_scope || "UNKNOWN",
      condition_code: metadata.condition_code,
      lifecycle_status: metadata.lifecycle_status,
      market_pool: metadata.market_pool || null,
      confidence: metadata.confidence || {},
      evidence: metadata.evidence || {},
      price_eligible: true,
      exclusion_reasons: metadata.exclusion_reasons || [],
      good_listing_eligible: metadata.good_listing_eligible === true,
      reference_price: metadata.reference_price ?? null
    });
  }
  if (items.length === 0) throw new Error("PC_LISTINGS_EXPORT_HAS_NO_ELIGIBLE_ROWS");
  await writeFile(outputPath, `${JSON.stringify({ items })}\n`, { encoding: "utf8", flag: "wx" });
  const sourceCounts = Object.fromEntries([...allowedSources].sort().map((source) => [
    source,
    items.filter((item) => item.site === source).length
  ]));
  console.log(JSON.stringify({
    output_path: outputPath,
    row_count: items.length,
    image_count: items.filter((item) => item.image_url).length,
    category_count: new Set(items.map((item) => item.pc_category_code)).size,
    source_counts: sourceCounts
  }));
} finally {
  db.close();
}
