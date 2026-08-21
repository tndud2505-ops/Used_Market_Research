const CATEGORY_ALIASES = Object.freeze({
  fashion: ["패션", "의류", "옷", "자켓", "재킷", "코트", "셔츠", "티셔츠", "바지", "치마", "원피스", "니트", "후드"],
  fashion_women: ["여성", "여자", "여성의류", "원피스", "블라우스", "스커트"],
  fashion_men: ["남성", "남자", "남성의류", "셔츠", "정장"],
  fashion_women_outer: ["여성", "자켓", "재킷", "코트", "패딩", "점퍼", "집업", "조끼", "가디건", "트렌치"],
  fashion_women_tops: ["여성", "상의", "티셔츠", "셔츠", "블라우스", "니트", "맨투맨", "후드"],
  fashion_women_bottoms: ["여성", "바지", "팬츠", "치마", "스커트", "레깅스"],
  fashion_men_outer: ["남성", "자켓", "재킷", "코트", "패딩", "점퍼", "집업", "조끼", "블루종"],
  fashion_men_tops: ["남성", "상의", "티셔츠", "셔츠", "니트", "맨투맨", "후드"],
  fashion_men_bottoms: ["남성", "바지", "팬츠", "슬랙스", "청바지"],
  fashion_men_jumpsuit: ["남성", "점프수트", "오버롤", "멜빵"],
  fashion_goods: ["패션잡화", "가방", "신발", "운동화", "스니커즈", "로퍼", "구두", "부츠", "샌들", "지갑", "벨트", "모자", "스카프", "선글라스"],
  luxury: ["명품", "샤넬", "루이비통", "구찌", "프라다", "버버리", "에르메스"],
  beauty: ["화장품", "뷰티", "향수", "스킨", "로션", "메이크업", "샴푸"],
  kids: ["유아", "아동", "키즈", "아기", "어린이", "유모차", "카시트", "장난감"],
  mobile: ["아이폰", "iphone", "갤럭시", "galaxy", "스마트폰", "휴대폰", "핸드폰", "태블릿", "아이패드", "ipad", "애플워치", "에어팟", "airpods", "remarkable"],
  appliances: ["가전", "냉장고", "세탁기", "청소기", "에어컨", "전자레인지", "TV", "티비", "밥솥", "에어랩", "드라이기", "헤어드라이어", "고데기", "공기청정기", "제습기", "건조기", "스타일러", "에어프라이어", "커피머신"],
  pc: ["컴퓨터", "노트북", "맥북", "pc", "cpu", "gpu", "그래픽카드", "rtx", "gtx", "라데온", "ryzen", "인텔", "램", "ram", "ssd", "하드", "모니터", "키보드", "마우스"],
  camera: ["카메라", "렌즈", "dslr", "미러리스", "캠코더", "고프로", "후지", "소니", "캐논", "니콘"],
  furniture: ["가구", "소파", "침대", "책상", "의자", "식탁", "장롱", "수납장"],
  living: ["주방", "식기", "냄비", "후라이팬", "그릇", "생활용품", "인테리어"],
  games: ["게임", "닌텐도", "스위치", "플레이스테이션", "플스", "ps5", "xbox", "게임기", "게임타이틀", "스팀덱", "steamdeck", "아미보", "게임팩", "동물의숲"],
  hobby: ["취미", "피규어", "레고", "프라모델", "악기", "기타", "드론", "수집"],
  books: ["도서", "책", "만화", "소설", "문구", "음반", "앨범"],
  tickets: ["티켓", "공연", "콘서트", "뮤지컬", "상품권", "영화"],
  sports: ["스포츠", "축구", "야구", "골프", "자전거", "등산", "헬스", "운동화", "스키"],
  travel: ["여행", "레저", "캠핑", "텐트", "낚시", "수영", "캐리어"],
  vehicles: ["중고차", "자동차", "승용차", "suv", "경차"],
  motorcycle: ["오토바이", "바이크", "스쿠터", "모터사이클"],
  tools: ["공구", "산업", "드릴", "용접", "전동공구", "장비"],
  free_share: ["무료", "나눔", "무료나눔"]
});

const STANDALONE_CATEGORY_ALIASES = new Set([
  "도서",
  "티켓"
]);

