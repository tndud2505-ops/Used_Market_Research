import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pcStatsTraceability } from "../aws-runner/pc-stats-traceability.mjs";

const read = (relativePath) => readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
const [runnerUnit, tunnelUnit, installScript, configureScript, healthScript, readme,
  publishStatsScript, completeStatsScript, importStatsScript, statsTraceabilityScript, runnerScript,
  publicClassificationMigration, retiredSourceMigration] = await Promise.all([
  read("aws-runner/used-market-runner.service"),
  read("aws-runner/used-market-tunnel.service"),
  read("aws-runner/install-ubuntu24.sh"),
  read("aws-runner/configure-ubuntu24.sh"),
  read("aws-runner/health-check.sh"),
  read("aws-runner/README.md"),
  read("aws-runner/publish-pc-stats-now.mjs"),
  read("aws-runner/complete-pc-stats-publication.mjs"),
  read("aws-runner/import-pc-stats-publication.mjs"),
  read("aws-runner/pc-stats-traceability.mjs"),
  read("aws-runner/runner.mjs"),
  read("cloudflare/migrations/0012_pc_public_classification.sql"),
  read("cloudflare/migrations/0013_retire_quasarzone.sql")
]);

assert.match(runnerUnit, /^Wants=.*used-market-tunnel\.service/mu,
  "starting the runner must pull the tunnel back up");
assert.match(runnerUnit, /^Before=used-market-tunnel\.service$/mu,
  "the runner must become available before cloudflared starts");
assert.match(tunnelUnit, /^Requires=used-market-runner\.service$/mu);
assert.match(tunnelUnit, /^After=used-market-runner\.service$/mu);

const assertOrdered = (source, fragments, label) => {
  let previous = -1;
  for (const fragment of fragments) {
    const position = source.indexOf(fragment);
    assert.ok(position > previous, `${label}: expected ${fragment} after the previous deployment step`);
    previous = position;
  }
};

for (const [label, source] of [["install", installScript], ["configure", configureScript]]) {
  assertOrdered(source, [
    "systemctl restart used-market-runner.service",
    "systemctl restart used-market-tunnel.service",
    'health-check.sh" --require-public'
  ], label);
  assert.match(source, /systemctl enable[^\n]*used-market-tunnel\.service/u,
    `${label} must persist tunnel startup across reboots`);
}

assert.match(healthScript, /--require-public/u);
assert.match(healthScript, /used-market-runner\.service used-market-tunnel\.service/u,
  "health must fail when either systemd unit is not enabled or active");
assert.match(healthScript, /process_instance\.id/u);
assert.match(healthScript, /instance_id" != "\$LOCAL_INSTANCE_ID/u,
  "public health must identify the newly started local runner process");
assert.match(readme, /반복 배포/u);
assert.match(readme, /process_instance\.id/u);

for (const source of [publishStatsScript, completeStatsScript]) {
  assert.match(source, /normalization_version:\s*versionOptions\.normalizationVersion/u,
    "manual stats manifests must pin the active normalization version");
}
assert.doesNotMatch(completeStatsScript, /normalizationVersion\s*!==\s*9/u,
  "scope completion must work with the active pipeline instead of a hard-coded version");
assert.doesNotMatch(importStatsScript, /versions\.normalization\s*!==\s*9/u,
  "stats import must work with the active pipeline instead of a hard-coded version");
assert.match(importStatsScript, /traceability mismatch/u,
  "stats import must fail closed when publication rows cannot be traced to ledger members");
assert.match(statsTraceabilityScript, /member_checksum/u,
  "stats traceability must bind the exact member identities and prices, not only a count");
assert.match(importStatsScript, /explicitSoldText/u,
  "SOLD evidence values must semantically confirm a completed sale");
assert.match(importStatsScript, /pool\/currency member mismatch/u,
  "stats import must fail closed when a member crosses its market pool or currency scope");
assert.match(publicClassificationMigration, /ALTER TABLE listings ADD COLUMN market_segment TEXT NOT NULL DEFAULT 'UNKNOWN'/u,
  "the public projection schema must include the market segment expected by runner imports");
