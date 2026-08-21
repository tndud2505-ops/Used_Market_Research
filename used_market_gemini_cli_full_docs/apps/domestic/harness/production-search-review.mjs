const baseUrl = (process.argv[2] || "https://used-pick.com").replace(/\/$/, "");
const PAGE_SIZE = 30;
const scenarioCatalog = [
  { name: "fashion-recommended", body: { category_id: "fashion", sort: "recommended", limit: PAGE_SIZE } },
  { name: "iphone-lowest", body: { keyword: "아이폰 15", category_id: "mobile", sort: "price_asc", limit: PAGE_SIZE } },
  { name: "iphone-lowest-range", body: { keyword: "아이폰 15", category_id: "mobile", sort: "price_asc", min_price: 300000, max_price: 900000, limit: PAGE_SIZE } },
  { name: "macbook-lowest", body: { keyword: "맥북 에어 M2", category_id: "pc", sort: "price_asc", limit: PAGE_SIZE } },
  { name: "switch-lowest", body: { keyword: "닌텐도 스위치", category_id: "games", sort: "price_asc", limit: PAGE_SIZE } },
  { name: "dyson-recent", body: { keyword: "다이슨 V10", category_id: "appliances", sort: "recent", limit: PAGE_SIZE } },
  { name: "camera-recent", body: { keyword: "소니 A7", category_id: "camera", sort: "recent", limit: PAGE_SIZE } },
  { name: "beauty-recommended", body: { keyword: "설화수", category_id: "beauty", sort: "recommended", limit: PAGE_SIZE } }
];
const scenarioArgIndex = process.argv.indexOf("--scenario");
const scenarioName = scenarioArgIndex >= 0 ? process.argv[scenarioArgIndex + 1] || "" : "";
const scenarios = scenarioName ? scenarioCatalog.filter((scenario) => scenario.name === scenarioName) : scenarioCatalog;
if (!scenarios.length) throw new Error(`Unknown scenario: ${scenarioName}`);

function isUntrusted(item) {
  return Boolean(
    item?.price_suspect
    || item?.quality_suspect
    || item?.noise_filtered
    || (Number.isFinite(Number(item?.fraud_risk)) && Number(item.fraud_risk) > 0.45)
  );
}

function priceRank(item) {
  const price = Number(item?.price);
  if (!Number.isFinite(price) || price <= 100) return 3;
  const fraudRisk = Number(item?.fraud_risk);
  if (item?.noise_filtered || (Number.isFinite(fraudRisk) && fraudRisk >= 0 && fraudRisk <= 1 && fraudRisk > 0.45)) return 2;
  return item?.price_suspect || item?.quality_suspect ? 1 : 0;
}

function orderingViolation(items, sort) {
  if (sort === "price_asc") {
    return items.some((item, index) => {
      if (index === 0) return false;
      const previous = items[index - 1];
      const previousRank = priceRank(previous);
      const currentRank = priceRank(item);
      if (currentRank !== previousRank) return currentRank < previousRank;
      return Number(item.price) < Number(previous.price);
    });
  }
  if (sort === "recent") {
    const timestamps = items.map((item) => Date.parse(String(item.posted_at || "")));
    let sawMissing = false;
    for (let index = 0; index < timestamps.length; index += 1) {
      const current = timestamps[index];
      if (!Number.isFinite(current)) {
        sawMissing = true;
        continue;
      }
      if (sawMissing) return true;
      if (index > 0 && Number.isFinite(timestamps[index - 1]) && current > timestamps[index - 1]) return true;
    }
  }
  return false;
}

function purchaseNoise(item) {
  const title = String(item?.title || "").normalize("NFKC").toLowerCase();
  return /교신|교환\s*(?:만|원함|희망|봅니다|원합니다)|공박스|빈박스|박스만|본체\s*(?:제외|없음)|핸드폰\s*제외|최고가\s*매입|중고폰\s*매입/u.test(title);
}

const report = [];
let failed = false;
for (const scenario of scenarios) {
  const requestBody = { ...scenario.body, review_nonce: `${Date.now()}-${scenario.name}` };
  const response = await fetch(`${baseUrl}/api/search`, {
    method: "POST",
    headers: { "content-type": "application/json", "cache-control": "no-cache" },
    body: JSON.stringify(requestBody)
  });
  const payload = await response.json();
  const data = payload?.data || {};
  const items = Array.isArray(data.items) ? data.items : [];
  const violations = [];
  if (response.status !== 200 || payload?.status !== "success") violations.push(`http:${response.status}`);
  if (response.headers.get("x-search-data-source") !== "aws-runner") violations.push("edge_source_not_aws_runner");
  if (response.headers.get("x-search-runner-fallback")) violations.push("runner_fallback_used");
  if (!items.length) violations.push("empty_results");
  if (items.length > PAGE_SIZE) violations.push(`page_too_large:${items.length}`);
  if (orderingViolation(items, scenario.body.sort)) violations.push(`invalid_${scenario.body.sort}_order`);
  if (scenario.body.sort === "price_asc" && items.slice(0, 10).some(purchaseNoise)) violations.push("purchase_noise_in_top_10");
  if (items.some((item) => !/^https?:\/\//i.test(String(item.url || "")))) violations.push("invalid_listing_url");
  if (scenario.body.min_price !== undefined && items.some((item) => Number(item.price) < scenario.body.min_price)) violations.push("below_min_price");
  if (scenario.body.max_price !== undefined && items.some((item) => Number(item.price) > scenario.body.max_price)) violations.push("above_max_price");
  const expectedSources = scenario.body.keyword
    ? ["bunjang", "joonggonara", "hellomarket", "rethinkmall"]
    : ["bunjang", "joonggonara"];
  const actualSources = new Set((data.sources || []).map((source) => source.key));
  if (expectedSources.some((site) => !actualSources.has(site))) violations.push("missing_expected_source_status");
  failed ||= violations.length > 0;
  report.push({
    scenario: scenario.name,
    status: response.status,
    acceptance: violations.length ? "failed" : "passed",
    violations,
    edge_source: response.headers.get("x-search-data-source"),
    runner_fallback: response.headers.get("x-search-runner-fallback"),
    live_cache: response.headers.get("x-live-search-cache"),
    sort: data?.quality?.sort,
    data_source: data?.quality?.data_source,
    returned: items.length,
    available: data?.quality?.available_count || 0,
    source_counts: Object.fromEntries((data?.sources || []).map((source) => [source.key, source.total_count ?? source.count ?? 0])),
    dropped: data?.quality?.selection?.dropped || {},
    top: items.slice(0, 8).map((item) => ({
      site: item.site,
      title: item.title,
      price: item.price,
      posted_at: item.posted_at,
      risk: isUntrusted(item),
      purchase_noise: purchaseNoise(item),
      image: Boolean(item.image_url)
    }))
  });
}

console.log(JSON.stringify({ status: failed ? "failed" : "passed", base_url: baseUrl, checked_at: new Date().toISOString(), report }, null, 2));
if (failed) process.exitCode = 1;
