import { createCategoryHarness, type CategoryHarnessSite } from "./category-harness.js";
export { createCategoryHarness } from "./category-harness.js";

export type CanonicalCategoryId =
  | "all"
  | "fashion"
  | "fashion_women"
  | "fashion_men"
  | "fashion_women_outer"
  | "fashion_women_tops"
  | "fashion_women_bottoms"
  | "fashion_women_skirts"
  | "fashion_men_outer"
  | "fashion_men_tops"
  | "fashion_men_bottoms"
  | "fashion_men_jumpsuit"
  | "fashion_goods"
  | "luxury"
  | "beauty"
  | "kids"
  | "mobile"
  | "appliances"
  | "pc"
  | "camera"
  | "furniture"
  | "living"
  | "games"
  | "hobby"
  | "books"
  | "tickets"
  | "sports"
  | "travel"
  | "vehicles"
  | "motorcycle"
  | "tools"
  | "free_share";

export interface CategoryNode {
  id: CanonicalCategoryId;
  label: string;
  description: string;
  parentId?: CanonicalCategoryId | null;
}

export interface CategorySelection {
  id: CanonicalCategoryId;
  label: string;
  path: string[];
}

export interface SourceCategoryBinding {
  sourceCategoryId: string;
  sourceCategoryIds?: string[];
  sourceCategoryPath: string[];
  sourceCategoryPaths?: Record<string, string[]>;
  collectionMode?: "single" | "aggregate";
  confidence?: "exact" | "aggregate_exact" | "broader_source" | "unknown";
}

export type CategoryCollectionStrategy = "source_category" | "keyword";

export interface CategoryCollectionPlan {
  requestedCategoryId: CanonicalCategoryId;
  resolvedCategoryId: CanonicalCategoryId | null;
  strategy: CategoryCollectionStrategy;
  binding: SourceCategoryBinding | null;
}

const CATEGORY_NODES: CategoryNode[] = [
  { id: "all", label: "All", description: "Search all supported categories" },
  { id: "fashion", label: "Fashion", description: "Clothing and apparel" },
  { id: "fashion_women", label: "Women's Fashion", description: "Women's clothing", parentId: "fashion" },
  { id: "fashion_men", label: "Men's Fashion", description: "Men's clothing", parentId: "fashion" },
  { id: "fashion_women_outer", label: "Women's Outerwear", description: "Women's coats and jackets", parentId: "fashion_women" },
  { id: "fashion_women_tops", label: "Women's Tops", description: "Women's shirts and tops", parentId: "fashion_women" },
  { id: "fashion_women_bottoms", label: "Women's Bottoms", description: "Women's pants and jeans", parentId: "fashion_women" },
  { id: "fashion_women_skirts", label: "Women's Skirts", description: "Women's skirts", parentId: "fashion_women" },
  { id: "fashion_men_outer", label: "Men's Outerwear", description: "Men's coats and jackets", parentId: "fashion_men" },
  { id: "fashion_men_tops", label: "Men's Tops", description: "Men's shirts and tops", parentId: "fashion_men" },
  { id: "fashion_men_bottoms", label: "Men's Bottoms", description: "Men's pants and jeans", parentId: "fashion_men" },
  { id: "fashion_men_jumpsuit", label: "Men's Jumpsuits", description: "Men's jumpsuits", parentId: "fashion_men" },
  { id: "fashion_goods", label: "Fashion Accessories", description: "Bags, shoes, wallets, and accessories" },
  { id: "luxury", label: "Luxury", description: "Luxury fashion and accessories" },
  { id: "beauty", label: "Beauty", description: "Cosmetics and beauty products" },
  { id: "kids", label: "Kids & Baby", description: "Children's clothing and baby products" },
  { id: "mobile", label: "Phones & Tablets", description: "Phones, tablets, and wearables" },
  { id: "appliances", label: "Appliances", description: "Home and kitchen appliances" },
  { id: "pc", label: "Computers", description: "Laptops, desktops, and computer parts" },
  { id: "camera", label: "Cameras", description: "Cameras and photography equipment" },
  { id: "furniture", label: "Furniture", description: "Furniture and interior products" },
  { id: "living", label: "Home & Living", description: "Household and kitchen products" },
  { id: "games", label: "Games", description: "Consoles, games, and accessories" },
  { id: "hobby", label: "Hobbies & Pets", description: "Hobby and pet products" },
  { id: "books", label: "Books & Media", description: "Books, music, and stationery" },
  { id: "tickets", label: "Tickets", description: "Tickets, gift cards, and coupons" },
  { id: "sports", label: "Sports", description: "Sports equipment and activewear" },
  { id: "travel", label: "Travel & Outdoors", description: "Travel and outdoor products" },
  { id: "vehicles", label: "Vehicles", description: "Used vehicles" },
  { id: "motorcycle", label: "Motorcycles", description: "Motorcycles, parts, and accessories" },
  { id: "tools", label: "Tools", description: "Tools and industrial products" },
  { id: "free_share", label: "Free", description: "Free listings" }
];

export const CATEGORY_SITE_REGISTRY: readonly CategoryHarnessSite[] = [
  { siteKey: "mercari_jp", bindings: {} },
  { siteKey: "yahoo_auction_jp", bindings: {} },
  { siteKey: "rakuma", bindings: {} },
  { siteKey: "poshmark", bindings: {} },
  { siteKey: "vinted", bindings: {} },
  { siteKey: "unclaimed_baggage", bindings: {} },
  { siteKey: "ebay", bindings: {} }
];

export const CATEGORY_SITE_KEYS = CATEGORY_SITE_REGISTRY.map((site) => site.siteKey);
export const CATEGORY_HARNESS = createCategoryHarness(CATEGORY_NODES, CATEGORY_SITE_REGISTRY);

export function listCategoryNodes(): CategoryNode[] {
  return CATEGORY_NODES.map((category) => ({ ...category }));
}

export function resolveCategory(categoryId: string): CategorySelection | null {
  const category = CATEGORY_NODES.find((candidate) => candidate.id === categoryId);
  if (!category) return null;
  const path: string[] = [];
  let current: CategoryNode | undefined = category;
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current.label);
    current = current.parentId
      ? CATEGORY_NODES.find((candidate) => candidate.id === current?.parentId)
      : undefined;
  }
  return { id: category.id, label: category.label, path: category.id === "all" ? [] : path };
}

export function getSourceCategoryBinding(siteKey: string, categoryId: string): SourceCategoryBinding | null {
  return CATEGORY_HARNESS.getSourceCategoryBinding(siteKey, categoryId) as SourceCategoryBinding | null;
}

export function resolveCategoryCollectionPlan(siteKey: string, categoryId: string): CategoryCollectionPlan | null {
  return CATEGORY_HARNESS.resolveCategoryCollectionPlan(siteKey, categoryId) as CategoryCollectionPlan | null;
}

export function isCategorySelectableForSite(siteKey: string, categoryId: string): boolean {
  return CATEGORY_HARNESS.isCategorySelectableForSite(siteKey, categoryId);
}

export function categoryCatalogForApi() {
  return {
    categories: listCategoryNodes(),
    site_plans: CATEGORY_HARNESS.categoryPlansForApi(),
    source_bindings: CATEGORY_HARNESS.sourceBindingsForApi()
  };
}
