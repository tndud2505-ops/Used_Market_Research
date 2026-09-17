// This module consumes the API's search-only aliases, not product identity aliases.
const SCHEMA = Object.freeze({
  CPU: [['generation', '세대'], ['socket', 'CPU 소켓']],
  GPU: [['generation', '세대'], ['vram_gb', 'VRAM 규격']],
  RAM: [['memory_generation', 'DDR 세대'], ['module_capacity_gb', '개당 용량']],
  MOTHERBOARD: [['socket', 'CPU 소켓'], ['chipset', '칩셋']],
  SSD: [['capacity_bucket', '용량 구간']], HDD: [['capacity_bucket', '용량 구간']],
  PSU: [['watts_bucket', '정격 출력']], CASE: [['chassis_class', '케이스 크기']],
  COOLING: [['subtype', '쿨러 종류']]
});
const LABELS = Object.freeze({
  LE_256_GB: '256GB 이하', '257_512_GB': '257~512GB', '513_GB_1_TB': '513GB~1TB',
  LE_1_TB: '1TB 이하', GT_1_TB_LE_2_TB: '1TB 초과~2TB', GT_2_TB_LE_4_TB: '2TB 초과~4TB',
  GT_4_TB_LE_6_TB: '4TB 초과~6TB', GT_4_TB_LE_8_TB: '4TB 초과~8TB', GT_6_TB_LE_8_TB: '6TB 초과~8TB',
  GT_8_TB_LE_12_TB: '8TB 초과~12TB', GT_12_TB_LE_16_TB: '12TB 초과~16TB',
  GT_16_TB_LE_20_TB: '16TB 초과~20TB', GT_20_TB_LE_24_TB: '20TB 초과~24TB',
  GT_24_TB: '24TB 초과', GT_8_TB: '8TB 초과',
  LE_500: '500W 이하', '501_650': '501~650W', '651_750': '651~750W', '751_850': '751~850W',
  '851_1000': '851~1000W', '1001_1200': '1001~1200W', GT_1200: '1200W 초과',
  MID_TOWER: '미들타워', MINI_TOWER: '미니타워', FULL_TOWER: '빅타워',
  AIR_CPU: 'CPU 공랭', AIO: 'CPU 수랭', CASE_FAN: '케이스 팬'
});
const text = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase('ko-KR').trim();
const compact = value => text(value).replace(/[^\p{L}\p{N}]+/gu, '');
export const toolFilterSchema = category => SCHEMA[category] || [];
export function toolBrand(product) {
  const spec = product.key_specs || {};
  return String((product.category_code === 'GPU' ? spec.chip_manufacturer : '') || product.brand || '');
}
export function toolFacetValues(product, key) {
  const spec = product.key_specs || {};
  const raw = key === 'vram_gb' ? (spec.vram_gb || spec.vram_options_gb) : spec[key];
  return [...new Set([raw].flat().filter(v => typeof v === 'string' || typeof v === 'number').map(String))];
}
export function toolFacetLabel(key, value) {
  if (['module_capacity_gb', 'vram_gb'].includes(key)) return `${value}GB`;
  return LABELS[value] || value;
}
export function toolQueryMatches(product, query) {
  const requested = text(query); if (!requested) return true;
  const values = [product.canonical_product_id, product.canonical_display_name, product.category_code,
    product.brand, ...(product.aliases || []), ...Object.values(product.key_specs || {}).flat()]
    .filter(v => typeof v === 'string' || typeof v === 'number');
  const key = compact(requested); if (!key) return false;
  const searchable = values.map(v => ({ text: text(v), tokens: text(v).split(/[^\p{L}\p{N}]+/gu).filter(Boolean) }));
  if (searchable.some(v => v.text === requested || v.tokens.join('') === key)) return true;
  if (key.length >= 4 && searchable.some(({ tokens }) => tokens.some((_, start) =>
    tokens.slice(start).some((_, offset) => tokens.slice(start, start + offset + 1).join('') === key)))) return true;
  const tokens = requested.split(/[^\p{L}\p{N}]+/gu).filter(Boolean);
  const allTokens = new Set(searchable.flatMap(v => v.tokens));
  return tokens.length > 0 && tokens.every(token => allTokens.has(token));
}
export function filterToolProducts(products, { category = '', manufacturer = '', query = '', facets = {} } = {}) {
  return products.filter(p => (!category || p.category_code === category)
    && (p.category_code !== 'MOTHERBOARD' || p.key_specs?.directory_node_type === 'PRODUCT')
    && (!manufacturer || toolBrand(p) === manufacturer)
    && toolQueryMatches(p, query)
    && Object.entries(facets).every(([key, value]) => !value || toolFacetValues(p, key).includes(String(value))));
}
export function visibleSelection(products, currentId) {
  return products.some(p => p.canonical_product_id === currentId) ? currentId : products[0]?.canonical_product_id || '';
}
export function toolScopeNote(category) {
  if (['CASE', 'COOLING'].includes(category)) return '제조사 × 종류별 참고 시세이며, 정확 모델별 가격은 아닙니다. 정상 중고 단품의 표본이 부족하면 합계에서 제외됩니다. 케이스 크기·쿨러 장착 규격을 별도로 확인하세요.';
  if (category === 'RAM') return 'RAM 가격은 1개 모듈 기준입니다. 16GB 두 개로 32GB를 구성하려면 수량을 2로 선택하세요. 속도·타이밍·제품군별 가격 차이는 매물에서 확인하세요.';
  if (['SSD', 'HDD'].includes(category)) return '제조사 × 용량 구간의 참고 시세입니다. NVMe·SATA·세부 모델별 시세가 아니며 외장·서버용은 데스크톱 기준 통계에서 제외됩니다.';
  if (category === 'PSU') return '제조사 × 정격 출력 구간의 참고 시세입니다. ATX·SFX 크기, 커넥터·케이블과 효율 등급은 매물에서 별도로 확인하세요.';
  if (category === 'MOTHERBOARD') return '검증된 정확 모델만 가격 분석에 포함합니다. CPU 소켓과 DDR 규격이 맞는지 확인하세요.';
  if (category === 'GPU') return 'GPU 칩 모델 기준 참고 시세입니다. 같은 모델의 VRAM 옵션·보드 제조사별 가격이 섞일 수 있으므로 실제 매물의 규격을 확인하세요.';
  return '판매중·판매완료 마지막 표시가는 서로 다른 가격입니다. 대표가격 표본이 부족한 부품은 합계에서 제외됩니다.';
}