const CATEGORY_MATCH_RULES = Object.freeze({
  fashion_women: { any: ["여성", "여자", "여성의류"] },
  fashion_men: { any: ["남성", "남자", "남성의류"] },
  fashion_women_outer: {
    all: [
      ["여성", "여자", "여성의류"],
      ["아우터", "자켓", "재킷", "코트", "패딩", "점퍼", "집업", "조끼", "가디건", "트렌치"]
    ]
  },
  fashion_women_tops: {
    all: [
      ["여성", "여자", "여성의류"],
      ["상의", "티셔츠", "셔츠", "블라우스", "니트", "맨투맨", "후드"]
    ]
  },
  fashion_women_bottoms: {
    all: [
      ["여성", "여자", "여성의류"],
      ["바지", "팬츠", "치마", "스커트", "레깅스"]
    ]
  },
  fashion_women_skirts: {
    all: [
      ["여성", "여자", "여성의류"],
      ["치마", "스커트"]
    ]
  },
  fashion_men_outer: {
    all: [
      ["남성", "남자", "남성의류"],
      ["아우터", "자켓", "재킷", "코트", "패딩", "점퍼", "집업", "조끼", "블루종"]
    ]
  },
  fashion_men_tops: {
    all: [
      ["남성", "남자", "남성의류"],
      ["상의", "티셔츠", "셔츠", "니트", "맨투맨", "후드"]
    ]
  },
  fashion_men_bottoms: {
    all: [
      ["남성", "남자", "남성의류"],
      ["바지", "팬츠", "슬랙스", "청바지"]
    ]
  },
  fashion_men_jumpsuit: {
    all: [
      ["남성", "남자", "남성의류"],
      ["점프수트", "오버롤", "멜빵"]
    ]
  }
});

