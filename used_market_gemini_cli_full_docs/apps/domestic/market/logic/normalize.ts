import { NormalizedResultSchema, type SearchResult } from "../../MCP/logic/types.js";
import { trace } from "../../MCP/logic/runtime-trace.js";
import { ValidationError } from "../../MCP/logic/validation.js";
import { COMPONENT_PATTERNS, LISTING_TITLE_HINTS } from "./componentCatalog.js";

type EvidenceLevel = "estimated" | "confirmed";
type SourceKind = "title" | "search_notes" | "detail_body" | "mixed";
type DetailFetchStatus = "not_needed" | "success" | "unavailable" | "failed";

type MatchedComponent = {
  component_type: string;
  canonical_name: string;
  confidence: number;
  source_text: string;
  source_kind: SourceKind;
  evidence_level: EvidenceLevel;
};

type DetailLookupEntry = {
  text?: string;
  status?: DetailFetchStatus;
  note?: string;
};

type InferredListingStatus = {
  itemStatus: "active" | "sold" | "reserved" | "unknown";
  saleStatus: "active" | "reserved" | "completed";
};

export interface NormalizeSearchResultOptions {
  detailByUrl?: Map<string, DetailLookupEntry> | Record<string, DetailLookupEntry>;
  additionalWarnings?: string[];
}

function truncateText(value: string, maxLength = 220) {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function buildSourceSnippet(text: string, matchValue: string) {
  const normalizedText = text.replace(/\s+/g, " ").trim();
  if (normalizedText.length === 0) {
    return "";
  }

  const matchIndex = normalizedText.toLowerCase().indexOf(matchValue.toLowerCase());
  if (matchIndex < 0) {
    return truncateText(normalizedText, 160);
  }

  const start = Math.max(0, matchIndex - 50);
  const end = Math.min(normalizedText.length, matchIndex + matchValue.length + 70);
  return truncateText(normalizedText.slice(start, end), 160);
}

function inferRamGeneration(text: string) {
  if (/(DDR5|PC5[-\s]?\d+)/i.test(text)) {
    return "DDR5";
  }

  if (/(DDR4|PC4[-\s]?\d+)/i.test(text)) {
    return "DDR4";
  }

  return null;
}

function extractExplicitRamSegment(text: string) {
  const labeledMatch = text.match(/(?:\bRAM\b|\uB7A8|\uBA54\uBAA8\uB9AC)\s*[:：-]?\s*([^\n\r]{0,120})/i);
  if (labeledMatch?.[1]) {
    return labeledMatch[1].trim();
  }

  return null;
}

function hasRamContextNear(text: string, matchIndex: number, matchLength: number) {
  const start = Math.max(0, matchIndex - 28);
  const end = Math.min(text.length, matchIndex + matchLength + 28);
  const context = text.slice(start, end);
  return /(DDR[45]|PC[45][-:\s]?\d+|ram|memory|\uB7A8|\uBA54\uBAA8\uB9AC)/i.test(context);
}

function hasNonRamContextNear(text: string, matchIndex: number, matchLength: number) {
  const start = Math.max(0, matchIndex - 32);
  const end = Math.min(text.length, matchIndex + matchLength + 32);
  const context = text.slice(start, end);
  return /(graphics?\s*card|gpu|processor|cpu|core\s*\d|geforce|rtx\s*\d|rx\s*\d{3,4}|radeon|vram|gddr|vga|\uADF8\uB798\uD53D|\uADF8\uB798\uD53D\uCE74\uB4DC|\uBE44\uB514\uC624\uCE74\uB4DC|\uC9C0\uD3EC\uC2A4|\uB77C\uB370\uC628)/i.test(context);
}

function collectRamCapacityCandidates(text: string) {
  const patterns = [/\b(\d+)\s*GB\b/gi, /\b(\d+)\s*G\b/gi];
  const candidates: number[] = [];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = Number.parseInt(match[1], 10);
      if (!Number.isFinite(value)) {
        continue;
      }

      const index = match.index ?? 0;
      if (!hasRamContextNear(text, index, match[0].length)) {
        continue;
      }

      if (hasNonRamContextNear(text, index, match[0].length)) {
        continue;
      }

      candidates.push(value);
    }
  }

  return candidates;
}

