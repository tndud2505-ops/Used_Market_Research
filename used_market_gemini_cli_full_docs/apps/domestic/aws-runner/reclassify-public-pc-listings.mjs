import { classifyPcPartListing } from "../market/logic/pc-parts-classifier.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PAGE_LIMIT = 100;
const IMPORT_BATCH_SIZE = 100;

export function parseArguments(argv) {
  const result = { apply: false, confirmAllCandidates: false, itemIds: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") {
      result.apply = true;
      continue;
    }
    if (argument === "--confirm-all-candidates") {
      result.confirmAllCandidates = true;
      continue;
    }
    if (argument === "--item-id") {
      const value = String(argv[index + 1] || "").trim();
      if (!value) throw new Error("--item-id requires a value");
      result.itemIds.push(value);
      index += 1;
      continue;
    }
    if (argument.startsWith("--item-id=")) {
      const value = argument.slice("--item-id=".length).trim();
      if (!value) throw new Error("--item-id requires a value");
      result.itemIds.push(value);
      continue;
    }
    throw new Error(`Unsupported argument: ${argument}`);
  }
  result.itemIds = [...new Set(result.itemIds)];
  if (!result.apply && (result.itemIds.length > 0 || result.confirmAllCandidates)) {
    throw new Error("--item-id and --confirm-all-candidates are accepted only with --apply");
  }
  if (result.apply && result.itemIds.length === 0 && !result.confirmAllCandidates) {
    throw new Error("--apply requires reviewed --item-id values or --confirm-all-candidates");
  }
  if (result.itemIds.length > 0 && result.confirmAllCandidates) {
    throw new Error("choose reviewed --item-id values or --confirm-all-candidates, not both");
  }
  return result;
}

function productionUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(String(value || ""));
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error(`${label} must be an HTTPS URL without embedded credentials`);
  }
  parsed.hash = "";
  return parsed;
}

