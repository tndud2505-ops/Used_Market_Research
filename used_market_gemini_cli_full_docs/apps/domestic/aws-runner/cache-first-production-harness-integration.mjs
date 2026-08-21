import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import {
  prepareRestartProbe,
  resumeRestartProbe,
  runProductionCheck
} from "./cache-first-production-harness.mjs";
import { SearchIndex } from "./search-index.mjs";

const workspace = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const tempDir = mkdtempSync(path.join(os.tmpdir(), "used-market-production-harness-"));
const indexPath = path.join(tempDir, "search.sqlite");
const restartProbeFile = path.join(tempDir, "restart-probe.json");
const token = "local-production-harness-token";
const keyword = "\uC544\uC774\uD3F0 15";
let child = null;
let stdout = "";
let stderr = "";

try {
  seedIndex(indexPath);
  const port = await availablePort();
  const sharedEnvironment = {
    ...process.env,
    RUNNER_PORT: String(port),
    RUNNER_TOKEN: token,
    CLOUDFLARE_RUNNER_TOKEN: token,
    RUNNER_INDEX_MODE: "cache_first",
    RUNNER_INDEX_DIR: tempDir,
    RUNNER_INDEX_PATH: indexPath,
    RUNNER_CURSOR_SECRET: "local-production-harness-cursor-secret",
    D1_IMPORT_URL: "",
    CLOUDFLARE_MANUAL_RUN_TOKEN: ""
  };
  Object.assign(process.env, {
    RUNNER_BASE_URL: `http://127.0.0.1:${port}`,
    RUNNER_TOKEN: token,
    SEARCH_KEYWORD: keyword,
    SEARCH_CATEGORY_ID: "mobile",
    SEARCH_SITES: "bunjang,joonggonara",
    SEARCH_LIMIT: "30",
    SEARCH_SITE_WINDOW: "160",
    RUNNER_HTTP_TIMEOUT_MS: "10000",
    REQUIRE_REFRESH_TOKEN: "false",
    RESTART_PROBE_FILE: restartProbeFile
  });

  child = startRunner(sharedEnvironment);
  await waitForHealth(port, child);
  const check = await runProductionCheck();
  assert.equal(check.status, "passed");
  assert.equal(check.runtime.mode, "cache_first");
  assert.equal(check.first_page.returned, 30);
  assert.equal(check.first_page.available, 65);
  assert.equal(check.first_page.cursor_kind, "index:v2");
  assert.equal(check.repeated_page.same_order, true);
  assert.equal(check.continuation.overlap, 0);
  assert.equal(check.mismatched_cursor_rejected, true);
  assert.equal(check.db_only.index_page_reads >= 5, true);
  assert.equal(check.db_only.live_collection_runs, 0);
  assert.equal(check.db_only.source_collection_attempts, 0);
  assert.equal(check.db_only.index_ingest_commits, 0);

  const descendingResponse = await fetch(`http://127.0.0.1:${port}/api/search`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      keyword,
      category_id: "mobile",
      sites: ["bunjang", "joonggonara"],
      sort: "price_desc",
      limit: 30,
      refresh_index: false
    })
  });
  const descendingPayload = await descendingResponse.json();
  assert.equal(descendingResponse.status, 200);
  assert.equal(descendingPayload.data.items.length, 30);
  assert.equal(descendingPayload.data.items[0].price, 365_000);
  assert.equal(descendingPayload.data.items.at(-1).price, 336_000);
  assert.equal(descendingPayload.data.quality.execution.live_collection_runs, 0);
  assert.equal(descendingPayload.data.quality.execution.source_collection_attempts, 0);
  assert.equal(descendingPayload.data.quality.execution.index_ingest_commits, 0);

  const staleResponse = await fetch(`http://127.0.0.1:${port}/api/search`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      keyword: "stale phone",
      category_id: "mobile",
      sites: ["bunjang", "joonggonara"],
      sort: "recommended",
      limit: 30,
      refresh_index: false
    })
  });
  const stalePayload = await staleResponse.json();
  assert.equal(staleResponse.status, 200);
  assert.equal(stalePayload.data.freshness.mode, "stale");
  assert.equal(stalePayload.data.items.length, 30);
  assert.equal(stalePayload.data.quality.execution.live_collection_runs, 0);
  assert.equal(stalePayload.data.quality.execution.source_collection_attempts, 0);

  const prepared = await prepareRestartProbe();
  assert.equal(prepared.status, "prepared");
  assert.equal(prepared.process_instance_recorded, true);
  const firstProcess = child;
  child = null;
  await stopRunner(firstProcess);

  child = startRunner(sharedEnvironment);
  await waitForHealth(port, child);
  const resumed = await resumeRestartProbe();
  assert.equal(resumed.status, "passed_after_restart");
  assert.equal(resumed.overlap, 0);

  const backgroundResponse = await fetch(`http://127.0.0.1:${port}/api/search`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      keyword: "stale phone",
      category_id: "mobile",
      sites: ["bunjang", "joonggonara"],
      sort: "recommended",
      limit: 30,
      refresh_index: true
    }),
    signal: AbortSignal.timeout(2_000)
  });
  const backgroundPayload = await backgroundResponse.json();
  assert.equal(backgroundResponse.status, 200);
  assert.equal(backgroundPayload.data.freshness.mode, "stale");
  assert.match(backgroundPayload.data.freshness.refresh_state, /^(?:queued|running)$/u);
  assert.match(backgroundPayload.data.freshness.refresh_token, /^[A-Za-z0-9-]{20,100}$/u);

  console.log(JSON.stringify({
    status: "passed",
    checks: 32,
    first_count: check.first_page.returned,
    available_count: check.first_page.available,
    cursor_kind: check.first_page.cursor_kind,
    db_only_index_reads: check.db_only.index_page_reads,
    db_only_live_runs: check.db_only.live_collection_runs,
    continuation_overlap: check.continuation.overlap,
    restart_overlap: resumed.overlap,
    snapshot_version: resumed.snapshot_version
  }, null, 2));
} catch (error) {
  const diagnostic = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n").slice(-2_000);
  if (diagnostic) console.error(diagnostic);
  throw error;
} finally {
  if (child) await stopRunner(child);
  const resolvedTemp = path.resolve(tempDir);
  const systemTemp = `${path.resolve(os.tmpdir())}${path.sep}`;
  if (resolvedTemp.startsWith(systemTemp)) rmSync(resolvedTemp, { recursive: true, force: true });
}

