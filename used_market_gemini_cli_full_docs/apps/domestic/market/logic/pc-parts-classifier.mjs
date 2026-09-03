import { explicitSoldText } from "./listing-lifecycle.mjs";

const CONDITION_EXCLUSIONS = Object.freeze({
  BROKEN: 'BROKEN',
  MINED: 'MINED',
  UNTESTED: 'UNTESTED',
  NEW: 'NOT_USED_WORKING',
  REFURBISHED: 'REFURBISHED_POOL_ONLY'
});

function normalizedText(input) {
  return [input?.title, input?.description]
    .filter((value) => typeof value === 'string' && value.trim())
    .join(' ')
    .normalize('NFKC')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizedTitle(input) {
  return typeof input?.title === 'string'
    ? input.title.normalize('NFKC').replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
    : '';
}

function firstMatch(text, pattern) {
  const match = text.match(pattern);
  return match ? { match, matchedText: match[0] } : null;
}

function addEvidence(evidence, field, matchedText, value) {
  if (!matchedText) return;
  evidence.push({ field, value, source: 'combined_text', matched_text: matchedText });
}

function detectCondition(text, evidence) {
  const broken = firstMatch(text, /고장품?|부품용|화면\s*깨짐|파손|불량|작동\s*안[\s됨돼]|for\s+parts|not\s+working/i);
  if (broken) {
    addEvidence(evidence, 'condition', broken.matchedText, 'BROKEN');
    return 'BROKEN';
  }
  const mined = firstMatch(text, /채굴(?:품|용|\s*사용)?|마이닝/i);
  if (mined) {
    addEvidence(evidence, 'condition', mined.matchedText, 'MINED');
    return 'MINED';
  }
  const untested = firstMatch(text, /미테스트|테스트\s*(?:못|안)\s*(?:함|했|됨)|작동\s*미확인|condition\s*unknown/i);
  if (untested) {
    addEvidence(evidence, 'condition', untested.matchedText, 'UNTESTED');
    return 'UNTESTED';
  }
  const refurbished = firstMatch(text, /리퍼비시|리퍼브|(?:^|\s)리퍼(?:\s|$)|\brefurb(?:ished)?\b|전시품|반품\s*상품/i);
  if (refurbished) {
    addEvidence(evidence, 'condition', refurbished.matchedText, 'REFURBISHED');
    return 'REFURBISHED';
  }
  const unused = firstMatch(text, /미개봉|단순\s*개봉|새\s*상품|새\s*제품|새거|신품|미사용|\bnew\b|open\s+box/i);
  if (unused) {
    addEvidence(evidence, 'condition', unused.matchedText, 'NEW');
    return 'NEW';
  }
  addEvidence(evidence, 'condition', '판매', 'USED_WORKING');
  return 'USED_WORKING';
}

function detectSellerType(text, evidence, input) {
  const structured = String(input?.seller_type || input?.sellerType || '').trim().toUpperCase();
  if (['DEALER', 'BUSINESS', 'PROFESSIONAL'].includes(structured)) {
    addEvidence(evidence, 'seller_type', `structured:${structured}`, 'DEALER');
    return 'DEALER';
  }
  const dealer = firstMatch(text, /(?:^|\s)(?:업자|사업자|전문\s*판매|매입\s*업체|대량\s*재고|판매점|전문점|공식\s*스토어)(?:\s|$)/i);
  if (dealer) {
    addEvidence(evidence, 'seller_type', dealer.matchedText, 'DEALER');
    return 'DEALER';
  }
  return 'INDIVIDUAL_OR_UNKNOWN';
}

function detectSpecialKind(text, evidence, title = text) {
  const nonPcItem = firstMatch(title, /(?:^|\s)(?:전신\s*거울|벽걸이\s*거울|탁상\s*거울)(?:\s|$)/iu);
  if (nonPcItem) {
    addEvidence(evidence, 'listing_kind', nonPcItem.matchedText, 'NON_PC_ITEM');
    return 'NON_PC_ITEM';
  }
  const homeAvPlayer = firstMatch(title, /(?:DVD|CD|VCD).{0,30}플레이어.{0,80}(?:오디오|앰프|스피커|음향기기)|(?:리시버|턴테이블).{0,100}(?:DVD|CD).{0,30}플레이어/iu);
  if (homeAvPlayer) {
    addEvidence(evidence, 'listing_kind', homeAvPlayer.matchedText, 'NON_PC_ITEM');
    return 'NON_PC_ITEM';
  }
  const monitor = firstMatch(title, /(?:^|\s)(?:게이밍\s*)?모니터(?:\s|$)|\bmonitor\b/iu);
  if (monitor) {
    addEvidence(evidence, 'listing_kind', monitor.matchedText, 'MONITOR');
    return 'MONITOR';
  }
  const box = firstMatch(text, /박스만|빈\s*박스|본품\s*(?:없음|없이).*박스/i);
  if (box) {
    addEvidence(evidence, 'listing_kind', box.matchedText, 'BOX_ONLY');
    return 'BOX_ONLY';
  }
  const accessory = firstMatch(text, /본품\s*(?:없음|없이).*(?:쿨러|방열판)|(?:RTX|GTX|RX\s*\d{4}|그래픽\s*카드|\bGPU\b).{0,30}(?:쿨러|방열판)만\s*판매|(?:RTX|GTX|RX)\s*\d{3,4}.{0,30}(?:키캡|브라켓|백플레이트|지지대)(?=$|[\s,.)])/iu);
  if (accessory) {
    addEvidence(evidence, 'listing_kind', accessory.matchedText, 'ACCESSORY_ONLY');
    return 'ACCESSORY_ONLY';
  }
  const wanted = firstMatch(text, /(?:\[\s*(?:구매|삽니다|매입)\s*\]|대량\s*매입(?:합니다)?|(?:RTX|GTX|RX\s*\d{4}|그래픽\s*카드|\d{4,5}X(?:3D)?).{0,40}(?:삽니다|구합니다|구해요|구합니당|구매[합힙]니다|구매\s*원해요|매입합니(?:다|가)|사\s*봅니다|구해\s*봅니다)|(?:^|[\s([{<])(?:삽니다|구합니다|구해요|구합니당|매입합니다|구매합니다|구매해요|구매원합니다|구매\s*원해요)(?=$|[\s)\]}>.,!?]))/iu);
  if (wanted) {
    addEvidence(evidence, 'listing_kind', wanted.matchedText, 'WANTED');
    return 'WANTED';
  }
  const report = firstMatch(title, /(?:^|[\s([<{>])(?:사기꾼|사기(?=\s*[)\]}>:])|사기\s*(?:주의|조심|피해|신고)|먹튀)(?=$|[\s)\]}>:.,!?])/iu);
  if (report) {
    addEvidence(evidence, 'listing_kind', report.matchedText, 'REPORT');
    return 'REPORT';
  }
  const tradeOnly = firstMatch(title, /교환만|판매\s*없이\s*교환|trade\s*only|^\s*\[\s*교환\s*\]|교환\s*(?:합니다|원해요|희망)|(?:<>|->|ㅡ>)\s*\d|상위\s*모델\s*(?:구해|원해)\s*봅니다/iu);
  if (tradeOnly) {
    addEvidence(evidence, 'listing_kind', tradeOnly.matchedText, 'TRADE_ONLY');
    return 'TRADE_ONLY';
  }
  const distinctCpuSkus = new Set([...title.matchAll(/\b(?:I[3579][ -]?\d{3,5}[A-Z]*|[GE]\d{3,4}|\d{4,5}(?:X3D2?|X|G|GT|K[F]?|F|T))\b/giu)]
    .map((match) => match[0].replace(/\s+/gu, '').toUpperCase()));
  if (distinctCpuSkus.size >= 2) {
    addEvidence(evidence, 'listing_kind', [...distinctCpuSkus].join('+'), 'OPTION_AD');
    return 'OPTION_AD';
  }
  const option = firstMatch(text, /업자.*(?:옵션가|선택)|옵션가|가격\s*별도|\d+\s*[~-]\s*\d+.*선택|(?:\d+\s*GB\s*\/\s*\d+\s*GB|여러\s*옵션).{0,20}선택\s*가능/i);
  if (option) {
    addEvidence(evidence, 'listing_kind', option.matchedText, 'OPTION_AD');
    return 'OPTION_AD';
  }
  const gpuTokenPattern = /\b(?:RTX|GTX)\s*\d{3,4}(?:\s*(?:TI|SUPER))?|\bRX\s*\d{4}(?:\s*XT[X]?)?|\b(?:30[5-9]0|40[5-9]0|50[5-9]0)(?:\s*(?:TI|SUPER))?\b/giu;
  const hasGpuModel = /\b(?:RTX|GTX|GT)\s*\d{3,4}(?:\s*(?:TI|SUPER))?|\bRX\s*\d{3,4}(?:\s*XT[X]?)?|\b(?:30[5-9]0|40[5-9]0|50[5-9]0)(?:\s*(?:TI|SUPER))?\b|\b[5-9]\d{3}\s*XT[X]?\b/iu.test(title);
  const combinedHasGpuModel = /\b(?:RTX|GTX|GT)\s*\d{3,4}(?:\s*(?:TI|SUPER))?|\bRX\s*\d{3,4}(?:\s*XT[X]?)?|\b(?:30[5-9]0|40[5-9]0|50[5-9]0)(?:\s*(?:TI|SUPER))?\b|\b[5-9]\d{3}\s*XT[X]?\b/iu.test(text);
  const withoutGpuModel = title.replace(gpuTokenPattern, ' ');
  const hasCpuConfigurationModel = /\b(?:[1-9]\d{3,4})(?:X3D2?|X|G|K[F]?|F|T)?\b|\b2\d{2}K\b|(?:CORE\s*)?ULTRA\s*[3579]?\s*\d{3}[A-Z]*|울트라\s*[3579]?\s*\d{3}[A-Z]*/iu.test(withoutGpuModel);
  const hasMemoryConfiguration = /(?:\b(?:RAM|DDR[345])\b|\b(?:8|16|24|32|48|64|96|128)\s*G(?:B)?\b)/iu.test(title);
  const hasStorageConfiguration = /\b(?:128|240|250|256|480|500|512)\s*G(?:B)?\b|\b(?:1|2|4|8)\s*T(?:B)?\b/iu.test(title);
  const compactSlashSystem = title.split('/').length >= 4
    && hasCpuConfigurationModel
    && ((hasGpuModel && /\b(?:A|B|H|X|Z)[3-8]\d{2}[A-Z0-9-]*\b/iu.test(title) && hasStorageConfiguration)
      || (hasMemoryConfiguration && hasStorageConfiguration));
  const denseSystemConfiguration = hasGpuModel && hasCpuConfigurationModel
    && hasMemoryConfiguration && hasStorageConfiguration
    && !/(?:에서|으로)\s*(?:테스트|사용)|호환|장착\s*테스트/iu.test(title);
  if (compactSlashSystem || denseSystemConfiguration) {
    addEvidence(evidence, 'listing_kind', title, 'FULL_SYSTEM');
    return 'FULL_SYSTEM';
  }
  const componentGroups = new Set();
  const componentRules = [
    ['CPU', /(?:\bCPU\b(?!\s*(?:지원|호환|용\b|소켓))|라이젠|RYZEN|\bI[3579][\s~-]?\d{4,5}[A-Z]*\b|\b(?:[6-9]\d{3}|1[0-5]\d{3})(?:K[F]?|F|T)\b|\b\d{4,5}X(?:3D)?\b|\bCORE\s*(?:ULTRA\s*)?[3579]\b|(?:CORE\s*)?ULTRA\s*[3579]?\s*\d{3}[A-Z]*|울트라\s*[3579]?\s*\d{3}[A-Z]*)/i],
    ['GPU', /(?:RTX\s*\d{4}|GTX\s*\d{3,4}|\bGT\s*\d{3,4}|RX\s*\d{3,4}|\b[5-9]\d{3}\s*XT[X]?\b|\b(?:30[5-9]0|40[5-9]0|50[5-9]0)(?:\s*(?:TI|SUPER))?\b|그래픽\s*카드|그래픽카드|\bGPU\b)/i],
    ['RAM', /(?:\bRAM\b|램|렘|메모리|DDR[345]\s*\d+\s*(?:GB|G)\b)/i],
    ['MOTHERBOARD', /(?:메인\s*보드|메인보드|보드셋|\bM\s*\/\s*B\b|\b[ABHXZ]{1,2}\d{3}[A-Z0-9-]*\b)/i],
    ['STORAGE', /(?:\bSSD(?=\s|\d|$)|\bHDD(?=\s|\d|$)|NVME|M\.2|하드\s*디스크|하드디스크)/i],
    ['PSU', /(?:\bPSU\b|\d{3,4}\s*W(?:\s|$)|파워\s*(?:서플라이)?)/i],
    ['CASE', /(?:PC\s*케이스|컴퓨터\s*케이스|델\s*케이스|darkFlash\s*DLX\d+)/i],
    ['COOLING', /(?:\bML\d{3}\b|\bAIO\b|타워\s*쿨러|공랭\s*쿨러|CPU\s*쿨러|(?:120|240|280|360|420)\s*(?:MM\s*)?수랭|수랭\s*쿨러)/iu]
  ];
  for (const [group, pattern] of componentRules) {
    if (pattern.test(title)) componentGroups.add(group);
  }
  const explicitSystem = firstMatch(title, /게이밍\s*(?:(?<!반)본체|PC|컴퓨터|데스크탑)|조립(?:식|\s*)\s*(?:PC|컴퓨터)|조립컴퓨터|컴퓨터\s*(?<!반)본체|본체\s*PC|(?:게임용|사무용|업무용)\s*(?<!반)본체|완본체|완제품\s*(?:PC|컴퓨터)|(?:슬림|미니)\s*데스크탑(?!\s*용)|PC\s*케이스.{0,40}(?:RTX|GTX|RX)|(?:삼성|LG)\s*컴퓨터\s+[A-Z]{2,}\d{3,}|\bSFF\b.{0,40}(?:I[3579]|RYZEN)|(?:HP|DELL|LENOVO).{0,50}(?:DESKTOP|SFF|WORKSTATION)|(?:RTX|GTX|RX\s*\d{3,4}|\d{4,5}X(?:3D)?|I[3579][ -]?\d{4,5}[A-Z]*).{0,40}(?<!반)본체|(?:^|\s|\d)(?<!반)본체\s*(?:팝니다|판매|급처)/i);
  const systemNoun = /(?:중고\s*)?(?:컴퓨터|컵퓨터)|(?<!용)데스크탑(?!\s*용)|(?:게임용|게이밍)\s*본체|(?<!반)본체|(?:미니|슬림)\s*PC|(?:^|[^A-Z])PC(?:$|[^A-Z])/i.test(title);
  const cpuGpuPair = componentGroups.has('CPU') && componentGroups.has('GPU');
  const describedSystem = (componentGroups.size >= 3 || cpuGpuPair) && systemNoun;
  const portableComponentWording = componentGroups.size === 1
    && /(?:노트북|NOTEBOOK|LAPTOP).{0,45}(?:DDR[345]|RAM|램|메모리|HDD|하드\s*디스크)|(?:DDR[345]|RAM|램|메모리|HDD|하드\s*디스크).{0,45}(?:노트북|NOTEBOOK|LAPTOP)/iu.test(title)
    && !/(?:NT\d{3,}|\d{2}(?:\.\d)?\s*인치|삼성\s*센스|아티브\s*북|갤럭시\s*북)/iu.test(title);
  const describedPortableSystem = componentGroups.size >= 1 && !portableComponentWording
    && /(?:노트북(?!\s*(?:용|램|RAM|메모리|하드|HDD|SSD|부품))|삼성\s*센스\s*R\d|아티브\s*북|갤럭시\s*북|랩탑(?!용)|NOTEBOOK(?!\s*(?:용|RAM|MEMORY|HDD|SSD|GPU|GRAPHICS))|LAPTOP(?!\s*(?:RAM|MEMORY|HDD|SSD|GPU|GRAPHICS)))/iu.test(title);
  const namedPortableSystem = (hasGpuModel || combinedHasGpuModel)
    && /(?:노트북(?!\s*(?:용|램|RAM|메모리|하드|HDD|SSD|부품))|게이밍\s*북|랩탑(?!용)|NOTEBOOK(?!\s*(?:RAM|MEMORY|HDD|SSD|GPU|GRAPHICS))|LAPTOP(?!\s*(?:RAM|MEMORY|HDD|SSD|GPU|GRAPHICS))|RAZER\s*BLADE|레이저\s*블레이드|ROG\s*(?:STRIX\s*)?SCAR|로그\s*스카|ALIENWARE|에일리언웨어|LEGION\s*[A-Z]?\d|레노버\s*Y\d|리전\s*(?:프로|Y?\d)|MSI\s*GF\d{2}|HP\s*OMEN.{0,30}\d{2}[- ][A-Z0-9]|오멘.{0,30}(?:RTX|GTX)|제피러스|ZEPHYRUS)/iu.test(title);
  const workstationSystem = componentGroups.size >= 1 && /(?:워크스테이션|WORKSTATION)/iu.test(title);
  const describedCompactSystem = componentGroups.size >= 2 && /(?:미니|슬림)\s*PC/i.test(title);
  const componentRichSystem = componentGroups.has('CPU') && componentGroups.has('RAM')
    && componentGroups.size >= 4;
  const cpuComponentWording = /컴퓨터.{0,20}\bCPU\b.{0,20}(?:RYZEN|라이젠|I[3579][ -]?\d{3,5}|\d{4,5}X(?:3D)?)/iu.test(title);
  const clearDesktopSystem = !cpuComponentWording
    && /(?:중고|게임용|사무용|업무용|브랜드)\s*컴퓨터|(?:게임용|사무용|업무용)\s*(?:PC|데스크탑)|미니\s*컴퓨터|HP\s*(?:PRODESK|프로\s*데스크|PAVILION|파빌리온|일체형)|컴퓨터.{0,30}(?:RYZEN|라이젠|\d{4,5}X(?:3D)?|울트라\s*[3579]?[- ]?\d{3}[A-Z]*|I[3579][ -]?\d{4,5}[A-Z]*)|(?:RYZEN|라이젠|\d{4,5}X(?:3D)?|울트라\s*[3579]?[- ]?\d{3}[A-Z]*|I[3579][ -]?\d{4,5}[A-Z]*).{0,30}(?:데스크탑(?:\s*PC)?|컴퓨터\s*(?:팝니다|판매|급처)?)/iu.test(title);
  const fullSystem = explicitSystem || describedSystem || describedPortableSystem || namedPortableSystem
    || workstationSystem || describedCompactSystem || componentRichSystem || clearDesktopSystem;
  if (fullSystem) {
    addEvidence(evidence, 'listing_kind', fullSystem.matchedText || [...componentGroups].join('+'), 'FULL_SYSTEM');
    return 'FULL_SYSTEM';
  }
  const explicitComponentBundle = firstMatch(text, /반본체|CPU\s*\+.*(?:보드|RAM|램)|(?:CPU|메인보드|보드).*(?:묶음|세트)|(?:묶음|세트).*?(?:CPU|메인보드|보드)|(?:\d{4,5}X(?:3D)?|I[3579][ -]?\d{4,5}[A-Z]*)\s*\+\s*[ABHXZ]\d{3}.*(?:RAM|램)|(?:RTX|GTX|RX\s*\d{4}).{0,20}\+.{0,20}(?:\d{4,5}X|I[3579][ -]?\d{4,5}).{0,30}(?:세트|일괄)|\bSSD\b[^+]{0,20}\d+\s*TB\s*\+\s*\d+\s*TB.*일괄|(?:미니\s*PC|MINI\s*PC).{0,50}(?:\+|와|및|포함).{0,50}(?:RTX|GTX|RX\s*\d{4}|그래픽\s*카드)/i);
  const cpuBoardBundle = componentGroups.has('CPU') && componentGroups.has('MOTHERBOARD');
  const distinctGpuModels = new Set([...title.matchAll(/\b(?:RTX|GTX)\s*\d{3,4}(?:\s*(?:TI|SUPER))?|\bRX\s*\d{4}(?:\s*XT[X]?)?/giu)]
    .map((match) => match[0].replace(/\s+/gu, '').toUpperCase()));
  const cpuGpuBundle = cpuGpuPair
    && !/(?:에서|으로)\s*(?:테스트|사용)|호환|장착\s*테스트/iu.test(title);
  const multiComponentBundle = componentGroups.size >= 2
    && /(?:\+|\/|[&＆]|와\s|과\s|,|일괄|묶음|세트|셋트|셋(?:\s|$)|포함)/i.test(title);
  const storageEnclosureBundle = /(?:SSD|HDD|하드\s*디스크).{0,50}\+.{0,30}(?:외장\s*)?케이스|(?:외장\s*)?케이스.{0,30}\+.{0,50}(?:SSD|HDD|하드\s*디스크)/iu.test(title);
  const gpuCoolingBundle = /(?:RTX|GTX|RX\s*\d{4}|그래픽\s*카드).{0,50}(?:(?:워터\s*(?:블록|보드)|WATER\s*BLOCK).{0,20}포함|(?:수랭\s*)?쿨러\s*포함|\bEGPU\b)|\bEGPU\b.{0,40}(?:RTX|GTX|RX\s*\d{4})/iu.test(text);
  const componentBundle = explicitComponentBundle || cpuBoardBundle || cpuGpuBundle
    || storageEnclosureBundle || gpuCoolingBundle || distinctGpuModels.size >= 2 || multiComponentBundle;
  if (componentBundle) {
    addEvidence(evidence, 'listing_kind', componentBundle.matchedText || [...componentGroups].join('+'), 'COMPONENT_BUNDLE');
    return 'COMPONENT_BUNDLE';
  }
  return null;
}

