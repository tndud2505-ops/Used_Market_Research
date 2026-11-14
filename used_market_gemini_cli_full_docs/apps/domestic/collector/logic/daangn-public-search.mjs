import { Buffer } from 'node:buffer';

export const DAANGN_SEARCH_TIMEOUT_MS = 15_000;
export const DAANGN_SEARCH_MAX_BYTES = 4 * 1024 * 1024;
// The canonical default omits area; null makes no claim about geographic scope.
export const DAANGN_DEFAULT_AREA = null;
const ORIGIN = 'https://www.daangn.com';
// A buy-now badge can coexist with a seller's explicit local-only restriction.
// null means no confirmed blanket restriction, not proof that shipping is offered.
export function daangnDeliveryRestriction(item) {
  const clauses = `${item.title || ''}\n${item.description || ''}`.normalize('NFKC')
    .split(/[\r\n.!?。！？;,]+/u).map(text => text.replace(/\s+/gu, ' ').trim());
  const restrictions = /(?:택배|배송)\s*(?:거래\s*)?(?:는|은|도|가)?\s*(?:불가능|불가|안\s*(?:합니다|하겠습니다|해요|해드립니다|돼요|됩니다|됨)|(?:가능\s*)?하(?:지는|지)\s*않(?:습니다|아요|음))|직거(?:래)?\s*(?:전용|만(?=\s*(?:가능|합니다|하겠습니다|할게요|해요|됩니다|원(?:합니다|해요)|진행|하는|하(?:지|는)|했|(?:은|이)\s*(?:아니|아닙|아님|가능)|아니|아님|$)))/giu;
  // Negation must grammatically follow this restriction. An unrelated refund
  // or price-negotiation denial later in the clause cannot reverse it.
  const reversed = /^\s*(?:(?:은|는|이|가|만)?\s*(?:아니|아닙|아님)|(?:가능하|하|되)(?:지는|지)\s*않|(?:이\s*)?(?:(?:라고\s*)?(?:하는|한다는|되는|된다는|가능하다는|가능한|인)\s*)?(?:것(?:은|이)?|건|게)\s*(?:아니|아닙|아님))/u;
  const limitedParcelScope = /(?:무료|공짜|착불|선불|반값|제주(?:도)?|도서(?:\s*산간)?|산간|해외|국외|섬\s*지역|일부\s*지역)(?:\s*(?:지역|지방))?\s*(?:만|은|는|으로|로|에|까지|행|쪽)?\s*$/u;
  const limitedParcelRegion = /^\s*지역(?:은|는|이|:)?\s*(?:제주(?:도)?|도서(?:\s*산간)?|산간|해외|국외|섬\s*지역)/u;
  const currentParcelOffer = text => {
    const offer = /(?:지금|현재|이제)(?:은|는|부터)?\s*(?:직거(?:래)?\s*(?:또는|혹은|\/|와|나)\s*)?(?:택배|배송)\s*(?:거래\s*)?(?:도|는|은|로)?\s*(?:가능|해드립니다|해요|됩니다|보내드립니다)/u.exec(text);
    return Boolean(offer && !/(?:다른|별도|나머지)\s*(?:제품|상품|부품|물건)/u.test(text.slice(0, offer.index))
      && !reversed.test(text.slice(offer.index + offer[0].length)));
  };
  for (let index = 0; index < clauses.length; index++) {
    const clause = clauses[index];
    for (const match of clause.matchAll(restrictions)) {
      const before = clause.slice(0, match.index), after = clause.slice(match.index + match[0].length);
      if (reversed.test(after)) continue;
      // A destination or payment-method exception is not a blanket parcel ban.
      if (/^(?:택배|배송)/u.test(match[0]) && (limitedParcelScope.test(before) || limitedParcelRegion.test(after))) continue;
      const historical = /(?:예전|이전|과거|기존|종전)(?:에(?:는)?|엔|은|는)?\s*$/u.test(before)
        || /^\s*(?:였|이었|했|하였|가능했)/u.test(after);
      if (historical && (currentParcelOffer(after) || clauses.slice(index + 1).some(currentParcelOffer))) continue;
      // No global positive override: another item's offer or a negated
      // "택배 가능하지 않습니다" cannot cancel a current explicit restriction.
      return 'DELIVERY_LOCAL_ONLY';
    }
  }
  return null;
}
const VOID_TAGS = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
const RAW_TAGS = new Set(['script', 'style', 'textarea', 'title', 'noscript']);
const INERT_TAGS = new Set(['script', 'style', 'textarea', 'noscript', 'template']);

