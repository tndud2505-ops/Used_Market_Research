import assert from "node:assert/strict";
import {
  PSU_BROWSE_FLOW_V1,
  PSU_MODEL_METADATA_FIELDS_V1,
  PSU_WATTS_BUCKET_LABELS_V1,
  PSU_WATTS_BUCKET_ORDER_V1,
  psuBrowseFacetsForMaster,
  psuBrowseFlowForApiV1,
  psuBrowseProductsV1,
  psuModelMetadata,
  psuWattsBucketV1
} from "../market/data/browse-flows/psu.mjs";
import { PC_PRODUCT_MASTER_V2 } from "../market/data/pc-product-master-v2.mjs";

const product = ({ id, name, manufacturer, watts, watts_bucket, atx_spec, form_factor, efficiency, modularity }) => ({
  id,
  name,
  category: "PSU",
  group: `psu:${id}`,
  manufacturer,
  brand: "Power Supply",
  aliases: [name],
  forbidden: [],
  spec: {
    directory_node_type: "PRODUCT",
    watts,
    ...(atx_spec ? { atx_spec } : {}),
    ...(form_factor ? { form_factor } : {}),
    ...(efficiency ? { efficiency } : {}),
    ...(modularity ? { modularity } : {})
  },
  browse_facets: {
    directory_node_type: "PRODUCT",
    ...(watts_bucket ? { watts_bucket } : {})
  }
});

const fixtureMaster = [
  product({ id: "psu:seasonic:focus-500", name: "Seasonic Focus 500W", manufacturer: "Seasonic", watts: 500, atx_spec: "ATX 2.x", form_factor: "ATX", efficiency: "80 PLUS Gold", modularity: "FULL_MODULAR" }),
  product({ id: "psu:corsair:rm650x", name: "Corsair RM650x", manufacturer: "Corsair", watts_bucket: "550_650", atx_spec: "ATX 2.x", form_factor: "ATX", efficiency: "80 PLUS Gold", modularity: "FULL_MODULAR" }),
  product({ id: "psu:seasonic:vertex-gx850", name: "Seasonic VERTEX GX-850", manufacturer: "Seasonic", watts: 850, atx_spec: "ATX 3.0", form_factor: "ATX", efficiency: "80 PLUS Gold", modularity: "FULL_MODULAR" }),
  product({ id: "psu:asus:rog-850", name: "ASUS ROG 850W", manufacturer: "ASUS", watts: 850, atx_spec: "ATX 3.0", form_factor: "ATX", efficiency: "80 PLUS Platinum", modularity: "FULL_MODULAR" }),
  product({ id: "psu:micronics:1200", name: "Micronics 1200W", manufacturer: "Micronics", watts: 1200, atx_spec: "ATX 3.0", form_factor: "ATX", efficiency: "80 PLUS Platinum", modularity: "SEMI_MODULAR" }),
  product({ id: "psu:fsp:1600", name: "FSP 1600W", manufacturer: "FSP", watts: 1600, atx_spec: "ATX 3.1", form_factor: "ATX", efficiency: "80 PLUS Titanium", modularity: "FULL_MODULAR" }),
  // Browse facet nodes and unrelated categories must not become models.
  { category: "PSU", spec: { directory_node_type: "BROWSE_FACET", form_factor: "ATX" }, browse_facets: { directory_node_type: "BROWSE_FACET" } },
  { category: "GPU", spec: { directory_node_type: "PRODUCT" }, browse_facets: { directory_node_type: "PRODUCT" } }
];

assert.deepEqual(PSU_BROWSE_FLOW_V1.steps.map(({ key }) => key), ["watts_bucket", "model"]);
assert.deepEqual(PSU_BROWSE_FLOW_V1.steps.map(({ label }) => label), ["정격 출력", "모델"]);
assert.deepEqual(PSU_BROWSE_FLOW_V1.steps[1].depends_on, ["watts_bucket"]);
assert.deepEqual(PSU_MODEL_METADATA_FIELDS_V1, ["manufacturer", "atx_spec", "form_factor", "efficiency", "modularity"]);
assert.equal(PSU_BROWSE_FLOW_V1.steps.some(({ key }) => ["atx_spec", "form_factor", "efficiency", "manufacturer"].includes(key)), false);

