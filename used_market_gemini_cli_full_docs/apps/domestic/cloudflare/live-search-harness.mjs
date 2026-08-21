import { buildLivePayload, bunjangKeywordPagePlan, categoryQuery, categorySearchIds, enrichHelloImages, helloMarketPagePlan, joongnaPagePlan, matchesRequestedKeyword, parseTimestamp, requestedPriceRange, requestedSiteWindow, requestedSites, requestedSort, sourceCandidateLimit } from "./live-search.mjs";
import { TARGET_SITES } from "./target-sites.mjs";
import { filterCategoryItems, isCategoryExcluded, isKeywordCategoryNoise } from "./category-filter.mjs";

assert(categoryQuery({ keyword: "RTX 3070", category_id: "pc" }).includes("RTX 3070"), "explicit keyword is preserved");
assert(categoryQuery({ category_id: "fashion_women_bottoms" }) === "여성 바지", "category becomes live query");
assert(categorySearchIds({ category_ids: ["mobile", "pc"] }).join(",") === "mobile,pc", "multiple categories are searched independently");
assert(requestedSites({ sites: ["bunjang", "bunjang", "unknown", "joonggonara"] }).join(",") === "bunjang,joonggonara", "site allowlist and dedupe");
assert(requestedSites({ category_id: "mobile", sites: ["bunjang", "hellomarket", "rethinkmall"] }).join(",") === "bunjang", "category-only browsing uses verified source category paths");
assert(requestedSites({ keyword: "아이폰 15", category_id: "mobile", sites: ["bunjang", "hellomarket", "rethinkmall"] }).join(",") === "bunjang,hellomarket,rethinkmall", "keyword category searches include search-only sites with local filtering");
assert(TARGET_SITES.join(",") === "bunjang,joonggonara,hellomarket,rethinkmall", "the public product has four active source sites");
assert(requestedSites({ keyword: "아이폰 15", sites: ["daangn", "bunjang"] }).join(",") === "bunjang", "retired Daangn requests are ignored by the active source allowlist");
assert(requestedSort({}) === "recommended", "recommended listings are the default sort");
assert(requestedSort({ sort: "recommended" }) === "recommended", "recommended sort is accepted");
assert(requestedSort({ sort: "price_desc" }) === "price_desc", "highest price sort is accepted");
assert(requestedSort({ sort: "recent" }) === "recent", "recent sort is accepted");
assert(JSON.stringify(requestedPriceRange({})) === JSON.stringify({ min: null, max: null }), "price range defaults to no bounds");
assert(JSON.stringify(requestedPriceRange({ min_price: 300000, max_price: 600000 })) === JSON.stringify({ min: 300000, max: 600000 }), "price range accepts integer won bounds");
assert(JSON.stringify(bunjangKeywordPagePlan(20, { min: null, max: null })) === JSON.stringify({ pageSize: 20, maxPages: 1 }), "Bunjang small keyword collection reads one page");
assert(JSON.stringify(bunjangKeywordPagePlan(40, { min: null, max: null })) === JSON.stringify({ pageSize: 20, maxPages: 2 }), "Bunjang single-source window reads enough pages for 40 candidates");
assert(JSON.stringify(bunjangKeywordPagePlan(160, { min: null, max: null })) === JSON.stringify({ pageSize: 20, maxPages: 8 }), "Bunjang initial index collection can read 160 candidates");
assert(JSON.stringify(bunjangKeywordPagePlan(640, { min: null, max: null })) === JSON.stringify({ pageSize: 20, maxPages: 32 }), "Bunjang on-demand expansion can read 640 candidates");
assert(JSON.stringify(bunjangKeywordPagePlan(160, { min: 300000, max: 900000 })) === JSON.stringify({ pageSize: 60, maxPages: 3 }), "Bunjang bounded price collection uses fewer larger pages");
assert(JSON.stringify(joongnaPagePlan(30)) === JSON.stringify({ pageSize: 50, maxPages: 1 }), "Joongna first result page covers a 30-item request");
assert(JSON.stringify(joongnaPagePlan(160)) === JSON.stringify({ pageSize: 50, maxPages: 4 }), "Joongna initial index collection can read four result pages");
assert(JSON.stringify(joongnaPagePlan(640)) === JSON.stringify({ pageSize: 50, maxPages: 13 }), "Joongna on-demand expansion can read thirteen result pages");
assert(JSON.stringify(helloMarketPagePlan(640)) === JSON.stringify({ pageSize: 20, maxPages: 32 }), "Hello Market on-demand expansion can read enough result pages");
assert(requestedSiteWindow({}) === 160, "site collection starts at 160 candidates");
assert(requestedSiteWindow({ site_window: 480 }) === 480, "site collection window expands on demand");
assert(requestedSiteWindow({ site_window: 9999 }) === 640, "site collection expansion is capped at 640 candidates");
assert(sourceCandidateLimit({ site_window: 480 }) === 480, "source candidate collection follows the expanded site window");
let invalidPriceRangeRejected = false;
try { requestedPriceRange({ min_price: 700000, max_price: 600000 }); } catch { invalidPriceRangeRejected = true; }
assert(invalidPriceRangeRejected, "reversed price range is rejected");
const originalFetch = globalThis.fetch;
let activeImageRequests = 0;
let maxActiveImageRequests = 0;
globalThis.fetch = async (request) => {
  activeImageRequests += 1;
  maxActiveImageRequests = Math.max(maxActiveImageRequests, activeImageRequests);
  await new Promise((resolve) => setTimeout(resolve, 2));
  activeImageRequests -= 1;
  const id = new URL(typeof request === "string" ? request : request.url).pathname.split("/").filter(Boolean).at(-1);
  return new Response('<meta property="og:image" content="https://ccimg.hellomarket.com/item/' + id + '.jpg">', {
    status: 200,
    headers: { "content-type": "text/html" }
  });
};
try {
  const helloMissingImages = Array.from({ length: 12 }, (_, index) => ({
    url: "https://www.hellomarket.com/item/" + (20000 + index),
    image_url: null
  }));
  await enrichHelloImages(helloMissingImages);
  assert(helloMissingImages.every((item) => item.image_url), "all visible Hello Market images are enriched");
  assert(maxActiveImageRequests <= 4, "Hello Market detail image enrichment is concurrency bounded");
} finally {
  globalThis.fetch = originalFetch;
}
assert(parseTimestamp("2026-08-13 22:00:00", 540) === "2026-08-13T13:00:00.000Z", "naive Joongna timestamps are interpreted as Korea time");
assert(Date.now() - Date.parse(parseTimestamp("10개월 전")) > 280 * 86_400_000, "Korean relative month timestamps become comparable dates");
let invalidSortRejected = false;
try { requestedSort({ sort: "signal" }); } catch { invalidSortRejected = true; }
assert(invalidSortRejected, "unsupported sort modes are rejected");
assert(matchesRequestedKeyword({ title: "아이폰 16 프로", search_text: "아이폰" }, "iphone"), "keyword alias relevance");
assert(!matchesRequestedKeyword({ title: "에어팟 프로", search_text: "오디오" }, "iphone"), "irrelevant keyword is rejected");
assert(!matchesRequestedKeyword({ title: "RTX 3080 그래픽카드", search_text: "RTX 5070 인기상품" }, "RTX 5070"), "keyword metadata must not override title relevance");
assert(!matchesRequestedKeyword({ title: "아이폰8 64GB iOS 15.5", search_text: "아이폰 15" }, "아이폰 15"), "numeric model token must stay attached to its product family");
assert(matchesRequestedKeyword({ title: "iPhone 15 128GB 블랙" }, "아이폰 15"), "Korean model query matches the English product family");
assert(!matchesRequestedKeyword({ title: "플스5 피파23 PS5 FIFA23" }, "3PS5"), "3PS5 must not match a normal PS5 title");
assert(matchesRequestedKeyword({ title: "3PS5 게임기" }, "3PS5"), "3PS5 exact title remains searchable");
assert(!matchesRequestedKeyword({ title: "3ps 5호 한복" }, "PS5"), "PS5 must reject embedded clothing term");
assert(matchesRequestedKeyword({ title: "스마트폰 태블릿 상품" }, "mobile"), "english category alias relevance");
assert(matchesRequestedKeyword({ title: "SK하이닉스 DDR4 3200 16GB 2개 (노트북 램)" }, "RAM"), "English RAM query matches Korean RAM listings");
assert(matchesRequestedKeyword({ title: "삼성 DDR4 튜닝 RAM 16GB" }, "램"), "Korean RAM query matches English RAM listings");
assert(!matchesRequestedKeyword({ title: "샤넬 클래식 램스킨 숄더백" }, "RAM"), "RAM query rejects lambskin fashion listings");
assert(!matchesRequestedKeyword({ title: "SM5 테일 램프 판매" }, "RAM"), "RAM query rejects vehicle lamps");
assert(!matchesRequestedKeyword({ title: "슬램덩크 한정판" }, "RAM"), "RAM query rejects Slam Dunk merchandise");
assert(!matchesRequestedKeyword({ title: "글램팜 고데기" }, "RAM"), "RAM query rejects brand-name compounds");
assert(!matchesRequestedKeyword({ title: "미니멀 리얼 램 레더 양가죽 자켓" }, "RAM"), "RAM query rejects lamb-leather fashion listings");
assert(!matchesRequestedKeyword({ title: "오토바이 핸들 바 RAM Mounts 램 마운트" }, "RAM"), "RAM query rejects motorcycle RAM mounts");
assert(filterCategoryItems([{ title: "전투복 상의 남 M-L" }], { category_id: "fashion_men_tops" }).length === 1, "abbreviated gender category match");
assert(filterCategoryItems([{ title: "남성용 브라운색상의 가죽 반지갑" }], { category_id: "fashion_men_tops" }).length === 0, "embedded tops term is rejected");
assert(filterCategoryItems([{ title: "책상" }], { category_id: "books" }).length === 0, "short book alias does not match compound word");
assert(filterCategoryItems([{ title: "책 판매" }], { category_id: "books" }).length === 1, "short book alias matches standalone word");
assert(filterCategoryItems([{ title: "옷걸이" }], { category_id: "fashion" }).length === 0, "short fashion alias does not match compound word");
assert(filterCategoryItems([{ title: "차단봉" }], { category_id: "vehicles" }).length === 0, "short vehicle alias does not match compound word");
assert(filterCategoryItems([{ title: "도서산간지역 배송 제외" }], { category_id: "books" }).length === 0, "book alias does not match shipping compound word");
assert(filterCategoryItems([{ title: "도서 판매" }], { category_id: "books" }).length === 1, "standalone book alias matches");
assert(filterCategoryItems([{ title: "레티켓스튜디오 원피스" }], { category_id: "tickets" }).length === 0, "embedded ticket alias does not match brand name");
assert(filterCategoryItems([{ title: "콘서트 티켓 양도" }], { category_id: "tickets" }).length === 1, "ticket category matches event listing");
assert(filterCategoryItems([{ title: "상품 설명 쿠폰 1만원" }], { category_id: "tickets" }).length === 0, "generic coupon metadata does not match tickets");
assert(filterCategoryItems([{ title: "갤럭시 수젤로 린넨자켓" }], { category_id: "mobile" }).length === 0, "mobile category rejects fashion homonyms");
assert(filterCategoryItems([{ title: "갤럭시 S24 울트라" }], { category_id: "mobile" }).length === 1, "mobile category keeps phone listings");
assert(filterCategoryItems([{ title: "유희왕 No.62 갤럭시아이즈" }], { category_id: "mobile" }).length === 0, "mobile category rejects Galaxy game listings");
assert(filterCategoryItems([{ title: "갤럭시 히어로즈 카드" }], { category_id: "mobile" }).length === 0, "mobile category rejects Galaxy card listings");
assert(filterCategoryItems([{ title: "AirPods Pro 2" }], { category_id: "mobile" }).length === 1, "mobile category keeps English AirPods listings");
assert(filterCategoryItems([{ title: "엔시티위시 유우시 특전 포카 에어팟맥스" }], { category_id: "mobile" }).length === 0, "mobile category rejects AirPods fan merchandise");
assert(filterCategoryItems([{ title: "사탕 롤리팝 미키 키링 에어팟키링" }], { category_id: "mobile" }).length === 0, "mobile category rejects AirPods keyring merchandise");
assert(filterCategoryItems([{ title: "Xcode4로 시작하는 아이폰 프로그래밍" }], { category_id: "mobile" }).length === 0, "mobile category rejects programming text");
assert(isCategoryExcluded("pc", { title: "아이폰/갤럭시 충전가능한 USB/C타입 충전 케이블" }), "pc category rejects mobile charging cable");
assert(filterCategoryItems([{ title: "콘서트 파우치" }], { category_id: "tickets" }).length === 0, "ticket category rejects non-ticket merchandise");
assert(isKeywordCategoryNoise("mobile", { title: "에어팟 프로 케이스 주문제작" }, "airpods"), "mobile keyword rejects accessory-only listing");
assert(!isKeywordCategoryNoise("mobile", { title: "에어팟 프로 케이스 주문제작" }, "에어팟 케이스"), "explicit accessory keyword keeps accessory listing");
assert(isKeywordCategoryNoise("mobile", { title: "AirPods Pro Case" }, "airpods"), "mobile keyword rejects English accessory-only listing");
assert(isCategoryExcluded("tickets", { title: "슬루반 미니 콘서트 블럭" }), "ticket category rejects concert merchandise");
assert(isCategoryExcluded("tickets", { title: "콘서트 및 각종행사 갤럭시 대여" }), "ticket category rejects rental listing");
assert(isCategoryExcluded("appliances", { title: "가디건 - 에어컨 바람막이" }), "appliance category rejects clothing homonym");
assert(isCategoryExcluded("appliances", { title: "BMW 에어컨필터" }), "appliance category rejects vehicle accessory");
assert(isCategoryExcluded("appliances", { title: "에어컨 셔츠 105XL" }), "appliance category rejects clothing term");
assert(filterCategoryItems([{ title: "다이슨 V10 청소기 충전기 포함" }], { category_id: "appliances" }).length === 1, "included appliance accessories do not remove the main appliance");
assert(filterCategoryItems([{ title: "다이슨 에어랩 컴플리트" }], { category_id: "appliances" }).length === 1, "appliance category keeps hair styling appliances");
assert(filterCategoryItems([{ title: "단추 디테일 여성 코트" }], { category_id: "fashion" }).length === 1, "garment detail words do not remove a real fashion listing");
assert(filterCategoryItems([{ title: "화장품 파우치 세트" }], { category_id: "beauty" }).length === 1, "beauty accessories remain valid in the broad beauty category");
assert(isKeywordCategoryNoise("mobile", { title: "최고가 삽니다 아이폰 15" }, "iphone"), "mobile keyword rejects purchase request");
assert(isKeywordCategoryNoise("mobile", { title: "아이폰 공박스 판매" }, "iphone"), "mobile keyword rejects empty box listing");
assert(isKeywordCategoryNoise("mobile", { title: "아이폰15프로 256GB 타이탄 박스" }, "아이폰 15"), "mobile keyword rejects a box-only listing with capacity text");
assert(isKeywordCategoryNoise("mobile", { title: "아이폰15 블랙 128 핸드폰제외 판매" }, "아이폰 15"), "mobile keyword rejects a listing that explicitly excludes the phone");
assert(isKeywordCategoryNoise("mobile", { title: "뎃지 아이폰 15 배터리" }, "아이폰 15"), "mobile keyword rejects a replacement battery");
assert(isKeywordCategoryNoise("mobile", { title: "아이폰 15 pro 카메라" }, "아이폰 15"), "mobile keyword rejects a camera module");
assert(!isKeywordCategoryNoise("mobile", { title: "아이폰 15 128GB 배터리 성능 88%" }, "아이폰 15"), "mobile keyword keeps a phone with battery condition text");
assert(!isKeywordCategoryNoise("mobile", { title: "아이폰15 256GB 본체 풀박스" }, "아이폰 15"), "mobile keyword keeps a full phone bundle");
assert(isKeywordCategoryNoise("mobile", { title: "아이폰 15프로맥스 틸타 풀셋" }, "아이폰 15"), "mobile keyword rejects a camera rig listing");
assert(isKeywordCategoryNoise("tickets", { title: "슬루반 미니 콘서트 블럭" }, "콘서트"), "ticket keyword rejects concert merchandise");
assert(!isKeywordCategoryNoise("tickets", { title: "데이식스 콘서트 티켓 양도" }, "콘서트"), "ticket keyword keeps actual event ticket");
assert(isKeywordCategoryNoise("mobile", { title: "아이폰 맥세이프 보조배터리" }, "iphone"), "mobile keyword rejects phone accessory");
assert(!isKeywordCategoryNoise("mobile", { title: "아이폰 15 본체와 케이스 포함" }, "iphone"), "a bundled case does not hide the actual phone");
assert(isKeywordCategoryNoise("mobile", { title: "아이패드·갤럭시탭 거치대" }, "갤럭시"), "mobile keyword rejects tablet stand");
assert(filterCategoryItems([{ title: "아이폰 15 케이스" }], { category_id: "mobile" }).length === 0, "mobile category rejects phone case even with device rescue term");
assert(filterCategoryItems([{ title: "CFexpress 메모리카드" }], { category_id: "mobile" }).length === 0, "mobile category rejects camera memory card");
assert(filterCategoryItems([{ title: "갤럭시 S24 본체" }], { category_id: "mobile" }).length === 1, "mobile category keeps actual phone with hard accessory rules");
assert(filterCategoryItems([{ title: "3ps 5호 여성 티셔츠" }], { category_id: "games" }).length === 0, "games category rejects embedded PS5 clothing term");
assert(filterCategoryItems([{ title: "PS5 게임기 본체" }], { category_id: "games" }).length === 1, "games category keeps actual PS5 console");
assert(filterCategoryItems([{ title: "PS5 예약특전 포스터" }], { category_id: "games" }).length === 0, "games category rejects poster merchandise");
assert(filterCategoryItems([{ title: "게임기 패턴 양말" }], { category_id: "games" }).length === 0, "games category rejects game-pattern socks");
assert(filterCategoryItems([{ title: "게임 캐릭터 스티커" }], { category_id: "games" }).length === 0, "games category rejects game sticker merchandise");
assert(isCategoryExcluded("games", { title: "최고가매입 플스5" }), "games category rejects purchase request");
assert(filterCategoryItems([{ title: "카메라 미니 메신저 백" }], { category_id: "camera" }).length === 0, "camera category rejects camera bag listing");
assert(filterCategoryItems([{ title: "카메라 바디 및 렌즈" }], { category_id: "camera" }).length === 1, "camera category keeps body and lens listing");
assert(filterCategoryItems([{ title: "카메라 미니어쳐 가챠 피규어" }], { category_id: "camera" }).length === 0, "camera category rejects camera merchandise");
assert(filterCategoryItems([
  { title: "책상거울" },
  { title: "책상용 휴대폰 거치대", search_text: "책상" },
  { title: "탁상용 선풍기", search_text: "책상" }
], { category_id: "furniture" }).length === 0, "furniture category rejects desk-related accessories");
assert(filterCategoryItems([{ title: "원목 책상" }], { category_id: "furniture" }).length === 1, "furniture category keeps actual desk");
assert(filterCategoryItems([{ title: "카카오프렌즈 위클리 플래너", search_text: "책상" }], { category_id: "furniture" }).length === 0, "furniture category rejects stationery noise");
assert(filterCategoryItems([{ title: "카메라 미니 메신저 백" }], { category_ids: ["games", "camera"] }).length === 0, "multi-category filter does not cross-match camera aliases into games");
assert(filterCategoryItems([{ title: "PS5 게임기 본체" }], { category_ids: ["games", "camera"] }).length === 1, "multi-category filter keeps matching games item");
assert(filterCategoryItems([{ title: "PS5 게임기 본체" }], { category_ids: ["camera"] }).length === 0, "keyword category filter rejects a PS5 item from camera");
assert(filterCategoryItems([{ title: "카메라 본체" }], { category_ids: ["furniture"] }).length === 0, "keyword category filter rejects a camera item from furniture");
assert(filterCategoryItems([{ title: "플레이스테이션5 플스5 Ps5 디지털" }], { category_id: "games" }).length === 1, "games category keeps normal PS5 listings");
assert(filterCategoryItems([{ title: "카메라 핸드백" }], { category_id: "camera" }).length === 0, "camera category rejects camera handbag listings");
assert(filterCategoryItems([{ title: "책상 스탠드" }], { category_id: "furniture" }).length === 0, "furniture category rejects desk lamp listings");
assert(filterCategoryItems([{ title: "가구역 F4" }], { category_id: "furniture" }).length === 0, "furniture category rejects seating-zone compound word");
assert(filterCategoryItems([{ title: "카메라타 X" }], { category_id: "camera" }).length === 0, "camera category rejects camera-brand compound word");
assert(filterCategoryItems([{ title: "이케아 싱눔 책상 밑 정리대" }], { category_id: "furniture" }).length === 0, "furniture category rejects under-desk organizer");
assert(filterCategoryItems([{ title: "미니 2단 선반 책상꾸미기" }], { category_id: "furniture" }).length === 0, "furniture category rejects desk decoration shelf");
assert(filterCategoryItems([{ title: "책상 핸드폰 거치대" }], { category_id: "furniture" }).length === 0, "furniture category rejects phone desk stand");
assert(filterCategoryItems([{ title: "테이블 휴지통 책상 화장대" }], { category_id: "furniture" }).length === 0, "furniture category rejects table bin");
assert(filterCategoryItems([{ title: "선반 책상 주방 소품 걸이" }], { category_id: "furniture" }).length === 0, "furniture category rejects small-item hanger");
assert(filterCategoryItems([{ title: "원목 책상 브라켓" }], { category_id: "furniture" }).length === 0, "furniture category rejects desk bracket");
assert(filterCategoryItems([{ title: "가구용 식물 화분" }], { category_id: "furniture" }).length === 0, "furniture category rejects plant listing");
assert(filterCategoryItems([{ title: "게임 아이템 가구 스킨" }], { category_id: "furniture" }).length === 0, "furniture category rejects game item");
assert(isKeywordCategoryNoise("tickets", { title: "콘서트 MD 엽서" }, "콘서트"), "ticket keyword rejects concert merchandise with ticket-like metadata");
assert(filterCategoryItems([{ title: "스트레이키즈 콘서트 입장기프트 풀세트 일괄 양도" }], { category_id: "tickets" }).length === 0, "ticket category rejects entry gift set");
assert(filterCategoryItems([{ title: "콘서트 구매 특전 양도" }], { category_id: "tickets" }).length === 0, "ticket category rejects purchase benefit merchandise");
assert(filterCategoryItems([{ title: "드보르작 콘서트홀 리미티드 에디션" }], { category_id: "tickets" }).length === 0, "ticket category rejects concert-hall edition merchandise");
assert(filterCategoryItems([{ title: "대리 수강신청" }], { category_id: "tickets" }).length === 0, "ticket category rejects proxy course registration");
assert(filterCategoryItems([{ title: "유튜브 프리미엄 계정 공유" }], { category_id: "tickets" }).length === 0, "ticket category rejects streaming account listing");
assert(!isKeywordCategoryNoise("tickets", { title: "콘서트 플로어 F4 5열" }, "콘서트"), "ticket keyword keeps floor-seat listings");
assert(filterCategoryItems([{ title: "여성 귀걸이" }], { category_id: "fashion_women" }).length === 0, "women fashion category rejects jewelry");
assert(filterCategoryItems([{ title: "여성 블라우스" }], { category_id: "fashion_women" }).length === 1, "women fashion category keeps clothing");
assert(filterCategoryItems([{ title: "나이키 에어포스 1 운동화" }], { category_id: "fashion_goods" }).length === 1, "fashion goods category keeps shoes");
assert(filterCategoryItems([{ title: "VERRIS 아이웨어 패션 안경" }], { category_id: "fashion" }).length === 0, "fashion category rejects eyewear");
assert(filterCategoryItems([{ title: "디올 뷰티 까나쥬 메쉬 에코백" }], { category_id: "beauty" }).length === 0, "beauty category rejects fashion bag");
assert(filterCategoryItems([{ title: "무선 충전기 스마트폰 가전" }], { category_id: "appliances" }).length === 0, "appliance category rejects phone charger");
assert(filterCategoryItems([{ title: "게이밍의자 pc방의자 컴퓨터의자" }], { category_id: "pc" }).length === 0, "pc category rejects gaming chair");
assert(filterCategoryItems([{ title: "레고 크리에이터 3in1 카메라" }], { category_id: "camera" }).length === 0, "camera category rejects toy camera");
assert(filterCategoryItems([{ title: "라벤더리스 4인가구 18p 그릇세트" }], { category_id: "furniture" }).length === 0, "furniture category rejects household dish set");
assert(filterCategoryItems([{ title: "전자시계 생활방수" }], { category_id: "living" }).length === 0, "living category rejects living-waterproof homonym");
assert(filterCategoryItems([{ title: "태블릿 사무용 취미용 다용도" }], { category_id: "hobby" }).length === 0, "hobby category rejects tablet listing");
assert(filterCategoryItems([{ title: "자동차 시트 보호대 여행 레저" }], { category_id: "travel" }).length === 0, "travel category rejects vehicle accessory");
assert(filterCategoryItems([{ title: "자동차 악세사리 차량용 공기청정기" }], { category_id: "vehicles" }).length === 0, "vehicle category rejects vehicle accessory");
assert(filterCategoryItems([{ title: "변신로봇세트 오토바이3대 미니로봇" }], { category_id: "motorcycle" }).length === 0, "motorcycle category rejects robot toy");

