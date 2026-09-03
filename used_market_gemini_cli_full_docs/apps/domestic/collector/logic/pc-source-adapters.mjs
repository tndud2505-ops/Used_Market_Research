import { createHash } from "node:crypto";
import { explicitSoldText } from "../../market/logic/listing-lifecycle.mjs";
import { danawaTargetsForCategory } from "./pc-specialist-targets.mjs";

const LISTING_STATUSES = Object.freeze([
  "ACTIVE", "RESERVED", "SOLD", "DELETED", "EXPIRED", "UNAVAILABLE_UNKNOWN", "BLOCKED_OR_PRIVATE", "UNKNOWN"
]);
const AVAILABILITY_STATUSES = Object.freeze(["AVAILABLE", "UNAVAILABLE", "UNAVAILABLE_UNKNOWN", "BLOCKED_OR_PRIVATE"]);
const INCREMENTAL_CURSOR_ENTRY_LIMIT = 48;

function cursorHash(value) {
  return createHash("sha256").update(String(value || "")).digest("base64url").slice(0, 16);
}

function cursorEntry(item) {
  const identity = item?.source_listing_id || item?.item_id || item?.id || item?.url || "";
  const state = JSON.stringify({
    title: item?.title || "", price: item?.price ?? null, currency: item?.currency || "",
    status: item?.status || item?.lifecycle_status || "", updated_at: item?.updated_at || item?.posted_at || ""
  });
  return [cursorHash(identity), cursorHash(state)];
}

export function filterIncrementalListings(items, encodedCursor) {
  const values = Array.isArray(items) ? items : [];
  let previous = new Map();
  if (typeof encodedCursor === "string" && encodedCursor.trim()) {
    try {
      const parsed = JSON.parse(encodedCursor);
      if (parsed?.v === 1 && Array.isArray(parsed.entries)) previous = new Map(parsed.entries);
    } catch {
      previous = new Map();
    }
  }
  const entries = values.slice(0, INCREMENTAL_CURSOR_ENTRY_LIMIT).map(cursorEntry);
  const nextCursor = JSON.stringify({ v: 1, entries });
  const incrementalItems = previous.size === 0
    ? values
    : values.filter((item) => {
        const [identity, state] = cursorEntry(item);
        return previous.get(identity) !== state;
      });
  return { items: incrementalItems, next_cursor: nextCursor };
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&quot;/giu, "\"")
    .replace(/&#39;|&#x27;/giu, "'")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&#(\d+);/gu, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/giu, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function normalizeText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]*>/gu, " ")).replace(/\s+/gu, " ").trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function readAttribute(attributes, name) {
  const match = String(attributes || "").match(new RegExp(`\\b${escapeRegExp(name)}\\s*=\\s*([\"'])([\\s\\S]*?)\\1`, "iu"));
  return match ? decodeHtmlEntities(match[2]) : "";
}

function hasClass(attributes, className) {
  return readAttribute(attributes, "class").split(/\s+/u).includes(className);
}

function blocksByTagAndClass(html, tagName, className) {
  const blocks = [];
  const pattern = new RegExp(`<${tagName}\\b([^>]*)>([\\s\\S]*?)<\\/${tagName}>`, "giu");
  for (const match of String(html || "").matchAll(pattern)) {
    if (hasClass(match[1], className)) blocks.push({ attributes: match[1], html: match[2] });
  }
  return blocks;
}

function classText(html, className) {
  const pattern = new RegExp(`<([a-z0-9]+)\\b([^>]*)>([\\s\\S]*?)<\\/\\1>`, "giu");
  for (const match of String(html || "").matchAll(pattern)) {
    if (hasClass(match[2], className)) return normalizeText(match[3]);
  }
  return "";
}

function tagClassText(html, tagName, className) {
  const pattern = new RegExp(`<${tagName}\\b([^>]*)>([\\s\\S]*?)<\\/${tagName}>`, "giu");
  for (const match of String(html || "").matchAll(pattern)) {
    if (hasClass(match[1], className)) return normalizeText(match[2]);
  }
  return "";
}

function elementTextByClass(html, className) {
  const escaped = escapeRegExp(className);
  const pattern = new RegExp(`<([a-z0-9]+)\\b([^>]*\\bclass\\s*=\\s*(["'])[^"']*\\b${escaped}\\b[^"']*\\3[^>]*)>([\\s\\S]*?)<\\/\\1>`, "iu");
  const match = String(html || "").match(pattern);
  return match ? normalizeText(match[4]) : "";
}

