import { copyFile, mkdir, readFile, rename, readdir, stat, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type ScanStatus = "valid" | "repairable" | "invalid";
type ProposedAction = "none" | "repair_bom" | "quarantine";
type IssueCode =
  | "missing_output"
  | "malformed_json"
  | "structurally_invalid"
  | "root_not_object";

interface ValidationRule {
  moduleName: string;
  commandMatch?: string | RegExp;
  requiredKeys: string[];
  arrayKeys?: string[];
}

export interface RunScanEntry {
  moduleName: string;
  runId: string;
  command: string | null;
  runDir: string;
  outputPath: string;
  status: ScanStatus;
  issueCode: IssueCode | null;
  issueSummary: string;
  proposedAction: ProposedAction;
  actionPerformed: ProposedAction;
  backupPath: string | null;
  quarantinePath: string | null;
  repairedBytesRemoved: number;
}

export interface ScanSummary {
  rootDir: string;
  quarantineDir: string;
  apply: boolean;
  scannedAt: string;
  scannedRunCount: number;
  validCount: number;
  repairableCount: number;
  invalidCount: number;
  repairedCount: number;
  quarantinedCount: number;
  entries: RunScanEntry[];
}

export interface ScanOptions {
  rootDir?: string;
  quarantineDir?: string;
  apply?: boolean;
  moduleNames?: string[];
}

interface ValidationResult {
  valid: boolean;
  issueCode: IssueCode | null;
  issueSummary: string;
}

const OUTPUT_FILE = "output.json";
const QUARANTINE_DIRNAME = "_quarantine";
const UTF8_BOM = "\uFEFF";
const RUN_DIR_PATTERN = /^\d{4}-\d{2}-\d{2}T[\d:-]+Z__[^_].+__.+$/;
const SKIPPED_MODULES = new Set(["notifier"]);

const VALIDATION_RULES: ValidationRule[] = [
  { moduleName: "collector", commandMatch: "login-check", requiredKeys: ["site", "login_status", "errors"], arrayKeys: ["errors"] },
  { moduleName: "collector", requiredKeys: ["site", "items", "errors", "next_action"], arrayKeys: ["items", "errors"] },
  { moduleName: "market", requiredKeys: ["keyword", "normalized_results", "merged_result", "market_snapshot"] },
  { moduleName: "merge", commandMatch: "full", requiredKeys: ["keyword", "normalized_results", "merged_result", "market_snapshot"] },
  { moduleName: "merge", commandMatch: "merge-latest", requiredKeys: ["collector", "MCP", "merge", "merged"] },
  { moduleName: "merged", requiredKeys: ["metadata", "merged_items", "issues"], arrayKeys: ["merged_items", "issues"] },
  { moduleName: "reporter", commandMatch: "run", requiredKeys: ["run_id", "warnings"], arrayKeys: ["warnings"] },
  { moduleName: "reporter", commandMatch: "reporter-daemon-run-once", requiredKeys: ["action", "running", "result", "status"] },
  { moduleName: "reporter", commandMatch: "reporter-daemon-status", requiredKeys: ["action", "running", "current_status"] },
  { moduleName: "reporter", commandMatch: "reporter-daemon-start", requiredKeys: ["action", "started", "status"] },
  { moduleName: "scheduler", commandMatch: "schedule-plan", requiredKeys: ["jobs"], arrayKeys: ["jobs"] },
  { moduleName: "scheduler", commandMatch: "scheduler-daemon-status", requiredKeys: ["action", "running", "current_status"] },
  { moduleName: "scheduler", commandMatch: "scheduler-daemon-start", requiredKeys: ["action", "started", "status"] },
  { moduleName: "web-backend", commandMatch: "start", requiredKeys: ["timestamp", "available_endpoints"], arrayKeys: ["available_endpoints"] }
];

export async function scanHistoricalResultOutputs(options: ScanOptions = {}): Promise<ScanSummary> {
  const rootDir = path.resolve(options.rootDir ?? path.join(process.cwd(), "merge/result"));
  const quarantineDir = path.resolve(options.quarantineDir ?? path.join(rootDir, QUARANTINE_DIRNAME));
  const apply = options.apply ?? false;
  const requestedModules = new Set((options.moduleNames ?? []).map((moduleName) => moduleName.trim()).filter(Boolean));
  const entries: RunScanEntry[] = [];

  const moduleDirs = await readdir(rootDir, { withFileTypes: true });
  for (const moduleDir of moduleDirs) {
    if (!moduleDir.isDirectory()) {
      continue;
    }
    if (moduleDir.name === QUARANTINE_DIRNAME) {
      continue;
    }
    if (SKIPPED_MODULES.has(moduleDir.name)) {
      continue;
    }
    if (requestedModules.size > 0 && !requestedModules.has(moduleDir.name)) {
      continue;
    }

    const absoluteModuleDir = path.join(rootDir, moduleDir.name);
    const runDirs = await readdir(absoluteModuleDir, { withFileTypes: true });
    for (const runDir of runDirs) {
      if (!runDir.isDirectory()) {
        continue;
      }
      if (!RUN_DIR_PATTERN.test(runDir.name)) {
        continue;
      }
      entries.push(await inspectRunDirectory({
        moduleName: moduleDir.name,
        runDir: path.join(absoluteModuleDir, runDir.name),
        runId: runDir.name,
        rootDir,
        quarantineDir,
        apply
      }));
    }
  }

  return {
    rootDir,
    quarantineDir,
    apply,
    scannedAt: new Date().toISOString(),
    scannedRunCount: entries.length,
    validCount: entries.filter((entry) => entry.status === "valid").length,
    repairableCount: entries.filter((entry) => entry.status === "repairable").length,
    invalidCount: entries.filter((entry) => entry.status === "invalid").length,
    repairedCount: entries.filter((entry) => entry.actionPerformed === "repair_bom").length,
    quarantinedCount: entries.filter((entry) => entry.actionPerformed === "quarantine").length,
    entries
  };
}

async function inspectRunDirectory(input: {
  moduleName: string;
  runDir: string;
  runId: string;
  rootDir: string;
  quarantineDir: string;
  apply: boolean;
}): Promise<RunScanEntry> {
  const outputPath = path.join(input.runDir, OUTPUT_FILE);
  const command = parseRunId(input.runId).command;

  if (!(await exists(outputPath))) {
    return maybeQuarantine({
      moduleName: input.moduleName,
      runId: input.runId,
      command,
      runDir: input.runDir,
      outputPath,
      status: "invalid",
      issueCode: "missing_output",
      issueSummary: `${OUTPUT_FILE} is missing`,
      proposedAction: "quarantine",
      rootDir: input.rootDir,
      quarantineDir: input.quarantineDir,
      apply: input.apply
    });
  }

  const rawText = await readFile(outputPath, "utf8");
  const directParse = tryParseJson(rawText);
  if (directParse.ok) {
    const validation = validatePayload(directParse.value, input.moduleName, command);
    if (!validation.valid) {
      return maybeQuarantine({
        moduleName: input.moduleName,
        runId: input.runId,
        command,
        runDir: input.runDir,
        outputPath,
        status: "invalid",
        issueCode: validation.issueCode,
        issueSummary: validation.issueSummary,
        proposedAction: "quarantine",
        rootDir: input.rootDir,
        quarantineDir: input.quarantineDir,
        apply: input.apply
      });
    }

    return {
      moduleName: input.moduleName,
      runId: input.runId,
      command,
      runDir: input.runDir,
      outputPath,
      status: "valid",
      issueCode: null,
      issueSummary: "valid",
      proposedAction: "none",
      actionPerformed: "none",
      backupPath: null,
      quarantinePath: null,
      repairedBytesRemoved: 0
    };
  }

  const sanitizedText = stripLeadingBom(rawText);
  if (sanitizedText !== rawText) {
    const repairedParse = tryParseJson(sanitizedText);
    if (repairedParse.ok) {
      const validation = validatePayload(repairedParse.value, input.moduleName, command);
      if (validation.valid) {
        return maybeRepairBom({
          moduleName: input.moduleName,
          runId: input.runId,
          command,
          runDir: input.runDir,
          outputPath,
          sanitizedText,
          removedChars: rawText.length - sanitizedText.length,
          apply: input.apply
        });
      }

      return maybeQuarantine({
        moduleName: input.moduleName,
        runId: input.runId,
        command,
        runDir: input.runDir,
        outputPath,
        status: "invalid",
        issueCode: validation.issueCode,
        issueSummary: `${validation.issueSummary}; reparsed after BOM removal`,
        proposedAction: "quarantine",
        rootDir: input.rootDir,
        quarantineDir: input.quarantineDir,
        apply: input.apply
      });
    }
  }

  return maybeQuarantine({
    moduleName: input.moduleName,
    runId: input.runId,
    command,
    runDir: input.runDir,
    outputPath,
    status: "invalid",
    issueCode: "malformed_json",
    issueSummary: directParse.error,
    proposedAction: "quarantine",
    rootDir: input.rootDir,
    quarantineDir: input.quarantineDir,
    apply: input.apply
  });
}

async function maybeRepairBom(input: {
  moduleName: string;
  runId: string;
  command: string | null;
  runDir: string;
  outputPath: string;
  sanitizedText: string;
  removedChars: number;
  apply: boolean;
}): Promise<RunScanEntry> {
  let backupPath: string | null = null;
  let actionPerformed: ProposedAction = "none";

  if (input.apply) {
    backupPath = await createBackup(input.outputPath, "bom-backup");
    await writeFile(input.outputPath, input.sanitizedText, "utf8");
    actionPerformed = "repair_bom";
  }

  return {
    moduleName: input.moduleName,
    runId: input.runId,
    command: input.command,
    runDir: input.runDir,
    outputPath: input.outputPath,
    status: "repairable",
    issueCode: "malformed_json",
    issueSummary: "valid after removing a leading UTF-8 BOM",
    proposedAction: "repair_bom",
    actionPerformed,
    backupPath,
    quarantinePath: null,
    repairedBytesRemoved: input.removedChars
  };
}

async function maybeQuarantine(input: {
  moduleName: string;
  runId: string;
  command: string | null;
  runDir: string;
  outputPath: string;
  status: ScanStatus;
  issueCode: IssueCode | null;
  issueSummary: string;
  proposedAction: ProposedAction;
  rootDir: string;
  quarantineDir: string;
  apply: boolean;
}): Promise<RunScanEntry> {
  let quarantinePath: string | null = null;
  let actionPerformed: ProposedAction = "none";

  if (input.apply && input.proposedAction === "quarantine") {
    quarantinePath = await quarantineRunDirectory({
      moduleName: input.moduleName,
      runId: input.runId,
      runDir: input.runDir,
      quarantineDir: input.quarantineDir,
      manifest: {
        module_name: input.moduleName,
        run_id: input.runId,
        command: input.command,
        original_run_dir: input.runDir,
        original_output_path: input.outputPath,
        issue_code: input.issueCode,
        issue_summary: input.issueSummary,
        quarantined_at: new Date().toISOString()
      }
    });
    actionPerformed = "quarantine";
  }

  return {
    moduleName: input.moduleName,
    runId: input.runId,
    command: input.command,
    runDir: input.runDir,
    outputPath: input.outputPath,
    status: input.status,
    issueCode: input.issueCode,
    issueSummary: input.issueSummary,
    proposedAction: input.proposedAction,
    actionPerformed,
    backupPath: null,
    quarantinePath,
    repairedBytesRemoved: 0
  };
}

function validatePayload(payload: unknown, moduleName: string, command: string | null): ValidationResult {
  if (!isPlainObject(payload)) {
    return {
      valid: false,
      issueCode: "root_not_object",
      issueSummary: "root payload must be a JSON object"
    };
  }

  const rule = findValidationRule(moduleName, command);
  if (!rule) {
    return { valid: true, issueCode: null, issueSummary: "valid" };
  }

  const missingKeys = rule.requiredKeys.filter((key) => !(key in payload));
  if (missingKeys.length > 0) {
    return {
      valid: false,
      issueCode: "structurally_invalid",
      issueSummary: `missing required keys: ${missingKeys.join(", ")}`
    };
  }

  for (const arrayKey of rule.arrayKeys ?? []) {
    if (!Array.isArray(payload[arrayKey])) {
      return {
        valid: false,
        issueCode: "structurally_invalid",
        issueSummary: `${arrayKey} must be an array`
      };
    }
  }

  return { valid: true, issueCode: null, issueSummary: "valid" };
}

function findValidationRule(moduleName: string, command: string | null): ValidationRule | null {
  if (command) {
    for (const rule of VALIDATION_RULES) {
      if (rule.moduleName !== moduleName || !rule.commandMatch) {
        continue;
      }
      if (typeof rule.commandMatch === "string" && rule.commandMatch === command) {
        return rule;
      }
      if (rule.commandMatch instanceof RegExp && rule.commandMatch.test(command)) {
        return rule;
      }
    }
  }

  for (const rule of VALIDATION_RULES) {
    if (rule.moduleName !== moduleName) {
      continue;
    }
    if (!rule.commandMatch) {
      return rule;
    }
  }

  return null;
}

function parseRunId(runId: string): { command: string | null } {
  const parts = runId.split("__");
  if (parts.length < 3) {
    return { command: null };
  }
  return { command: parts.slice(2).join("__") || null };
}

function tryParseJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

function stripLeadingBom(text: string): string {
  return text.startsWith(UTF8_BOM) ? text.slice(1) : text;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function quarantineRunDirectory(input: {
  moduleName: string;
  runId: string;
  runDir: string;
  quarantineDir: string;
  manifest: Record<string, unknown>;
}): Promise<string> {
  const targetBase = path.join(input.quarantineDir, input.moduleName, input.runId);
  const targetDir = await ensureUniquePath(targetBase);
  await mkdir(path.dirname(targetDir), { recursive: true });
  await rename(input.runDir, targetDir);
  await writeFile(path.join(targetDir, "cleanup-quarantine.json"), JSON.stringify(input.manifest, null, 2), "utf8");
  return targetDir;
}

async function createBackup(outputPath: string, label: string): Promise<string> {
  const backupPath = await ensureUniquePath(`${outputPath}.${label}`);
  await copyFile(outputPath, backupPath, fsConstants.COPYFILE_EXCL);
  return backupPath;
}

async function ensureUniquePath(basePath: string): Promise<string> {
  if (!(await exists(basePath))) {
    return basePath;
  }

  let suffix = 1;
  while (await exists(`${basePath}.${suffix}`)) {
    suffix += 1;
  }
  return `${basePath}.${suffix}`;
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

function parseCliArgs(argv: string[]): ScanOptions & { json: boolean; failOnFindings: boolean } {
  const options: ScanOptions & { json: boolean; failOnFindings: boolean } = {
    apply: false,
    json: false,
    failOnFindings: false,
    moduleNames: []
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") {
      options.apply = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--fail-on-findings") {
      options.failOnFindings = true;
      continue;
    }
    if (arg === "--root-dir") {
      options.rootDir = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--quarantine-dir") {
      options.quarantineDir = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--module") {
      options.moduleNames?.push(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printHelp(): void {
  console.log([
    "Usage: node dist/merge/logic/cleanup-historical-results.js [options]",
    "",
    "Options:",
    "  --root-dir <path>         Result root to scan (default: merge/result)",
    "  --quarantine-dir <path>   Where invalid runs should be moved during --apply",
    "  --module <name>           Limit scan to a specific module directory; repeatable",
    "  --apply                   Perform safe BOM repair and quarantine invalid runs",
    "  --json                    Print the full summary as JSON",
    "  --fail-on-findings        Exit with code 1 if repairable or invalid runs are found",
    "  --help                    Show this help text"
  ].join("\n"));
}

function printHumanSummary(summary: ScanSummary): void {
  console.log(`Historical result scan at ${summary.scannedAt}`);
  console.log(`root: ${summary.rootDir}`);
  console.log(`quarantine: ${summary.quarantineDir}`);
  console.log(`runs scanned: ${summary.scannedRunCount}`);
  console.log(`valid: ${summary.validCount}`);
  console.log(`repairable: ${summary.repairableCount}`);
  console.log(`invalid: ${summary.invalidCount}`);
  console.log(`repaired: ${summary.repairedCount}`);
  console.log(`quarantined: ${summary.quarantinedCount}`);

  const findings = summary.entries.filter((entry) => entry.status !== "valid");
  if (findings.length === 0) {
    console.log("No findings.");
    return;
  }

  console.log("");
  for (const entry of findings) {
    const actionSuffix = entry.actionPerformed !== "none"
      ? ` | applied=${entry.actionPerformed}`
      : ` | proposed=${entry.proposedAction}`;
    console.log(`- ${entry.moduleName}/${entry.runId}: ${entry.issueSummary}${actionSuffix}`);
  }
}

async function main(): Promise<void> {
  const cliOptions = parseCliArgs(process.argv.slice(2));
  const summary = await scanHistoricalResultOutputs(cliOptions);

  if (cliOptions.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    printHumanSummary(summary);
  }

  if (cliOptions.failOnFindings && (summary.repairableCount > 0 || summary.invalidCount > 0)) {
    process.exitCode = 1;
  }
}

const executedAsScript = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (executedAsScript) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