const CATEGORY_EXCLUSION_RULES = Object.freeze({
  mobile: {
    // Official mobile categories on the marketplaces also contain cases,
    // chargers, stands and storage cards. These are hard exclusions: a
    // device name in the same title ("아이폰 케이스", for example) must not
    // rescue an accessory listing into the device category.
    hard_excluded: ["케이스", "커버", "파우치", "보호필름", "강화유리", "필름", "스트랩", "거치대", "스탠드", "홀더", "그립톡", "충전기", "충전케이블", "케이블", "보조배터리", "무선충전", "맥세이프", "액세서리", "악세사리", "메모리카드", "sd카드", "cfexpress", "카드리더기", "틸타", "카메라리그", "촬영리그", "스마트폰리그", "폰꾸", "스마트폰꾸미기", "파손폰매입", "중고폰매입", "아이폰매입", "휴대폰매입", "폰매입", "고장폰매입", "수리", "대여", "렌탈", "렌트"],
    excluded: ["갤럭시북", "노트북", "맥북", "컴퓨터", "모니터", "키보드", "마우스", "그래픽카드", "rtx", "gtx", "유희왕", "갤럭시아이즈", "히어로즈", "게임", "게임기", "게임타이틀", "닌텐도", "플스", "ps5", "xbox", "카드", "피규어", "굿즈", "린넨", "자켓", "재킷", "원피스", "셔츠", "바지", "코트", "패딩", "가디건", "스커트", "치마", "가방", "신발"],
    rescue: ["아이폰", "iphone", "갤럭시s", "갤럭시z", "갤럭시a", "갤럭시워치", "스마트폰", "휴대폰", "핸드폰", "태블릿", "아이패드", "ipad", "에어팟", "애플워치"]
  },
  pc: {
    hard_excluded: ["3d프린터", "3d 프린터", "필라멘트", "프린터용지", "게이밍의자", "pc방의자", "피시방의자", "컴퓨터의자", "게임장의자"],
    excluded: ["아이폰", "iphone", "스마트폰", "휴대폰", "핸드폰", "아이패드", "ipad", "에어팟", "애플워치", "충전기", "충전케이블", "케이블", "usb", "c타입", "라이트닝"],
    rescue: ["rtx", "gtx", "gpu", "그래픽카드", "메인보드", "cpu", "ryzen", "인텔", "amd", "노트북", "맥북", "갤럭시북", "컴퓨터", "데스크탑", "모니터", "키보드", "마우스", "ram", "ssd", "hdd"]
  },
  tickets: {
    hard_excluded: ["대리수강신청", "수강신청", "유튜브", "넷플릭스", "디즈니플러스", "제미나이", "퍼플렉시티", "google", "ott계정", "계정공유", "구독권", "대리티켓팅", "댈티", "예매대행", "티켓팅대행", "프로그램북", "힐튼포인트", "포인트링크"],
    excluded: ["파우치", "블록", "블럭", "티셔츠", "밴드티", "후드", "스티커", "굿즈", "인형", "케이스", "포토카드", "앨범", "md", "엽서", "럭드", "셔틀", "응원봉", "대여", "머천다이즈"],
    rescue: []
  },
  appliances: {
    hard_excluded: ["휴대폰", "스마트폰", "충전기", "충전독", "무선충전"],
    excluded: ["바람막이", "반팔티", "반팔", "티셔츠", "셔츠", "가디건", "옷", "의류", "상의", "하의", "차량용", "차량", "자동차", "휴대폰거치대", "스마트폰거치대", "수리", "설치", "기사", "필터", "서비스"],
    rescue: ["에어컨실외기"]
  },
  beauty: {
    hard_excluded: ["에코백", "가방", "원피스", "키링", "지갑"],
    excluded: [],
    rescue: []
  },
  games: {
    hard_excluded: ["양말", "립스틱", "립", "치크", "화장품", "스킨", "로션", "향수", "스티커", "캔배지", "캔뱃지", "배지", "뱃지", "메이플스토리", "케이스", "실리콘케이스", "보호필름", "티셔츠", "후드티", "신발", "가방"],
    excluded: ["최고가", "매입", "삽니다", "구합니다"],
    rescue: [],
    patterns: [/3ps5(?=[가-힣0-9]|$)/i]
  },
  camera: {
    hard_excluded: ["장난감", "토이", "레고", "카메라키링"],
    excluded: ["메신저백", "숄더백", "토트백", "크로스백", "미니백", "백팩", "카메라가방", "카메라백", "카메라핸드백", "camerabag", "아이폰", "iphone", "갤럭시", "galaxy", "스마트폰", "휴대폰", "핸드폰", "수리", "메인보드", "가챠", "피규어", "미니어쳐", "미니어처"],
    rescue: []
  },
  furniture: {
    hard_excluded: ["브라켓", "브래킷", "게임", "게임아이템", "동물의숲", "동물의 숲", "모동숲", "마일티켓", "주민분양", "레시피", "아이템", "가구배치", "사자상", "액자", "벨트", "모자", "신발", "농구화", "브러시", "브러쉬", "청소", "차량용", "자동차", "차량", "식물", "화분", "플랜트", "뜨개", "뜨개실", "원사", "실타래", "가방", "지갑"],
    excluded: ["책상거울", "책상용거울", "탁상거울", "책상스탠드", "책상정리대", "책상선반", "책상휴지통", "책상선풍기", "책상거치대", "책상정리", "정리용", "거치대", "스텐고리", "휴대폰거치대", "스마트폰거치대", "탁상용선풍기", "탁상선풍기", "플래너", "다이어리", "문구", "노트", "필기", "가챠", "피규어", "스티커", "포토카드", "굿즈"],
    rescue: [],
    patterns: [/\d+인가구/]
  },
  living: {
    hard_excluded: ["생활방수", "생활건강", "생활화", "생활한복"],
    excluded: [],
    rescue: []
  },
  hobby: {
    hard_excluded: ["태블릿", "아이패드", "스마트폰", "휴대폰"],
    excluded: [],
    rescue: []
  },
  travel: {
    hard_excluded: ["자동차", "차량", "자동차시트", "시트보호대", "유아발자국방지"],
    excluded: [],
    rescue: []
  },
  vehicles: {
    hard_excluded: ["차량용", "자동차악세사리", "rc", "키케이스", "공기청정기", "차량햇빛가리개"],
    excluded: [],
    rescue: []
  },
  motorcycle: {
    hard_excluded: ["변신로봇", "미니로봇", "완구", "장난감", "로봇세트"],
    excluded: [],
    rescue: []
  },
  fashion: {
    hard_excluded: ["아이웨어", "힙색", "장갑", "우산", "운동화", "넥타이", "스티머", "의류관리기", "귀걸이", "이어링", "목걸이", "반지", "팔찌", "선글라스", "안경", "가방", "지갑", "숄더백", "핸드백", "토트백", "백팩", "크로스백", "벨트", "모자", "시계", "브로치", "키링", "스카프"],
    excluded: [],
    rescue: []
  },
  fashion_women: {
    hard_excluded: ["아이웨어", "힙색", "장갑", "우산", "운동화", "넥타이", "스티머", "의류관리기", "귀걸이", "이어링", "목걸이", "반지", "팔찌", "선글라스", "안경", "가방", "지갑", "숄더백", "핸드백", "토트백", "백팩", "크로스백", "벨트", "모자", "시계", "브로치", "키링", "스카프"],
    excluded: [],
    rescue: []
  },
  fashion_men: {
    hard_excluded: ["아이웨어", "힙색", "장갑", "우산", "운동화", "넥타이", "스티머", "의류관리기", "귀걸이", "이어링", "목걸이", "반지", "팔찌", "선글라스", "안경", "가방", "지갑", "숄더백", "핸드백", "토트백", "백팩", "크로스백", "벨트", "모자", "시계", "브로치", "키링", "스카프"],
    excluded: [],
    rescue: []
  }
});

