import { createHash } from 'node:crypto';
import { classifyPcPartListingPublic } from '../../market/logic/pc-parts-classifier.mjs';

const BASE = 'https://prod.danawa.com';
export const DANAWA_REQUEST_MIN_INTERVAL_MS = 5_000;

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
  for (const target of targets) {
    signal?.throwIfAborted();
    try {
      settled.push({ status: 'fulfilled', value: await collectTarget(target) });
    } catch (reason) {
      signal?.throwIfAborted();
      settled.push({ status: 'rejected', reason });
      const message = reason instanceof Error ? reason.message : String(reason);
      if (/DANAWA_SEARCH_(?:HTTP_(?:403|429)|BLOCKED)\b/iu.test(message)) break;
    }
  }
  return settled;
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
  const cards = elements(String(html), 'li', 'prod_item');
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

export async function collectDanawaSearchListings({ query, categoryCode, page = 1, fetchImpl = fetch, signal } = {}) {
  if (!String(query || '').trim()) throw new Error('DANAWA_SEARCH_QUERY_REQUIRED');
  const url = new URL('https://search.danawa.com/dsearch.php');
  const search = /중고/iu.test(query) ? query.trim() : `${query.trim()} 중고`;
  url.searchParams.set('query', search);
  url.searchParams.set('page', String(Math.max(1, Math.min(3, Number(page) || 1))));
  const response = await fetchImpl(url, { headers: { accept: 'text/html', 'user-agent': 'USED-PICK-PC-Collector/2.0 (+https://used-pick.com/)' }, signal: signal || AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`DANAWA_SEARCH_HTTP_${response.status}`);
  const html = await response.text();
  if (/captcha|access denied|자동입력\s*방지/iu.test(text(html).slice(0, 2000))) throw new Error('DANAWA_SEARCH_BLOCKED');
  if (!html.includes('productListArea')) throw new Error('DANAWA_SEARCH_MARKUP_UNRECOGNIZED');
  return { items: parseDanawaSearchHtml(html, { categoryCode, query: search }),
    diagnostics: [{ page, url: url.toString(), status: response.status }] };
}
