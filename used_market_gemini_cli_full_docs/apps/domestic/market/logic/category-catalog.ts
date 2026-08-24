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
  { id: "all", label: "전체", description: "카테고리를 선택해 통합 검색" },
  { id: "fashion", label: "패션의류", description: "여성의류, 남성의류, 아우터, 상의, 하의" },
  { id: "fashion_women", label: "여성의류", description: "여성의류 전체", parentId: "fashion" },
  { id: "fashion_men", label: "남성의류", description: "남성의류 전체", parentId: "fashion" },
  { id: "fashion_women_outer", label: "여성 아우터", description: "여성의류 아우터", parentId: "fashion_women" },
  { id: "fashion_women_tops", label: "여성 상의", description: "여성의류 상의", parentId: "fashion_women" },
  { id: "fashion_women_bottoms", label: "여성 바지", description: "여성의류 바지", parentId: "fashion_women" },
  { id: "fashion_women_skirts", label: "여성 치마", description: "여성의류 치마", parentId: "fashion_women" },
  { id: "fashion_men_outer", label: "남성 아우터", description: "남성의류 아우터", parentId: "fashion_men" },
  { id: "fashion_men_tops", label: "남성 상의", description: "남성의류 상의", parentId: "fashion_men" },
  { id: "fashion_men_bottoms", label: "남성 바지", description: "남성의류 바지", parentId: "fashion_men" },
  { id: "fashion_men_jumpsuit", label: "남성 점프수트", description: "남성의류 점프수트", parentId: "fashion_men" },
  { id: "fashion_goods", label: "패션잡화", description: "가방, 신발, 지갑, 액세서리" },
  { id: "luxury", label: "수입명품", description: "명품 의류와 잡화" },
  { id: "beauty", label: "뷰티", description: "화장품과 미용용품" },
  { id: "kids", label: "출산/유아동", description: "유아동 의류와 육아용품" },
  { id: "mobile", label: "모바일/태블릿", description: "스마트폰, 태블릿, 웨어러블" },
  { id: "appliances", label: "가전제품", description: "생활·주방·디지털 가전" },
  { id: "pc", label: "노트북/PC", description: "노트북, 데스크톱, PC 부품" },
  { id: "camera", label: "카메라/캠코더", description: "카메라와 촬영 장비" },
  { id: "furniture", label: "가구/인테리어", description: "가구와 인테리어 소품" },
  { id: "living", label: "리빙/생활", description: "생활용품과 주방용품" },
  { id: "games", label: "게임", description: "게임기, 게임 타이틀, 주변기기" },
  { id: "hobby", label: "반려동물/취미", description: "취미용품과 반려동물 용품" },
  { id: "books", label: "도서/음반/문구", description: "책, 음반, 문구류" },
  { id: "tickets", label: "티켓/쿠폰", description: "티켓, 상품권, 쿠폰" },
  { id: "sports", label: "스포츠", description: "스포츠용품과 운동복" },
  { id: "travel", label: "레저/여행", description: "여행·레저 상품" },
  { id: "vehicles", label: "중고차", description: "중고 자동차" },
  { id: "motorcycle", label: "오토바이", description: "오토바이와 관련 용품" },
  { id: "tools", label: "공구/산업용품", description: "공구와 산업용품" },
  { id: "free_share", label: "무료나눔", description: "무료로 나누는 상품" }
];