function firstAnchor(html, className) {
  for (const match of String(html || "").matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/giu)) {
    if (className && !hasClass(match[1], className)) continue;
    const href = readAttribute(match[1], "href");
    if (href) return { href, title: normalizeText(match[2]) };
  }
  return null;
}

function parsePrice(value) {
  const digits = normalizeText(value).replace(/[^\d]/gu, "");
  if (!digits) return null;
  const parsed = Number(digits);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseExplicitKrwPrice(value) {
  const text = normalizeText(value);
  const tenThousand = text.match(/(?:가격|판매가|금액)?\s*[:：]?\s*(\d+(?:\.\d+)?)\s*만\s*원?/u);
  if (tenThousand) {
    const parsed = Number(tenThousand[1]);
    const price = Math.round(parsed * 10_000);
    return Number.isSafeInteger(price) && price > 0 ? price : null;
  }
  const won = text.match(/(?:가격|판매가|금액)?\s*[:：]?\s*(\d{1,3}(?:,\d{3})+|\d{4,})\s*원/u);
  return won ? parsePrice(won[1]) : null;
}

function parseStatus(...values) {
  const text = values.map(normalizeText).join(" ");
  if (explicitSoldText(text)) return "SOLD";
  if (/예약\s*중|reserved/iu.test(text)) return "RESERVED";
  if (/판매\s*중|거래\s*가능|판매\s*가능|active/iu.test(text)) return "ACTIVE";
  return "UNKNOWN";
}

function absoluteUrl(baseUrl, href) {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return "";
  }
}

function absoluteHttpsImageUrl(baseUrl, value) {
  const candidate = decodeHtmlEntities(value).trim();
  if (!candidate || /^(?:data|blob|javascript):/iu.test(candidate)) return "";
  try {
    const parsed = new URL(candidate, baseUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    if (parsed.username || parsed.password) return "";
    parsed.protocol = "https:";
    return parsed.toString();
  } catch {
    return "";
  }
}

function firstImageUrl(html, baseUrl) {
  for (const match of String(html || "").matchAll(/<img\b([^>]*)>/giu)) {
    for (const attribute of ["data-original", "data-src", "data-lazy-src", "data-echo", "src"]) {
      const imageUrl = absoluteHttpsImageUrl(baseUrl, readAttribute(match[1], attribute));
      if (imageUrl) return imageUrl;
    }
    for (const attribute of ["data-srcset", "srcset"]) {
      const firstCandidate = readAttribute(match[1], attribute).split(",", 1)[0]?.trim().split(/\s+/u, 1)[0] || "";
      const imageUrl = absoluteHttpsImageUrl(baseUrl, firstCandidate);
      if (imageUrl) return imageUrl;
    }
  }
  return "";
}

function parseCsvRows(input) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const source = String(input || "").replace(/^\uFEFF/u, "");
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/u, ""));
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error("BUNJANG_PARTNER_CATALOG_UNTERMINATED_QUOTE");
  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/u, ""));
    if (row.some((value) => value.length > 0)) rows.push(row);
  }
  return rows;
}

function bunjangCatalogStatus(value) {
  const status = normalizeText(value).toUpperCase();
  if (status === "SELLING") return "ACTIVE";
  if (status === "DELETED") return "DELETED";
  return "UNKNOWN";
}

