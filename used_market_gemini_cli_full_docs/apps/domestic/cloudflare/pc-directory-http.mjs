import {
  PC_PART_CATEGORY_SEEDS_V2,
  PC_PRODUCT_MASTER_V2,
  PC_PRODUCT_MASTER_V2_VERSION
} from "../market/data/pc-product-master-v2.mjs";
import { pcPartsDirectoryForApiV2 } from "../market/logic/pc-parts-directory.mjs";
import {
  PUBLIC_PC_CATEGORY_CODES,
  publicPcCatalogForApi,
  publicPcFacetsForApi,
  publicPcModelsForApi
} from "../market/logic/pc-public-catalog.mjs";
import { PC_SOURCE_REGISTRY } from "../collector/logic/pc-source-registry.mjs";
import { pcBrowseFlowForApiV1 } from "../market/data/browse-flows/index.mjs";

function values(params, name) {
  return params.getAll(name).flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean);
}

export function pcDirectoryOptions(urlOrRequest) {
  const url = urlOrRequest instanceof URL
    ? urlOrRequest
    : new URL(typeof urlOrRequest === "string" ? urlOrRequest : urlOrRequest.url);
  const reserved = new Set(["category_code", "category", "manufacturer", "brand", "group", "node_type", "query", "q", "sort", "limit", "cursor"]);
  const facets = {};
  for (const key of new Set(url.searchParams.keys())) {
    if (reserved.has(key)) continue;
    const facetValues = values(url.searchParams, key);
    if (facetValues.length > 0) facets[key] = facetValues;
  }
  const category = [...new Set([...values(url.searchParams, "category_code"), ...values(url.searchParams, "category")])].map((value) => value.toUpperCase());
  if (category.some((value) => !PUBLIC_PC_CATEGORY_CODES.includes(value))) {
    throw new RangeError(`Unknown public PC category: ${category.find((value) => !PUBLIC_PC_CATEGORY_CODES.includes(value))}`);
  }
  return {
    category,
    manufacturer: values(url.searchParams, "manufacturer"),
    brand: values(url.searchParams, "brand"),
    group: values(url.searchParams, "group"),
    node_type: values(url.searchParams, "node_type"),
    query: url.searchParams.get("query") || url.searchParams.get("q") || "",
    sort: url.searchParams.get("sort") || undefined,
    limit: url.searchParams.get("limit") || undefined,
    cursor: url.searchParams.get("cursor") || undefined,
    facets
  };
}

export function pcCatalogResponse() {
  const directory = pcPartsDirectoryForApiV2({ category: [...PUBLIC_PC_CATEGORY_CODES], limit: 1 });
  const publicCatalog = publicPcCatalogForApi();
  const operationalSources = PC_SOURCE_REGISTRY
    .filter((source) => source.directory_source === true && source.policy_status === "APPROVED"
      && source.runtime_status === "ENABLED")
    .sort((left, right) => Number(left.directory_order || 999) - Number(right.directory_order || 999));
  return {
    master_version: publicCatalog.master_version,
    categories: publicCatalog.categories.map((category) => ({
      ...category,
      registered_node_count: directory.categories.find((entry) => entry.code === category.code)?.registered_node_count || 0,
      registered_product_count: directory.categories.find((entry) => entry.code === category.code)?.registered_product_count || 0
    })),
    facet_schema: publicCatalog.facet_schema,
    browse_flow: publicCatalog.browse_flow,
    public_catalog: publicCatalog,
    sources: operationalSources
      .map((source) => ({
        source_id: source.key,
        display_name: source.name,
        market_pool: source.market_pool,
        market_pools: source.market_pools,
        public_enabled: true
      })),
    source_candidates: PC_SOURCE_REGISTRY
      .filter((source) => source.directory_source === true && !operationalSources.some((entry) => entry.key === source.key))
      .sort((left, right) => Number(left.directory_order || 999) - Number(right.directory_order || 999))
      .map((source) => ({
        source_id: source.key,
        display_name: source.name,
        market_pool: source.market_pool,
        policy_status: source.policy_status,
        runtime_status: source.runtime_status,
        public_enabled: false,
        availability_reason: source.partner_application_url
          ? "PARTNER_CONTRACT_REQUIRED"
          : source.policy_status === "DENIED"
            ? "WRITTEN_PERMISSION_REQUIRED"
            : source.policy_status === "REVIEW_REQUIRED"
              ? "POLICY_AND_CANARY_REVIEW_REQUIRED"
              : "OPERATOR_ENABLE_REQUIRED",
        policy_reference_url: source.policy_basis_url || null,
        activation_url: source.partner_application_url || null,
        integration_docs_url: source.partner_api_docs_url || null
      }))
  };
}

