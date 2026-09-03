import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyPcPartListing } from "../market/logic/pc-parts-classifier.mjs";
import { SearchIndex } from "./search-index.mjs";
import { PcPartsLedger } from "./pc-parts-ledger.mjs";

function ratio(numerator, denominator) {
  return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : null;
}

function clean(value) {
  return value == null ? null : String(value).trim().toUpperCase();
}

function recordsFrom(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.records)) return value.records;
  throw new TypeError("quality dataset must be an array or {records: []}");
}

export function evaluatePcQualityDataset(records) {
  const rows = recordsFrom(records).map((record, index) => {
    const fixtureTruth = record?.truth || record?.expected;
    if (!record?.input || !fixtureTruth) throw new TypeError(`record ${index + 1} requires input and truth/expected`);
    const prediction = record.prediction || classifyPcPartListing(record.input);
    const truth = record.expected && fixtureTruth.duplicate === undefined ? { ...fixtureTruth, duplicate: false } : fixtureTruth;
    const normalizedPrediction = record.expected && prediction.duplicate_merged === undefined
      ? { ...prediction, duplicate_merged: false }
      : prediction;
    return { id: record.id || String(index + 1), input: record.input, truth, prediction: normalizedPrediction };
  });
  const categoryRows = rows.filter((row) => clean(row.prediction.category_code) !== "UNKNOWN");
  const modelRows = rows.filter((row) => row.truth.canonical_model != null);
  const ramRows = rows.filter((row) => clean(row.truth.category_code) === "RAM");
  const bundleRows = rows.filter((row) => ["FULL_SYSTEM", "COMPONENT_BUNDLE"].includes(clean(row.truth.listing_kind)));
  const dedupeRows = rows.filter((row) => typeof row.truth.duplicate === "boolean" && typeof row.prediction.duplicate_merged === "boolean");
  const categoryCorrect = categoryRows.filter((row) => clean(row.prediction.category_code) === clean(row.truth.category_code)).length;
  const modelCorrect = modelRows.filter((row) => clean(row.prediction.canonical_model) === clean(row.truth.canonical_model)).length;
  const ramCorrect = ramRows.filter((row) => Number(row.prediction.quantity) === Number(row.truth.quantity)
    && clean(row.prediction.price_scope) === clean(row.truth.price_scope)).length;
  const bundleContamination = bundleRows.filter((row) => row.prediction.price_eligible === true).length;
  const falseDedupe = dedupeRows.filter((row) => row.truth.duplicate === false && row.prediction.duplicate_merged === true).length;
  const falseSold = rows.filter((row) => clean(row.truth.lifecycle_status) !== "SOLD"
    && clean(row.prediction.lifecycle_status) === "SOLD").length;
  const marketPoolMismatch = rows.filter((row) => row.truth.market_pool != null
    && clean(row.prediction.market_pool) !== clean(row.truth.market_pool)).length;
  const unknown = rows.filter((row) => clean(row.prediction.category_code) === "UNKNOWN"
    || (!row.prediction.canonical_model && !["FULL_SYSTEM", "COMPONENT_BUNDLE", "WANTED", "OPTION_AD", "BOX_ONLY", "ACCESSORY_ONLY"]
      .includes(clean(row.prediction.listing_kind)))).length;

  const metrics = {
    reviewed_records: rows.length,
    category_precision: ratio(categoryCorrect, categoryRows.length),
    exact_model_accuracy: ratio(modelCorrect, modelRows.length),
    ram_quantity_price_scope_accuracy: ratio(ramCorrect, ramRows.length),
    bundle_contamination_rate: ratio(bundleContamination, bundleRows.length),
    false_dedupe_rate: ratio(falseDedupe, dedupeRows.filter((row) => row.truth.duplicate === false).length),
    unknown_rate: ratio(unknown, rows.length),
    false_sold_count: falseSold,
    market_pool_mismatch_count: marketPoolMismatch
  };
  return {
    metrics,
    targets: {
      category_precision: { target: 0.99, met: metrics.category_precision == null ? null : metrics.category_precision >= 0.99 },
      exact_model_accuracy: { target: 0.98, met: metrics.exact_model_accuracy == null ? null : metrics.exact_model_accuracy >= 0.98 },
      ram_quantity_price_scope_accuracy: { target: 0.995, met: metrics.ram_quantity_price_scope_accuracy == null ? null : metrics.ram_quantity_price_scope_accuracy >= 0.995 },
      bundle_contamination_rate: { target: 0.005, met: metrics.bundle_contamination_rate == null ? null : metrics.bundle_contamination_rate < 0.005 },
      false_dedupe_rate: { target: 0.002, met: metrics.false_dedupe_rate == null ? null : metrics.false_dedupe_rate < 0.002 },
      unknown_rate: { target: 0.10, met: metrics.unknown_rate <= 0.10 }
    },
    integrity_blockers: {
      false_sold_count: falseSold,
      market_pool_mismatch_count: marketPoolMismatch,
      false_dedupe_count: falseDedupe
    }
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const datasetPath = process.argv[2];
  if (!datasetPath) throw new Error("usage: node aws-runner/pc-quality-eval.mjs <human-reviewed-dataset.json>");
  const report = evaluatePcQualityDataset(JSON.parse(await readFile(datasetPath, "utf8")));
  let versionDecision = null;
  let backup = null;
  const ledgerOption = process.argv.indexOf("--ledger");
  const versionOption = process.argv.indexOf("--version-key");
  if (ledgerOption >= 0 || versionOption >= 0 || process.argv.includes("--apply-version-decision")) {
    if (ledgerOption < 0 || !process.argv[ledgerOption + 1]) throw new Error("--ledger requires a SQLite path");
    if (versionOption < 0 || !process.argv[versionOption + 1]) throw new Error("--version-key is required for a version decision");
    if (!process.argv.includes("--apply-version-decision") || !process.argv.includes("--confirm-version-decision")) {
      throw new Error("version decisions require --apply-version-decision --confirm-version-decision");
    }
    const ledgerPath = path.resolve(process.argv[ledgerOption + 1]);
    const index = new SearchIndex({ filePath: ledgerPath, backupDir: path.join(path.dirname(ledgerPath), "backups") });
    try {
      backup = index.createBackup();
      if (!backup) throw new Error("A recovery backup is required before a pipeline version decision");
      const ledger = new PcPartsLedger({ db: index.db });
      ledger.migrate();
      versionDecision = ledger.evaluatePipelineVersion({ versionKey: process.argv[versionOption + 1], qualityReport: report });
    } finally {
      index.close();
    }
  }
  console.log(JSON.stringify({ ...report, version_decision: versionDecision, backup }, null, 2));
  if (Object.values(report.integrity_blockers).some((value) => value > 0)) process.exitCode = 2;
  if (versionDecision?.status === "ROLLED_BACK") process.exitCode = 2;
}
