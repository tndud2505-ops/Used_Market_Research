import { collectSearchListings } from "../dist/collector/logic/browserCollector.js";
import { fetchHelloMarketSearch } from "../dist/collector/logic/helloMarketProbe.js";
import { fetchRethinkMallSearch } from "../dist/collector/logic/rethinkmallProbe.js";

const workerUrl = process.env.USED_MARKET_WORKER_URL || "https://used-market-runner.tndud2503.workers.dev";
const token = process.env.CLOUDFLARE_MANUAL_RUN_TOKEN;
if (!token) throw new Error("CLOUDFLARE_MANUAL_RUN_TOKEN is required");

const targets = [
  { keyword: "RTX 3070", category_id: "pc" },
  { keyword: "RAM 16GB", category_id: "pc" },
  { keyword: "SSD 1TB", category_id: "pc" },
  { keyword: "gaming PC", category_id: "pc" },
  { keyword: "아이폰 15", category_id: "mobile" },
  { keyword: "에어팟 프로", category_id: "mobile" },
  { keyword: "여성 바지", category_id: "fashion_women_bottoms" },
  { keyword: "다이슨 청소기", category_id: "appliances" }
];

const items = [];
const stats = [];
const now = new Date().toISOString();

for (const target of targets) {
  for (const site of ["bunjang", "joonggonara"]) {
    try {
      const result = await collectSearchListings({ site, keyword: target.keyword, limit: 8 });
      const mapped = result.items.slice(0, 8).map((item) => mapItem({ site, target, item, updated_at: now }));
      items.push(...mapped);
      stats.push({ site, keyword: target.keyword, count: mapped.length, warnings: result.warnings ?? [] });
    } catch (error) {
      stats.push({ site, keyword: target.keyword, count: 0, error: String(error) });
    }
  }
}

for (const target of targets.slice(0, 4)) {
  for (const site of ["hellomarket", "rethinkmall"]) {
    try {
      const result = site === "hellomarket"
        ? await fetchHelloMarketSearch(target.keyword, { settleMs: 1200 })
        : await fetchRethinkMallSearch(target.keyword, { settleMs: 1800 });
      const sourceItems = result.relevant_items ?? result.items ?? [];
      const mapped = sourceItems.slice(0, 8).map((item) => mapItem({ site, target, item, updated_at: now }));
      items.push(...mapped);
      stats.push({ site, keyword: target.keyword, count: mapped.length });
    } catch (error) {
      stats.push({ site, keyword: target.keyword, count: 0, error: String(error) });
    }
  }
}

const unique = [...new Map(items.filter(Boolean).map((item) => [item.item_id, item])).values()];
const response = await fetch(`${workerUrl}/admin/import-listings`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${token}`,
    "content-type": "application/json"
  },
  body: JSON.stringify({ items: unique })
});
const body = await response.text();
if (!response.ok) throw new Error(`Worker import failed: HTTP ${response.status} ${body}`);
console.log(JSON.stringify({ worker: workerUrl, collected: unique.length, import: JSON.parse(body), stats }, null, 2));

function mapItem({ site, target, item, updated_at }) {
  const url = typeof item.url === "string" ? item.url.trim() : "";
  const title = typeof item.title === "string" ? item.title.replace(/\s+/g, " ").trim() : "";
  if (!url || !title) return null;
  const price = item.price_value ?? item.price ?? item.sale_price ?? null;
  return {
    item_id: `${site}:${url}`,
    site,
    category_id: target.category_id,
    title,
    search_text: `${title} ${target.keyword}`.trim(),
    price_value: Number.isFinite(Number(price)) ? Number(price) : null,
    currency: item.currency || "KRW",
    url,
    image_url: item.image_url || null,
    seller_name: item.seller || null,
    posted_at: item.posted_at || "",
    updated_at
  };
}