export function pcProductsResponse(urlOrRequest) {
  const options = pcDirectoryOptions(urlOrRequest);
  const publicFacetKeys = new Set(PUBLIC_PC_CATEGORY_CODES.flatMap((category) => publicPcCatalogForApi().facet_schema[category].map((facet) => facet.key)));
  const category = options.category[0] || "";
  if (category && Object.keys(options.facets).some((key) => publicFacetKeys.has(key))) {
    const publicOptions = { category, ...Object.fromEntries(Object.entries(options.facets).map(([key, values]) => [key, values[0]])) };
    const models = publicPcModelsForApi(publicOptions);
    const facets = publicPcFacetsForApi(publicOptions);
    return {
      master_version: publicPcCatalogForApi().master_version,
      products: models.models,
      total: models.models.length,
      query: options.query,
      available_facets: facets.available_facets
    };
  }
  const directory = pcPartsDirectoryForApiV2({ ...options, category: options.category.length ? options.category : [...PUBLIC_PC_CATEGORY_CODES] });
  const selection = Object.fromEntries(Object.entries(options.facets)
    .filter(([key]) => key !== "directory_node_type" && key !== "market_segment")
    .map(([key, values]) => [key, values[0]]));
  const browse = category ? pcBrowseFlowForApiV1(category, selection) : null;
  return {
    master_version: directory.master_version,
    products: directory.products,
    query: directory.query,
    ...(browse ? { available_facets: browse.available_facets } : {})
  };
}

