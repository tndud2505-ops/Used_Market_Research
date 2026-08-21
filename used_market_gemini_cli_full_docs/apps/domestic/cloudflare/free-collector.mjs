const MAX_BROWSER_RESERVATION_SECONDS = 60;
const MAX_ITEMS_PER_TARGET = 20;
const MAX_TARGETS_PER_JOB = 4;
const PAGE_TIMEOUT_MS = 12_000;
const ALLOWED_HOSTS = new Set([
  "m.bunjang.co.kr",
  "bunjang.co.kr",
  "www.bunjang.co.kr",
  "api.bunjang.co.kr",
  "web.joongna.com",
  "www.hellomarket.com",
  "web.rethinkmall.com"
]);

export const FREE_COLLECTION_SITES = Object.freeze([
  "bunjang",
  "joonggonara",
  "hellomarket",
  "rethinkmall"
]);

export const FREE_COLLECTION_EXCLUDED_SITES = Object.freeze([]);

const JOB_PLANS = Object.freeze({
  "gpu-fast-scan": { category_id: "pc", keyword: "RTX 3060" },
  "cpu-scan": { category_id: "pc", keyword: "Ryzen 5 5600" },
  "ram-scan": { category_id: "pc", keyword: "RAM 16GB" },
  "ssd-scan": { category_id: "pc", keyword: "SSD 1TB" },
  "psu-scan": { category_id: "pc", keyword: "PSU 600W" },
  "full-pc-scan": { category_id: "pc", keyword: "gaming PC" },
  "iphone-scan": { category_id: "all", keyword: "아이폰 15" },
  "airpods-scan": { category_id: "all", keyword: "에어팟 프로" },
  "switch-scan": { category_id: "all", keyword: "닌텐도 스위치" },
  "fashion-bottoms-scan": { category_id: "all", keyword: "여성 바지" }
});

function buildTargets(keyword) {
  const encoded = encodeURIComponent(keyword);
  return [
    { site: "bunjang", url: `https://api.bunjang.co.kr/api/1/find_v2.json?q=${encoded}&n=20&page=0&order=date&stat_device=w&version=4` },
    { site: "joonggonara", url: `https://web.joongna.com/search/${encoded}` },
    { site: "hellomarket", url: `https://www.hellomarket.com/search?q=${encoded}` },
    { site: "rethinkmall", url: `https://web.rethinkmall.com/search?utm_source=bu&keyword=${encoded}` }
  ];
}

function dateKey() {
  return new Date().toISOString().slice(0, 10);
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ALLOWED_HOSTS.has(url.hostname) ? url.toString() : null;
  } catch {
    return null;
  }
}

function safeImageUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

async function reserveBrowserBudget(env) {
  const key = dateKey();
  const timestamp = nowIso();
  const result = await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO free_tier_usage (date_key, browser_seconds, queue_operations, d1_rows_written, collection_runs, updated_at) VALUES (?, 0, 0, 0, 0, ?)"
    ).bind(key, timestamp),
    env.DB.prepare(
      "UPDATE free_tier_usage SET browser_seconds = browser_seconds + ?, updated_at = ? WHERE date_key = ? AND browser_seconds + ? <= 600"
    ).bind(MAX_BROWSER_RESERVATION_SECONDS, timestamp, key, MAX_BROWSER_RESERVATION_SECONDS)
  ]);
  return result[1]?.meta?.changes === 1;
}

async function recordQueueOperation(env, count = 1) {
  const key = dateKey();
  const timestamp = nowIso();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO free_tier_usage (date_key, browser_seconds, queue_operations, d1_rows_written, collection_runs, updated_at) VALUES (?, 0, 0, 0, 0, ?)"
    ).bind(key, timestamp),
    env.DB.prepare(
      "UPDATE free_tier_usage SET queue_operations = queue_operations + ?, updated_at = ? WHERE date_key = ?"
    ).bind(count, timestamp, key)
  ]);
}

async function recordRun(env, run) {
  const timestamp = nowIso();
  const key = dateKey();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT OR REPLACE INTO collection_runs (run_id, site, category_id, status, started_at, finished_at, browser_seconds, items_count, error_message) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      run.run_id,
      run.site,
      run.category_id,
      run.status,
      run.started_at,
      timestamp,
      run.browser_seconds,
      run.items_count,
      run.error_message ?? null
    ),
    env.DB.prepare(
      "UPDATE free_tier_usage SET d1_rows_written = d1_rows_written + ?, collection_runs = collection_runs + 1, updated_at = ? WHERE date_key = ?"
    ).bind(run.items_count, timestamp, key)
  ]);
}