function parseJsonValue(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function parseBunjangPartnerCatalogCsv(csv) {
  const rows = parseCsvRows(csv);
  if (rows.length === 0) return [];
  const headers = rows[0].map((value) => normalizeText(value));
  for (const required of ["pid", "name", "price", "condition", "saleStatus", "categoryId", "updatedAt"]) {
    if (!headers.includes(required)) throw new Error(`BUNJANG_PARTNER_CATALOG_HEADER_MISSING:${required}`);
  }
  const listings = [];
  for (const values of rows.slice(1)) {
    const record = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    const sourceListingId = normalizeText(record.pid);
    const title = normalizeText(record.name);
    if (!/^\d+$/u.test(sourceListingId) || !title) continue;
    const images = String(record.images || "")
      .split(",")
      .map((value) => absoluteHttpsImageUrl("https://media.bunjang.co.kr", value))
      .filter(Boolean);
    const quantity = Number(record.quantity);
    listings.push({
      source_listing_id: sourceListingId,
      site: "bunjang",
      url: `https://m.bunjang.co.kr/products/${sourceListingId}`,
      title,
      description: normalizeText(record.description),
      price: parsePrice(record.price),
      currency: "KRW",
      status: bunjangCatalogStatus(record.saleStatus),
      image_url: images[0] || "",
      source_category_code: normalizeText(record.categoryId),
      updated_at: normalizeText(record.updatedAt),
      posted_at: normalizeText(record.createdAt),
      raw_payload: {
        pid: sourceListingId,
        quantity: Number.isSafeInteger(quantity) && quantity > 0 ? quantity : null,
        shipping_fee: parsePrice(record.shippingFee || record.shipppingFee),
        condition: normalizeText(record.condition).toUpperCase(),
        sale_status: normalizeText(record.saleStatus).toUpperCase(),
        keywords: normalizeText(record.keywords),
        images,
        category_id: normalizeText(record.categoryId),
        brand_id: normalizeText(record.brandId),
        options: parseJsonValue(record.options),
        updated_at: normalizeText(record.updatedAt),
        created_at: normalizeText(record.createdAt)
      }
    });
  }
  return listings;
}

function parseSpecialistHtml(html, config) {
  const listings = [];
  for (const block of blocksByTagAndClass(html, config.cardTag, config.cardClass)) {
    const anchor = firstAnchor(block.html, config.anchorClass);
    if (!anchor) continue;
    const href = anchor.href;
    const idFromAttribute = readAttribute(block.attributes, config.idAttribute);
    const idFromUrl = href.match(config.idFromUrl)?.[1] ?? "";
    const sourceListingId = (idFromAttribute || idFromUrl).trim();
    const priceText = classText(block.html, config.priceClass);
    const statusText = classText(block.html, config.statusClass);
    const imageUrl = firstImageUrl(block.html, config.baseUrl);
    if (!sourceListingId || !anchor.title) continue;
    listings.push({
      source_listing_id: sourceListingId,
      url: absoluteUrl(config.baseUrl, href),
      title: anchor.title,
      price: parsePrice(priceText),
      currency: "KRW",
      status: parseStatus(statusText, anchor.title),
      image_url: imageUrl,
      raw_payload: {
        source_listing_id: sourceListingId,
        href,
        title_text: anchor.title,
        price_text: priceText,
        status_text: statusText
      }
    });
  }
  return listings;
}

export function parseDanawaListingsHtml(html) {
  const fixtureListings = parseSpecialistHtml(html, {
    cardTag: "li",
    cardClass: "market_item",
    anchorClass: "subject",
    priceClass: "price",
    statusClass: "state",
    idAttribute: "data-board-seq",
    idFromUrl: /[?&]seq=(\d+)/u,
    baseUrl: "https://dmall.danawa.com"
  });
  if (fixtureListings.length > 0) return fixtureListings;
  const listings = [];
  for (const match of String(html || "").matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/giu)) {
    const rowHtml = match[2];
    const anchors = [...rowHtml.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/giu)]
      .map((anchor) => ({ href: readAttribute(anchor[1], "href"), title: normalizeText(anchor[2]) }))
      .filter((anchor) => /[?&]controller=sale(?:&|&amp;)methods=blog/iu.test(anchor.href) && anchor.title);
    const anchor = anchors.sort((left, right) => right.title.length - left.title.length)[0];
    if (!anchor) continue;
    const sourceListingId = anchor.href.match(/[?&]seq=(\d+)/u)?.[1] || "";
    if (!sourceListingId) continue;
    const detail = elementTextByClass(rowHtml, "detail");
    const imageUrl = firstImageUrl(rowHtml, "https://dmall.danawa.com");
    const sellerType = /사업자/u.test(detail) ? "DEALER" : "INDIVIDUAL_OR_UNKNOWN";
    listings.push({
      source_listing_id: sourceListingId,
      url: absoluteUrl("https://dmall.danawa.com", anchor.href.replace(/&amp;/giu, "&")),
      title: anchor.title.replace(/\s*\[\d+\]\s*$/u, "").trim(),
      price: parsePrice(elementTextByClass(rowHtml, "price_num") || elementTextByClass(rowHtml, "price")),
      currency: "KRW",
      status: parseStatus(detail, anchor.title),
      seller_type: sellerType,
      image_url: imageUrl,
      raw_payload: {
        source_listing_id: sourceListingId,
        href: anchor.href,
        title_text: anchor.title,
        price_text: elementTextByClass(rowHtml, "price_num") || elementTextByClass(rowHtml, "price"),
        detail_text: detail,
        seller_type: sellerType
      }
    });
  }
  return listings;
}