function seedIndex(filePath) {
  const index = new SearchIndex({ filePath, backupDir: path.join(path.dirname(filePath), "backups") });
  try {
    const request = {
      keyword,
      category_id: "mobile",
      sites: ["bunjang", "joonggonara"],
      sort: "recommended"
    };
    const now = Date.now();
    const items = Array.from({ length: 65 }, (_, offset) => {
      const number = offset + 1;
      const id = `fixture-${String(number).padStart(3, "0")}`;
      return {
        id,
        site: number % 2 ? "bunjang" : "joonggonara",
        category_id: "mobile",
        title: `iPhone 15 ${number}`,
        price: 300_000 + number * 1_000,
        currency: "KRW",
        url: `https://example.test/${id}`,
        image_url: number % 4 ? `https://example.test/${id}.jpg` : null,
        posted_at: new Date(now - number * 60_000).toISOString()
      };
    });
    index.registerQuery(request);
    index.ingest(request, items, {
      deep: true,
      complete: true,
      successfulSites: ["bunjang", "joonggonara"]
    });

    const staleRequest = {
      keyword: "stale phone",
      category_id: "mobile",
      sites: ["bunjang", "joonggonara"],
      sort: "recommended"
    };
    index.registerQuery(staleRequest);
    const staleIngest = index.ingest(staleRequest, items.map((entry, offset) => ({
      ...entry,
      id: `stale-${offset + 1}`,
      title: `stale phone ${offset + 1}`,
      url: `https://example.test/stale-${offset + 1}`
    })), {
      deep: true,
      complete: true,
      successfulSites: ["bunjang", "joonggonara"]
    });
    index.db.prepare("UPDATE query_index SET last_refreshed_at = ? WHERE query_key = ?")
      .run(new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString(), staleIngest.queryKey);
  } finally {
    index.close();
  }
}

function startRunner(environment) {
  stdout = "";
  stderr = "";
  const processHandle = spawn(process.execPath, ["aws-runner/runner.mjs"], {
    cwd: workspace,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  processHandle.stdout.setEncoding("utf8");
  processHandle.stderr.setEncoding("utf8");
  processHandle.stdout.on("data", (chunk) => { stdout = `${stdout}${chunk}`.slice(-8_000); });
  processHandle.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-8_000); });
  return processHandle;
}

async function stopRunner(processHandle) {
  if (!processHandle || processHandle.exitCode !== null) return;
  processHandle.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => processHandle.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000))
  ]);
  if (processHandle.exitCode === null) processHandle.kill("SIGKILL");
}

async function waitForHealth(port, processHandle) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (processHandle.exitCode !== null) throw new Error(`temporary runner exited with ${processHandle.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("temporary runner did not become healthy");
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}