function inferRamCapacity(text: string) {
  const quantityMultiplier = inferRamQuantityMultiplier(text);
  const moduleCapacity = inferRamKitModuleCapacity(text, quantityMultiplier);

  if (quantityMultiplier >= 3) {
    if (moduleCapacity && [8, 16, 32, 64].includes(moduleCapacity)) {
      return moduleCapacity;
    }
    return null;
  }

  const explicitTotalMatch = text.match(/(?:\uCD1D|total)\s*(\d+)\s*GB/i)
    ?? text.match(/\(\s*(\d+)\s*GB\s*\)/i)
    ?? text.match(/\[\s*(\d+)\s*GB\s*\]/i);
  if (explicitTotalMatch) {
    const total = Number.parseInt(explicitTotalMatch[1], 10);
    if ([8, 16, 32, 64].includes(total)) {
      return total;
    }
  }

  if (moduleCapacity && quantityMultiplier === 2) {
    const expanded = moduleCapacity * quantityMultiplier;
    if ([8, 16, 32, 64].includes(expanded)) {
      return expanded;
    }
  }

  const capacityCandidates = collectRamCapacityCandidates(text)
    .filter((value) => [8, 16, 32, 64].includes(value))
    .sort((left, right) => right - left);
  return capacityCandidates[0] ?? null;
}

function deriveRamComponent(
  text: string,
  sourceKind: Exclude<SourceKind, "mixed">,
  evidenceLevel: EvidenceLevel
): MatchedComponent | null {
  if (!/(DDR[45]|PC[45][-:\s]?\d+|ram|memory|\uB7A8|\uBA54\uBAA8\uB9AC)/i.test(text)) {
    return null;
  }

  const explicitRamSegment = extractExplicitRamSegment(text);
  const ramSourceText = explicitRamSegment ?? text;

  const generation = inferRamGeneration(ramSourceText) ?? inferRamGeneration(text);
  if (!generation) {
    return null;
  }

  const capacity = inferRamCapacity(ramSourceText);
  if (!capacity || ![8, 16, 32, 64].includes(capacity)) {
    return null;
  }

  const canonical = `${generation} ${capacity}GB`;
  return {
    component_type: "ram",
    canonical_name: canonical,
    confidence: evidenceLevel === "confirmed" ? 0.95 : 0.9,
    source_text: buildSourceSnippet(text, explicitRamSegment ?? canonical),
    source_kind: sourceKind,
    evidence_level: evidenceLevel
  };
}

function collectComponents(
  text: string,
  sourceKind: Exclude<SourceKind, "mixed">,
  evidenceLevel: EvidenceLevel
): MatchedComponent[] {
  const matched = new Map<string, MatchedComponent>();
  const normalizedText = text.replace(/\s+/g, " ").trim();
  if (normalizedText.length === 0) {
    return [];
  }

  for (const entry of COMPONENT_PATTERNS) {
    let matchedValue = "";

    for (const pattern of entry.patterns) {
      const result = pattern.exec(normalizedText);
      if (
        result?.[0]
        && shouldAcceptComponentMatch(
          entry.componentType,
          entry.canonical,
          normalizedText,
          result.index ?? 0,
          result[0],
          sourceKind
        )
      ) {
        matchedValue = result[0];
        break;
      }
    }

    if (!matchedValue) {
      continue;
    }

    matched.set(entry.canonical, {
      component_type: entry.componentType,
      canonical_name: entry.canonical,
      confidence: evidenceLevel === "confirmed" ? 0.95 : 0.85,
      source_text: buildSourceSnippet(normalizedText, matchedValue),
      source_kind: sourceKind,
      evidence_level: evidenceLevel
    });
  }

  const derivedRamComponent = deriveRamComponent(normalizedText, sourceKind, evidenceLevel);
  if (derivedRamComponent) {
    matched.set(derivedRamComponent.canonical_name, derivedRamComponent);
  }

  return [...matched.values()];
}

function hasStrongCpuContext(text: string) {
  return /(ryzen|core|intel|amd|cpu|processor|i3|i5|i7|i9)/i.test(text);
}