const payload = buildLivePayload(
  { keyword: "RTX 3070", sites: ["bunjang", "joonggonara"], limit: 3 },
  [
    {
      site: "bunjang",
      supported: true,
      items: [{ id: "b1", site: "bunjang", title: "RTX 3070", price: 300000, currency: "KRW", url: "https://m.bunjang.co.kr/products/1", updated_at: "2026-08-12T10:00:00.000Z" }]
    },
    { site: "joonggonara", supported: true, items: [], error: "HTTP_403" }
  ],
  {
    items: [{ id: "j1", site: "joonggonara", title: "RTX 3070 fallback", price: 280000, currency: "KRW", url: "https://web.joongna.com/product/1", updated_at: "2026-08-12T09:00:00.000Z" }]
  }
);

assert(payload.items.length === 2, "live and fallback items are combined");
assert(payload.sources.find((source) => source.key === "bunjang")?.data_source === "live", "live source is marked");
assert(payload.sources.find((source) => source.key === "joonggonara")?.data_source === "fallback", "fallback source is marked");
assert(payload.quality.data_source === "mixed", "mixed result source is marked");

const staleCachePayload = buildLivePayload(
  { keyword: "airpods", sites: ["rethinkmall"], limit: 3 },
  [{
    site: "rethinkmall",
    supported: true,
    stale_cache: true,
    items: [{ id: "r-stale", site: "rethinkmall", title: "AirPods Pro", price: 120000, currency: "KRW", url: "https://web.rethinkmall.com/product/1" }]
  }],
  { items: [] }
);
assert(staleCachePayload.sources[0]?.data_source === "fallback", "stale source cache is marked as fallback");
assert(staleCachePayload.quality.data_source === "fallback", "stale source cache changes overall quality");
assert(staleCachePayload.sources[0]?.warnings.includes("실시간 조회 실패로 최근 저장 결과를 표시했습니다"), "stale source cache is visible to users");

