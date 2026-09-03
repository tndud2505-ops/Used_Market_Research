import assert from "node:assert/strict";
import {
  PC_GPU_BOARD_MANUFACTURERS_V2,
  PC_PART_CATEGORY_SEEDS_V2,
  PC_PRODUCT_MASTER_V2,
  PC_PRODUCT_MASTER_V2_VERSION
} from "../market/data/pc-product-master-v2.mjs";
import {
  getPcPartFacetSchemaV2,
  listPcPartCategoriesV2,
  pcPartsDirectoryForApiV2,
  queryPcPartsDirectoryV2
} from "../market/logic/pc-parts-directory.mjs";

assert.equal(PC_PRODUCT_MASTER_V2_VERSION, 2);
assert.equal(PC_PART_CATEGORY_SEEDS_V2.length, 11);
assert.deepEqual(listPcPartCategoriesV2().map(({ code }) => code), [
  "GPU", "CPU", "RAM", "MOTHERBOARD", "SSD", "HDD", "PSU", "COOLING", "CASE", "EXPANSION_CARD", "ODD"
]);
for (const category of listPcPartCategoriesV2()) {
  assert.ok(category.manufacturers.length > 0, `${category.code} must expose manufacturer seeds`);
  assert.ok(Object.keys(getPcPartFacetSchemaV2(category.code)).length > 0, `${category.code} must expose browse facets`);
}

const requiredKeys = ["id", "name", "category", "group", "manufacturer", "brand", "aliases", "forbidden", "spec", "browse_facets"];
for (const product of PC_PRODUCT_MASTER_V2) {
  for (const key of requiredKeys) assert.ok(Object.hasOwn(product, key), `${product.id} must include ${key}`);
  assert.match(product.id, /^[a-z0-9]+:[a-z0-9:-]+$/u);
  assert.ok(product.name && product.group && product.manufacturer && product.brand);
  assert.ok(Array.isArray(product.aliases) && Array.isArray(product.forbidden));
  assert.equal(product.spec.directory_node_type, product.browse_facets.directory_node_type);
}

const ids = PC_PRODUCT_MASTER_V2.map(({ id }) => id);
assert.equal(new Set(ids).size, ids.length, "V2 stable product ids must be unique");
const manufacturerExpandedCategories = new Set(["RAM", "SSD", "HDD", "MOTHERBOARD", "PSU", "COOLING", "CASE", "EXPANSION_CARD", "ODD"]);
const manufacturerAliasOwners = new Map();
for (const product of PC_PRODUCT_MASTER_V2.filter((entry) => manufacturerExpandedCategories.has(entry.category))) {
  for (const alias of product.aliases) {
    const key = `${product.category}:${alias.normalize("NFKC").toLocaleLowerCase().replace(/[^0-9a-z가-힣]+/gu, "")}`;
    const owners = manufacturerAliasOwners.get(key) || new Set();
    owners.add(product.id);
    manufacturerAliasOwners.set(key, owners);
  }
}
assert.deepEqual(
  [...manufacturerAliasOwners].filter(([, owners]) => owners.size > 1),
  [],
  "manufacturer-specific directory aliases must never resolve to multiple products"
);

const expectedGpuGenerations = ["GTX 900", "GTX 10", "GTX 16", "RTX 20", "RTX 30", "RTX 40", "RTX 50", "RX 400", "RX 500", "Vega", "RX 5000", "RX 6000", "RX 7000", "RX 9000", "Arc A", "Arc B"];
const gpuProducts = PC_PRODUCT_MASTER_V2.filter((product) => product.category === "GPU");
for (const generation of expectedGpuGenerations) {
  assert.ok(gpuProducts.some((product) => product.browse_facets.generation === generation), `missing GPU generation ${generation}`);
}
for (const product of gpuProducts) {
  assert.equal(product.spec.manufacturer_roles.chip, product.spec.chip_manufacturer);
  assert.equal(product.spec.manufacturer_roles.board, null);
  assert.equal(product.spec.board_manufacturer, null);
  assert.equal(product.browse_facets.board_manufacturer, null);
}
assert.ok(PC_GPU_BOARD_MANUFACTURERS_V2.includes("ZOTAC"));
assert.ok(getPcPartFacetSchemaV2("GPU").board_manufacturer.includes("ASUS"));
assert.ok(getPcPartFacetSchemaV2("GPU").board_manufacturer.includes("Sapphire"));

