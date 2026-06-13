import type { NormalizedItem, NormalizedResult } from "../../MCP/logic/types.js";

export type NoiseFilterReason =
  | "non_pc_product"
  | "guide_or_advertisement"
  | "placeholder_price"
  | "bundled_part_offer"
  | "part_build_leak"
  | "faulty_or_parts_only"
  | "inactive_listing"
  | "stale_listing";

const HARD_PRUNE_NOISE_REASONS = new Set<NoiseFilterReason>([
  "non_pc_product",
  "faulty_or_parts_only",
  "inactive_listing",
  "stale_listing"
]);

type NoiseFilterCandidate = Pick<
  NormalizedItem,
  "title" | "raw_notes" | "listing_type" | "components" | "price_value" | "seller_upload_count" | "detail_excerpt" | "item_status" | "sale_status" | "posted_at" | "upload_date"
>;

type AnnotatedNoiseCandidate = NoiseFilterCandidate & {
  noise_filtered?: boolean;
  noise_filter_reason?: string;
};

const MODEL_TOKEN_PATTERN = /(rtx\s*\d{4}(?:\s*ti)?|rx\s*\d{4}(?:\s*xt)?|gtx\s*\d{3,4}|(?:ryzen|i[3579]|ultra)\s*[- ]?\d{0,2}[ ]?\d{4,5}[a-z0-9-]*|\b\d{4,5}(?:x3d|[fgkx])\b)/gi;
const NON_PC_PRODUCT_PATTERN = new RegExp([
  "\\uB2CC\\uD150\\uB3C4",
  "\\uC2A4\\uC704\\uCE58",
  "switch",
  "\\uCC45\\uC0C1",
  "\\uC758\\uC790",
  "\\uCEF4\\uD4E8\\uD130\\s*\\uCC45\\uC0C1",
  "\\uCEF4\\uD4E8\\uD130\\s*\\uC758\\uC790",
  "\\uAC8C\\uC774\\uBC0D\\s*\\uCC45\\uC0C1",
  "\\uAC8C\\uC774\\uBC0D\\s*\\uC758\\uC790",
  "\\bdesk\\b",
  "\\bchair\\b",
  "\\uD0DC\\uBE14\\uB9BF",
  "tablet",
  "tabletpc",
  "ipad",
  "galaxy\\s*tab",
  "\\uAC24\\uB7ED\\uC2DC\\uD0ED",
  "\\uBBA4\\uD328\\uB4DC",
  "\\uC548\\uB4DC\\uB85C\\uC774\\uB4DC\\s*\\uD0DC\\uBE14\\uB9BF",
  "\\uB178\\uD2B8\\uBD81",
  "notebook",
  "laptop",
  "\\uBE45\\uD130\\uC2A4",
  "victus",
  "\\uADF8\\uB7A8",
  "\\bgram\\b",
  "\\uAC24\\uB7ED\\uC2DC\\s*\\uBD81",
  "galaxy\\s*book",
  "\\uB9E5\\uBD81",
  "macbook",
  "\\uC870\\uC774\\uCF58",
  "\\uD50C\\uC2A4",
  "\\uD50C\\uB808\\uC774\\uC2A4\\uD14C\\uC774\\uC158",
  "playstation",
  "ps4",
  "ps5",
  "ps\\s*vr",
  "vr2",
  "\\bpcx(?:\\s*[-/]?\\s*\\d{2,4})?\\b",
  "\\bnmax(?:\\s*[-/]?\\s*\\d{2,4})?\\b",
  "\\badv\\s*[-/]?\\s*\\d{2,4}\\b",
  "xbox",
  "\\uC5D1\\uC2A4\\uBC15\\uC2A4",
  "\\uB4C0\\uC5BC\\uC13C\\uC2A4",
  "dualsense"
].join("|"), "i");
const BUYING_OR_INQUIRY_PATTERN = new RegExp([
  "\\uC0BD\\uB2C8\\uB2E4",
  "\\uAD6C\\uD574\\uC694",
  "\\uAD6C\\uB9E4\\uD569\\uB2C8\\uB2E4",
  "\\uB9E4\\uC785",
  "\\uCD5C\\uACE0\\uAC00\\s*\\uAD6C\\uB9E4",
  "\\uCD5C\\uACE0\\uAC00\\s*\\uB9E4\\uC785",
  "\\uC7AC\\uACE0\\s*\\uBB38\\uC758",
  "\\uAC00\\uACA9\\s*\\uBB38\\uC758",
  "\\uBB38\\uC758\\b"
].join("|"), "i");
const GUIDE_OR_AD_PATTERN = new RegExp([
  "\\uC0AC\\uAE30",
  "\\uD53C\\uD574\\s*\\uBC29\\uC9C0",
  "\\uC608\\uBC29\\uBC95",
  "\\uAC00\\uC774\\uB4DC",
  "\\uD64D\\uBCF4",
  "\\uAD11\\uACE0",
  "\\uACF5\\uAD6C",
  "\\uB300\\uB7C9",
  "\\uD310\\uB9E4\\uC911"
].join("|"), "i");
const CPU_ABSENT_OR_COOLER_PATTERN = new RegExp([
  "cpu\\s*(?:는\\s*)?(?:없|없음|없습니다|미포함|제외)",
  "\\bcpu\\s*not\\s*included\\b",
  "\\bcooler\\s*only\\b",
  "\\bwithout\\s*cpu\\b",
  "\\uCFFC\\uB7EC\\uB9CC",
  "\\uCFFC\\uB7EC\\uC778\\uB4EF",
  "\\uC0AC\\uC9C4\\s*\\uC798\\s*\\uBD10"
].join("|"), "i");
const BUNDLED_PART_PATTERN = new RegExp([
  "\\uBB36\\uC74C",
  "\\uC77C\\uAD04",
  "\\uC138\\uD2B8",
  "bundle",
  "set\\b",
  "\\uD328\\uD0A4\\uC9C0",
  "\\+\\s*(?:\\uD30C\\uC6CC|power|\\uBA54\\uC778\\uBCF4\\uB4DC|motherboard|ssd|ram|\\uB7A8|\\uCF00\\uC774\\uC2A4|case|\\uCFFC\\uB7EC|cooler)",
  "(?:^|[\\s(])(?:3|4)\\s*(?:ea|\\uAC1C|\\uC7A5)(?=$|[^A-Za-z0-9])",
  "(?:^|[\\s(])x\\s*(?:3|4)(?=$|[^A-Za-z0-9])",
  "(?:^|[\\s(])(?:3|4)x(?=$|[^A-Za-z0-9])",
  "\\*\\s*(?:3|4)(?=$|[^A-Za-z0-9])",
  "(?:^|[^A-Za-z0-9])(?:3|4)\\s*\\*(?=$|[^A-Za-z0-9])"
].join("|"), "i");
const CROSS_PART_BUNDLE_PATTERN = /(?:\+|\/)[^|]{0,32}(?:\uD30C\uC6CC|power|\uBA54\uC778\uBCF4\uB4DC|motherboard|ssd|ram|\uB7A8|\uCF00\uC774\uC2A4|case|\uCFFC\uB7EC|cooler)/i;
const PLACEHOLDER_BUILD_TEXT_PATTERN = new RegExp([
  "\\uD310\\uB9E4",
  "\\uBB38\\uC758",
  "\\uC7AC\\uACE0",
  "\\uC870\\uB9BDpc",
  "\\uCEF4\\uD4E8\\uD130",
  "\\uBCF8\\uCCB4",
  "pc"
].join("|"), "i");
const COMMERCIAL_BUILD_AD_PATTERN = new RegExp([
  "\\uC131\\uC778pc\\uBC29",
  "\\uD53C\\uC2DC\\uBC29",
  "pc\\uBC29",
  "\\uD480\\uC138\\uD2B8",
  "\\uD480\\uC14B\\uD2B8",
  "\\uD480\\uC14B",
  "\\uB9DE\\uCDA4",
  "\\uC804\\uC6A9",
  "\\uD55C\\uC815\\uD2B9\\uAC00",
  "\\uD55C\\uC815\\uC218\\uB7C9",
  "\\uD55C\\uC815\\uD310\\uB9E4",
  "\\uC120\\uCC29\\uC21C\\uD310\\uB9E4",
  "\\uCD08\\uD2B9\\uAC00",
  "\\uC774\\uBCA4\\uD2B8",
  "\\uC0AC\\uBB34\\uC2E4",
  "\\uAD6C\\uB9E4\\uAC00\\uB2A5",
  "\\uACAC\\uC801\\uAC00\\uB2A5",
  "\\uBCF8\\uCCB4\\uAC00\\uACA9"
].join("|"), "i");
const PROMOTIONAL_BUILD_TEMPLATE_PATTERN = new RegExp([
  "\\uD2B9\\uD310",
  "\\uC774\\uBCA4\\uD2B8",
  "\\uD55C\\uC815\\uC218\\uB7C9",
  "\\uCD5C\\uC800\\uAC00",
  "\\uBAA8\\uC74C",
  "\\uC778\\uAE30\\uAD6C\\uC131",
  "\\uACE0\\uC0AC\\uC591",
  "\\uACE0\\uC0AC\\uC591\\uAC8C\\uC774\\uBC0D",
  "\\uC2E0\\uD488",
  "\\uBC8C\\uD06C",
  "\\uBCC0\\uACBD\\uAC00\\uB2A5",
  "\\uBCC0\\uACBD\\s*\\uC2DC",
  "\\uB300\\uD589\\uC124\\uCE58",
  "\\uAC80\\uC218",
  "\\uB300\\uD45C\\uC0AC\\uC9C4",
  "\\uC2DC\\uAC01\\uC801\\uD6A8\\uACFC",
  "\\uC0C1\\uC138\\s*\\uC2A4\\uD399",
  "\\uAC8C\\uC784\\uC6A9\\uC804\\uC6A9",
  "\\uC870\\uB9BD\\uC2DD\\uCEF4\\uD4E8\\uD130\\uBCF8\\uCCB4",
  "\\uBCF8\\uCCB4\\uAC00\\uACA9"
].join("|"), "i");
const FULL_SET_MONITOR_PATTERN = new RegExp([
  "\\uD480\\uC138\\uD2B8",
  "\\uD480\\uC14B\\uD2B8",
  "\\uD480\\uC14B",
  "\\uBAA8\\uB2C8\\uD130"
].join("|"), "i");
const PART_BUILD_LEAK_PATTERN = new RegExp([
  "\\uC62C\\uC778\\uC6D0",
  "all\\s*-?\\s*in\\s*-?\\s*one",
  "\\baio\\b",
  "\\uBBF8\\uB2C8\\s*pc",
  "\\bmini\\s*pc\\b",
  "\\bnuc\\b",
  "\\bnotebook\\b",
  "\\blaptop\\b",
  "\\btower\\b",
  "pro\\s*tower",
  "swift",
  "\\uC2A4\\uC704\\uD504\\uD2B8",
  "\\uB178\\uD2B8\\uBD81",
  "\\uADF8\\uB7A8",
  "\\uBCF8\\uCCB4",
  "\\uB370\\uC2A4\\uD06C\\uD0D1",
  "\\uC870\\uB9BD\\s*pc",
  "\\uAC8C\\uC774\\uBC0D\\s*(?:pc|\\uCEF4\\uD4E8\\uD130|\\uB370\\uC2A4\\uD06C\\uD0D1)",
  "\\uCEF4\\uD4E8\\uD130"
].join("|"), "i");
const MULTI_PART_BUILD_LEAK_PATTERN = new RegExp([
  "\\uBA54\\uC778\\uBCF4\\uB4DC",
  "motherboard",
  "\\uD30C\\uC6CC",
  "\\bpower\\b",
  "win11",
  "windows",
  "\\uC0AC\\uBB34\\uC6A9",
  "office"
].join("|"), "i");
const HIGH_QUANTITY_PART_PATTERN = /(?:^|[^0-9])(?:[5-9]|[1-9][0-9]{1,3})\s*(?:ea|\uAC1C|\uC7A5|pcs?|units?)(?=$|[^A-Za-z0-9])/i;
const BULK_PART_SALE_PATTERN = new RegExp([
  "\\uC77C\\uAD04",
  "\\uB300\\uB7C9",
  "\\uBC8C\\uD06C",
  "\\uC218\\uB7C9",
  "bulk",
  "lot",
  "wholesale"
].join("|"), "i");
const RAM_MULTI_OPTION_CLOCK_PATTERN = /(?:\b(?:2133|2400|2666|2933|3200|3600|4000|4800|5600|6000)\b[\s~/-]{0,4}\b(?:2133|2400|2666|2933|3200|3600|4000|4800|5600|6000)\b|\d{4}\s*~\s*\d{4})/i;
const MULTI_OPTION_PART_SALE_PATTERN = new RegExp([
  "\\uD074\\uB7ED\\uBCC4",
  "\\uC635\\uC158\\uBCC4",
  "\\uBCC4\\s*\\uD310\\uB9E4",
  "\\uC218\\uB7C9",
  "\\uC5F4\\uC7A5\\uC774\\uC0C1",
  "\\uB2E4\\uB7C9"
].join("|"), "i");
const PER_UNIT_BULK_PATTERN = /\uAC1C\uB2F9|\beach\b|per\s*unit/i;
const SPECIALTY_RAM_PATTERN = new RegExp([
  "\\becc\\b",
  "registered",
  "reg[- ]?dimm",
  "unbuffered",
  "\\uC11C\\uBC84\\uB7A8",
  "\\uB098\\uC2A4",
  "nas",
  "synology",
  "\\uC2DC\\uB180\\uB85C\\uC9C0"
].join("|"), "i");
const SSD_PORTABLE_PATTERN = new RegExp([
  "\\uC678\\uC7A5",
  "portable",
  "\\uD3EC\\uD130\\uBE14",
  "passport",
  "elements",
  "extreme\\s*e\\d+",
  "\\ucf00\\uc774\\uc2a4\\s*\\ud3ec\\ud568",
  "usb"
].join("|"), "i");
const SSD_NEW_CONDITION_PATTERN = new RegExp([
  "\\uC0C8\\uC0C1\\uD488",
  "\\uC2E0\\uD488",
  "\\uBBF8\\uAC1C\\uBD09",
  "\\uBBF8\\uC0AC\\uC6A9",
  "sealed",
  "brand\\s*new",
  "unused",
  "\\uB9AC\\uD37C",
  "refurb"
].join("|"), "i");
const SSD_MULTI_CAPACITY_OPTION_PATTERN = /(?:\b(?:120|128|240|250|256|480|500|512)\s*gb\b.*\b1\s*tb\b|\b1\s*tb\b.*\b(?:120|128|240|250|256|480|500|512)\s*gb\b|\b1\s*tb\b.*\b2\s*tb\b|\b2\s*tb\b.*\b1\s*tb\b)/i;
const SSD_MULTI_DRIVE_BUNDLE_PATTERN = new RegExp([
  "\\bhdd\\b",
  "hard\\s*disk",
  "\\uD558\\uB4DC(?:\\uB514\\uC2A4\\uD06C)?",
  "\\uC800\\uC7A5\\uC7A5\\uCE58"
].join("|"), "i");
const SSD_BAD_HEALTH_PATTERN = new RegExp([
  "crystal\\s*(?:disk)?\\s*info",
  "\\uD06C\\uB9AC\\uC2A4\\uD0C8(?:\\uB514\\uC2A4\\uD06C)?\\uC778\\uD3EC",
  "bad\\s*sector",
  "\\uC8FC\\uC758\\uACBD\\uACE0",
  "\\uC0C1\\uD0DC\\uAC00\\s*\\uC548\\s*\\uC88B",
  "as[- ]?is"
].join("|"), "i");
const SSD_MEMORY_CARD_PATTERN = new RegExp([
  "micro\\s*sd",
  "sd\\s*card",
  "tf\\s*card",
  "\\uB9C8\\uC774\\uD06C\\uB85C\\s*s(?:d|sd)",
  "\\uBA54\\uBAA8\\uB9AC\\s*\\uCE74\\uB4DC"
].join("|"), "i");
const SSD_PREMIUM_MODEL_PATTERN = /\b(?:980|990)\s*pro\b|\bsn850x?\b|\bp41\b|\bpm9a1\b|firecuda/i;
const BUILD_CONTEXT_HINT_PATTERN = new RegExp([
  "\\uC870\\uD569",
  "\\uC11C\\uBE0C\\uCEF4",
  "\\uBC18\\uBCF8\\uCCB4",
  "\\uD480\\uC14B",
  "\\uD480\\uC138\\uD2B8",
  "\\uAC8C\\uC774\\uBC0D",
  "\\uCEF4\\uD4E8\\uD130",
  "\\uBCF8\\uCCB4",
  "\\uC870\\uB9BD\\s*pc",
  "\\bpc\\b",
  "\\bdesktop\\b",
  "\\bsub\\s*pc\\b",
  "\\bset\\b"
].join("|"), "i");
const STANDARD_RAM_KIT_PATTERN = /(?:\b(?:2x8|8x2|2x16|16x2|2x32|32x2)\s*gb\b|\b(?:8|16|32)\s*gb\s*x\s*2\b|\b2\s*(?:ea|\uAC1C|\uC7A5)\b|\(\s*(?:8|16|32)\s*g?\s*x\s*2\s*\))/i;
const FAULTY_OR_PARTS_ONLY_PATTERN = new RegExp([
  "\\uACE0\\uC7A5(?!\\s*\\uC5C6)",
  "\\uBD88\\uB7C9",
  "\\uC791\\uB3D9\\s*\\uBD88\\uAC00",
  "\\uBBF8\\uC791\\uB3D9",
  "\\uBD80\\uD488\\uC6A9",
  "\\uC218\\uB9AC\\uC6A9",
  "\\uC815\\uD06C",
  "for\\s*parts",
  "junk",
  "as[- ]?is"
].join("|"), "i");

