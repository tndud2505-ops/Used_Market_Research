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
  publicPcModelsForApi,
  resolveExactMotherboardProduct,
  resolveMotherboardDirectoryNode
} from "../market/logic/pc-public-catalog.mjs";
import {
  PC_LEGACY_CANONICAL_ID_SUCCESSORS_V3,
  PC_PRODUCT_MASTER_V2_VERSION
} from "../market/data/pc-product-master-v2.mjs";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalog = publicPcCatalogForApi();
assert.equal(PC_PRODUCT_MASTER_V2_VERSION, 4);
assert.equal(catalog.master_version, "public-pc-4");
const categoryCodes = catalog.categories.map((category) => category.code);
assert.deepEqual(categoryCodes, ["CPU", "GPU", "RAM", "MOTHERBOARD", "SSD", "HDD", "PSU"]);
assert.deepEqual(PUBLIC_PC_PART_CATEGORIES, categoryCodes);
assert.deepEqual(catalog.categories.map((category) => category.label), [
  "CPU", "그래픽카드", "RAM", "메인보드", "SSD", "HDD", "파워서플라이"
]);
assert.equal(categoryCodes.some((code) => ["CASE", "COOLING", "ODD", "EXPANSION_CARD"].includes(code)), false);
assert.deepEqual(catalog.categories.map((category) => Object.keys(category).filter((key) => ["model_count", "active_count", "sold_30d_count"].includes(key))),
  categoryCodes.map(() => ["model_count", "active_count", "sold_30d_count"]));
for (const code of categoryCodes) {
  const available = publicPcFacetsForApi({ category: code }).available_facets;
  for (const facet of catalog.facet_schema[code]) {
    assert.ok(available[facet.key]?.length > 1, `${code}.${facet.key} must have enough real values to be publicly declared`);
    assert.equal(["model", "gpu_model"].includes(facet.key), false, "exact models belong in search and the model table");
  }
}
assert.deepEqual(new Set(publicPcFacetsForApi({ category: "SSD" }).available_facets.product_kind.map(({ value }) => value)), new Set([
  "M2_NVME", "SATA_2_5", "M2_SATA", "EXTERNAL", "OTHER_UNKNOWN"
]));
assert.deepEqual(new Set(publicPcFacetsForApi({ category: "HDD" }).available_facets.placement.map(({ value }) => value)), new Set([
  "INTERNAL", "EXTERNAL", "UNKNOWN"
]));

const requiredModelFields = [
  "canonical_product_id", "canonical_display_name", "category_code", "brand_label", "key_specs",
  "active_count", "active_median", "active_trimmed_mean", "sold_30d_count", "sold_30d_last_ask_median", "last_updated_at"
];
const models = publicPcModelsForApi({ category: "SSD", model: "990 PRO" }).models;
assert.deepEqual(new Set(models.map((model) => model.canonical_product_id)), new Set([
  "ssd:samsung:capacity-bucket:513-gb-1-tb",
  "ssd:samsung:capacity-bucket:gt-1-tb-le-2-tb"
]));
for (const model of models) for (const field of requiredModelFields) assert.ok(Object.hasOwn(model, field), `model field missing: ${field}`);

const expectedAggregateCounts = { SSD: 70, HDD: 40, PSU: 84 };
for (const [category, expectedCount] of Object.entries(expectedAggregateCounts)) {
  const aggregateModels = publicPcModelsForApi({ category }).models;
  assert.equal(aggregateModels.length, expectedCount, `${category} public aggregate count`);
  assert.equal(aggregateModels.some((model) => model.canonical_product_id.includes(":spec:")), false,
    `${category} detailed spec IDs must not be public`);
}
assert.deepEqual(PC_LEGACY_CANONICAL_ID_SUCCESSORS_V3["ssd:samsung:990-pro-2tb"],
  ["ssd:samsung:capacity-bucket:gt-1-tb-le-2-tb"]);
assert.deepEqual(PC_LEGACY_CANONICAL_ID_SUCCESSORS_V3["hdd:seagate:st16000dm001"],
  ["hdd:seagate:capacity-bucket:gt-12-tb-le-16-tb"]);
