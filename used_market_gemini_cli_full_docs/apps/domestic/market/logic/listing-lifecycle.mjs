export function joongnaListingUrl({url,sourceListingId} = {}) {
  const stable = String(sourceListingId || '').replace(/^joonggonara:/u,'');
  const stableId = stable.match(/^(?:https:\/\/web\.joongna\.com\/product\/)?(\d+)\/?(?:[?#].*)?$/u)?.[1];
  const urlId = String(url || '').match(/^https:\/\/(?:web\.)?joongna\.com\/product\/(\d+)\/?(?:[?#].*)?$/u)?.[1];
  if (stableId && urlId && stableId !== urlId) return null;
  const id = stableId || urlId;
  return id ? `https://web.joongna.com/product/${id}` : null;
}

export function isPartialSaleText(value) {
  const text = String(value || "").normalize("NFKC");
  return /(?:(?:\d+|한|하나|두|둘|세|셋|네|넷)\s*(?:개|장|매)\s*중\s*(?:\d+|한|하나|두|둘|세|셋|네|넷)\s*(?:개|장|매)?\s*(?:만\s*)?판매\s*완료|남은\s*(?:\d+|한|하나|두|둘|세|셋|네|넷)\s*(?:개|장|매)\s*판매|일부\s*판매\s*완료)/iu.test(text);
}

export function explicitSoldText(value) {
  const text = String(value || "").normalize("NFKC");
  if (isPartialSaleText(text)) return null;
  if (/(?:미판매\s*완료|판매\s*완료|거래\s*완료|sold(?:\s*out)?).{0,12}(?:아님|아닙니다|아니며|오류|잘못|취소)/iu.test(text)) return null;
  if (/(?:아직|현재|당분간).{0,12}(?:판매\s*완료|거래\s*완료|sold(?:\s*out)?).{0,8}(?:아님|아닙니다|아니)/iu.test(text)) return null;
  if (/(?:미판매\s*완료)/iu.test(text)) return null;
  if (/(?:판매\s*완료|거래\s*완료)\s*(?:되면|하면|시|후|예정|처리\s*예정)/iu.test(text)) return null;
  if (/(?:판매\s*완료|거래\s*완료).{0,20}(?:삭제|내립니다|내림|변경)\s*(?:예정)?/iu.test(text) && /(?:되면|하면|시|후|예정)/iu.test(text)) return null;
  return text.match(/판매\s*완료|거래\s*완료|\bsold(?:\s*out)?\b/iu)?.[0] || null;
}

function normalizedTokens(value) {
  return String(value || "").toLowerCase().match(/[a-z0-9가-힣]{3,}/gu) || [];
}

function structuredIdentityMatches(value, listing) {
  const serialized = JSON.stringify(value).toLowerCase();
  const sourceId = String(listing?.source_listing_id || "").trim().toLowerCase();
  if (sourceId.length >= 4 && serialized.includes(sourceId)) return true;
  const url = String(listing?.url || "").trim();
  if (url) {
    try {
      const pathname = new URL(url).pathname.toLowerCase();
      if (pathname.length >= 5 && serialized.includes(pathname)) return true;
    } catch {}
  }
  const titleTokens = normalizedTokens(listing?.title).slice(0, 6);
  return titleTokens.length >= 2 && titleTokens.filter((token) => serialized.includes(token)).length >= 2;
}

export function structuredSoldEvidenceFromHtml(html, listing) {
  for (const match of String(html || "").matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/giu)) {
    let value;
    try { value = JSON.parse(match[1]); } catch { continue; }
    const queue = [value];
    while (queue.length > 0) {
      const current = queue.shift();
      if (Array.isArray(current)) { queue.push(...current); continue; }
      if (!current || typeof current !== "object") continue;
      const availability = String(current.availability || current.offers?.availability || "");
      if (/(?:^|\/)SoldOut$/iu.test(availability) && structuredIdentityMatches(current, listing)) {
        return { type: "STRUCTURED_STATUS", value: availability };
      }
      queue.push(...Object.values(current).filter((entry) => entry && typeof entry === "object"));
    }
  }
  const primaryText = [
    String(html || "").match(/<title\b[^>]*>([\s\S]*?)<\/title>/iu)?.[1],
    String(html || "").match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/iu)?.[1]
  ].filter(Boolean).map((value) => String(value).replace(/<[^>]*>/gu, " ").replace(/\s+/gu, " ").trim()).join(" ");
  const explicit = explicitSoldText(primaryText);
  return explicit ? { type: "EXPLICIT_TEXT", value: explicit } : null;
}

// Enum-only shape of status-like fields. A value is kept only for a genuine
// status field (name ending in State/Status, or a reservation/sale flag) and
// only in code form. Other sale-related fields are reported by name only, so
// seller text, titles, prices, URLs and identifiers never reach logs.
const STATUS_FIELD_NAME = /(?:state|status)$/iu;
const STATUS_FLAG_NAME = /^(?:is)?(?:reserved|reservation|sold|soldout|onsale|forsale|selling|available|hold)$/iu;
const STATUS_HINT_NAME = /(?:reserv|sold|sale|trade|deal|avail)/iu;
const STATUS_WORDS = new Set(["success", "error", "idle", "pending", "loading", "fetching", "paused", "sale", "selling",
  "reserved", "sold", "soldout", "active", "inactive", "deleted", "hidden", "closed", "open", "complete", "completed",
  "available", "unavailable"]);
export function statusFieldToken(key, value) {
  if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/u.test(String(key))) return null;
  const code = value === null ? "null"
    : typeof value === "boolean" ? String(value)
      : typeof value === "number" && Number.isInteger(value) && Math.abs(value) <= 999 ? String(value)
        : typeof value === "string" && (/^[A-Z][A-Z0-9_]{0,23}$/u.test(value) || STATUS_WORDS.has(value)) ? value
          : null;
  if (STATUS_FLAG_NAME.test(key)) return ["true", "false", "null", "0", "1"].includes(code) ? `${key}=${code}` : key;
  if (STATUS_FIELD_NAME.test(key)) return code === null ? key : `${key}=${code}`;
  return STATUS_HINT_NAME.test(key) ? key : null;
}

export function joongnaStatusStructureTokens(html) {
  const text = String(html || "").slice(0, 1_000_000).replace(/\\"/gu, '"');
  const tokens = new Set();
  for (const match of text.matchAll(/"([A-Za-z][A-Za-z0-9_]{0,39})"\s*:\s*("[A-Za-z0-9_-]{0,24}"|-?\d{1,4}|true|false|null)(?=\s*[,}\]])/gu)) {
    const raw = match[2];
    const value = raw.startsWith('"') ? raw.slice(1, -1) : raw === "null" ? null : raw === "true" ? true : raw === "false" ? false : Number(raw);
    const token = statusFieldToken(match[1], value);
    if (!token) continue;
    tokens.add(token);
    if (tokens.size >= 40) break;
  }
  for (const match of text.matchAll(/"availability"\s*:\s*"(?:https?:\/\/schema\.org\/)?([A-Za-z]{1,40})"/gu)) {
    tokens.add(`availability=${match[1]}`);
  }
  return { tokens: [...tokens].sort(), reservedLabel: /예약\s*중/u.test(text) };
}

// Start of the JSON object that encloses index; arrays on the way are transparent.
function enclosingObjectStart(text, index, limit = 200000) {
  let depth = 0;
  for (let i = index - 1, stop = Math.max(0, index - limit); i >= stop; i -= 1) {
    const ch = text[i];
    if (ch === '"') {
      // Skip a string backwards to its opening quote.
      let j = i - 1;
      while (j >= stop && !(text[j] === '"' && text[j - 1] !== "\\")) j -= 1;
      i = j;
      continue;
    }
    if (ch === "}" || ch === "]") depth += 1;
    else if (ch === "{" || ch === "[") {
      if (depth > 0) depth -= 1;
      else if (ch === "{") return i;
    }
  }
  return -1;
}

// Direct scalar members of the object starting at start, or null when it
// cannot be read within the bound.
function directMembers(text, start, limit = 200000) {
  const members = {};
  const pair = /"([A-Za-z_][A-Za-z0-9_]{0,39})"\s*:\s*("(?:[^"\\]|\\.){0,120}"|-?\d{1,20}|true|false|null)(?=\s*[,}\]])/uy;
  let inString = false;
  let depth = 0;
  for (let i = start, end = Math.min(text.length, start + limit); i < end; i += 1) {
    const ch = text[i];
    if (inString) { if (ch === "\\") i += 1; else if (ch === '"') inString = false; continue; }
    if (ch === '"') {
      if (depth === 1) {
        pair.lastIndex = i;
        const match = pair.exec(text);
        if (match) { members[match[1]] = match[2].replace(/^"|"$/gu, ""); i = pair.lastIndex - 1; continue; }
      }
      inString = true;
      continue;
    }
    if (ch === "{" || ch === "[") depth += 1;
    else if (ch === "}" || ch === "]") { depth -= 1; if (depth === 0) return members; }
  }
  return null;
}

// Only these fields name a product. Values below four digits (media, store
// slots) are not product identities.
const JOONGNA_PRODUCT_ID_KEY = /^(?:product)?(?:seq|id|no)$/iu;
const ID_LIKE_KEY = /(?:seq|id|no)$/iu;
const productIdValue = (key, value) => JOONGNA_PRODUCT_ID_KEY.test(key) && /^\d{4,}$/u.test(value) ? value : null;

// The nearest enclosing object that names a product owns the status fields.
function statusOwner(text, index, id) {
  const keys = new Set();
  let pos = index;
  for (let level = 0; level < 8; level += 1) {
    const start = enclosingObjectStart(text, pos);
    if (start < 0) return { owner: "NONE", complete: true, keys };
    const members = directMembers(text, start);
    if (!members) return { owner: "NONE", complete: false, keys };
    const ids = [];
    for (const [key, value] of Object.entries(members)) {
      if (ID_LIKE_KEY.test(key)) keys.add(key);
      const productId = productIdValue(key, value);
      if (productId) ids.push(productId);
    }
    if (ids.length) return { owner: id && ids.every((value) => value === id) ? "TARGET" : "OTHER", complete: true, keys };
    pos = start;
  }
  return { owner: "NONE", complete: false, keys };
}

// Joonggonara product data marks a reservation with productStatus=1 and
// reservation=true. The nearest object naming a product must be the target.
// Without any product name around the fields, the page must hold uniform
// values, no other product ID anywhere, and must not be a product-missing page.
// Returns { reserved, binding, id_keys } where binding is an enum and id_keys
// lists ID-like key names (never values) for diagnostics.
export function joongnaReservationBinding(html, targetId) {
  const text = String(html || "").slice(0, 1_000_000).replace(/\\"/gu, '"');
  const id = String(targetId || "").match(/(\d{4,})\/?$/u)?.[1] || "";
  const statuses = new Set([...text.matchAll(/"productStatus"\s*:\s*(-?\d{1,3})(?=\s*[,}\]])/gu)].map((m) => m[1]));
  const flags = [...text.matchAll(/"reservation"\s*:\s*(true|false)(?=\s*[,}\]])/gu)];
  if (!flags.length || !statuses.size) return { reserved: false, binding: "NONE" };
  let bound = null;
  let otherProduct = false;
  let incomplete = false;
  const keys = new Set();
  for (const flag of flags.slice(0, 20)) {
    const start = enclosingObjectStart(text, flag.index);
    const members = start >= 0 ? directMembers(text, start) : null;
    if (!members || !("productStatus" in members)) { incomplete = true; continue; }
    const reserved = members.productStatus === "1" && members.reservation === "true";
    const owner = statusOwner(text, flag.index, id);
    for (const key of owner.keys) keys.add(key);
    if (owner.owner === "TARGET") bound = bound === null ? reserved : bound && reserved;
    else if (owner.owner === "OTHER") otherProduct = true;
    else if (!owner.complete) incomplete = true;
  }
  if (bound !== null) return { reserved: bound, binding: bound ? "ID" : "ID_NOT_RESERVED" };
  const uniform = statuses.size === 1 && new Set(flags.map((m) => m[1])).size === 1;
  const reservedValues = statuses.has("1") && flags[0][1] === "true";
  if (!reservedValues) return { reserved: false, binding: uniform ? "NOT_RESERVED" : "CONFLICT" };
  if (!uniform) return { reserved: false, binding: "CONFLICT" };
  if (otherProduct) return { reserved: false, binding: "OTHER_PRODUCT" };
  const idKeys = [...keys].sort().slice(0, 12);
  if (incomplete) return { reserved: false, binding: "UNBOUND", id_keys: idKeys };
  if (/"status"\s*:\s*422(?=\s*[,}\]])/u.test(text)) return { reserved: false, binding: "PRODUCT_MISSING" };
  const pageIds = [...text.matchAll(/"([A-Za-z]{2,16})"\s*:\s*"?(\d{4,20})"?(?=\s*[,}\]])/gu)]
    .map((m) => productIdValue(m[1], m[2])).filter(Boolean);
  if (pageIds.some((value) => value !== id)) return { reserved: false, binding: "UNBOUND", id_keys: idKeys };
  return { reserved: true, binding: "UNIQUE" };
}