function getListingScope(item: Pick<NoiseFilterCandidate, "listing_type">) {
  if (item.listing_type === "part" || item.listing_type === "full_pc" || item.listing_type === "semi_pc") {
    return item.listing_type;
  }
  return "unknown";
}

function countModelTokens(text: string) {
  return text.match(MODEL_TOKEN_PATTERN)?.length ?? 0;
}

function isPlaceholderPrice(price: number, listingScope: ReturnType<typeof getListingScope>) {
  if (price <= 0) return true;

  const raw = String(price);
  if (listingScope === "full_pc" || listingScope === "semi_pc") {
    if (price < 50_000) return true;
    if (/^(\d)\1{3,}$/.test(raw)) return true;
    if (raw === "1234" || raw === "12345" || raw === "9999") return true;
  }

  if (listingScope === "part") {
    if (price < 5_000) return true;
    if (/^(\d)\1{4,}$/.test(raw)) return true;
  }

  return false;
}

function isFaultyOrPartsOnlyListing(item: NoiseFilterCandidate) {
  const combinedText = `${item.title} ${item.raw_notes} ${item.detail_excerpt ?? ""}`.trim();
  if (!combinedText) {
    return false;
  }

  return FAULTY_OR_PARTS_ONLY_PATTERN.test(combinedText);
}

