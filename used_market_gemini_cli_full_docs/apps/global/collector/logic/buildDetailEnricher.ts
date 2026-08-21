import { trace, traceError } from "../../MCP/logic/runtime-trace.js";
import type { SearchItem, SearchResult } from "../../MCP/logic/types.js";
import { LISTING_TITLE_HINTS } from "../../market/logic/componentCatalog.js";
import { BrowserRuntimeUnavailableError, createBrowserSession } from "./browserSession.js";

type DetailFetchStatus = "success" | "unavailable" | "failed";

export interface DetailEnrichmentRecord {
  text: string;
  status: DetailFetchStatus;
  note: string;
}

export interface BuildDetailEnrichmentResult {
  detailByUrl: Map<string, DetailEnrichmentRecord>;
  warnings: string[];
  attempted: number;
  succeeded: number;
  unavailable: number;
  failed: number;
}

interface DetailTextCandidate {
  source: string;
  text: string;
  score: number;
}

const DETAIL_CANDIDATE_SNIPPET_MAX = 1200;

const DEFAULT_DETAIL_SELECTORS = [
  "[data-testid*='description']",
  "[data-testid*='content']",
  "[class*='description']",
  "[class*='content']",
  "[class*='detail']",
  "[class*='product']",
  "main",
  "article",
  "section",
  "body"
];

const DETAIL_SELECTORS_BY_SITE: Record<string, string[]> = {};

function matchesAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

function hasBuildHint(text: string) {
  const buildEntries = LISTING_TITLE_HINTS.filter((entry) => (
    entry.listingType === "full_pc" || entry.listingType === "semi_pc"
  ));

  return buildEntries.some((entry) => matchesAny(text, entry.patterns));
}

function shouldFetchDetail(item: SearchItem) {
  if (!item.url) {
    return false;
  }

  if (item.listing_type_hint === "full_pc" || item.listing_type_hint === "semi_pc") {
    return true;
  }

  const text = `${item.title} ${item.notes}`.trim();
  if (text.length === 0) {
    return false;
  }

  const hasCpuSignal = /(ryzen|intel core|core ultra|i[3579][- ]?\d{4,5}|(?:^|[^a-z0-9])((?:pro\s*)?4350g|3600|5500|5600x?|5600g|5700x|7500f|10400f|11400f|12400f|13400f|12700f|12700k)(?:$|[^a-z0-9])|\uB77C\uC774\uC820|\uCF54\uC5B4\s*i[3579]|\uCF54\uC5B4\s*ultra)/i.test(text);
  const hasGpuSignal = /(rtx|gtx|geforce|radeon|rx\s?\d{4}|\uC9C0\uD3EC\uC2A4|\uB77C\uB370\uC628)/i.test(text);
  const hasStorageSignal = /(ssd|nvme|m\.2|pm9a1|p31|p41|sn550|sn750|sn850x?|mx500|870\s*evo|860\s*evo)/i.test(text);
  const hasMotherboardSignal = /(motherboard|mainboard|mobo|a620m|b650m|b550m|b760m|z790|\uBA54\uC778\uBCF4\uB4DC)/i.test(text);
  const hasPsuSignal = /(psu|power\s*supply|power\s*\d{3,4}w?|\uD30C\uC6CC\uC11C\uD50C\uB77C\uC774|\uD30C\uC6CC\s*\d{3,4}w?)/i.test(text);
  const hasBuildWord = /\bpc\b|desktop|tower|system unit|\uCEF4\uD4E8\uD130|\uB370\uC2A4\uD06C\uD0D1|\uC870\uB9BD|\uBCF8\uCCB4|\uAC8C\uC774\uBC0D/i.test(text);

  if (hasBuildHint(text)) {
    return true;
  }

  if (hasCpuSignal && hasGpuSignal) {
    return true;
  }

  if (hasStorageSignal) {
    return true;
  }

  if (hasMotherboardSignal || hasPsuSignal) {
    return true;
  }

  return hasBuildWord && (hasGpuSignal || hasCpuSignal || /(ssd|ddr\d|\uB7A8|\uC2A4\uC2A4\uB514)/i.test(text));
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'");
}