function hasPortableDeviceContext(text: string) {
  return /(\bnotebook\b|\blaptop\b|\bmacbook\b|\bmac\s*mini\b|\bimac\b|\ball[-\s]*in[-\s]*one\b|\baio\b|\bgalaxy\s*book\b|\bgram\b|\bvictus\b|\uB178\uD2B8\uBD81|\uB7A9\uD0D1|\uB9E5\uBD81|\uB9E5\uBBF8\uB2C8|\uC544\uC774\uB9E5|\uAC24\uB7ED\uC2DC\uBD81|\uADF8\uB7A8|\uC77C\uCCB4\uD615)/i.test(text);
}

function hasHddContext(text: string) {
  return /(\bhdd\b|hard\s*disk|\uD558\uB4DC(?:\uB514\uC2A4\uD06C)?)/i.test(text);
}

function isLikelyMemorySpeedContextEnhanced(text: string, matchIndex: number, matchValue: string) {
  const start = Math.max(0, matchIndex - 20);
  const end = Math.min(text.length, matchIndex + matchValue.length + 20);
  const context = text.slice(start, end);
  if (hasStrongCpuContext(context)) {
    return false;
  }

  const lowerContext = context.toLowerCase();
  return /(ddr\s*[45]|ddr[45]|ram|memory|pc5[-\s]?\d+|pc4[-\s]?\d+|expo|xmp)/i.test(context)
    || /\b\d+\s*gb\b/i.test(context)
    || /\[\s*\d+\s*gb\s*\]/i.test(context)
    || /\b\d{4,5}\s*(mhz|mt\/s)\b/i.test(lowerContext)
    || /\bpc[-\s]?\d+\b/i.test(lowerContext)
    || /\bcl\d+\b/i.test(lowerContext)
    || /\(\s*\d{4,5}\s*\)/i.test(context);
}

function shouldAcceptComponentMatch(
  componentType: string,
  canonicalName: string,
  text: string,
  matchIndex: number,
  matchValue: string,
  sourceKind: Exclude<SourceKind, "mixed">
) {
  if (componentType === "ram") {
    const canonicalIsDdr5 = /^DDR5\b/i.test(canonicalName);
    const canonicalIsDdr4 = /^DDR4\b/i.test(canonicalName);
    const hasDdr5Context = /(DDR5|PC5[-\s]?\d+)/i.test(text);
    const hasDdr4Context = /(DDR4|PC4[-\s]?\d+)/i.test(text);

    if (canonicalIsDdr5 && hasDdr4Context && !hasDdr5Context) {
      return false;
    }

    if (canonicalIsDdr4 && hasDdr5Context && !hasDdr4Context) {
      return false;
    }

    return true;
  }

  const contextStart = Math.max(0, matchIndex - 32);
  const contextEnd = Math.min(text.length, matchIndex + matchValue.length + 32);
  const localContext = text.slice(contextStart, contextEnd);

  if (componentType === "ssd") {
    if (hasHddContext(localContext)) {
      return false;
    }

    if (hasPortableDeviceContext(text)) {
      return false;
    }

    return true;
  }

  if (componentType !== "cpu") {
    return true;
  }

  if (/^Intel Core Ultra 5$/i.test(canonicalName) && hasPortableDeviceContext(text)) {
    return false;
  }

  const compact = matchValue.replace(/\s+/g, "");
  if (!/^\d{4,5}$/i.test(compact)) {
    return true;
  }

  if (sourceKind === "detail_body" && !hasStrongCpuContext(localContext)) {
    return false;
  }

  return !isLikelyMemorySpeedContextEnhanced(text, matchIndex, matchValue);
}

function mergeSourceKind(current: SourceKind, next: SourceKind): SourceKind {
  if (current === next) {
    return current;
  }
  if (current === "mixed" || next === "mixed") {
    return "mixed";
  }
  return "mixed";
}