// 소스별 ID는 우리 카테고리 ID와 분리한다. 새 사이트는 이 표만 추가하면 된다.
const SOURCE_CATEGORY_BINDINGS: Record<string, Partial<Record<CanonicalCategoryId, SourceCategoryBinding>>> = {
  joonggonara: {
    luxury: { sourceCategoryId: "1", sourceCategoryPath: ["수입명품"] },
    fashion: { sourceCategoryId: "2", sourceCategoryPath: ["패션의류"] },
    fashion_women: { sourceCategoryId: "111", sourceCategoryPath: ["패션의류", "여성의류"] },
    fashion_men: { sourceCategoryId: "112", sourceCategoryPath: ["패션의류", "남성의류"] },
    fashion_women_outer: {
      sourceCategoryId: "1021",
      sourceCategoryIds: ["1021", "1022"],
      sourceCategoryPath: ["패션의류", "여성의류", "아우터"],
      sourceCategoryPaths: {
        "1021": ["패션의류", "여성의류", "자켓/코트"],
        "1022": ["패션의류", "여성의류", "패딩/야상/점퍼"]
      },
      collectionMode: "aggregate",
      confidence: "aggregate_exact"
    },
    fashion_women_tops: {
      sourceCategoryId: "1023",
      sourceCategoryIds: ["1023", "1024", "1025"],
      sourceCategoryPath: ["패션의류", "여성의류", "상의"],
      sourceCategoryPaths: {
        "1023": ["패션의류", "여성의류", "티셔츠/민소매/탑"],
        "1024": ["패션의류", "여성의류", "니트/스웨터/가디건"],
        "1025": ["패션의류", "여성의류", "블라우스/남방"]
      },
      collectionMode: "aggregate",
      confidence: "aggregate_exact"
    },
    fashion_women_bottoms: { sourceCategoryId: "1026", sourceCategoryPath: ["패션의류", "여성의류", "바지/데님"] },
    fashion_women_skirts: { sourceCategoryId: "1027", sourceCategoryPath: ["패션의류", "여성의류", "스커트"] },
    fashion_men_outer: {
      sourceCategoryId: "1030",
      sourceCategoryIds: ["1030", "1031"],
      sourceCategoryPath: ["패션의류", "남성의류", "아우터"],
      sourceCategoryPaths: {
        "1030": ["패션의류", "남성의류", "자켓/코트"],
        "1031": ["패션의류", "남성의류", "패딩/야상/점퍼"]
      },
      collectionMode: "aggregate",
      confidence: "aggregate_exact"
    },
    fashion_men_tops: {
      sourceCategoryId: "1032",
      sourceCategoryIds: ["1032", "1033", "1034"],
      sourceCategoryPath: ["패션의류", "남성의류", "상의"],
      sourceCategoryPaths: {
        "1032": ["패션의류", "남성의류", "티셔츠/민소매"],
        "1033": ["패션의류", "남성의류", "니트/스웨터/가디건"],
        "1034": ["패션의류", "남성의류", "셔츠/남방"]
      },
      collectionMode: "aggregate",
      confidence: "aggregate_exact"
    },
    fashion_men_bottoms: { sourceCategoryId: "1035", sourceCategoryPath: ["패션의류", "남성의류", "바지/데님"] },
    fashion_goods: { sourceCategoryId: "3", sourceCategoryPath: ["패션잡화"] },
    beauty: { sourceCategoryId: "4", sourceCategoryPath: ["뷰티"] },
    kids: { sourceCategoryId: "5", sourceCategoryPath: ["출산/유아동"] },
    mobile: { sourceCategoryId: "6", sourceCategoryPath: ["모바일/태블릿"] },
    appliances: { sourceCategoryId: "7", sourceCategoryPath: ["가전제품"] },
    pc: { sourceCategoryId: "8", sourceCategoryPath: ["노트북/PC"] },
    camera: { sourceCategoryId: "9", sourceCategoryPath: ["카메라/캠코더"] },
    furniture: { sourceCategoryId: "10", sourceCategoryPath: ["가구/인테리어"] },
    living: { sourceCategoryId: "11", sourceCategoryPath: ["리빙/생활"] },
    games: { sourceCategoryId: "12", sourceCategoryPath: ["게임"] },
    hobby: { sourceCategoryId: "13", sourceCategoryPath: ["반려동물/취미"] },
    books: { sourceCategoryId: "14", sourceCategoryPath: ["도서/음반/문구"] },
    tickets: { sourceCategoryId: "15", sourceCategoryPath: ["티켓/쿠폰"] },
    sports: { sourceCategoryId: "16", sourceCategoryPath: ["스포츠"] },
    travel: { sourceCategoryId: "17", sourceCategoryPath: ["레저/여행"] },
    vehicles: { sourceCategoryId: "1367", sourceCategoryPath: ["중고차"] },
    motorcycle: { sourceCategoryId: "19", sourceCategoryPath: ["오토바이"] },
    tools: { sourceCategoryId: "20", sourceCategoryPath: ["공구/산업용품"] },
    free_share: { sourceCategoryId: "21", sourceCategoryPath: ["무료나눔"] }
  },
  bunjang: {
    // 번개장터의 패션의류 상위 분류는 여성의류·남성의류로 나뉘므로 두 ID를 합산한다.
    fashion: {
      sourceCategoryId: "310",
      sourceCategoryIds: ["310", "320"],
      sourceCategoryPath: ["패션의류"],
      sourceCategoryPaths: {
        "310": ["여성의류"],
        "320": ["남성의류"]
      },
      collectionMode: "aggregate",
      confidence: "aggregate_exact"
    },
    fashion_women: { sourceCategoryId: "310", sourceCategoryPath: ["여성의류"], confidence: "exact" },
    fashion_men: { sourceCategoryId: "320", sourceCategoryPath: ["남성의류"] },
    fashion_women_outer: { sourceCategoryId: "310300", sourceCategoryPath: ["여성의류", "아우터"] },
    fashion_women_tops: { sourceCategoryId: "310260", sourceCategoryPath: ["여성의류", "상의"] },
    fashion_women_bottoms: { sourceCategoryId: "310150", sourceCategoryPath: ["여성의류", "바지"] },
    fashion_women_skirts: { sourceCategoryId: "310130", sourceCategoryPath: ["여성의류", "치마"] },
    fashion_men_outer: { sourceCategoryId: "320300", sourceCategoryPath: ["남성의류", "아우터"] },
    fashion_men_tops: { sourceCategoryId: "320210", sourceCategoryPath: ["남성의류", "상의"] },
    fashion_men_bottoms: { sourceCategoryId: "320120", sourceCategoryPath: ["남성의류", "바지"] },
    fashion_men_jumpsuit: { sourceCategoryId: "320400", sourceCategoryPath: ["남성의류", "점프수트"] },
    fashion_goods: {
      sourceCategoryId: "405",
      sourceCategoryIds: ["405", "430", "421", "422", "400"],
      sourceCategoryPath: ["패션잡화"],
      sourceCategoryPaths: {
        "405": ["신발"],
        "430": ["가방/지갑"],
        "421": ["시계"],
        "422": ["쥬얼리"],
        "400": ["패션 액세서리"]
      },
      collectionMode: "aggregate",
      confidence: "aggregate_exact"
    },
    beauty: { sourceCategoryId: "410", sourceCategoryPath: ["뷰티/미용"] },
    kids: { sourceCategoryId: "500", sourceCategoryPath: ["유아동/출산"] },
    mobile: {
      sourceCategoryId: "600700",
      sourceCategoryIds: ["600700", "600710", "600720"],
      sourceCategoryPath: ["디지털", "휴대폰"],
      sourceCategoryPaths: {
        "600700": ["디지털", "휴대폰"],
        "600710": ["디지털", "태블릿"],
        "600720": ["디지털", "웨어러블(워치/밴드)"]
      },
      collectionMode: "aggregate",
      confidence: "aggregate_exact"
    },
    appliances: { sourceCategoryId: "610", sourceCategoryPath: ["가전제품"] },
    pc: {
      sourceCategoryId: "600100",
      sourceCategoryIds: ["600100", "600200"],
      sourceCategoryPath: ["디지털", "PC/노트북"],
      sourceCategoryPaths: {
        "600100": ["디지털", "PC/노트북"],
        "600200": ["디지털", "PC부품/저장장치"]
      },
      collectionMode: "aggregate",
      confidence: "aggregate_exact"
    },
    camera: { sourceCategoryId: "600300", sourceCategoryPath: ["디지털", "카메라/DSLR"] },
    furniture: { sourceCategoryId: "810", sourceCategoryPath: ["가구/인테리어"] },
    living: { sourceCategoryId: "800", sourceCategoryPath: ["생활/주방용품"] },
    games: { sourceCategoryId: "600600", sourceCategoryPath: ["디지털", "게임/타이틀"] },
    hobby: {
      sourceCategoryId: "980",
      sourceCategoryIds: ["980", "930", "910", "990"],
      sourceCategoryPath: ["반려동물/취미"],
      sourceCategoryPaths: {
        "980": ["반려동물용품"],
        "930": ["키덜트"],
        "910": ["스타굿즈"],
        "990": ["예술/희귀/수집품"]
      },
      collectionMode: "aggregate",
      confidence: "aggregate_exact"
    },
    books: {
      sourceCategoryId: "900100",
      sourceCategoryIds: ["900100", "900500", "920100"],
      sourceCategoryPath: ["도서/티켓/문구", "도서"],
      sourceCategoryPaths: {
        "900100": ["도서/티켓/문구", "도서"],
        "900500": ["도서/티켓/문구", "문구"],
        "920100": ["음반/악기", "CD/DVD/LP"]
      },
      collectionMode: "aggregate",
      confidence: "aggregate_exact"
    },
    tickets: {
      sourceCategoryId: "900210",
      sourceCategoryIds: ["900210", "900220", "900230"],
      sourceCategoryPath: ["도서/티켓/문구", "티켓"],
      sourceCategoryPaths: {
        "900210": ["도서/티켓/문구", "티켓"],
        "900220": ["도서/티켓/문구", "기프티콘/쿠폰"],
        "900230": ["도서/티켓/문구", "상품권"]
      },
      collectionMode: "aggregate",
      confidence: "aggregate_exact"
    },
    sports: { sourceCategoryId: "700", sourceCategoryPath: ["스포츠/레저"] },
    motorcycle: {
      sourceCategoryId: "750800",
      sourceCategoryIds: ["750800", "750810"],
      sourceCategoryPath: ["차량/오토바이", "오토바이/스쿠터"],
      sourceCategoryPaths: {
        "750800": ["차량/오토바이", "오토바이/스쿠터"],
        "750810": ["차량/오토바이", "오토바이 용품/부품"]
      },
      collectionMode: "aggregate",
      confidence: "aggregate_exact"
    },
    tools: { sourceCategoryId: "830", sourceCategoryPath: ["공구/산업용품"] }
  }
};

// 사이트를 추가할 때는 이 등록부에 siteKey와 공식 카테고리 매핑만 등록한다.
// 매핑이 없는 카테고리는 하네스가 자동으로 keyword/unavailable 계획으로 만든다.
export const CATEGORY_SITE_REGISTRY: readonly CategoryHarnessSite[] = [
  { siteKey: "joonggonara", bindings: SOURCE_CATEGORY_BINDINGS.joonggonara ?? {} },
  { siteKey: "bunjang", bindings: SOURCE_CATEGORY_BINDINGS.bunjang ?? {} },
  { siteKey: "daangn", bindings: {} },
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
  return {
    id: category.id,
    label: category.label,
    path: category.id === "all" ? [] : path
  };
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