function isLikelyBundledPartOffer(item: NoiseFilterCandidate) {
  if (item.listing_type !== "part") return false;
  const combinedText = `${item.title} ${item.raw_notes} ${item.detail_excerpt ?? ""}`.trim();
  if (!combinedText) return false;
  const hasSsdComponent = item.components.some((component) => component.component_type === "ssd");
  const hasGenericSsdComponent = item.components.some((component) =>
    component.component_type === "ssd"
    && /^SSD (?:256GB|500GB|1TB|2TB)$/i.test(component.canonical_name)
  );
  const hasRamComponent = item.components.some((component) => component.component_type === "ram");
  const ramGenerationTokens = hasRamComponent
    ? Array.from(new Set(
        [...combinedText.matchAll(/ddr\s*([345])/gi)]
          .map((match) => match[1])
          .filter((value): value is string => typeof value === "string")
      ))
    : [];
  const hasExplicitTwoUnitBundle = /(?:2\s*EA|2개|2장|\bx\s*2\b|\b2x\b|\*\s*2\b|2\s*\*)/i.test(combinedText);
  const hasStandardRamKitPattern = hasRamComponent && STANDARD_RAM_KIT_PATTERN.test(combinedText);
  const hasAmbiguousRamMultiUnit = hasRamComponent && hasExplicitTwoUnitBundle && !hasStandardRamKitPattern;
  const hasSsdMultiUnitBundle = hasSsdComponent && hasExplicitTwoUnitBundle;
  const hasRamClockOptionInventory = hasRamComponent
    && RAM_MULTI_OPTION_CLOCK_PATTERN.test(combinedText)
    && MULTI_OPTION_PART_SALE_PATTERN.test(combinedText);
  const hasMixedRamGenerationInventory = hasRamComponent && ramGenerationTokens.length >= 2;

  return hasAmbiguousRamMultiUnit
    || hasSsdMultiUnitBundle
    || (hasSsdComponent && SSD_PORTABLE_PATTERN.test(combinedText))
    || (hasSsdComponent && SSD_NEW_CONDITION_PATTERN.test(combinedText))
    || (hasSsdComponent && SSD_MULTI_CAPACITY_OPTION_PATTERN.test(combinedText))
    || (hasSsdComponent && SSD_MULTI_DRIVE_BUNDLE_PATTERN.test(combinedText))
    || (hasSsdComponent && SSD_BAD_HEALTH_PATTERN.test(combinedText))
    || (hasSsdComponent && SSD_MEMORY_CARD_PATTERN.test(combinedText))
    || (hasGenericSsdComponent && SSD_PREMIUM_MODEL_PATTERN.test(combinedText))
    || hasRamClockOptionInventory
    || hasMixedRamGenerationInventory
    || (hasRamComponent && SPECIALTY_RAM_PATTERN.test(combinedText))
    || (HIGH_QUANTITY_PART_PATTERN.test(combinedText) && PER_UNIT_BULK_PATTERN.test(combinedText))
    || (HIGH_QUANTITY_PART_PATTERN.test(combinedText) && BULK_PART_SALE_PATTERN.test(combinedText))
    || BUNDLED_PART_PATTERN.test(combinedText)
    || CROSS_PART_BUNDLE_PATTERN.test(combinedText);
}