function looksLikeShell(text: string) {
  return /you need to enable javascript to run this app/i.test(text);
}

function sanitizeDetailText(text: string, title: string) {
  const normalized = normalizeWhitespace(text);
  if (normalized.length === 0 || looksLikeShell(normalized)) {
    return "";
  }

  const titlePattern = title.trim().length > 0 ? new RegExp(escapeRegExp(normalizeWhitespace(title)), "i") : null;
  const withoutTitle = titlePattern ? normalizeWhitespace(normalized.replace(titlePattern, " ")) : normalized;
  const hasUsefulTail = withoutTitle.length >= 20 || /(rtx|gtx|rx\s?\d{4}|ryzen|i[3579][- ]?\d{4,5}|ssd|ddr\d|b450|b550|b650|\d{3,4}w)/i.test(withoutTitle);

  if (!hasUsefulTail) {
    return "";
  }

  return normalized.slice(0, 5000);
}

function parseAttributes(fragment: string) {
  const attributes: Record<string, string> = {};
  const attributePattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+)))?/g;
  let match: RegExpExecArray | null;

  while ((match = attributePattern.exec(fragment)) !== null) {
    attributes[match[1].toLowerCase()] = decodeHtmlEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }

  return attributes;
}

function extractMetaCandidates(rawHtml: string) {
  const candidates: DetailTextCandidate[] = [];
  const metaPattern = /<meta\b([^>]+)>/gi;
  const supportedNames = new Set(["description", "og:description", "twitter:description"]);
  let match: RegExpExecArray | null;

  while ((match = metaPattern.exec(rawHtml)) !== null) {
    const attributes = parseAttributes(match[1]);
    const metaName = (attributes.name ?? attributes.property ?? "").toLowerCase();
    if (!supportedNames.has(metaName)) continue;
    const content = normalizeWhitespace(attributes.content ?? "");
    if (!content) continue;
    candidates.push({
      source: `meta:${metaName}`,
      text: content,
      score: 0
    });
  }

  return candidates;
}

function decodeScriptString(value: string) {
  return decodeHtmlEntities(
    value
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, code: string) => String.fromCharCode(Number.parseInt(code, 16)))
      .replace(/\\n/g, " ")
      .replace(/\\r/g, " ")
      .replace(/\\t/g, " ")
      .replace(/\\"/g, "\"")
      .replace(/\\\\/g, "\\")
  );
}

function collectStructuredTextCandidates(
  value: unknown,
  source: string,
  keyPath: string[] = [],
  results: DetailTextCandidate[] = []
) {
  if (typeof value === "string") {
    const key = keyPath[keyPath.length - 1]?.toLowerCase() ?? "";
    if (["description", "articlebody", "text", "body", "content", "productdescription", "summary"].includes(key)) {
      const normalized = normalizeWhitespace(decodeHtmlEntities(value));
      if (normalized.length > 0) {
        results.push({
          source,
          text: normalized,
          score: 0
        });
      }
    }
    return results;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectStructuredTextCandidates(entry, source, keyPath, results);
    }
    return results;
  }

  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      collectStructuredTextCandidates(entry, source, [...keyPath, key], results);
    }
  }

  return results;
}

function extractLdJsonCandidates(rawHtml: string) {
  const candidates: DetailTextCandidate[] = [];
  const pattern = /<script\b[^>]*type=(?:"|')application\/ld\+json(?:"|')[^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(rawHtml)) !== null) {
    const rawJson = match[1].trim();
    if (!rawJson) continue;
    try {
      const parsed = JSON.parse(rawJson);
      candidates.push(...collectStructuredTextCandidates(parsed, "script:ldjson"));
    } catch {
      continue;
    }
  }

  return candidates;
}