export function pcCollectionTargetSetV2() {
  const categoryEndpointSources = ["danawa", "ebay"];
  const searchMarketplaceSources = ["joonggonara", "hellomarket", "bunjang", "rethinkmall", "coolenjoy"];
  const exactMasterSources = [...searchMarketplaceSources, "ebay"];
  const generalQueries = [
    ["GPU", "그래픽카드"],
    ["CPU", "CPU"],
    ["RAM", "DDR3 램"],
    ["RAM", "DDR4 램"],
    ["RAM", "DDR5 램"],
    ["MOTHERBOARD", "메인보드"],
    ["SSD", "SSD"],
    ["HDD", "HDD"],
    ["PSU", "컴퓨터 파워"],
    ["COOLING", "공랭 쿨러"],
    ["COOLING", "수랭 쿨러"],
    ["CASE", "컴퓨터 케이스"],
    ["EXPANSION_CARD", "랜카드"],
    ["EXPANSION_CARD", "사운드카드"],
    ["EXPANSION_CARD", "캡처보드"],
    ["EXPANSION_CARD", "HBA RAID"],
    ["EXPANSION_CARD", "M.2 확장카드"],
    ["ODD", "DVD ODD"],
    ["ODD", "블루레이 ODD"]
  ];
  const categoryTargets = PC_PART_CATEGORY_SEEDS_V2.map((category, index) => ({
    targetId: `pc-target:${PC_PRODUCT_MASTER_V2_VERSION}:category-v5:${category.code}`,
    canonicalProductId: null,
    categoryCode: category.code,
    queryText: category.label,
    sourceKeys: categoryEndpointSources,
    targetOrder: index,
    cadenceClass: "HOURLY_CATEGORY",
    minimumIntervalMinutes: 55,
    enabled: true
  }));
  const generalTargets = generalQueries.map(([categoryCode, queryText], index) => ({
    targetId: `pc-target:${PC_PRODUCT_MASTER_V2_VERSION}:market-v5:${categoryCode}:${index}`,
    canonicalProductId: null,
    categoryCode,
    queryText,
    sourceKeys: searchMarketplaceSources,
    targetOrder: categoryTargets.length + index,
    cadenceClass: "HOURLY_CATEGORY",
    minimumIntervalMinutes: 55,
    enabled: true
  }));

  const formatCapacity = (capacityGb) => capacityGb >= 1_000
    ? `${Number((capacityGb / 1_000).toFixed(2))}TB`
    : `${capacityGb}GB`;
  const subtypeQuery = Object.freeze({
    AIR_CPU: "CPU 공랭 쿨러", AIO: "수랭 쿨러", CASE_FAN: "케이스 팬",
    NETWORK: "랜카드", SOUND: "사운드카드", CAPTURE: "캡처보드",
    HBA_RAID: "HBA RAID", M2_CARRIER: "M.2 확장카드",
    DVD: "DVD ODD", "Blu-ray": "블루레이 ODD", BDXL: "BDXL ODD"
  });
  const exactQueries = (product) => {
    const spec = product.spec || {};
    if (product.category === "GPU") return [spec.gpu_model || product.aliases?.[0] || product.name];
    if (product.category === "CPU") return [spec.cpu_model || product.aliases?.at(-1) || product.name];
    if (product.category === "RAM") {
      return [`${product.manufacturer} ${spec.memory_generation} ${spec.module_capacity_gb}GB 램`];
    }
    if (["SSD", "HDD"].includes(product.category)) {
      return (spec.capacity_examples_gb || []).map((capacity) => (
        `${product.manufacturer} ${formatCapacity(capacity)} ${product.category}`
      ));
    }
    if (product.category === "MOTHERBOARD") return [`${product.manufacturer} 메인보드`];
    if (product.category === "PSU") return [`${product.manufacturer} ${spec.form_factor || ""} 파워서플라이`];
    if (product.category === "COOLING") return [`${product.manufacturer} ${subtypeQuery[spec.subtype] || "PC 쿨러"}`];
    if (product.category === "CASE") return [`${product.manufacturer} PC 케이스`];
    if (product.category === "EXPANSION_CARD") {
      return [`${product.manufacturer} ${subtypeQuery[spec.subtype] || "확장카드"}`];
    }
    if (product.category === "ODD") {
      return [`${product.manufacturer} ${subtypeQuery[spec.media_family] || "ODD"}`];
    }
    return [product.aliases?.[0] || product.name];
  };
  const exactTargets = [];
  let exactOrder = categoryTargets.length + generalTargets.length;
  for (const product of PC_PRODUCT_MASTER_V2) {
    const queries = [...new Set(exactQueries(product).map((value) => String(value || "").trim()).filter(Boolean))];
    for (let queryIndex = 0; queryIndex < queries.length; queryIndex += 1) {
      exactTargets.push({
        targetId: `pc-target:${PC_PRODUCT_MASTER_V2_VERSION}:master-v5:${product.id}:${queryIndex}`,
        canonicalProductId: product.id,
        categoryCode: product.category,
        queryText: queries[queryIndex],
        sourceKeys: exactMasterSources,
        targetOrder: exactOrder,
        cadenceClass: "DAILY_MASTER",
        minimumIntervalMinutes: 24 * 60,
        enabled: true
      });
      exactOrder += 1;
    }
  }
  return {
    targetSetVersion: `pc-targets:${PC_PRODUCT_MASTER_V2_VERSION}:full-master-v5`,
    directoryVersion: PC_PRODUCT_MASTER_V2_VERSION,
    targets: [...categoryTargets, ...generalTargets, ...exactTargets]
  };
}
