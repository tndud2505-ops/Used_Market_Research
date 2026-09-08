import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { promisify } from "node:util";

import { statsChecksum, statsPublicationKey } from "./public-product-stats.mjs";

const execFileAsync = promisify(execFile);
const apply = process.argv.includes("--apply");
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function executeD1(sql) {
  const command = `${String(sql).trim().replace(/\s+/gu, " ").replace(/;+$/u, "")};`;
  const wranglerArgs = [
    "wrangler", "d1", "execute", "used-market-free", "--remote",
    "--config", "cloudflare/wrangler.jsonc", "--command", command, "--json"
  ];
  const executable = process.platform === "win32" ? process.execPath : "npx";
  const args = process.platform === "win32"
    ? [path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js"), ...wranglerArgs]
    : wranglerArgs;
  const { stdout } = await execFileAsync(executable, args, {
    cwd: appRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true
  });
  const payload = JSON.parse(stdout);
  const result = Array.isArray(payload) ? payload[0] : payload;
  if (result?.success !== true || !Array.isArray(result.results)) {
    throw new Error("D1 command did not return a successful result set");
  }
  return result;
}

async function activeMetadata() {
  const result = await executeD1(`SELECT publication_id, checksum, expected_row_count,
      expected_non_empty_scope_count, parser_version, rule_version, filter_version,
      created_at, activated_at
    FROM public_stats_publications WHERE active = 1`);
  if (result.results.length !== 1) throw new Error("exactly one active statistics publication is required");
  return result.results[0];
}

const metadata = await activeMetadata();
const publicationId = String(metadata.publication_id || "");
if (!publicationId) throw new Error("active publication id is missing");
const rowResult = await executeD1(`SELECT canonical_product_id, market_pool, condition_code,
    currency, days, stats_json, as_of
  FROM public_product_stats
  WHERE publication_id = ${sqlString(publicationId)}
  ORDER BY canonical_product_id, market_pool, condition_code, currency, days`);
const rows = rowResult.results;
if (Number(metadata.expected_row_count) !== rows.length) {
  throw new Error("active publication row count does not match its manifest");
}
const keys = rows.map(statsPublicationKey);
if (new Set(keys).size !== keys.length) throw new Error("active publication contains duplicate scope keys");

let nonEmptyScopeCount = 0;
for (const row of rows) {
  let stats;
  try { stats = JSON.parse(row.stats_json); } catch { throw new Error("active publication contains invalid stats JSON"); }
  if (stats?.versions?.parser !== metadata.parser_version
    || stats?.versions?.rule !== metadata.rule_version
    || stats?.versions?.filter !== metadata.filter_version) {
    throw new Error(`active publication contains mixed versions: ${statsPublicationKey(row)}`);
  }
  const sampleCount = Number(stats?.active?.sample_count || 0)
    + Number(stats?.reserved?.sample_count || 0)
    + Number(stats?.sold?.sample_count || 0)
    + Number(stats?.confirmed_transactions?.sample_count || 0);
  if (sampleCount > 0) nonEmptyScopeCount += 1;
}
if (Number(metadata.expected_non_empty_scope_count) !== nonEmptyScopeCount) {
  throw new Error("active publication sampled scope count does not match its manifest");
}

const actualChecksum = await statsChecksum(rows);
const storedChecksum = String(metadata.checksum || "");
const report = {
  publication_id: publicationId,
  row_count: rows.length,
  non_empty_scope_count: nonEmptyScopeCount,
  stored_checksum: storedChecksum,
  actual_checksum: actualChecksum,
  needs_repair: storedChecksum !== actualChecksum,
  applied: false
};

if (apply && report.needs_repair) {
  const update = await executeD1(`UPDATE public_stats_publications
    SET checksum = ${sqlString(actualChecksum)}
    WHERE active = 1
      AND publication_id = ${sqlString(publicationId)}
      AND checksum = ${sqlString(storedChecksum)}
      AND expected_row_count = ${rows.length}
      AND expected_non_empty_scope_count = ${nonEmptyScopeCount}`);
  if (Number(update.meta?.changes || 0) !== 1) throw new Error("active manifest compare-and-swap did not update exactly one row");
  const verified = await activeMetadata();
  if (verified.publication_id !== publicationId || verified.checksum !== actualChecksum) {
    throw new Error("active manifest checksum repair verification failed");
  }
  report.applied = true;
}

console.log(JSON.stringify(report, null, 2));