export async function collectDanawaCategoryListings({ categoryCode, page = 1, fetchImpl = fetch, userAgent = "USED-PICK-PC-Collector/2.0" }) {
  const targets = danawaTargetsForCategory(categoryCode);
  if (targets.length === 0) throw new Error(`DANAWA_CATEGORY_NOT_MAPPED:${categoryCode}`);
  const items = [];
  const diagnostics = [];
  for (const target of targets) {
    const endpoint = "https://dmall.danawa.com/v3/?controller=sale&methods=getGoodsList";
    const form = new URLSearchParams({
      parentCategoryCode: String(target.parent_category_code),
      childCategoryCode: String(target.child_category_code),
      searchField: "sProdN",
      localeCode: "0",
      searchKeyword: "",
      userLevel: "",
      newProd: "",
      buyWay: "",
      orderBy: "nRegistDate DESC",
      page: String(page),
      searchType: "NORMAL_LIST",
      makerCode: "",
      attribute: ""
    });
    let payload;
    let lastFailure = `DANAWA_RESPONSE_INVALID:${categoryCode}`;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      if (attempt > 1) await new Promise((resolve) => setTimeout(resolve, 900 * (attempt - 1)));
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "user-agent": userAgent,
          accept: "application/json,text/plain,*/*",
          "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
          "x-requested-with": "XMLHttpRequest",
          referer: `https://dmall.danawa.com/v3/?controller=sale&methods=index&parentCategoryCode=${target.parent_category_code}&childCategoryCode=${target.child_category_code}`
        },
        body: form,
        signal: AbortSignal.timeout(15_000)
      });
      const body = await response.text();
      if (!response.ok) {
        lastFailure = `DANAWA_HTTP_${response.status}:${categoryCode}`;
        continue;
      }
      try {
        payload = JSON.parse(body);
      } catch {
        lastFailure = `DANAWA_RESPONSE_NOT_JSON:${categoryCode}`;
        continue;
      }
      if (payload?.status === true && typeof payload.goodsList === "string") break;
      payload = undefined;
    }
    if (!payload) throw new Error(lastFailure);
    const parsed = parseDanawaListingsHtml(payload.goodsList).map((item) => ({
      ...item,
      site: "danawa",
      source_category_code: `${target.parent_category_code}:${target.child_category_code}`,
      requested_category_code: String(categoryCode).toUpperCase()
    }));
    items.push(...parsed);
    diagnostics.push({
      parent_category_code: target.parent_category_code,
      child_category_code: target.child_category_code,
      reported_count: Number(String(payload.totalCount || "0").replace(/[^\d]/gu, "")) || 0,
      parsed_count: parsed.length
    });
  }
  const deduped = new Map(items.map((item) => [item.source_listing_id, item]));
  return { items: [...deduped.values()], diagnostics };
}

