const OFFER_SLOT = "after-organic-results";
const EVENT_TOKEN_TTL_SECONDS = 5 * 60;
const IDENTIFIER = /^[a-z0-9][a-z0-9._:-]{0,119}$/u;
const EVENT_TYPES = new Set(["impression", "click"]);
const EVENT_FIELDS = new Set(["event_type", "offer_id", "slot", "context_type", "context_key", "event_token"]);
const CONTEXT_FIELDS = new Set(["canonical_product_id", "category_code", "slot"]);

function cleanText(value, maximum = 200) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function enabled(env) {
  return String(env?.MONETIZATION_ENABLED || "false").trim().toLowerCase() === "true";
}

function eventSecret(env) {
  const secret = String(env?.MONETIZATION_EVENT_SECRET || "").trim();
  return [...secret].length >= 32 ? secret : "";
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlToBytes(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  try {
    const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return bytesToBase64Url(bytes) === value ? bytes : null;
  } catch {
    return null;
  }
}

async function hmacKey(secret, usage) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage]
  );
}

function allowedOrigins(env) {
  const origins = new Set();
  for (const raw of String(env?.AFFILIATE_ALLOWED_ORIGINS || "").split(",")) {
    try {
      const url = new URL(raw.trim());
      if (url.protocol === "https:" && url.pathname === "/" && !url.search && !url.hash) origins.add(url.origin);
    } catch {}
  }
  return origins;
}

function configuredOffers(env) {
  try {
    const parsed = JSON.parse(String(env?.AFFILIATE_OFFERS_JSON || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeOffer(value, origins, now) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.approved !== true) return null;
  const offerId = cleanText(value.offer_id, 120);
  const provider = cleanText(value.provider, 80);
  const title = cleanText(value.title, 180);
  const ctaLabel = cleanText(value.cta_label, 60) || "상품 보기";
  const canonicalProductId = cleanText(value.canonical_product_id, 200);
  const categoryCode = cleanText(value.category_code, 80).toUpperCase();
  const reviewedAt = Date.parse(cleanText(value.reviewed_at, 80));
  const expiresAt = Date.parse(cleanText(value.expires_at, 80));
  if (!IDENTIFIER.test(offerId) || !provider || !title) return null;
  if (Boolean(canonicalProductId) === Boolean(categoryCode)) return null;
  if (!Number.isFinite(reviewedAt) || reviewedAt > now.getTime()) return null;
  if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) return null;

  let destination;
  try {
    destination = new URL(cleanText(value.destination_url, 2_000));
  } catch {
    return null;
  }
  if (destination.protocol !== "https:" || destination.username || destination.password || destination.hash) return null;
  if (!origins.has(destination.origin)) return null;
  if (!destination.pathname || destination.pathname === "/") return null;

  return {
    offer_id: offerId,
    provider,
    title,
    cta_label: ctaLabel,
    destination_url: destination.toString(),
    canonical_product_id: canonicalProductId || null,
    category_code: categoryCode || null,
    priority: Number.isFinite(Number(value.priority)) ? Number(value.priority) : 0,
    expires_at: new Date(expiresAt).toISOString()
  };
}

function validOffers(env, now) {
  if (!enabled(env) || !eventSecret(env)) return [];
  const origins = allowedOrigins(env);
  if (origins.size === 0) return [];
  const normalized = configuredOffers(env)
    .map((value) => normalizeOffer(value, origins, now))
    .filter(Boolean);
  const identityCounts = new Map();
  for (const offer of normalized) identityCounts.set(offer.offer_id, (identityCounts.get(offer.offer_id) || 0) + 1);
  return normalized
    .filter((offer) => identityCounts.get(offer.offer_id) === 1)
    .sort((left, right) => right.priority - left.priority || left.offer_id.localeCompare(right.offer_id));
}

export async function issueMonetizationEventToken(env, offer, options = {}) {
  const secret = eventSecret(env);
  if (!secret || !offer) return null;
  const now = options.now instanceof Date ? options.now : new Date();
  const expiresAt = Math.floor(now.getTime() / 1_000) + EVENT_TOKEN_TTL_SECONDS;
  const payload = {
    v: 2,
    exp: expiresAt,
    jti: crypto.randomUUID(),
    oid: cleanText(offer.offer_id, 120),
    s: cleanText(offer.slot, 80),
    ct: cleanText(offer.context_type, 40),
    ck: cleanText(offer.context_key, 200)
  };
  if (!IDENTIFIER.test(payload.oid) || payload.s !== OFFER_SLOT || !payload.ct || !payload.ck) return null;
  const encodedPayload = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await hmacKey(secret, "sign");
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(encodedPayload));
  return {
    token: `${encodedPayload}.${bytesToBase64Url(new Uint8Array(signature))}`,
    expires_at: new Date(expiresAt * 1_000).toISOString()
  };
}

async function validEventToken(env, token, expected, now) {
  const secret = eventSecret(env);
  const [encodedPayload, encodedSignature, ...extra] = String(token || "").split(".");
  if (!secret || !encodedPayload || !encodedSignature || extra.length) return false;
  const payloadBytes = base64UrlToBytes(encodedPayload);
  const signatureBytes = base64UrlToBytes(encodedSignature);
  if (!payloadBytes || !signatureBytes) return false;
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return false;
  }
  const nowSeconds = Math.floor(now.getTime() / 1_000);
  if (payload?.v !== 2 || !Number.isInteger(payload.exp) || !IDENTIFIER.test(String(payload.jti || ""))) return false;
  if (payload.exp <= nowSeconds || payload.exp > nowSeconds + EVENT_TOKEN_TTL_SECONDS) return false;
  if (payload.oid !== expected.offerId || payload.s !== expected.slot
    || payload.ct !== expected.contextType || payload.ck !== expected.contextKey) return false;
  const key = await hmacKey(secret, "verify");
  return await crypto.subtle.verify("HMAC", key, signatureBytes, new TextEncoder().encode(encodedPayload)) ? payload : false;
}