// Blocking responses are terminal for the caller's sequential trial. This
// module never retries, paginates, visits listings, or verifies checkout.
function failure(kind, reason, diagnostics = {}) {
  const error = new Error(`DAANGN_SEARCH_${kind}: ${reason}`);
  error.code = `DAANGN_SEARCH_${kind}`;
  error.stop = ['HTTP_403', 'HTTP_429', 'BLOCKED'].includes(kind);
  error.diagnostics = { ...diagnostics, reason };
  return error;
}
function parseFailure(reason, diagnostics) { return failure('PARSE_ERROR', reason, diagnostics); }
const TRANSIENT_TRANSPORT_CODES = new Set(['EAI_AGAIN', 'ECONNRESET', 'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']);
const RETRYABLE_SEARCH_CODES = new Set(['TIMEOUT', 'HTTP_500', 'HTTP_502', 'HTTP_503', 'HTTP_504']
  .map(kind => `DAANGN_SEARCH_${kind}`));
function errorField(value, key) {
  try { return value?.[key]; } catch { return undefined; }
}
function errorChain(error) {
  const chain = [], seen = new Set();
  while (error && typeof error === 'object' && chain.length < 8 && !seen.has(error)) {
    seen.add(error);
    chain.push(error);
    error = errorField(error, 'cause');
  }
  return chain;
}
function diagnosticCode(value) {
  return typeof value === 'string' && /^[A-Z][A-Z\d_]{0,79}$/u.test(value) ? value : null;
}
function diagnosticUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    const safe = `${url.origin}${url.pathname}`;
    return ['https:', 'http:'].includes(url.protocol) && safe.length <= 512 ? safe : null;
  } catch { return null; }
}
function diagnosticText(value, fallback = '') {
  if (typeof value !== 'string') return fallback;
  return value.slice(0, 1024).split(/[\r\n]/u, 1)[0]
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----.*/gu, '[REDACTED]')
    .replace(/https?:\/\/[^\s<>"']+/giu, url => diagnosticUrl(url) || '[URL]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z\d+/_=.-]+/giu, '[REDACTED]')
    .replace(/\b(?:authorization|proxy-authorization|cookie|set-cookie|[\w-]*(?:token|secret|password|passwd|api[-_]?key|credential)[\w-]*)\s*[:=].*/giu, '[REDACTED]')
    .replace(/\b[A-Z][A-Z\d_]*=[^\s]*/gu, '[REDACTED]')
    .replace(/[\u0000-\u001f\u007f]/gu, ' ').trim().slice(0, 256);
}

/** Bounded operator diagnostics only; never serialize the error object itself. */
export function daangnErrorDetails(error) {
  const chain = errorChain(error);
  const codes = chain.map(entry => diagnosticCode(errorField(entry, 'code')));
  // Fetch's TypeError usually keeps the transport code one cause further down.
  const cause = chain.slice(1).find(entry => diagnosticCode(errorField(entry, 'code'))) || chain[1];
  const diagnostics = errorField(error, 'diagnostics');
  const status = errorField(diagnostics, 'status');
  const terminal = chain.some((entry, index) => errorField(entry, 'code') != null
    && codes[index] !== 'DAANGN_SEARCH_FETCH_ERROR'
    && !TRANSIENT_TRANSPORT_CODES.has(codes[index]) && !RETRYABLE_SEARCH_CODES.has(codes[index]));
  const name = errorField(cause, 'name');
  return {
    code: diagnosticCode(errorField(error, 'code')) || 'UNKNOWN',
    message: diagnosticText(errorField(error, 'message'), 'Unknown error'),
    cause: cause ? {
      name: typeof name === 'string' && /^[A-Za-z][A-Za-z\d_.-]{0,63}$/u.test(name) ? name : 'Error',
      code: diagnosticCode(errorField(cause, 'code')),
      message: diagnosticText(errorField(cause, 'message')),
    } : null,
    diagnostics: {
      url: diagnosticUrl(errorField(diagnostics, 'url')),
      status: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
      reason: diagnosticText(errorField(diagnostics, 'reason')) || null,
    },
    retryable: !terminal && ![403, 429].includes(status)
      && codes.some(code => TRANSIENT_TRANSPORT_CODES.has(code) || RETRYABLE_SEARCH_CODES.has(code)),
  };
}
function normalize(value) { return String(value ?? '').replace(/\s+/gu, ' ').trim(); }
function entities(value) {
  const named = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', middot: '·' };
  return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp|middot);/giu, (whole, key) => {
    if (!key.startsWith('#')) return named[key.toLowerCase()];
    const point = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
      ? String.fromCodePoint(point) : '\ufffd';
  });
}
function attributes(source) {
  const result = Object.create(null);
  for (const match of source.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+)))?/gu)) {
    const key = match[1].toLowerCase();
    if (!(key in result)) result[key] = entities(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return result;
}

// An inert, bounded tree for the observed SSR cards, not a browser HTML5 DOM.
// Quoted '>' characters and raw script contents cannot open/close a card.
// Existing repository helpers are private TS/browser helpers or strip tags.
function htmlTree(html, diagnostics) {
  const root = { tag: '#document', attrs: {}, children: [], closed: true };
  const stack = [root];
  let cursor = 0, count = 0;
  const add = node => {
    if (++count > 100_000) throw parseFailure('HTML_NODE_LIMIT', diagnostics);
    const parent = stack.at(-1);
    parent.children.push(node);
    node.parent = parent;
  };
  while (cursor < html.length) {
    if (html.startsWith('<!--', cursor)) {
      const end = html.indexOf('-->', cursor + 4);
      if (end < 0) throw parseFailure('UNCLOSED_COMMENT', diagnostics);
      cursor = end + 3;
      continue;
    }
    if (html[cursor] !== '<') {
      let end = html.indexOf('<', cursor);
      if (end < 0) end = html.length;
      add({ tag: '#text', value: entities(html.slice(cursor, end)), children: [] });
      cursor = end;
      continue;
    }
    const start = /^<\/?([a-z][a-z\d:-]*)\b/iu.exec(html.slice(cursor, cursor + 128));
    if (!start && !html.startsWith('<!', cursor)) {
      add({ tag: '#text', value: '<', children: [] });
      cursor++;
      continue;
    }
    let end = cursor + 1, quote = null;
    for (; end < html.length; end++) {
      const char = html[end];
      if (quote) { if (char === quote) quote = null; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === '>') break;
    }
    if (end === html.length) throw parseFailure('UNCLOSED_TAG', diagnostics);
    const token = html.slice(cursor, end + 1);
    cursor = end + 1;
    if (!start) continue; // DOCTYPE/declarations.
    const tag = start[1].toLowerCase();
    if (token.startsWith('</')) {
      const index = stack.findLastIndex(node => node.tag === tag);
      if (index > 0) { stack[index].closed = true; stack.length = index; }
      continue;
    }
    const node = { tag, attrs: attributes(token.slice(start[0].length, -1)), children: [], closed: false };
    add(node);
    if (RAW_TAGS.has(tag)) {
      const closing = new RegExp(`</${tag}\\s*>`, 'giu');
      closing.lastIndex = cursor;
      const match = closing.exec(html);
      if (!match) throw parseFailure('UNCLOSED_RAW_ELEMENT', diagnostics);
      node.raw = html.slice(cursor, match.index);
      node.closed = true;
      cursor = closing.lastIndex;
    } else if (VOID_TAGS.has(tag) || token.endsWith('/>')) node.closed = true;
    else {
      if (stack.length >= 128) throw parseFailure('HTML_DEPTH_LIMIT', diagnostics);
      stack.push(node);
    }
  }
  return root;
}
function hasClass(node, value) { return (node.attrs?.class || '').split(/\s+/u).includes(value); }
function* descendants(root, includeInert = false) {
  const pending = [...root.children].reverse();
  while (pending.length) {
    const node = pending.pop();
    if (!includeInert && (INERT_TAGS.has(node.tag) || 'hidden' in (node.attrs || {}))) continue;
    yield node;
    for (let i = node.children.length - 1; i >= 0; i--) pending.push(node.children[i]);
  }
}
function nodeText(node) {
  if (node.tag === 'title') return normalize(entities(node.raw));
  return normalize([...descendants(node)].filter(child => child.tag === '#text').map(child => child.value).join(''));
}
function listingUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value, ORIGIN);
    if (url.protocol !== 'https:' || url.hostname !== 'www.daangn.com' || url.port || url.username || url.password) return null;
    const match = /^\/kr\/buy-sell\/([^/]+)\/?$/u.exec(url.pathname);
    if (!match) return null;
    const slug = decodeURIComponent(match[1]).normalize('NFC');
    if (/[/?#\\\u0000-\u0020]/u.test(slug)) return null;
    return `${ORIGIN}/kr/buy-sell/${encodeURIComponent(slug)}/`;
  } catch { return null; }
}
function imageUrl(value) {
  const candidate = Array.isArray(value) ? value[0] : value;
  const raw = typeof candidate === 'string' ? candidate : candidate?.url;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
function schemaType(value, type) {
  return (Array.isArray(value) ? value : [value]).some(entry =>
    entry === type || entry === `https://schema.org/${type}` || entry === `http://schema.org/${type}`);
}
function blockedPage(root) {
  const nodes = [...descendants(root, true)];
  if (nodes.some(node => /(?:^|\s)(?:g-recaptcha|h-captcha|cf-turnstile|cf-challenge|cf-chl\S*|challenge-form)(?:\s|$)/iu
    .test(`${node.attrs?.id || ''} ${node.attrs?.class || ''}`)
    || (['script', 'iframe'].includes(node.tag)
      && /(?:\/cdn-cgi\/challenge-platform\/|(?:recaptcha|hcaptcha)\.[^/]+\/|\/recaptcha\/)/iu.test(node.attrs?.src || '')))) return true;
  const text = [];
  // A listing named "captcha" is product text, not an access challenge.
  const pending = [root];
  while (pending.length) {
    const node = pending.pop();
    if (INERT_TAGS.has(node.tag) || (node.tag === 'a' && listingUrl(node.attrs.href))) continue;
    if (node.tag === '#text') text.push(node.value);
    else if (node.tag === 'title') text.push(entities(node.raw));
    for (let i = node.children.length - 1; i >= 0; i--) pending.push(node.children[i]);
  }
  return /\bcaptcha\b|access denied|too many requests|verify (?:that )?you are human|checking your browser|자동\s*입력\s*방지|로봇이\s*아닌|비정상적인\s*(?:접근|요청)|접근이\s*차단/iu.test(text.join(' '));
}
function cardEvidence(anchor) {
  const nodes = [...descendants(anchor)];
  const title = nodes.find(node => hasClass(node, 'seed-text--textStyle_t5Regular'));
  const price = nodes.find(node => hasClass(node, 'seed-text--textStyle_t5Bold'));
  if (!anchor.closed || !title || !price
    || nodes.some(node => node.tag === 'a' || (node.tag !== '#text' && !node.closed))) return null;
  const buyNow = nodes.some(node => node.tag === 'span' && hasClass(node, 'seed-text--textStyle_t1Bold')
    && nodeText(node) === '바로구매' && hasClass(node.parent, 'seed-box')
    && node.parent.children.some(child => child.tag === 'svg' && child.attrs['data-seed-icon'] === 'true'));
  const group = nodes.find(node => hasClass(node, 'seed-tag-group__root'));
  const first = group?.children.find(node => hasClass(node, 'seed-tag-group-item__root'));
  const label = first && [...descendants(first)].find(node => hasClass(node, 'seed-tag-group-item__label'));
  const location = label && ![...descendants(label)].some(node => node.tag === 'time') ? nodeText(label) : '';
  return { buyNow, location: /^(?:|[-—–]|미상|지역\s*(?:미상|정보\s*없음)|알\s*수\s*없음|unknown)$/iu.test(location) ? null : location };
}

// Observed 2026-11-10 KST: a zero-result response has no JSON-LD at all.
// Require the visible empty component plus the search heading and active
// buy/sell tab, not a phrase in a script, listing, footer or hidden template.
function explicitEmptyResult(root, query, searchArea) {
  const main = [...descendants(root)].find(node => node.tag === 'main');
  if (!main) return false;
  const nodes = [...descendants(main)];
  if (nodes.some(node => node.tag === 'a' && listingUrl(node.attrs.href))) return false;
  const heading = nodes.some(node => node.tag === 'h1' && (query
    ? nodeText(node) === normalize(`“${query}” 중고거래 검색 결과`) : nodeText(node).endsWith('중고거래 검색 결과')));
  const tab = nodes.some(node => {
    if (node.tag !== 'a' || node.attrs['aria-current'] !== 'page') return false;
    try {
      const link = new URL(node.attrs.href, ORIGIN);
      return link.origin === ORIGIN && link.pathname === '/kr/search/buy-sell/'
        && (!query || link.searchParams.get('q') === query)
        && (!searchArea || link.searchParams.get('in') === searchArea);
    } catch { return false; }
  });
  return heading && tab && nodes.some(node => node.tag === 'span' && node.closed
    && nodeText(node) === '검색 결과가 없어요.' && node.parent.tag === 'div'
    && (node.parent.attrs.class || '').split(/\s+/u).some(value => value.startsWith('sprinkles_flexDirection_column_base__'))
    && nodeText(node.parent) === '검색 결과가 없어요.');
}

/** Public SSR observations only. diagnostics is an object, including missing
 * locations and join/exclusion counts; search_area never supplies location.
 * Only the observed explicit empty-search component permits absent cards.
 */
export function parseDaangnSearchHtml(html, {
  observedAt = new Date().toISOString(), query = '', searchArea = DAANGN_DEFAULT_AREA, url = '',
} = {}) {
  const diagnostics = { url, query, search_area: searchArea, observed_at: observedAt,
    scope: 'PUBLIC_SEARCH_PAGE', exhaustive: false, checkout_verified: false,
    html_bytes: typeof html === 'string' ? Buffer.byteLength(html) : 0,
    jsonld_item_count: 0, card_count: 0, buy_now_card_count: 0, joined_count: 0,
    unmatched_jsonld_count: 0, unmatched_card_count: 0, excluded_no_buy_now_count: 0,
    excluded_not_in_stock_count: 0, missing_location_count: 0, jsonld_parse_error_count: 0,
    empty_result: false, empty_reason: null };
  if (typeof html !== 'string' || !html.trim()) throw parseFailure('HTML_REQUIRED', diagnostics);
  if (diagnostics.html_bytes > DAANGN_SEARCH_MAX_BYTES) throw failure('BODY_LIMIT', 'HTML exceeds 4 MiB', diagnostics);
  if (!Number.isFinite(Date.parse(observedAt))) throw parseFailure('INVALID_OBSERVED_AT', diagnostics);
  const root = htmlTree(html, diagnostics);
  if (blockedPage(root)) throw failure('BLOCKED', 'Public page contains an access challenge; stop the trial', diagnostics);
  const explicitEmpty = explicitEmptyResult(root, query, searchArea);
  const allNodes = [...descendants(root, true)];
  const lists = [];
  for (const script of allNodes.filter(node => node.tag === 'script'
    && normalize(node.attrs.type).toLowerCase() === 'application/ld+json')) {
    let parsed;
    try { parsed = JSON.parse(script.raw); }
    catch {
      diagnostics.jsonld_parse_error_count++;
      if (!explicitEmpty) throw parseFailure('INVALID_JSONLD', diagnostics);
      continue;
    }
    const pending = [parsed];
    while (pending.length) {
      const value = pending.pop();
      if (Array.isArray(value)) { for (const entry of value) pending.push(entry); }
      else if (value && typeof value === 'object') {
        if (schemaType(value['@type'], 'ItemList')) lists.push(value);
        if (value['@graph']) pending.push(value['@graph']);
      }
    }
  }
  if (explicitEmpty) {
    if (lists.some(list => Array.isArray(list.itemListElement) && list.itemListElement.length)) {
      throw parseFailure('EMPTY_MARKER_CONTRADICTS_JSONLD', diagnostics);
    }
    return { items: [], diagnostics: { ...diagnostics, item_count: 0, empty_result: true,
      empty_reason: 'EXPLICIT_NO_RESULTS', empty_marker: '검색 결과가 없어요.' } };
  }
  if (!lists.length) throw parseFailure('ITEMLIST_MISSING', diagnostics);
  const products = new Map();
  for (const list of lists) {
    if (!Array.isArray(list.itemListElement)) throw parseFailure('ITEMLIST_ELEMENTS_MISSING', diagnostics);
    for (const entry of list.itemListElement) {
      const item = entry?.item ?? entry;
      const canonical = listingUrl(item?.url);
      if (!canonical) throw parseFailure('INVALID_LISTING_URL', diagnostics);
      const normalizedItem = { ...item, url: canonical };
      const previous = products.get(canonical);
      if (previous && JSON.stringify(previous) !== JSON.stringify(normalizedItem)) throw parseFailure('CONFLICTING_JSONLD', diagnostics);
      products.set(canonical, normalizedItem);
    }
  }
  diagnostics.jsonld_item_count = products.size;
  const cards = new Map();
  for (const anchor of descendants(root)) {
    if (anchor.tag !== 'a') continue;
    const canonical = listingUrl(anchor.attrs.href);
    if (!canonical) continue;
    const evidence = cardEvidence(anchor);
    if (!evidence) continue;
    const previous = cards.get(canonical);
    if (previous && (previous.buyNow !== evidence.buyNow || previous.location !== evidence.location)) {
      throw parseFailure('CONFLICTING_CARDS', diagnostics);
    }
    cards.set(canonical, evidence);
  }
  diagnostics.card_count = cards.size;
  diagnostics.buy_now_card_count = [...cards.values()].filter(card => card.buyNow).length;
  diagnostics.unmatched_card_count = [...cards.keys()].filter(key => !products.has(key)).length;
  if (!products.size || !cards.size) throw parseFailure('SEARCH_STRUCTURE_MISSING', diagnostics);
  const items = [];
  for (const [canonical, product] of products) {
    const card = cards.get(canonical);
    if (!card) { diagnostics.unmatched_jsonld_count++; continue; }
    diagnostics.joined_count++;
    if (!card.buyNow) { diagnostics.excluded_no_buy_now_count++; continue; }
    const offer = Array.isArray(product.offers) && product.offers.length === 1 ? product.offers[0] : product.offers;
    if (!offer || typeof offer !== 'object' || Array.isArray(offer)) throw parseFailure('OFFER_SHAPE_MISSING', diagnostics);
    if (typeof offer.availability !== 'string' || !schemaType(offer.availability, 'InStock')) {
      diagnostics.excluded_not_in_stock_count++;
      continue;
    }
    const title = typeof product.name === 'string' ? normalize(product.name) : '';
    const rawPrice = offer.price;
    const price = typeof rawPrice === 'number' || (typeof rawPrice === 'string' && /^\d+(?:\.\d+)?$/u.test(rawPrice.trim()))
      ? Number(rawPrice) : NaN;
    const currency = typeof offer.priceCurrency === 'string' ? offer.priceCurrency.trim().toUpperCase() : '';
    if (!title || !Number.isFinite(price) || price < 0 || price > Number.MAX_SAFE_INTEGER || !/^[A-Z]{3}$/u.test(currency)) {
      throw parseFailure('PRODUCT_FIELDS_INVALID', diagnostics);
    }
    if (!card.location) diagnostics.missing_location_count++;
    const slug = decodeURIComponent(new URL(canonical).pathname.split('/')[3]);
    items.push({ id: slug.match(/-([a-z\d]+)$/iu)?.[1] || slug, url: canonical, title, price, currency,
      location: card.location, description: typeof product.description === 'string' ? product.description : '',
      image_url: imageUrl(product.image), lifecycle_status: 'ACTIVE', shipping_evidence: 'BUY_NOW_BADGE',
      shipping_fee: null, observed_at: observedAt, query, search_area: searchArea });
  }
  if (!diagnostics.joined_count) throw parseFailure('NO_CANONICAL_JOIN', diagnostics);
  diagnostics.item_count = items.length;
  diagnostics.empty_result = items.length === 0;
  if (!items.length) diagnostics.empty_reason = 'NO_ELIGIBLE_BUY_NOW_IN_STOCK';
  return { items, diagnostics };
}

function abortable(promise, signal) {
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    signal.addEventListener('abort', aborted, { once: true });
    Promise.resolve(promise).then(value => {
      signal.removeEventListener('abort', aborted);
      if (signal.aborted) reject(signal.reason); else resolve(value);
    }, error => { signal.removeEventListener('abort', aborted); reject(error); });
    if (signal.aborted) aborted();
  });
}
function cancelBody(response) {
  try { void response?.body?.cancel().catch(() => {}); } catch { /* already locked/closed */ }
}