const suggestedPayload = buildLivePayload(
  { keyword: "RTX 5070", sites: ["rethinkmall"], limit: 2 },
  [{
    site: "rethinkmall",
    supported: true,
    items: [{ id: "r-suggested", site: "rethinkmall", title: "RTX 3070 PC", price: 100000, currency: "KRW", url: "https://web.rethinkmall.com/goods/2", upstream_keyword_fallback: true }]
  }],
  { items: [] }
);
assert(suggestedPayload.sources[0]?.data_source === "suggested", "upstream suggested results are marked");
assert(suggestedPayload.sources[0]?.warnings.includes("원 사이트 추천 검색어 결과를 표시했습니다"), "upstream suggestion is visible to users");

const suggestedOnlyPayload = buildLivePayload(
  { keyword: "airpods", sites: ["rethinkmall"], limit: 2 },
  [{
    site: "rethinkmall",
    supported: true,
    items: [],
    suggested_items: [{ id: "r-related", site: "rethinkmall", title: "블루투스 이어폰", price: 30000, currency: "KRW", url: "https://web.rethinkmall.com/goods/3" }],
    suggested_keyword: "애플 이어폰",
    notice: "UPSTREAM_SUGGESTED_KEYWORD:애플 이어폰"
  }],
  { items: [] }
);
assert(suggestedOnlyPayload.items.length === 0, "suggested-only results are not mixed into exact results");
assert(suggestedOnlyPayload.sources[0]?.data_source === "suggested", "suggested-only source remains visible as suggested");
assert(suggestedOnlyPayload.sources[0]?.warnings.includes("UPSTREAM_SUGGESTED_KEYWORD:애플 이어폰"), "suggested keyword is preserved when related items are separated");