assert.match(publicClassificationMigration, /ALTER TABLE listings ADD COLUMN statistics_eligible INTEGER NOT NULL DEFAULT 0/u,
  "the public projection schema must include the statistics eligibility gate");
assert.match(retiredSourceMigration, /UPDATE listings[\s\S]*LOWER\(site\) = 'quasarzone'/u,
  "removed Quasarzone rows must be retired from the public projection");
assert.match(retiredSourceMigration, /DELETE FROM public_product_stats[\s\S]*LOWER\(stats_json\) LIKE '%quasarzone%'/u,
  "stale published Quasarzone statistics must not remain publicly readable");
assert.match(retiredSourceMigration, /UPDATE public_stats_publications[\s\S]*expected_row_count[\s\S]*expected_non_empty_scope_count/u,
  "retiring published statistics must preserve the active publication manifest");
assert.match(runnerScript, /const recorded = await recordPcItemsIncrementally\(result\.result\.items, result\.run_at\);/u,
  "scheduler collection must yield between ledger writes so health and search remain responsive");
assert.match(runnerScript, /const publicProjections = stabilizeIncrementalPcProjections\(recorded\);/u,
  "scheduler collection must repair stable source identities before public projection writes");
assertOrdered(runnerScript, [
  "const publicProjections = stabilizeIncrementalPcProjections(recorded);",
  "await upsertPcProjectionsIncrementally(publicProjections, { observedAt: result.run_at });",
  "await importToD1BestEffort(publicProjections, tickSignal)"
], "incremental public projection publication");
assert.match(runnerScript,
  /const D1_BACKGROUND_MIRROR_ENABLED = String\(process\.env\.D1_BACKGROUND_MIRROR_ENABLED \?\? "false"\)/u,
  "continuous D1 listing mirroring must default to disabled");
for (const functionName of ["importToD1", "mirrorPcListingCollectionManifest"]) {
  const functionStart = runnerScript.indexOf(`async function ${functionName}`);
  const configurationCheck = runnerScript.indexOf("if (!IMPORT_URL || !IMPORT_TOKEN)", functionStart);
  const mirrorGate = runnerScript.indexOf("if (!D1_BACKGROUND_MIRROR_ENABLED)", functionStart);
  assert.ok(functionStart >= 0 && mirrorGate > functionStart && mirrorGate < configurationCheck,
    `${functionName} must stop before any configured D1 background write when the mirror is disabled`);
}
assert.match(installScript, /^D1_BACKGROUND_MIRROR_ENABLED=false$/mu,
  "new AWS runner installs must disable continuous D1 listing mirroring");
assert.match(installScript,
  /if ! grep -q '\^D1_BACKGROUND_MIRROR_ENABLED='[\s\S]*set_env_value D1_BACKGROUND_MIRROR_ENABLED false/u,
  "repeat installs must add the disabled mirror default without overriding an explicit operator setting");
assert.match(configureScript, /existing_d1_background_mirror="\$\(read_env_value D1_BACKGROUND_MIRROR_ENABLED\)"/u);
assert.match(configureScript, /^D1_BACKGROUND_MIRROR_ENABLED=\$\{d1_background_mirror\}$/mu,
  "runner reconfiguration must preserve the explicit D1 mirror setting");
assert.match(readme, /D1_BACKGROUND_MIRROR_ENABLED=false/u,
  "the AWS runbook must document AWS-primary reads and disabled continuous D1 listing mirroring");
assert.match(runnerScript, /function isD1DailyRowWriteLimitError\(error\)/u,
  "a D1 free-tier write limit must be recognized as a deferred public sync");
assert.match(runnerScript, /D1_DAILY_ROW_WRITE_LIMIT/u,
  "D1 daily write exhaustion must be visible without failing the local crawl");
assert.match(runnerScript, /const PC_SCHEDULER_CATCHUP_MS = 0;/u,
  "runner startup must not synchronously replay a multi-hour scheduler backlog");
