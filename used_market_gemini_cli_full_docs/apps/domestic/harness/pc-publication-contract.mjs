import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import worker from "../cloudflare/worker.mjs";
import {
  compactStatsForPublication,
  publishProductStats,
  statsChecksum,
  statsPublicationKey
} from "../cloudflare/public-product-stats.mjs";
import { parsePriceStatsRequest, priceStatsResponse } from "../aws-runner/pc-price-stats-http.mjs";

const runnerSource = await readFile(new URL("../aws-runner/runner.mjs", import.meta.url), "utf8");
const workerSource = await readFile(new URL("../cloudflare/worker.mjs", import.meta.url), "utf8");
assert.match(runnerSource, /SELECT DISTINCT n\.canonical_product_id, n\.market_pool/u,
  "daily publication must calculate only product/cohort scopes that have observations");
assert.doesNotMatch(runnerSource, /for \(const product of products\)[\s\S]{0,500}for \(const cohort of cohorts\)/u,
  "daily publication must not materialize the full product by cohort cross-product");
assert.match(runnerSource, /const publication = \{[\s\S]{0,240}merge_with_active: true/u,
  "daily publication must explicitly preserve same-version active scopes missing from a partial refresh");
assert.match(runnerSource, /const activatedPublication = payload\?\.publication;[\s\S]{0,1600}recordPublicationSuccess\(\{[\s\S]{0,240}checksum: activatedChecksum,[\s\S]{0,120}rowCount: activatedRowCount/u,
  "runner publication runtime must record the Worker's activated union checksum and row count");
assert.match(runnerSource, /activatedInputRowCount !== rows\.length[\s\S]{0,120}activatedScopeKeyCount !== activatedRowCount/u,
  "runner must reject a statistics activation manifest that does not match its input and active scope keys");
assert.match(runnerSource, /pcSchedulerLastSucceededAt = persistedSchedulerSuccesses\.at\(-1\) \|\| null/u,
  "runner restarts must recover truthful scheduler readiness from persisted source successes");
assert.match(workerSource, /\/admin\/import-product-stats[\s\S]{0,500}readJsonPayload\(request, MAX_STATS_PUBLICATION_BYTES\)/u,
  "only the authenticated statistics publication route may accept the larger manifest");
assert.doesNotMatch(workerSource, /\/api\/monetization\/contextual-offer[\s\S]{0,250}MAX_STATS_PUBLICATION_BYTES/u,
  "public JSON routes must retain the smaller request limit");

const emptyDailyMetric = { sample_count: 0, unit_count: 0, min: null, max: null, mean: null, median: null };
const sampledDailyMetric = { ...emptyDailyMetric, sample_count: 1, unit_count: 1, min: 400_000, max: 400_000 };
const compactedTransportStats = compactStatsForPublication({
  sold: { sample_count: 1, median: null },
  daily: [
    { date: "2026-08-30", active: emptyDailyMetric, sold: emptyDailyMetric, confirmed_transactions: emptyDailyMetric },
    { date: "2026-08-31", active: emptyDailyMetric, sold: sampledDailyMetric, confirmed_transactions: emptyDailyMetric }
  ],
  by_source: [{
    source_id: "coolenjoy",
    sold: { sample_count: 1 },
    daily: [
      { date: "2026-08-30", active: emptyDailyMetric, sold: emptyDailyMetric, confirmed_transactions: emptyDailyMetric },
      { date: "2026-08-31", active: emptyDailyMetric, sold: sampledDailyMetric, confirmed_transactions: emptyDailyMetric }
    ]
  }]
});
assert.equal(compactedTransportStats.sold.sample_count, 1,
  "publication compaction must preserve aggregate SOLD evidence");
assert.deepEqual(compactedTransportStats.daily.map((row) => row.date), ["2026-08-31"],
  "publication transport may omit only evidence-free daily rows");
assert.deepEqual(compactedTransportStats.by_source[0].daily.map((row) => row.date), ["2026-08-31"],
  "source charts must preserve every sampled SOLD day");

const baseUrl = "https://used-pick.test/api/products/gpu%3Anvidia%3Artx-3080/price-stats";
const parsed = parsePriceStatsRequest(new URL(`${baseUrl}?days=30&market_pool=KR_C2C_USED&condition=USED_WORKING&currency=KRW`));
assert.deepEqual(parsed, {
  canonicalProductId: "gpu:nvidia:rtx-3080", days: 30, marketPool: "KR_C2C_USED",
  condition: "USED_WORKING", currency: "KRW"
});
assert.throws(
  () => parsePriceStatsRequest(new URL(`${baseUrl}?days=30&market_pool=KR_C2C_USED,OVERSEAS_USED&condition=USED_WORKING&currency=KRW`)),
  /one market_pool/u
);
assert.throws(
  () => parsePriceStatsRequest(new URL(`${baseUrl}?days=30&market_pool=KR_C2C_USED&condition=USED_WORKING&currency=KRW,USD`)),
  /one currency/u
);

const response = priceStatsResponse(parsed, {
  as_of: "2026-08-29T00:00:00.000Z",
  active: { sample_count: 7, median: 510_000, mean: 520_000 },
  sold: { sample_count: 6, median: 500_000, mean: 505_000 },
  confirmed_transactions: { sample_count: 0, median: null, mean: null },
  by_source: [{ source_id: "joonggonara", active: { sample_count: 7 }, sold: { sample_count: 6 }, confirmed_transactions: { sample_count: 0 }, daily: [] }],
  daily: [], exclusions: { total: 0, reasons: {} },
  versions: { parser: "p1", rule: "r1", filter: "f1" }, traceability: { member_count: 13 }
});
assert.equal(response.reference_price.amount, 500_000);
assert.match(response.sold.disclosure, /실제 거래가격이 아니라/u);
assert.equal(response.methodology.market_pool, "KR_C2C_USED");
assert.equal(response.methodology.currency, "KRW");
assert.equal(response.by_source[0].source_id, "joonggonara");

class Statement {
  constructor(db, sql, values = []) {
    this.db = db;
    this.sql = sql;
    this.values = values;
  }

  bind(...values) { return new Statement(this.db, this.sql, values); }

  async first() {
    if (/FROM public_stats_publications WHERE active = 1/u.test(this.sql)) {
      return [...this.db.state.publications.values()].find((entry) => entry.active === 1) || null;
    }
    if (/SELECT COUNT\(\*\) AS count[\s\S]*FROM public_product_stats/u.test(this.sql)) {
      return { count: (this.db.state.rows.get(String(this.values[0])) || []).length };
    }
    throw new Error(`unsupported first(): ${this.sql}`);
  }

  async all() {
    if (/FROM public_product_stats WHERE publication_id = \?/u.test(this.sql)) {
      return { results: structuredClone(this.db.state.rows.get(String(this.values[0])) || []) };
    }
    throw new Error(`unsupported all(): ${this.sql}`);
  }

  async run() {
    if (/DELETE FROM public_stats_publications/u.test(this.sql)) {
      const publicationId = String(this.values[0]);
      const publication = this.db.state.publications.get(publicationId);
      if (publication?.active === 0) {
        this.db.state.publications.delete(publicationId);
        this.db.state.rows.delete(publicationId);
      }
      return { meta: { changes: publication ? 1 : 0 } };
    }
    throw new Error(`unsupported run(): ${this.sql}`);
  }
}

class FakeD1 {
  constructor(previousRows, previousMetadata = {}) {
    const initialRows = Array.isArray(previousRows) ? previousRows : [previousRows];
    this.state = {
      publications: new Map([["previous", {
        publication_id: "previous",
        checksum: previousMetadata.checksum || "",
        expected_row_count: initialRows.length,
        expected_non_empty_scope_count: previousMetadata.expected_non_empty_scope_count || initialRows.length,
        parser_version: previousMetadata.parser_version || "p1",
        rule_version: previousMetadata.rule_version || "r1",
        filter_version: previousMetadata.filter_version || "f1",
        active: 1
      }]]),
      rows: new Map([["previous", initialRows]])
    };
    this.failNextPointerSwap = false;
    this.maximumBatchSize = 0;
  }

  prepare(sql) { return new Statement(this, sql); }

  async batch(statements) {
    this.maximumBatchSize = Math.max(this.maximumBatchSize, statements.length);
    if (this.failNextPointerSwap && statements.some((statement) => /SET active = 0/u.test(statement.sql))) {
      this.failNextPointerSwap = false;
      throw new Error("fixture pointer swap failure");
    }
    const publications = new Map(structuredClone([...this.state.publications.entries()]));
    const rows = new Map(structuredClone([...this.state.rows.entries()]));
    for (const statement of statements) {
      if (/INSERT INTO public_stats_publications/u.test(statement.sql)) {
        const [publicationId, checksum, expectedRowCount, expectedNonEmptyScopeCount, parser, rule, filter, createdAt] = statement.values;
        publications.set(String(publicationId), {
          publication_id: String(publicationId), checksum, expected_row_count: expectedRowCount,
          expected_non_empty_scope_count: expectedNonEmptyScopeCount,
          parser_version: parser, rule_version: rule, filter_version: filter, created_at: createdAt, active: 0
        });
      } else if (/INSERT INTO public_product_stats/u.test(statement.sql)) {
        const [publicationId, canonicalProductId, marketPool, conditionCode, currency, days, statsJson, asOf] = statement.values;
        const publicationRows = rows.get(String(publicationId)) || [];
        publicationRows.push({
          canonical_product_id: canonicalProductId, market_pool: marketPool,
          condition_code: conditionCode, currency, days, stats_json: statsJson, as_of: asOf
        });
        rows.set(String(publicationId), publicationRows);
      } else if (/SET active = 0/u.test(statement.sql)) {
        for (const publication of publications.values()) publication.active = 0;
      } else if (/SET active = 1/u.test(statement.sql)) {
        const [, publicationId, checksum, expectedRowCount] = statement.values;
        const publication = publications.get(String(publicationId));
        if (publication && publication.checksum === checksum && publication.expected_row_count === expectedRowCount) publication.active = 1;
      } else {
        throw new Error(`unsupported batch statement: ${statement.sql}`);
      }
    }
    this.state = { publications, rows };
    return statements.map(() => ({ success: true }));
  }

  activePublicationId() {
    return [...this.state.publications.values()].find((entry) => entry.active === 1)?.publication_id || null;
  }
}

const stats = {
  active: { sample_count: 1 }, sold: { sample_count: 1 }, confirmed_transactions: { sample_count: 0 },
  by_source: [{ source_id: "joonggonara", active: { sample_count: 1 }, sold: { sample_count: 1 }, confirmed_transactions: { sample_count: 0 }, daily: [] }],
  versions: { parser: "p1", rule: "r1", filter: "f1" }
};
const row = {
  canonical_product_id: "gpu:nvidia:rtx-3080", market_pool: "KR_C2C_USED",
  condition_code: "USED_WORKING", currency: "KRW", days: 30,
  stats_json: stats, as_of: "2026-08-29T00:00:00.000Z"
};
const checksum = await statsChecksum([row]);
const inputFor = (publicationId) => ({
  publication_id: publicationId, rows: [row], expected_row_count: 1,
  expected_non_empty_scope_count: 1, checksum,
  expected_keys: [statsPublicationKey(row)],
  parser_version: "p1", rule_version: "r1", filter_version: "f1",
  created_at: "2026-08-29T00:00:00.000Z"
});

const db = new FakeD1(row);
await publishProductStats(db, inputFor("next"));
assert.equal(db.activePublicationId(), "next");
db.failNextPointerSwap = true;
await assert.rejects(() => publishProductStats(db, inputFor("broken")), /fixture pointer swap failure/u);
assert.equal(db.activePublicationId(), "next", "failed publication must preserve the previous active pointer");
assert.equal(db.state.publications.has("broken"), false, "failed staging rows must be removed");
await assert.rejects(() => publishProductStats(db, { ...inputFor("bad-checksum"), checksum: "bad" }), /checksum mismatch/u);
await assert.rejects(() => publishProductStats(db, { ...inputFor("mixed-version"), rule_version: "r2" }), /mixed rule versions/u);
const duplicateSourceStats = { ...stats, by_source: [...stats.by_source, stats.by_source[0]] };
const duplicateSourceRow = { ...row, stats_json: duplicateSourceStats };
const duplicateSourceChecksum = await statsChecksum([duplicateSourceRow]);
await assert.rejects(() => publishProductStats(db, {
  ...inputFor("duplicate-source"), rows: [duplicateSourceRow], checksum: duplicateSourceChecksum
}), /duplicate or invalid source/u);

const scopeRow = (canonicalProductId, rowStats = stats, asOf = "2026-08-29T00:00:00.000Z") => ({
  ...row,
  canonical_product_id: canonicalProductId,
  stats_json: rowStats,
  as_of: asOf
});
const preservedRow = scopeRow("gpu:nvidia:rtx-3080");
const overlapOldRow = scopeRow("gpu:nvidia:rtx-3070");
const overlapNewStats = {
  ...stats,
  active: { sample_count: 3 },
  sold: { sample_count: 2 }
};
const overlapNewRow = scopeRow("gpu:nvidia:rtx-3070", overlapNewStats, "2026-08-31T00:00:00.000Z");
const addedRow = scopeRow("gpu:nvidia:rtx-4070", stats, "2026-08-31T00:00:00.000Z");
const previousMergeRows = [preservedRow, overlapOldRow];
const previousMergeChecksum = await statsChecksum(previousMergeRows);
const mergeDb = new FakeD1(previousMergeRows, {
  checksum: previousMergeChecksum,
  expected_non_empty_scope_count: 2,
  parser_version: "p1", rule_version: "r1", filter_version: "f1"
});
const mergeInputRows = [overlapNewRow, addedRow];
const mergeInputChecksum = await statsChecksum(mergeInputRows);
const mergeInput = {
  publication_id: "merged-publication",
  rows: mergeInputRows,
  expected_row_count: mergeInputRows.length,
  expected_non_empty_scope_count: 2,
  checksum: mergeInputChecksum,
  expected_keys: mergeInputRows.map(statsPublicationKey),
  parser_version: "p1", rule_version: "r1", filter_version: "f1",
  merge_with_active: true,
  created_at: "2026-08-31T00:00:00.000Z"
};
await assert.rejects(() => publishProductStats(mergeDb, {
  ...mergeInput,
  publication_id: "invalid-input-first",
  checksum: "bad",
  parser_version: "p2", rule_version: "r2", filter_version: "f2"
}), /publication checksum mismatch/u,
"merge mode must validate the input checksum before comparing active-publication versions");
const v2Stats = { ...overlapNewStats, versions: { parser: "p2", rule: "r2", filter: "f2" } };
const v2Rows = [
  scopeRow("gpu:nvidia:rtx-3070", v2Stats),
  scopeRow("gpu:nvidia:rtx-4070", v2Stats)
];
const v2Checksum = await statsChecksum(v2Rows);
await assert.rejects(() => publishProductStats(mergeDb, {
  ...mergeInput,
  publication_id: "version-mismatch",
  rows: v2Rows,
  checksum: v2Checksum,
  expected_keys: v2Rows.map(statsPublicationKey),
  parser_version: "p2", rule_version: "r2", filter_version: "f2"
}), /exact parser\/rule\/filter version match/u);
const corruptActiveDb = new FakeD1(previousMergeRows, {
  checksum: "corrupt-active-checksum",
  expected_non_empty_scope_count: 2,
  parser_version: "p1", rule_version: "r1", filter_version: "f1"
});
await assert.rejects(() => publishProductStats(corruptActiveDb, {
  ...mergeInput,
  publication_id: "corrupt-active"
}), /active publication checksum integrity check failed/u,
"merge mode must not preserve rows from an active publication whose manifest no longer matches storage");
const shrinkRows = [overlapNewRow];
const shrinkChecksum = await statsChecksum(shrinkRows);
await assert.rejects(() => publishProductStats(mergeDb, {
  ...mergeInput,
  publication_id: "default-shrink",
  rows: shrinkRows,
  checksum: shrinkChecksum,
  expected_row_count: 1,
  expected_non_empty_scope_count: 1,
  expected_keys: shrinkRows.map(statsPublicationKey),
  merge_with_active: false
}), /scope shrink/u,
"merge mode must remain opt-in and preserve the default shrink guard");
await assert.rejects(() => publishProductStats(mergeDb, {
  ...mergeInput,
  publication_id: "default-key-omission",
  merge_with_active: false
}), /cannot omit an active scope key/u,
"the default path must preserve the active-key manifest guard");
const expectedMergedRows = [preservedRow, overlapNewRow, addedRow];
const expectedMergedChecksum = await statsChecksum(expectedMergedRows);
const mergedPublication = await publishProductStats(mergeDb, mergeInput);
assert.equal(mergeDb.activePublicationId(), "merged-publication");
assert.equal(mergedPublication.merged_with_active, true);
assert.equal(mergedPublication.input_row_count, 2);
assert.equal(mergedPublication.preserved_row_count, 1);
assert.equal(mergedPublication.overwritten_row_count, 1);
assert.equal(mergedPublication.row_count, 3);
assert.equal(mergedPublication.scope_key_count, 3);
assert.equal(mergedPublication.checksum, expectedMergedChecksum,
  "the server must recalculate the checksum from the union publication");
const mergedMetadata = mergeDb.state.publications.get("merged-publication");
assert.equal(mergedMetadata.expected_row_count, 3);
assert.equal(mergedMetadata.checksum, expectedMergedChecksum);
const mergedRows = mergeDb.state.rows.get("merged-publication");
assert.equal(mergedRows.some((entry) => entry.canonical_product_id === "gpu:nvidia:rtx-3080"), true,
  "an active scope missing from the input must be preserved");
assert.equal(JSON.parse(mergedRows.find((entry) => entry.canonical_product_id === "gpu:nvidia:rtx-3070").stats_json)
  .active.sample_count, 3,
"an overlapping input scope must replace the previous active row");

const previousThresholdRows = Array.from({ length: 4 }, (_, index) => scopeRow(`gpu:fixture:threshold-${index}`));
const thresholdDb = new FakeD1(previousThresholdRows, {
  checksum: await statsChecksum(previousThresholdRows),
  expected_non_empty_scope_count: 4,
  parser_version: "p1", rule_version: "r1", filter_version: "f1"
});
const emptyStats = {
  ...stats,
  active: { sample_count: 0 }, sold: { sample_count: 0 }, confirmed_transactions: { sample_count: 0 }
};
const thresholdInputRows = previousThresholdRows.map((entry, index) => (
  scopeRow(entry.canonical_product_id, index === 0 ? stats : emptyStats, "2026-08-31T00:00:00.000Z")
));
const thresholdInputChecksum = await statsChecksum(thresholdInputRows);
await assert.rejects(() => publishProductStats(thresholdDb, {
  ...mergeInput,
  publication_id: "sample-drop",
  rows: thresholdInputRows,
  checksum: thresholdInputChecksum,
  expected_row_count: 4,
  expected_non_empty_scope_count: 1,
  expected_keys: thresholdInputRows.map(statsPublicationKey)
}), /sampled scope count dropped by more than 50 percent/u,
"merge mode must retain the sampled-scope drop guard after constructing the union");

const manyRows = Array.from({ length: 125 }, (_, index) => ({
  ...row,
  canonical_product_id: index === 0 ? row.canonical_product_id : `gpu:fixture:model-${index}`
}));
const manyRowsChecksum = await statsChecksum(manyRows);
await publishProductStats(db, {
  ...inputFor("large-publication"), rows: manyRows, checksum: manyRowsChecksum,
  expected_row_count: manyRows.length, expected_non_empty_scope_count: manyRows.length,
  expected_keys: manyRows.map(statsPublicationKey)
});
assert.equal(db.activePublicationId(), "large-publication");
assert.ok(db.maximumBatchSize <= 50, "large publications must stay within bounded D1 batches");

const workerDb = {
  prepare() {
    return { bind() { return { async first() { return { stats_json: JSON.stringify(stats) }; } }; } };
  }
};
const workerUrl = `${baseUrl}?days=30&market_pool=KR_C2C_USED&condition=USED_WORKING&currency=KRW`;
const workerResponse = await worker.fetch(new Request(workerUrl), { DB: workerDb });
assert.equal(workerResponse.status, 200);
const mixedCurrencyResponse = await worker.fetch(new Request(workerUrl.replace("currency=KRW", "currency=KRW,USD")), { DB: workerDb });
assert.equal(mixedCurrencyResponse.status, 400);

console.log(JSON.stringify({ status: "passed", contract: "pc-publication" }, null, 2));