const rateLimitedPayload = buildLivePayload(
  { keyword: "airpods", sites: ["rethinkmall"], limit: 2 },
  [{ site: "rethinkmall", supported: true, items: [], error: "HTTP_429" }],
  { items: [] }
);
assert(rateLimitedPayload.sources[0]?.data_source === "rate_limited", "HTTP 429 is marked as rate limited");
assert(rateLimitedPayload.sources[0]?.warnings.includes("원 사이트 접속 제한으로 검색하지 못했습니다"), "rate limit is visible to users");

const partialPayload = buildLivePayload(
  { keyword: "RTX 3070", sites: ["bunjang", "joonggonara"], limit: 3 },
  [
    {
      site: "bunjang",
      supported: true,
      items: [{ id: "partial-b1", site: "bunjang", title: "RTX 3070", price: 300000, currency: "KRW", url: "https://m.bunjang.co.kr/products/2" }],
      error: "PARTIAL_CATEGORY_FAILURE:1"
    },
    {
      site: "joonggonara",
      supported: true,
      items: [{ id: "partial-j1", site: "joonggonara", title: "RTX 3070", price: 280000, currency: "KRW", url: "https://web.joongna.com/product/2" }]
    }
  ],
  { items: [] }
);
assert(partialPayload.quality.data_source === "mixed", "partial live failure is not reported as fully live");
assert(partialPayload.quality.warnings.some((warning) => warning.includes("PARTIAL_CATEGORY_FAILURE")), "partial live failure is exposed in quality warnings");

