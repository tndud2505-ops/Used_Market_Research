import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { PcPartsLedger } from "../aws-runner/pc-parts-ledger.mjs";
import { bunjangLifecycleStatus, bunjangProductIdFromListing, parseBunjangDetailLifecycle } from "../market/logic/bunjang-lifecycle.mjs";

for (const [input, expected] of [[0, "ACTIVE"], [1, "RESERVED"], [2, "DELETED"],
  [3, "SOLD"], ["SOLD_OUT", "SOLD"], ["SELLING", "ACTIVE"], [undefined, "UNAVAILABLE_UNKNOWN"]]) {
  assert.equal(bunjangLifecycleStatus(input), expected);
}
assert.throws(() => parseBunjangDetailLifecycle({ data: { product: { pid: 2, saleStatus: "SOLD_OUT" } } }, "1"), /IDENTITY_MISMATCH/);
assert.throws(() => parseBunjangDetailLifecycle({ data: { shopProducts: [{ pid: 1, saleStatus: "SOLD_OUT" }] } }, "1"), /IDENTITY_MISMATCH/);
const sold = parseBunjangDetailLifecycle({ data: { product: { pid: 1, saleStatus: "SOLD_OUT", price: 30000 } } }, "1");
assert.equal(sold.status, "SOLD");
assert.equal(sold.price, 30000);
assert.deepEqual(sold.evidence, { type: "STRUCTURED_STATUS", value: "SOLD" });
assert.equal(bunjangProductIdFromListing({ url: "https://m.bunjang.co.kr/products/123456789" }), "123456789");
assert.equal(bunjangProductIdFromListing({
  url: "https://m.bunjang.co.kr/products/[PHONE]",
  sourceListingId: "bunjang:https://m.bunjang.co.kr/products/162044325"
}), "162044325", "legacy redaction must not strand a recoverable Bunjang listing");
assert.equal(bunjangProductIdFromListing({ url: "https://example.test/products/invalid" }), null);
const db = new DatabaseSync(":memory:");
const ledger = new PcPartsLedger({ db });
ledger.migrate();
ledger.upsertSource({ sourceId: "bunjang", displayName: "Bunjang", marketPool: "KR_C2C_USED", policyStatus: "APPROVED", runtimeStatus: "ENABLED" });
const observation = { sourceId: "bunjang", sourceListingId: "1", title: "RTX 3080",
  currency: "KRW", price: 30000, status: "ACTIVE", rawPayload: { url: "https://m.bunjang.co.kr/products/1" },
  statusEvidence: { type: "STRUCTURED_STATUS", value: "ACTIVE" } };
ledger.recordObservation({ ...observation, observedAt: "2026-09-01T00:00:00Z" });
ledger.recordObservation({ ...observation, price: 29000, observedAt: "2026-09-02T00:00:00Z" });
ledger.compactStorage({ asOf: "2026-09-14T00:00:00Z", observationRetentionDays: 1, pruneObservationDetails: true });
assert.equal(db.prepare("SELECT count(*) n FROM listing_snapshots").get().n, 1);
assert.equal(ledger.dueRechecks({ sourceId: "bunjang", checkedBefore: "2026-09-14T00:00:00Z", limit: 1500 }).length, 1);
const dueStatus = ledger.lifecycleRecheckStatus({ sourceId: "bunjang", asOf: "2026-09-14T00:00:00Z" });
assert.equal(dueStatus.due_count, 1);
assert.equal(dueStatus.oldest_last_checked_at, "2026-09-02T00:00:00.000Z");
assert.equal(dueStatus.oldest_age_seconds, 12 * 24 * 60 * 60);
assert.equal(dueStatus.operational_sla_hours, 24);
assert.equal(dueStatus.operational_overdue_count, 1);
assert.equal(dueStatus.oldest_operational_overdue_at, "2026-09-02T00:00:00.000Z");
const result = ledger.recordObservation({ ...observation, price: sold.price, status: sold.status,
  statusEvidence: sold.evidence, observedAt: "2026-09-14T01:00:00Z" });
assert.equal(result.soldLastAskPrice, 29000, "compacted history retains the last asking price for a later sale");
assert.equal(ledger.dueRechecks({ sourceId: "bunjang", checkedBefore: "2026-09-15T00:00:00Z", limit: 1500 }).length, 0);
assert.equal(ledger.lifecycleRecheckStatus({ sourceId: "bunjang", asOf: "2026-09-15T00:00:00Z" }).due_count, 0,
  "terminal sold listings must leave the lifecycle recheck backlog");
assert.equal(ledger.recordObservation({ ...observation, status: sold.status, statusEvidence: sold.evidence,
  observedAt: "2026-09-14T02:00:00Z" }).snapshotCreated, false, "repeat sale observations are not counted twice");
db.close();
console.log("Bunjang lifecycle contract passed");