/** One anonymous GET; 15 s covers headers + streamed body. Errors have .code,
 * .diagnostics and .stop (true for HTTP 403/429 or an access challenge).
 */
export async function fetchDaangnSearch(query, { signal, fetchImpl = fetch, area = DAANGN_DEFAULT_AREA } = {}) {
  if (typeof query !== 'string' || !query.trim()) throw failure('QUERY_REQUIRED', 'A nonempty query is required');
  if (area !== null && (typeof area !== 'string' || !area.trim())) throw failure('AREA_REQUIRED', 'An explicit search area must be nonempty');
  signal?.throwIfAborted();
  const url = new URL('/kr/search/buy-sell/', ORIGIN);
  url.search = new URLSearchParams({ ...(area === null ? {} : { in: area }), only_on_sale: 'true', q: query }).toString();
  const controller = new AbortController();
  const deadline = Date.now() + DAANGN_SEARCH_TIMEOUT_MS;
  const timeout = () => controller.abort(failure('TIMEOUT', 'Public search exceeded 15 seconds'));
  const timer = setTimeout(timeout, DAANGN_SEARCH_TIMEOUT_MS);
  const aborted = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', aborted, { once: true });
  let response, reader, finished = false;
  try {
    response = await abortable(Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return fetchImpl(url.href, { method: 'GET', redirect: 'error', credentials: 'omit',
        headers: { accept: 'text/html' }, signal: controller.signal });
    }).then(result => {
      if (controller.signal.aborted) { cancelBody(result); throw controller.signal.reason; }
      return result;
    }), controller.signal);
    const diagnostic = { url: url.href, status: response.status };
    if ([403, 429].includes(response.status)) throw failure(`HTTP_${response.status}`, 'Public search refused access; stop the trial', diagnostic);
    if (response.headers.get('cf-mitigated') === 'challenge') throw failure('BLOCKED', 'Public search requires a challenge; stop the trial', diagnostic);
    if (response.redirected || (response.status >= 300 && response.status < 400)) throw failure('REDIRECT', 'Redirects are not allowed', diagnostic);
    const retryableHttp = RETRYABLE_SEARCH_CODES.has(`DAANGN_SEARCH_HTTP_${response.status}`);
    if (!response.ok && !retryableHttp) throw failure(`HTTP_${response.status}`, 'Public search HTTP failure', diagnostic);
    if (response.url && response.url !== url.href) throw failure('RESPONSE_URL_MISMATCH', 'Unexpected response target', diagnostic);
    const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (!retryableHttp && contentType && contentType !== 'text/html') throw parseFailure('RESPONSE_NOT_HTML', diagnostic);
    if (Number(response.headers.get('content-length')) > DAANGN_SEARCH_MAX_BYTES) throw failure('BODY_LIMIT', 'Content-Length exceeds 4 MiB', diagnostic);
    if (retryableHttp && response.body === null) throw failure(`HTTP_${response.status}`, 'Public search HTTP failure', diagnostic);
    if (!response.body?.getReader) throw parseFailure('READABLE_BODY_REQUIRED', diagnostic);
    reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    while (true) {
      const part = await abortable(reader.read(), controller.signal);
      if (part.done) { finished = true; break; }
      if (!(part.value instanceof Uint8Array)) throw parseFailure('NON_BYTE_BODY', diagnostic);
      bytes += part.value.byteLength;
      if (bytes > DAANGN_SEARCH_MAX_BYTES) throw failure('BODY_LIMIT', 'Streamed HTML exceeds 4 MiB', diagnostic);
      chunks.push(Buffer.from(part.value));
    }
    const html = Buffer.concat(chunks, bytes).toString('utf8');
    // Transient HTTP status alone cannot override an access challenge in its body.
    // Reuse the bounded stream and challenge evidence without requiring search results.
    if (retryableHttp) {
      if (blockedPage(htmlTree(html, diagnostic))) throw failure('BLOCKED', 'Public page contains an access challenge; stop the trial', diagnostic);
      if (Date.now() >= deadline) timeout();
      controller.signal.throwIfAborted();
      throw failure(`HTTP_${response.status}`, 'Public search HTTP failure', diagnostic);
    }
    const result = parseDaangnSearchHtml(html, {
      observedAt: new Date().toISOString(), query, searchArea: area, url: url.href,
    });
    if (Date.now() >= deadline) timeout();
    controller.signal.throwIfAborted();
    result.diagnostics.status = response.status;
    return result;
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    if (diagnosticCode(errorField(error, 'code'))?.startsWith('DAANGN_SEARCH_')) throw error;
    const redirect = !response && errorChain(error).some(entry => errorField(entry, 'message') === 'unexpected redirect');
    const wrapped = failure(redirect ? 'REDIRECT' : 'FETCH_ERROR',
      redirect ? 'Redirects are not allowed' : 'Public search request or stream failed', { url: url.href });
    wrapped.cause = error;
    throw wrapped;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', aborted);
    if (reader) {
      if (!finished) void reader.cancel().catch(() => {});
      reader.releaseLock();
    } else cancelBody(response);
    // Also terminate transport on size/parse failures. Cancellation is deliberately
    // not awaited: a noncooperative injected stream cannot extend the deadline.
    if (!controller.signal.aborted) controller.abort();
  }
}
