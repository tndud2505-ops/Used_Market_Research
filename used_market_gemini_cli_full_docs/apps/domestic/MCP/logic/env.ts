import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function stripWrappingQuotes(value: string) {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === "\"" && last === "\"") || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }

  return value;
}

function collectAncestorDirs(startDir: string) {
  const dirs: string[] = [];
  let current = path.resolve(startDir);

  while (true) {
    dirs.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return dirs;
}

function getModuleProjectRoot() {
  const currentFilePath = fileURLToPath(import.meta.url);
  for (const dir of collectAncestorDirs(path.dirname(currentFilePath))) {
    if (fs.existsSync(path.join(dir, "package.json"))) {
      return dir;
    }
  }

  return path.resolve(path.dirname(currentFilePath), "..", "..", "..");
}

function findEnvPath(searchStartDir: string) {
  const candidateDirs = [
    ...collectAncestorDirs(searchStartDir),
    getModuleProjectRoot()
  ];
  const seen = new Set<string>();

  for (const dir of candidateDirs) {
    const normalized = path.resolve(dir);
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    const envPath = path.join(normalized, ".env");
    if (fs.existsSync(envPath)) {
      return envPath;
    }
  }

  return null;
}

export function loadProjectEnv(cwd = process.cwd()) {
  const envPath = findEnvPath(cwd);
  if (!envPath) return;

  const content = fs.readFileSync(envPath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = line.slice(0, separatorIndex).trim();
    const value = stripWrappingQuotes(line.slice(separatorIndex + 1).trim());

    if (!key || process.env[key] !== undefined) continue;
    process.env[key] = value;
  }
}