function detectCategory(text, specialKind, evidence) {
  if (specialKind === 'NON_PC_ITEM') {
    addEvidence(evidence, 'category_code', '비 PC 상품', 'UNKNOWN');
    return 'UNKNOWN';
  }
  if (specialKind === 'MONITOR') {
    addEvidence(evidence, 'category_code', '모니터', 'UNKNOWN');
    return 'UNKNOWN';
  }
  if (specialKind === 'FULL_SYSTEM' || (/반본체/i.test(text) && specialKind === 'COMPONENT_BUNDLE')) {
    addEvidence(evidence, 'category_code', specialKind === 'FULL_SYSTEM' ? '본체' : '반본체', 'SYSTEM');
    return 'SYSTEM';
  }
  if (specialKind === 'COMPONENT_BUNDLE') {
    addEvidence(evidence, 'category_code', '묶음', 'BUNDLE');
    return 'BUNDLE';
  }
  if (specialKind === 'BOX_ONLY' || specialKind === 'ACCESSORY_ONLY') {
    addEvidence(evidence, 'category_code', specialKind === 'BOX_ONLY' ? '박스만' : '쿨러만', 'ACCESSORY');
    return 'ACCESSORY';
  }

  const rules = [
    ['COOLING', /(?:CPU\s*(?:공랭|수랭)?\s*쿨러|공랭\s*쿨러|수랭\s*쿨러|케이스\s*팬|(?:120|240|280|360|420)\s*(?:MM\s*)?수랭|NH-D15)/i],
    ['GPU', /(?:RTX\s*\d{4}|GTX\s*\d{3,4}|\bGT\s*\d{3,4}|RX\s*\d{3,4}|\b[5-9]\d{3}\s*XT[X]?\b|\b(?:30[5-9]0|40[5-9]0|50[5-9]0)(?:\s*TI)?(?:\s*SUPER)?\b|그래픽\s*카드|그래픽카드|\bGPU\b|지포스|라데온)/i],
    ['RAM', /(?:DDR[345]|\bRAM\b|메모리|서버램|삼성램|\d+\s*(?:GB|G|기가).*(?:램|두\s*장|\d+장|(?:\d+|한|두|세|네)\s*개))/i],
    ['MOTHERBOARD', /(?:메인\s*보드|메인보드|MOTHERBOARD|\bB[45678]\d{2}M?\b|\b(?:A?X|X)[3-8]\d{2}[A-Z]*\b)/i],
    ['CPU', /(?:\bCPU\b|라이젠|RYZEN|인텔\s*(?:코어)?|\bi[3579][ -]?\d{4,5}[A-Z]*\b|\b\d{4,5}X(?:3D)?\b|\b1[2345]\d{3}K[F]?\b)/i],
    ['SSD', /(?:\bSSD\b|NVMe|M\.2|\b9(?:70|80|90)\s*PRO\b)/i],
    ['HDD', /(?:\bHDD\b|하드\s*디스크|하드디스크|WD\s*Blue)/i],
    ['PSU', /(?:\bPSU\b|파워\s*(?:서플라이)?|RM\d{3,4}X?|GX-\d{3,4}|ATX\s*3\.0)/i],
    ['CASE', /(?:PC\s*케이스|컴퓨터\s*케이스|Fractal\s+Design\s+North)/i],
    ['EXPANSION_CARD', /(?:확장\s*카드|확장카드|랜\s*카드|랜카드|사운드\s*카드|캡처\s*보드|XG-C100C)/i],
    ['ODD', /(?:\bODD\b|DVD\s*(?:ROM|라이터)?|블루레이\s*드라이브|GP60NB50)/i]
  ];
  for (const [code, pattern] of rules) {
    const found = firstMatch(text, pattern);
    if (found) {
      addEvidence(evidence, 'category_code', found.matchedText, code);
      return code;
    }
  }
  addEvidence(evidence, 'category_code', text.slice(0, 80) || 'empty', 'UNKNOWN');
  return 'UNKNOWN';
}

