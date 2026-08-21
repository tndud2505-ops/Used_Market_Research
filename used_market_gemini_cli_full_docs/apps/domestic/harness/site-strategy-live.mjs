import { buildLivePayload, collectLiveSite } from "../cloudflare/live-search.mjs";

const sites = ["joonggonara", "bunjang", "hellomarket", "rethinkmall"];
const scenarioCatalog = [
  { name: "fashion-category", category_id: "fashion" },
  { name: "iphone-15", keyword: "아이폰 15", category_id: "mobile" },
  { name: "dyson-v10", keyword: "다이슨 V10", category_id: "appliances" },
  { name: "nintendo-switch", keyword: "닌텐도 스위치", category_id: "games" }
];
const optionValue = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || "" : "";
};
const scenarioName = optionValue("--scenario");
const requestedSort = optionValue("--sort");
const includeDetails = process.argv.includes("--details");
const scenarios = scenarioName ? scenarioCatalog.filter((scenario) => scenario.name === scenarioName) : scenarioCatalog;
const sorts = requestedSort
  ? [requestedSort]
  : process.argv.includes("--all-sorts")
    ? ["recommended", "price_asc", "recent"]
    : ["recommended", "price_asc"];

if (!scenarios.length) throw new Error(`Unknown scenario: ${scenarioName}`);

const report = [];
for (const scenario of scenarios) {
  for (const sort of sorts) {
    const body = { ...scenario, sites, sort, limit: 24 };
    const liveResults = await Promise.all(sites.map(async (site) => {
      try {
        return await collectLiveSite(site, body, 20, scenario.keyword || "");
      } catch (error) {
        return { site, supported: true, items: [], error: error instanceof Error ? error.message : String(error) };
      }
    }));
    const combined = buildLivePayload(body, liveResults, { items: [] });
    const sourceReview = sites.map((site) => {
      const live = liveResults.find((entry) => entry.site === site);
      const isolated = buildLivePayload({ ...body, sites: [site] }, [live], { items: [] });
      return {
        site,
        raw: live?.raw_count ?? live?.items?.length ?? 0,
        qualified: isolated.quality.available_count,
        dropped: isolated.quality.selection.dropped,
        ...(includeDetails ? { top: isolated.items.slice(0, 4).map((item) => ({
          title: item.title,
          price: item.price,
          posted_at: item.posted_at,
          image: Boolean(item.image_url),
          risk: Boolean(item.price_suspect || item.quality_suspect)
        })) } : {}),
        error: live?.error || ""
      };
    });
    report.push({
      scenario: scenario.name,
      sort,
      combined: {
        returned: combined.items.length,
        available: combined.quality.available_count,
        site_counts: Object.fromEntries(sites.map((site) => [site, combined.items.filter((item) => item.site === site).length])),
        top: combined.items.slice(0, 8).map((item) => ({ site: item.site, title: item.title, price: item.price, posted_at: item.posted_at, risk: Boolean(item.price_suspect || item.quality_suspect) }))
      },
      sources: sourceReview
    });
  }
}

console.log(JSON.stringify({ generated_at: new Date().toISOString(), report }, null, 2));
