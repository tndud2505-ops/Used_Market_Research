import assert from "node:assert/strict";
import {
  SSD_BROWSE_BUCKETS_V1,
  SSD_BROWSE_FLOW_V1,
  SSD_MODEL_METADATA_FIELDS_V1,
  ssdBrowseFacetsForMaster,
  ssdBrowseFlowForApiV1,
  ssdBrowseProductsV1,
  ssdModelMetadata
} from "../market/data/browse-flows/ssd.mjs";
import { PC_PRODUCT_MASTER_V2 } from "../market/data/pc-product-master-v2.mjs";

const allSsdNodes = PC_PRODUCT_MASTER_V2.filter((product) => product.category === "SSD");
const browseProducts = ssdBrowseProductsV1();
const masterBuckets = [...new Set(browseProducts.map((product) => product.browse_facets.capacity_bucket))];

assert.deepEqual(
  SSD_BROWSE_FLOW_V1.steps.map(({ key }) => key),
  ["capacity_bucket", "model"],
  "SSD browse path must be capacity bucket -> model"
);
assert.equal(SSD_BROWSE_FLOW_V1.steps[0].label, "용량");
assert.deepEqual(SSD_BROWSE_FLOW_V1.steps[1].depends_on, ["capacity_bucket"]);
assert.deepEqual(
  SSD_MODEL_METADATA_FIELDS_V1,
  ["interface", "protocol", "form_factor", "manufacturer"],
  "SSD interface/protocol/form factor/manufacturer stay model metadata"
);
assert.ok(browseProducts.length > 0);
assert.ok(allSsdNodes.every((product) => ["PRODUCT", "BROWSE_BUCKET"].includes(product.spec.directory_node_type)));
assert.ok(
  allSsdNodes.some((product) => product.spec.directory_node_type === "PRODUCT")
    ? browseProducts.every((product) => product.spec.directory_node_type === "PRODUCT")
    : browseProducts.every((product) => product.spec.directory_node_type === "BROWSE_BUCKET"),
  "exact SSD models take precedence over legacy capacity-bucket nodes"
);
assert.deepEqual(
  SSD_BROWSE_BUCKETS_V1.filter((value) => masterBuckets.includes(value)),
  masterBuckets,
  "SSD browse buckets must be drawn from the product master"
);

const initial = ssdBrowseFacetsForMaster();
assert.deepEqual(initial.available_facets.capacity_bucket.map(({ value }) => value), masterBuckets);
assert.ok(initial.available_facets.capacity_bucket.every(({ label, count }) => label && count > 0));
assert.equal(initial.model_count, browseProducts.length);
assert.equal(initial.model_ids.length, browseProducts.length);

for (const bucket of masterBuckets) {
  const scoped = browseProducts.filter((product) => product.browse_facets.capacity_bucket === bucket);
  const result = ssdBrowseFacetsForMaster(PC_PRODUCT_MASTER_V2, { capacity_bucket: bucket.toLowerCase() });
  assert.equal(result.selected.capacity_bucket, bucket);
  assert.equal(result.model_count, scoped.length);
  assert.deepEqual(result.model_ids, scoped.map(({ id }) => id).sort());
}

const impossible = ssdBrowseFacetsForMaster(PC_PRODUCT_MASTER_V2, { capacity_bucket: "999TB" });
assert.equal(impossible.model_count, 0, "an unregistered SSD capacity must match no model");
assert.deepEqual(
  impossible.available_facets.capacity_bucket.map(({ value }) => value),
  masterBuckets,
  "an unregistered capacity must never be emitted as a facet option"
);

const empty = ssdBrowseFacetsForMaster([], { capacity_bucket: "LE_256_GB" });
assert.deepEqual(empty.available_facets.capacity_bucket, []);
assert.equal(empty.model_count, 0);

const sku = {
  id: "ssd:samsung:980-pro-1tb",
  name: "Samsung 980 PRO 1TB",
  category: "SSD",
  manufacturer: "Samsung",
  spec: {
    directory_node_type: "PRODUCT",
    capacity_bucket: "960_GB_1_TB",
    interface: "PCIe",
    protocol: "NVMe",
    form_factor: "M.2 2280"
  },
  browse_facets: {
    directory_node_type: "PRODUCT",
    capacity_bucket: "960_GB_1_TB"
  }
};
assert.deepEqual(ssdBrowseProductsV1([sku]), [sku]);
assert.deepEqual(ssdBrowseFacetsForMaster([sku]), {
  version: 1,
  category_code: "SSD",
  browse_flow: SSD_BROWSE_FLOW_V1,
  selected: { capacity_bucket: null },
  available_facets: {
    capacity_bucket: [{ value: "960_GB_1_TB", label: "960GB~1TB", count: 1 }]
  },
  model_count: 1,
  model_ids: [sku.id]
});
assert.deepEqual(ssdModelMetadata(sku), {
  canonical_product_id: sku.id,
  canonical_display_name: sku.name,
  interface: "PCIe",
  protocol: "NVMe",
  form_factor: "M.2 2280",
  manufacturer: "Samsung"
});
assert.equal(ssdModelMetadata({ category: "GPU" }), null);

const api = ssdBrowseFlowForApiV1(PC_PRODUCT_MASTER_V2, { capacity_bucket: "480_512_GB" });
assert.equal(api.category_code, "SSD");
assert.equal(api.version, 1);
assert.deepEqual(api.model_metadata, SSD_MODEL_METADATA_FIELDS_V1);
assert.equal(api.product_count, browseProducts.filter((product) => product.browse_facets.capacity_bucket === "480_512_GB").length);

console.log(`ssd-browse-flow-contract: ok (${browseProducts.length} master SSD directory nodes)`);