function normalizedContext(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  if (Object.keys(input).some((key) => !CONTEXT_FIELDS.has(key))) return null;
  const canonicalProductId = cleanText(input?.canonical_product_id, 200);
  const categoryCode = cleanText(input?.category_code, 80).toUpperCase();
  const slot = cleanText(input?.slot, 80);
  if (slot !== OFFER_SLOT) return null;
  if (!canonicalProductId && !categoryCode) return null;
  return { canonicalProductId, categoryCode, slot };
}

function publicOffer(offer, contextType, contextKey) {
  return {
    offer_id: offer.offer_id,
    provider: offer.provider,
    title: offer.title,
    cta_label: offer.cta_label,
    destination_url: offer.destination_url,
    slot: OFFER_SLOT,
    context_type: contextType,
    context_key: contextKey,
    disclosure: {
      advertisement: "광고",
      commission: "이 링크를 통해 구매하면 USED PICK이 수수료를 받을 수 있습니다.",
      independence: "시세와 추천순에는 영향을 주지 않습니다."
    }
  };
}

export function selectContextualOffer(env, input, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const context = normalizedContext(input);
  if (!context) return null;
  const offers = validOffers(env, now);
  if (context.canonicalProductId) {
    const productOffer = offers.find((offer) => offer.canonical_product_id === context.canonicalProductId);
    if (productOffer) return publicOffer(productOffer, "canonical_product", context.canonicalProductId);
  }
  if (context.categoryCode) {
    const categoryOffer = offers.find((offer) => offer.category_code === context.categoryCode);
    if (categoryOffer) return publicOffer(categoryOffer, "category", context.categoryCode);
  }
  return null;
}

export async function recordMonetizationEvent(db, env, input, options = {}) {
  if (!db || !input || typeof input !== "object" || Array.isArray(input)) return false;
  if (Object.keys(input).some((key) => !EVENT_FIELDS.has(key))) return false;
  const now = options.now instanceof Date ? options.now : new Date();
  const eventType = cleanText(input.event_type, 20);
  const offerId = cleanText(input.offer_id, 120);
  const slot = cleanText(input.slot, 80);
  const contextType = cleanText(input.context_type, 40);
  const contextKey = cleanText(input.context_key, 200);
  const eventToken = cleanText(input.event_token, 2_000);
  if (!EVENT_TYPES.has(eventType) || !IDENTIFIER.test(offerId) || slot !== OFFER_SLOT) return false;
  if (!new Set(["canonical_product", "category"]).has(contextType) || !contextKey) return false;

  const offer = validOffers(env, now).find((candidate) => candidate.offer_id === offerId);
  if (!offer) return false;
  const expectedType = offer.canonical_product_id ? "canonical_product" : "category";
  const expectedKey = offer.canonical_product_id || offer.category_code;
  if (contextType !== expectedType || contextKey !== expectedKey) return false;
  const verifiedToken = await validEventToken(env, eventToken, { offerId, slot, contextType, contextKey }, now);
  if (!verifiedToken) return false;

  const impressionIncrement = eventType === "impression" ? 1 : 0;
  const clickIncrement = eventType === "click" ? 1 : 0;
  await purgeMonetizationMetrics(db, now);
  const receiptStatement = db.prepare(`INSERT OR IGNORE INTO monetization_event_dedup
      (token_id, event_type, expires_at, created_at) VALUES (?, ?, ?, ?)`).bind(
    verifiedToken.jti, eventType, new Date(verifiedToken.exp * 1_000).toISOString(), now.toISOString()
  );
  const metricStatement = db.prepare(`INSERT INTO monetization_daily_metrics (
      date_key, offer_id, slot, context_type, context_key, impressions, clicks, updated_at
    ) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1
    ON CONFLICT(date_key, offer_id, slot, context_type, context_key) DO UPDATE SET
      impressions = impressions + excluded.impressions,
      clicks = clicks + excluded.clicks,
      updated_at = excluded.updated_at`).bind(
    now.toISOString().slice(0, 10), offerId, slot, contextType, contextKey,
    impressionIncrement, clickIncrement, now.toISOString()
  );
  const results = await db.batch([receiptStatement, metricStatement]);
  const receipt = results?.[0];
  return Number(receipt?.meta?.changes ?? receipt?.changes ?? 0) === 1;
}

export async function purgeMonetizationMetrics(db, now = new Date()) {
  if (!db) return { metrics: 0, receipts: 0 };
  const retentionCutoff = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1_000).toISOString().slice(0, 10);
  const metrics = await db.prepare("DELETE FROM monetization_daily_metrics WHERE date_key < ?").bind(retentionCutoff).run();
  const receipts = await db.prepare("DELETE FROM monetization_event_dedup WHERE expires_at < ?").bind(now.toISOString()).run();
  return {
    metrics: Number(metrics?.meta?.changes ?? metrics?.changes ?? 0),
    receipts: Number(receipts?.meta?.changes ?? receipts?.changes ?? 0)
  };
}

export const MONETIZATION_OFFER_SLOT = OFFER_SLOT;