const mixedUnavailablePayload = buildLivePayload(
  { keyword: "RTX 3060", sites: ["bunjang", "joonggonara"], limit: 3 },
  [
    {
      site: "bunjang",
      supported: true,
      items: [{ id: "mixed-b1", site: "bunjang", title: "RTX 3060", price: 300000, currency: "KRW", url: "https://m.bunjang.co.kr/products/3" }]
    },
    { site: "joonggonara", supported: true, items: [], error: "" }
  ],
  { items: [] }
);
assert(mixedUnavailablePayload.quality.data_source === "mixed", "live plus unavailable source is not reported as fully live");

const multiCategoryPayload = buildLivePayload(
  { category_ids: ["mobile", "pc"], sites: ["bunjang", "joonggonara"], limit: 4 },
  [
    {
      site: "bunjang",
      supported: true,
      items: [
        { id: "b-mobile", site: "bunjang", category_id: "mobile", title: "mobile", price: 10000, currency: "KRW", url: "https://m.bunjang.co.kr/products/10" },
        { id: "b-pc", site: "bunjang", category_id: "pc", title: "pc", price: 20000, currency: "KRW", url: "https://m.bunjang.co.kr/products/11" }
      ]
    },
    {
      site: "joonggonara",
      supported: true,
      items: [
        { id: "j-mobile", site: "joonggonara", category_id: "mobile", title: "mobile", price: 30000, currency: "KRW", url: "https://web.joongna.com/product/10" },
        { id: "j-pc", site: "joonggonara", category_id: "pc", title: "pc", price: 40000, currency: "KRW", url: "https://web.joongna.com/product/11" }
      ]
    }
  ],
  { items: [] }
);
assert(multiCategoryPayload.category === null, "multiple categories have no singular category");
assert(multiCategoryPayload.categories.map((item) => item.id).join(",") === "mobile,pc", "multiple categories are returned");
assert(new Set(multiCategoryPayload.items.map((item) => item.category_id)).size === 2, "multiple category results keep category identity");

const strictLimitPayload = buildLivePayload(
  { keyword: "phone", sites: ["bunjang", "joonggonara", "hellomarket", "rethinkmall"], limit: 1 },
  ["bunjang", "joonggonara", "hellomarket", "rethinkmall"].map((site, index) => ({
    site,
    supported: true,
    items: [{ id: `limit-${index}`, site, title: "phone", price: 1000, currency: "KRW", url: `https://example.com/${index}` }]
  })),
  { items: [] }
);
assert(strictLimitPayload.items.length === 1, "requested result limit is strict");

const qualitySelectionPayload = buildLivePayload(
  { keyword: "아이폰 15", sites: ["bunjang"], limit: 24, sort: "recent" },
  [{
    site: "bunjang",
    supported: true,
    items: [
      { id: "quality-no-image", site: "bunjang", title: "아이폰 15 정상 매물", price: 700000, currency: "KRW", url: "https://example.com/no-image" },
      { id: "quality-image", site: "bunjang", title: "아이폰 15 정상 매물", price: 710000, currency: "KRW", url: "https://example.com/image", image_url: "https://example.com/image.jpg" },
      { id: "quality-sold", site: "bunjang", title: "판매완료 아이폰 15", price: 690000, currency: "KRW", url: "https://example.com/sold" },
      { id: "quality-buying", site: "bunjang", title: "아이폰 15 최고가 매입합니다", price: 800000, currency: "KRW", url: "https://example.com/buying" },
      { id: "quality-placeholder", site: "bunjang", title: "아이폰 15 가격문의", price: 1, currency: "KRW", url: "https://example.com/placeholder" }
    ]
  }],
  { items: [] }
);
assert(qualitySelectionPayload.items.map((item) => item.id).join(",") === "quality-image,quality-no-image", "hard noise is removed while a missing-image listing stays behind a complete listing");

const priceSortedPayload = buildLivePayload(
  { keyword: "아이폰 15", sites: ["bunjang"], limit: 24, sort: "price_asc" },
  [{
    site: "bunjang",
    supported: true,
    items: [
      { id: "price-high", site: "bunjang", title: "아이폰 15 정상 매물", price: 720000, currency: "KRW", url: "https://example.com/high", image_url: "https://example.com/high.jpg", posted_at: "2026-08-13T09:00:00.000Z" },
      { id: "price-low", site: "bunjang", title: "아이폰 15 정상 매물", price: 610000, currency: "KRW", url: "https://example.com/low", posted_at: "2026-08-12T09:00:00.000Z" }
    ]
  }],
  { items: [] }
);
assert(priceSortedPayload.items.map((item) => item.id).join(",") === "price-low,price-high", "verified lowest price mode sorts qualified listings by price");

const priceDescendingPayload = buildLivePayload(
  { keyword: "아이폰 15", sites: ["bunjang"], limit: 24, sort: "price_desc" },
  [{
    site: "bunjang",
    supported: true,
    items: [
      { id: "price-high", site: "bunjang", title: "아이폰 15 정상 매물", price: 720000, currency: "KRW", url: "https://example.com/high", image_url: "https://example.com/high.jpg" },
      { id: "price-low", site: "bunjang", title: "아이폰 15 정상 매물", price: 610000, currency: "KRW", url: "https://example.com/low" }
    ]
  }],
  { items: [] }
);
assert(priceDescendingPayload.items.map((item) => item.id).join(",") === "price-high,price-low", "highest price mode sorts qualified listings by descending price");

const phonePriceRiskPayload = buildLivePayload(
  { keyword: "아이폰 15", sites: ["bunjang"], limit: 24, sort: "price_asc" },
  [{
    site: "bunjang",
    supported: true,
    items: [230000, 258880, 360000, 500000, 530000, 550000, 580000, 620000, 680000].map((price, index) => ({
      id: `phone-price-${index}`,
      site: "bunjang",
      title: `아이폰 15 정상 매물 ${index}`,
      price,
      currency: "KRW",
      url: `https://example.com/phone-price-${index}`,
      image_url: `https://example.com/phone-price-${index}.jpg`,
      posted_at: new Date().toISOString()
    }))
  }],
  { items: [] }
);
assert(phonePriceRiskPayload.items.find((item) => item.id === "phone-price-0")?.price_suspect, "extreme model-phone bargains require price confirmation");
assert(phonePriceRiskPayload.items[0]?.id === "phone-price-0", "lowest-price mode keeps numeric price primary and marks suspicious bargains");
assert(phonePriceRiskPayload.items.find((item) => item.id === "phone-price-1")?.quality_suspect, "non-round Bunjang phone prices are treated as commercial risk");

const explicitRiskOrderingPayload = buildLivePayload(
  { keyword: "테스트폰", sites: ["joonggonara"], limit: 24, sort: "price_asc" },
  [{
    site: "joonggonara",
    supported: true,
    items: [
      { id: "risk-soft", site: "joonggonara", title: "테스트폰 소프트 확인", price: 1500, currency: "KRW", url: "https://example.com/risk-soft", price_suspect: true },
      { id: "risk-noise", site: "joonggonara", title: "테스트폰 노이즈 확인", price: 2000, currency: "KRW", url: "https://example.com/risk-noise", noise_filtered: true },
      { id: "risk-fraud", site: "joonggonara", title: "테스트폰 위험 확인", price: 3000, currency: "KRW", url: "https://example.com/risk-fraud", fraud_risk: 0.4501 },
      { id: "risk-boundary", site: "joonggonara", title: "테스트폰 경계 정상", price: 4000, currency: "KRW", url: "https://example.com/risk-boundary", fraud_risk: 0.45 },
      { id: "risk-invalid", site: "joonggonara", title: "테스트폰 범위 밖", price: 5000, currency: "KRW", url: "https://example.com/risk-invalid", fraud_risk: 2 },
      { id: "risk-trusted", site: "joonggonara", title: "테스트폰 정상 본체", price: 300000, currency: "KRW", url: "https://example.com/risk-trusted" }
    ].map((item) => ({ ...item, posted_at: new Date().toISOString() }))
  }],
  { items: [] }
);
const explicitRiskOrder = explicitRiskOrderingPayload.items.map((item) => item.id).join(",");
assert(
  explicitRiskOrder === "risk-soft,risk-noise,risk-fraud,risk-boundary,risk-invalid,risk-trusted",
  `lowest-price mode keeps numeric price primary across risk labels: ${explicitRiskOrder}`
);