function isLikelyPartBuildLeak(
  item: NoiseFilterCandidate,
  modelTokenCount: number,
  componentCount: number
) {
  if (item.listing_type !== "part") return false;

  const price = item.price_value ?? 0;
  const combinedText = `${item.title} ${item.raw_notes} ${item.detail_excerpt ?? ""}`.trim();
  const cpuCount = item.components.filter((component) => component.component_type === "cpu").length;
  const gpuCount = item.components.filter((component) => component.component_type === "gpu").length;
  const distinctGpuCount = new Set(
    item.components
      .filter((component) => component.component_type === "gpu")
      .map((component) => component.canonical_name)
  ).size;
  const hasBuildLikeCrossComponents = cpuCount >= 1 && gpuCount >= 1;
  const hasAmbiguousGpuVariantCollision = distinctGpuCount >= 2;
  const hasExplicitGpuVariantHint = /\bti\b|super|xt/i.test(combinedText);

  if (
    hasAmbiguousGpuVariantCollision
    && (
      hasExplicitGpuVariantHint
      || BUILD_CONTEXT_HINT_PATTERN.test(combinedText)
    )
  ) {
    return true;
  }

  if (
    hasBuildLikeCrossComponents
    && BUILD_CONTEXT_HINT_PATTERN.test(combinedText)
  ) {
    return true;
  }

  if (!combinedText || !PART_BUILD_LEAK_PATTERN.test(combinedText)) {
    return componentCount >= 2
      && price >= 300_000
      && MULTI_PART_BUILD_LEAK_PATTERN.test(combinedText);
  }

  return price >= 200_000
    || componentCount >= 2
    || modelTokenCount >= 2
    || FULL_SET_MONITOR_PATTERN.test(combinedText);
}