assertOrdered(runnerScript, [
  "const runtimeBeforeRun = pcSchedulerRuntime[result.source_key] || getSourceRuntimeDefaults(result.source_key);",
  'if (result.status === "skipped")',
  "const recoveredFromQuarantine = result.next_runtime.runtime_status === \"ENABLED\"",
  "const runtimeBeforeCrawlAudit = recoveredFromQuarantine",
  "if (recoveredFromQuarantine) pcLedger.updateSourceRuntime(result.source_key, runtimeBeforeCrawlAudit);",
  'if (result.status === "failed")',
  "const failedRunId = pcLedger.startCrawlRun({",
  "pcLedger.updateSourceRuntime(result.source_key, result.next_runtime);",
  "let runId = null;",
  "runId = pcLedger.startCrawlRun({",
  "sourceRuntimeAfterFailure(result.source_key, runtimeBeforeCrawlAudit, error, result.run_at)"
], "expired quarantine recovery before crawl audit persistence");
assert.equal(runnerScript.match(/const recoveredFromQuarantine =/gu)?.length, 1,
  "all non-skipped scheduler outcomes must share one expired-quarantine recovery gate");
assert.doesNotMatch(runnerScript, /if \(!recoveredFromQuarantine\) pcLedger\.updateSourceRuntime/u,
  "crawl audit side effects must not leave the persisted failure count different from next_runtime");
assert.match(runnerScript, /const PC_LISTING_COLLECTION_MANIFEST_VERSION = "pc-listing-collection-v1";/u);
assert.match(runnerScript, /body: JSON\.stringify\(\{\s*items: \[\],\s*collection_manifest:/u,
  "successful collection freshness must be mirrored without rewriting listing rows");
assert.match(runnerScript,
  /mirrored\?\.manifest_version !== PC_LISTING_COLLECTION_MANIFEST_VERSION[\s\S]*JSON\.stringify\(mirroredTargetIds\) !== JSON\.stringify\(targetIds\)/u,
  "the runner must verify the immutable manifest version and exact echoed target set");
const schedulerSuccessStart = runnerScript.indexOf("const partialFailure = result.status === \"partial_success\";");
const schedulerSuccessEnd = runnerScript.indexOf("      } catch (error) {", schedulerSuccessStart);
assert.ok(schedulerSuccessStart >= 0 && schedulerSuccessEnd > schedulerSuccessStart);
const schedulerSuccessBlock = runnerScript.slice(schedulerSuccessStart, schedulerSuccessEnd);
assertOrdered(schedulerSuccessBlock, [
  "pcLedger.finishCrawlRun({",
  "pcLedger.updateSourceRuntime(result.source_key, result.next_runtime);",
  "if (!partialFailure)",
  "await mirrorPcListingCollectionManifest({"
], "successful crawl manifest publication");
assert.match(schedulerSuccessBlock,
  /\.filter\(\(target\) => target\.status === "SUCCEEDED"\s*&& PC_HOURLY_COLLECTION_TARGET_IDS\.has\(target\.target_id\)\)/u,
  "collection manifests must identify only successful hourly targets and stay below the Worker D1 query limit");

const traceMember = {
  stat_date: "2026-09-01", metric_scope: "ACTIVE", price_value: 100_000,
  outlier_flag: 0, outlier_reason: null, snapshot_id: 1, raw_listing_id: 1,
  source_id: "fixture", source_listing_id: "fixture-1", listing_item_id: 1
};
const trace = (members) => pcStatsTraceability({ traceStatMembers: () => members }, {});
const baselineTrace = trace([traceMember]);
assert.notEqual(baselineTrace.member_checksum, trace([{ ...traceMember, snapshot_id: 2 }]).member_checksum,
  "same-count traceability must detect a different ledger member");
assert.notEqual(baselineTrace.member_checksum, trace([{ ...traceMember, price_value: 90_000 }]).member_checksum,
  "same-count traceability must detect a changed member price");

console.log("aws-runner-deploy-contract: ok");