function extractInlineScriptCandidates(rawHtml: string) {
  const candidates: DetailTextCandidate[] = [];
  const pattern = /"(description|articleBody|productDescription|summary|content|body)"\s*:\s*"((?:\\.|[^"])*)"/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(rawHtml)) !== null) {
    const text = normalizeWhitespace(decodeScriptString(match[2]));
    if (!text) continue;
    candidates.push({
      source: `script:${match[1]}`,
      text,
      score: 0
    });
  }

  return candidates;
}

function buildHardwareSignalScore(text: string) {
  const signals = [
    /(rtx|gtx|geforce|radeon|rx\s?\d{4}|laptop gpu|\uC9C0\uD3EC\uC2A4)/i,
    /(ryzen|intel core|i[3579][- ]?\d{4,5}|cpu|\uB77C\uC774\uC820|\uCF54\uC5B4)/i,
    /(ram|ddr\d|\d+\s?gb|\uB7A8|\uBA54\uBAA8\uB9AC)/i,
    /(ssd|nvme|m\.2|hdd|\d+\s?tb|sn750|\uC2A4\uC2A4\uB514)/i,
    /(b450|b550|b650|h610|b660|b760|a320|a620|motherboard|a320m|\uBA54\uC778\uBCF4\uB4DC)/i,
    /(\d{3,4}\s?w|80plus|micronics|fsp|seasonic|corsair|superflower|\uD30C\uC6CC|\uB9C8\uC774\uD06C\uB85C\uB2C9\uC2A4|\uC2C8\uD37C\uD50C\uB77C\uC6CC)/i
  ];

  return signals.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
}

function finalizeDetailCandidates(candidates: DetailTextCandidate[], title: string) {
  const deduped = new Map<string, DetailTextCandidate>();

  for (const candidate of candidates) {
    const sanitized = sanitizeDetailText(candidate.text, title);
    if (!sanitized) continue;
    const normalized = normalizeWhitespace(sanitized);
    const hardwareScore = buildHardwareSignalScore(normalized);
    const sourceBonus = candidate.source.startsWith("meta:")
      ? 1500
      : candidate.source.startsWith("script:ldjson")
        ? 1200
        : candidate.source.startsWith("script:")
          ? 900
          : 0;
    const score = hardwareScore * 10000 + sourceBonus + Math.min(normalized.length, DETAIL_CANDIDATE_SNIPPET_MAX);
    const existing = deduped.get(normalized);
    if (!existing || score > existing.score) {
      deduped.set(normalized, {
        source: candidate.source,
        text: normalized,
        score
      });
    }
  }

  return [...deduped.values()].sort((left, right) => right.score - left.score);
}

async function pickBestDetailText(siteKey: string, title: string, url: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const session = createBrowserSession();
  try {
    await session.goto(url);
    signal?.throwIfAborted();
    await session.waitForIdle();
    signal?.throwIfAborted();

    const rawHtml = await session.html();
    signal?.throwIfAborted();
    const selectors = [...new Set([...(DETAIL_SELECTORS_BY_SITE[siteKey] ?? []), ...DEFAULT_DETAIL_SELECTORS])];
    const selectorCandidates: DetailTextCandidate[] = [];
    const matchedSelectors: string[] = [];

    for (const selector of selectors) {
      signal?.throwIfAborted();
      if (!(await session.exists(selector))) {
        continue;
      }

      matchedSelectors.push(selector);
      const text = await session.text(selector);
      selectorCandidates.push({
        source: `selector:${selector}`,
        text,
        score: 0
      });
    }

    const candidates = finalizeDetailCandidates([
      ...extractMetaCandidates(rawHtml),
      ...extractLdJsonCandidates(rawHtml),
      ...extractInlineScriptCandidates(rawHtml),
      ...selectorCandidates
    ], title);

    const selected = candidates.slice(0, 4);
    const detailText = selected
      .map((candidate) => candidate.text.slice(0, DETAIL_CANDIDATE_SNIPPET_MAX))
      .join("\n")
      .slice(0, 5000)
      .trim();
    const noteParts = [
      `sources=${selected.map((candidate) => candidate.source).join(",") || "none"}`,
      `selector_hits=${matchedSelectors.join(",") || "none"}`,
      `candidate_count=${candidates.length}`
    ];
    trace("collector.detail-enrichment:item", {
      site: siteKey,
      url,
      selected_sources: selected.map((candidate) => candidate.source),
      selector_hits: matchedSelectors,
      candidate_count: candidates.length,
      detail_chars: detailText.length
    });

    return {
      text: detailText,
      note: noteParts.join("; ")
    };
  } finally {
    await session.close();
  }
}

