import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { setDefaultResultOrder } from "node:dns";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("./", import.meta.url));
const CONFIG = "wrangler.jsonc";
const RUNNER_ORIGIN = "https://global-runner.used-pick.com";
const WRANGLER_PACKAGE = process.env.CLOUDFLARE_WRANGLER_PACKAGE?.trim() || "wrangler@4.124.0";

setDefaultResultOrder("ipv4first");

function commandName(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

function run(label, args, options = {}) {
  return new Promise((resolve, reject) => {
    console.log(`\n[global-deploy] ${label}`);
    const child = spawn(commandName("npx"), ["--yes", "--package", WRANGLER_PACKAGE, "wrangler", ...args], {
      cwd: ROOT,
      stdio: options.input ? ["pipe", "inherit", "inherit"] : "inherit",
      shell: process.platform === "win32"
    });
    if (options.input) {
      child.stdin.end(options.input);
    }
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} failed${signal ? ` (${signal})` : ` with exit code ${code ?? 1}`}`));
    });
  });
}

async function preflight(runnerToken) {
  const config = await readFile(new URL(CONFIG, import.meta.url), "utf8");
  if (!config.includes('"name": "used-market-global"')) throw new Error("Worker config must target used-market-global");
  if (!config.includes('"database_name": "used-market-global-free"')) throw new Error("D1 config must target used-market-global-free");
  if (!config.includes('"pattern": "global.used-pick.com"')) throw new Error("Custom domain must be global.used-pick.com");
  if (!config.includes(`"RUNNER_URL": "${RUNNER_ORIGIN}"`)) throw new Error("Runner origin does not match the global deployment boundary");
  if (config.includes("00000000-0000-0000-0000-000000000000")) {
    throw new Error("Replace the placeholder D1 database_id before deployment");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), runnerToken ? 70_000 : 10_000);
  try {
    const health = await fetch(`${RUNNER_ORIGIN}/global/health`, {
      headers: { accept: "application/json", "x-used-market-app": "global" },
      signal: controller.signal
    });
    if (!health.ok) throw new Error(`HTTP_${health.status}`);
    if (runnerToken) {
      const authHeaders = { accept: "application/json", authorization: `Bearer ${runnerToken}`, "x-used-market-app": "global" };
      const categories = await fetch(`${RUNNER_ORIGIN}/global/api/categories`, { headers: authHeaders, signal: controller.signal });
      if (!categories.ok) throw new Error(`RUNNER_TOKEN categories preflight returned HTTP_${categories.status}`);
      const search = await fetch(`${RUNNER_ORIGIN}/global/api/search`, {
        method: "POST",
        headers: { ...authHeaders, "content-type": "application/json" },
        body: JSON.stringify({ keyword: "iphone 13", sites: ["rakuma"], sort: "recommended", limit: 1 }),
        signal: controller.signal
      });
      const payload = search.ok ? await search.json() : null;
      const source = payload?.data?.sources?.find((entry) => entry?.key === "rakuma");
      if (!search.ok || payload?.status !== "success" || source?.status !== "ready" || !payload?.data?.items?.length) {
        throw new Error(`RUNNER_TOKEN search preflight failed${search.ok ? "" : ` with HTTP_${search.status}`}`);
      }
    }
  } finally {
    clearTimeout(timeout);
  }
}

try {
  const runnerToken = process.env.RUNNER_TOKEN?.trim();
  await preflight(runnerToken);
  await run("Validate Worker bundle", ["deploy", "--dry-run", "--config", CONFIG]);
  if (runnerToken) {
    await run("Install independent RUNNER_TOKEN secret", ["secret", "put", "RUNNER_TOKEN", "--config", CONFIG], { input: `${runnerToken}\n` });
  } else {
    console.log("[global-deploy] RUNNER_TOKEN was not provided locally; preserving the existing Worker secret.");
  }
  await run("Deploy global Worker", ["deploy", "--config", CONFIG, "--keep-vars"]);
} catch (error) {
  console.error(`[global-deploy] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