function isInactiveListing(item: NoiseFilterCandidate) {
  return item.item_status === "sold"
    || item.item_status === "reserved"
    || item.sale_status === "completed"
    || item.sale_status === "reserved";
}

function isMisleadingCpuAccessoryListing(item: NoiseFilterCandidate) {
  if (item.listing_type !== "part") {
    return false;
  }

  const hasCpuComponent = item.components.some((component) => component.component_type === "cpu");
  if (!hasCpuComponent) {
    return false;
  }

  const combinedText = `${item.title} ${item.raw_notes} ${item.detail_excerpt ?? ""}`.trim();
  if (!CPU_ABSENT_OR_COOLER_PATTERN.test(combinedText)) {
    return false;
  }

  return item.price_value === null || item.price_value <= 30_000;
}

function parseCandidateDate(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return new Date(`${trimmed}T00:00:00+09:00`);
  }

  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)) {
    return new Date(trimmed.replace(" ", "T") + "+09:00");
  }

  if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
    const parsedIso = new Date(trimmed);
    return Number.isNaN(parsedIso.getTime()) ? null : parsedIso;
  }

  return null;
}

function resolveStaleListingThresholdMs(item: NoiseFilterCandidate) {
  if (/site=daangn\b/i.test(item.raw_notes)) {
    return 60 * 24 * 60 * 60 * 1000;
  }

  if (/site=(?:joonggonara|bunjang)\b/i.test(item.raw_notes)) {
    if (item.listing_type === "part") {
      return 90 * 24 * 60 * 60 * 1000;
    }
    return 180 * 24 * 60 * 60 * 1000;
  }

  return null;
}

