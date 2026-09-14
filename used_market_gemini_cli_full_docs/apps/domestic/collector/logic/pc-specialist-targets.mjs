export const PC_PART_CATEGORY_CODES = Object.freeze([
  "GPU", "CPU", "RAM", "MOTHERBOARD", "SSD", "HDD", "PSU", "COOLING", "CASE", "EXPANSION_CARD", "ODD"
]);

export const DANAWA_PC_CATEGORY_TARGETS = Object.freeze({
  CPU: Object.freeze([{ parent_category_code: 1, child_category_code: 1 }]),
  RAM: Object.freeze([{ parent_category_code: 1, child_category_code: 2 }]),
  MOTHERBOARD: Object.freeze([{ parent_category_code: 1, child_category_code: 3 }]),
  GPU: Object.freeze([{ parent_category_code: 1, child_category_code: 4 }]),
  HDD: Object.freeze([{ parent_category_code: 1, child_category_code: 5 }]),
  SSD: Object.freeze([{ parent_category_code: 1, child_category_code: 6 }]),
  ODD: Object.freeze([{ parent_category_code: 1, child_category_code: 7 }]),
  CASE: Object.freeze([{ parent_category_code: 1, child_category_code: 8 }]),
  PSU: Object.freeze([{ parent_category_code: 1, child_category_code: 9 }]),
  COOLING: Object.freeze([{ parent_category_code: 5, child_category_code: 2 }]),
  EXPANSION_CARD: Object.freeze([
    { parent_category_code: 5, child_category_code: 3 },
    { parent_category_code: 5, child_category_code: 4 },
    { parent_category_code: 5, child_category_code: 5 },
    { parent_category_code: 5, child_category_code: 6 },
    { parent_category_code: 5, child_category_code: 7 }
  ])
});

export const EBAY_PC_CATEGORY_TARGETS = Object.freeze({
  GPU: Object.freeze({ category_ids: Object.freeze(["27386"]), query: "graphics video card GPU" }),
  CPU: Object.freeze({ category_ids: Object.freeze(["164"]), query: "desktop processor CPU" }),
  RAM: Object.freeze({ category_ids: Object.freeze(["170083"]), query: "DDR desktop memory RAM" }),
  MOTHERBOARD: Object.freeze({ category_ids: Object.freeze(["1244"]), query: "desktop motherboard" }),
  SSD: Object.freeze({ category_ids: Object.freeze(["175669"]), query: "internal solid state drive SSD" }),
  HDD: Object.freeze({ category_ids: Object.freeze(["56083"]), query: "internal hard disk drive HDD" }),
  PSU: Object.freeze({ category_ids: Object.freeze(["42017"]), query: "computer power supply PSU" }),
  COOLING: Object.freeze({ category_ids: Object.freeze(["131486"]), query: "CPU cooler" }),
  CASE: Object.freeze({ category_ids: Object.freeze(["42014"]), query: "desktop computer case chassis" }),
  EXPANSION_CARD: Object.freeze({ category_ids: Object.freeze(["90718"]), query: "PCIe expansion card" }),
  ODD: Object.freeze({ category_ids: Object.freeze(["131542"]), query: "internal optical DVD Blu-ray drive" })
});

export function danawaTargetsForCategory(categoryCode) {
  return DANAWA_PC_CATEGORY_TARGETS[String(categoryCode || "").trim().toUpperCase()] || Object.freeze([]);
}

export function assertDanawaPcCategoryCoverage() {
  const missing = PC_PART_CATEGORY_CODES.filter((categoryCode) => danawaTargetsForCategory(categoryCode).length === 0);
  if (missing.length > 0) throw new Error(`DANAWA_PC_CATEGORY_TARGET_MISSING:${missing.join(",")}`);
  return true;
}

export function ebayTargetForCategory(categoryCode) {
  return EBAY_PC_CATEGORY_TARGETS[String(categoryCode || "").trim().toUpperCase()] || null;
}

