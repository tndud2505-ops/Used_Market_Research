import { resolveCategory, type CanonicalCategoryId } from "../../market/logic/category-catalog.js";

export type SearchOnlyCategoryConfidence = "high" | "medium" | "low" | "unknown";
export type SearchOnlyCategorySource = "listing_text" | "keyword" | "none";

export interface SearchOnlyCategoryTag {
  canonical_category_id: CanonicalCategoryId | null;
  canonical_category_path: string[];
  category_confidence: "inferred" | "unknown";
  category_inference_confidence: SearchOnlyCategoryConfidence;
  category_classification_mode: "keyword_inferred";
  category_source: SearchOnlyCategorySource;
  category_evidence: string[];
}

export interface SearchOnlyCategorySummary {
  canonical_category_id: CanonicalCategoryId;
  label: string;
  count: number;
  high_confidence_count: number;
  medium_confidence_count: number;
  low_confidence_count: number;
}

type CategoryRule = {
  id: CanonicalCategoryId;
  patterns: RegExp[];
  specificity?: number;
};

const CATEGORY_RULES: CategoryRule[] = [
  { id: "vehicles", patterns: [/중고차|자동차|승용차|SUV|세단|트럭|차량/i] },
  { id: "motorcycle", patterns: [/오토바이|바이크|스쿠터|모터사이클/i] },
  { id: "pc", patterns: [/RTX|GTX|그래픽카드|GPU|CPU|라이젠|RYZEN|인텔|INTEL|DDR[345]|RAM|메모리|SSD|NVMe|메인보드|파워서플라이|조립PC|게이밍\s*PC|컴퓨터|노트북|맥북|맥미니|데스크탑|laptop|desktop|computer/i] },
  { id: "mobile", patterns: [/아이폰|iPhone|갤럭시|Galaxy|스마트폰|휴대폰|공기계|아이패드|iPad|태블릿|tablet|스마트워치|애플워치|갤럭시워치/i] },
  { id: "camera", patterns: [/카메라|렌즈|DSLR|미러리스|캠코더|GoPro|고프로/i] },
  { id: "games", patterns: [/닌텐도|스위치|Nintendo|PlayStation|플레이스테이션|PS[45]|엑스박스|Xbox|게임기|게임타이틀|콘솔/i] },
  { id: "appliances", patterns: [/냉장고|세탁기|건조기|에어컨|전자레인지|청소기|공기청정기|제습기|압력밥솥|밥솥|TV|텔레비전|가전/i] },
  { id: "furniture", patterns: [/소파|침대|매트리스|책상|의자|식탁|수납장|옷장|가구|인테리어/i] },
  { id: "sports", specificity: 2, patterns: [/골프|자전거|러닝|축구|야구|농구|등산|캠핑|낚시|헬스|운동|운동화|러닝화|축구화|농구화|등산화|스포츠/i] },
  { id: "tools", specificity: 1, patterns: [/공구|드릴|용접|산업용품|전동공구|측정기|재봉|재봉틀|오버록|미싱|봉제|다리미대|작업대|마네킹|피팅바디|진열대/i] },
  { id: "books", patterns: [/도서|책|문고|문구|음반|앨범|LP|CD/i] },
  { id: "tickets", patterns: [/티켓|상품권|쿠폰|콘서트|공연|관람권/i] },
  { id: "travel", patterns: [/여행|캐리어|여권지갑|레저/i] },
  { id: "beauty", patterns: [/화장품|스킨케어|메이크업|향수|뷰티|샴푸|미용/i] },
  { id: "kids", patterns: [/유아|아동|어린이|아기|키즈|장난감|유모차|카시트/i] },
  { id: "luxury", specificity: 2, patterns: [/명품|샤넬|루이비통|구찌|에르메스|프라다|디올/i] },
  { id: "fashion_goods", specificity: 1, patterns: [/가방|백팩|지갑|신발|운동화|스니커즈|구두|부츠|샌들|시계|액세서리|안경|선글라스/i] },
  { id: "fashion_women_outer", specificity: 2, patterns: [/여성\s*(?:의류\s*)?(?:아우터|코트|패딩|자켓|재킷|점퍼|가디건)/i] },
  { id: "fashion_women_tops", specificity: 2, patterns: [/여성\s*(?:의류\s*)?(?:상의|티셔츠|셔츠|후드|후드티|니트|블라우스|맨투맨|스웨터)/i] },
  { id: "fashion_women_bottoms", specificity: 2, patterns: [/여성\s*(?:의류\s*)?(?:바지|팬츠|청바지|슬랙스|레깅스|반바지|하의)/i] },
  { id: "fashion_women_skirts", specificity: 2, patterns: [/여성\s*(?:의류\s*)?(?:치마|스커트)/i] },
  { id: "fashion_men_outer", specificity: 2, patterns: [/남성\s*(?:의류\s*)?(?:아우터|코트|패딩|자켓|재킷|점퍼|가디건)/i] },
  { id: "fashion_men_tops", specificity: 2, patterns: [/남성\s*(?:의류\s*)?(?:상의|티셔츠|셔츠|후드|후드티|니트|블라우스|맨투맨|스웨터)/i] },
  { id: "fashion_men_bottoms", specificity: 2, patterns: [/남성\s*(?:의류\s*)?(?:바지|팬츠|청바지|슬랙스|레깅스|반바지|하의)/i] },
  { id: "fashion_men_jumpsuit", specificity: 2, patterns: [/남성\s*(?:의류\s*)?(?:점프수트|멜빵|오버롤)/i] },
  { id: "fashion_men", specificity: 1, patterns: [/남성|남자|맨즈|men'?s|mens/i] },
  { id: "fashion_women", specificity: 1, patterns: [/여성|여자|우먼|women'?s|womens/i] },
  { id: "fashion", specificity: 0, patterns: [/의류|셔츠|티셔츠|후드|후드티|니트|자켓|재킷|패딩|원피스|스커트|청바지|팬츠|바지|코트|가디건|정장|fashion|shirt|hoodie|jacket|dress|coat|pants|jeans/i] },
  { id: "hobby", patterns: [/반려동물|강아지|고양이|피규어|프라모델|취미|악기|드론|수집/i] },
  { id: "living", patterns: [/생활용품|주방용품|식기|그릇|조명|욕실|생활/i] },
  { id: "free_share", specificity: 2, patterns: [/무료\s*나눔|나눔/i] }
];

function normalizeText(value: string | undefined): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function classifyText(text: string): { id: CanonicalCategoryId; evidence: string[]; score: number } | null {
  const candidates = CATEGORY_RULES.map((rule, order) => {
    const evidence = rule.patterns.flatMap((pattern) => {
      const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
      return [...text.matchAll(new RegExp(pattern.source, flags))]
        .map((match) => match[0])
        .filter(Boolean);
    });
    return { ...rule, evidence, score: evidence.length, order };
  }).filter((candidate) => candidate.score > 0);

  candidates.sort((left, right) => (
    (right.specificity ?? 0) - (left.specificity ?? 0)
    || right.score - left.score
    || left.order - right.order
  ));
  const selected = candidates[0];
  const runnerUp = candidates[1];
  if (
    selected
    && runnerUp
    && selected.id !== runnerUp.id
    && (selected.specificity ?? 0) === (runnerUp.specificity ?? 0)
    && selected.score === runnerUp.score
  ) {
    return null;
  }
  return selected
    ? { id: selected.id, evidence: selected.evidence, score: selected.score }
    : null;
}

export function classifySearchOnlyListing(input: {
  title: string;
  description?: string;
  keyword?: string;
}): SearchOnlyCategoryTag {
  const listingText = normalizeText(`${input.title} ${input.description ?? ""}`);
  const listingMatch = classifyText(listingText);
  const keywordMatch = classifyText(normalizeText(input.keyword));
  const selected = listingMatch ?? keywordMatch;
  if (!selected) {
    return {
      canonical_category_id: null,
      canonical_category_path: [],
      category_confidence: "unknown",
      category_inference_confidence: "unknown",
      category_classification_mode: "keyword_inferred",
      category_source: "none",
      category_evidence: []
    };
  }

  const source: SearchOnlyCategorySource = listingMatch ? "listing_text" : "keyword";
  const confidence: SearchOnlyCategoryConfidence = listingMatch
    ? listingMatch.score >= 2 ? "high" : "medium"
    : "low";
  const selection = resolveCategory(selected.id);
  return {
    canonical_category_id: selected.id,
    canonical_category_path: selection?.path ?? [],
    category_confidence: "inferred",
    category_inference_confidence: confidence,
    category_classification_mode: "keyword_inferred",
    category_source: source,
    category_evidence: selected.evidence
  };
}

export function summarizeSearchOnlyCategories(tags: SearchOnlyCategoryTag[]): {
  category_summary: SearchOnlyCategorySummary[];
  uncategorized_count: number;
} {
  const summary = new Map<CanonicalCategoryId, SearchOnlyCategorySummary>();
  let uncategorizedCount = 0;
  for (const tag of tags) {
    if (!tag.canonical_category_id) {
      uncategorizedCount += 1;
      continue;
    }
    const category = resolveCategory(tag.canonical_category_id);
    if (!category) {
      uncategorizedCount += 1;
      continue;
    }
    const current = summary.get(tag.canonical_category_id) ?? {
      canonical_category_id: tag.canonical_category_id,
      label: category.label,
      count: 0,
      high_confidence_count: 0,
      medium_confidence_count: 0,
      low_confidence_count: 0
    };
    current.count += 1;
    if (tag.category_inference_confidence === "high") current.high_confidence_count += 1;
    if (tag.category_inference_confidence === "medium") current.medium_confidence_count += 1;
    if (tag.category_inference_confidence === "low") current.low_confidence_count += 1;
    summary.set(tag.canonical_category_id, current);
  }
  return {
    category_summary: [...summary.values()].sort((left, right) => right.count - left.count || left.label.localeCompare(right.label)),
    uncategorized_count: uncategorizedCount
  };
}

export function listSearchOnlyCategoryRules(): CanonicalCategoryId[] {
  return [...new Set(CATEGORY_RULES.map((rule) => rule.id))];
}
