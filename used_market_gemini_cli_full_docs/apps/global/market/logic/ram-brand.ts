type RamLikeComponent = {
  component_type: string;
  canonical_name: string;
  source_text?: string;
};

export const RAM_BRAND_PATTERNS: Array<{ brand: string; pattern: RegExp }> = [
  { brand: "Samsung", pattern: /\b(?:samsung)\b|삼성/i },
  { brand: "SK hynix", pattern: /\b(?:sk\s*hynix|hynix)\b|하이닉스|에스케이\s*하이닉스/i },
  { brand: "Micron", pattern: /\b(?:micron|crucial)\b|마이크론|크루셜/i },
  { brand: "TeamGroup", pattern: /\b(?:teamgroup|t[\s-]*force)\b|팀그룹|티포스/i },
  { brand: "G.SKILL", pattern: /\b(?:g[\s.-]*skill)\b|지스킬/i },
  { brand: "Corsair", pattern: /\bcorsair\b|커세어/i },
  { brand: "Kingston", pattern: /\bkingston\b|킹스톤/i },
  { brand: "GeIL", pattern: /\bgeil\b|게일/i },
  { brand: "KLEVV", pattern: /\b(?:klevv|essencore)\b|클레브|에센코어/i },
  { brand: "Patriot", pattern: /\bpatriot\b|패트리어트/i }
];

export function listSupportedRamBrands() {
  return [...new Set(RAM_BRAND_PATTERNS.map((candidate) => candidate.brand))];
}

function inferRamBrand(text: string) {
  for (const candidate of RAM_BRAND_PATTERNS) {
    if (candidate.pattern.test(text)) {
      return candidate.brand;
    }
  }

  return null;
}

export function buildRamAwareComponentKey(
  component: RamLikeComponent,
  ...textSources: Array<string | undefined | null>
) {
  if (component.component_type !== "ram") {
    return component.canonical_name;
  }

  if (!/^DDR[45]\s+\d+GB$/i.test(component.canonical_name)) {
    return component.canonical_name;
  }

  const searchText = [component.source_text, ...textSources]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ");
  const brand = inferRamBrand(searchText);

  return brand ? `${brand} ${component.canonical_name}` : component.canonical_name;
}