function isStaleMarketplaceListing(item: NoiseFilterCandidate) {
  const staleThresholdMs = resolveStaleListingThresholdMs(item);
  if (staleThresholdMs === null) {
    return false;
  }

  const candidateDate = parseCandidateDate(item.posted_at ?? "") ?? parseCandidateDate(item.upload_date ?? "");
  if (!candidateDate) {
    return false;
  }

  const ageMs = Date.now() - candidateDate.getTime();
  return ageMs > staleThresholdMs;
}

export function classifyNoiseCandidate(item: NoiseFilterCandidate): NoiseFilterReason | null {
  const listingScope = getListingScope(item);
  const title = item.title.trim();
  const combinedText = `${item.title} ${item.raw_notes} ${item.detail_excerpt ?? ""}`.trim();
  const componentCount = item.components.length;

  if (isInactiveListing(item)) {
    return "inactive_listing";
  }

  if (isStaleMarketplaceListing(item)) {
    return "stale_listing";
  }

  if (NON_PC_PRODUCT_PATTERN.test(combinedText)) {
    return "non_pc_product";
  }

  if (isFaultyOrPartsOnlyListing(item)) {
    return "faulty_or_parts_only";
  }

  const modelTokenCount = countModelTokens(combinedText);
  const price = item.price_value;
  const placeholderPrice = price !== null && isPlaceholderPrice(price, listingScope);

  if (BUYING_OR_INQUIRY_PATTERN.test(combinedText)) {
    return "guide_or_advertisement";
  }

  if (isMisleadingCpuAccessoryListing(item)) {
    return "guide_or_advertisement";
  }

  if (
    GUIDE_OR_AD_PATTERN.test(combinedText)
    && (placeholderPrice || modelTokenCount >= 2 || componentCount === 0 || item.seller_upload_count >= 3)
  ) {
    return "guide_or_advertisement";
  }

  if (
    listingScope !== "part"
    && componentCount === 0
    && price !== null
    && price <= 400_000
    && COMMERCIAL_BUILD_AD_PATTERN.test(combinedText)
  ) {
    return "guide_or_advertisement";
  }

  if (
    listingScope !== "part"
    && (componentCount >= 1 || modelTokenCount >= 2)
    && PROMOTIONAL_BUILD_TEMPLATE_PATTERN.test(combinedText)
  ) {
    return "guide_or_advertisement";
  }

  if (
    listingScope !== "part"
    && FULL_SET_MONITOR_PATTERN.test(combinedText)
    && (/\uBAA8\uB2C8\uD130/i.test(combinedText) || componentCount === 0)
  ) {
    return "guide_or_advertisement";
  }

  if (
    listingScope === "part"
    && placeholderPrice
  ) {
    return "placeholder_price";
  }

  if (
    (listingScope === "full_pc" || listingScope === "semi_pc")
    && placeholderPrice
    && (
      modelTokenCount >= 2
      || componentCount === 0
      || item.seller_upload_count >= 3
      || PLACEHOLDER_BUILD_TEXT_PATTERN.test(title)
    )
  ) {
    return "placeholder_price";
  }

  if (isLikelyBundledPartOffer(item)) {
    return "bundled_part_offer";
  }

  if (isLikelyPartBuildLeak(item, modelTokenCount, componentCount)) {
    return "part_build_leak";
  }

  return null;
}

export function annotateNoiseCandidate<T extends AnnotatedNoiseCandidate>(item: T): T {
  const reason = classifyNoiseCandidate(item);
  return {
    ...item,
    noise_filtered: reason !== null,
    noise_filter_reason: reason ?? ""
  };
}

export function isHardPruneNoiseReason(reason: NoiseFilterReason | null | undefined) {
  return reason !== null && reason !== undefined && HARD_PRUNE_NOISE_REASONS.has(reason);
}

export function annotateNormalizedResultNoise(result: NormalizedResult): NormalizedResult {
  return {
    ...result,
    normalized_items: result.normalized_items.map((item) => annotateNoiseCandidate(item))
  };
}
