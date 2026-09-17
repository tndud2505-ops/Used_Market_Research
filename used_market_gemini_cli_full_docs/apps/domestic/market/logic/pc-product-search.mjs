// Search aliases are deliberately separate from approved product-identity aliases.
// A brand-only search must never register every product as the same SKU.
const BRAND_SEARCH_ALIASES = Object.freeze({
  Intel: ['인텔'], AMD: ['에이엠디'], NVIDIA: ['엔비디아'],
  Samsung: ['삼성', '삼성전자'], 'SK hynix': ['하이닉스', 'SK하이닉스', 'Hynix'],
  Micron: ['마이크론'], Crucial: ['크루셜'], Kingston: ['킹스톤'],
  Corsair: ['커세어'], 'G.Skill': ['gskill', 'G SKILL', 'G-SKILL', '지스킬'],
  TeamGroup: ['팀그룹', 'Team Group', 'T-Force', '티포스'],
  ASUS: ['아수스', '에이수스'], GIGABYTE: ['기가바이트'], MSI: ['엠에스아이'],
  ASRock: ['애즈락', '아스락'], Biostar: ['바이오스타'],
  'Western Digital': ['WD', '웨스턴디지털', '웨스턴 디지털'],
  Seagate: ['씨게이트', '시게이트'], Toshiba: ['도시바'],
  SanDisk: ['샌디스크'], Kioxia: ['키옥시아'], Solidigm: ['솔리다임'],
  Seasonic: ['시소닉'], FSP: ['에프에스피'], 'Super Flower': ['슈퍼플라워'],
  'Cooler Master': ['쿨러마스터'], Thermaltake: ['써멀테이크'],
  'be quiet!': ['비콰이어트'], Antec: ['안텍'], Micronics: ['마이크로닉스'],
  Noctua: ['녹투아'], Thermalright: ['써멀라이트'], DeepCool: ['딥쿨'],
  'Lian Li': ['리안리'], 'Fractal Design': ['프랙탈', '프랙탈디자인'],
  Phanteks: ['팬텍스'], ABKO: ['앱코'], darkFlash: ['다크플래쉬', '다크플래시']
});

export function pcBrandSearchAliases(brand) {
  return BRAND_SEARCH_ALIASES[brand] || [];
}

function normalized(value) {
  return String(value ?? '').normalize('NFKC').toLocaleLowerCase('ko-KR').trim();
}

function compact(value) {
  return normalized(value).replace(/[^\p{L}\p{N}]+/gu, '');
}

export function pcProductSearchValues(product) {
  const spec = { ...(product.spec || {}), ...(product.browse_facets || {}), ...(product.key_specs || {}) };
  return [product.id, product.canonical_product_id, product.name, product.canonical_display_name,
    product.category, product.category_code, product.group, product.manufacturer, product.brand,
    ...(product.aliases || []), ...pcBrandSearchAliases(product.manufacturer || product.brand),
    ...Object.values(spec).flat()].filter(value => typeof value === 'string' || typeof value === 'number');
}

export function pcProductMatchesQuery(product, query) {
  const requested = normalized(query);
  if (!requested) return true;
  const values = pcProductSearchValues(product);
  const key = compact(requested);
  if (!key) return false;
  const searchable = values.map(value => ({ text: normalized(value), tokens: normalized(value).split(/[^\p{L}\p{N}]+/gu).filter(Boolean) }));
  if (searchable.some(value => value.text === requested || value.tokens.join('') === key)) return true;
  if (key.length >= 4 && searchable.some(({ tokens }) => tokens.some((_, start) =>
    tokens.slice(start).some((_, offset) => tokens.slice(start, start + offset + 1).join('') === key)))) return true;
  const tokens = requested.split(/[^\p{L}\p{N}]+/gu).filter(Boolean);
  const allTokens = new Set(searchable.flatMap(value => value.tokens));
  return tokens.length > 0 && tokens.every(token => allTokens.has(token));
}