function mergeMatchedComponents(groups: MatchedComponent[][]): MatchedComponent[] {
  const merged = new Map<string, MatchedComponent>();

  for (const group of groups) {
    for (const component of group) {
      const existing = merged.get(component.canonical_name);
      if (!existing) {
        merged.set(component.canonical_name, { ...component });
        continue;
      }

      existing.confidence = Math.max(existing.confidence, component.confidence);
      existing.source_kind = mergeSourceKind(existing.source_kind, component.source_kind);
      existing.evidence_level = (
        existing.evidence_level === "confirmed" || component.evidence_level === "confirmed"
      ) ? "confirmed" : "estimated";
      if (!existing.source_text && component.source_text) {
        existing.source_text = component.source_text;
      }
    }
  }

  return [...merged.values()];
}

function matchesAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

function countModelTokens(text: string) {
  return text.match(
    /(rtx\s*\d{4}(?:\s*ti)?|rx\s*\d{4}(?:\s*xt)?|gtx\s*\d{3,4}|(?:ryzen|i[3579]|ultra)\s*[- ]?\d{0,2}[ ]?\d{4,5}[a-z0-9-]*|\b\d{4,5}(?:x3d|[fgkx])\b)/gi
  )?.length ?? 0;
}

function hasFullPcSaleContext(text: string) {
  return /(full\s*pc|gaming\s*(?:pc|desktop)|desktop\s*pc|tower\s*pc|system\s*unit|\uBCF8\uCCB4|\uC870\uB9BD\s*pc|\uAC8C\uC774\uBC0D\s*(?:pc|\uCEF4\uD4E8\uD130|\uB370\uC2A4\uD06C\uD0D1)|\uCEF4\uD4E8\uD130\s*(?:\uBCF8\uCCB4|\uC0C8\uC81C\uD488)?|\uB370\uC2A4\uD06C\uD0D1(?!\uC6A9)|\bpc\b.*(?:\uD31D\uB2C8\uB2E4|\uD310\uB9E4)|(?:\uD31D\uB2C8\uB2E4|\uD310\uB9E4).*\bpc\b)/i.test(text);
}

function hasListingTitleHint(text: string, listingType: "full_pc" | "semi_pc" | "part") {
  const entry = LISTING_TITLE_HINTS.find((candidate) => candidate.listingType === listingType);
  return entry ? matchesAny(text, entry.patterns) : false;
}

function detectListingType(
  text: string,
  componentTypes: string[],
  hint: SearchResult["items"][number]["listing_type_hint"]
): "full_pc" | "semi_pc" | "part" | "unknown" {
  if (hasPortablePcHint(text)) return "unknown";

  const hasGpu = componentTypes.includes("gpu");
  const hasCpu = componentTypes.includes("cpu");
  const hasRam = componentTypes.includes("ram");
  const hasStorage = componentTypes.includes("ssd");
  const hasFullPcKeyword = hasListingTitleHint(text, "full_pc");
  const hasSemiPcKeyword = hasListingTitleHint(text, "semi_pc");
  const hasPcSaleContext = hasFullPcSaleContext(text);
  const modelTokenCount = countModelTokens(text);
  const partOnlyTypes = componentTypes.every((componentType) => ["ram", "ssd", "psu", "motherboard"].includes(componentType));
  const hasPartSaleContext = /(ram|memory|\uB7A8|\uBA54\uBAA8\uB9AC|udimm|dimm|sodimm|so[-\s]?dimm|ssd|nvme|m\.2|motherboard|mainboard|mobo|\uBA54\uC778\uBCF4\uB4DC|psu|power|\uD30C\uC6CC)/i.test(text);

  if (componentTypes.length > 0 && !hasCpu && !hasGpu && partOnlyTypes && hasPartSaleContext) return "part";

  if (hasGpu && hasCpu && (hasRam || hasStorage || hasFullPcKeyword || hasPcSaleContext)) return "full_pc";
  if ((hasCpu || hasGpu) && hasPcSaleContext && modelTokenCount >= 2) return "full_pc";
  if ((hasFullPcKeyword || hint === "full_pc") && !partOnlyTypes) return "full_pc";
  if ((hasSemiPcKeyword || hint === "semi_pc") && (hasCpu || hasRam || hasStorage)) return "semi_pc";
  if (componentTypes.length > 0 || hint === "part") return "part";
  return hint;
}