function gpuModel(text) {
  if (/\b(?:RTX\s*)?5090\s*D(?:\s*V2)?\b/i.test(text)) return null;
  if (/(?:RTX\s*4090.{0,12}48\s*G(?:B)?|48\s*G(?:B)?.{0,12}RTX\s*4090)/iu.test(text)) return null;
  const rtx = text.match(/\b(?:GEFORCE\s*)?RTX\s*(\d{4})(?:\s*(TI))?(?:\s*(SUPER))?\b/i);
  if (rtx) {
    const suffix = [rtx[2], rtx[3]].filter(Boolean).map((value) => value.toUpperCase()).join(' ');
    return { model: `RTX ${rtx[1]}${suffix ? ` ${suffix}` : ''}`, matchedText: rtx[0] };
  }
  const bareRtx = text.match(/\b(30[5-9]0|40[5-9]0|50[5-9]0)\s*(TI)?\s*(SUPER)?\b/i);
  if (bareRtx) {
    const suffix = [bareRtx[2], bareRtx[3]].filter(Boolean).map((value) => value.toUpperCase()).join(' ');
    return { model: `RTX ${bareRtx[1]}${suffix ? ` ${suffix}` : ''}`, matchedText: bareRtx[0] };
  }
  const gtx = text.match(/\bGTX\s*(\d{3,4})(?:\s*(TI|SUPER))?\b/i);
  if (gtx) return { model: `GTX ${gtx[1]}${gtx[2] ? ` ${gtx[2].toUpperCase()}` : ''}`, matchedText: gtx[0] };
  const rx = text.match(/\bRX\s*(\d{3,4})(?:\s*(XTX|XT))?\b/i);
  if (rx) return { model: `RX ${rx[1]}${rx[2] ? ` ${rx[2].toUpperCase()}` : ''}`, matchedText: rx[0] };
  return null;
}

function capacity(text) {
  const match = text.match(/\b(\d+(?:\.\d+)?)\s*(TB|GB)\b/i);
  return match ? { label: `${match[1]}${match[2].toUpperCase()}`, matchedText: match[0] } : null;
}

