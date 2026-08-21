const KEYWORD_ALIASES: Record<string, string[]> = {
  iphone: ["iphone", "아이폰"],
  ipad: ["ipad", "아이패드"],
  galaxy: ["galaxy", "갤럭시"],
  samsung: ["samsung", "삼성"],
  apple: ["apple", "애플"],
  airpods: ["airpods", "에어팟"],
  macbook: ["macbook", "맥북"],
  watch: ["watch", "워치"],
  playstation: ["playstation", "플레이스테이션"],
  nintendo: ["nintendo", "닌텐도"],
  switch: ["switch", "스위치"]
};

function compact(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\u3131-\u318e\uac00-\ud7a3]+/g, "");
}

export function tokenizeKeyword(value: string): string[] {
  return value.toLowerCase().match(/[a-z]+\d+[a-z]*|\d+[a-z]+|[a-z]+|\d+|[\u3131-\u318e\uac00-\ud7a3]+/g) ?? [];
}

export function keywordTokenAlternatives(term: string): string[] {
  const normalized = compact(term);
  const alias = Object.values(KEYWORD_ALIASES).find((values) => values.some((value) => compact(value) === normalized));
  return alias ? [...alias] : [term];
}

function tokenMatches(haystackToken: string, term: string) {
  const haystack = compact(haystackToken);
  const candidate = compact(term);
  return haystack === candidate || haystack.startsWith(candidate) || haystack.endsWith(candidate);
}

export function keywordMatchesText(keyword: string, text: string): boolean {
  const terms = tokenizeKeyword(keyword).filter((term, index, all) => all.indexOf(term) === index);
  if (terms.length === 0) return true;
  const haystackTokens = tokenizeKeyword(text);
  return terms.every((term) => keywordTokenAlternatives(term).some((alternative) =>
    haystackTokens.some((token) => tokenMatches(token, alternative))
  ));
}
