import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  PUBLIC_PC_PART_CATEGORIES,
  classifyPcPartListingPublic
} from "../market/logic/pc-parts-classifier.mjs";
import {
  publicPcCatalogForApi,
  publicPcFacetsForApi,
  publicPcModelsForApi
} from "../market/logic/pc-public-catalog.mjs";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalog = publicPcCatalogForApi();
const categoryCodes = catalog.categories.map((category) => category.code);
assert.deepEqual(categoryCodes, ["CPU", "GPU", "RAM", "MOTHERBOARD", "SSD", "HDD", "PSU"]);
assert.deepEqual(PUBLIC_PC_PART_CATEGORIES, categoryCodes);
assert.deepEqual(catalog.categories.map((category) => category.label), [
  "CPU", "그래픽카드", "RAM", "메인보드", "SSD", "HDD", "파워서플라이"
]);
assert.equal(categoryCodes.some((code) => ["CASE", "COOLING", "ODD", "EXPANSION_CARD"].includes(code)), false);
assert.deepEqual(catalog.categories.map((category) => Object.keys(category).filter((key) => ["model_count", "active_count", "sold_30d_count"].includes(key))),
  categoryCodes.map(() => ["model_count", "active_count", "sold_30d_count"]));

const requiredModelFields = [
  "canonical_product_id", "canonical_display_name", "category_code", "brand_label", "key_specs",
  "active_count", "active_median", "active_trimmed_mean", "sold_30d_count", "sold_30d_last_ask_median", "last_updated_at"
];
const models = publicPcModelsForApi({ category: "SSD", model: "990 PRO" }).models;
assert.ok(models.some((model) => model.canonical_product_id === "ssd:samsung:990-pro-1tb"));
assert.ok(models.some((model) => model.canonical_product_id === "ssd:samsung:990-pro-2tb"));
for (const model of models) for (const field of requiredModelFields) assert.ok(Object.hasOwn(model, field), `model field missing: ${field}`);

const globalSearchModels = publicPcModelsForApi({ q: "RX 460" }).models;
assert.ok(globalSearchModels.some((model) => model.canonical_product_id === "gpu:amd:rx-460"),
  "global model search must work without a category filter");
assert.deepEqual(publicPcFacetsForApi({ q: "RX 460" }).available_facets, {},
  "global model search must not invent category-specific facets");

const ramFacets = publicPcFacetsForApi({ category: "RAM", usage: "CONSUMER_DESKTOP", generation: "DDR5" });
assert.deepEqual(ramFacets.category, "RAM");
assert.deepEqual(ramFacets.filters, { usage: ["CONSUMER_DESKTOP"], generation: ["DDR5"] });
assert.ok(ramFacets.facets.configuration.values.length > 0);
for (const option of ramFacets.facets.configuration.values) {
  assert.ok(publicPcModelsForApi({ category: "RAM", usage: "CONSUMER_DESKTOP", generation: "DDR5", configuration: option.value }).models.length > 0);
}

const classifications = [
  ["PowerColor RX 7800 XT", "GPU", "CONSUMER_DESKTOP", "SINGLE", true],
  ["XFX RX 7900 XTX 24GB", "GPU", "CONSUMER_DESKTOP", "SINGLE", true],
  ["노트북 RTX 4070", "GPU", "LAPTOP", "COMPLETE_PC", false],
  ["RTX 4070 + Ryzen 7 7800X3D 세트", "UNSUPPORTED_CATEGORY", "UNKNOWN", "BUNDLE", false],
  ["MSI MAG B650M 박격포 WIFI", "MOTHERBOARD", "CONSUMER_DESKTOP", "SINGLE", true],
  ["Samsung M.2 SATA 1TB", "SSD", "CONSUMER_DESKTOP", "SINGLE", true],
  ["850W MAX 파워", "PSU", "CONSUMER_DESKTOP", "SINGLE", false],
  ["850W 풀모듈러 파워 케이블 없음", "PSU", "CONSUMER_DESKTOP", "SINGLE", false]
];
for (const [title, category, segment, listingType, eligible] of classifications) {
  const result = classifyPcPartListingPublic({ title, price: 100_000, currency: "KRW" });
  assert.equal(result.category_code, category, `${title} category`);
  assert.equal(result.market_segment, segment, `${title} market segment`);
  assert.equal(result.listing_type, listingType, `${title} listing type`);
  assert.equal(result.statistics_eligible, eligible, `${title} statistics eligibility`);
  for (const field of ["category_code", "market_segment", "listing_type", "condition_group", "canonical_product_id", "spec_group_id", "classification_confidence", "model_confidence", "quantity_confidence", "price_scope_confidence", "statistics_eligible", "statistics_exclusion_reasons", "parser_version", "rule_version"]) {
    assert.ok(Object.hasOwn(result, field), `${title} required classification field: ${field}`);
  }
}
const motherboard = classifyPcPartListingPublic({ title: "MSI MAG B650M 박격포 WIFI", price: 100_000, currency: "KRW" });
assert.equal(motherboard.socket, "AM5");
assert.equal(motherboard.chipset, "B650");
assert.equal(motherboard.form_factor, "M-ATX");
const sataSsd = classifyPcPartListingPublic({ title: "Samsung M.2 SATA 1TB", price: 100_000, currency: "KRW" });
assert.equal(sataSsd.protocol, "SATA");
const incompletePsu = classifyPcPartListingPublic({ title: "850W 풀모듈러 파워 케이블 없음", price: 100_000, currency: "KRW" });
assert.ok(incompletePsu.statistics_exclusion_reasons.includes("INCOMPLETE_CABLE_SET"));

