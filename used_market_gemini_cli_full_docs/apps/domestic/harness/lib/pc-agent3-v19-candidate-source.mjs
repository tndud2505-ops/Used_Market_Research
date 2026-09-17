// An OFFLINE correction proposal, not imported by the application. Applying
// this candidate to production requires a new parser/rule/normalization
// version, quality evaluation, migration and publication owned by agent 1.
import { createHash } from 'node:crypto';

export const V18_CLASSIFIER_BASE_SHA256 = 'bc34c7dd4bba0dba24bd24b9926e7b11af254ae500090957b3fa1c3012935353';

export function makeV19ClassifierCandidate(original) {
  if (createHash('sha256').update(original).digest('hex') !== V18_CLASSIFIER_BASE_SHA256) throw new Error('V19_CANDIDATE_BASE_CHANGED_REVIEW_REQUIRED');
  let source = original;
  const once = (before, after) => {
    if (!source.includes(before) || source.indexOf(before) !== source.lastIndexOf(before)) throw new Error('V19_PATCH_CONTEXT_NOT_UNIQUE');
    source = source.replace(before, after);
  };
  once('moduleCapacity = Number(countFirst ? match[2] : match[1]);', 'moduleCapacity = Number(match === countFirst ? match[2] : match[1]);');
  once('listedQuantity = Number(countFirst ? match[1] : match[2]);', 'listedQuantity = Number(match === countFirst ? match[1] : match[2]);');
  const start = source.indexOf('  const multiplication = capacityFirst || countFirst || compactKit || kit;');
  const end = source.indexOf('  const ramUnitMarker =', start);
  if (start < 0 || end < start) throw new Error('V19_RAM_CONTEXT_MISSING');
  source = source.slice(0, start) + String.raw`  const multiplication = capacityFirst || countFirst || compactKit || kit;
  const expressions = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(?:GB|G|기가)\s*[x×*]\s*(\d+)\b|(\d+)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*(?:GB|G|기가)(?![A-Z0-9])/giu)];
  const spans = expressions.map(match => [match.index, match.index + match[0].length]);
  if (multiplication) spans.push([multiplication.index, multiplication.index + multiplication[0].length]);
  const outsideMultiplication = text.split('').map((char, index) => spans.some(([from, to]) => index >= from && index < to) ? ' ' : char).join('');
  const declaredCapacities = multiplication ? [...outsideMultiplication.matchAll(/(?<![\d.])(\d+(?:\.\d+)?)\s*(?:GB|G|기가)(?![A-Z0-9])/giu)].map(match => Number(match[1])) : [];
  const capacityConflict = !partial && Boolean(multiplication) && (
    expressions.some(match => Number(match[1] ?? match[4]) !== moduleCapacity || Number(match[2] ?? match[3]) !== listedQuantity)
    || declaredCapacities.some(value => value !== moduleCapacity * listedQuantity));
  if (capacityConflict) quantityUnknown = true;
  const declaredKitTotal = !partial && !quantityUnknown && listedQuantity > 1 && moduleCapacity > 0
    && declaredCapacities.length > 0 && declaredCapacities.every(value => value === moduleCapacity * listedQuantity);
` + source.slice(end);
  once('    ram_unit_price_marker: ramUnitMarker,\n    quantity_unknown: quantityUnknown,', '    ram_unit_price_marker: ramUnitMarker,\n    capacity_conflict: capacityConflict,\n    quantity_unknown: quantityUnknown,');
  once("  if (quantityResult.quantity_unknown) exclusionReasons.push('QUANTITY_UNKNOWN');",
    "  if (quantityResult.quantity_unknown) exclusionReasons.push('QUANTITY_UNKNOWN');\n  if (quantityResult.capacity_conflict) exclusionReasons.push('RAM_CAPACITY_CONFLICT');");
  once('  // DDR4/DDR5 can be part of an official motherboard model name rather than', String.raw`  // An explicit network-card noun outranks generic Intel/X-series guesses.
  // Explicit CPU/board/RAM/GPU/storage wording is not reclassified this way.
  if (/(?:랜\s*카드|\b(?:NETWORK|ETHERNET)\s+(?:CARD|ADAPTER)\b)/iu.test(text)
    && !/(?:\bCPU\b|\bMOTHERBOARD\b|메인\s*보드|\bRAM\b|메모리|\b(?:SSD|HDD|RTX|GTX|RYZEN)\b|라이젠|\bI[3579]\s*-?\s*\d{4,5})/iu.test(text)) {
    addEvidence(evidence, 'category_code', 'explicit network card', 'EXPANSION_CARD');
    return 'EXPANSION_CARD';
  }
  // DDR4/DDR5 can be part of an official motherboard model name rather than`);
  once('["darkFlash", /\\bdarkFlash\\b/iu]', '["darkFlash", /(?:\\bdarkFlash\\b|다크플래시|다크플래쉬)/iu]');
  once("    ['CASE', /(?:PC\\s*케이스|컴퓨터\\s*케이스|Fractal\\s+Design\\s+North)/i],",
    "    ['CASE', /(?:PC\\s*케이스|컴퓨터\\s*케이스|Fractal\\s+Design\\s+North|(?:리안리|Lian\\s*Li|darkFlash|다크플래시|다크플래쉬).{0,80}케이스)/i],");
  once(String.raw`function storageCapacityGb(text) {
  const values = [...text.matchAll(/(?:^|[^0-9.])(\d+(?:\.\d+)?)\s*(TB|GB|테라(?:바이트)?)(?=$|[^A-Z가-힣]|(?:와|과|을|를|이|가|은|는|의)(?=\s|$))/giu)]`,
    String.raw`function storageCapacityGb(text) {
  const values = [...text.matchAll(/(?:^|[^0-9.])(\d+(?:\.\d+)?)\s*(TB|GB|G|테라(?:바이트)?)(?=$|[^A-Z가-힣]|(?:와|과|을|를|이|가|은|는|의)(?=\s|$))/giu)]`);
  return source;
}

export function rebaseModuleImports(source, originalUrl, overrides = new Map()) {
  return source.replace(/\bfrom\s+(['"])(\.[^'"]+)\1/gu, (_, quote, specifier) => {
    const resolved = new URL(specifier, originalUrl).href;
    return `from ${JSON.stringify(overrides.get(resolved) || resolved)}`;
  });
}
