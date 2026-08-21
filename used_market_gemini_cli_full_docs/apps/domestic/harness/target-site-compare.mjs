import { collectOne } from "../cloudflare/live-search.mjs";

const keyword = process.argv[2] || "아이폰";
const limit = Number.parseInt(process.argv[3] || "5", 10);
const sites = ["bunjang", "joonggonara", "hellomarket", "rethinkmall"];
const result = { keyword, limit, generated_at: new Date().toISOString(), sites: [] };

for (const site of sites) {
  try {
    const items = await collectOne(site, keyword, "all", limit) || [];
    result.sites.push({
      site,
      status: items.length ? "ready" : "empty",
      count: items.length,
      items: items.map((item) => ({ title: item.title, price: item.price, url: item.url }))
    });
  } catch (error) {
    result.sites.push({ site, status: "failed", count: 0, error: error instanceof Error ? error.message : String(error) });
  }
}

console.log(JSON.stringify(result, null, 2));