// Compound words that contain a broad category alias but are not actual
// listings in that category.
const CATEGORY_COMPOUND_EXCLUSIONS = Object.freeze({
  mobile: ["\uD3EC\uCE74", "\uD3EC\uD1A0\uCE74\uB4DC", "\uD2B9\uC804", "\uC544\uC774\uB3CC", "\uC568\uBC94", "\uD32C\uAD7F\uC988", "\uD0A4\uB9C1", "\uD0A4\uCCB4\uC778", "\uD578\uB4DC\uD3F0\uC904", "\uAC00\uBC29\uD0A4\uB9C1", "\uCF5C\uBD81\uD0A4\uB9C1", "\uAC24\uB7ED\uC2DC\uC544\uC2A4", "\uAC24\uB7ED\uC2DC\uC544\uC774\uC988", "\uAC24\uB7ED\uC2DC\uD788\uC5B4\uB85C\uC988", "\uCD08\uD310", "\uD32C\uD140\uBC84\uC2A4\uD130\uC988", "\uADF9\uB77D\uAC00", "\uC790\uCF13", "\uB9B0\uB128", "\uC154\uCE20", "\uBC14\uC9C0", "\uC6D0\uD53C\uC2A4", "\uD328\uB529", "\uCF54\uD2B8", "xcode", "\uD504\uB85C\uADF8\uB798\uBC0D", "\uCF54\uB529", "\uAC1C\uBC1C"],
  tickets: ["\uC785\uC7A5\uAE30\uD504\uD2B8", "\uCF58\uC11C\uD2B8\uAE30\uD504\uD2B8", "\uAE30\uD504\uD2B8\uC138\uD2B8", "\uD30C\uC6B0\uCE58", "\uBE14\uB7ED", "\uBE14\uB85D", "\uD2F0\uC154\uCE20", "\uAD7F\uC988", "\uD3EC\uD1A0\uCE74\uB4DC", "\uD2B9\uC804", "\uCF58\uC11C\uD2B8\uD640", "\uB9AC\uBBF8\uD2F0\uB4DC\uC5D0\uB514\uC158", "\uC568\uBC94", "\uC74C\uBC18", "\uC9C0\uC2A4\uB514"],
  camera: ["\uCE74\uBA54\uB77C\uD0C0", "\uBB34\uC74C\uCE74\uBA54\uB77C"],
  games: ["\uC608\uC57D\uD2B9\uC804", "\uD2B9\uC804\uD3EC\uC2A4\uD130", "\uD3EC\uC2A4\uD130"],
  furniture: ["\uAC00\uAD6C\uC5ED", "\uCC45\uC0C1\uBC11", "\uC815\uB9AC\uB300", "\uCC45\uC0C1\uAFB8\uBBF8\uAE30", "\uBBF8\uB2C82\uB2E8\uC120\uBC18", "\uCC45\uC0C1\uAC70\uCE58\uB300", "\uCC45\uC0C1\uAC00\uCC28", "\uCC45\uC0C1\uAC70\uC6B8", "\uD0C1\uC0C1\uC6A9", "\uCC45\uC0C1\uC120\uD48D\uAE30", "\uD734\uC9C0\uD1B5", "\uC4F0\uB808\uAE30\uD1B5", "\uC18C\uD488\uAC78\uC774", "\uD14C\uC774\uBE14\uD734\uC9C0\uD1B5"]
});

