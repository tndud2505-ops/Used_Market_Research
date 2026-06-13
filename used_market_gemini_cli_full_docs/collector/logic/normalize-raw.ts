import { SearchResultSchema, type SearchItem, type SearchResult } from "../../MCP/logic/types.js";

const GENERIC_KEYWORD_TOKENS = new Set([
  "pc",
  "full",
  "gaming",
  "desktop",
  "tower",
  "computer",
  "body",
  "set",
  "bundle"
]);

const STRUCTURED_NOTE_METADATA_KEYS = new Set([
  "source",
  "site",
  "row",
  "tag",
  "ad",
  "proshop",
  "derived_upload_month"
]);

function tokenizeSearchText(value: string) {
  return value
    .toLowerCase()
    .match(/[a-z]+\d+[a-z]*|\d+[a-z]+|[a-z]+|\d+|[\u3131-\u318e\uac00-\ud7a3]{2,}/g) ?? [];
}

function buildRequiredKeywordTerms(keyword: string) {
  return tokenizeSearchText(keyword)
    .filter((token) => !GENERIC_KEYWORD_TOKENS.has(token))
    .filter((token) => /[a-z]/.test(token) || /\d/.test(token))
    .filter((token, index, tokens) => tokens.indexOf(token) === index);
}

function compactToken(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\u3131-\u318e\uac00-\ud7a3]+/g, "");
}

function stripStructuredSearchMetadata(value: string) {
  return value
    .split(";")
    .map((fragment) => fragment.trim())
    .filter(Boolean)
    .filter((fragment) => {
      const separatorIndex = fragment.indexOf("=");
      if (separatorIndex < 0) {
        return true;
      }

      const key = fragment.slice(0, separatorIndex).trim().toLowerCase();
      return !STRUCTURED_NOTE_METADATA_KEYS.has(key);
    })
    .join(" ");
}

function isBunjangPublicApiItem(item: Pick<SearchItem, "notes">) {
  return /(?:^|;)\s*source=public-api(?:;|$)/i.test(item.notes)
    && /(?:^|;)\s*site=bunjang(?:;|$)/i.test(item.notes);
}

function isLikelyHardwareKeyword(keyword: string) {
  return /\b(rtx|gtx|rx\s*\d{3,4}|gpu|cpu|ryzen|intel|i[3579]|ultra|ddr[345]|ram|ssd|nvme|m\.?2|motherboard|mainboard|mobo|psu|power\s*supply|a\d{3}[a-z0-9-]*|b\d{3}[a-z0-9-]*|x\d{3}[a-z0-9-]*|z\d{3}[a-z0-9-]*|h\d{3}[a-z0-9-]*)\b|\uadf8\ub798\ud53d|\uba54\uc778\ubcf4\ub4dc|\uba54\ubaa8\ub9ac|\ud30c\uc6cc|\uc870\ub9bd\s*pc|\ubcf8\uccb4|\ucef4\ud4e8\ud130/i.test(keyword);
}

function hasHardwareTitleContext(value: string) {
  return /\b(rtx|gtx|geforce|radeon|gpu|vga|cpu|ryzen|intel|i[3579]|ultra|ddr[345]|ram|memory|ssd|nvme|m\.?2|hdd|motherboard|mainboard|mobo|psu|power\s*supply|desktop|tower|gaming\s*pc|full\s*pc|a\d{3}[a-z0-9-]*|b\d{3}[a-z0-9-]*|x\d{3}[a-z0-9-]*|z\d{3}[a-z0-9-]*|h\d{3}[a-z0-9-]*)\b|\uadf8\ub798\ud53d|\uba54\uc778\ubcf4\ub4dc|\uba54\ubaa8\ub9ac|\ud30c\uc6cc|\uc870\ub9bd|\ubcf8\uccb4|\ucef4\ud4e8\ud130/i.test(value);
}

function tokenMatchesKeywordTerm(token: string, term: string) {
  const compactedToken = compactToken(token);
  const compactedTerm = compactToken(term);
  if (compactedToken === compactedTerm) {
    return true;
  }

  if (compactedToken.startsWith(compactedTerm) || compactedToken.endsWith(compactedTerm)) {
    return true;
  }

  const hasModelLikeShape =
    (/[a-z]/.test(compactedToken) && /\d/.test(compactedToken))
    || (/[a-z]/.test(compactedTerm) && /\d/.test(compactedTerm));

  if (hasModelLikeShape && compactedToken.includes(compactedTerm)) {
    return true;
  }

  return false;
}

