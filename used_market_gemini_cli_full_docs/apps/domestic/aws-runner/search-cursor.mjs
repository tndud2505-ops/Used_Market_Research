import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const CURSOR_PREFIX = "index:v2:";

function fingerprint(value) {
  return createHash("sha256").update(String(value || "")).digest("base64url").slice(0, 20);
}

function signature(payload, secret) {
  return createHmac("sha256", String(secret || ""))
    .update(payload)
    .digest("base64url")
    .slice(0, 24);
}

function signaturesMatch(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function encodeSearchCursor({ cacheKey, sort, snapshotVersion, after }, secret) {
  if (!Number.isSafeInteger(snapshotVersion) || snapshotVersion < 1) {
    throw new Error("CURSOR_INVALID: snapshot version is required");
  }
  if (!after || typeof after !== "object" || Array.isArray(after)) {
    throw new Error("CURSOR_INVALID: continuation key is required");
  }
  const payload = Buffer.from(JSON.stringify({
    version: 2,
    query: fingerprint(cacheKey),
    sort: String(sort || "recommended"),
    snapshotVersion,
    after
  })).toString("base64url");
  return `${CURSOR_PREFIX}${payload}.${signature(payload, secret)}`;
}

export function decodeSearchCursor(cursor, { cacheKey, sort, secret }) {
  const match = typeof cursor === "string"
    ? cursor.match(/^index:v2:([A-Za-z0-9_-]{1,2000})\.([A-Za-z0-9_-]{24})$/)
    : null;
  if (!match) throw new Error("CURSOR_INVALID: cursor format is invalid");
  if (!signaturesMatch(signature(match[1], secret), match[2])) {
    throw new Error("CURSOR_INVALID: cursor signature is invalid");
  }
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(match[1], "base64url").toString("utf8"));
  } catch {
    throw new Error("CURSOR_INVALID: cursor payload is invalid");
  }
  if (
    parsed?.version !== 2
    || parsed?.query !== fingerprint(cacheKey)
    || parsed?.sort !== String(sort || "recommended")
  ) {
    throw new Error("CURSOR_INVALID: cursor does not match the current search");
  }
  if (!Number.isSafeInteger(parsed.snapshotVersion) || parsed.snapshotVersion < 1) {
    throw new Error("CURSOR_INVALID: snapshot version is invalid");
  }
  if (!parsed.after || typeof parsed.after !== "object" || Array.isArray(parsed.after)) {
    throw new Error("CURSOR_INVALID: continuation key is invalid");
  }
  return {
    snapshotVersion: parsed.snapshotVersion,
    after: parsed.after
  };
}

export const SEARCH_CURSOR_VERSION = 2;
