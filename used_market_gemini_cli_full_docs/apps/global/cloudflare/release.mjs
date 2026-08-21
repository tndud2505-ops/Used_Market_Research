import { spawn } from "node:child_process";
import { setDefaultResultOrder } from "node:dns";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("./", import.meta.url));
const PUBLIC_URL = (process.env.CLOUDFLARE_GLOBAL_PUBLIC_URL || "https://global.used-pick.com").replace(/\/$/, "");
const ATTEMPTS = 12;
const RETRY_DELAY_MS = 2500;
const WRANGLER_PACKAGE = process.env.CLOUDFLARE_WRANGLER_PACKAGE?.trim() || "wrangler@4.124.0";

setDefaultResultOrder("ipv4first");

function executable(name) {
  return process.platform === "win32" && (name === "npm" || name === "npx") ? `${name}.cmd` : name;
}

function run(label, command, args) {
  return new Promise((resolve, reject) => {
    console.log(`\n[global-release] ${label}`);
    const child = spawn(executable(command), args, {
      cwd: ROOT,
      stdio: "inherit",
      shell: process.platform === "win32"
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} failed${signal ? ` (${signal})` : ` with exit code ${code ?? 1}`}`));
    });
  });
}

function capture(label, command, args) {
  return new Promise((resolve, reject) => {
    console.log(`\n[global-release] ${label}`);
    const child = spawn(executable(command), args, {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "inherit"],
      shell: process.platform === "win32"
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve(output);
      else reject(new Error(`${label} failed${signal ? ` (${signal})` : ` with exit code ${code ?? 1}`}`));
    });
  });
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function publicSmoke() {
  const healthResponse = await fetch(`${PUBLIC_URL}/global/api/health`, { headers: { accept: "application/json" } });
  if (!healthResponse.ok) throw new Error(`health returned HTTP ${healthResponse.status}`);
  const health = await healthResponse.json();
  if (health.ok !== true || health.app !== "global" || health.storage !== "d1") throw new Error("health returned an invalid global runtime contract");
  if (health.origin?.configured !== true || health.origin?.available !== true) throw new Error("global runner origin is not available");

  const homeResponse = await fetch(`${PUBLIC_URL}/global/?country=jp&release_check=${Date.now()}`);
  if (!homeResponse.ok) throw new Error(`home returned HTTP ${homeResponse.status}`);
  const home = await homeResponse.text();
  if (!home.includes("Global Used Listings Search") || !home.includes("United States") || home.includes("번개장터")) throw new Error("home did not return the retained English global shell");

  const categoriesResponse = await fetch(`${PUBLIC_URL}/global/api/categories`, { headers: { accept: "application/json" } });
  if (!categoriesResponse.ok) throw new Error(`categories returned HTTP ${categoriesResponse.status}`);
  const categories = await categoriesResponse.json();
  if (categories.status !== "success" || !Array.isArray(categories.data?.categories) || categories.data.categories.length < 8) {
    throw new Error("categories returned an invalid global catalog");
  }

  const searchResponse = await fetch(`${PUBLIC_URL}/global/api/search`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ keyword: "iphone 13", sites: ["rakuma"], sort: "recommended", limit: 1 })
  });
  if (!searchResponse.ok) throw new Error(`search returned HTTP ${searchResponse.status}`);
  const search = await searchResponse.json();
  const rakumaSource = search.data?.sources?.find((source) => source?.key === "rakuma");
  if (search.status !== "success" || rakumaSource?.status !== "ready" || rakumaSource?.collection_state !== "ready" || !Array.isArray(search.data?.items) || search.data.items.length < 1 || search.data.items.some((item) => item.site !== "rakuma")) {
    throw new Error("search violated the global marketplace boundary");
  }

  return {
    url: PUBLIC_URL,
    health: true,
    origin_available: true,
    category_count: categories.data.categories.length,
    search_source: searchResponse.headers.get("x-global-search-source"),
    search_items: search.data.items.length
  };
}

async function verifyWithRetries() {
  let lastError;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      return await publicSmoke();
    } catch (error) {
      lastError = error;
      if (attempt < ATTEMPTS) {
        console.log(`[global-release] Public smoke retry ${attempt}/${ATTEMPTS - 1}: ${error instanceof Error ? error.message : String(error)}`);
        await wait(RETRY_DELAY_MS);
      }
    }
  }
  throw lastError;
}

async function assertProvisionedConfig() {
  const config = await readFile(new URL("wrangler.jsonc", import.meta.url), "utf8");
  if (config.includes("00000000-0000-0000-0000-000000000000")) {
    throw new Error("Replace the placeholder global D1 database_id before release");
  }
  if (!config.includes('"database_name": "used-market-global-free"')) {
    throw new Error("Release config does not target used-market-global-free");
  }
}

let previousVersionId = "";
let deploymentStarted = false;

try {
  await assertProvisionedConfig();
  await run("Run independent global harness", "node", ["harness.mjs"]);
  await run("Validate global Worker with --dry-run", "npx", ["--yes", "--package", WRANGLER_PACKAGE, "wrangler", "deploy", "--dry-run", "--config", "wrangler.jsonc"]);
  await run("Apply global D1 migrations", "npx", ["--yes", "--package", WRANGLER_PACKAGE, "wrangler", "d1", "migrations", "apply", "used-market-global-free", "--remote", "--config", "wrangler.jsonc"]);
  const deploymentsJson = await capture("Capture current Worker version for rollback", "npx", ["--yes", "--package", WRANGLER_PACKAGE, "wrangler", "deployments", "list", "--json", "--config", "wrangler.jsonc"]);
  const deployments = JSON.parse(deploymentsJson);
  const current = Array.isArray(deployments) ? deployments.toSorted((left, right) => String(left.created_on).localeCompare(String(right.created_on))).at(-1) : null;
  previousVersionId = current?.versions?.find((version) => version?.percentage === 100)?.version_id || "";
  if (!previousVersionId) throw new Error("Could not capture the current Worker version for rollback");
  deploymentStarted = true;
  await run("Deploy global Worker", "node", ["deploy.mjs"]);
  console.log("\n[global-release] Verify public health, home, categories, and search");
  const result = await verifyWithRetries();
  console.log(JSON.stringify({ status: "released", result }, null, 2));
} catch (error) {
  const originalMessage = error instanceof Error ? error.message : String(error);
  if (deploymentStarted && previousVersionId) {
    try {
      await run("Rollback failed release", "npx", ["--yes", "--package", WRANGLER_PACKAGE, "wrangler", "rollback", previousVersionId, "--yes", "--message", "Automatic rollback after global release smoke failure", "--config", "wrangler.jsonc"]);
      await verifyWithRetries();
      console.error(`[global-release] ${originalMessage}; rolled back to the previously verified Worker version`);
    } catch (rollbackError) {
      console.error(`[global-release] ${originalMessage}; automatic rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
    }
  } else {
    console.error(`[global-release] ${originalMessage}`);
  }
  process.exitCode = 1;
}
