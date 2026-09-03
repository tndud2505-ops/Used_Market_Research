import assert from "node:assert/strict";

import { pcCollectionTargetSetV2 } from "../cloudflare/pc-directory-http.mjs";
import { OPERATIONAL_PC_DIRECTORY_SITES } from "../cloudflare/target-sites.mjs";
import { PC_PART_CATEGORY_CODES } from "../collector/logic/pc-specialist-targets.mjs";
import { PC_SOURCE_REGISTRY, listSourceCadenceEvents } from "../collector/logic/pc-source-registry.mjs";

const targetSet = pcCollectionTargetSetV2();
const targets = targetSet.targets.filter((target) => target.enabled !== false);
const targetIds = targets.map((target) => target.targetId);
const categorySet = new Set(PC_PART_CATEGORY_CODES);
const operationalSites = new Set(OPERATIONAL_PC_DIRECTORY_SITES);

assert.equal(new Set(targetIds).size, targetIds.length, "collection target ids must be unique");
assert.ok(targets.length > PC_PART_CATEGORY_CODES.length, "the active target set must include category and model batches");
assert.equal(new Set(targets.map((target) => target.categoryCode)).size, categorySet.size,
  "every PC part category must have an active collection target");
assert.doesNotMatch(JSON.stringify(targetSet), /quasarzone/iu, "retired Quasarzone must not be an active collection target");

const directorySources = PC_SOURCE_REGISTRY
  .filter((source) => source.directory_source === true && source.policy_status === "APPROVED" && source.runtime_status === "ENABLED")
  .map((source) => source.key);
assert.deepEqual([...operationalSites].sort(), [...new Set(directorySources)].sort(),
  "operational directory sites must come from the approved enabled registry");

for (const categoryCode of PC_PART_CATEGORY_CODES) {
  const categoryTargets = targets.filter((target) => target.categoryCode === categoryCode);
  assert.ok(categoryTargets.length > 0, `${categoryCode} must have at least one target`);
  assert.ok(categoryTargets.some((target) => target.cadenceClass === "HOURLY_CATEGORY"),
    `${categoryCode} must have a recurring category collection batch`);
  assert.ok(categoryTargets.some((target) => target.cadenceClass === "DAILY_MASTER" && target.canonicalProductId),
    `${categoryCode} must have a daily exact-model collection batch`);
  for (const sourceId of operationalSites) {
    assert.ok(categoryTargets.some((target) => target.sourceKeys.includes(sourceId)),
      `${sourceId} must be assigned to ${categoryCode}`);
  }
}

for (const sourceId of operationalSites) {
  const assigned = targets.filter((target) => target.sourceKeys.includes(sourceId));
  assert.ok(assigned.length > 0, `${sourceId} must have assigned collection targets`);
  assert.ok(assigned.every((target) => target.queryText.trim()), `${sourceId} targets must have queries`);
  assert.ok(assigned.every((target) => Number(target.minimumIntervalMinutes) >= 55),
    `${sourceId} targets must respect the minimum pacing guard`);
}

const events = listSourceCadenceEvents({
  after: "2026-08-31T14:00:00.000Z",
  through: "2026-08-31T16:00:00.000Z",
  jitterBySource: Object.fromEntries([...operationalSites].map((sourceId) => [sourceId, 0]))
});
const eventSources = new Set(events.map((event) => event.source_key));
for (const sourceId of operationalSites) {
  assert.ok(eventSources.has(sourceId), `${sourceId} must have a scheduler cadence event`);
}

const coverage = Object.fromEntries(PC_PART_CATEGORY_CODES.map((categoryCode) => [
  categoryCode,
  Object.fromEntries([...operationalSites].map((sourceId) => [
    sourceId,
    targets.filter((target) => target.categoryCode === categoryCode && target.sourceKeys.includes(sourceId)).length
  ]))
]));

console.log(JSON.stringify({
  status: "passed",
  contract: "pc-collection-matrix",
  target_set_version: targetSet.targetSetVersion,
  enabled_target_count: targets.length,
  operational_sites: [...operationalSites].sort(),
  category_count: PC_PART_CATEGORY_CODES.length,
  coverage
}, null, 2));
