import { DatabaseSync } from "node:sqlite";

if (process.argv[2] !== "--confirm-write") {
  console.error("Refusing to seed D1 without --confirm-write");
  process.exit(2);
}

const filePath = process.env.RUNNER_INDEX_PATH || "/var/lib/used-market-runner/search-index.sqlite";
const importUrl = String(process.env.D1_IMPORT_URL || "").trim();
const importToken = String(process.env.CLOUDFLARE_MANUAL_RUN_TOKEN || "").trim();
if (!/^https:\/\//i.test(importUrl) || importToken.length < 32) {
  throw new Error("D1_IMPORT_URL and CLOUDFLARE_MANUAL_RUN_TOKEN are required");
}

const sites = ["joonggonara", "bunjang", "hellomarket", "rethinkmall"];
const db = new DatabaseSync(filePath, { readOnly: true });
let items;
try {
  const select = db.prepare(`
    SELECT item_id, site, category_id, title, search_text, price_value, currency,
           url, image_url, posted_at, last_checked_at AS updated_at
      FROM listings l
     WHERE l.active = 1
       AND l.site = ?
       AND EXISTS (
         SELECT 1 FROM query_listings ql
          WHERE ql.item_id = l.item_id
            AND ql.quality_evaluated = 1
       )
       AND NOT EXISTS (
         SELECT 1 FROM query_listings ql
          WHERE ql.item_id = l.item_id
            AND (
              ql.price_suspect = 1
              OR ql.quality_suspect = 1
              OR ql.noise_filtered = 1
              OR ql.fraud_risk > 0.45
            )
       )
     ORDER BY COALESCE(l.posted_at, l.last_seen_at) DESC, l.last_seen_at DESC
     LIMIT 2000
  `);
  items = sites.flatMap((site) => select.all(site));
} finally {
  db.close();
}

let imported = 0;
let rejected = 0;
for (let offset = 0; offset < items.length; offset += 500) {
  const response = await fetch(importUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${importToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ items: items.slice(offset, offset + 500) })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`D1 seed failed with HTTP ${response.status}`);
  imported += Number(payload.inserted || 0);
  rejected += Number(payload.rejected || 0);
}

console.log(JSON.stringify({ status: "success", selected: items.length, imported, rejected }));