const i7K = PC_PRODUCT_MASTER_V2.find((product) => product.id === "cpu:intel:i7-14700k");
const i7Kf = PC_PRODUCT_MASTER_V2.find((product) => product.id === "cpu:intel:i7-14700kf");
assert.equal(i7K.spec.suffix, "K");
assert.equal(i7Kf.spec.suffix, "KF");
assert.notEqual(i7K.id, i7Kf.id);
assert.deepEqual(queryPcPartsDirectoryV2({ category: "CPU", query: "14700K" }).items.map(({ id }) => id), ["cpu:intel:i7-14700k"]);
assert.deepEqual(queryPcPartsDirectoryV2({ category: "CPU", query: "14700KF" }).items.map(({ id }) => id), ["cpu:intel:i7-14700kf"]);
assert.deepEqual(queryPcPartsDirectoryV2({ category: "CPU", query: "14700kf" }).items.map(({ id }) => id), ["cpu:intel:i7-14700kf"]);
assert.deepEqual(queryPcPartsDirectoryV2({ category: "GPU", query: "2080ti" }).items.map(({ id }) => id), ["gpu:nvidia:rtx-2080-ti"]);
for (let generation = 6; generation <= 14; generation += 1) {
  assert.ok(PC_PRODUCT_MASTER_V2.some((product) => product.category === "CPU" && product.browse_facets.generation === `${generation}th`), `missing Intel ${generation}th generation`);
}
for (const generation of [1000, 2000, 3000, 4000, 5000, 7000, 8000, 9000]) {
  assert.ok(PC_PRODUCT_MASTER_V2.some((product) => product.category === "CPU" && product.browse_facets.generation === `Ryzen ${generation}`), `missing Ryzen ${generation}`);
}
assert.ok(PC_PRODUCT_MASTER_V2.some((product) => product.category === "CPU" && product.browse_facets.generation === "Core Ultra 200S"));
assert.equal(PC_PRODUCT_MASTER_V2.find((product) => product.id === "cpu:amd:ryzen-7-7800x3d").spec.suffix, "X3D");

const ramCapacities = [4, 8, 16, 24, 32, 48, 64, 96, 128];
const ramProducts = PC_PRODUCT_MASTER_V2.filter((product) => product.category === "RAM");
const ramManufacturers = PC_PART_CATEGORY_SEEDS_V2.find((category) => category.code === "RAM").manufacturers;
assert.equal(ramProducts.length, 3 * ramCapacities.length * ramManufacturers.length);
for (const generation of ["DDR3", "DDR4", "DDR5"]) {
  assert.deepEqual(
    [...new Set(ramProducts.filter((product) => product.spec.memory_generation === generation).map((product) => product.spec.module_capacity_gb))].sort((left, right) => left - right),
    ramCapacities
  );
}
assert.deepEqual(getPcPartFacetSchemaV2("RAM").module_capacity_gb, ramCapacities);
assert.equal(queryPcPartsDirectoryV2({
  category: "RAM", manufacturer: "Samsung",
  facets: { memory_generation: "DDR5", module_capacity_gb: "16" }
}).items[0].name, "Samsung DDR5 16GB Memory Module");
assert.equal(ramProducts.some((product) => product.aliases.includes("DDR3 4GB")), false,
  "an unqualified RAM capacity must stay ambiguous until a manufacturer is known");

for (const category of ["SSD", "HDD"]) {
  const buckets = PC_PRODUCT_MASTER_V2.filter((product) => product.category === category);
  assert.ok(buckets.length >= 7);
  assert.ok(buckets.every((product) => product.spec.directory_node_type === "BROWSE_BUCKET"));
  for (const manufacturer of PC_PART_CATEGORY_SEEDS_V2.find((entry) => entry.code === category).manufacturers) {
    assert.ok(buckets.some((product) => product.manufacturer === manufacturer), `${category} missing ${manufacturer}`);
  }
}

const first = queryPcPartsDirectoryV2({ category: "GPU", query: "RTX", limit: 5 });
const repeated = queryPcPartsDirectoryV2({ query: "RTX", limit: 5, category: "gpu" });
assert.deepEqual(repeated, first, "equivalent directory requests must return the same order and cursor");
assert.ok(first.next_cursor);
const second = queryPcPartsDirectoryV2({ category: "GPU", query: "RTX", limit: 5, cursor: first.next_cursor });
assert.equal(new Set([...first.items, ...second.items].map(({ id }) => id)).size, first.items.length + second.items.length);
assert.throws(
  () => queryPcPartsDirectoryV2({ category: "CPU", query: "RTX", limit: 5, cursor: first.next_cursor }),
  /cursor does not match/u
);

const api = pcPartsDirectoryForApiV2({ category: "RAM", facets: { memory_generation: "DDR5", module_capacity_gb: [48, 64] }, limit: 10 });
assert.equal(api.master_version, 2);
assert.deepEqual([...new Set(api.products.items.map((product) => product.spec.module_capacity_gb))], [48, 64]);
assert.ok(api.categories.length === 11 && api.facet_schema.memory_generation.includes("DDR5"));

console.log(`pc-directory-contract: ok (${PC_PRODUCT_MASTER_V2.length} V2 directory nodes)`);
