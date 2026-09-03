export type PcPartCategoryCodeV2 =
  | "GPU" | "CPU" | "RAM" | "MOTHERBOARD" | "SSD" | "HDD"
  | "PSU" | "COOLING" | "CASE" | "EXPANSION_CARD" | "ODD";

export type PcDirectoryNodeTypeV2 = "PRODUCT" | "BROWSE_BUCKET" | "BROWSE_FACET";
export type PcDirectorySortV2 = "CATEGORY_NAME_ID_ASC" | "NAME_ID_ASC" | "ID_ASC";
export type PcFacetScalarV2 = string | number | boolean;

export interface PcProductMasterRecordV2 {
  readonly id: string;
  readonly name: string;
  readonly category: PcPartCategoryCodeV2;
  readonly group: string;
  readonly manufacturer: string;
  readonly brand: string;
  readonly aliases: readonly string[];
  readonly forbidden: readonly string[];
  readonly spec: Readonly<Record<string, unknown>> & { readonly directory_node_type: PcDirectoryNodeTypeV2 };
  readonly browse_facets: Readonly<Record<string, unknown>> & { readonly directory_node_type: PcDirectoryNodeTypeV2 };
}

export interface PcPartManufacturerSeedV2 {
  value: string;
  registered_node_count: number;
}

export interface PcPartCategoryDirectoryV2 {
  code: PcPartCategoryCodeV2;
  label: string;
  order: number;
  registered_node_count: number;
  registered_product_count: number;
  manufacturers: PcPartManufacturerSeedV2[];
  brands: string[];
}

export interface PcPartsDirectoryQueryV2 {
  category?: PcPartCategoryCodeV2 | PcPartCategoryCodeV2[] | string | string[];
  manufacturer?: string | string[];
  brand?: string | string[];
  group?: string | string[];
  node_type?: PcDirectoryNodeTypeV2 | PcDirectoryNodeTypeV2[] | string | string[];
  query?: string;
  facets?: Record<string, PcFacetScalarV2 | PcFacetScalarV2[]>;
  sort?: PcDirectorySortV2 | string;
  limit?: number;
  cursor?: string | null;
}

export interface PcPartsDirectoryPageV2 {
  items: readonly PcProductMasterRecordV2[];
  total: number;
  limit: number;
  sort: PcDirectorySortV2;
  next_cursor: string | null;
}

export interface PcPartsDirectoryApiV2 {
  master_version: number;
  categories: PcPartCategoryDirectoryV2[];
  facet_schema: Readonly<Record<string, unknown>>;
  products: PcPartsDirectoryPageV2;
  query: Readonly<Record<string, unknown>>;
}

export function listPcPartCategoriesV2(): PcPartCategoryDirectoryV2[];
export function getPcPartFacetSchemaV2(category?: PcPartCategoryCodeV2 | string): Readonly<Record<string, unknown>>;
export function queryPcPartsDirectoryV2(options?: PcPartsDirectoryQueryV2): PcPartsDirectoryPageV2;
export function pcPartsDirectoryForApiV2(options?: PcPartsDirectoryQueryV2): PcPartsDirectoryApiV2;