function isRelevantToKeyword(keyword: string, item: Pick<SearchItem, "title" | "notes">) {
  const requiredTerms = buildRequiredKeywordTerms(keyword);
  if (requiredTerms.length === 0) {
    return true;
  }

  const strippedNotes = stripStructuredSearchMetadata(item.notes);
  const titleAndHumanNoteTokens = tokenizeSearchText(`${item.title} ${strippedNotes}`);
  if (titleAndHumanNoteTokens.length === 0) {
    return false;
  }

  const matchesTitleOrHumanNotes = requiredTerms.every((term) =>
    titleAndHumanNoteTokens.some((token) => tokenMatchesKeywordTerm(token, term))
  );

  if (isBunjangPublicApiItem(item) && isLikelyHardwareKeyword(keyword)) {
    if (!hasHardwareTitleContext(item.title)) {
      return false;
    }

    if (matchesTitleOrHumanNotes) {
      return true;
    }

    const fullHaystackTokens = tokenizeSearchText(`${item.title} ${item.notes}`);
    return requiredTerms.every((term) =>
      fullHaystackTokens.some((token) => tokenMatchesKeywordTerm(token, term))
    );
  }

  return matchesTitleOrHumanNotes;
}

function inferListingTypeHint(item: Pick<SearchItem, "title" | "notes">): SearchItem["listing_type_hint"] {
  const haystack = `${item.title} ${stripStructuredSearchMetadata(item.notes)}`.toLowerCase();
  const hasFullPcKeyword = /(full\s*pc|desktop|tower|gaming\s*pc|\uc870\ub9bd|\ubcf8\uccb4|\ucef4\ud4e8\ud130)/i.test(haystack);
  const hasBodyKeyword = /(semi\s*pc|\ubc14\ub514\s*pc|\ubcf8\uccb4\ub9cc)/i.test(haystack);
  const hasGpu = /(rtx|gtx|rx\s*\d{3,4}|\uadf8\ub798\ud53d|gpu)/i.test(haystack);
  const hasCpu = /(cpu|ryzen|intel|i3|i5|i7|i9|12400|5600)/i.test(haystack);
  const hasRam = /(ddr\d|ram\s*\d+|\uba54\ubaa8\ub9ac\s*\d+|16g|32g)/i.test(haystack);
  const hasStorage = /(ssd|nvme|m\.2|hdd)/i.test(haystack);
  const hasMotherboard = /(motherboard|mainboard|mobo|a620m|b650m|b550m|b760m|z790|\uba54\uc778\ubcf4\ub4dc)/i.test(haystack);
  const hasPsu = /(psu|power\s*supply|power\s*\d{3,4}w?|\ud30c\uc6cc\s*\d{3,4}w?)/i.test(haystack);
  const componentSignals = [hasGpu, hasCpu, hasRam, hasStorage, hasMotherboard, hasPsu].filter(Boolean).length;

  if (hasGpu && hasCpu && (hasRam || hasStorage)) return "full_pc";
  if ((hasFullPcKeyword || hasBodyKeyword) && componentSignals >= 2) return hasGpu ? "full_pc" : "semi_pc";
  if (!hasGpu && hasCpu && hasRam && hasStorage) return "semi_pc";
  if (componentSignals >= 1) return "part";
  return "unknown";
}

export function normalizeRawResult(input: SearchResult): SearchResult {
  const warnings = [...input.warnings];
  const uniqueItems: SearchItem[] = [];
  const seenUrls = new Set<string>();
  let filteredCount = 0;
  let duplicateCount = 0;

  for (const originalItem of input.items) {
    const itemWarnings = [...originalItem.warnings];
    const normalizedItem: SearchItem = {
      ...originalItem,
      title: originalItem.title.trim(),
      seller: originalItem.seller.trim(),
      location: originalItem.location.trim(),
      posted_at: originalItem.posted_at.trim(),
      url: originalItem.url.trim(),
      notes: originalItem.notes.trim(),
      listing_type_hint:
        originalItem.listing_type_hint && originalItem.listing_type_hint !== "unknown"
          ? originalItem.listing_type_hint
          : inferListingTypeHint(originalItem),
      warnings: itemWarnings
    };

    const missingFields = [
      normalizedItem.title === "" ? "title" : null,
      normalizedItem.price === null ? "price" : null,
      normalizedItem.url === "" ? "url" : null
    ].filter((value): value is string => value !== null);

    if (missingFields.length > 0) {
      warnings.push(`Dropped item due to missing required fields (${missingFields.join(", ")}): ${normalizedItem.title || "(untitled)"}`);
      filteredCount += 1;
      continue;
    }

    if (!isRelevantToKeyword(input.keyword, normalizedItem)) {
      warnings.push(`Dropped item due to weak keyword relevance: ${normalizedItem.title || "(untitled)"}`);
      filteredCount += 1;
      continue;
    }

    if (seenUrls.has(normalizedItem.url)) {
      warnings.push(`Dropped duplicate URL: ${normalizedItem.url}`);
      filteredCount += 1;
      duplicateCount += 1;
      continue;
    }

    seenUrls.add(normalizedItem.url);
    uniqueItems.push(normalizedItem);
  }

  return SearchResultSchema.parse({
    ...input,
    items: uniqueItems,
    warnings,
    quality_meta: {
      extracted_count: input.items.length,
      filtered_count: filteredCount,
      duplicate_count: duplicateCount,
      warning_count: warnings.length
    }
  });
}
