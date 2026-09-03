import { PC_SOURCE_REGISTRY } from "../../collector/logic/pc-source-registry.mjs";
import { publicPcCatalogForApi } from "./pc-public-catalog.mjs";

export function pcPartsCatalogForApi() {
  const publicCatalog = publicPcCatalogForApi();
  const sources = PC_SOURCE_REGISTRY
    .filter((source) => source.public_search)
    .map((source) => ({
      source_id: source.key,
      label: source.name,
      market_pool: source.market_pool,
      policy_status: source.policy_status,
      runtime_status: source.runtime_status,
      enabled: source.policy_status === "APPROVED" && source.runtime_status === "ENABLED"
    }));
  return {
    master_version: publicCatalog.master_version,
    categories: publicCatalog.categories,
    products: publicCatalog.products,
    facet_schema: publicCatalog.facet_schema,
    browse_flow: publicCatalog.browse_flow,
    brand_label_by_category: publicCatalog.brand_label_by_category,
    sources
  };
}