assert.deepEqual(PC_LEGACY_CANONICAL_ID_SUCCESSORS_V3["psu:corsair:rm1000x"],
  ["psu:corsair:watts-bucket:851-1000"]);
assert.equal(PC_LEGACY_CANONICAL_ID_SUCCESSORS_V3["psu:facet:atx:corsair"].length, 7,
  "ambiguous legacy PSU form-factor IDs must expose every explicit successor instead of inventing one price bucket");
assert.equal(PC_LEGACY_CANONICAL_ID_SUCCESSORS_V3["psu:facet:atx"].length, 84,
  "the old manufacturer-free PSU form-factor ID must remain an explicit ambiguous legacy scope");

const globalSearchModels = publicPcModelsForApi({ q: "RX 460" }).models;
assert.ok(globalSearchModels.some((model) => model.canonical_product_id === "gpu:amd:rx-460"),
  "global model search must work without a category filter");
assert.deepEqual(publicPcFacetsForApi({ q: "RX 460" }).available_facets, {},
  "global model search must not invent category-specific facets");

const exactCpuFacets = publicPcFacetsForApi({ category: "CPU", q: "i5 7400" }).available_facets;
assert.deepEqual(exactCpuFacets.manufacturer.map(({ value }) => value), ["Intel"]);
assert.deepEqual(exactCpuFacets.generation.map(({ value }) => value), ["7th"]);
assert.deepEqual(exactCpuFacets.socket.map(({ value }) => value), ["LGA1151"],
  "text search facets must describe matching models instead of the whole category");

const ramFacets = publicPcFacetsForApi({ category: "RAM", usage: "CONSUMER_DESKTOP", generation: "DDR5" });
assert.deepEqual(ramFacets.category, "RAM");
assert.deepEqual(ramFacets.filters, { usage: ["CONSUMER_DESKTOP"], generation: ["DDR5"] });
assert.ok(ramFacets.facets.module_capacity_gb.values.length > 0);
for (const option of ramFacets.facets.module_capacity_gb.values) {
  assert.ok(publicPcModelsForApi({ category: "RAM", usage: "CONSUMER_DESKTOP", generation: "DDR5", module_capacity_gb: option.value }).models.length > 0);
}

const repeatedCpuParams = new URLSearchParams([
  ["category_code", "CPU"],
  ["manufacturer", "AMD"],
  ["manufacturer", "Intel"],
  ["generation", "Ryzen 9000"],
  ["generation", "14th"]
]);
const repeatedCpuModels = publicPcModelsForApi(repeatedCpuParams);
const expectedCpuIds = new Set(["AMD", "Intel"].flatMap((manufacturer) => (
  ["Ryzen 9000", "14th"].flatMap((generation) => (
    publicPcModelsForApi({ category: "CPU", manufacturer, generation }).models
  ))
)).map((model) => model.canonical_product_id));
assert.deepEqual(repeatedCpuModels.filters, {
  manufacturer: ["AMD", "Intel"],
  generation: ["Ryzen 9000", "14th"]
});
assert.deepEqual(new Set(repeatedCpuModels.models.map((model) => model.canonical_product_id)), expectedCpuIds,
  "values in one facet row must use OR while different rows use AND");
