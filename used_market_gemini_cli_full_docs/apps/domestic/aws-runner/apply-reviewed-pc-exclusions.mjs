import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { reviewedPcListingExclusion } from "../market/logic/pc-reviewed-listing-exclusions.mjs";
import { fetchAllPublicPcListings, toPcProjectionImportItem } from "./republish-pc-projections.mjs";
import { PcPartsLedger } from "./pc-parts-ledger.mjs";
import { SearchIndex } from "./search-index.mjs";

function text(value) {
  return String(value ?? "").trim();
}

export function parseReviewedExclusionArguments(argv) {
  const result = { apply: false, confirmChecksum: "", expectedCount: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") {
      result.apply = true;
      continue;
    }
    if (argument === "--confirm-checksum" || argument === "--expect-count") {
      const value = text(argv[index + 1]);
      if (!value || value.startsWith("--")) throw new Error(argument + " requires a value");
      if (argument === "--confirm-checksum") result.confirmChecksum = value.toLowerCase();
      else {
        if (!/^\d+$/u.test(value)) throw new Error("--expect-count must be a non-negative integer");
        result.expectedCount = Number(value);
      }
      index += 1;
      continue;
    }
    throw new Error("Unsupported argument: " + argument);
  }
  const hasConfirmation = Boolean(result.confirmChecksum) || result.expectedCount !== null;
  if (!result.apply && hasConfirmation) throw new Error("confirmation options require --apply");
  if (result.apply && (!/^[a-f0-9]{64}$/u.test(result.confirmChecksum) || result.expectedCount === null)) {
    throw new Error("--apply requires --confirm-checksum and --expect-count from a dry-run");
  }
  return result;
}

function reviewedExclusionForItem(item) {
  const site = text(item?.site).toLowerCase();
  if (!site) return null;
  for (const identity of [item?.source_listing_id, item?.item_id, item?.id, item?.url]) {
    if (!text(identity)) continue;
    const exclusion = reviewedPcListingExclusion(site, identity);
    if (exclusion) return exclusion;
  }
  return null;
}

export function reviewedPublicCandidates(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => ({ item, exclusion: reviewedExclusionForItem(item) }))
    .filter((candidate) => candidate.exclusion)
    .sort((left, right) => text(left.item.item_id).localeCompare(text(right.item.item_id)));
}

function candidateManifest(candidates) {
  return candidates.map(({ item, exclusion }) => ({
    item_id: text(item.item_id || item.id),
    site: text(item.site).toLowerCase(),
    reason: exclusion.reason,
    reviewed_at: exclusion.reviewed_at
  }));
}

export function reviewedCandidateChecksum(candidates) {
  return createHash("sha256").update(JSON.stringify(candidateManifest(candidates))).digest("hex");
}

function productionUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(String(value || ""));
  } catch {
    throw new Error(label + " must be a valid URL");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error(label + " must be an HTTPS URL without embedded credentials");
  }
  parsed.hash = "";
  return parsed;
}

function excludedProjection(item, exclusion, updatedAt) {
  return {
    ...item,
    listing_kind: exclusion.reason === "FULL_SYSTEM" ? "FULL_SYSTEM" : item.listing_kind,
    price_eligible: false,
    good_listing_eligible: false,
    exclusion_reasons: [...new Set([
      ...(Array.isArray(item.exclusion_reasons) ? item.exclusion_reasons : []),
      "REVIEWED_" + exclusion.reason
    ])],
    evidence: [...(Array.isArray(item.evidence) ? item.evidence : []), {
      field: "reviewed_exclusion",
      value: exclusion.reason,
      source: exclusion.evidence,
      matched_text: text(item.source_listing_id || item.item_id || item.url),
      reviewed_at: exclusion.reviewed_at
    }],
    updated_at: updatedAt
  };
}