export function joongnaReservedEvidenceFromBinding(result) {
  return result?.reserved
    ? { type: "STRUCTURED_STATUS", value: `productStatus=1;reservation=true;binding=${result.binding}` } : null;
}

export function joongnaReservedEvidenceFromHtml(html, targetId) {
  return joongnaReservedEvidenceFromBinding(joongnaReservationBinding(html, targetId));
}

// A Joonggonara product page whose product view failed carries no product data;
// its error object is {code, detail, title: ...ProductViewException, status: 422}.
// Only that object's detail decides a stated reason; any other 422 is an
// unexplained miss. Returns null when product data is present.
export function joongnaProductUnavailableReason(html) {
  const text = String(html || "").slice(0, 1_000_000).replace(/\\"/gu, '"');
  if (/"productStatus"\s*:/u.test(text) || !/"status"\s*:\s*422(?=\s*[,}\]])/u.test(text)) return null;
  const details = [...text.matchAll(/"status"\s*:\s*422(?=\s*[,}\]])/gu)].slice(0, 10)
    .map((match) => { const start = enclosingObjectStart(text, match.index); return start >= 0 ? directMembers(text, start) : null; })
    .filter((members) => members && /ProductViewException$/u.test(members.title || ""))
    .map((members) => members.detail || members.message || "").join(" ");
  if (/탈퇴한\s*회원의\s*상품/u.test(details)) return "WITHDRAWN_MEMBER";
  if (/삭제된\s*상품|상품이\s*삭제/u.test(details)) return "DELETED";
  if (/존재하지\s*않는\s*상품/u.test(details)) return "NOT_FOUND";
  return "UNEXPLAINED";
}

// eBay Browse getItem: an ended listing still answers 200 with OUT_OF_STOCK
// and a past itemEndDate. Returns null when the response is not this item.
export function ebayItemLifecycle(body, expectedItemId, nowMs = Date.now()) {
  if (!body || typeof body !== "object" || String(body.itemId || "") !== String(expectedItemId || "")) return null;
  const statuses = (Array.isArray(body.estimatedAvailabilities) ? body.estimatedAvailabilities : [])
    .map((entry) => String(entry?.estimatedAvailabilityStatus || "").toUpperCase()).filter(Boolean);
  const endedAt = Date.parse(body.itemEndDate || "");
  if (statuses.includes("OUT_OF_STOCK") || (Number.isFinite(endedAt) && endedAt <= nowMs)) return "UNAVAILABLE";
  return statuses.some((status) => status === "IN_STOCK" || status === "LIMITED_STOCK") ? "ACTIVE" : null;
}