const daysAgo = (days) => new Date(Date.now() - days * 86_400_000).toISOString();
const sourceFreshnessPayload = buildLivePayload(
  { sites: ["joonggonara", "rethinkmall"], limit: 24, sort: "price_asc" },
  [
    {
      site: "joonggonara",
      supported: true,
      items: [
        { id: "joongna-placeholder", site: "joonggonara", title: "브라운 원피스", price: 111, currency: "KRW", url: "https://example.com/placeholder-111", posted_at: daysAgo(2), image_url: "https://example.com/a.jpg" },
        { id: "joongna-old", site: "joonggonara", title: "여성 트위드 자켓", price: 10000, currency: "KRW", url: "https://example.com/old-fashion", posted_at: daysAgo(60), image_url: "https://example.com/b.jpg" },
        { id: "joongna-fresh", site: "joonggonara", title: "여성 트위드 자켓", price: 20000, currency: "KRW", url: "https://example.com/fresh-fashion", posted_at: daysAgo(3), image_url: "https://example.com/c.jpg" }
      ]
    },
    {
      site: "rethinkmall",
      supported: true,
      items: [
        { id: "rethink-stock", site: "rethinkmall", title: "여성 재고 트위드 자켓", price: 15000, currency: "KRW", url: "https://example.com/rethink-stock", posted_at: daysAgo(300), image_url: "https://example.com/d.jpg" }
      ]
    }
  ],
  { items: [] }
);
assert(!sourceFreshnessPayload.items.some((item) => item.id === "joongna-placeholder"), "Joongna placeholder prices are removed with a source-specific floor");
assert(!sourceFreshnessPayload.items.some((item) => item.id === "joongna-old"), "Joongna stale price listings are removed after 45 days");
assert(sourceFreshnessPayload.items.some((item) => item.id === "joongna-fresh"), "Joongna fresh price listings remain visible");
assert(sourceFreshnessPayload.items.some((item) => item.id === "rethink-stock"), "RethinkMall stock is not removed by C2C age limits");

const recentFreshnessPayload = buildLivePayload(
  { sites: ["joonggonara"], limit: 24, sort: "recent" },
  [{
    site: "joonggonara",
    supported: true,
    items: [
      { id: "recent-old", site: "joonggonara", title: "정상 중고 매물 오래됨", price: 20000, currency: "KRW", url: "https://example.com/recent-old", posted_at: daysAgo(120) },
      { id: "recent-unknown", site: "joonggonara", title: "정상 중고 매물 날짜없음", price: 21000, currency: "KRW", url: "https://example.com/recent-unknown", posted_at: null },
      { id: "recent-fresh", site: "joonggonara", title: "정상 중고 매물 최신", price: 22000, currency: "KRW", url: "https://example.com/recent-fresh", posted_at: daysAgo(2) }
    ]
  }],
  { items: [] }
);
assert(!recentFreshnessPayload.items.some((item) => item.id === "recent-old"), "recent mode still removes listings beyond the source freshness window");
assert(recentFreshnessPayload.items[0]?.id === "recent-fresh", "recent mode uses time as the primary ordering key");
assert(recentFreshnessPayload.items.find((item) => item.id === "recent-unknown")?.quality_suspect, "missing C2C timestamps are shown with a quality warning");

const multiCategoryPricingPayload = buildLivePayload(
  { category_ids: ["mobile", "fashion"], sites: ["joonggonara"], limit: 24, sort: "price_asc" },
  [{
    site: "joonggonara",
    supported: true,
    items: [
      ...Array.from({ length: 8 }, (_, index) => ({ id: "fashion-price-" + index, site: "joonggonara", category_id: "fashion", title: "여성 코트 " + index, price: 10000 + index * 1000, currency: "KRW", url: "https://example.com/fashion-" + index })),
      ...Array.from({ length: 8 }, (_, index) => ({ id: "mobile-price-" + index, site: "joonggonara", category_id: "mobile", title: "아이폰 15 " + index, price: 500000 + index * 10000, currency: "KRW", url: "https://example.com/mobile-" + index }))
    ]
  }],
  { items: [] }
);
assert(!multiCategoryPricingPayload.items.find((item) => item.id === "fashion-price-0")?.price_suspect, "multi-category price suspicion uses each category's own market sample");

const intentPayload = buildLivePayload(
  { category_id: "fashion", sites: ["joonggonara"], limit: 24, sort: "recommended" },
  [{
    site: "joonggonara",
    supported: true,
    items: [
      { id: "purchase-parentheses", site: "joonggonara", title: "(삽니다) 아이앱 스튜디오 자켓 구합니다", price: 20000, currency: "KRW", url: "https://example.com/purchase", posted_at: daysAgo(1) },
      { id: "purchase-label", site: "joonggonara", title: "[구매글] 여성 자켓 구매합니다", price: 20000, currency: "KRW", url: "https://example.com/purchase-label", posted_at: daysAgo(1) },
      { id: "exchange-person", site: "joonggonara", title: "마우스 교환하실분", price: 20000, currency: "KRW", url: "https://example.com/exchange", posted_at: daysAgo(1) },
      { id: "exchange-ending", site: "joonggonara", title: "닌텐도 스위치 슈퍼마리오 파티 교환", price: 20000, currency: "KRW", url: "https://example.com/exchange-ending", posted_at: daysAgo(1) },
      { id: "sale-exchange-possible", site: "joonggonara", title: "여성 자켓 판매, 다른 색상 교환 가능", price: 20000, currency: "KRW", url: "https://example.com/sale", posted_at: daysAgo(1) }
    ]
  }],
  { items: [] }
);
assert(!intentPayload.items.some((item) => item.id === "purchase-parentheses"), "parenthesized purchase requests are removed");
assert(!intentPayload.items.some((item) => item.id === "purchase-label"), "labeled purchase posts are removed");
assert(!intentPayload.items.some((item) => item.id === "exchange-person"), "explicit exchange-only requests are removed");
assert(!intentPayload.items.some((item) => item.id === "exchange-ending"), "titles ending in exchange intent are removed");
assert(intentPayload.items.some((item) => item.id === "sale-exchange-possible"), "sale listings that merely allow exchange are not over-filtered");

const recommendedPayload = buildLivePayload(
  { keyword: "아이폰 15", sites: ["bunjang", "hellomarket"], limit: 24, sort: "recommended" },
  [
    {
      site: "bunjang",
      supported: true,
      items: Array.from({ length: 20 }, (_, index) => ({
        id: `recommend-b-${index}`,
        site: "bunjang",
        title: `아이폰 15 정상 매물 ${index}`,
        price: 500000 + index * 1000,
        currency: "KRW",
        url: `https://example.com/recommend-b-${index}`,
        image_url: `https://example.com/recommend-b-${index}.jpg`,
        seller_name: `seller-${index}`,
        posted_at: daysAgo(index / 24)
      }))
    },
    {
      site: "hellomarket",
      supported: true,
      items: Array.from({ length: 4 }, (_, index) => ({
        id: `recommend-h-${index}`,
        site: "hellomarket",
        title: `아이폰 15 추천 매물 ${index}`,
        price: 550000 + index * 1000,
        currency: "KRW",
        url: `https://example.com/recommend-h-${index}`,
        image_url: `https://example.com/recommend-h-${index}.jpg`,
        posted_at: daysAgo(1 + index / 24)
      }))
    }
  ],
  { items: [] }
);
assert(recommendedPayload.items.filter((item) => item.site === "hellomarket").length === 4, "recommended mode preserves good candidates from a smaller source");
assert(recommendedPayload.items.slice(0, 16).some((item) => item.site === "hellomarket"), "recommended mode prevents one source from monopolizing the first screen");