function parsePrice(text) {
  const match = normalizeText(text).match(/(?:₩|KRW|\$)?\s*([0-9][0-9,]{2,})/i);
  if (!match) return null;
  const value = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function keywordMatchesText(keyword, text) {
  const normalizedKeyword = normalizeText(keyword).toLowerCase();
  const normalizedText = normalizeText(text).toLowerCase();
  if (!normalizedKeyword || !normalizedText) return false;
  const tokens = normalizedKeyword.split(/\s+/).filter((token) => token.length > 1);
  return tokens.length > 0 && tokens.every((token) => normalizedText.includes(token));
}

function listingScript(site) {
  return `(() => {
    const clean = (value) => (value || '').replace(/\\s+/g, ' ').trim();
    const imageValue = (image) => image?.getAttribute('data-src') || image?.getAttribute('data-original') || image?.getAttribute('data-lazy-src') || image?.getAttribute('src') || '';
    if (${JSON.stringify(site)} === 'bunjang') {
      try {
        const payload = JSON.parse(document.body?.innerText || '{}');
        return (Array.isArray(payload.list) ? payload.list : []).map((product) => ({
          href: product.pid ? 'https://m.bunjang.co.kr/products/' + product.pid : '',
          title: clean(product.name),
          image_url: String(product.product_image || '').replace('{res}', 'original'),
          price_text: clean(product.price)
        })).filter((item) => item.href && item.title.length >= 2).slice(0, ${MAX_ITEMS_PER_TARGET});
      } catch {
        return [];
      }
    }
    if (${JSON.stringify(site)} === 'hellomarket') {
      return Array.from(document.querySelectorAll('.sc-2e746fd3-0')).map((card) => {
        const anchor = card.querySelector('a[href*="/item/"]');
        const values = Array.from(card.querySelectorAll('.sc-2e746fd3-5')).map((node) => clean(node.textContent)).filter(Boolean);
        const priceIndex = values.findIndex((value) => /\\d[\\d,]*\\s*원/.test(value));
        const title = values.find((value, index) => index !== priceIndex && !/^\\d[\\d,]*\\s*원$/.test(value)) || '';
        return {
          href: anchor?.href || '',
          title,
          image_url: imageValue(card.querySelector('img')),
          price_text: priceIndex >= 0 ? values[priceIndex] : '',
          seller: clean(card.querySelector('.sc-2e746fd3-4')?.textContent),
          posted_at: clean(card.querySelector('.sc-2e746fd3-10')?.textContent)
        };
      }).filter((item) => item.href && item.title.length >= 2).slice(0, ${MAX_ITEMS_PER_TARGET});
    }
    if (${JSON.stringify(site)} === 'rethinkmall') {
      const classText = (root, token) => clean(Array.from(root.querySelectorAll('*')).find((node) => node.classList?.contains(token))?.textContent);
      return Array.from(document.querySelectorAll('a[href*="/goods/"]')).map((anchor) => ({
        href: anchor.href || '',
        title: classText(anchor, '_ga-goods-title'),
        image_url: imageValue(anchor.querySelector('img')),
        price_text: classText(anchor, 'text-base') || clean(anchor.textContent)
      })).filter((item) => item.href && item.title.length >= 2).slice(0, ${MAX_ITEMS_PER_TARGET});
    }
    const allowed = /\\/(?:products?|product|posts?|items?|item|goods|articles?)\\//i;
    return Array.from(document.querySelectorAll('a[href]')).map((anchor) => {
      const href = anchor.href || '';
      const title = clean(anchor.innerText || anchor.textContent);
      const image = anchor.querySelector('img');
      return { href, title, image_url: imageValue(image), price_text: title };
    }).filter((item) => allowed.test(item.href) && item.title.length >= 8).slice(0, ${MAX_ITEMS_PER_TARGET});
  })()`;
}

async function extractTarget(page, target, plan) {
  const url = safeUrl(target.url);
  if (!url) throw new Error(`unsupported collection host: ${target.url}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });
  await page.waitForTimeout(500);
  const rawItems = await page.evaluate(listingScript(target.site));
  const observedItems = (Array.isArray(rawItems) ? rawItems : []).map((item) => ({
    item_id: `${target.site}:${item.href}`,
    site: target.site,
    category_id: plan.category_id,
    title: normalizeText(item.title),
    search_text: normalizeText(item.title),
    price_value: parsePrice(item.price_text),
    currency: "KRW",
    url: item.href,
    image_url: safeImageUrl(item.image_url ?? ""),
    seller_name: normalizeText(item.seller),
    posted_at: normalizeText(item.posted_at),
    updated_at: nowIso(),
    active: 1
  })).filter((item) => item.title && item.url);
  const relevantItems = observedItems.filter((item) => keywordMatchesText(plan.keyword, item.title));
  return {
    items: relevantItems,
    observed_count: observedItems.length,
    relevant_count: relevantItems.length,
    rejected_count: observedItems.length - relevantItems.length
  };
}

async function persistItems(env, items) {
  if (items.length === 0) return;
  const statements = items.slice(0, MAX_ITEMS_PER_TARGET * MAX_TARGETS_PER_JOB).map((item) => env.DB.prepare(
    `INSERT OR REPLACE INTO listings
      (item_id, site, category_id, title, search_text, price_value, currency, url, image_url, seller_name, posted_at, updated_at, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    item.item_id,
    item.site,
    item.category_id,
    item.title,
    item.search_text,
    item.price_value,
    item.currency,
    item.url,
    item.image_url,
    item.seller_name,
    item.posted_at,
    item.updated_at,
    item.active
  ));
  await env.DB.batch(statements);
}

export function freeCollectionPlan(jobName) {
  const plan = JOB_PLANS[jobName];
  if (!plan) return null;
  return { ...plan, targets: buildTargets(plan.keyword) };
}

export async function collectFreeJob(env, jobName) {
  const plan = freeCollectionPlan(jobName);
  if (!plan) return { status: "skipped", job_name: jobName, reason: "unsupported_free_tier_job" };
  if (!env.BROWSER || typeof env.DB?.prepare !== "function") {
    return { status: "skipped", job_name: jobName, reason: "browser_or_d1_binding_missing" };
  }
  if (!(await reserveBrowserBudget(env))) {
    return { status: "skipped", job_name: jobName, reason: "free_browser_budget_exhausted" };
  }

  const startedAt = nowIso();
  const runId = `free-${jobName}-${Date.now()}`;
  let browser;
  const allItems = [];
  const statuses = [];
  try {
    const { acquire, connect } = await import("@cloudflare/playwright");
    const session = await acquire(env.BROWSER);
    browser = await connect(env.BROWSER, session.sessionId);
    const context = await browser.newContext({
      userAgent: "used-market-free-collector/1.0"
    });
    const page = await context.newPage();
    for (const target of plan.targets.slice(0, MAX_TARGETS_PER_JOB)) {
      try {
        const extraction = await extractTarget(page, target, plan);
        allItems.push(...extraction.items);
        statuses.push({
          site: target.site,
          status: "completed",
          observed_items: extraction.observed_count,
          relevant_items: extraction.relevant_count,
          rejected_irrelevant: extraction.rejected_count
        });
      } catch (error) {
        statuses.push({
          site: target.site,
          status: "failed",
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    await persistItems(env, allItems);
    const runStatus = allItems.length > 0 ? "completed" : "empty";
    await recordRun(env, {
      run_id: runId,
      site: statuses.map((item) => item.site).join(","),
      category_id: plan.category_id,
      status: runStatus,
      started_at: startedAt,
      browser_seconds: MAX_BROWSER_RESERVATION_SECONDS,
      items_count: allItems.length,
      error_message: statuses.filter((item) => item.status === "failed").map((item) => item.error).join(" | ") || null
    });
    return { status: runStatus, job_name: jobName, items: allItems.length, targets: statuses };
  } finally {
    try {
      await browser?.close();
    } catch {
      // Browser Run sessions are best-effort closed after the result is saved.
    }
  }
}

export async function handleFreeCollectionQueue(batch, env) {
  await recordQueueOperation(env, batch.messages.length);
  for (const message of batch.messages) {
    const jobName = typeof message.body?.job_name === "string" ? message.body.job_name : "";
    try {
      await collectFreeJob(env, jobName);
      message.ack?.();
    } catch (error) {
      console.error("free collection failed", error);
      message.retry?.({ delaySeconds: 60 });
    }
  }
}