const CATEGORY_MANUFACTURER_PATTERNS = Object.freeze({
  RAM: [
    ["Samsung", /(?:\bSamsung\b|삼성전자|삼성램|삼성\s*메모리|삼성)/iu], ["SK hynix", /(?:\bSK\s*hynix\b|하이닉스)/iu],
    ["Micron", /(?:\bMicron\b|마이크론)/iu], ["Crucial", /(?:\bCrucial\b|크루셜)/iu],
    ["Kingston", /(?:\bKingston\b|킹스톤)/iu], ["Corsair", /(?:\bCorsair\b|커세어)/iu],
    ["G.Skill", /(?:\bG\.?Skill\b|지스킬)/iu], ["TeamGroup", /(?:\bTeam\s*Group\b|팀그룹)/iu]
  ],
  MOTHERBOARD: [
    ["ASUS", /(?:\bASUS\b|에이수스|아수스)/iu], ["GIGABYTE", /(?:\bGIGABYTE\b|기가바이트)/iu],
    ["MSI", /\bMSI\b/iu], ["ASRock", /(?:\bASRock\b|애즈락|아스락)/iu], ["Biostar", /(?:\bBiostar\b|바이오스타)/iu]
  ],
  SSD: [
    ["Samsung", /(?:\bSamsung\b|삼성전자|삼성\s*SSD|삼성)/iu], ["SK hynix", /(?:\bSK\s*hynix\b|하이닉스)/iu],
    ["Solidigm", /(?:\bSolidigm\b|솔리다임)/iu], ["Crucial", /(?:\bCrucial\b|크루셜)/iu],
    ["Western Digital", /(?:\bWestern\s*Digital\b|\bWD\b)/iu], ["SanDisk", /(?:\bSanDisk\b|샌디스크)/iu],
    ["Kingston", /(?:\bKingston\b|킹스톤)/iu], ["Seagate", /(?:\bSeagate\b|씨게이트)/iu],
    ["Kioxia", /(?:\bKioxia\b|키옥시아)/iu]
  ],
  HDD: [
    ["Western Digital", /(?:\bWestern\s*Digital\b|\bWD\b)/iu], ["Seagate", /(?:\bSeagate\b|씨게이트)/iu],
    ["Toshiba", /(?:\bToshiba\b|도시바)/iu]
  ],
  PSU: [
    ["Seasonic", /(?:\bSeasonic\b|시소닉)/iu], ["Corsair", /(?:\bCorsair\b|커세어)/iu], ["FSP", /\bFSP\b/iu],
    ["Super Flower", /(?:\bSuper\s*Flower\b|슈퍼플라워)/iu], ["Cooler Master", /(?:\bCooler\s*Master\b|쿨러마스터)/iu],
    ["ASUS", /(?:\bASUS\b|에이수스|아수스)/iu], ["MSI", /\bMSI\b/iu],
    ["Thermaltake", /(?:\bThermaltake\b|써멀테이크)/iu], ["be quiet!", /\bbe\s*quiet!?\b/iu],
    ["Antec", /(?:\bAntec\b|안텍)/iu], ["Micronics", /(?:\bMicronics\b|마이크로닉스)/iu]
  ],
  COOLING: [
    ["Noctua", /(?:\bNoctua\b|녹투아)/iu], ["Cooler Master", /(?:\bCooler\s*Master\b|쿨러마스터)/iu],
    ["Thermalright", /(?:\bThermalright\b|써멀라이트)/iu], ["DeepCool", /(?:\bDeepCool\b|딥쿨)/iu],
    ["ARCTIC", /\bARCTIC\b/iu], ["Corsair", /(?:\bCorsair\b|커세어)/iu], ["NZXT", /\bNZXT\b/iu],
    ["be quiet!", /\bbe\s*quiet!?\b/iu], ["Scythe", /(?:\bScythe\b|사이즈)/iu], ["Thermaltake", /(?:\bThermaltake\b|써멀테이크)/iu]
  ],
  CASE: [
    ["Corsair", /(?:\bCorsair\b|커세어)/iu], ["Cooler Master", /(?:\bCooler\s*Master\b|쿨러마스터)/iu],
    ["Lian Li", /(?:\bLian\s*Li\b|리안리)/iu], ["Fractal Design", /(?:\bFractal\s*Design\b|프랙탈)/iu],
    ["NZXT", /\bNZXT\b/iu], ["Phanteks", /(?:\bPhanteks\b|팬텍스)/iu], ["Thermaltake", /(?:\bThermaltake\b|써멀테이크)/iu],
    ["Antec", /(?:\bAntec\b|안텍)/iu], ["3RSYS", /\b3RSYS\b/iu], ["darkFlash", /\bdarkFlash\b/iu],
    ["ABKO", /(?:\bABKO\b|앱코)/iu], ["Micronics", /(?:\bMicronics\b|마이크로닉스)/iu]
  ],
  EXPANSION_CARD: [
    ["ASUS", /(?:\bASUS\b|에이수스|아수스)/iu], ["Creative", /(?:\bCreative\b|크리에이티브)/iu],
    ["Elgato", /\bElgato\b/iu], ["Blackmagic Design", /\bBlackmagic(?:\s*Design)?\b/iu], ["Intel", /\bIntel\b/iu],
    ["Broadcom", /\bBroadcom\b/iu], ["TP-Link", /\bTP-?Link\b/iu], ["QNAP", /\bQNAP\b/iu],
    ["HighPoint", /\bHighPoint\b/iu], ["StarTech", /\bStarTech\b/iu]
  ],
  ODD: [
    ["ASUS", /(?:\bASUS\b|에이수스|아수스)/iu], ["LG", /(?:\bLG\b|엘지)/iu],
    ["Pioneer", /(?:\bPioneer\b|파이오니아)/iu], ["Samsung", /(?:\bSamsung\b|삼성전자)/iu]
  ]
});

function detectProductManufacturer(text, category, evidence) {
  const matches = (CATEGORY_MANUFACTURER_PATTERNS[category] || [])
    .filter(([, pattern]) => pattern.test(text))
    .map(([manufacturer]) => manufacturer);
  const uniqueMatches = [...new Set(matches)];
  if (uniqueMatches.length !== 1) return null;
  addEvidence(evidence, 'manufacturer', uniqueMatches[0], uniqueMatches[0]);
  return uniqueMatches[0];
}

export function detectPcPartManufacturer(value, category) {
  const text = String(value || "").normalize("NFKC").replace(/\s+/gu, " ").trim();
  return detectProductManufacturer(text, String(category || "").trim().toUpperCase(), []);
}

function storageCapacityGb(text) {
  const values = [...text.matchAll(/\b(\d+(?:\.\d+)?)\s*(TB|GB)\b/giu)]
    .map((match) => Number(match[1]) * (match[2].toUpperCase() === 'TB' ? 1000 : 1))
    .filter((value) => Number.isFinite(value) && value > 0);
  const uniqueValues = [...new Set(values)];
  return uniqueValues.length === 1 ? uniqueValues[0] : null;
}

function storageBucketModel(category, manufacturer, text) {
  if (!manufacturer) return null;
  const capacityGb = storageCapacityGb(text);
  if (!capacityGb) return null;
  const buckets = category === 'SSD' ? [
    [capacityGb <= 256, 'SSD up to 256GB'], [capacityGb >= 480 && capacityGb <= 512, 'SSD 480-512GB'],
    [capacityGb >= 960 && capacityGb <= 1024, 'SSD 960GB-1TB'], [capacityGb >= 1920 && capacityGb <= 2048, 'SSD 1.92-2TB'],
    [capacityGb >= 3840 && capacityGb <= 4096, 'SSD 3.84-4TB'], [capacityGb >= 7680 && capacityGb <= 8192, 'SSD 7.68-8TB'],
    [capacityGb > 8192, 'SSD over 8TB']
  ] : [
    [capacityGb <= 1000, 'HDD up to 1TB'], [capacityGb >= 1900 && capacityGb <= 2100, 'HDD 2TB'],
    [capacityGb >= 2900 && capacityGb <= 4100, 'HDD 3-4TB'], [capacityGb >= 4900 && capacityGb <= 6100, 'HDD 5-6TB'],
    [capacityGb >= 7900 && capacityGb <= 8100, 'HDD 8TB'], [capacityGb >= 9900 && capacityGb <= 12100, 'HDD 10-12TB'],
    [capacityGb >= 13900 && capacityGb <= 16100, 'HDD 14-16TB'], [capacityGb >= 17900 && capacityGb <= 20100, 'HDD 18-20TB'],
    [capacityGb >= 21900 && capacityGb <= 24100, 'HDD 22-24TB'], [capacityGb >= 25900, 'HDD 26TB or more']
  ];
  const bucket = buckets.find(([matched]) => matched)?.[1];
  return bucket ? `${manufacturer} ${bucket}` : null;
}

