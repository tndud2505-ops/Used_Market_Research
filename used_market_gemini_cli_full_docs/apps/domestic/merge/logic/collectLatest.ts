import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export async function collectLatestModuleRuns(baseDir = path.resolve(process.cwd(), "merge/result")) {
  const modules = await safeList(baseDir);
  const result: Record<string, unknown> = {};

  for (const moduleName of modules) {
    const moduleDir = path.join(baseDir, moduleName);
    const runs = (await safeList(moduleDir)).sort().reverse();
    const latest = runs[0];
    if (!latest) continue;
    const outputPath = path.join(moduleDir, latest, "output.json");
    try {
      result[moduleName] = JSON.parse(await readFile(outputPath, "utf-8"));
    } catch {
      result[moduleName] = { error: "latest output missing or invalid" };
    }
  }

  return result;
}

async function safeList(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}
