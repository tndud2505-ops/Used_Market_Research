import type { ReporterCandidate } from "./types.js";

const SITE_MESSAGE_LIMIT: Record<string, number> = {
  mercari_jp: 500,
  yahoo_auction_jp: 500,
  rakuma: 500,
  poshmark: 500,
  vinted: 500,
  unclaimed_baggage: 500
};

function clampText(input: string, maxLength: number): string {
  if (input.length <= maxLength) return input;
  return `${input.slice(0, Math.max(0, maxLength - 3))}...`;
}

export function buildPurchaseMessage(candidate: ReporterCandidate): string {
  const normalizedTitle = candidate.title.replace(/\s+/g, " ").trim();
  const base = [
    "Hello, I am contacting you about this listing.",
    `Is ${normalizedTitle || "this item"} still available?`,
    "If it is available, please let me know the preferred purchase and shipping details.",
    "Thank you."
  ].join(" ");

  const limit = SITE_MESSAGE_LIMIT[candidate.site] ?? 700;
  return clampText(base, limit);
}