const applianceAccessoryPayload = buildLivePayload(
  { keyword: "다이슨 V10", category_id: "appliances", sites: ["hellomarket"], limit: 24, sort: "price_asc" },
  [{
    site: "hellomarket",
    supported: true,
    items: [
      { id: "vacuum-battery", site: "hellomarket", title: "다이슨 V10 대용량 배터리", price: 40000, currency: "KRW", url: "https://example.com/battery" },
      { id: "vacuum-body", site: "hellomarket", title: "다이슨 V10 무선청소기 본체", price: 150000, currency: "KRW", url: "https://example.com/body" }
    ]
  }],
  { items: [] }
);
assert(applianceAccessoryPayload.items.length === 1 && applianceAccessoryPayload.items[0]?.id === "vacuum-body", "whole-appliance searches remove clear accessory-only listings");

const consoleAccessoryPayload = buildLivePayload(
  { keyword: "닌텐도 스위치", category_id: "games", sites: ["joonggonara"], limit: 24, sort: "price_asc" },
  [{
    site: "joonggonara",
    supported: true,
    items: [
      { id: "switch-card-case", site: "joonggonara", title: "닌텐도 스위치 게임 카드 정리함", price: 7000, currency: "KRW", url: "https://example.com/card-case" },
      { id: "switch-oled-pen", site: "joonggonara", title: "닌텐도 스위치 OLED 터치펜 키링", price: 45000, currency: "KRW", url: "https://example.com/oled-pen" },
      { id: "switch-console", site: "joonggonara", title: "닌텐도 스위치 배터리개선 본체 풀박스", price: 180000, currency: "KRW", url: "https://example.com/console" }
    ]
  }],
  { items: [] }
);
assert(consoleAccessoryPayload.items.length === 1 && consoleAccessoryPayload.items[0]?.id === "switch-console", "whole-console searches remove clear games and accessories");
assert(consoleAccessoryPayload.quality.selection.dropped.accessory_only === 2, "console accessory removals are audited");

const macbookAccessoryPayload = buildLivePayload(
  { keyword: "맥북 에어 M2", category_id: "pc", sites: ["bunjang"], limit: 24, sort: "price_asc" },
  [{
    site: "bunjang",
    supported: true,
    items: [
      { id: "mac-case", site: "bunjang", title: "맥북 에어 M2 투명 하드케이스", price: 5000, currency: "KRW", url: "https://example.com/mac-case" },
      { id: "mac-body", site: "bunjang", title: "맥북 에어 M2 13인치 본체", price: 700000, currency: "KRW", url: "https://example.com/mac-body" }
    ]
  }],
  { items: [] }
);
assert(macbookAccessoryPayload.items.length === 1 && macbookAccessoryPayload.items[0]?.id === "mac-body", "whole-laptop searches remove clear case-only listings");

const phoneNoisePayload = buildLivePayload(
  { keyword: "아이폰 15", sites: ["joonggonara"], limit: 24, sort: "price_asc" },
  [{
    site: "joonggonara",
    supported: true,
    items: [
      { id: "phone-case", site: "joonggonara", title: "아이폰 15 맥세이프 케이스", price: 5000, currency: "KRW", url: "https://example.com/phone-case" },
      { id: "phone-wanted", site: "joonggonara", title: "아이폰 최고가 삽니다", price: 10000, currency: "KRW", url: "https://example.com/phone-wanted" },
      { id: "phone-exchange", site: "joonggonara", title: "아이폰 15프로 교신봅니다", price: 500, currency: "KRW", url: "https://example.com/phone-exchange" },
      { id: "phone-box", site: "joonggonara", title: "아이폰15프로 256GB 타이탄 박스", price: 3000, currency: "KRW", url: "https://example.com/phone-box" },
      { id: "phone-battery", site: "joonggonara", title: "뎃지 아이폰 15 배터리", price: 37000, currency: "KRW", url: "https://example.com/phone-battery" },
      { id: "phone-camera", site: "joonggonara", title: "아이폰 15 pro 카메라", price: 40000, currency: "KRW", url: "https://example.com/phone-camera" },
      { id: "phone-charger", site: "joonggonara", title: "아이폰 15 벨킨 차저", price: 55000, currency: "KRW", url: "https://example.com/phone-charger" },
      { id: "phone-ad", site: "joonggonara", title: "아이폰15 재고정리 선착순특가 판매합니다", price: 98790, currency: "KRW", url: "https://example.com/phone-ad" },
      { id: "phone-mismatch", site: "joonggonara", title: "아이폰 12미니 64GB", price: 180000, currency: "KRW", url: "https://example.com/phone-mismatch", source_keyword_ranked: true },
      { id: "phone-body", site: "joonggonara", title: "아이폰 15 128GB 본체", price: 550000, currency: "KRW", url: "https://example.com/phone-body" },
      { id: "phone-condition", site: "joonggonara", title: "아이폰 15 128GB 배터리 성능 88%", price: 480000, currency: "KRW", url: "https://example.com/phone-condition" },
      { id: "phone-fullbox", site: "joonggonara", title: "아이폰15 256GB 본체 풀박스", price: 650000, currency: "KRW", url: "https://example.com/phone-fullbox" }
    ]
  }],
  { items: [] }
);
assert(JSON.stringify(phoneNoisePayload.items.map((item) => item.id)) === JSON.stringify(["phone-condition", "phone-body", "phone-fullbox"]), "phone searches remove requests, parts, ads and model mismatches while keeping devices");
assert(phoneNoisePayload.quality.selection.dropped.accessory_only === 5, "phone accessory removals are audited");

const practicalAccessoryPayload = buildLivePayload(
  { keyword: "닌텐도 스위치", category_id: "games", sites: ["bunjang", "joonggonara"], limit: 24, sort: "price_asc" },
  [{ site: "bunjang", supported: true, items: [
    { id: "switch-request", site: "bunjang", title: "닌텐도 스위치 나눔 해주실 분", price: 500, currency: "KRW", url: "https://example.com/switch-request" },
    { id: "switch-game", site: "joonggonara", title: "닌텐도 스위치 nba2k22", price: 10500, currency: "KRW", url: "https://example.com/switch-game" },
    { id: "switch-lite", site: "bunjang", title: "닌텐도 스위치 라이트 본체", price: 90000, currency: "KRW", url: "https://example.com/switch-lite" }
  ] }],
  { items: [] }
);
assert(practicalAccessoryPayload.items.length === 1 && practicalAccessoryPayload.items[0]?.id === "switch-lite", "console search removes low-price requests and game-only rows but keeps hardware");

const applianceBundlePayload = buildLivePayload(
  { keyword: "다이슨 V10", category_id: "appliances", sites: ["bunjang"], limit: 24, sort: "price_asc" },
  [{
    site: "bunjang",
    supported: true,
    items: [{ id: "vacuum-bundle", site: "bunjang", title: "다이슨 V10 청소기 충전기 포함", price: 180000, currency: "KRW", url: "https://example.com/vacuum-bundle" }]
  }],
  { items: [] }
);
assert(applianceBundlePayload.items[0]?.id === "vacuum-bundle", "an appliance bundle remains when the accessory is explicitly included");