export function parseQuasarzoneListingsHtml(html) {
  const fixtureListings = parseSpecialistHtml(html, {
    cardTag: "tr",
    cardClass: "market-row",
    anchorClass: "subject-link",
    priceClass: "price",
    statusClass: "state",
    idAttribute: "data-wr-id",
    idFromUrl: /\/(\d+)(?:[/?#]|$)/u,
    baseUrl: "https://quasarzone.com"
  });
  if (fixtureListings.length > 0) return fixtureListings;

  const listings = [];
  for (const match of String(html || "").matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/giu)) {
    const rowHtml = match[1];
    if (!/class\s*=\s*(["'])[^"']*\blabel\b[^"']*\1[^>]*>\s*장터\s*</iu.test(rowHtml)) continue;
    const anchor = [...rowHtml.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/giu)]
      .map((entry) => ({ href: readAttribute(entry[1], "href"), title: normalizeText(entry[2]) }))
      .find((entry) => /\/bbs\/qb_jijang\/views\/\d+/iu.test(entry.href));
    if (!anchor) continue;
    const sourceListingId = anchor.href.match(/\/views\/(\d+)(?:[/?#]|$)/iu)?.[1] || "";
    if (!sourceListingId || !anchor.title) continue;
    const description = tagClassText(rowHtml, "p", "cont");
    const postedAt = tagClassText(rowHtml, "p", "time");
    const combined = `${anchor.title} ${description}`;
    listings.push({
      source_listing_id: sourceListingId,
      url: absoluteUrl("https://quasarzone.com", anchor.href),
      title: anchor.title,
      description,
      price: parseExplicitKrwPrice(combined),
      currency: "KRW",
      status: parseStatus(combined) === "UNKNOWN" ? "ACTIVE" : parseStatus(combined),
      image_url: firstImageUrl(rowHtml, "https://quasarzone.com"),
      posted_at: /^\d{4}-\d{2}-\d{2}$/u.test(postedAt) ? `${postedAt}T00:00:00+09:00` : null,
      raw_payload: {
        source_listing_id: sourceListingId,
        href: anchor.href,
        title_text: anchor.title,
        description_text: description,
        posted_at_text: postedAt
      }
    });
  }
  return listings;
}

export function parseCoolenjoyListingsHtml(html) {
  const fixtureListings = parseSpecialistHtml(html, {
    cardTag: "article",
    cardClass: "board-list-item",
    anchorClass: "item-title",
    priceClass: "item-price",
    statusClass: "item-status",
    idAttribute: "data-no",
    idFromUrl: /\/(\d+)(?:[/?#]|$)/u,
    baseUrl: "https://coolenjoy.net"
  });
  if (fixtureListings.length > 0) return fixtureListings;

  const listings = [];
  for (const block of blocksByTagAndClass(html, "li", "d-md-table-row")) {
    const anchor = firstAnchor(block.html, "na-subject");
    if (!anchor || !/\/bbs\/mart2\/\d+/iu.test(anchor.href)) continue;
    const sourceListingId = anchor.href.match(/\/bbs\/mart2\/(\d+)(?:[/?#]|$)/iu)?.[1] || "";
    if (!sourceListingId || !anchor.title) continue;

    const statusMatch = block.html.match(/<div\b[^>]*\bid\s*=\s*(["'])?abcd\1?[^>]*>([\s\S]*?)<\/div>/iu);
    const statusText = normalizeText(statusMatch?.[2] || "");
    const priceText = elementTextByClass(block.html, "nw-11").replace(/^판매가\s*/u, "");
    const postedAtText = elementTextByClass(block.html, "nw-6").replace(/^등록일\s*/u, "");
    const status = explicitSoldText(`${statusText} ${anchor.title}`)
      ? "SOLD"
      : /예약/u.test(statusText)
        ? "RESERVED"
        : /^판매$/u.test(statusText)
          ? "ACTIVE"
          : "UNKNOWN";

    listings.push({
      source_listing_id: sourceListingId,
      url: absoluteUrl("https://coolenjoy.net", anchor.href.replace(/&amp;/giu, "&")),
      title: anchor.title,
      price: /본문\s*참고/u.test(priceText) ? null : parsePrice(priceText),
      currency: "KRW",
      status,
      image_url: "",
      raw_payload: {
        source_listing_id: sourceListingId,
        href: anchor.href,
        title_text: anchor.title,
        price_text: priceText,
        status_text: statusText,
        posted_at_text: postedAtText
      }
    });
  }
  return listings;
}

function assertIsoDate(value, fieldName) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error(`INVALID_${fieldName.toUpperCase()}`);
}

function assertSource(result, expectedSourceKey) {
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("INVALID_ADAPTER_RESULT");
  if (result.source_key !== expectedSourceKey) {
    throw new Error(`ADAPTER_RESULT_SOURCE_MISMATCH:${result.source_key}:${expectedSourceKey}`);
  }
}

function validateListing(item, index) {
  if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`INVALID_LISTING:${index}`);
  if (typeof item.source_listing_id !== "string" || !item.source_listing_id.trim()) throw new Error(`INVALID_SOURCE_LISTING_ID:${index}`);
  try {
    const parsedUrl = new URL(item.url);
    if (!/^https?:$/u.test(parsedUrl.protocol)) throw new Error("unsupported protocol");
  } catch {
    throw new Error(`INVALID_LISTING_URL:${index}`);
  }
  if (typeof item.title !== "string" || !item.title.trim()) throw new Error(`INVALID_LISTING_TITLE:${index}`);
  if (item.price !== null && (!Number.isSafeInteger(item.price) || item.price < 0)) throw new Error(`INVALID_LISTING_PRICE:${index}`);
  if (typeof item.currency !== "string" || !/^[A-Z]{3}$/u.test(item.currency)) throw new Error(`INVALID_LISTING_CURRENCY:${index}`);
  if (!LISTING_STATUSES.includes(item.status)) throw new Error(`INVALID_LISTING_STATUS:${index}`);
  if (!item.raw_payload || typeof item.raw_payload !== "object" || Array.isArray(item.raw_payload)) throw new Error(`INVALID_RAW_PAYLOAD:${index}`);
}

function validateAdapterMetrics(metrics, itemCount) {
  if (metrics === undefined) return;
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) throw new Error("INVALID_ADAPTER_METRICS");
  for (const field of [
    "request_count", "request_failure_count", "parsed_count", "parse_failure_count", "http_blocked_count", "captcha_count"
  ]) {
    if (!Number.isInteger(metrics[field]) || metrics[field] < 0) throw new Error(`INVALID_ADAPTER_METRIC:${field}`);
  }
  const validNoop = metrics.request_count === 0 && itemCount === 0 && metrics.parsed_count === 0
    && metrics.request_failure_count === 0 && metrics.parse_failure_count === 0
    && metrics.http_blocked_count === 0 && metrics.captcha_count === 0;
  if ((!validNoop && metrics.request_count < 1) || metrics.request_failure_count > metrics.request_count
    || metrics.parse_failure_count > metrics.request_count || metrics.parsed_count < itemCount) {
    throw new Error("INCONSISTENT_ADAPTER_METRICS");
  }
  if (metrics.failure_messages !== undefined
    && (!Array.isArray(metrics.failure_messages) || metrics.failure_messages.some((value) => typeof value !== "string"))) {
    throw new Error("INVALID_ADAPTER_FAILURE_MESSAGES");
  }
}

export function validateCollectIncrementalResult(result, expectedSourceKey) {
  assertSource(result, expectedSourceKey);
  if (result.mode !== "incremental") throw new Error(`INVALID_ADAPTER_MODE:${result.mode}`);
  assertIsoDate(result.collected_at, "collected_at");
  if (!Array.isArray(result.items)) throw new Error("INVALID_ADAPTER_ITEMS");
  result.items.forEach(validateListing);
  validateAdapterMetrics(result.metrics, result.items.length);
  if (result.next_cursor !== null && typeof result.next_cursor !== "string") throw new Error("INVALID_NEXT_CURSOR");
  if (typeof result.exhausted !== "boolean") throw new Error("INVALID_EXHAUSTED_FLAG");
  return result;
}

export function validateRecheckResult(result, expectedSourceKey) {
  assertSource(result, expectedSourceKey);
  if (result.mode !== "recheck") throw new Error(`INVALID_ADAPTER_MODE:${result.mode}`);
  assertIsoDate(result.checked_at, "checked_at");
  if (typeof result.source_listing_id !== "string" || !result.source_listing_id.trim()) throw new Error("INVALID_SOURCE_LISTING_ID");
  if (!AVAILABILITY_STATUSES.includes(result.availability)) throw new Error(`INVALID_AVAILABILITY:${result.availability}`);
  if (!LISTING_STATUSES.includes(result.status)) throw new Error(`INVALID_LISTING_STATUS:${result.status}`);
  if (!Array.isArray(result.evidence)) throw new Error("INVALID_RECHECK_EVIDENCE");
  for (const entry of result.evidence) {
    if (!entry || typeof entry.kind !== "string" || !entry.kind.trim() || typeof entry.value !== "string") {
      throw new Error("INVALID_RECHECK_EVIDENCE_ENTRY");
    }
  }
  return result;
}

export function createSourceAdapter({ sourceKey, collectIncremental, recheck }) {
  if (typeof sourceKey !== "string" || !sourceKey.trim()) throw new Error("SOURCE_KEY_REQUIRED");
  if (typeof collectIncremental !== "function") throw new Error(`COLLECT_INCREMENTAL_REQUIRED:${sourceKey}`);
  if (typeof recheck !== "function") throw new Error(`RECHECK_REQUIRED:${sourceKey}`);
  return Object.freeze({
    sourceKey,
    async collectIncremental(input) {
      return validateCollectIncrementalResult(await collectIncremental(input), sourceKey);
    },
    async recheck(input) {
      return validateRecheckResult(await recheck(input), sourceKey);
    }
  });
}

export const SPECIALIST_FIXTURE_PARSERS = Object.freeze({
  danawa: parseDanawaListingsHtml,
  bunjang_partner_catalog: parseBunjangPartnerCatalogCsv,
  quasarzone: parseQuasarzoneListingsHtml,
  coolenjoy: parseCoolenjoyListingsHtml
});
