import assert from "node:assert/strict";
import {
  RAM_BROWSE_FLOW_V1,
  RAM_BROWSE_GENERATIONS_V1,
  ramBrowseFacetsForMaster,
  ramModelMetadata
} from "../market/data/browse-flows/ram.mjs";
import { PC_PRODUCT_MASTER_V2 } from "../market/data/pc-product-master-v2.mjs";

const ramProducts = PC_PRODUCT_MASTER_V2.filter((product) => product.category === "RAM");
const masterGenerations = [...new Set(ramProducts.map((product) => product.spec.memory_generation))].sort();
const masterCapacities = [...new Set(ramProducts.map((product) => product.spec.module_capacity_gb))].sort((left, right) => left - right);

assert.deepEqual(
  RAM_BROWSE_FLOW_V1.steps.map(({ key }) => key),
  ["memory_generation", "module_capacity_gb", "model"],
  "RAM browse path must be DDR generation -> module capacity -> model"
);
assert.equal(RAM_BROWSE_FLOW_V1.steps[0].label, "DDR 세대");
assert.equal(RAM_BROWSE_FLOW_V1.steps[1].label, "모듈 용량");
assert.deepEqual(RAM_BROWSE_FLOW_V1.steps[1].depends_on, ["memory_generation"]);
assert.deepEqual(
  RAM_BROWSE_FLOW_V1.model_metadata.map(({ key }) => key),
  ["module_count", "total_capacity_gb", "form_factor"],
  "RAM quantity and DIMM/SODIMM fields must remain model metadata"
);

const initial = ramBrowseFacetsForMaster();
assert.deepEqual(initial.available_facets.memory_generation.map(({ value }) => value), RAM_BROWSE_GENERATIONS_V1.filter((value) => masterGenerations.includes(value)));
assert.deepEqual(initial.available_facets.module_capacity_gb.map(({ value }) => value), masterCapacities);
assert.equal(initial.available_facets.memory_generation.some(({ value }) => value === "DDR6"), false);
assert.equal(initial.available_facets.module_capacity_gb.some(({ value }) => value === 256), false);
assert.equal(initial.model_count, ramProducts.length);

for (const generation of masterGenerations) {
  const scoped = ramProducts.filter((product) => product.spec.memory_generation === generation);
  const result = ramBrowseFacetsForMaster(PC_PRODUCT_MASTER_V2, { memory_generation: generation });
  assert.deepEqual(
    result.available_facets.module_capacity_gb.map(({ value }) => value),
    [...new Set(scoped.map((product) => product.spec.module_capacity_gb))].sort((left, right) => left - right),
    `${generation} must expose only registered module capacities`
  );
  assert.equal(result.model_count, scoped.length);
  for (const option of result.available_facets.module_capacity_gb) {
    assert.equal(option.count, scoped.filter((product) => product.spec.module_capacity_gb === option.value).length);
  }
}

const sixteen = ramBrowseFacetsForMaster(PC_PRODUCT_MASTER_V2, { module_capacity_gb: "16" });
assert.deepEqual(sixteen.available_facets.module_capacity_gb.map(({ value }) => value), masterCapacities);
assert.deepEqual(sixteen.available_facets.memory_generation.map(({ value }) => value), masterGenerations);
assert.equal(sixteen.model_count, ramProducts.filter((product) => product.spec.module_capacity_gb === 16).length);

const combined = ramBrowseFacetsForMaster(PC_PRODUCT_MASTER_V2, { memory_generation: "DDR5", module_capacity_gb: 16 });
assert.equal(combined.model_count, ramProducts.filter((product) => product.spec.memory_generation === "DDR5" && product.spec.module_capacity_gb === 16).length);
assert.equal(combined.model_ids.every((id) => id.includes(":ddr5:16gb")), true);
const impossible = ramBrowseFacetsForMaster(PC_PRODUCT_MASTER_V2, { memory_generation: "DDR3", module_capacity_gb: 999 });
assert.equal(impossible.model_count, 0, "unknown capacity must never match a RAM model");
assert.deepEqual(impossible.available_facets.module_capacity_gb.map(({ value }) => value), masterCapacities, "unknown capacity must not be exposed as a new option");

const masterModel = ramProducts.find((product) => product.spec.memory_generation === "DDR4" && product.spec.module_capacity_gb === 16);
assert.deepEqual(ramModelMetadata(masterModel), {
  module_capacity_gb: 16,
  module_count: 1,
  total_capacity_gb: 16,
  form_factor: null
});
assert.deepEqual(ramModelMetadata({
  category: "RAM",
  spec: { module_capacity_gb: 16, module_count: 2, total_capacity_gb: 32, form_factor: "DIMM" },
  browse_facets: {}
}), {
  module_capacity_gb: 16,
  module_count: 2,
  total_capacity_gb: 32,
  form_factor: "DIMM"
});
assert.equal(ramModelMetadata({ category: "GPU", spec: {}, browse_facets: {} }), null);

const subset = ramProducts.filter((product) => product.spec.memory_generation === "DDR4" && product.spec.module_capacity_gb === 8).slice(0, 1);
const subsetFacets = ramBrowseFacetsForMaster(subset);
assert.deepEqual(subsetFacets.available_facets.memory_generation.map(({ value }) => value), ["DDR4"]);
assert.deepEqual(subsetFacets.available_facets.module_capacity_gb.map(({ value }) => value), [8]);

console.log(`ram-browse-flow-contract: ok (${ramProducts.length} master products)`);