function detectModel(text, category, specialKind, evidence, quantityResult = {}, manufacturer = null) {
  const gpu = gpuModel(text);
  let result = null;
  if (category === 'GPU') result = gpu;
  if (category === 'CPU') {
    const explicitIntel = text.match(/\bI[3579][ -]?\d{4,5}[A-Z]{0,3}\b/i);
    const generationIntel = text.match(/(?:인텔\s*)?(?:코어\s*)?I([3579])\s*-?\s*\d{1,2}\s*세대\s*(\d{4,5}[A-Z]{0,3})\b/iu);
    const explicitRyzen = text.match(/(?:\b(?:AMD\s*)?RYZEN|라이젠)\s*([3579])?\s*-?\s*(\d{4,5}[A-Z]{0,3})\b/iu);
    const suffixedDesktop = text.match(/\b(\d{4,5}(?:X3D|KF|KS|XT|K|F|G|X|T))\b/i);
    if (explicitIntel) {
      result = { model: explicitIntel[0].toUpperCase(), matchedText: explicitIntel[0] };
    } else if (generationIntel) {
      result = { model: `I${generationIntel[1]}-${generationIntel[2].toUpperCase()}`, matchedText: generationIntel[0] };
    } else if (explicitRyzen) {
      result = { model: explicitRyzen[2].toUpperCase(), matchedText: explicitRyzen[0] };
    } else if (suffixedDesktop) {
      result = { model: suffixedDesktop[1].toUpperCase(), matchedText: suffixedDesktop[0] };
    }
  }
  if (category === 'RAM') {
    const generation = text.match(/\bDDR([345])\b/i);
    if (generation && quantityResult.module_capacity_gb) {
      result = {
        model: `DDR${generation[1]} ${Number(quantityResult.module_capacity_gb)}GB`,
        matchedText: `${generation[0]} ${quantityResult.module_capacity_gb}GB`
      };
    }
  }
  if (category === 'MOTHERBOARD') {
    const boardModel = text.match(/\b(?:A320|B350|X370|B450|X470|A520|B550|X570|A620|B650|X670|B840|B850|X870|H110|B150|Z170|B250|Z270|B360|B365|Z370|Z390|B460|Z490|B560|Z590|H610|B660|Z690|B760|Z790|B860|Z890)(?:M|I|E)?\b/i);
    if (boardModel) result = { model: boardModel[0].toUpperCase(), matchedText: boardModel[0] };
  }
  if (category === 'SSD') {
    const exactModel = text.match(/\b(980|990)\s*PRO\b/i);
    const driveCapacity = capacity(text);
    if (exactModel && driveCapacity) {
      result = { model: `${exactModel[1]} PRO ${driveCapacity.label}`, matchedText: `${exactModel[0]} ${driveCapacity.matchedText}` };
    } else {
      const model = storageBucketModel('SSD', manufacturer, text);
      if (model) result = { model, matchedText: model };
    }
  }
  if (category === 'HDD') {
    const wdBlue = text.match(/\b(?:WD|Western\s*Digital)\s*Blue\b/i);
    const driveCapacity = capacity(text);
    if (wdBlue && driveCapacity) {
      result = { model: `WD BLUE ${driveCapacity.label}`, matchedText: `${wdBlue[0]} ${driveCapacity.matchedText}` };
    } else {
      const model = storageBucketModel('HDD', manufacturer, text);
      if (model) result = { model, matchedText: model };
    }
  }
  if (category === 'PSU') {
    const gx = text.match(/\bGX[- ]?(\d{3,4})\b/i);
    const rm = text.match(/\bRM(\d{3,4})X\b/i);
    const formFactor = /\bSFX-?L\b/i.test(text) ? 'SFX-L'
      : /\bSFX\b|\bSF\d{3,4}\b/i.test(text) ? 'SFX'
        : /\bATX\b|\bPSU\b|power\s*supply|파워/iu.test(text) ? 'ATX' : null;
    if (gx) result = { model: `GX-${gx[1]} ${gx[1]}W`, matchedText: gx[0] };
    else if (rm) result = { model: `RM${rm[1]}X ${rm[1]}W`, matchedText: rm[0] };
    else if (manufacturer && formFactor) result = { model: `${manufacturer} ${formFactor} Power Supply`, matchedText: `${manufacturer} ${formFactor}` };
  }
  if (category === 'CASE') {
    const match = text.match(/Fractal\s+Design\s+North/i);
    if (match) result = { model: 'FRACTAL DESIGN NORTH', matchedText: match[0] };
  }
  if (category === 'COOLING') {
    const nhD15 = text.match(/\bNH-?D15\b/i);
    const aioSize = text.match(/\b(120|240|280|360|420)\s*(?:MM)?\s*(?:AIO|수(?:냉|랭))/iu)
      || text.match(/(?:AIO|수(?:냉|랭))\s*(120|240|280|360|420)\s*(?:MM)?/iu);
    const subtypeName = /\bAIO\b|수(?:냉|랭)|water\s*cool/iu.test(text) ? 'AIO Liquid Cooler'
      : /case\s*fan|케이스\s*팬|쿨링\s*팬/iu.test(text) ? 'PC Case Fan'
        : /cooler|heat\s*sink|쿨러|공랭/iu.test(text) ? 'Air CPU Cooler' : null;
    if (nhD15) result = { model: 'NH-D15', matchedText: nhD15[0] };
    else if (aioSize) result = { model: `${aioSize[1]}MM AIO`, matchedText: aioSize[0] };
    else if (manufacturer && subtypeName) result = { model: `${manufacturer} ${subtypeName}`, matchedText: `${manufacturer} ${subtypeName}` };
  }
  if (category === 'CASE') {
    const chassis = /full\s*tower|big\s*tower|빅\s*타워/iu.test(text) ? 'Full Tower PC Case'
      : /mini\s*tower|미니\s*타워/iu.test(text) ? 'Mini Tower PC Case'
        : /mid\s*tower|middle\s*tower|미들\s*타워|case|케이스|chassis/iu.test(text) ? 'Mid Tower PC Case' : null;
    if (!result && manufacturer && chassis) result = { model: `${manufacturer} ${chassis}`, matchedText: `${manufacturer} ${chassis}` };
  }
  if (category === 'EXPANSION_CARD') {
    const exactModel = text.match(/\bXG-C100C\b/i);
    const externalDevice = /USB|외장(?:형)?|EXTERNAL/iu.test(text);
    const subtypeName = /network|ethernet|랜\s*카드|NIC\b/iu.test(text) ? 'PCIe Network Card'
      : /sound|audio|사운드\s*카드/iu.test(text) ? 'PCIe Sound Card'
        : /capture|캡처|캡쳐/iu.test(text) ? 'PCIe Capture Card'
          : /RAID|HBA|SAS\s*controller/iu.test(text) ? 'PCIe HBA RAID Card'
            : /M\.2.*(?:carrier|확장)|(?:carrier|확장).*M\.2/iu.test(text) ? 'PCIe M.2 Carrier Card' : null;
    if (exactModel) result = { model: 'XG-C100C', matchedText: exactModel[0] };
    else if (manufacturer && subtypeName && !externalDevice) result = { model: `${manufacturer} ${subtypeName}`, matchedText: `${manufacturer} ${subtypeName}` };
  }
  if (category === 'ODD') {
    const exactModel = text.match(/\bGP60NB50\b/i);
    const readOnlyDrive = /DVD\s*[- ]?\s*ROM|CD\s*ROM/iu.test(text);
    const media = readOnlyDrive ? null
      : /BDXL/iu.test(text) ? 'BDXL Writer'
      : /Blu-?ray|블루레이/iu.test(text) ? 'Blu-ray Writer'
        : /DVD/iu.test(text) ? 'DVD Writer' : null;
    if (exactModel) result = { model: 'GP60NB50', matchedText: exactModel[0] };
    else if (manufacturer && media) result = { model: `${manufacturer} ${media}`, matchedText: `${manufacturer} ${media}` };
  }
  if (category === 'ACCESSORY' && gpu) {
    const suffix = specialKind === 'BOX_ONLY' ? 'BOX' : 'COOLER';
    result = { model: `${gpu.model} ${suffix}`, matchedText: gpu.matchedText };
  }
  if (specialKind === 'OPTION_AD' || specialKind === 'FULL_SYSTEM' || specialKind === 'COMPONENT_BUNDLE') result = null;
  if (result) addEvidence(evidence, 'canonical_model', result.matchedText, result.model);
  return result?.model ?? null;
}

function koreanNumber(value) {
  return { 한: 1, 하나: 1, 두: 2, 세: 3, 네: 4 }[value] ?? Number(value);
}