const repeatedCpuFacets = publicPcFacetsForApi(repeatedCpuParams);
for (const manufacturer of ["AMD", "Intel"]) {
  const option = repeatedCpuFacets.available_facets.manufacturer.find(({ value }) => value === manufacturer);
  const expected = publicPcModelsForApi({
    category: "CPU",
    manufacturer,
    generation: ["Ryzen 9000", "14th"]
  }).models.length;
  assert.equal(option?.count, expected, `self-excluding manufacturer count is wrong: ${manufacturer}`);
}
for (const generation of ["Ryzen 9000", "14th"]) {
  const option = repeatedCpuFacets.available_facets.generation.find(({ value }) => value === generation);
  const expected = publicPcModelsForApi({
    category: "CPU",
    manufacturer: ["AMD", "Intel"],
    generation
  }).models.length;
  assert.equal(option?.count, expected, `self-excluding generation count is wrong: ${generation}`);
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
assert.equal(motherboard.canonical_product_id, "motherboard:msi:mag-b650m-mortar-wifi");
assert.equal(motherboard.socket, "AM5");
assert.equal(motherboard.chipset, "B650");
assert.equal(motherboard.form_factor, "Micro-ATX");
const exactMotherboardCases = [
  ["ASUS ROG STRIX B550-A GAMING", "motherboard:asus:rog-strix-b550-a-gaming"],
  ["ASUS TUF GAMING B550-PRO", "motherboard:asus:tuf-gaming-b550-pro"],
  ["ASUS PRIME B550M-A", "motherboard:asus:prime-b550m-a"],
  ["ROG STRIX B550-I GAMING", "motherboard:asus:rog-strix-b550-i-gaming"],
  ["ASRock Z370M Pro4 메인보드", "motherboard:asrock:z370m-pro4"],
  ["ASUS TUF GAMING B850M-PLUS II 메인보드", "motherboard:asus:tuf-gaming-b850m-plus-ii"],
  ["GIGABYTE B550M AORUS ELITE rev 1.3 메인보드", "motherboard:gigabyte:b550m-aorus-elite"],
  ["GIGABYTE X870 AORUS ELITE WIFI7 ICE rev 1.2 메인보드", "motherboard:gigabyte:x870-aorus-elite-wifi7-ice"]
];
const registeredMotherboards = publicPcModelsForApi({ category: "MOTHERBOARD" }).models;
assert.equal(registeredMotherboards.filter((product) => product.key_specs.directory_node_type === "PRODUCT").length, 29);
assert.equal(registeredMotherboards.some((product) => product.canonical_product_id === "motherboard:asus:tuf-gaming-b760m-a-d4"), false,
  "an unverified/non-existent supplemental model must not survive outside the master");
for (const [title, id] of exactMotherboardCases) {
  assert.equal(resolveExactMotherboardProduct(title).product?.id, id, `${title} exact identity`);
  const result = classifyPcPartListingPublic({ title, price: 100_000, currency: "KRW" });
  assert.equal(result.canonical_product_id, id);
  assert.equal(result.statistics_eligible, true);
}
for (const title of [
  "ASUS B550 메인보드",
  "ASUS PRIME B550M-A WIFI",
  "ASUS PRIME B550M-A WIFI6",
  "ASUS PRIME B550M-A WIFI6E",
  "ASUS PRIME B550M-A WI-FI 6",
  "ASUS TUF GAMING B760M-A",
  "ASUS TUF GAMING B760M-A D5",
  "ASUS TUF GAMING B760M-PLUS II WIFI6",
  "ASUS TUF GAMING B760M-PLUS II D4",
  "ASUS H110I-PLUS D3 메인보드",
  "ASRock B150M Pro4 D3 메인보드",
  "GIGABYTE B450M DS3H 메인보드",
  "GIGABYTE B450M DS3H V2 메인보드",
  "GIGABYTE B550M AORUS ELITE AX 메인보드",
  "GIGABYTE B550M AORUS ELITE AX rev 1.3 메인보드",
  "GIGABYTE A520M K V2 ICE rev 1.0 메인보드",
  "GIGABYTE A520M K V2 D5 rev 1.0 메인보드",
  "GIGABYTE A520M K V2 II rev 1.0 메인보드",
  "ASUS PRIME B550M-A rev 1.2",
  "ASUS PRIME B550M-A 또는 TUF GAMING B550-PRO 중 하나 랜덤 출고",
  "ASUS MSI MAG B650M MORTAR WIFI"
]) {
  const exact = resolveExactMotherboardProduct(title);
  assert.equal(exact.product, null, `${title} must not invent an exact model`);
  const result = classifyPcPartListingPublic({ title, price: 100_000, currency: "KRW" });
  assert.equal(result.statistics_eligible, false);
  assert.ok(result.statistics_exclusion_reasons.includes("EXACT_MODEL_REQUIRED"));
}
assert.equal(resolveMotherboardDirectoryNode("ASUS B550 메인보드").product?.id, "motherboard:platform:amd:asus");
const includedIoShield = classifyPcPartListingPublic({
  title: "ASUS PRIME B550M-A 메인보드", description: "정상 작동, IO 실드 포함", price: 80_000, currency: "KRW"
});
assert.equal(includedIoShield.canonical_product_id, "motherboard:asus:prime-b550m-a");
assert.equal(includedIoShield.statistics_eligible, true);
for (const listing of [
  { title: "ASUS PRIME B550M-A IO 실드만 판매", price: 5_000, currency: "KRW" },
  { title: "ASUS PRIME B550M-A IO 실드", price: 5_000, currency: "KRW" },
  { title: "ASUS PRIME B550M-A 백패널", price: 5_000, currency: "KRW" },
  { title: "ASUS PRIME B550M-A + Ryzen 5600 CPU 세트", price: 180_000, currency: "KRW" }
]) {
  const result = classifyPcPartListingPublic(listing);
  assert.equal(result.statistics_eligible, false);
  assert.equal(result.canonical_product_id, null);
}
const sataSsd = classifyPcPartListingPublic({ title: "Samsung M.2 SATA 1TB", price: 100_000, currency: "KRW" });
assert.equal(sataSsd.protocol, "SATA");
const incompletePsu = classifyPcPartListingPublic({ title: "850W 풀모듈러 파워 케이블 없음", price: 100_000, currency: "KRW" });
assert.ok(incompletePsu.statistics_exclusion_reasons.includes("INCOMPLETE_CABLE_SET"));

const aggregateBoundaryCases = [
  ["무명 SSD 250GB", "ssd:other-unclassified:capacity-bucket:le-256-gb", "LE_256_GB"],
  ["Samsung SSD 256GB", "ssd:samsung:capacity-bucket:le-256-gb", "LE_256_GB"],
  ["Samsung SSD 257GB", "ssd:samsung:capacity-bucket:257-512-gb", "257_512_GB"],
  ["Crucial SSD 400GB", "ssd:crucial:capacity-bucket:257-512-gb", "257_512_GB"],
  ["Samsung SSD 512GB", "ssd:samsung:capacity-bucket:257-512-gb", "257_512_GB"],
  ["Samsung SSD 800GB", "ssd:samsung:capacity-bucket:513-gb-1-tb", "513_GB_1_TB"],
  ["Samsung 990 PRO 1TB", "ssd:samsung:capacity-bucket:513-gb-1-tb", "513_GB_1_TB"],
  ["삼성 SSD 1테라", "ssd:samsung:capacity-bucket:513-gb-1-tb", "513_GB_1_TB"],
  ["Samsung SSD 1.6TB", "ssd:samsung:capacity-bucket:gt-1-tb-le-2-tb", "GT_1_TB_LE_2_TB"],
  ["Samsung 990 PRO 2TB", "ssd:samsung:capacity-bucket:gt-1-tb-le-2-tb", "GT_1_TB_LE_2_TB"],
  ["Samsung SSD 3.2TB", "ssd:samsung:capacity-bucket:gt-2-tb-le-4-tb", "GT_2_TB_LE_4_TB"],
  ["Samsung SSD 4TB", "ssd:samsung:capacity-bucket:gt-2-tb-le-4-tb", "GT_2_TB_LE_4_TB"],
  ["Samsung SSD 8TB", "ssd:samsung:capacity-bucket:gt-4-tb-le-8-tb", "GT_4_TB_LE_8_TB"],
  ["Samsung SSD 9TB", "ssd:samsung:capacity-bucket:gt-8-tb", "GT_8_TB"],
  ["WD HDD 750GB", "hdd:western-digital:capacity-bucket:le-1-tb", "LE_1_TB"],
  ["WD HDD 1TB", "hdd:western-digital:capacity-bucket:le-1-tb", "LE_1_TB"],
  ["WD HDD 1.5TB", "hdd:western-digital:capacity-bucket:gt-1-tb-le-2-tb", "GT_1_TB_LE_2_TB"],
  ["WD HDD 2TB", "hdd:western-digital:capacity-bucket:gt-1-tb-le-2-tb", "GT_1_TB_LE_2_TB"],
  ["WD HDD 3TB", "hdd:western-digital:capacity-bucket:gt-2-tb-le-4-tb", "GT_2_TB_LE_4_TB"],
  ["WD HDD 4TB", "hdd:western-digital:capacity-bucket:gt-2-tb-le-4-tb", "GT_2_TB_LE_4_TB"],
  ["WD HDD 5TB", "hdd:western-digital:capacity-bucket:gt-4-tb-le-6-tb", "GT_4_TB_LE_6_TB"],
  ["WD HDD 6TB", "hdd:western-digital:capacity-bucket:gt-4-tb-le-6-tb", "GT_4_TB_LE_6_TB"],
  ["WD HDD 7TB", "hdd:western-digital:capacity-bucket:gt-6-tb-le-8-tb", "GT_6_TB_LE_8_TB"],
  ["WD Red Plus 8TB", "hdd:western-digital:capacity-bucket:gt-6-tb-le-8-tb", "GT_6_TB_LE_8_TB"],
  ["Seagate HDD 10TB", "hdd:seagate:capacity-bucket:gt-8-tb-le-12-tb", "GT_8_TB_LE_12_TB"],
  ["Seagate HDD 12TB", "hdd:seagate:capacity-bucket:gt-8-tb-le-12-tb", "GT_8_TB_LE_12_TB"],
  ["Seagate HDD 14TB", "hdd:seagate:capacity-bucket:gt-12-tb-le-16-tb", "GT_12_TB_LE_16_TB"],
  ["Seagate HDD 16TB", "hdd:seagate:capacity-bucket:gt-12-tb-le-16-tb", "GT_12_TB_LE_16_TB"],
  ["Seagate HDD 18TB", "hdd:seagate:capacity-bucket:gt-16-tb-le-20-tb", "GT_16_TB_LE_20_TB"],
  ["Seagate HDD 20TB", "hdd:seagate:capacity-bucket:gt-16-tb-le-20-tb", "GT_16_TB_LE_20_TB"],
  ["Seagate HDD 22TB", "hdd:seagate:capacity-bucket:gt-20-tb-le-24-tb", "GT_20_TB_LE_24_TB"],
  ["Seagate HDD 24TB", "hdd:seagate:capacity-bucket:gt-20-tb-le-24-tb", "GT_20_TB_LE_24_TB"],
  ["Seagate HDD 26TB", "hdd:seagate:capacity-bucket:gt-24-tb", "GT_24_TB"],
  ["Micronics 파워 500W", "psu:micronics:watts-bucket:le-500", "LE_500"],
  ["FSP 파워 520W", "psu:fsp:watts-bucket:501-650", "501_650"],
  ["FSP 파워 650W", "psu:fsp:watts-bucket:501-650", "501_650"],
  ["Micronics 파워 700W", "psu:micronics:watts-bucket:651-750", "651_750"],
  ["Micronics 파워 750W", "psu:micronics:watts-bucket:651-750", "651_750"],
  ["Corsair RM850x 850W", "psu:corsair:watts-bucket:751-850", "751_850"],
  ["Corsair RM1000x 1000W", "psu:corsair:watts-bucket:851-1000", "851_1000"],
  ["Micronics 파워 1050W", "psu:micronics:watts-bucket:1001-1200", "1001_1200"],
  ["Micronics 파워 1200W", "psu:micronics:watts-bucket:1001-1200", "1001_1200"],
  ["무명 파워 1300W", "psu:other-unclassified:watts-bucket:gt-1200", "GT_1200"]
];
for (const [title, expectedId, expectedBucket] of aggregateBoundaryCases) {
  const result = classifyPcPartListingPublic({ title, price: 100_000, currency: "KRW" });
  assert.equal(result.canonical_product_id, expectedId, `${title} canonical aggregate`);
  assert.equal(result.capacity_bucket || result.watts_bucket, expectedBucket, `${title} aggregate bucket`);
}
for (const [title, expectedId, expectedSegment] of [
  ["Toshiba 노트북용 2.5인치 HDD 1TB", "hdd:toshiba:capacity-bucket:le-1-tb", "LAPTOP"],
  ["Seagate Exos 기업용 HDD 20TB", "hdd:seagate:capacity-bucket:gt-16-tb-le-20-tb", "SERVER_ENTERPRISE"],
  ["Samsung 서버용 SSD 3.2TB", "ssd:samsung:capacity-bucket:gt-2-tb-le-4-tb", "SERVER_ENTERPRISE"]
]) {
  const result = classifyPcPartListingPublic({ title, price: 100_000, currency: "KRW" });
  assert.equal(result.canonical_product_id, expectedId, `${title} keeps a browse identity`);
  assert.equal(result.market_segment, expectedSegment, `${title} market segment`);
  assert.equal(result.statistics_eligible, false, `${title} cannot enter desktop reference statistics`);
}
for (const [title, expectedId] of [
  ["삼성 970 EVO Plus 1TB", "ssd:samsung:capacity-bucket:513-gb-1-tb"],
  ["삼성 980 500GB", "ssd:samsung:capacity-bucket:257-512-gb"],
  ["삼성 PM9A1 512GB", "ssd:samsung:capacity-bucket:257-512-gb"],
  ["SK하이닉스 P41 2TB", "ssd:sk-hynix:capacity-bucket:gt-1-tb-le-2-tb"],
  ["WD Blue SN580 1TB", "ssd:western-digital:capacity-bucket:513-gb-1-tb"],
  ["SN850X 2TB", "ssd:western-digital:capacity-bucket:gt-1-tb-le-2-tb"],
  ["IronWolf Pro 16TB", "hdd:seagate:capacity-bucket:gt-12-tb-le-16-tb"],
  ["씨게이트 아이언울프 4TB", "hdd:seagate:capacity-bucket:gt-2-tb-le-4-tb"],
  ["ST16000DM001 16TB", "hdd:seagate:capacity-bucket:gt-12-tb-le-16-tb"],
  ["Toshiba X300 8TB", "hdd:toshiba:capacity-bucket:gt-6-tb-le-8-tb"]
]) {
  const result = classifyPcPartListingPublic({ title, price: 100_000, currency: "KRW" });
  assert.equal(result.canonical_product_id, expectedId, `${title} storage aggregate`);
  assert.equal(result.statistics_eligible, true, `${title} consumer storage remains statistics eligible`);
}

const externalHdd = classifyPcPartListingPublic({ title: "외장하드 WD 4TB USB", price: 100_000, currency: "KRW" });
assert.equal(externalHdd.category_code, "HDD");
assert.equal(externalHdd.placement, "EXTERNAL");
assert.ok(externalHdd.canonical_product_id);
assert.equal(externalHdd.statistics_eligible, false);
assert.ok(externalHdd.statistics_exclusion_reasons.includes("EXTERNAL_STORAGE_EXCLUDED_FROM_REFERENCE_STATS"));

for (const [title, category] of [
  ["Samsung T7 Shield SSD 1TB", "SSD"],
  ["WD My Passport SSD 1TB", "SSD"],
  ["Seagate Backup Plus HDD 4TB", "HDD"],
  ["WD Elements HDD 4TB", "HDD"]
]) {
  const externalStorage = classifyPcPartListingPublic({ title, price: 100_000, currency: "KRW" });
  assert.equal(externalStorage.category_code, category, `${title} category`);
  assert.equal(externalStorage.placement, "EXTERNAL", `${title} placement`);
  assert.ok(externalStorage.canonical_product_id, `${title} remains searchable`);
  assert.equal(externalStorage.statistics_eligible, false, `${title} reference statistics exclusion`);
}

const nvmeSsd = classifyPcPartListingPublic({ title: "삼성 980 PRO M.2 NVMe SSD 1TB", price: 100_000, currency: "KRW" });
assert.equal(nvmeSsd.product_kind, "M2_NVME");
assert.equal(nvmeSsd.placement, "INTERNAL");
const sataSsdIdentityCase = classifyPcPartListingPublic({ title: "삼성 870 EVO 2.5인치 SATA SSD 1TB", price: 100_000, currency: "KRW" });
assert.equal(sataSsdIdentityCase.product_kind, "SATA_2_5");
assert.equal(sataSsdIdentityCase.canonical_product_id, nvmeSsd.canonical_product_id, "SSD detail filters must not split the statistics identity");
const internalHdd = classifyPcPartListingPublic({ title: "WD Blue 3.5인치 SATA HDD 4TB", price: 100_000, currency: "KRW" });
assert.equal(internalHdd.canonical_product_id, externalHdd.canonical_product_id, "HDD placement must not split the statistics identity");
const atxPsu = classifyPcPartListingPublic({ title: "Corsair 750W ATX 파워", price: 100_000, currency: "KRW" });
const sfxPsu = classifyPcPartListingPublic({ title: "Corsair 750W SFX 파워", price: 100_000, currency: "KRW" });
assert.equal(atxPsu.canonical_product_id, sfxPsu.canonical_product_id, "PSU form factor must not split the statistics identity");

const ratedAndPeakPsu = classifyPcPartListingPublic({
  title: "정격 650W 피크 750W 파워",
  price: 50_000,
  currency: "KRW"
});
assert.equal(ratedAndPeakPsu.canonical_product_id, "psu:other-unclassified:watts-bucket:501-650");
assert.equal(ratedAndPeakPsu.rated_wattage, 650);

const modelOnlyPsu = classifyPcPartListingPublic({ title: "RM850", price: 50_000, currency: "KRW" });
assert.equal(modelOnlyPsu.canonical_product_id, "psu:corsair:watts-bucket:751-850");
assert.equal(modelOnlyPsu.form_factor, "ATX");
assert.equal(classifyPcPartListingPublic({ title: "Classic II 700W", price: 50_000, currency: "KRW" }).form_factor, "ATX");

for (const title of ["삼성 980 500GB", "삼성 PM9A1 512GB", "WD Blue SN580 1TB"]) {
  const modelNamedSsd = classifyPcPartListingPublic({ title, price: 100_000, currency: "KRW" });
  assert.equal(modelNamedSsd.product_kind, "M2_NVME", `${title} product kind`);
  assert.equal(modelNamedSsd.placement, "UNKNOWN", `${title} placement remains evidence-based`);
}

const ratingOnlyPsu = classifyPcPartListingPublic({ title: "피크 900W 정격 700W", price: 50_000, currency: "KRW" });
assert.equal(ratingOnlyPsu.canonical_product_id, "psu:other-unclassified:watts-bucket:651-750");
assert.equal(ratingOnlyPsu.rated_wattage, 700);

for (const [title, expectedId, expectedWatts] of [
  ["파워 1kW", "psu:other-unclassified:watts-bucket:851-1000", 1000],
  ["파워 1.2kW", "psu:other-unclassified:watts-bucket:1001-1200", 1200]
]) {
  const kilowattPsu = classifyPcPartListingPublic({ title, price: 100_000, currency: "KRW" });
  assert.equal(kilowattPsu.canonical_product_id, expectedId);
  assert.equal(kilowattPsu.rated_wattage, expectedWatts);
}

for (const [title, expectedId] of [
  ["FSP 하이드로 프로 600W", "psu:fsp:watts-bucket:501-650"],
  ["HYDRO PRO 600", "psu:fsp:watts-bucket:501-650"],
  ["마이크로닉스 클래식2 700W", "psu:micronics:watts-bucket:651-750"],
  ["Classic II 700", "psu:micronics:watts-bucket:651-750"],
  ["슈퍼플라워 리덱스 850W", "psu:super-flower:watts-bucket:751-850"]
]) {
  assert.equal(classifyPcPartListingPublic({ title, price: 50_000, currency: "KRW" }).canonical_product_id, expectedId);
}

const repeatedStorage = classifyPcPartListingPublic({ title: "SSD 512GB 2개", price: 90_000, currency: "KRW" });
assert.equal(repeatedStorage.category_code, "SSD");
assert.equal(repeatedStorage.canonical_product_id, "ssd:other-unclassified:capacity-bucket:257-512-gb");

for (const title of [
  "M.2 외장 케이스 1TB 지원",
  "NVMe 외장 인클로저 2TB 지원",
  "M.2 SSD 방열판 2TB 지원",
  "PSU 케이블 850W 지원",
  "파워 케이블 1000W"
]) {
  const accessoryResult = classifyPcPartListingPublic({ title, price: 10_000, currency: "KRW" });
  assert.equal(accessoryResult.canonical_product_id, null, `${title} accessory product id`);
  assert.equal(accessoryResult.statistics_eligible, false, `${title} accessory eligibility`);
}

const storagePsuBundle = classifyPcPartListingPublic({
  title: "SSD 1TB 파워 600W",
  price: 100_000,
  currency: "KRW"
});
assert.equal(storagePsuBundle.statistics_eligible, false);
assert.equal(storagePsuBundle.canonical_product_id, null);

for (const title of ["SSD 1TB와 HDD 4TB", "SSD 1TB와 HDD 1TB", "SSD 1TB + HDD 4TB"]) {
  const mixedStorage = classifyPcPartListingPublic({ title, price: 100_000, currency: "KRW" });
  assert.equal(mixedStorage.statistics_eligible, false, `${title} mixed storage eligibility`);
  assert.equal(mixedStorage.canonical_product_id, null, `${title} mixed storage product id`);
}

const completePsu = classifyPcPartListingPublic({
  title: "850W 풀모듈러 파워 케이블 포함",
  price: 80_000,
  currency: "KRW"
});
assert.equal(completePsu.canonical_product_id, "psu:other-unclassified:watts-bucket:751-850");
for (const title of ["Corsair 850W MAX 파워", "Corsair 최대 850W 파워", "Corsair peak 850W power supply", "Corsair RM850x 850W MAX 파워"]) {
  const result = classifyPcPartListingPublic({ title, price: 100_000, currency: "KRW" });
  assert.equal(result.rated_wattage, null, `${title} rated wattage`);
  assert.equal(result.statistics_eligible, false, `${title} eligibility`);
}
for (const title of ["Samsung SSD 250GB", "Samsung SSD 256GB"]) {
  assert.notEqual(classifyPcPartListingPublic({ title, price: 100_000, currency: "KRW" }).form_factor, "2.5-inch",
    `${title} must not infer a 2.5-inch form factor from capacity digits`);
}

for (const title of ["파워 최대출력 700W", "최대출력 700W 파워", "power supply maximum 700W"]) {
  const maximumOnly = classifyPcPartListingPublic({ title, price: 30_000, currency: "KRW" });
  assert.equal(maximumOnly.rated_wattage, null, `${title} must not be treated as rated output`);
  assert.equal(maximumOnly.statistics_eligible, false, `${title} maximum-only PSU eligibility`);
}

const html = await readFile(path.join(appRoot, "web-backend/public/index.html"), "utf8");
for (const route of ["/categories/cpu", "/categories/gpu", "/categories/ram", "/categories/motherboard", "/categories/ssd", "/categories/hdd", "/categories/psu"]) assert.ok(html.includes(route), `SSR fallback route missing: ${route}`);
for (const label of catalog.categories.map((category) => category.label)) assert.ok(html.includes(label), `SSR fallback label missing: ${label}`);
for (const category of catalog.categories) {
  const route = `/categories/${category.code.toLowerCase()}`;
  const fallback = html.match(new RegExp(`href="${route}"[\\s\\S]*?category-count">(\\d+)개`, "u"));
  assert.equal(Number(fallback?.[1]), category.model_count, `SSR fallback count mismatch: ${category.code}`);
}
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
  const facetStatsResponse = await fetch(`${baseUrl}/api/products/${encodeURIComponent("motherboard:platform:amd:asus")}/price-stats?days=30&market_pool=KR_C2C_USED&condition=USED_WORKING&currency=KRW`);
  assert.equal(facetStatsResponse.status, 200);
  const facetStats = (await facetStatsResponse.json()).data;
  assert.deepEqual(facetStats.availability, { status: "unavailable", reason: "EXACT_MODEL_REQUIRED" });
  assert.equal(facetStats.reference_price.amount, null);
  assert.equal(facetStats.active.sample_count, 0);
  assert.equal(facetStats.sold.sample_count, 0);
  const globalModelsResponse = await fetch(`${baseUrl}/api/catalog/models?q=RX%20460`);
  assert.equal(globalModelsResponse.status, 200);
  assert.ok((await globalModelsResponse.json()).data.models.some((model) => model.canonical_product_id === "gpu:amd:rx-460"));
  const repeatedModelsResponse = await fetch(`${baseUrl}/api/catalog/models?${repeatedCpuParams}`);
  assert.equal(repeatedModelsResponse.status, 200);
  const repeatedModelsPayload = (await repeatedModelsResponse.json()).data;
  assert.deepEqual(repeatedModelsPayload.filters, repeatedCpuModels.filters);
  assert.deepEqual(new Set(repeatedModelsPayload.models.map((model) => model.canonical_product_id)), expectedCpuIds);
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
