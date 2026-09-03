import assert from "node:assert/strict";
import {
  GPU_BROWSE_FACET_KEYS,
  GPU_BROWSE_FLOW,
  GPU_HIDDEN_BROWSE_FACETS,
  getGpuBrowseFacets,
  getGpuModelMetadata,
  isGpuFamilyCompatible
} from "../market/data/browse-flows/gpu.mjs";
import { PC_PRODUCT_MASTER_V2 } from "../market/data/pc-product-master-v2.mjs";

const gpuProducts = PC_PRODUCT_MASTER_V2.filter((product) => product.category === "GPU");
const productCount = (chip, family) => gpuProducts.filter((product) => (
  product.browse_facets.chip_manufacturer === chip &&
  product.browse_facets.family === family
)).length;

assert.deepEqual([...GPU_BROWSE_FACET_KEYS], ["chip_manufacturer", "family"]);
assert.deepEqual([...GPU_HIDDEN_BROWSE_FACETS], ["market_segment", "board_manufacturer", "vram_gb"]);
assert.deepEqual(GPU_BROWSE_FLOW.steps.map((step) => step.key), ["chip_manufacturer", "family"]);
assert.deepEqual(GPU_BROWSE_FLOW.steps[1].depends_on, ["chip_manufacturer"]);
assert.deepEqual(GPU_BROWSE_FLOW.default_facets, { market_segment: "DESKTOP" });

const initial = getGpuBrowseFacets();
assert.deepEqual(initial.available_facets.family, [], "GPU families wait for chip manufacturer selection");
assert.deepEqual(initial.available_facets.chip_manufacturer.map(({ value }) => value), ["AMD", "Intel", "NVIDIA"]);
assert.equal(initial.hidden_facets.includes("vram_gb"), true);
assert.equal(initial.hidden_facets.includes("board_manufacturer"), true);
assert.equal(initial.hidden_facets.includes("market_segment"), true);

const nvidia = getGpuBrowseFacets(PC_PRODUCT_MASTER_V2, { chip_manufacturer: "NVIDIA" });
assert.deepEqual(nvidia.available_facets.family.map(({ value }) => value), ["GeForce GTX", "GeForce RTX"]);
assert.equal(nvidia.available_facets.family.some(({ value }) => value === "Radeon RX"), false);
assert.equal(nvidia.selection.chip_manufacturer, "NVIDIA");
assert.equal(getGpuBrowseFacets(PC_PRODUCT_MASTER_V2, { chip_manufacturer: "NVIDIA", family: "GeForce RTX" }).selection.family, "GeForce RTX");
const rtx3060 = gpuProducts.find((product) => product.spec.gpu_model === "RTX 3060");
assert.ok(rtx3060);
assert.deepEqual(getGpuModelMetadata(rtx3060).vram_options_gb, [8, 12]);
assert.equal(getGpuModelMetadata(rtx3060).market_segment, "DESKTOP");
assert.equal(Object.hasOwn(getGpuModelMetadata(rtx3060), "board_manufacturer"), false);

console.log(`pc-gpu-browse-flow-contract: ok (${gpuProducts.length} GPU models)`);