function expectedComponentTypes(listingType: "full_pc" | "semi_pc" | "part" | "unknown") {
  if (listingType === "full_pc") {
    return ["cpu", "gpu", "ram", "ssd", "psu", "motherboard"];
  }

  if (listingType === "semi_pc") {
    return ["cpu", "ram", "ssd", "psu", "motherboard"];
  }

  return [];
}

function uniqueComponentTypes(components: MatchedComponent[]) {
  return Array.from(new Set(components.map((component) => component.component_type)));
}

function buildUnknownComponentTypes(
  listingType: "full_pc" | "semi_pc" | "part" | "unknown",
  components: MatchedComponent[]
) {
  const knownTypes = new Set(uniqueComponentTypes(components));
  return expectedComponentTypes(listingType).filter((componentType) => !knownTypes.has(componentType));
}

function hasPortablePcHint(text: string) {
  const primaryContext = text.replace(/\s+/g, " ").trim().slice(0, 240);
  return /\b(laptop|notebook)\b/i.test(primaryContext) || /\uB178\uD2B8\uBD81|\uB7A9\uD0D1/i.test(primaryContext);
}

function normalizeComponentToken(value: string) {
  return value
    .toLowerCase()
    .replace(/^nvidia\s+/i, "")
    .replace(/^amd\s+radeon\s+/i, "")
    .replace(/^amd\s+/i, "")
    .replace(/^intel\s+core\s+/i, "")
    .replace(/\bunknown\b/gi, "")
    .replace(/[^a-z0-9]+/g, "");
}

function pickPreferredComponent(current: MatchedComponent, candidate: MatchedComponent) {
  const currentToken = normalizeComponentToken(current.canonical_name);
  const candidateToken = normalizeComponentToken(candidate.canonical_name);

  if (candidate.evidence_level === "confirmed" && current.evidence_level !== "confirmed") {
    return candidate;
  }

  if (candidate.evidence_level !== "confirmed" && current.evidence_level === "confirmed") {
    return current;
  }

  if (candidate.confidence !== current.confidence) {
    return candidate.confidence > current.confidence ? candidate : current;
  }

  if (candidateToken.length !== currentToken.length) {
    return candidateToken.length > currentToken.length ? candidate : current;
  }

  return candidate.source_text.length > current.source_text.length ? candidate : current;
}

function componentsConflict(left: MatchedComponent, right: MatchedComponent) {
  if (left.component_type !== right.component_type) {
    return false;
  }

  const leftToken = normalizeComponentToken(left.canonical_name);
  const rightToken = normalizeComponentToken(right.canonical_name);
  if (!leftToken || !rightToken) {
    return false;
  }

  return leftToken === rightToken
    || leftToken.startsWith(rightToken)
    || rightToken.startsWith(leftToken);
}

function resolveComponentConflicts(components: MatchedComponent[]) {
  const resolved: MatchedComponent[] = [];

  for (const component of components) {
    const conflictIndex = resolved.findIndex((existing) => componentsConflict(existing, component));
    if (conflictIndex < 0) {
      resolved.push(component);
      continue;
    }

    resolved[conflictIndex] = pickPreferredComponent(resolved[conflictIndex], component);
  }

  return resolved;
}

function extractCapacityScore(component: MatchedComponent) {
  const match = component.canonical_name.match(/(\d+)(TB|GB)/i);
  if (!match) {
    return 0;
  }

  const value = Number.parseInt(match[1], 10);
  if (!Number.isFinite(value)) {
    return 0;
  }

  return match[2].toUpperCase() === "TB" ? value * 1000 : value;
}

function inferRamQuantityMultiplier(sourceText: string) {
  if (!sourceText) {
    return 1;
  }

  if (/(?:\(\s*\uC218\uB7C9\s*4\s*\)|\uC218\uB7C9\s*4|\(\s*4\s*\)|4\s*EA|4\uAC1C|4\uC7A5|\bx\s*4\b|\b4x\b|\*\s*4\b|\b4\s*\*)/i.test(sourceText)) {
    return 4;
  }

  if (/(?:\(\s*\uC218\uB7C9\s*3\s*\)|\uC218\uB7C9\s*3|\(\s*3\s*\)|3\s*EA|3\uAC1C|3\uC7A5|\bx\s*3\b|\b3x\b|\*\s*3\b|\b3\s*\*)/i.test(sourceText)) {
    return 3;
  }

  if (/(?:\(\s*\uC218\uB7C9\s*2\s*\)|\uC218\uB7C9\s*2|\(\s*2\s*\)|2\s*EA|2\uAC1C|\bx\s*2\b|\b2x\b|\*\s*2\b|\b2\s*\*)/i.test(sourceText)) {
    return 2;
  }

  return 1;
}