assert.equal(psuWattsBucketV1(500), "LE_500");
assert.equal(psuWattsBucketV1("550W"), "550_650");
assert.equal(psuWattsBucketV1("ATX 3.0 850W"), "800_850");
assert.equal(psuWattsBucketV1("1200W"), "1100_1200");
assert.equal(psuWattsBucketV1("1600W"), "GT_1200");
assert.equal(psuWattsBucketV1("not a wattage"), null);

const models = psuBrowseProductsV1(fixtureMaster);
assert.equal(models.length, 6);
assert.ok(models.every(({ category, spec }) => category === "PSU" && spec.directory_node_type === "PRODUCT"));

const initial = psuBrowseFacetsForMaster(fixtureMaster);
assert.deepEqual(initial.available_facets.watts_bucket.map(({ value }) => value), ["LE_500", "550_650", "800_850", "1100_1200", "GT_1200"]);
assert.deepEqual(initial.available_facets.watts_bucket.map(({ label }) => label), ["500W 이하", "550~650W", "800~850W", "1100~1200W", "1200W 초과"]);
assert.equal(initial.model_count, 6);
assert.equal(initial.available_facets.watts_bucket.some(({ value }) => value === "700_750"), false);
assert.equal(initial.available_facets.watts_bucket.some(({ value }) => value === "900_1000"), false);

const eightHundred = psuBrowseFacetsForMaster(fixtureMaster, { watts_bucket: "800_850" });
assert.equal(eightHundred.model_count, 2);
assert.deepEqual(eightHundred.model_ids, ["psu:asus:rog-850", "psu:seasonic:vertex-gx850"]);
assert.deepEqual(eightHundred.available_facets.watts_bucket.map(({ value }) => value), initial.available_facets.watts_bucket.map(({ value }) => value));

const unknown = psuBrowseFacetsForMaster(fixtureMaster, { watts_bucket: "700_750" });
assert.equal(unknown.model_count, 0);
assert.equal(unknown.available_facets.watts_bucket.some(({ value }) => value === "700_750"), false);

assert.deepEqual(psuModelMetadata(fixtureMaster[2]), {
  canonical_product_id: "psu:seasonic:vertex-gx850",
  canonical_display_name: "Seasonic VERTEX GX-850",
  manufacturer: "Seasonic",
  watts: 850,
  watts_bucket: "800_850",
  atx_spec: "ATX 3.0",
  form_factor: "ATX",
  efficiency: "80 PLUS Gold",
  modularity: "FULL_MODULAR"
});
assert.equal(psuModelMetadata({ category: "GPU" }), null);

const api = psuBrowseFlowForApiV1(fixtureMaster, { watts_bucket: "800_850" });
assert.equal(api.category_code, "PSU");
assert.equal(api.version, 1);
assert.equal(api.product_count, 2);
assert.deepEqual(api.defaults, {});
assert.deepEqual(api.available_facets.watts_bucket.map(({ value }) => value), initial.available_facets.watts_bucket.map(({ value }) => value));

// The real V2 master is the source of truth: the flow may expose zero or more
// current PSU models, but it must never add a bucket absent from those rows.
const realProducts = PC_PRODUCT_MASTER_V2.filter(({ category }) => category === "PSU");
const real = psuBrowseFacetsForMaster(PC_PRODUCT_MASTER_V2);
const realBuckets = new Set(psuBrowseProductsV1(PC_PRODUCT_MASTER_V2).map((entry) => entry.browse_facets?.watts_bucket || entry.spec?.watts_bucket));
assert.ok(real.available_facets.watts_bucket.every(({ value }) => PSU_WATTS_BUCKET_ORDER_V1.includes(value)));
assert.ok(real.available_facets.watts_bucket.every(({ value }) => realBuckets.has(value) || psuWattsBucketV1(value)));
assert.equal(realProducts.length >= real.model_count, true);
assert.ok(Object.keys(PSU_WATTS_BUCKET_LABELS_V1).length === PSU_WATTS_BUCKET_ORDER_V1.length);

console.log(`psu-browse-flow-contract: ok (${models.length} fixture PSU products, ${real.model_count} V2 master products)`);

