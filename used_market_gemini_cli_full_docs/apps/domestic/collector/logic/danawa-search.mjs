import { createHash } from 'node:crypto';
import { classifyPcPartListingPublic } from '../../market/logic/pc-parts-classifier.mjs';
import { DANAWA_COLLECTION_LIMITS } from './pc-source-registry.mjs';

const BASE = 'https://prod.danawa.com';
export const DANAWA_REQUEST_MIN_INTERVAL_MS = DANAWA_COLLECTION_LIMITS.requestIntervalMs;

export function createDanawaPacedFetch({ fetchImpl = fetch, now = Date.now,
  wait = (ms) => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  let previous = Promise.resolve();
  let lastRequestedAt = -Infinity;
  return (input, init = {}) => {
    const request = previous.catch(() => {}).then(async () => {
      init.signal?.throwIfAborted();
      const remaining = DANAWA_REQUEST_MIN_INTERVAL_MS - (now() - lastRequestedAt);
      if (remaining > 0) await wait(remaining);
      init.signal?.throwIfAborted();
      lastRequestedAt = now();
      return fetchImpl(input, init);
    });
    previous = request;
    return request;
  };
}

export async function collectDanawaSearchTargetBatch({ targets, collectTarget, signal } = {}) {
  const settled = [];
  let structuralFailures = 0;
  for (const target of targets.slice(0, DANAWA_COLLECTION_LIMITS.targetsPerRun)) {
    signal?.throwIfAborted();
    try {
      settled.push({ status: 'fulfilled', value: await collectTarget(target) });
      structuralFailures = 0;
    } catch (reason) {
      signal?.throwIfAborted();
      settled.push({ status: 'rejected', reason });
      const message = reason instanceof Error ? reason.message : String(reason);
      if (/DANAWA_SEARCH_(?:HTTP_(?:403|429)|BLOCKED)\b/iu.test(message)) break;
      if (danawaPartialItems([{ status: 'rejected', reason }]).length) { structuralFailures = 0; continue; }
      if (/DANAWA_SEARCH_(?:MARKUP_UNRECOGNIZED|NO_CARDS_UNVERIFIED)/u.test(message) && ++structuralFailures >= 2) break;
    }
  }
  return settled;
}

// A failed target remains failed even when some independently verified offers
// survived. Callers can persist those offers without advancing target success.
export function danawaPartialItems(settled) {
  return settled.filter(row => row.status === 'rejected'
    && /^DANAWA_SEARCH_MARKUP_UNRECOGNIZED:/u.test(String(row.reason?.message || ''))
    && Array.isArray(row.reason?.partial_items)).flatMap(row => row.reason.partial_items);
}

function text(html) {
  return String(html || '').replace(/<\/?(?:p|div|li|br|dl|dd|dt)\b[^>]*>/giu, ' ')
    .replace(/<[^>]*>/gu, '').replace(/&amp;/gu, '&')
    .replace(/&quot;/gu, '"').replace(/&#39;/gu, "'").replace(/&nbsp;/gu, ' ')
    .replace(/\s+/gu, ' ').trim();
}
function attr(tag, name) {
  return tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'iu'))?.[2]?.replace(/&amp;/gu, '&') || '';
}
// Match complete elements, including nested lists inside a product card.
function elements(html, tag, className) {
  const result = [];
  const pattern = new RegExp(`<\\/?${tag}\\b[^>]*>`, 'giu');
  let depth = 0, start = -1;
  for (const match of String(html).matchAll(pattern)) {
    const closing = match[0].startsWith('</');
    if (start < 0) {
      if (!closing && attr(match[0], 'class').split(/\s+/u).includes(className)) {
        start = match.index; depth = 1;
      }
    } else {
      depth += closing ? -1 : 1;
      if (!depth) { result.push(html.slice(start, match.index + match[0].length)); start = -1; }
    }
  }
  return result;
}
function classBlock(html, className, tag = 'p') { return elements(html, tag, className)[0] || ''; }

function productUrl(value) {
  try {
    const url = new URL(value, BASE);
    if (url.protocol !== 'https:' || url.hostname !== 'prod.danawa.com' || url.username || url.password || url.port) return null;
    if (url.pathname === '/info/' && /^\d+$/u.test(url.searchParams.get('pcode') || '')) return url;
    if (url.pathname === '/bridge/go_link_goods.php' && url.searchParams.get('cmpny_c') && url.searchParams.get('link_prod_c')) return url;
  } catch {}
  return null;
}

