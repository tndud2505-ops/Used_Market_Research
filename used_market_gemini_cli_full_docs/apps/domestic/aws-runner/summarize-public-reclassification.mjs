import { readFile } from "node:fs/promises";

const reportPath = String(process.argv[2] || "").trim();
if (!reportPath) throw new Error("dry-run report path is required");
const report = JSON.parse(await readFile(reportPath, "utf8"));
if (report?.mode !== "dry-run" || !Array.isArray(report.candidates)) {
  throw new Error("input is not a public reclassification dry-run report");
}

const bySource = {};
const samplesByKind = {};
for (const candidate of report.candidates) {
  const source = String(candidate.site || "UNKNOWN");
  const kind = String(candidate.classified_listing_kind || "UNKNOWN");
  bySource[source] = Number(bySource[source] || 0) + 1;
  if (!samplesByKind[kind]) samplesByKind[kind] = [];
  if (samplesByKind[kind].length < 8) {
    samplesByKind[kind].push({ item_id: candidate.item_id, title: candidate.title });
  }
}

console.log(JSON.stringify({
  scanned_count: Number(report.scanned_count || 0),
  candidate_count: Number(report.candidate_count || 0),
  by_kind: report.by_kind || {},
  by_source: Object.fromEntries(Object.entries(bySource).sort(([left], [right]) => left.localeCompare(right))),
  samples_by_kind: Object.fromEntries(Object.entries(samplesByKind).sort(([left], [right]) => left.localeCompare(right)))
}, null, 2));
