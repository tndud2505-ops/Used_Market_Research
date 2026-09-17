import {
  statsChecksum,
  statsChunkManifestChecksum,
  statsPublicationBoundaryKey,
  statsPublicationKey
} from "../cloudflare/public-product-stats.mjs";

const MAX_RESPONSE_BYTES = 1_048_576;
const CHUNK_ROW_COUNT = 40;

function redactDiagnostic(value, token = "", maximum = 1200) {
  let text = String(value ?? "");
  // Redact before truncating so that a secret at the boundary is not leaked.
  for (const secret of [token, token ? encodeURIComponent(token) : ""]) {
    if (secret) text = text.split(secret).join("[REDACTED]");
  }
  return text
    .replace(/\bBearer\s+[^\s"'<>]+/giu, "Bearer [REDACTED]")
    .replace(/(["']?(?:authorization|(?:access[_-]?|refresh[_-]?|api[_-]?|import[_-]?)?token|secret|password|api[_-]?key)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s<>&,;]+)/giu, "$1[REDACTED]")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu, " ")
    .slice(0, maximum);
}

async function readBoundedResponse(response) {
  if (!response.body) return { text: "", bytes: 0, truncated: false };
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = MAX_RESPONSE_BYTES - bytes;
      if (value.byteLength > remaining) {
        chunks.push(value.slice(0, remaining));
        bytes += remaining;
        truncated = true;
        await reader.cancel().catch(() => {});
        break;
      }
      chunks.push(value);
      bytes += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  return { text: Buffer.concat(chunks, bytes).toString("utf8"), bytes, truncated };
}

function diagnosticError(code, diagnostics) {
  const error = new Error(`${code}: ${JSON.stringify(diagnostics)}`);
  error.code = code;
  error.diagnostics = diagnostics;
  return error;
}

function nonEmptyScopeCount(rows) {
  return rows.filter((row) => {
    const stats = typeof row.stats_json === "string" ? JSON.parse(row.stats_json) : row.stats_json;
    return Number(stats?.active?.sample_count || 0) + Number(stats?.reserved?.sample_count || 0)
      + Number(stats?.sold?.sample_count || 0) + Number(stats?.confirmed_transactions?.sample_count || 0) > 0;
  }).length;
}

async function requestStatsJson(url, token, payload, timeoutMs, method = "POST") {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const endpoint = new URL(url).pathname;
  let response;
  try {
    response = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json"
    },
    body: method === "GET" ? undefined : JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
    // Never follow an admin redirect or automatically retry a denied request.
    redirect: "manual"
    });
  } catch (error) {
    throw diagnosticError("D1_STATS_IMPORT_TRANSPORT_FAILED", {
      endpoint, started_at: startedAt, elapsed_ms: Math.round(performance.now() - started),
      error_name: redactDiagnostic(error?.name || "Error", token, 80)
    });
  }
  let body;
  try { body = await readBoundedResponse(response); } catch (error) {
    throw diagnosticError("D1_STATS_IMPORT_RESPONSE_READ_FAILED", {
      endpoint, started_at: startedAt, status: response.status,
      elapsed_ms: Math.round(performance.now() - started),
      error_name: redactDiagnostic(error?.name || "Error", token, 80)
    });
  }
  const { text } = body;
  let result = null;
  try { result = JSON.parse(text); } catch {}
  if (body.truncated || !response.ok || result?.ok !== true) {
    throw diagnosticError(body.truncated ? "D1_STATS_IMPORT_RESPONSE_TOO_LARGE" : `D1_STATS_IMPORT_HTTP_${response.status}`, {
      endpoint, started_at: startedAt, status: response.status,
      content_type: redactDiagnostic(response.headers.get("content-type"), token, 160),
      cf_ray: redactDiagnostic(response.headers.get("cf-ray"), token, 160),
      request_id: redactDiagnostic(response.headers.get("x-request-id") || response.headers.get("cf-request-id"), token, 160),
      elapsed_ms: Math.round(performance.now() - started),
      response_bytes_read: body.bytes, response_truncated: body.truncated,
      body_excerpt: redactDiagnostic(text, token)
    });
  }
  return result;
}

export function postStatsJson(url, token, payload, timeoutMs) {
  return requestStatsJson(url, token, payload, timeoutMs);
}

export async function readActiveStatsScopes({ importUrl, token, timeoutMs = 30_000 }) {
  const url = new URL(importUrl);
  url.pathname = "/admin/product-stats-scopes";
  url.search = "";
  url.hash = "";
  const result = await requestStatsJson(url, token, null, timeoutMs, "GET");
  const proof = result.external_active;
  if (!proof || !Array.isArray(proof.scopes) || !Number.isSafeInteger(proof.row_count)
    || proof.row_count !== proof.scopes.length
    || !Number.isFinite(Date.parse(proof.checked_at))) {
    throw new Error("D1_STATS_ACTIVE_SCOPE_PROOF_INVALID");
  }
  return proof;
}

export async function publishStatsInChunks({ importUrl, token, publication, timeoutMs, onProgress = null }) {
  const rows = [...publication.rows].sort((left, right) => (
    statsPublicationKey(left).localeCompare(statsPublicationKey(right))
  ));
  const expectedChunkCount = Math.ceil(rows.length / CHUNK_ROW_COUNT);
  const common = {
    publication_id: publication.publication_id,
    checksum: publication.checksum,
    expected_row_count: publication.expected_row_count,
    expected_non_empty_scope_count: publication.expected_non_empty_scope_count,
    normalization_version: publication.normalization_version,
    parser_version: publication.parser_version,
    rule_version: publication.rule_version,
    filter_version: publication.filter_version,
    created_at: publication.created_at,
    ...(publication.expected_previous_publication
      ? { expected_previous_publication: publication.expected_previous_publication } : {}),
    merge_with_active: false
  };
  const descriptors = [];
  const stageUrl = new URL(importUrl);
  stageUrl.pathname = "/admin/stage-product-stats";
  for (let offset = 0; offset < rows.length; offset += CHUNK_ROW_COUNT) {
    const chunkRows = rows.slice(offset, offset + CHUNK_ROW_COUNT);
    const chunkIndex = Math.floor(offset / CHUNK_ROW_COUNT);
    const descriptor = {
      chunk_index: chunkIndex,
      expected_chunk_count: expectedChunkCount,
      chunk_checksum: await statsChecksum(chunkRows),
      row_count: chunkRows.length,
      non_empty_scope_count: nonEmptyScopeCount(chunkRows),
      first_scope_key: statsPublicationBoundaryKey(chunkRows[0]),
      last_scope_key: statsPublicationBoundaryKey(chunkRows.at(-1))
    };
    descriptors.push(descriptor);
    const result = await postStatsJson(stageUrl, token, {
      ...common,
      ...descriptor,
      chunk_row_count: descriptor.row_count,
      chunk_non_empty_scope_count: descriptor.non_empty_scope_count,
      rows: chunkRows
    }, timeoutMs);
    if (result?.chunk?.publication_id !== publication.publication_id
      || Number(result?.chunk?.chunk_index) !== chunkIndex) {
      throw new Error("D1_STATS_CHUNK_ACKNOWLEDGEMENT_MISMATCH");
    }
    if (typeof onProgress === "function") onProgress({ staged: chunkIndex + 1, total: expectedChunkCount });
  }
  const activateUrl = new URL(importUrl);
  activateUrl.pathname = "/admin/activate-product-stats";
  const result = await postStatsJson(activateUrl, token, {
    ...common,
    expected_chunk_count: expectedChunkCount,
    chunk_manifest_checksum: await statsChunkManifestChecksum(descriptors),
    ...(publication.sample_drop_acknowledgement
      ? { sample_drop_acknowledgement: publication.sample_drop_acknowledgement } : {}),
    ...(publication.scope_schema_migration
      ? { scope_schema_migration: publication.scope_schema_migration } : {})
  }, timeoutMs);
  return result.publication;
}
