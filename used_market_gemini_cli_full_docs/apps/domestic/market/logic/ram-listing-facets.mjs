// Browse attributes describe this listing, independently of its statistics identity.
export const RAM_MEMORY_USAGES = Object.freeze(['DESKTOP', 'LAPTOP', 'SERVER', 'UNKNOWN']);
export const RAM_USAGE_LABELS = Object.freeze({
  DESKTOP: '일반·데스크톱용', LAPTOP: '노트북용', SERVER: '서버용', UNKNOWN: '혼재·확인 필요'
});
export const RAM_SPEEDS_MT_S = Object.freeze([
  '800', '1066', '1333', '1600', '1866', '2133', '2400', '2666', '2800', '2933', '3000', '3200',
  '3333', '3400', '3466', '3600', '3733', '3800', '3866', '4000', '4133', '4200', '4266', '4400', '4500', '4600', '4800',
  '5000', '5200', '5333', '5400', '5600', '5800', '6000', '6200', '6400', '6600',
  '6800', '7000', '7200', '7400', '7600', '7800', '8000', '8200', '8400', '8600',
  '8800', '9000', '9200', '9600', '10000', '10400', '10800', '11200', '11600', '12000', 'UNKNOWN'
]);
const SPEEDS = new Set(RAM_SPEEDS_MT_S.filter(value => value !== 'UNKNOWN'));
const PC_RATE_ALIASES = new Map([
  ['3:6400', '800'], ['3:8500', '1066'], ['3:10600', '1333'], ['3:12800', '1600'],
  ['3:14900', '1866'], ['3:17000', '2133'], ['4:12800', '1600'], ['4:14900', '1866'],
  ['4:17000', '2133'], ['4:19200', '2400'], ['4:21300', '2666'], ['4:23400', '2933'],
  ['4:25600', '3200'], ['4:27700', '3466'], ['4:28800', '3600'], ['4:29800', '3733'],
  ['4:30900', '3866'], ['4:32000', '4000'], ['4:34100', '4266']
]);
for (const rate of RAM_SPEEDS_MT_S) {
  if (Number(rate) >= 4800) PC_RATE_ALIASES.set(`5:${Number(rate) * 8}`, rate);
}

function memoryUsage(title) {
  // Remove explicit negations before gathering positive evidence. Conflicting
  // sale descriptions stay searchable in UNKNOWN rather than choosing a side.
  const desktopDenied = /데스크\s*[탑톱](?:\s*용)?\s*(?:호환\s*)?(?:아님|아니[며고]|불가|미지원)|\b(?:NOT|NON)[ -]*(?:FOR\s+)?(?:DESKTOP|UDIMM|DIMM)\b/u.test(title);
  const text = title.replace(/(?:노트북|랩탑|데스크\s*[탑톱]|서버)(?:\s*용)?\s*(?:호환\s*)?(?:아님|아니[며고]|불가|미지원)/gu, ' ')
    .replace(/\b(?:NOT|NON)[ -]*(?:FOR\s+)?(?:LAPTOP|NOTEBOOK|DESKTOP|SERVER|SO[ -]?DIMM|UDIMM|DIMM|RDIMM|LRDIMM|REGISTERED|ECC)\b/gu, ' ');
  // Samsung's M471 module family is SO-DIMM even when the seller omits
  // "laptop" (e.g. the published M471A1K43CB1 SPD module-type record).
  const laptop = /SO[ -]?DIMM|노트북|랩탑|\b(?:LAPTOP|NOTEBOOK|M471[A-Z0-9]{6,})\b/u.test(text);
  const server = /(?:서버|\b(?:SERVER|ENTERPRISE|REGISTERED|RDIMM|LRDIMM)\b)/u.test(text);
  const desktop = /데스크\s*[탑톱]|\b(?:DESKTOP|UDIMM)\b/u.test(text)
    || (!laptop && !server && /\bDIMM\b/u.test(text));
  const usages = [desktop && 'DESKTOP', laptop && 'LAPTOP', server && 'SERVER'].filter(Boolean);
  if (usages.length === 1) return usages[0] === 'DESKTOP' && desktopDenied ? 'UNKNOWN' : usages[0];
  if (usages.length > 1 || desktopDenied || !text.trim() || /\bECC\b/u.test(text)) return 'UNKNOWN';
  // This broad browsing group includes unmarked ordinary RAM. It is not a
  // hardware-compatibility assertion and never rewrites statistics identity.
  return 'DESKTOP';
}

function memorySpeed(title) {
  const rates = new Set();
  const add = value => { if (SPEEDS.has(String(value))) rates.add(String(value)); };
  for (const match of title.matchAll(/\bPC([345])L?[ -]?(\d{4,6})(?!\d)/gu)) {
    const rate = PC_RATE_ALIASES.get(`${match[1]}:${match[2]}`);
    if (rate) add(rate);
  }
  // Bandwidth labels (PC4-21300) are not transfer rates. Part numbers and prices
  // are also insufficient evidence for the old first-four-digit parser.
  // Sellers sometimes write PC5-5600MHz. Its explicit rate unit is useful
  // evidence even though PC5 normally prefixes a bandwidth number.
  for (const match of title.matchAll(/(?:^|[^A-Z0-9])(\d{3,5})\s*(?:MT\s*\/?\s*S|MHZ|메가헤르츠)(?![A-Z])/gu)) add(match[1]);
  const text = title.replace(/\bPC[345]L?[ -]?\d{4,6}(?!\d)/gu, ' ');
  for (const match of text.matchAll(/(?:속도|클럭|\bCLOCK)\s*[:=-]?\s*(\d{3,5})(?!\d)/gu)) add(match[1]);
  for (const match of text.matchAll(/\bDDR\s*([345])L?\b([^\n,;]{0,80})/gu)) {
    for (const token of match[2].matchAll(/(?:^|[^A-Z0-9])(\d{3,5})(?:[A-Z]{1,2})?(?![A-Z0-9]|\s*(?:원|WON|₩|달러|USD|\$))/gu)) add(token[1]);
    for (const token of match[2].matchAll(/(?:^|[^A-Z0-9])(\d{4,6})[A-Z]{1,2}(?![A-Z0-9])/gu)) {
      const rate = PC_RATE_ALIASES.get(`${match[1]}:${token[1]}`);
      if (rate) add(rate);
    }
  }
  return rates.size === 1 ? [...rates][0] : 'UNKNOWN';
}

export function deriveRamListingFacets(title) {
  const text = String(title ?? '').normalize('NFKC').toUpperCase();
  return { memory_usage: memoryUsage(text), speed_mt_s: memorySpeed(text) };
}

export function matchesRamListingFacets(title, filters = {}) {
  const actual = deriveRamListingFacets(title);
  return ['memory_usage', 'speed_mt_s'].every(key => {
    const selected = Array.isArray(filters[key]) ? filters[key] : [];
    return selected.length === 0 || selected.some(value => String(value).toUpperCase() === actual[key]);
  });
}