function detectRamQuantity(text, evidence) {
  const rank = text.match(/\b([12]Rx[48])\b/i)?.[1] || null;
  const partial = text.match(/(\d+|한|하나|두|세|네)\s*(개|장|매)\s*중\s*(\d+|한|하나|두|세|네)\s*(?:개|장|매)\s*판매\s*완료/i);
  const capacityFirst = text.match(/(\d+(?:\.\d+)?)\s*(?:GB|G|기가)\s*[x×*]\s*(\d+)\b/i);
  const countFirst = text.match(/(\d+)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*(?:GB|G|기가)\b/i);
  const compactKit = text.match(/(?:^|[(\s])(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+)(?=\s*(?:\d{4}[A-Z]?|개|EA|[,)]|$))/iu);
  const kit = text.match(/\bKIT\b[^()]{0,20}\(?\s*(\d+(?:\.\d+)?)\s*(?:GB|G)?\s*[x×*]\s*(\d+)\s*\)?/i);
  const capacityWithCount = text.match(/(\d+(?:\.\d+)?)\s*(?:GB|G|기가)\s*(\d+|한|하나|두|세|네)\s*(?:개(?:입)?|장|매|EA)(?=\s|$|[,.)])/i);
  const explicitCount = text.match(/(?:^|[\s,(/])(\d+|한|하나|두|세|네)\s*(?:개(?:입)?|장|매|EA)(?=\s|$|[,(.)])/i)
    || text.match(/(?:램|RAM)\s*(\d+|한|하나|두|세|네)\s*(?:개(?:입)?|장|매|EA)(?=\s|$|[,(.)])/iu);
  const trailingMultiplier = text.match(/(?:^|[\s,(/])[x×*]\s*(\d+)\b/i);
  const pair = text.match(/한\s*쌍/i);
  const leadingCapacity = text.match(/(?:DDR[345][^\d]{0,12})?(\d+(?:\.\d+)?)\s*(?:GB|G|기가)\b/i);
  let listedQuantity = 1;
  let availableQuantity = 1;
  let soldQuantity = 0;
  let moduleCapacity = null;
  let matchedText = 'single RAM module';
  let quantityUnknown = false;

  if (partial) {
    listedQuantity = koreanNumber(partial[1]);
    soldQuantity = koreanNumber(partial[3]);
    availableQuantity = Math.max(0, listedQuantity - soldQuantity);
    moduleCapacity = Number(leadingCapacity?.[1]) || null;
    matchedText = partial[0];
  } else if (capacityFirst || countFirst || compactKit || kit) {
    const match = capacityFirst || countFirst || compactKit || kit;
    moduleCapacity = Number(countFirst ? match[2] : match[1]);
    listedQuantity = Number(countFirst ? match[1] : match[2]);
    availableQuantity = listedQuantity;
    matchedText = match[0];
  } else if (capacityWithCount) {
    const match = capacityWithCount;
    moduleCapacity = Number(match[1]);
    listedQuantity = koreanNumber(match[2]);
    availableQuantity = listedQuantity;
    matchedText = match[0];
  } else if (explicitCount || trailingMultiplier || pair) {
    const match = explicitCount || trailingMultiplier || pair;
    moduleCapacity = Number(leadingCapacity?.[1]) || null;
    listedQuantity = pair ? 2 : koreanNumber(match[1]);
    availableQuantity = listedQuantity;
    matchedText = match[0].trim();
  } else if (/듀얼\s*킷|DUAL\s*KIT/i.test(text)) {
    quantityUnknown = true;
    matchedText = text.match(/듀얼\s*킷|DUAL\s*KIT/i)[0];
  } else {
    moduleCapacity = Number(leadingCapacity?.[1]) || null;
  }
  if (listedQuantity === 1 && matchedText === 'single RAM module' && /개당|장당|매당|일괄\s*판매/iu.test(text)) {
    quantityUnknown = true;
    matchedText = text.match(/개당|장당|매당|일괄\s*판매/iu)[0];
  }

  if (!Number.isSafeInteger(listedQuantity) || listedQuantity < 1 || listedQuantity > 100) {
    listedQuantity = 1;
    quantityUnknown = true;
  }
  if (!Number.isSafeInteger(soldQuantity) || soldQuantity < 0 || soldQuantity > listedQuantity) {
    soldQuantity = 0;
    quantityUnknown = true;
  }
  if (!Number.isSafeInteger(availableQuantity) || availableQuantity < 0 || availableQuantity > listedQuantity) availableQuantity = listedQuantity;
  const quantity = Math.max(1, availableQuantity);
  addEvidence(evidence, 'quantity', matchedText, quantity);
  return {
    quantity,
    listed_quantity: listedQuantity,
    available_quantity: availableQuantity,
    sold_quantity: soldQuantity,
    partialSold: soldQuantity > 0,
    no_available_quantity: availableQuantity === 0,
    kit_price_total: Boolean(kit || /듀얼\s*킷|DUAL\s*KIT/i.test(text)),
    quantity_unknown: quantityUnknown,
    module_capacity_gb: moduleCapacity,
    total_capacity_gb: moduleCapacity ? moduleCapacity * availableQuantity : null,
    kit_total_capacity_gb: moduleCapacity ? moduleCapacity * listedQuantity : Number(leadingCapacity?.[1]) || null,
    rank_layout: rank
  };
}

function detectQuantity(text, category, evidence) {
  if (category === 'RAM') return detectRamQuantity(text, evidence);
  let quantity = 1;
  let matchedText = 'single listing';
  let partialSold = false;
  let quantityUnknown = false;
  const partial = text.match(/(\d+)\s*개\s*중\s*(\d+)\s*개\s*판매완료/i);
  if (partial) {
    quantity = Math.max(1, Number(partial[1]) - Number(partial[2]));
    matchedText = partial[0];
    partialSold = true;
  } else {
    const multiplied = text.match(/(?:RTX\s*\d{4}(?:\s*TI)?(?:\s*SUPER)?|GTX\s*\d{3,4}|RX\s*\d{4}(?:\s*XT[X]?)?|SSD\s*\d+\s*TB)\s*[x×*]\s*(\d+)\b/i);
    const koreanCount = text.match(/(두|세|네)\s*(?:개|장)(?=\s*(?:일괄|개당|장당|각각|보유|판매|중|모두|전부|$))/i);
    const numericCount = text.match(/(?:^|[\s,(/[\]])(\d+)\s*(?:개|장|EA)(?=\s*(?:일괄|세트|셋트|개당|장당|각각|보유|판매|중|모두|전부|$|[\]]))/i)
      || text.match(/총\s*(\d+)\s*(?:개|장|EA)/iu);
    if (multiplied) {
      quantity = Number(multiplied[1]);
      matchedText = multiplied[0];
    } else if (koreanCount) {
      quantity = { 두: 2, 세: 3, 네: 4 }[koreanCount[1]];
      matchedText = koreanCount[0];
    } else if (numericCount) {
      quantity = Number(numericCount[1]);
      matchedText = numericCount[0];
    } else {
      const ambiguousMultiple = text.match(/소[·ㆍ.\s-]*수량\s*판매|수량\s*판매|다수\s*(?:보유|판매|재고)?|여러\s*(?:개|대)|복수\s*판매|대량\s*판매/iu);
      if (ambiguousMultiple) {
        quantityUnknown = true;
        matchedText = ambiguousMultiple[0];
      } else if (/개당|장당|매당/iu.test(text)) {
        quantityUnknown = true;
        matchedText = text.match(/개당|장당|매당/iu)[0];
      }
    }
  }
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100) quantity = 1;
  addEvidence(evidence, 'quantity', matchedText, quantity);
  return {
    quantity,
    listed_quantity: quantity,
    available_quantity: quantity,
    sold_quantity: partialSold ? 1 : 0,
    partialSold,
    quantity_unknown: quantityUnknown
  };
}

function detectPriceScope(text, specialKind, quantityResult, evidence) {
  let scope = 'TOTAL';
  let matchedText = '표시가격';
  const quantity = quantityResult.quantity;
  const unitMarker = text.match(/개당|장당|매당|1개\s*가격|각\s*\d/i)?.[0] || null;
  const totalMarker = text.match(/일괄|전체|총\s*가격|합계/i)?.[0] || null;
  if (specialKind === 'OPTION_AD') {
    scope = 'OPTION'; matchedText = '옵션가';
  } else if (/계약금|예약금|선금/i.test(text)) {
    scope = 'DEPOSIT'; matchedText = text.match(/계약금|예약금|선금/i)[0];
  } else if (specialKind === 'COMPONENT_BUNDLE') {
    scope = 'BUNDLE'; matchedText = text.match(/반본체|묶음|세트/i)?.[0] ?? 'bundle';
  } else if (unitMarker && totalMarker) {
    scope = 'AMBIGUOUS'; matchedText = `${unitMarker}/${totalMarker}`;
  } else if (unitMarker) {
    scope = 'UNIT'; matchedText = unitMarker;
  } else if (quantityResult.partialSold && quantity === 1) {
    scope = 'UNIT'; matchedText = '남은 1개';
  } else if (quantity > 1 && totalMarker) {
    scope = 'TOTAL'; matchedText = totalMarker;
  } else if (quantity > 1 && quantityResult.kit_price_total) {
    scope = 'TOTAL'; matchedText = 'KIT';
  } else if (quantity > 1) {
    scope = 'AMBIGUOUS'; matchedText = '수량 2개 이상, 가격범위 불명확';
  }
  addEvidence(evidence, 'price_scope', matchedText, scope);
  return scope;
}

function unique(values) {
  return [...new Set(values)];
}

function explicitSoldStatus(text, listingKind = null) {
  const componentScopedSold = /(?:CPU|GPU|그래픽\s*카드|그래픽카드|램|RAM|메모리|SSD|HDD|메인\s*보드|메인보드|파워|쿨러|케이스)\s*판매\s*완료/iu.test(text);
  const wholeListingSold = /(?:전체|일괄|모두|전부)\s*판매\s*완료|판매\s*완료\s*(?:되었습니다|됐습니다|완료)?\s*$/iu.test(text);
  if (listingKind === 'COMPONENT_BUNDLE' && componentScopedSold && !wholeListingSold) return null;
  return explicitSoldText(text) ? 'SOLD' : null;
}

function detectGpuBoardManufacturer(text, evidence) {
  const match = text.match(/\b(ASUS|MSI|GIGABYTE|ZOTAC|PALIT|GALAX|SAPPHIRE|POWERCOLOR|PNY|EVGA|XFX)\b|(?:이엠텍|갤럭시|컬러풀|사파이어)/iu);
  if (!match) return null;
  const aliases = { "이엠텍": "EMTEK", "갤럭시": "GALAX", "컬러풀": "COLORFUL", "사파이어": "SAPPHIRE" };
  const manufacturer = aliases[match[0]] || match[0].toUpperCase();
  addEvidence(evidence, 'gpu_board_manufacturer', match[0], manufacturer);
  return manufacturer;
}

/**
 * Deterministic first-pass classifier for a single PC marketplace listing.
 * It intentionally leaves uncertain models excluded instead of guessing a SKU.
 */