function inferRamKitModuleCapacity(sourceText: string, multiplier = inferRamQuantityMultiplier(sourceText)) {
  if (!sourceText) {
    return null;
  }

  if (multiplier <= 1) {
    return null;
  }

  const patterns = [
    new RegExp(`(\\d+)\\s*GB\\s*[x*]\\s*${multiplier}`, "i"),
    new RegExp(`(\\d+)\\s*G\\s*[x*]\\s*${multiplier}`, "i"),
    new RegExp(`(\\d+)\\s*[x*]\\s*${multiplier}(?=\\D|$)`, "i"),
    new RegExp(`\\b${multiplier}\\s*[x*]\\s*(\\d+)\\s*GB\\b`, "i"),
    new RegExp(`\\b${multiplier}\\s*[x*]\\s*(\\d+)\\s*G\\b`, "i"),
    new RegExp(`\\b${multiplier}\\s*[x*]\\s*(\\d+)(?=\\D|$)`, "i"),
    new RegExp(`(\\d+)\\s*GBx${multiplier}\\b`, "i"),
    new RegExp(`(\\d+)\\s*Gx${multiplier}\\b`, "i"),
    new RegExp(`(\\d+)\\s*gb\\s*\\*\\s*${multiplier}`, "i"),
    new RegExp(`(\\d+)\\s*g\\s*\\*\\s*${multiplier}`, "i")
  ];

  for (const pattern of patterns) {
    const match = sourceText.match(pattern);
    if (!match) {
      continue;
    }

    const value = Number.parseInt(match[1], 10);
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
  }

  return null;
}

function upgradeRamCapacityFromQuantity(component: MatchedComponent) {
  if (component.component_type !== "ram") {
    return component;
  }

  const multiplier = inferRamQuantityMultiplier(component.source_text);
  if (multiplier <= 1) {
    return component;
  }

  const match = component.canonical_name.match(/DDR([45])\s+(\d+)GB/i);
  if (!match) {
    return component;
  }

  const generation = match[1];
  const capacity = Number.parseInt(match[2], 10);
  if (!Number.isFinite(capacity) || capacity <= 0) {
    return component;
  }

  const moduleCapacity = inferRamKitModuleCapacity(component.source_text, multiplier);
  if (multiplier >= 3) {
    if (moduleCapacity && moduleCapacity !== capacity && moduleCapacity * multiplier === capacity) {
      return {
        ...component,
        canonical_name: `DDR${generation} ${moduleCapacity}GB`
      };
    }
    return component;
  }

  if (moduleCapacity && moduleCapacity * multiplier === capacity) {
    return component;
  }

  const upgradedCapacity = capacity * multiplier;
  const upgradedCanonical = `DDR${generation} ${upgradedCapacity}GB`;
  if (!/^DDR[45] (8|16|32|64)GB$/i.test(upgradedCanonical)) {
    return component;
  }

  return {
    ...component,
    canonical_name: upgradedCanonical
  };
}