function normalizeText(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, "");
}

function hasGenderSignal(categoryId, text) {
  if (categoryId.includes("women")) {
    return text.includes("여성") || text.includes("여자") || /여(?=[0-9a-z/]|$)/i.test(text);
  }
  if (categoryId.includes("men")) {
    return text.includes("남성") || text.includes("남자") || /남(?=[0-9a-z/]|$)/i.test(text);
  }
  return false;
}

function containsCategoryAlias(text, alias, rawText = text) {
  const normalizedAlias = normalizeText(alias);
  if (!normalizedAlias) return false;
  if (normalizedAlias.length < 2 || STANDALONE_CATEGORY_ALIASES.has(normalizedAlias)) {
    const escapedAlias = normalizedAlias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|[\\s,/|()[\\]{}<>·_-])${escapedAlias}(?=$|[\\s,/|()[\\]{}<>·_-])`, "i").test(rawText);
  }
  if (normalizedAlias === "상의" && text.includes("색상의")) return false;
  // "추가구매" contains the furniture alias "가구" but is not a furniture
  // signal. Keep a real "가구" token elsewhere in the same title.
  if (normalizedAlias === "가구" && text.includes("추가구매")
    && text.indexOf("가구") === text.indexOf("추가구매") + 1) return false;
  return text.includes(normalizedAlias);
}

export function categoryIdsFromBody(body) {
  const values = [
    ...(Array.isArray(body?.category_ids) ? body.category_ids : []),
    body?.category_id
  ];
  return [...new Set(values
    .filter((value) => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value && value !== "all"))];
}

export function categoryAliases(categoryId) {
  return CATEGORY_ALIASES[categoryId] || [categoryId];
}

function mostSpecificCategoryIds(categoryIds) {
  return categoryIds.filter((categoryId) => !categoryIds.some((candidate) => (
    candidate !== categoryId && candidate.startsWith(`${categoryId}_`)
  )));
}

function matchesCategory(categoryId, text, aliases, rawText = text) {
  const rule = CATEGORY_MATCH_RULES[categoryId];
  if (rule?.all) {
    return rule.all.every((group, index) => index === 0 && (categoryId.includes("women") || categoryId.includes("men"))
      ? hasGenderSignal(categoryId, text)
      : group.some((alias) => containsCategoryAlias(text, alias, rawText)));
  }
  if (rule?.any) {
    return (categoryId.includes("women") || categoryId.includes("men")) && hasGenderSignal(categoryId, text)
      || rule.any.some((alias) => containsCategoryAlias(text, alias, rawText));
  }
  return aliases.some((alias) => containsCategoryAlias(text, alias, rawText));
}

function hasCategoryExclusion(categoryId, text) {
  const rule = CATEGORY_EXCLUSION_RULES[categoryId];
  if (!rule) return false;
  const compoundExcluded = (CATEGORY_COMPOUND_EXCLUSIONS[categoryId] || [])
    .some((term) => text.includes(normalizeText(term)));
  const includedApplianceAccessory = categoryId === "appliances"
    && /(?:냉장고|세탁기|청소기|에어컨|전자레인지|tv|티비|밥솥)/i.test(text)
    && /(?:충전기|충전독|무선충전)/i.test(text)
    && /(?:포함|본체|풀세트|구성)/i.test(text);
  const hardExcluded = (rule.hard_excluded || [])
    .some((alias) => text.includes(normalizeText(alias))
      && !(includedApplianceAccessory && ["충전기", "충전독", "무선충전"].includes(alias)));
  const hasRescue = rule.rescue.some((alias) => text.includes(normalizeText(alias)));
  return compoundExcluded || hardExcluded || (!hasRescue && (
    rule.excluded.some((alias) => text.includes(normalizeText(alias)))
      || (rule.patterns || []).some((pattern) => pattern.test(text))
  ));
}

export function isCategoryExcluded(categoryId, item) {
  const rawText = String(item?.title || item?.search_text || "").toLowerCase().replace(/\s+/g, " ").trim();
  return hasCategoryExclusion(categoryId, normalizeText(rawText));
}

const MOBILE_ACCESSORY_TERMS = ["케이스", "케아스", "커버", "파우치", "스트랩", "보호필름", "필름", "스티커", "주문제작", "매입", "수리", "부품", "호환품", "액세서리", "악세사리", "공박스", "빈박스", "박스만", "박스", "핸드폰제외", "핸드폰 제외", "본체제외", "본체 제외", "폰제외", "폰 제외", "삽니다", "구합니다", "최고가", "거치대", "스탠드", "홀더", "받침대", "보호대", "강화유리", "충전기", "충전케이블", "케이블", "충전거치대", "충전독", "차저", "어댑터", "보조배터리", "배터리", "무선충전", "맥세이프", "카메라", "틸타", "카메라리그", "촬영리그", "스마트폰리그", "case", "cover", "pouch", "strap", "repair", "parts", "accessory", "buyback", "charger", "powerbank"];

export function isKeywordCategoryNoise(categoryId, item, keyword) {
  if (typeof keyword !== "string" || !keyword.trim()) return false;
  const query = normalizeText(keyword);
  const rawText = String(item?.title || item?.search_text || "").toLowerCase().replace(/\s+/g, " ").trim();
  const text = normalizeText(rawText);
  if (categoryId === "tickets" && query.includes(normalizeText("콘서트"))) {
    const ticketSignals = ["티켓", "ticket", "양도", "입장권", "관람권", "예매", "좌석", "구역", "연석", "공연권", "플로어", "플로어석", "열", "자리", "첫콘", "막콘", "교환"];
    return !ticketSignals.some((term) => text.includes(normalizeText(term)));
  }
  if (categoryId !== "mobile") return false;
  if (MOBILE_ACCESSORY_TERMS.some((term) => query.includes(normalizeText(term)))) return false;
  const matchedAccessoryTerms = MOBILE_ACCESSORY_TERMS.filter((term) => text.includes(normalizeText(term)));
  const hasAccessorySignal = matchedAccessoryTerms.length > 0;
  if (!hasAccessorySignal) return false;
  const batteryCondition = /배터리\s*(?:효율|성능|상태)?\s*\d{2,3}\s*%/i.test(rawText);
  if (batteryCondition && matchedAccessoryTerms.every((term) => term === "배터리")) return false;
  const bundledWithDevice = ["포함", "같이", "함께", "풀세트", "풀박스", "일괄"].some((term) => text.includes(normalizeText(term)))
    && (["본체", "공기계", "자급제", "정상해지", "128gb", "256gb", "512gb", "1tb"].some((term) => text.includes(normalizeText(term)))
      || /(?:64|128|256|512)\s*(?:g|gb|기가)\b/i.test(rawText)
      || batteryCondition);
  return !bundledWithDevice;
}

export function filterCategoryItems(items, body) {
  const categoryIds = mostSpecificCategoryIds(categoryIdsFromBody(body));
  if (!categoryIds.length) return items;
  const categoryAliasesList = categoryIds.map((categoryId) => ({
    categoryId,
    aliases: categoryAliases(categoryId).map(normalizeText).filter(Boolean)
  })).filter(({ aliases }) => aliases.length);
  if (!categoryAliasesList.length) return items;
  return items.filter((item) => {
    const rawText = String(item?.title || item?.search_text || "").toLowerCase().replace(/\s+/g, " ").trim();
    const text = normalizeText(rawText);
    return categoryAliasesList.some(({ categoryId, aliases }) => (
      matchesCategory(categoryId, text, aliases, rawText) && !hasCategoryExclusion(categoryId, text)
    ));
  });
}

export function categoryFilterStats(items, body) {
  const rawCount = Array.isArray(items) ? items.length : 0;
  const filteredCount = filterCategoryItems(items || [], body).length;
  return { rawCount, filteredCount, removedCount: Math.max(0, rawCount - filteredCount) };
}
