import assert from "node:assert/strict";
import { PC_PRODUCT_MASTER_V2 } from "../market/data/pc-product-master-v2.mjs";
import { pcBrowseFlowCatalogV1, pcBrowseFlowForApiV1 } from "../market/data/browse-flows/index.mjs";

const catalog = pcBrowseFlowCatalogV1();
for (const category of ["GPU", "CPU", "RAM", "SSD", "PSU"]) {
  assert.ok(catalog[category], `${category} browse flow is published`);
  assert.ok(Array.isArray(catalog[category].steps), `${category} browse steps are arrays`);
}

const gpu = pcBrowseFlowForApiV1("GPU", {});
assert.deepEqual(gpu.steps.map(({ key }) => key), ["chip_manufacturer", "family"]);
assert.ok(gpu.available_facets.chip_manufacturer.length > 0, "GPU chip manufacturers are available immediately");
assert.deepEqual(gpu.available_facets.family, []);
const scopedGpu = pcBrowseFlowForApiV1("GPU", { chip_manufacturer: "NVIDIA", family: "GeForce RTX" });
assert.ok(scopedGpu.product_count > 0, "GPU manufacturer and family narrow the model directory");
assert.ok(scopedGpu.available_facets.family.every(({ value }) => ["GeForce GTX", "GeForce RTX"].includes(value)));

const cpuIntel = pcBrowseFlowForApiV1("CPU", { platform_vendor: "Intel" });
assert.ok(cpuIntel.available_facets.family.every(({ value }) => ["Core", "Core Ultra"].includes(value)));
const cpuAmd = pcBrowseFlowForApiV1("CPU", { platform_vendor: "AMD" });
assert.ok(cpuAmd.available_facets.family.every(({ value }) => value === "Ryzen"));

const ram = pcBrowseFlowForApiV1("RAM", { memory_generation: "DDR5" });
assert.deepEqual(ram.available_facets.module_capacity_gb.map(({ value }) => Number(value)), [4, 8, 16, 24, 32, 48, 64, 96, 128]);
assert.ok(ram.product_count > 0);

const ssd = pcBrowseFlowForApiV1("SSD", {});
assert.ok(ssd.available_facets.capacity_bucket.length > 0);
assert.deepEqual(ssd.steps.map(({ key }) => key), ["product_kind", "capacity_bucket", "manufacturer"]);
assert.ok(ssd.available_facets.product_kind.some(({ value }) => value === "M2_NVME"));
const psu = pcBrowseFlowForApiV1("PSU", {});
assert.ok(Array.isArray(psu.available_facets.watts_bucket));
assert.deepEqual(psu.steps.map(({ key }) => key), ["watts_bucket", "form_factor", "manufacturer"]);
const motherboard = pcBrowseFlowForApiV1("MOTHERBOARD", { socket: "AM5", chipset: "B650" });
assert.deepEqual(motherboard.steps.map(({ key }) => key), ["platform_vendor", "socket", "chipset", "manufacturer"]);
assert.ok(motherboard.product_count > 0, "AM5/B650 motherboard browse path resolves exact products");
const hdd = pcBrowseFlowForApiV1("HDD", { placement: "EXTERNAL" });
assert.deepEqual(hdd.steps.map(({ key }) => key), ["placement", "capacity_bucket", "manufacturer"]);
assert.ok(hdd.product_count > 0);

for (const [category, flow] of Object.entries(catalog)) {
  for (const step of flow.steps) {
    if (step.key === "model") continue;
    for (const option of flow.available_facets?.[step.key] || []) {
      assert.ok(option.value !== "", `${category}.${step.key} does not expose empty values`);
    }
  }
}

assert.ok(PC_PRODUCT_MASTER_V2.length > 0);
console.log(`pc-browse-flow-contract: ok (${Object.keys(catalog).length} categories)`);
