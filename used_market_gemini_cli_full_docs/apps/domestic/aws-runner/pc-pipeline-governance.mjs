import { readFileSync } from "node:fs";
import path from "node:path";

function reportMap(document) {
  const reports = document?.versions && typeof document.versions === "object" && !Array.isArray(document.versions)
    ? document.versions
    : document;
  if (!reports || typeof reports !== "object" || Array.isArray(reports)) {
    throw new Error("PC_PIPELINE_QUALITY_REPORTS_INVALID");
  }
  return reports;
}

export function loadPipelineQualityReports(filePath) {
  const configuredPath = String(filePath || "").trim();
  if (!configuredPath) return {};
  return reportMap(JSON.parse(readFileSync(path.resolve(configuredPath), "utf8")));
}

function suppliedReport(reports, versionKey) {
  const supplied = reports?.[versionKey];
  if (!supplied || typeof supplied !== "object" || Array.isArray(supplied)) return null;
  return {
    qualityReport: supplied.quality_report && typeof supplied.quality_report === "object"
      ? supplied.quality_report
      : supplied,
    baselineReport: supplied.baseline_report && typeof supplied.baseline_report === "object"
      ? supplied.baseline_report
      : null
  };
}

export function evaluatePipelineQualityReports({ ledger, reports, evaluatedAt = new Date() }) {
  if (!ledger) throw new TypeError("ledger is required");
  const verifiedReports = reportMap(reports || {});
  const decisions = [];
  const evaluate = (versionKey) => {
    const supplied = suppliedReport(verifiedReports, versionKey);
    if (!supplied) return null;
    const decision = ledger.evaluatePipelineVersion({ versionKey, ...supplied, evaluatedAt });
    decisions.push({ version_key: versionKey, ...decision });
    return decision;
  };

  const activeBefore = ledger.getActivePipelineVersion();
  if (activeBefore?.previous_version_key) evaluate(activeBefore.version_key);
  return decisions;
}