export function classifyPcPartListing(input) {
  const text = normalizedText(input);
  const title = normalizedTitle(input);
  const evidence = [];
  const specialKind = detectSpecialKind(text, evidence, title);
  const categoryCode = detectCategory(text, specialKind, evidence);
  const condition = detectCondition(text, evidence);
  const sellerType = detectSellerType(text, evidence, input);
  const quantityResult = detectQuantity(text, categoryCode, evidence);
  const productManufacturer = detectProductManufacturer(text, categoryCode, evidence);
  const canonicalModel = detectModel(text, categoryCode, specialKind, evidence, quantityResult, productManufacturer);
  const gpuBoardManufacturer = categoryCode === 'GPU' ? detectGpuBoardManufacturer(text, evidence) : null;
  const priceScope = detectPriceScope(text, specialKind, quantityResult, evidence);
  const listingKind = specialKind ?? (quantityResult.quantity >= 2 ? 'SAME_PRODUCT_LOT' : 'SINGLE_COMPONENT');

  const exclusionReasons = [];
  if (listingKind === 'MONITOR') exclusionReasons.push('MONITOR_EXCLUDED');
  if (['NON_PC_ITEM', 'BOX_ONLY', 'ACCESSORY_ONLY', 'WANTED', 'REPORT', 'TRADE_ONLY', 'OPTION_AD', 'FULL_SYSTEM', 'COMPONENT_BUNDLE'].includes(listingKind)) {
    exclusionReasons.push(listingKind);
  }
  if (CONDITION_EXCLUSIONS[condition]) exclusionReasons.push(CONDITION_EXCLUSIONS[condition]);
  if (sellerType === 'DEALER') exclusionReasons.push('DEALER_LISTING');
  if (priceScope === 'DEPOSIT') exclusionReasons.push('DEPOSIT_ONLY');
  if (priceScope === 'AMBIGUOUS') exclusionReasons.push('PRICE_SCOPE_AMBIGUOUS');
  if (quantityResult.quantity_unknown) exclusionReasons.push('QUANTITY_UNKNOWN');
  if (quantityResult.no_available_quantity) exclusionReasons.push('NO_AVAILABLE_QUANTITY');
  const displayedAmount = Number(input?.price);
  if (exclusionReasons.length === 0 && Number.isFinite(displayedAmount)
    && (displayedAmount <= 1_500 || /^([1-9])\1{3,}$/u.test(String(Math.trunc(displayedAmount))))) {
    exclusionReasons.push('ANOMALOUS_PRICE');
  }
  const bracketedWanPrice = title.match(/(?:^|[^\d])(\d+(?:\.\d+)?)\s*만원\s*[\])}]/u);
  const displayedPrice = Number(input?.price);
  if (bracketedWanPrice && Number.isFinite(displayedPrice)
    && Math.round(Number(bracketedWanPrice[1]) * 10_000) !== Math.round(displayedPrice)) {
    exclusionReasons.push('DISPLAY_PRICE_MISMATCH');
  }
  if (!canonicalModel && !['NON_PC_ITEM', 'FULL_SYSTEM', 'COMPONENT_BUNDLE', 'MONITOR'].includes(listingKind)) {
    exclusionReasons.push('MODEL_AMBIGUOUS');
  }

  const modelConfidence = canonicalModel ? 0.98 : 0;
  const categoryConfidence = categoryCode === 'UNKNOWN' ? 0 : 0.99;
  const quantityConfidence = quantityResult.partialSold ? 0.99 : quantityResult.quantity > 1 ? 0.98 : 0.95;
  const priceScopeConfidence = priceScope === 'AMBIGUOUS' ? 0.2 : priceScope === 'TOTAL' ? 0.9 : 0.99;
  const conditionConfidence = evidence.some((entry) => entry.field === 'condition') ? 0.98 : 0.8;
  const suppliedStatus = String(input?.lifecycle_status ?? input?.status ?? '').trim().toUpperCase();
  const statusConfidence = explicitSoldStatus(text, listingKind) || ['ACTIVE', 'RESERVED', 'SOLD', 'DELETED', 'EXPIRED'].includes(suppliedStatus)
    ? 0.99
    : 0.7;
  const confidence = {
    overall: Number(Math.min(categoryConfidence, canonicalModel ? modelConfidence : 0.6, quantityConfidence, priceScopeConfidence, conditionConfidence, statusConfidence).toFixed(2)),
    category: categoryConfidence,
    model: modelConfidence,
    quantity: quantityConfidence,
    price_scope: priceScopeConfidence,
    condition: conditionConfidence,
    status: statusConfidence,
    dedupe: 0.5
  };

  const result = {
    category_code: categoryCode,
    canonical_model: canonicalModel,
    listing_kind: listingKind,
    quantity: quantityResult.quantity,
    price_scope: priceScope,
    condition,
    seller_type: sellerType,
    manufacturer: productManufacturer,
    lifecycle_status: explicitSoldStatus(text, listingKind),
    exclusion_reasons: unique(exclusionReasons),
    price_eligible: exclusionReasons.length === 0 && categoryCode !== 'UNKNOWN',
    confidence,
    evidence,
    price: {
      amount: Number.isFinite(Number(input?.price)) ? Number(input.price) : null,
      currency: typeof input?.currency === 'string' ? input.currency : 'KRW'
    }
  };
  if (categoryCode === 'RAM') {
    result.module_capacity_gb = quantityResult.module_capacity_gb;
    result.total_capacity_gb = quantityResult.total_capacity_gb;
    result.kit_total_capacity_gb = quantityResult.kit_total_capacity_gb;
    result.listed_quantity = quantityResult.listed_quantity;
    result.available_quantity = quantityResult.available_quantity;
    result.sold_quantity = quantityResult.sold_quantity;
    result.rank_layout = quantityResult.rank_layout;
    result.quantity_unknown = quantityResult.quantity_unknown;
  }
  if (categoryCode !== 'RAM' && quantityResult.quantity_unknown) result.quantity_unknown = true;
  if (categoryCode === 'GPU') result.gpu_board_manufacturer = gpuBoardManufacturer;
  return result;
}

const PUBLIC_CATEGORY_CODES = new Set(['CPU', 'GPU', 'RAM', 'MOTHERBOARD', 'SSD', 'HDD', 'PSU']);

function publicCategoryCode(category, text, listingKind) {
  if (PUBLIC_CATEGORY_CODES.has(category)) return category;
  if (['FULL_SYSTEM', 'COMPONENT_BUNDLE', 'BUNDLE', 'ACCESSORY'].includes(category) || listingKind === 'FULL_SYSTEM' || listingKind === 'COMPONENT_BUNDLE') {
    const candidates = [];
    if (/(?:RTX|GTX|RX\s*\d{3,4}|그래픽\s*카드|그래픽카드|\bGPU\b)/iu.test(text)) candidates.push('GPU');
    if (/(?:\bCPU\b|라이젠|RYZEN|\bi[3579][ -]?\d{4,5}\b)/iu.test(text)) candidates.push('CPU');
    if (/(?:DDR[345]|\bRAM\b|램|메모리)/iu.test(text)) candidates.push('RAM');
    if (/(?:메인\s*보드|메인보드|\bB[45678]\d{2}M?\b)/iu.test(text)) candidates.push('MOTHERBOARD');
    if (/(?:\bSSD\b|NVMe|M\.2)/iu.test(text)) candidates.push('SSD');
    if (/(?:\bHDD\b|하드\s*디스크|하드디스크)/iu.test(text)) candidates.push('HDD');
    if (/(?:\bPSU\b|파워\s*(?:서플라이)?|\d{3,4}\s*W\b)/iu.test(text)) candidates.push('PSU');
    return [...new Set(candidates)].length === 1 ? candidates[0] : 'UNSUPPORTED_CATEGORY';
  }
  return 'UNSUPPORTED_CATEGORY';
}

function publicMarketSegment(text, category) {
  if (/(?:노트북|NOTEBOOK|LAPTOP|SO-DIMM|SODIMM)/iu.test(text)) return 'LAPTOP';
  if (/(?:서버|SERVER|XEON|EPYC|THREADRIPPER|RDIMM|LRDIMM)/iu.test(text)) return 'SERVER_ENTERPRISE';
  if (/(?:워크스테이션|WORKSTATION)/iu.test(text)) return 'WORKSTATION';
  return category === 'UNSUPPORTED_CATEGORY' ? 'UNKNOWN' : 'CONSUMER_DESKTOP';
}

function publicListingType(listingKind) {
  return ({
    SINGLE_COMPONENT: 'SINGLE', SAME_PRODUCT_LOT: 'MULTI_SAME', FULL_SYSTEM: 'COMPLETE_PC',
    COMPONENT_BUNDLE: 'BUNDLE', OPTION_AD: 'OPTION_AD', ACCESSORY_ONLY: 'ACCESSORY_ONLY',
    BOX_ONLY: 'BOX_ONLY', WANTED: 'WANTED', REPORT: 'UNKNOWN', TRADE_ONLY: 'WANTED',
    MONITOR: 'UNKNOWN', NON_PC_ITEM: 'UNKNOWN'
  })[listingKind] || 'UNKNOWN';
}

function publicConditionGroup(condition) {
  return ({
    USED_WORKING: 'USED_WORKING', NEW: 'NEW_SEALED', REFURBISHED: 'REFURBISHED',
    MINED: 'USED_MINING', BROKEN: 'DEFECTIVE', UNTESTED: 'UNTESTED'
  })[condition] || 'UNKNOWN';
}

function publicChipVendor(category, model, text) {
  if (category !== 'GPU') return null;
  if (/^RX\b/iu.test(model) || /라데온|AMD/iu.test(text)) return 'AMD';
  if (/^Arc\b/iu.test(model) || /인텔\s*아크|\bINTEL\b/iu.test(text)) return 'Intel';
  return 'NVIDIA';
}

