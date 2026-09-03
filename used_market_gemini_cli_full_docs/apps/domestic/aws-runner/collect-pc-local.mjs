import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PC_SOURCE_REGISTRY } from "../collector/logic/pc-source-registry.mjs";
import { pcCollectionTargetSetV2 } from "../cloudflare/pc-directory-http.mjs";

const requestedSources = String(process.env.PC_LOCAL_SOURCES || "").split(",")
  .map((value) => value.trim().toLowerCase()).filter(Boolean);
const defaultSources = PC_SOURCE_REGISTRY
  .filter((source) => source.directory_source === true
    && source.policy_status === "APPROVED" && source.runtime_status === "ENABLED")
  .map((source) => source.key);
const sources = [...new Set(requestedSources.length > 0 ? requestedSources : defaultSources)];
const limit = Math.min(80, Math.max(1, Number(process.env.PC_COLLECT_LIMIT || 20) || 20));
const cadence = String(process.env.PC_COLLECT_CADENCE_CLASS || "HOURLY_CATEGORY").trim().toUpperCase();
if (!["HOURLY_CATEGORY", "DAILY_MASTER", "ALL"].includes(cadence)) {
  throw new Error("PC_COLLECT_CADENCE_CLASS must be HOURLY_CATEGORY, DAILY_MASTER, or ALL");
}
if (sources.length === 0) throw new Error("PC_LOCAL_SOURCES is empty");
for (const source of sources) {
  const registered = PC_SOURCE_REGISTRY.find((entry) => entry.key === source);
  if (!registered || registered.directory_source !== true) throw new Error(`PC_LOCAL_SOURCE_NOT_REGISTERED:${source}`);
  if (registered.policy_status !== "APPROVED" || registered.runtime_status !== "ENABLED") {
    throw new Error(`PC_LOCAL_SOURCE_NOT_OPERATIONAL:${source}:${registered.policy_status}:${registered.runtime_status}`);
  }
}

const baseDir = path.resolve(process.env.PC_LOCAL_COLLECTION_DIR
  || path.join(process.env.LOCALAPPDATA || os.tmpdir(), "UsedPick", "pc-local-scan"));
const explicitRunDir = String(process.env.PC_LOCAL_RUN_DIR || "").trim();
const runId = new Date().toISOString().replace(/[:.]/gu, "-");
const runDir = path.resolve(explicitRunDir || path.join(baseDir, runId));
await mkdir(runDir, { recursive: true });
const indexPath = path.resolve(process.env.RUNNER_INDEX_PATH || path.join(runDir, "search-index.sqlite"));
const targetSet = pcCollectionTargetSetV2();
const targetCount = Object.fromEntries(sources.map((source) => [source,
  targetSet.targets.filter((target) => target.enabled !== false && target.sourceKeys.includes(source)
    && (cadence === "ALL" || target.cadenceClass === cadence)).length]));

function runNode(label, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: "inherit"
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve({ label, code: 0 });
      else reject(new Error(`${label}_FAILED:${signal || code || 1}`));
    });
  });
}

if (process.argv.includes("--plan")) {
  console.log(JSON.stringify({ mode: "plan", run_dir: runDir, index_path: indexPath,
    cadence, limit, sources, target_count: targetCount }, null, 2));
  process.exit(0);
}

const results = [];
for (const source of sources) {
  const sqlPath = path.join(runDir, `${source}.sql`);
  try {
    await runNode(`collect:${source}`, ["aws-runner/collect-pc-source-now.mjs"], {
      RUNNER_INDEX_DIR: runDir,
      RUNNER_INDEX_PATH: indexPath,
      PC_COLLECT_SOURCE: source,
      PC_COLLECT_CADENCE_CLASS: cadence,
      PC_COLLECT_LIMIT: String(limit),
      PC_D1_SQL_OUTPUT: sqlPath
    });
    results.push({ source, status: "SUCCEEDED", sql_path: sqlPath, target_count: targetCount[source] || 0 });
  } catch (error) {
    results.push({ source, status: "FAILED", error: error instanceof Error ? error.message : String(error), target_count: targetCount[source] || 0 });
    console.error(`[pc-local] ${source} failed; previous sources are retained`);
  }
}

const successfulSources = results.filter((result) => result.status === "SUCCEEDED");
const artifacts = { index_path: indexPath };
if (successfulSources.length > 0) {
  const listingsPath = path.join(runDir, "pc-listings-publication.json");
  try {
    await runNode("export:listings", ["aws-runner/export-pc-listings-now.mjs"], {
      RUNNER_INDEX_PATH: indexPath,
      PC_LISTINGS_IMPORT_OUTPUT: listingsPath
    });
    artifacts.listings_path = listingsPath;
  } catch (error) {
    results.push({ source: "__publication:listings", status: "FAILED", error: error instanceof Error ? error.message : String(error) });
  }
  const statsPath = path.join(runDir, "pc-stats-publication.json");
  try {
    await runNode("publish:stats", ["aws-runner/publish-pc-stats-now.mjs"], {
      RUNNER_INDEX_PATH: indexPath,
      PC_STATS_PUBLICATION_OUTPUT: statsPath
    });
    artifacts.stats_path = statsPath;
  } catch (error) {
    results.push({ source: "__publication:stats", status: "FAILED", error: error instanceof Error ? error.message : String(error) });
  }
}

const manifest = {
  manifest_version: "pc-local-collection-v1",
  created_at: new Date().toISOString(),
  run_dir: runDir,
  index_path: indexPath,
  cadence,
  limit,
  sources,
  target_count: targetCount,
  results,
  artifacts,
  external_requests_from_public_api: 0,
  note: "This local run uses existing source scripts. It does not bypass a blocked source or claim missing listings are SOLD."
};
const manifestPath = path.join(runDir, "manifest.json");
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
console.log(JSON.stringify({ ...manifest, manifest_path: manifestPath }, null, 2));
if (successfulSources.length === 0) process.exitCode = 2;