const applianceToolPayload = buildLivePayload(
  { keyword: "다이슨 V10", category_id: "appliances", sites: ["bunjang"], limit: 24, sort: "recent" },
  [{ site: "bunjang", supported: true, items: [
    { id: "vacuum-tool", site: "bunjang", title: "다이슨 V10 무선 진공청소기용 청소툴보관함(청소툴 포함)", price: 20000, currency: "KRW", url: "https://example.com/vacuum-tool" },
    { id: "vacuum-accessory", site: "bunjang", title: "무선청소기v10 악세서리 다이슨", price: 11000, currency: "KRW", url: "https://example.com/vacuum-accessory" },
    { id: "vacuum-cleaner", site: "bunjang", title: "다이슨 V10 무선청소기 본체", price: 170000, currency: "KRW", url: "https://example.com/vacuum-cleaner" }
  ] }],
  { items: [] }
);
assert(applianceToolPayload.items.length === 1 && applianceToolPayload.items[0]?.id === "vacuum-cleaner", "appliance search removes a tool holder even when its own tools are included");

const repostPayload = buildLivePayload(
  { keyword: "다이슨 V10", category_id: "appliances", sites: ["bunjang"], limit: 24, sort: "price_asc" },
  [{
    site: "bunjang",
    supported: true,
    items: [
      { id: "repost-a", site: "bunjang", title: "깨끗하게 세척한 다이슨 무선 청소기 V10 풀세트", price: 155000, currency: "KRW", url: "https://example.com/repost-a" },
      { id: "repost-b", site: "bunjang", title: "깨끗하게 세척한 다이슨 무선 청소기 V10 풀세트", price: 155000, currency: "KRW", url: "https://example.com/repost-b" }
    ]
  }],
  { items: [] }
);
assert(repostPayload.items.length === 1 && repostPayload.quality.selection.dropped.duplicate === 1, "long exact-title reposts at the same price are collapsed");

const recentSortedPayload = buildLivePayload(
  { keyword: "아이폰 15", sites: ["bunjang"], limit: 24, sort: "recent" },
  [{
    site: "bunjang",
    supported: true,
    items: [
      { id: "recent-old", site: "bunjang", title: "아이폰 15 정상 매물", price: 500000, currency: "KRW", url: "https://example.com/old", posted_at: "2026-08-11T09:00:00.000Z" },
      { id: "recent-new", site: "bunjang", title: "아이폰 15 정상 매물", price: 700000, currency: "KRW", url: "https://example.com/new", posted_at: "2026-08-13T09:00:00.000Z" }
    ]
  }],
  { items: [] }
);
assert(recentSortedPayload.items.map((item) => item.id).join(",") === "recent-new,recent-old", "recent mode sorts qualified listings by posted time");

const pagedItems = Array.from({ length: 60 }, (_, index) => ({
  id: `page-${index}`,
  site: index % 2 === 0 ? "bunjang" : "joonggonara",
  title: `phone listing ${index}`,
  price: 100000 + index,
  currency: "KRW",
  url: `https://example.com/page-${index}`,
  image_url: `https://example.com/page-${index}.jpg`
}));
const firstPagePayload = buildLivePayload(
  { keyword: "phone", sites: ["bunjang", "joonggonara"], limit: 24 },
  [
    { site: "bunjang", supported: true, items: pagedItems.filter((item) => item.site === "bunjang") },
    { site: "joonggonara", supported: true, items: pagedItems.filter((item) => item.site === "joonggonara") }
  ],
  { items: [] }
);
assert(firstPagePayload.items.length === 24, "first page contains 24 listings");
assert(firstPagePayload.quality.available_count === 60, "search session exposes at most 60 listings");
assert(firstPagePayload.pagination.has_more && firstPagePayload.pagination.next_cursor, "first page exposes a continuation cursor");
const secondPagePayload = buildLivePayload(
  { keyword: "phone", sites: ["bunjang", "joonggonara"], limit: 12, cursor: firstPagePayload.pagination.next_cursor },
  [
    { site: "bunjang", supported: true, items: pagedItems.filter((item) => item.site === "bunjang") },
    { site: "joonggonara", supported: true, items: pagedItems.filter((item) => item.site === "joonggonara") }
  ],
  { items: [] }
);
assert(secondPagePayload.items.length === 12, "continuation page contains 12 listings");
assert(!secondPagePayload.items.some((item) => firstPagePayload.items.some((firstItem) => firstItem.id === item.id)), "continuation page does not repeat the first page");
let mismatchedCursorRejected = false;
try {
  buildLivePayload(
    { keyword: "phone", sites: ["bunjang", "joonggonara"], limit: 12, min_price: 300000, cursor: firstPagePayload.pagination.next_cursor },
    [
      { site: "bunjang", supported: true, items: pagedItems.filter((item) => item.site === "bunjang") },
      { site: "joonggonara", supported: true, items: pagedItems.filter((item) => item.site === "joonggonara") }
    ],
    { items: [] }
  );
} catch {
  mismatchedCursorRejected = true;
}
assert(mismatchedCursorRejected, "continuation cursor is bound to the active price and search filters");

const priceRangePayload = buildLivePayload(
  { keyword: "phone", sites: ["bunjang"], limit: 24, min_price: 300000, max_price: 600000 },
  [{
    site: "bunjang",
    supported: true,
    items: [
      { id: "below-range", site: "bunjang", title: "phone listing low", price: 200000, currency: "KRW", url: "https://example.com/below-range" },
      { id: "in-range", site: "bunjang", title: "phone listing valid", price: 450000, currency: "KRW", url: "https://example.com/in-range" },
      { id: "above-range", site: "bunjang", title: "phone listing high", price: 700000, currency: "KRW", url: "https://example.com/above-range" }
    ]
  }],
  { items: [] }
);
assert(priceRangePayload.items.map((item) => item.id).join(",") === "in-range", "price range is enforced before results are exposed");
assert(priceRangePayload.quality.price_range.min === 300000 && priceRangePayload.quality.price_range.max === 600000, "applied price range is exposed in quality metadata");
assert(priceRangePayload.quality.selection.dropped.price_range === 2, "price-range removals are audited");

const unavailablePayload = buildLivePayload(
  { keyword: "missing", sites: ["bunjang"], limit: 4 },
  [{ site: "bunjang", supported: true, items: [], error: "NO_LIVE_RESULTS" }],
  { items: [] }
);
assert(unavailablePayload.quality.data_source === "unavailable", "empty live results are marked unavailable");

const siteWindowItems = ["bunjang", "joonggonara"].flatMap((site) => Array.from({ length: 50 }, (_, index) => ({
  id: `${site}-window-${index}`,
  site,
  title: `phone ${site} listing ${index}`,
  price: 200000 + index,
  currency: "KRW",
  url: `https://example.com/${site}-window-${index}`,
  posted_at: "2026-08-13T09:00:00.000Z"
})));
const perSiteWindowPayload = buildLivePayload(
  { keyword: "phone", sites: ["bunjang", "joonggonara"], limit: 16, site_window: 40 },
  [
    { site: "bunjang", supported: true, items: siteWindowItems.filter((item) => item.site === "bunjang") },
    { site: "joonggonara", supported: true, items: siteWindowItems.filter((item) => item.site === "joonggonara") }
  ],
  { items: [] }
);
assert(perSiteWindowPayload.quality.available_count === 80, "site window keeps 40 qualified listings per source");
assert(perSiteWindowPayload.sources.every((source) => source.total_count === 40), "source summaries expose the per-site 40 target");
assert(perSiteWindowPayload.items.length === 16 && perSiteWindowPayload.pagination.has_more, "page size stays separate from the per-site search window");

console.log(JSON.stringify({ status: "passed", checks: 143 }, null, 2));

function assert(condition, label) {
  if (!condition) throw new Error(`Live search harness failed: ${label}`);
}
