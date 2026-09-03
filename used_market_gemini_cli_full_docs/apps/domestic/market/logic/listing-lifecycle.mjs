export function isPartialSaleText(value) {
  const text = String(value || "").normalize("NFKC");
  return /(?:(?:\d+|한|하나|두|둘|세|셋|네|넷)\s*(?:개|장|매)\s*중\s*(?:\d+|한|하나|두|둘|세|셋|네|넷)\s*(?:개|장|매)?\s*(?:만\s*)?판매\s*완료|남은\s*(?:\d+|한|하나|두|둘|세|셋|네|넷)\s*(?:개|장|매)\s*판매|일부\s*판매\s*완료)/iu.test(text);
}

export function explicitSoldText(value) {
  const text = String(value || "").normalize("NFKC");
  if (isPartialSaleText(text)) return null;
  if (/(?:미판매\s*완료|판매\s*완료|거래\s*완료|sold(?:\s*out)?).{0,12}(?:아님|아닙니다|아니며|오류|잘못|취소)/iu.test(text)) return null;
  if (/(?:아직|현재|당분간).{0,12}(?:판매\s*완료|거래\s*완료|sold(?:\s*out)?).{0,8}(?:아님|아닙니다|아니)/iu.test(text)) return null;
  if (/(?:미판매\s*완료)/iu.test(text)) return null;
  if (/(?:판매\s*완료|거래\s*완료)\s*(?:되면|하면|시|후|예정|처리\s*예정)/iu.test(text)) return null;
  if (/(?:판매\s*완료|거래\s*완료).{0,20}(?:삭제|내립니다|내림|변경)\s*(?:예정)?/iu.test(text) && /(?:되면|하면|시|후|예정)/iu.test(text)) return null;
  return text.match(/판매\s*완료|거래\s*완료|\bsold(?:\s*out)?\b/iu)?.[0] || null;
}

function normalizedTokens(value) {
  return String(value || "").toLowerCase().match(/[a-z0-9가-힣]{3,}/gu) || [];
}

function structuredIdentityMatches(value, listing) {
  const serialized = JSON.stringify(value).toLowerCase();
  const sourceId = String(listing?.source_listing_id || "").trim().toLowerCase();
  if (sourceId.length >= 4 && serialized.includes(sourceId)) return true;
  const url = String(listing?.url || "").trim();
  if (url) {
    try {
      const pathname = new URL(url).pathname.toLowerCase();
      if (pathname.length >= 5 && serialized.includes(pathname)) return true;
    } catch {}
  }
  const titleTokens = normalizedTokens(listing?.title).slice(0, 6);
  return titleTokens.length >= 2 && titleTokens.filter((token) => serialized.includes(token)).length >= 2;
}

export function structuredSoldEvidenceFromHtml(html, listing) {
  for (const match of String(html || "").matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/giu)) {
    let value;
    try { value = JSON.parse(match[1]); } catch { continue; }
    const queue = [value];
    while (queue.length > 0) {
      const current = queue.shift();
      if (Array.isArray(current)) { queue.push(...current); continue; }
      if (!current || typeof current !== "object") continue;
      const availability = String(current.availability || current.offers?.availability || "");
      if (/(?:^|\/)SoldOut$/iu.test(availability) && structuredIdentityMatches(current, listing)) {
        return { type: "STRUCTURED_STATUS", value: availability };
      }
      queue.push(...Object.values(current).filter((entry) => entry && typeof entry === "object"));
    }
  }
  const primaryText = [
    String(html || "").match(/<title\b[^>]*>([\s\S]*?)<\/title>/iu)?.[1],
    String(html || "").match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/iu)?.[1]
  ].filter(Boolean).map((value) => String(value).replace(/<[^>]*>/gu, " ").replace(/\s+/gu, " ").trim()).join(" ");
  const explicit = explicitSoldText(primaryText);
  return explicit ? { type: "EXPLICIT_TEXT", value: explicit } : null;
}