// Small inert tree for the observed search-card HTML; no script execution or
// browser/API fallback. Parent boundaries bind each capacity to its own price.
function cardTree(html) {
  const root = { tag: '', children: [] }, stack = [root];
  const voidTags = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
  for (const token of html.matchAll(/<!--[^]*?-->|<\/?([a-z][a-z0-9:-]*)\b[^>]*>/giu)) {
    if (!token[1]) continue;
    const tag = token[1].toLowerCase();
    if (token[0].startsWith('</')) {
      const index = stack.findLastIndex(node => node.tag === tag);
      if (index > 0) { stack[index].end = token.index + token[0].length; stack.length = index; }
    } else {
      const parent = stack.at(-1);
      const node = { tag, opening: token[0], start: token.index, end: token.index + token[0].length, parent, children: [] };
      parent.children.push(node);
      if (!voidTags.has(tag) && !token[0].endsWith('/>')) stack.push(node);
    }
  }
  return root;
}
function descendants(node) { return node.children.flatMap(child => [child, ...descendants(child)]); }
function hasClass(node, value) { return attr(node.opening || '', 'class').split(/\s+/u).includes(value); }
function escapeHtml(value) { return String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'); }
function textKind(label) {
  return /^[\d,]+\s*원$/u.test(label) ? 'KRW_AMOUNT' : /배송/u.test(label) ? 'SHIPPING'
    : /원\s*\//u.test(label) ? 'UNIT_PRICE' : /^단종(?:상품)?$/u.test(label) ? 'DISCONTINUED' : label ? 'OTHER' : 'EMPTY';
}
// Diagnostic shape of an unsupported title link: attribute names, scheme, host,
// Danawa path and parameter names only. Never values, external paths or tokens.
function linkShape(opening) {
  const opaque = part => part.replace(/[A-Za-z0-9_-]{25,}/gu, ':id');
  const shape = { attributes: [...opening.matchAll(/\s([a-z][a-z0-9_:-]{0,23})\s*=/giu)]
    .map(match => match[1].toLowerCase()).filter((name, i, names) => names.indexOf(name) === i).slice(0, 12) };
  const href = opening.match(/\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/iu);
  if (!href) return { ...shape, target: 'MISSING' };
  const value = (href[1] ?? href[2] ?? href[3]).replace(/&amp;/gu, '&');
  shape.target = href[3] === undefined ? 'QUOTED' : 'UNQUOTED';
  shape.relative = !/^[a-z][a-z0-9+.-]*:/iu.test(value.trim());
  try {
    const url = new URL(value, BASE);
    shape.scheme = /^[a-z][a-z0-9+.-]{0,15}:$/iu.test(url.protocol) ? url.protocol.slice(0, -1).toLowerCase() : 'OTHER';
    shape.host = opaque(url.hostname.split('.').slice(-3).join('.')).slice(0, 64);
    shape.path = /(?:^|\.)danawa\.com$/u.test(url.hostname) ? opaque(url.pathname).replace(/\d/gu, '0').slice(0, 64) : null;
    shape.param_keys = [...new Set(url.searchParams.keys())].filter(key => /^[a-z][a-z0-9_]{0,23}$/iu.test(key)).sort().slice(0, 12);
  } catch { shape.scheme = 'UNPARSEABLE'; }
  return shape;
}
// Result tabs are fixed page chrome. Keep short letter-only labels, counts and selection.
function searchTabs(html) {
  const nav = elements(String(html).slice(0, 4 * 1024 * 1024), 'nav', 'flex').find(part => /\bborder-t\b/u.test(part));
  return nav ? elements(nav, 'button', 'border-t').slice(0, 6).map(button => {
    const [label = '', count = ''] = [...button.matchAll(/<span\b[^>]*>([^<]*)<\/span>/giu)].map(match => text(match[1]));
    return { label: /^[가-힣A-Za-z]{1,8}$/u.test(label) ? label : 'OTHER',
      count: /^\(?[\d,]{1,9}\)?$/u.test(count) ? Number(count.replace(/\D/gu, '')) : null,
      selected: attr(button.match(/<button\b[^>]*>/iu)?.[0] || '', 'class').split(/\s+/u).includes('font-bold') };
  }) : null;
}

export function modernSearchCards(html, { trace = false } = {}) {
  const result = { cards: [], count: 0, unrecognized: 0 };
  if (trace) result.trace = [];
  for (const card of elements(String(html), 'li', 'border-b')) {
    const nodes = descendants(cardTree(card));
    const raw = node => node ? card.slice(node.start, node.end) : '';
    const value = node => text(raw(node));
    const fail = (reason, node, count = true, extra = {}) => {
      if (count) result.unrecognized++;
      if (!trace || result.trace.length >= 8) return;
      const shape = part => part ? { tag: part.tag,
        classes: attr(part.opening || '', 'class').split(/\s+/u).filter(c => /^[a-z][a-z_-]{1,48}$/iu.test(c)).slice(0,8) } : null;
      result.trace.push({ reason, node: shape(node), children: (node?.children || []).slice(0,6).map(shape),
        text_kind: textKind(value(node)), ...extra });
    };
    const name = nodes.find(node => node.tag === 'a' && node.parent.tag === 'p'
      && hasClass(node,'font-bold') && productUrl(attr(node.opening,'href')));
    if (!name) {
      // A title link to an unsupported destination is not product evidence and
      // is not counted. Trace only its bounded shape for layout diagnosis.
      const titleLink = trace && nodes.find(node => node.tag === 'a' && node.parent.tag === 'p' && hasClass(node,'font-bold'));
      if (titleLink) {
        const priceLink = nodes.find(node => node.tag === 'a' && hasClass(node,'flex') && (hasClass(node,'flex-col') || hasClass(node,'font-bold')));
        const amount = priceLink && descendants(priceLink).find(node => node.tag === 'span' && hasClass(node,'font-bold'));
        fail('TITLE_LINK', titleLink, false, { link: linkShape(titleLink.opening),
          price_link: priceLink ? { same_target: attr(priceLink.opening,'href') === attr(titleLink.opening,'href'),
            text_kind: textKind(value(amount || priceLink)) } : null });
      }
      continue;
    }
    result.count++;
    const title = value(name), titleUrl = productUrl(attr(name.opening,'href'));
    const info = name.parent.parent;
    const specNode = info.children[info.children.indexOf(name.parent) + 1];
    const specs = specNode?.tag === 'div' && !hasClass(specNode,'text-xs') ? value(specNode).replace(/닫기\s*$/u,'').trim() : '';
    const category = nodes.find(node => node.tag === 'dl' && /상품분류/u.test(value(node)));
    const storageCategory = value(category).match(/>\s*(SSD|HDD)\s*$/u)?.[1] || '';
    // Transfer rates (e.g. SATA 6Gb/s) are not additional storage capacities.
    const productSpecs = storageCategory ? `${storageCategory} ${specs.split(/\[(?:성능|지원기능|환경특성)\]/u)[0]}`
      .replace(/\b\d+(?:\.\d+)?\s*[GM]B\/s\b/giu, '').split('/')
      .filter(part => !/DDR|DRAM|SLC|TBW|ECC/iu.test(part)).join(' / ') : specs;
    const offers = [];
    let unavailableOption = false;
    if (titleUrl.pathname === '/info/') {
      for (const priceLink of nodes.filter(node => node.tag === 'a' && hasClass(node,'flex') && hasClass(node,'font-bold'))) {
        const url = productUrl(attr(priceLink.opening,'href'));
        const amount = value(priceLink).match(/^([\d,]+)\s*원$/u);
        if (hasClass(priceLink,'line-through')) continue;
        const group = priceLink.parent.parent;
        if (url?.pathname === '/info/' && value(priceLink) === '단종'
            && descendants(group).some(node => node.tag === 'span' && value(node) === '0몰')) {
          unavailableOption = true; continue;
        }
        if (!url || url.pathname !== '/info/') { fail('CATALOG_URL', priceLink); continue; }
        if (!amount) { fail('CATALOG_AMOUNT', priceLink); continue; }
        const variant = descendants(group).find(node => node.tag === 'span' && hasClass(node,'truncate'));
        if (/\bDDR[345]/iu.test(title) && !/메인보드/u.test(value(category)) && !/\d+\s*(?:GB|기가)/iu.test(title)
            && !/\d+\s*(?:GB|기가)/iu.test(value(variant))) { fail('RAM_CAPACITY', variant); continue; }
        offers.push({ url, price: amount[1], variant: value(variant) });
      }
    } else {
      for (const priceLink of nodes.filter(node => node.tag === 'a' && hasClass(node,'flex-col'))) {
        const url = productUrl(attr(priceLink.opening,'href'));
        if (!url || url.pathname !== titleUrl.pathname || ['cmpny_c','link_prod_c'].some(key => url.searchParams.get(key) !== titleUrl.searchParams.get(key))) {
          fail('SHOP_IDENTITY', priceLink, false); continue;
        }
        // An optional leading SVG is decorative. Keep the same content/row
        // boundaries: the first row is the item amount, the next is shipping.
        const priceContent = priceLink.children.find(node => node.tag !== 'svg');
        const priceRow = priceContent?.tag === 'div' ? priceContent.children[0] : undefined;
        const amountNode = priceRow?.children.find(node => node.tag === 'span' && hasClass(node,'font-bold'));
        const amount = value(amountNode).match(/^([\d,]+)\s*원$/u);
        if (amount) offers.push({ url, price: amount[1], variant: '' });
        else fail('SHOP_AMOUNT', amountNode || priceRow || priceLink, false);
      }
    }
    if (!offers.length && !unavailableOption && /중고|\bused\b/iu.test(title)
        && !nodes.some(node => node.tag === 'span' && hasClass(node,'whitespace-nowrap') && hasClass(node,'font-bold') && value(node) === '단종상품')) {
      fail('USED_NO_OFFER', null);
    }
    for (const offer of offers) result.cards.push(`<li class="prod_item"><p class="prod_name"><a href="${escapeHtml(offer.url)}">${escapeHtml(`${title}${/중고|\bused\b/iu.test(offer.variant) ? ` ${offer.variant}` : ''}`)}</a></p>`
      + `<div class="spec_list">${escapeHtml(productSpecs.trim())}</div><p class="memory_sect">${escapeHtml(offer.variant)}</p>`
      + `<p class="price_sect"><strong>${offer.price}</strong></p><dl class="prod_category_location">${escapeHtml(value(category))}</dl></li>`);
  }
  return result;
}

// Diagnostic specimens from public product cards only. Retain the fields the
// collector already consumes, never scripts, forms, search terms or tracking URLs.
export function danawaPublicCardEvidence(html, cardDiagnostics = null) {
  const titleLink = parsed => parsed.trace?.some(failure => failure.reason === 'TITLE_LINK') || false;
  return elements(String(html).slice(0, 4 * 1024 * 1024), 'li', 'border-b')
    .map(card => ({ card, parsed: modernSearchCards(card, {trace: Boolean(cardDiagnostics)}) }))
    // Diagnostics also keep title-shaped cards whose link is unsupported; their
    // href is removed below like every other non-allowlisted link.
    .filter(({ card, parsed }) => titleLink(parsed) || [...card.matchAll(/<a\b[^>]*>/giu)].some(match => {
      try { const url = new URL(attr(match[0], 'href'), BASE);
        return url.hostname === 'prod.danawa.com' && ['/info/', '/bridge/go_link_goods.php'].includes(url.pathname);
      } catch { return false; }
    }))
    .sort((a, b) => b.parsed.unrecognized - a.parsed.unrecognized || titleLink(b.parsed) - titleLink(a.parsed))
    .slice(0, 3).map(({ card, parsed }) => {
      cardDiagnostics?.push({ product_count: parsed.count, unrecognized_count: parsed.unrecognized, failures: parsed.trace,
        ...(titleLink(parsed) ? { search_tabs: searchTabs(html) } : {}) });
      return card
      .replace(/<!--[^]*?-->/gu, '')
      .replace(/<(script|style|form|textarea)\b[^>]*>[^]*?<\/\1\s*>/giu, '')
      .replace(/<\/?([a-z][a-z0-9]*)\b[^>]*>/giu, (tag, name) => {
        name = name.toLowerCase();
        if (['input', 'img', 'svg', 'path', 'g', 'defs', 'clippath'].includes(name)) return '';
        if (tag.startsWith('</')) return `</${name}>`;
        const classes = attr(tag, 'class').split(/\s+/u).filter(value => /^[a-z][a-z_-]{1,48}$/iu.test(value)).slice(0, 8);
        let href = '';
        if (name === 'a') try {
          const url = new URL(attr(tag, 'href'), BASE);
          if (url.protocol === 'https:' && url.hostname === 'prod.danawa.com' && !url.username && !url.password && !url.port
              && ['/info/', '/bridge/go_link_goods.php'].includes(url.pathname)) {
            for (const key of [...url.searchParams.keys()]) if (!['pcode','cmpny_c','link_prod_c'].includes(key)) url.searchParams.delete(key);
            url.hash = ''; href = ` href="${url.toString().replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"`;
          }
        } catch {}
        return `<${name}${classes.length ? ` class="${classes.join(' ')}"` : ''}${href}>`;
      }).slice(0, 24576);
    });
}
function normalizedTitle(value) {
  return value.normalize('NFKC').toUpperCase().replace(/중고(?:메모리)?|\[|\]|\(|\)/gu, ' ')
    .split(/\s+/u).filter(Boolean).filter((token, i, tokens) => tokens.indexOf(token) === i).join(' ');
}
function variantKey(item) {
  const classified = classifyPcPartListingPublic({ ...item, seller_type: null });
  const combined = `${item.title} ${item.description}`;
  if (classified.category_code === 'RAM' && classified.canonical_product_id) {
    const clock = combined.match(/(?:DDR[345][ -]*|PC5-)([2-9]\d{3})(?!\d)/iu)?.[1]
      || combined.match(/\b([2-9]\d{3})\s*(?:MHz|\()/iu)?.[1] || '';
    const layout = /노트북|SO[- ]?DIMM/iu.test(combined) ? 'SODIMM' : 'DIMM';
    return `RAM:${classified.canonical_manufacturer || classified.manufacturer || normalizedTitle(item.title)}:${classified.canonical_product_id}:${clock}:${layout}`;
  }
  if (['CPU', 'MOTHERBOARD'].includes(classified.category_code) && classified.canonical_product_id) return classified.canonical_product_id;
  if (classified.category_code === 'GPU' && classified.canonical_product_id) {
    return `${classified.canonical_product_id}:${classified.board_brand || 'UNSPECIFIED'}:${classified.vram_gb || ''}`;
  }
  if (['SSD', 'HDD'].includes(classified.category_code) && classified.canonical_product_id) {
    const hardwareModel = item.title.match(/\b(?:[PS]M\d{3,4}[A-Z0-9]*|SN\d{3,4}X?|ST\d{4,}[A-Z0-9]*|WD\d{2,}[A-Z0-9]*|(?:8[67]0|9[789]0)\s*(?:EVO\s*PLUS|EVO|PRO|QVO)|P(?:31|41))\b/iu)?.[0];
    if (hardwareModel) return `${classified.canonical_product_id}:${normalizedTitle(hardwareModel)}:${classified.marketed_capacity_gb}`;
  }
  return `${normalizedTitle(item.title)}:${normalizedTitle(item.source_variant || '')}`;
}

export function parseDanawaSearchHtml(html, { categoryCode = '', query = '' } = {}) {
  const cards = [...elements(String(html), 'li', 'prod_item'), ...modernSearchCards(html).cards];
  const candidates = [];
  for (const card of cards) {
    const name = classBlock(card, 'prod_name');
    const originalTitle = text(name);
    let title = originalTitle.replace(/(?:마이크론|\bMicron\b)\s+(Crucial|크루셜)/giu, '$1');
    if (!/(?:중고|\bused\b)/iu.test(title) || /\[해외\]|해외\s*(?:배송|직구|구매|상품)/iu.test(title)
      || /CPU[^+]*\+[^+]*쿨러/iu.test(title)) continue;
    const href = attr(name.match(/<a\b[^>]*>/iu)?.[0] || '', 'href');
    let url;
    try { url = new URL(href, BASE); } catch { continue; }
    if (url.protocol !== 'https:' || url.hostname !== 'prod.danawa.com' || url.username || url.password || url.port) continue;
    const pcode = url.searchParams.get('pcode');
    const shop = url.searchParams.get('cmpny_c');
    const shopProduct = url.searchParams.get('link_prod_c');
    const catalogue = url.pathname === '/info/' && /^\d+$/u.test(pcode || '');
    const shopOffer = url.pathname === '/bridge/go_link_goods.php' && shop && shopProduct;
    if (!catalogue && !shopOffer) continue;
    const priceBlock = classBlock(card, 'price_sect');
    const priceMatch = priceBlock.match(/<strong\b[^>]*>\s*([\d,]+)\s*<\/strong>/iu);
    const price = Number(priceMatch?.[1]?.replaceAll(',', ''));
    if (!Number.isSafeInteger(price) || price <= 1500) continue;
    let specs = text(classBlock(card, 'spec_list', 'div')).replace(/온다이\s*ECC/giu, '온다이 오류정정');
    if (/(?:마이크론|\bMicron\b)/iu.test(`${originalTitle} ${specs}`) && /\bCrucial\b|크루셜/iu.test(originalTitle)) {
      title = originalTitle.replace(/\bCrucial\b|크루셜/giu, '').replace(/\s+/gu, ' ').trim();
      if (!/마이크론|\bMicron\b/iu.test(title)) title = `Micron ${title}`;
    }
    const variant = text(classBlock(card, 'memory_sect')).replace(/\d[\d,]*원\s*\/\s*(?:1GB|1TB|1개)/giu, '').trim();
    const titleCategory = classifyPcPartListingPublic({title, price, currency: 'KRW', status: 'ACTIVE'}).category_code;
    if (titleCategory === 'CPU' && /중고\s*\+\s*쿨러/iu.test(title)) continue;
    if (titleCategory === 'CPU') specs = specs.split('/').filter(part => !/DDR|메모리|RAM|GB|M\.2|NVMe/iu.test(part)).join(' / ');
    if (['SSD', 'HDD'].includes(titleCategory)) {
      // Controller cache and endurance are not the drive's marketed capacity.
      specs = specs.split('/').filter(part => !/DDR|DRAM|SLC|TBW|ECC/iu.test(part)).join(' / ');
      if (catalogue && variant && !title.includes(variant)) title = `${title} ${variant}`;
    }
    if (/\bPM(?:1733|1735|1743)[A-Z]?\b/iu.test(title)) specs += ' 서버용 ENTERPRISE';
    const description = `${variant} ${specs}`.trim();
    const classified = classifyPcPartListingPublic({ title, description, price, currency: 'KRW', status: 'ACTIVE' });
    if (!classified.statistics_eligible || (categoryCode && classified.category_code !== categoryCode)) continue;
    const category = text(classBlock(card, 'prod_category_location', 'dl'));
    const categoryHref = attr(classBlock(card, 'prod_category_location', 'dl').match(/<a\b[^>]*>/iu)?.[0] || '', 'href');
    const sourceId = catalogue ? `catalog:${pcode}` : `shop:${shop}:${shopProduct}`;
    const imageTag = card.match(/<img\b[^>]*>/iu)?.[0] || '';
    let imageUrl = null;
    try { imageUrl = new URL(attr(imageTag, 'data-src') || attr(imageTag, 'src'), BASE).toString(); } catch {}
    url.searchParams.delete('keyword'); url.searchParams.delete('r');
    const mall = classBlock(card, 'mall_icon');
    const merchant = text(mall) || attr(mall.match(/<img\b[^>]*>/iu)?.[0] || '', 'alt');
    candidates.push({
      site: 'danawa', source_listing_id: sourceId, title, description, price, currency: 'KRW',
      status: 'ACTIVE', lifecycle_status: 'ACTIVE', seller_type: 'DEALER',
      seller_name: catalogue ? '다나와 가격비교' : merchant || null,
      url: url.toString(), image_url: imageUrl, source_variant: variant, requested_category_code: categoryCode,
      source_category_code: new URL(categoryHref || BASE, BASE).searchParams.get('cate') || '',
      raw_payload: { source_listing_id: sourceId, url: url.toString(), title, original_title: originalTitle, description, price,
        currency: 'KRW', status: 'ACTIVE', seller_type: 'DEALER', source_kind: 'DANAWA_USED_PRICE_COMPARISON',
        source_category_label: category, source_variant: variant, query, catalogue, price_basis: 'NORMAL_DISPLAYED_PRICE',
        seller_role: catalogue ? 'PRICE_COMPARISON_AGGREGATOR' : 'SHOP_OFFER', merchant: catalogue ? null : merchant || null,
        catalogue_shop_count_is_not_sample_count: true }
    });
  }
  // A catalogue's lowest offer is one observation, not one per linked shop.
  const unique = new Map();
  for (const item of candidates.sort((a, b) => Number(b.raw_payload.catalogue) - Number(a.raw_payload.catalogue) || a.price - b.price)) {
    const key = variantKey(item);
    if (!unique.has(key)) unique.set(key, item);
  }
  return [...unique.values()].map(item => ({ ...item,
    source_listing_id: `search_${createHash('sha256').update(variantKey(item)).digest('hex').slice(0, 24)}`,
    raw_payload: { ...item.raw_payload, original_source_listing_id: item.source_listing_id,
      source_listing_id: `search_${createHash('sha256').update(variantKey(item)).digest('hex').slice(0, 24)}` }
  }));
}

export async function collectDanawaSearchListings({ query, categoryCode, page = 1, fetchImpl = fetch, signal, onUnrecognizedResponse } = {}) {
  if (!String(query || '').trim()) throw new Error('DANAWA_SEARCH_QUERY_REQUIRED');
  const url = new URL('https://search.danawa.com/dsearch.php');
  const search = /중고/iu.test(query) ? query.trim() : `${query.trim()} 중고`;
  url.searchParams.set('query', search);
  url.searchParams.set('page', String(Math.max(1, Math.min(3, Number(page) || 1))));
  const response = await fetchImpl(url, { headers: { accept: 'text/html', 'user-agent': 'USED-PICK-PC-Collector/2.0 (+https://used-pick.com/)' }, signal: signal || AbortSignal.timeout(20000) });
  // Diagnostics contain no body, cookies or query text; retain only response shape/fingerprint.
  const diagnostic = { status: response.status, content_type: response.headers.get('content-type')?.split(';')[0] || null };
  const reject = kind => { throw new Error(`${kind}:${JSON.stringify(diagnostic)}`); };
  if (!response.ok) {
    // Allowlisted, bounded non-secret diagnostics: no cookies, body or arbitrary headers.
    diagnostic.server = response.headers.get('server')?.replace(/[^a-z0-9 ._\/-]/giu,'').slice(0,80) || null;
    diagnostic.challenge_header = response.headers.get('cf-mitigated') === 'challenge';
    const retryAfter = response.headers.get('retry-after');
    diagnostic.retry_after_seconds = /^\d{1,6}$/.test(retryAfter || '') ? Number(retryAfter) : null;
    const reader = response.body?.getReader();
    const chunks = []; let bytes = 0;
    if (reader) try {
      while (bytes < 32768) {
        const next = await reader.read(); if (next.done) break;
        const part = next.value.slice(0,32768-bytes); chunks.push(part); bytes += part.length;
      }
    } finally { await reader.cancel().catch(() => {}); }
    const prefix = Buffer.concat(chunks);
    diagnostic.prefix_sha256 = createHash('sha256').update(prefix).digest('hex');
    diagnostic.challenge_marker = /captcha|access denied|자동입력\s*방지/iu.test(prefix.toString('utf8'));
    reject(`DANAWA_SEARCH_HTTP_${response.status}`);
  }
  const html = await response.text();
  diagnostic.body_sha256 = createHash('sha256').update(html).digest('hex');
  diagnostic.bytes = Buffer.byteLength(html);
  if (/captcha|access denied|자동입력\s*방지/iu.test(text(html).slice(0, 2000))) reject('DANAWA_SEARCH_BLOCKED');
  // No authoritative empty-result fixture exists yet. Do not silently equate an unknown page to zero listings.
  // The outer wrapper is not product evidence; valid cards can arrive under a different wrapper.
  const modern = modernSearchCards(html);
  const cardCount = elements(html, 'li', 'prod_item').length + modern.count;
  diagnostic.product_card_count = cardCount;
  diagnostic.unrecognized_product_count = modern.unrecognized;
  if (!cardCount || modern.unrecognized) {
    if (onUnrecognizedResponse) {
      try { await onUnrecognizedResponse({ html, diagnostic: { ...diagnostic } }); diagnostic.evidence_saved = true; }
      catch { diagnostic.evidence_saved = false; }
    }
    const kind = !cardCount && html.includes('productListArea')
      ? 'DANAWA_SEARCH_NO_CARDS_UNVERIFIED' : 'DANAWA_SEARCH_MARKUP_UNRECOGNIZED';
    const error = new Error(`${kind}:${JSON.stringify(diagnostic)}`);
    if (cardCount && modern.unrecognized) error.partial_items = parseDanawaSearchHtml(html, { categoryCode, query: search });
    throw error;
  }
  return { items: parseDanawaSearchHtml(html, { categoryCode, query: search }),
    // Every list row that could hold a product, recognized or not: an upper
    // bound, so a full page is never mistaken for a complete short result.
    diagnostics: [{ page, url: url.toString(), status: response.status,
      card_count: elements(html, 'li', 'prod_item').length + elements(html, 'li', 'border-b').length }] };
}