const html = await readFile(path.join(appRoot, "web-backend/public/index.html"), "utf8");
for (const route of ["/categories/cpu", "/categories/gpu", "/categories/ram", "/categories/motherboard", "/categories/ssd", "/categories/hdd", "/categories/psu"]) assert.ok(html.includes(route), `SSR fallback route missing: ${route}`);
for (const label of catalog.categories.map((category) => category.label)) assert.ok(html.includes(label), `SSR fallback label missing: ${label}`);
const categoryLanding = await readFile(path.join(appRoot, "web-backend/public/used-market-categories.html"), "utf8");
assert.match(categoryLanding, /<meta name="robots" content="index, follow/u, "category landing must be indexable");
assert.match(categoryLanding, /<link rel="canonical" href="https:\/\/used-pick\.com\/categories"/u, "category landing canonical missing");
const sitemap = await readFile(path.join(appRoot, "web-backend/public/sitemap.xml"), "utf8");
for (const route of ["/categories", "/categories/cpu", "/categories/gpu", "/categories/ram", "/categories/motherboard", "/categories/ssd", "/categories/hdd", "/categories/psu"]) assert.ok(sitemap.includes(route), `sitemap route missing: ${route}`);
for (const retired of ["used-market-categories.html", "iphone-used-items.html"]) assert.equal(sitemap.includes(retired), false, `retired route remains in sitemap: ${retired}`);
const migration = await readFile(path.join(appRoot, "cloudflare/migrations/0012_pc_public_classification.sql"), "utf8");
for (const field of ["market_segment", "listing_type", "condition_group", "spec_group_id", "classification_confidence", "model_confidence", "quantity_confidence", "price_scope_confidence", "statistics_eligible", "statistics_exclusion_reasons_json"]) assert.ok(migration.includes(field), `migration field missing: ${field}`);

const { createServer } = await import("../dist/web-backend/logic/server.js");
const server = createServer(0, { initializeStorage: false, publicApiOnly: true });
try {
  if (!server.listening) await once(server, "listening");
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const categoriesResponse = await fetch(`${baseUrl}/api/catalog/categories`);
  assert.equal(categoriesResponse.status, 200);
  assert.deepEqual((await categoriesResponse.json()).data.categories.map((category) => category.code), categoryCodes);
  const facetsResponse = await fetch(`${baseUrl}/api/catalog/facets?category=GPU&gpu_model=RX%207800%20XT`);
  assert.equal(facetsResponse.status, 200);
  assert.equal((await facetsResponse.json()).data.category, "GPU");
  const modelsResponse = await fetch(`${baseUrl}/api/catalog/models?category=SSD&model=990%20PRO`);
  assert.equal(modelsResponse.status, 200);
  assert.ok((await modelsResponse.json()).data.models.length >= 2);
  const globalModelsResponse = await fetch(`${baseUrl}/api/catalog/models?q=RX%20460`);
  assert.equal(globalModelsResponse.status, 200);
  assert.ok((await globalModelsResponse.json()).data.models.some((model) => model.canonical_product_id === "gpu:amd:rx-460"));
  const categoryPage = await fetch(`${baseUrl}/categories/gpu`);
  assert.equal(categoryPage.status, 200);
  assert.match(await categoryPage.text(), /category-rail/u);
  const categoryLandingPage = await fetch(`${baseUrl}/categories`);
  assert.equal(categoryLandingPage.status, 200);
  const categoryLandingHtml = await categoryLandingPage.text();
  assert.match(categoryLandingHtml, /<title>PC 부품 카테고리 \| USED PICK<\/title>/u);
  assert.match(categoryLandingHtml, /<meta name="robots" content="index, follow/u);
  const retiredPage = await fetch(`${baseUrl}/iphone-used-items.html`);
  assert.equal(retiredPage.status, 410);
  const unsupportedRoute = await fetch(`${baseUrl}/categories/monitor`);
  assert.equal(unsupportedRoute.status, 410);
  const legacyRoute = await fetch(`${baseUrl}/used-market-categories.html`, { redirect: "manual" });
  assert.equal(legacyRoute.status, 301);
  assert.equal(legacyRoute.headers.get("location"), "/categories");
} finally {
  server.close();
  if (server.listening) await once(server, "close");
}

console.log("PC public catalog contract passed");