export function assertEbayPcCategoryCoverage() {
  const missing = PC_PART_CATEGORY_CODES.filter((categoryCode) => !ebayTargetForCategory(categoryCode));
  if (missing.length > 0) throw new Error(`EBAY_PC_CATEGORY_TARGET_MISSING:${missing.join(",")}`);
  return true;
}

export function pcCategoryTitleMatches(categoryCode, value) {
  const text = String(value || "").normalize("NFKC");
  const category = String(categoryCode || "").trim().toUpperCase();
  const forbidden = {
    SSD: /(?:(?:heatsink|heat\s*sink|히트\s*싱크|방열판|케이블|cable).{0,16}(?:only|만)|(?:only|만).{0,16}(?:heatsink|heat\s*sink|히트\s*싱크|방열판|케이블|cable)|외장\s*(?:케이스|인클로저)|외장.{0,8}(?:SSD|HDD|NVMe|M\.2).{0,8}(?:케이스|인클로저)|external\s*(?:case|enclosure))/iu,
    HDD: /(?:외장\s*(?:케이스|인클로저)|외장.{0,8}(?:HDD|하드\s*디스크).{0,8}(?:케이스|인클로저|도킹\s*스테이션)|(?:HDD|하드\s*디스크).{0,8}외장.{0,8}(?:케이스|인클로저|도킹\s*스테이션)|external\s*(?:case|enclosure)|도킹\s*스테이션|dock(?:ing)?\s*station|케이블|cable).{0,16}(?:only|만)?/iu,
    PSU: /(?:server\s*power\s*supply|서버\s*(?:용\s*)?파워|파워\s*(?:서플라이)?\s*케이블|PSU\s*cable|power\s*supply\s*cable|케이블\s*(?:only|만)|cable\s*only)/iu
  };
  if (forbidden[category]?.test(text)) {
    const describedPsuCableState = category === "PSU"
      && /\d{3,4}\s*W\b/iu.test(text)
      && /케이블.{0,10}(?:포함|미포함|없음|누락|완비|있음)|(?:포함|미포함|없음|누락|완비|있음).{0,10}케이블/iu.test(text);
    if (!describedPsuCableState) return false;
  }
  const rules = {
    GPU: /(?:\b(?:RTX|GTX)\s*\d{3,4}\b|\bRX\s*\d{3,4}(?:\s*XT[X]?)?\b|\b(?:GeForce|Radeon|GPU)\b|graphics?\s*(?:video\s*)?card|그래픽\s*카드)/iu,
    CPU: /(?:\bRyzen\s*[3579]?\s*\d{4,5}[A-Z0-9]*\b|\bCore\s*(?:Ultra\s*)?[3579]?[- ]?\d{4,5}[A-Z0-9]*\b|\bi[3579][ -]?\d{4,5}[A-Z0-9]*\b|\bCPU\b|processor|프로세서|시피유)/iu,
    RAM: /(?:\bDDR[345]\b|\b(?:SO|U|R)?DIMM\b|\bPC[345]-?\d{4,5}\b|(?:memory|메모리).{0,24}\d+\s*(?:GB|기가)|\d+\s*(?:GB|기가).{0,24}(?:RAM|램|memory|메모리))/iu,
    MOTHERBOARD: /(?:mother\s*board|main\s*board|메인\s*보드|\b[ABHXZ]\d{3}[A-Z0-9-]*\b)/iu,
    SSD: /(?:\bSSD\b|solid\s*state\s*drive|\bNVMe\b|\b(?:PM|SM)\d[A-Z0-9-]+\b|\b(?:8[67]0|9(?:70|80|90))\s*(?:EVO(?:\s*PLUS)?|QVO|PRO)\b|(?:Samsung|삼성).{0,20}\b(?:870|980)\b|(?:SK\s*hynix|하이닉스).{0,20}\bP(?:31|41)\b|\bSN\d{3,4}X?\b)/iu,
    HDD: /(?:\bHDD\b|hard\s*(?:disk|disc)\s*drive|하드\s*디스크|(?:\bWD\b|Western\s*Digital)\s*(?:Blue|Black|Red(?:\s*Plus)?|Purple|Gold)\b|\b(?:IronWolf|Barracuda|Exos|Ultrastar|ST[A-Z0-9]{8,}|N300|X300)\b|아이언울프|바라쿠다)/iu,
    PSU: /(?:\bPSU\b|power\s*supply|파워\s*(?:서플라이)?|\b80\s*PLUS\b|\b(?:RM|HX|AX|TX|CX|CV|SF)\d{3,4}(?:X|I|M)?\b|\bGX[- ]?\d{3,4}\b|(?:Classic\s*II|클래식\s*2|HYDRO\s*PRO|하이드로\s*프로|LEADEX|리덱스).{0,20}\d{3,4}\s*W?\b)/iu,
    COOLING: /(?:CPU\s*(?:cooler|fan)|\bAIO\b|water\s*cooling|heat\s*sink|case\s*fan|쿨러|수(?:냉|랭)|공랭|쿨링\s*팬)/iu,
    CASE: /(?:computer\s*case|PC\s*case|desktop\s*case|chassis|컴퓨터\s*케이스|PC\s*케이스|케이스)/iu,
    EXPANSION_CARD: /(?:PCIe?[- ]?(?:x\d+\s*)?(?:network|sound|capture|USB|M\.2|RAID|HBA)?\s*card|network\s*card|sound\s*card|capture\s*card|RAID\s*controller|\bHBA\b|랜\s*카드|사운드\s*카드|캡처\s*(?:카드|보드)|확장\s*카드)/iu,
    ODD: /(?:optical\s*drive|\b(?:CD|DVD|Blu-?ray|BDXL)\s*(?:ROM|writer|drive)\b|(?:external|internal|USB|SATA|외장|내장)\s*ODD\b|\bODD\s*(?:drive|writer|드라이브)\b|블루레이\s*드라이브)/iu
  };
  return Boolean(rules[category]?.test(text));
}