export async function enrichBuildListingDetails(
  siteKey: string,
  searchResult: SearchResult,
  options: { signal?: AbortSignal } = {}
): Promise<BuildDetailEnrichmentResult> {
  options.signal?.throwIfAborted();
  const candidates = searchResult.items.filter(shouldFetchDetail);
  const detailByUrl = new Map<string, DetailEnrichmentRecord>();
  const warnings: string[] = [];

  trace("collector.detail-enrichment:start", {
    site: siteKey,
    keyword: searchResult.keyword,
    candidate_count: candidates.length
  });

  if (candidates.length === 0) {
    return {
      detailByUrl,
      warnings,
      attempted: 0,
      succeeded: 0,
      unavailable: 0,
      failed: 0
    };
  }

  const probeSession = createBrowserSession();
  if (!probeSession.available) {
    for (const item of candidates) {
      options.signal?.throwIfAborted();
      detailByUrl.set(item.url, {
        text: "",
        status: "unavailable",
        note: probeSession.unavailableReason ?? "detail runtime unavailable"
      });
    }
    warnings.push(`detail enrichment unavailable for ${siteKey}: ${probeSession.unavailableReason ?? "runtime unavailable"}`);
    await probeSession.close();
    trace("collector.detail-enrichment:unavailable", {
      site: siteKey,
      keyword: searchResult.keyword,
      candidate_count: candidates.length
    });
    return {
      detailByUrl,
      warnings,
      attempted: candidates.length,
      succeeded: 0,
      unavailable: candidates.length,
      failed: 0
    };
  }
  await probeSession.close();

  let succeeded = 0;
  let failed = 0;

  for (const item of candidates) {
    try {
      options.signal?.throwIfAborted();
      const detail = await pickBestDetailText(siteKey, item.title, item.url, options.signal);
      const detailText = detail.text;
      if (detailText.length > 0) {
        detailByUrl.set(item.url, {
          text: detailText,
          status: "success",
          note: `${detail.note}; detail chars=${detailText.length}`
        });
        succeeded += 1;
      } else {
        detailByUrl.set(item.url, {
          text: "",
          status: "failed",
          note: `${detail.note}; detail body empty or unsupported`
        });
        warnings.push(`detail body empty for ${siteKey}: ${item.url}`);
        failed += 1;
      }
    } catch (error) {
      options.signal?.throwIfAborted();
      const note = error instanceof Error ? error.message : String(error);
      const status: DetailFetchStatus = error instanceof BrowserRuntimeUnavailableError ? "unavailable" : "failed";
      detailByUrl.set(item.url, {
        text: "",
        status,
        note
      });
      warnings.push(`detail fetch ${status} for ${siteKey}: ${item.url}`);
      if (status === "failed") {
        failed += 1;
      }
      traceError("collector.detail-enrichment:item-failed", error);
    }
  }

  trace("collector.detail-enrichment:complete", {
    site: siteKey,
    keyword: searchResult.keyword,
    candidate_count: candidates.length,
    succeeded,
    failed,
    unavailable: detailByUrl.size - succeeded - failed
  });

  return {
    detailByUrl,
    warnings,
    attempted: candidates.length,
    succeeded,
    unavailable: detailByUrl.size - succeeded - failed,
    failed
  };
}
