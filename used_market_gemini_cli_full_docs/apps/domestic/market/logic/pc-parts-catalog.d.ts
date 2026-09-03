export interface PcPartManufacturerFacet {
  value: string;
  label: string;
  registered_product_count: number;
}

export interface PcPartCategoryFacet {
  code: string;
  label: string;
  registered_product_count: number;
  manufacturers: PcPartManufacturerFacet[];
}

export interface PcPartsCatalog {
  master_version: number;
  categories: PcPartCategoryFacet[];
  products: Array<Record<string, unknown>>;
  sources: Array<Record<string, unknown>>;
}

export function pcPartsCatalogForApi(): PcPartsCatalog;