async function importD1(importUrl, importToken, projections) {
  const response = await fetch(importUrl, {
    method: "POST",
    headers: {
      authorization: "Bearer " + importToken,
      "content-type": "application/json",
      accept: "application/json"
    },
    body: JSON.stringify({ items: projections.map(toPcProjectionImportItem) }),
    signal: AbortSignal.timeout(30_000)
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || typeof payload !== "object") {
    throw new Error("D1_REVIEWED_EXCLUSION_IMPORT_FAILED_HTTP_" + response.status);
  }
  const result = payload.data && typeof payload.data === "object" ? payload.data : payload;
  if (Number(result.inserted) !== projections.length || Number(result.rejected) !== 0
    || result.retention_policy !== "NON_DESTRUCTIVE") {
    throw new Error("D1_REVIEWED_EXCLUSION_IMPORT_INTEGRITY_FAILURE");
  }
  return { inserted: Number(result.inserted), rejected: Number(result.rejected) };
}

async function main(argv) {
  const options = parseReviewedExclusionArguments(argv);
  const apiBase = productionUrl(process.env.PC_PUBLIC_API_BASE || "https://used-pick.com", "PC_PUBLIC_API_BASE");
  const publicItems = await fetchAllPublicPcListings(apiBase, "reviewed-" + Date.now().toString(36));
  const candidates = reviewedPublicCandidates(publicItems);
  const checksum = reviewedCandidateChecksum(candidates);
  const summary = {
    mode: options.apply ? "apply" : "dry-run",
    candidate_count: candidates.length,
    checksum,
    candidates: candidateManifest(candidates)
  };
  if (!options.apply) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  if (options.confirmChecksum !== checksum || options.expectedCount !== candidates.length) {
    throw new Error("REVIEWED_EXCLUSION_CONFIRMATION_MISMATCH");
  }

  const importToken = text(process.env.CLOUDFLARE_MANUAL_RUN_TOKEN || process.env.IMPORT_TOKEN);
  if (!importToken) throw new Error("CLOUDFLARE_MANUAL_RUN_TOKEN or IMPORT_TOKEN is required for --apply");
  const importUrl = productionUrl(
    process.env.D1_IMPORT_URL || new URL("/admin/import-listings", apiBase).toString(),
    "D1_IMPORT_URL"
  );
  if (importUrl.origin !== apiBase.origin || importUrl.pathname !== "/admin/import-listings") {
    throw new Error("D1_IMPORT_URL must be the /admin/import-listings endpoint on PC_PUBLIC_API_BASE");
  }

  const appliedAt = new Date().toISOString();
  const projections = candidates.map(({ item, exclusion }) => excludedProjection(item, exclusion, appliedAt));
  const d1 = await importD1(importUrl, importToken, projections);
  const indexRoot = process.env.RUNNER_INDEX_DIR || (process.platform === "linux"
    ? "/var/lib/used-market-runner"
    : path.join(os.tmpdir(), "used-market-runner"));
  const indexPath = process.env.RUNNER_INDEX_PATH || path.join(indexRoot, "search-index.sqlite");
  const index = new SearchIndex({ filePath: indexPath, backupDir: path.join(indexRoot, "backups") });
  let localUpdated = 0;
  let backup = null;
  try {
    new PcPartsLedger({ db: index.db });
    backup = index.createBackup();
    if (!backup) throw new Error("A recovery backup is required before reviewed exclusion apply");
    index.db.exec("BEGIN IMMEDIATE");
    try {
      for (const projection of projections) localUpdated += index.applyLifecycleProjection(projection);
      if (localUpdated !== projections.length) {
        throw new Error("LOCAL_REVIEWED_EXCLUSION_UPDATE_COUNT_MISMATCH");
      }
      index.db.exec("COMMIT");
    } catch (error) {
      index.db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    index.close();
  }

  const remaining = reviewedPublicCandidates(await fetchAllPublicPcListings(
    apiBase,
    "reviewed-verify-" + Date.now().toString(36)
  ));
  if (remaining.length > 0) {
    throw new Error("REVIEWED_EXCLUSIONS_REMAIN_PUBLIC:" + candidateManifest(remaining)
      .map((item) => item.item_id).join(","));
  }
  console.log(JSON.stringify({
    ...summary,
    d1,
    local_updated: localUpdated,
    recovery_backup: backup,
    verified_absent_count: candidates.length
  }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