async function readJsonResponse(response, label) {
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${label} failed with HTTP ${response.status}`);
  if (!payload || typeof payload !== "object") throw new Error(`${label} returned invalid JSON`);
  return payload;
}

async function fetchPublicListings(apiBase) {
  const items = [];
  const seenCursors = new Set();
  let cursor = null;
  let expectedTotal = null;

  do {
    const pageUrl = new URL("/api/pc/listings", apiBase);
    pageUrl.searchParams.set("limit", String(PAGE_LIMIT));
    if (cursor) pageUrl.searchParams.set("cursor", cursor);
    const response = await fetch(pageUrl, {
      method: "GET",
      cache: "no-store",
      headers: { accept: "application/json", "cache-control": "no-cache" }
    });
    const payload = await readJsonResponse(response, "public listing read");
    const page = payload?.data;
    if (!page || !Array.isArray(page.items) || !page.pagination) {
      throw new Error("public listing response is missing data.items or pagination");
    }
    const pageTotal = Number(page.total);
    if (!Number.isInteger(pageTotal) || pageTotal < 0) throw new Error("public listing total is invalid");
    if (expectedTotal === null) expectedTotal = pageTotal;
    else if (pageTotal !== expectedTotal) throw new Error("public listing snapshot total changed during pagination");
    items.push(...page.items);

    const nextCursor = page.pagination.has_more ? String(page.pagination.next_cursor || "") : "";
    if (page.pagination.has_more && !nextCursor) throw new Error("public listing continuation cursor is missing");
    if (nextCursor && seenCursors.has(nextCursor)) throw new Error("public listing cursor loop detected");
    if (nextCursor) seenCursors.add(nextCursor);
    cursor = nextCursor || null;
  } while (cursor);

  if (items.length !== expectedTotal) {
    throw new Error(`public listing pagination mismatch: expected ${expectedTotal}, received ${items.length}`);
  }
  const uniqueItemIds = new Set(items.map((item) => String(item?.item_id || "")));
  if (uniqueItemIds.has("") || uniqueItemIds.size !== items.length) {
    throw new Error("public listing item identities are missing or duplicated");
  }
  return items;
}

export function isPublicDeactivationCandidate(classified) {
  return classified?.price_eligible === false
    && Array.isArray(classified.exclusion_reasons)
    && classified.exclusion_reasons.length > 0;
}

export function reclassificationCandidate(item) {
  const classified = classifyPcPartListing({
    title: item.title,
    price: item.price,
    currency: item.currency,
    lifecycle_status: item.lifecycle_status
  });
  if (!isPublicDeactivationCandidate(classified)) return null;
  if (classified.price_eligible !== false || classified.exclusion_reasons.length === 0) {
    throw new Error(`classifier invariant failed for ${item.item_id}`);
  }
  const kindEvidence = classified.evidence.find((entry) => entry?.field === "listing_kind") || null;
  return {
    item,
    classified,
    summary: {
      item_id: item.item_id,
      site: item.site,
      title: item.title,
      canonical_product_id: item.canonical_product_id,
      previous_listing_kind: item.listing_kind,
      classified_listing_kind: classified.listing_kind,
      matched_text: kindEvidence?.matched_text || null,
      url: item.url
    }
  };
}

export function mergedPublicExclusionReasons(item, classified) {
  return [...new Set([
    ...(Array.isArray(item?.exclusion_reasons) ? item.exclusion_reasons : []),
    ...(Array.isArray(classified?.exclusion_reasons) ? classified.exclusion_reasons : [])
  ])];
}

function importItem(candidate) {
  const { item, classified } = candidate;
  if (String(item.lifecycle_status || "").toUpperCase() !== "ACTIVE") {
    throw new Error(`refusing to change non-ACTIVE lifecycle item ${item.item_id}`);
  }
  return {
    item_id: item.item_id,
    site: item.site,
    category_id: item.category_id || "pc",
    title: item.title,
    search_text: item.title,
    price_value: item.price,
    currency: item.currency,
    url: item.url,
    image_url: item.image_url || null,
    posted_at: item.posted_at || null,
    updated_at: item.updated_at,
    canonical_product_id: item.canonical_product_id || null,
    canonical_display_name: item.canonical_display_name || null,
    canonical_manufacturer: item.canonical_manufacturer || null,
    board_manufacturer: item.board_manufacturer || null,
    listing_kind: classified.listing_kind,
    pc_category_code: item.category_code || null,
    quantity: item.quantity,
    price_scope: item.price_scope,
    condition_code: item.condition_code,
    lifecycle_status: item.lifecycle_status,
    market_pool: item.market_pool,
    confidence: item.confidence || {},
    evidence: item.evidence || {},
    price_eligible: false,
    exclusion_reasons: mergedPublicExclusionReasons(item, classified),
    good_listing_eligible: false,
    reference_price: item.reference_price ?? null
  };
}

async function importReviewedCandidates(importUrl, importToken, candidates) {
  let inserted = 0;
  let batches = 0;
  for (let offset = 0; offset < candidates.length; offset += IMPORT_BATCH_SIZE) {
    const batch = candidates.slice(offset, offset + IMPORT_BATCH_SIZE).map(importItem);
    const response = await fetch(importUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${importToken}`,
        "content-type": "application/json",
        accept: "application/json"
      },
      body: JSON.stringify({ items: batch })
    });
    const payload = await readJsonResponse(response, "listing import");
    const result = payload.data && typeof payload.data === "object" ? payload.data : payload;
    const batchInserted = Number(result.inserted);
    const batchRejected = Number(result.rejected);
    if (batchInserted !== batch.length || batchRejected !== 0 || result.retention_policy !== "NON_DESTRUCTIVE") {
      throw new Error(`listing import integrity check failed for batch ${batches + 1}`);
    }
    inserted += batchInserted;
    batches += 1;
  }
  return { inserted, batches };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const apiBase = productionUrl(process.env.PC_PUBLIC_API_BASE || "https://used-pick.com", "PC_PUBLIC_API_BASE");
  const importUrl = productionUrl(
    process.env.D1_IMPORT_URL || new URL("/admin/import-listings", apiBase).toString(),
    "D1_IMPORT_URL"
  );
  if (importUrl.origin !== apiBase.origin || importUrl.pathname !== "/admin/import-listings") {
    throw new Error("D1_IMPORT_URL must be the /admin/import-listings endpoint on PC_PUBLIC_API_BASE");
  }

  const publicItems = await fetchPublicListings(apiBase);
  const candidates = publicItems.map(reclassificationCandidate).filter(Boolean);
  const byKind = {};
  for (const candidate of candidates) {
    const kind = String(candidate.classified.listing_kind || "UNKNOWN");
    byKind[kind] = Number(byKind[kind] || 0) + 1;
  }

  if (!options.apply) {
    console.log(JSON.stringify({
      mode: "dry-run",
      scanned_count: publicItems.length,
      candidate_count: candidates.length,
      by_kind: byKind,
      candidates: candidates.map((candidate) => candidate.summary)
    }, null, 2));
    return;
  }

  const importToken = String(process.env.CLOUDFLARE_MANUAL_RUN_TOKEN || process.env.IMPORT_TOKEN || "").trim();
  if (!importToken) throw new Error("CLOUDFLARE_MANUAL_RUN_TOKEN or IMPORT_TOKEN is required for --apply");
  const candidatesById = new Map(candidates.map((candidate) => [candidate.item.item_id, candidate]));
  const missingIds = options.itemIds.filter((itemId) => !candidatesById.has(itemId));
  if (missingIds.length > 0) {
    throw new Error(`reviewed item IDs are no longer classifier candidates: ${missingIds.join(", ")}`);
  }
  const reviewedCandidates = options.confirmAllCandidates
    ? candidates
    : options.itemIds.map((itemId) => candidatesById.get(itemId));
  const importResult = await importReviewedCandidates(importUrl, importToken, reviewedCandidates);

  const remainingIds = new Set((await fetchPublicListings(apiBase)).map((item) => item.item_id));
  const appliedItemIds = reviewedCandidates.map((candidate) => candidate.item.item_id);
  const stillPublic = appliedItemIds.filter((itemId) => remainingIds.has(itemId));
  if (stillPublic.length > 0) {
    throw new Error(`applied items remain publicly visible: ${stillPublic.join(", ")}`);
  }
  console.log(JSON.stringify({
    mode: "apply",
    selection: options.confirmAllCandidates ? "all-current-candidates" : "reviewed-item-ids",
    reviewed_count: reviewedCandidates.length,
    inserted: importResult.inserted,
    batches: importResult.batches,
    verified_absent_count: reviewedCandidates.length,
    applied_item_ids: appliedItemIds,
    unreviewed_candidate_count: candidates.length - reviewedCandidates.length
  }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