function conflictingPcCategory(requestedCategory, text) {
  return PC_PART_CATEGORY_CODES.find((candidate) => candidate !== requestedCategory && pcCategoryTitleMatches(candidate, text)) || null;
}

export function trustedSpecialistCategory(item) {
  const site = String(item?.site || "").trim().toLowerCase();
  const categoryCode = String(item?.requested_category_code || "").trim().toUpperCase();
  const sourceCategoryCode = String(item?.source_category_code || "").trim();
  if (!PC_PART_CATEGORY_CODES.includes(categoryCode) || !sourceCategoryCode) return null;
  const text = `${item?.title || ""} ${item?.description || ""}`;
  if (site === "ebay") {
    const target = ebayTargetForCategory(categoryCode);
    if (!target?.category_ids.includes(sourceCategoryCode) || !pcCategoryTitleMatches(categoryCode, text)) return null;
    return categoryCode;
  }
  if (site !== "danawa") return null;
  const matched = danawaTargetsForCategory(categoryCode).some((target) => (
    `${target.parent_category_code}:${target.child_category_code}` === sourceCategoryCode
  ));
  if (!matched) return null;
  if (!pcCategoryTitleMatches(categoryCode, text) && conflictingPcCategory(categoryCode, text)) return null;
  if (categoryCode === "EXPANSION_CARD") {
    if (!/(?:pci(?:e|-e)?\s*(?:랜|lan|network|sound|사운드|capture|캡처|캡쳐|usb|m\.2)|랜\s*카드|network\s*card|nic\b|사운드\s*카드|sound\s*card|캡처\s*카드|캡쳐\s*(?:카드|보드)|capture\s*card|raid\s*(?:카드|controller)|hba\b|sas\s*(?:카드|controller)|m\.2\s*확장|usb\s*확장|thunderbolt|썬더볼트)/iu.test(text)) return null;
  }
  return categoryCode;
}