function collapseSingleBucketTypes(components: MatchedComponent[]) {
  const bestByType = new Map<string, MatchedComponent>();
  const passthrough: MatchedComponent[] = [];

  for (const component of components) {
    const normalizedComponent = component.component_type === "ram"
      ? upgradeRamCapacityFromQuantity(component)
      : component;

    if (normalizedComponent.component_type !== "ram") {
      passthrough.push(normalizedComponent);
      continue;
    }

    const existing = bestByType.get(normalizedComponent.component_type);
    if (!existing) {
      bestByType.set(normalizedComponent.component_type, normalizedComponent);
      continue;
    }

    const existingCapacity = extractCapacityScore(existing);
    const candidateCapacity = extractCapacityScore(normalizedComponent);
    if (candidateCapacity !== existingCapacity) {
      bestByType.set(
        normalizedComponent.component_type,
        candidateCapacity > existingCapacity ? normalizedComponent : existing
      );
      continue;
    }

    const existingIsDdr5 = /DDR5/i.test(existing.canonical_name);
    const candidateIsDdr5 = /DDR5/i.test(normalizedComponent.canonical_name);
    if (existingIsDdr5 !== candidateIsDdr5) {
      bestByType.set(normalizedComponent.component_type, candidateIsDdr5 ? normalizedComponent : existing);
      continue;
    }

    bestByType.set(normalizedComponent.component_type, pickPreferredComponent(existing, normalizedComponent));
  }

  return [...passthrough, ...bestByType.values()];
}

function applyDetailComponentHeuristics(components: MatchedComponent[], detailText: string) {
  if (!detailText) {
    return components;
  }

  const adjusted = components.map((component) => {
    if (
      component.component_type === "ram"
      && /^DDR4 \d+GB$/i.test(component.canonical_name)
      && /(DDR5|PC5[-\s]?\d+)/i.test(detailText)
    ) {
      return {
        ...component,
        canonical_name: component.canonical_name.replace(/^DDR4/i, "DDR5")
      };
    }

    return component;
  });

  const hasSsd = adjusted.some((component) => component.component_type === "ssd");
  if (!hasSsd) {
    if (/(P41|Platinum P41)/i.test(detailText) && /\b1TB\b/i.test(detailText)) {
      adjusted.push({
        component_type: "ssd",
        canonical_name: "SSD 1TB",
        confidence: 0.95,
        source_text: buildSourceSnippet(detailText, "P41"),
        source_kind: "detail_body",
        evidence_level: "confirmed"
      });
    } else if (/(P41|Platinum P41)/i.test(detailText) && /\b2TB\b/i.test(detailText)) {
      adjusted.push({
        component_type: "ssd",
        canonical_name: "SSD 2TB",
        confidence: 0.95,
        source_text: buildSourceSnippet(detailText, "P41"),
        source_kind: "detail_body",
        evidence_level: "confirmed"
      });
    }
  }

  return adjusted;
}

function readDetailEntry(
  lookup: NormalizeSearchResultOptions["detailByUrl"],
  url: string
): DetailLookupEntry | undefined {
  if (!lookup || !url) {
    return undefined;
  }

  if (lookup instanceof Map) {
    return lookup.get(url);
  }

  return lookup[url];
}

function looksLikeCrawlerMetadata(text: string) {
  return /(source=|site=|row=|tag=|public-api)/i.test(text);
}

function sanitizeClassifierNotes(text: string) {
  return looksLikeCrawlerMetadata(text) ? "" : text;
}

function inferListingStatus(
  item: SearchResult["items"][number],
  detailText: string
): InferredListingStatus {
  const initialItemStatus = item.status;
  const initialSaleStatus = item.sale_status;
  const combined = `${item.title} ${item.notes} ${detailText}`.replace(/\s+/g, " ").trim();

  if (/판매완료|거래완료|sold\s*out|completed/i.test(combined)) {
    return {
      itemStatus: "sold",
      saleStatus: "completed"
    };
  }

  if (/예약중|예약\s*중|reserved/i.test(combined)) {
    return {
      itemStatus: "reserved",
      saleStatus: "reserved"
    };
  }

  return {
    itemStatus: initialItemStatus,
    saleStatus: initialSaleStatus
  };
}

