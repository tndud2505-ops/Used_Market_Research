import assert from "node:assert/strict";
import {
  CPU_BROWSE_DEFAULT_FILTERS_V1,
  CPU_BROWSE_FLOW_VERSION,
  CPU_BROWSE_FLOW_V1,
  CPU_MODEL_METADATA_FIELDS_V1,
  CPU_VENDOR_FAMILIES_V1,
  cpuBrowseFacetValuesV1,
  cpuBrowseFlowForApiV1,
  cpuBrowseProductsV1
} from "../market/data/browse-flows/cpu.mjs";
import { PC_PRODUCT_MASTER_V2 } from "../market/data/pc-product-master-v2.mjs";

assert.equal(CPU_BROWSE_FLOW_VERSION, 1);
assert.deepEqual(CPU_BROWSE_FLOW_V1.map(({ key }) => key), ["platform_vendor", "family"]);
assert.deepEqual(CPU_BROWSE_FLOW_V1.map(({ label }) => label), ["제조사", "제품군"]);
assert.deepEqual(CPU_BROWSE_FLOW_V1[1].depends_on, ["platform_vendor"]);
assert.deepEqual(CPU_BROWSE_DEFAULT_FILTERS_V1, { market_segment: "DESKTOP" });
assert.deepEqual(CPU_MODEL_METADATA_FIELDS_V1, ["cpu_model", "generation", "suffix", "socket"]);

const desktopCpus = cpuBrowseProductsV1();
assert.ok(desktopCpus.length > 0);
assert.equal(desktopCpus.length, PC_PRODUCT_MASTER_V2.filter((product) => product.category === "CPU").length);
assert.ok(desktopCpus.every((product) => product.browse_facets.market_segment === "DESKTOP"));
assert.ok(desktopCpus.every((product) => CPU_MODEL_METADATA_FIELDS_V1.every((field) => product.spec[field] !== undefined)));

const topLevel = cpuBrowseFacetValuesV1();
assert.deepEqual(topLevel.platform_vendor.map(({ value }) => value), ["AMD", "Intel"]);
assert.deepEqual(topLevel.family.map(({ value }) => value), ["Core", "Core Ultra", "Ryzen"]);

const intel = cpuBrowseFacetValuesV1(PC_PRODUCT_MASTER_V2, { platform_vendor: "Intel" });
assert.deepEqual(intel.family.map(({ value }) => value), ["Core", "Core Ultra"]);
assert.ok(intel.family.every(({ count }) => count > 0));
assert.deepEqual(CPU_VENDOR_FAMILIES_V1.Intel, ["Core", "Core Ultra"]);

const amd = cpuBrowseFacetValuesV1(PC_PRODUCT_MASTER_V2, { platform_vendor: "AMD" });
assert.deepEqual(amd.family.map(({ value }) => value), ["Ryzen"]);
assert.ok(amd.family.every(({ count }) => count > 0));
assert.deepEqual(CPU_VENDOR_FAMILIES_V1.AMD, ["Ryzen"]);

const intelCore = cpuBrowseFacetValuesV1(PC_PRODUCT_MASTER_V2, { platform_vendor: "Intel", family: "Core" });
assert.deepEqual(intelCore.platform_vendor.map(({ value }) => value), ["AMD", "Intel"],
  "a facet's own selection is not used to hide that facet's other values");
assert.deepEqual(intelCore.family.map(({ value }) => value), ["Core", "Core Ultra"]);
assert.ok(intelCore.family.find(({ value }) => value === "Core")?.count > 0);

const impossible = cpuBrowseFacetValuesV1(PC_PRODUCT_MASTER_V2, { platform_vendor: "Intel", family: "Ryzen" });
assert.deepEqual(impossible.family.map(({ value }) => value), ["Core", "Core Ultra"]);
assert.ok(impossible.family.every(({ count }) => count > 0), "available family values come from the selected vendor");

const api = cpuBrowseFlowForApiV1();
assert.equal(api.category_code, "CPU");
assert.equal(api.version, 1);
assert.equal(api.product_count, desktopCpus.length);
assert.deepEqual(api.defaults, { market_segment: "DESKTOP" });
assert.deepEqual(api.available_facets.platform_vendor.map(({ value }) => value), ["AMD", "Intel"]);
assert.ok(Object.hasOwn(api, "model_metadata"));

const i7K = desktopCpus.find((product) => product.id === "cpu:intel:i7-14700k");
const i7Kf = desktopCpus.find((product) => product.id === "cpu:intel:i7-14700kf");
assert.ok(i7K && i7Kf);
assert.equal(i7K.spec.suffix, "K");
assert.equal(i7Kf.spec.suffix, "KF");
assert.notEqual(i7K.id, i7Kf.id);
assert.equal(CPU_BROWSE_FLOW_V1.some(({ key }) => key === "generation" || key === "suffix"), false);

console.log(`cpu-browse-flow-contract: ok (${desktopCpus.length} desktop CPU products)`);