function publicCanonicalProductId(category, model, text, marketSegment) {
  if (!PUBLIC_CATEGORY_CODES.has(category) || !model || marketSegment !== 'CONSUMER_DESKTOP') return null;
  const slug = model.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '');
  if (category === 'GPU') return `gpu:${publicChipVendor(category, model, text).toLowerCase()}:${slug}`;
  if (category === 'CPU') return `cpu:${/라이젠|RYZEN|AMD/iu.test(text) ? 'amd' : 'intel'}:${slug}`;
  return `${category.toLowerCase()}:spec:${slug}`;
}

function publicSpecGroupId(category, model, text, marketSegment) {
  const id = publicCanonicalProductId(category, model, text, marketSegment);
  return id ? `${category}:SPEC:${id}:${marketSegment}` : null;
}

function publicSpecificFields(category, model, text, base) {
  const fields = {};
  if (category === 'GPU') {
    fields.chip_vendor = publicChipVendor(category, model, text);
    fields.gpu_model = model;
    fields.vram_gb = Number(text.match(/\b(\d{1,3})\s*GB\b/iu)?.[1]) || null;
    fields.board_brand = base.gpu_board_manufacturer || null;
  }
  if (category === 'RAM') {
    fields.memory_form_factor = /SO-?DIMM|노트북/iu.test(text) ? 'SODIMM' : 'UDIMM';
    fields.ddr_generation = text.match(/DDR[345]/iu)?.[0]?.toUpperCase() || null;
    fields.capacity_per_module_gb = base.module_capacity_gb ?? null;
    fields.modules_per_kit = base.listed_quantity > 1 ? base.listed_quantity : 1;
    fields.kit_count = 1;
    fields.available_module_count = base.available_quantity ?? base.quantity ?? null;
    fields.total_capacity_per_kit_gb = fields.capacity_per_module_gb ? fields.capacity_per_module_gb * fields.modules_per_kit : null;
    fields.total_available_capacity_gb = fields.capacity_per_module_gb ? fields.capacity_per_module_gb * (fields.available_module_count || 0) : null;
    fields.speed_mt_s = Number(text.match(/(?:DDR[345][ -]?)?(\d{4,5})\b/iu)?.[1]) || null;
    fields.ecc_mode = /ECC/iu.test(text) ? 'ECC' : 'NON_ECC';
    fields.registered = /RDIMM|LRDIMM|REGISTERED|서버램/iu.test(text);
    fields.rank_layout = base.rank_layout || null;
  }
  if (category === 'MOTHERBOARD') {
    const chipsetToken = text.match(/\b([ABHXZ]\d{3})M?\b/iu)?.[1]?.toUpperCase() || null;
    fields.socket = text.match(/\b(?:AM4|AM5|LGA\s*\d{4})\b/iu)?.[0]?.replace(/\s+/gu, '').toUpperCase()
      || (chipsetToken && /^(?:A620|B650|X670|B850|X870)$/u.test(chipsetToken) ? 'AM5'
        : chipsetToken && /^(?:A520|B350|B450|B550|X370|X470|X570)$/u.test(chipsetToken) ? 'AM4'
          : chipsetToken && /^(?:H610|B660|Z690|B760|Z790|H810|B860|Z890)$/u.test(chipsetToken) ? 'LGA1700' : null);
    fields.chipset = chipsetToken;
    fields.form_factor = /(?:B[45678]\d{2}M|M-?ATX|MICRO-?ATX)/iu.test(text) ? 'M-ATX' : /ATX/iu.test(text) ? 'ATX' : null;
    fields.exact_model = model;
    fields.memory_generation = /DDR5/iu.test(text) ? 'DDR5' : /DDR4/iu.test(text) ? 'DDR4' : /DDR3/iu.test(text) ? 'DDR3' : null;
    fields.wifi_variant = /WIFI|WI-FI|AX/iu.test(text) ? 'WIFI' : 'NONE';
  }
  if (category === 'SSD' || category === 'HDD') {
    const storageCapacity = text.match(/\b(\d+(?:\.\d+)?)\s*(TB|GB)\b/iu);
    fields.marketed_capacity_gb = storageCapacity ? Math.round(Number(storageCapacity[1]) * (storageCapacity[2].toUpperCase() === 'TB' ? 1000 : 1)) : null;
    fields.form_factor = /2\.5|2,?5/iu.test(text) ? '2.5-inch' : /3\.5|3,?5/iu.test(text) ? '3.5-inch' : category === 'SSD' && /M\.2/iu.test(text) ? 'M.2' : null;
    fields.interface = /SAS/iu.test(text) ? 'SAS' : /IDE/iu.test(text) ? 'IDE' : /SATA/iu.test(text) ? 'SATA' : /PCIe|NVMe/iu.test(text) ? 'PCIe' : null;
    if (category === 'SSD') fields.protocol = /SATA/iu.test(text) && !/NVMe/iu.test(text) ? 'SATA' : /NVMe/iu.test(text) ? 'NVMe' : null;
    if (category === 'HDD') fields.purpose = /NAS/iu.test(text) ? 'NAS' : /CCTV|감시/iu.test(text) ? 'CCTV_SURVEILLANCE' : /서버|ENTERPRISE|기업용/iu.test(text) ? 'ENTERPRISE' : /노트북|LAPTOP/iu.test(text) ? 'LAPTOP' : 'DESKTOP_PC';
  }
  if (category === 'PSU') {
    const rated = text.match(/(?:정격\s*)?(\d{3,4})\s*W\b/iu);
    fields.rated_wattage = rated && !/(?:최대|피크|MAX)/iu.test(rated[0]) ? Number(rated[1]) : null;
    fields.form_factor = /SFX-?L/iu.test(text) ? 'SFX-L' : /SFX/iu.test(text) ? 'SFX' : /ATX/iu.test(text) ? 'ATX' : null;
    fields.efficiency_rating = text.match(/80\s*PLUS(?:\s+(?:BRONZE|GOLD|PLATINUM|TITANIUM))?/iu)?.[0] || null;
    fields.modularity = /풀\s*모듈러|FULL\s*MODULAR/iu.test(text) ? 'FULL_MODULAR' : /세미\s*모듈러|SEMI\s*MODULAR/iu.test(text) ? 'SEMI_MODULAR' : null;
    fields.atx_or_sfx_version = text.match(/ATX\s*3\.[01]/iu)?.[0]?.replace(/\s+/gu, ' ') || null;
  }
  return fields;
}

export function classifyPcPartListingPublic(input) {
  const base = classifyPcPartListing(input);
  const text = normalizedText(input);
  const listingType = publicListingType(base.listing_kind);
  const category = publicCategoryCode(base.category_code, text, base.listing_kind);
  const marketSegment = publicMarketSegment(text, category);
  const conditionGroup = publicConditionGroup(base.condition);
  const model = base.canonical_model;
  const canonicalProductId = publicCanonicalProductId(category, model, text, marketSegment);
  const exclusionReasons = unique([
    ...(base.exclusion_reasons || []),
    ...(category === 'UNSUPPORTED_CATEGORY' ? ['UNSUPPORTED_CATEGORY'] : []),
    ...(marketSegment !== 'CONSUMER_DESKTOP' ? ['MARKET_SEGMENT_OUT_OF_SCOPE'] : []),
    ...(!model && category !== 'UNSUPPORTED_CATEGORY' ? ['MODEL_AMBIGUOUS'] : []),
    ...((category === 'PSU' && !publicSpecificFields(category, model, text, base).rated_wattage) ? ['RATED_WATTAGE_UNCONFIRMED'] : []),
    ...((category === 'PSU' && /(?:케이블\s*(?:없음|누락)|케이블\s*미포함)/iu.test(text)) ? ['INCOMPLETE_CABLE_SET'] : [])
  ]);
  const fields = publicSpecificFields(category, model, text, base);
  const statisticsEligible = category !== 'UNSUPPORTED_CATEGORY'
    && marketSegment === 'CONSUMER_DESKTOP'
    && conditionGroup === 'USED_WORKING'
    && ['SINGLE', 'MULTI_SAME'].includes(listingType)
    && Boolean(canonicalProductId)
    && ['TOTAL', 'UNIT'].includes(base.price_scope)
    && exclusionReasons.length === 0;
  return {
    ...base,
    legacy_category_code: base.category_code,
    category_code: category,
    market_segment: marketSegment,
    listing_type: listingType,
    condition_group: conditionGroup,
    canonical_product_id: canonicalProductId,
    spec_group_id: publicSpecGroupId(category, model, text, marketSegment),
    classification_confidence: base.confidence?.category ?? 0,
    model_confidence: base.confidence?.model ?? 0,
    quantity_confidence: base.confidence?.quantity ?? 0,
    price_scope_confidence: base.confidence?.price_scope ?? 0,
    statistics_eligible: statisticsEligible,
    statistics_exclusion_reasons: exclusionReasons,
    parser_version: 'pc-parser-public-v1',
    rule_version: 'pc-rules-public-v1',
    ...fields
  };
}

export const PC_PART_CATEGORIES = Object.freeze([
  'CPU', 'GPU', 'RAM', 'MOTHERBOARD', 'SSD', 'HDD', 'PSU', 'CASE', 'COOLING', 'EXPANSION_CARD', 'ODD'
]);

export const PUBLIC_PC_PART_CATEGORIES = Object.freeze([
  'CPU', 'GPU', 'RAM', 'MOTHERBOARD', 'SSD', 'HDD', 'PSU'
]);