export function normalizeSearchResult(
  searchResult: SearchResult,
  options: NormalizeSearchResultOptions = {}
) {
  trace("market.normalize:start", {
    site: searchResult.site,
    keyword: searchResult.keyword,
    incoming_items: searchResult.items.length
  });
  if (!searchResult.keyword || searchResult.keyword.trim() === "") {
    throw new ValidationError("INVALID_KEYWORD", "Keyword must be a non-empty string");
  }

  if (!searchResult.items || searchResult.items.length === 0) {
    const emptyResult = NormalizedResultSchema.parse({
      site: searchResult.site,
      keyword: searchResult.keyword,
      category: searchResult.category,
      normalized_items: [],
      warnings: [
        "No items to process - upstream collector may have failed",
        ...searchResult.warnings,
        ...(options.additionalWarnings ?? [])
      ],
      next_action: "skip_normalization"
    });
    trace("market.normalize:empty", {
      site: searchResult.site,
      keyword: searchResult.keyword,
      warning_count: emptyResult.warnings.length
    });
    return emptyResult;
  }

  const normalized = {
    site: searchResult.site,
    keyword: searchResult.keyword,
    category: searchResult.category,
    warnings: [...searchResult.warnings, ...(options.additionalWarnings ?? [])],
    next_action: "continue",
    normalized_items: searchResult.items.map((item) => {
      const detailEntry = readDetailEntry(options.detailByUrl, item.url);
      const detailText = typeof detailEntry?.text === "string" ? detailEntry.text : "";
      const detailStatus = detailEntry?.status ?? "not_needed";
      const classifierNotes = sanitizeClassifierNotes(item.notes);

      const titleComponents = collectComponents(item.title, "title", "estimated");
      const noteComponents = classifierNotes
        ? collectComponents(classifierNotes, "search_notes", "estimated")
        : [];
      const detailComponents = detailText
        ? collectComponents(detailText, "detail_body", "confirmed")
        : [];
      const effectiveDetailStatus: DetailFetchStatus = (
        detailEntry?.status === "success" && detailComponents.length === 0
      )
        ? "failed"
        : detailStatus;
      const components = applyDetailComponentHeuristics(
        collapseSingleBucketTypes(
          resolveComponentConflicts(
            mergeMatchedComponents([titleComponents, noteComponents, detailComponents])
          )
        ),
        detailText
      );
      const classificationText = `${item.title} ${classifierNotes} ${detailText}`.trim();
      const listingType = detectListingType(
        classificationText,
        uniqueComponentTypes(components),
        item.listing_type_hint
      );
      const detailEnriched = effectiveDetailStatus === "success" && detailComponents.length > 0;
      const inferredStatus = inferListingStatus(item, detailText);

      return {
        title: item.title,
        price_value: item.price,
        currency: item.currency,
        price_label: item.price_label,
        seller_name: item.seller,
        item_status: inferredStatus.itemStatus,
        condition: item.condition,
        shipping: item.shipping,
        location: item.location,
        posted_at: item.posted_at,
        url: item.url,
        image_url: item.image_url,
        raw_notes: item.notes,
        listing_type: listingType,
        components,
        detail_enriched: detailEnriched,
        detail_fetch_status: effectiveDetailStatus,
        detail_fetch_note: (
          detailEntry?.status === "success" && detailComponents.length === 0
            ? `${detailEntry.note ? `${detailEntry.note}; ` : ""}no components confirmed from detail`
            : detailEntry?.note ?? ""
        ),
        detail_excerpt: detailEnriched ? truncateText(detailText, 240) : "",
        component_resolution: detailEnriched ? "detail_enriched" : "search_only",
        confirmed_component_count: components.filter((component) => component.evidence_level === "confirmed").length,
        unknown_component_types: buildUnknownComponentTypes(listingType, components),
        sale_status: inferredStatus.saleStatus,
        estimated_deal_price: item.estimated_deal_price,
        price_change_count: item.price_change_count,
        upload_date: item.upload_date,
        seller_upload_count: item.seller_upload_count,
        description_length: item.description_length,
        has_photo: item.has_photo,
        canonical_category_id: item.canonical_category_id,
        canonical_category_path: item.canonical_category_path,
        source_category_id: item.source_category_id,
        source_category_ids: item.source_category_ids,
        source_category_path: item.source_category_path,
        category_confidence: item.category_confidence,
        category_mapping_mode: item.category_mapping_mode,
        category_mapping_confidence: item.category_mapping_confidence
      };
    })
  };

  const result = NormalizedResultSchema.parse(normalized);
  trace("market.normalize:complete", {
    site: result.site,
    keyword: result.keyword,
    normalized_items: result.normalized_items.length,
    warning_count: result.warnings.length
  });
  return result;
}

