import type { ReporterCandidate } from "./types.js";

const SITE_MESSAGE_LIMIT: Record<string, number> = {
  joonggonara: 500,
  bunjang: 1000,
  daangn: 500
};

function clampText(input: string, maxLength: number): string {
  if (input.length <= maxLength) return input;
  return `${input.slice(0, Math.max(0, maxLength - 3))}...`;
}

export function buildPurchaseMessage(candidate: ReporterCandidate): string {
  const normalizedTitle = candidate.title.replace(/\s+/g, " ").trim();
  const base = [
    "\uC548\uB155\uD558\uC138\uC694. \uAC8C\uC2DC\uAE00 \uBCF4\uACE0 \uC5F0\uB77D\uB4DC\uB9BD\uB2C8\uB2E4.",
    `${normalizedTitle || "\uC0C1\uD488"} \uC544\uC9C1 \uAC70\uB798 \uAC00\uB2A5\uD560\uAE4C\uC694?`,
    "\uAC00\uB2A5\uD558\uC2DC\uBA74 \uAC70\uB798 \uAC00\uB2A5\uD55C \uC2DC\uAC04\uACFC \uC7A5\uC18C \uC54C\uB824\uC8FC\uC2DC\uBA74 \uB9DE\uCDB0\uBCF4\uACA0\uC2B5\uB2C8\uB2E4.",
    "\uD655\uC778 \uBD80\uD0C1\uB4DC\uB9BD\uB2C8\uB2E4."
  ].join(" ");

  const limit = SITE_MESSAGE_LIMIT[candidate.site] ?? 700;
  return clampText(base, limit);
}
