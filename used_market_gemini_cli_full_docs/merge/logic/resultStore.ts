import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { applyResultRetention } from "./result-retention.js";

export interface ResultWriteInput {
  module: string;
  command: string;
  payload: unknown;
  notes?: string[];
  summary?: Record<string, unknown>;
}

function timestampDir(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export async function writeCentralResult(input: ResultWriteInput) {
  const runId = `${timestampDir()}__${input.module}__${input.command}`;
  const resultRoot = path.resolve(process.cwd(), "merge/result");
  const baseDir = path.join(resultRoot, input.module, runId);
  await mkdir(baseDir, { recursive: true });

  const outputPath = path.join(baseDir, "output.json");
  const reportPath = path.join(baseDir, "report.md");
  const summaryPath = path.join(baseDir, "run-summary.json");
  const outputJson = JSON.stringify(input.payload, null, 2);

  // Fail fast if the serialized payload cannot be read back as valid JSON.
  JSON.parse(outputJson);

  await writeFile(outputPath, outputJson, "utf-8");
  await writeFile(reportPath, buildReport(input.module, input.command, input.notes), "utf-8");
  await writeFile(summaryPath, JSON.stringify({
    module: input.module,
    command: input.command,
    status: "success",
    run_id: runId,
    created_at: new Date().toISOString(),
    output_files: ["output.json", "report.md"],
    notes: input.notes ?? [],
    ...(input.summary ?? {})
  }, null, 2), "utf-8");

  await applyResultRetention(input.module, resultRoot);

  return { runId, baseDir, outputPath, reportPath, summaryPath };
}

function buildReport(module: string, command: string, notes?: string[]): string {
  const body = (notes ?? []).map((note) => `- ${note}`).join("\n");
  return `# Run Report\n\n- module: ${module}\n- command: ${command}\n\n## Notes\n${body || "- no notes"}\n`;
}
