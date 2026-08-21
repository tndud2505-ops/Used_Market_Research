import type { CollectionState } from "./types.js";

export interface CollectionStateInput {
  itemCount: number;
  extractedCount?: number;
  filteredCount?: number;
  warnings?: readonly string[];
  errors?: readonly string[];
}

export function deriveCollectionState(input: CollectionStateInput): CollectionState {
  const warnings = input.warnings ?? [];
  const errors = input.errors ?? [];
  const hasUnsupportedSignal = [...warnings, ...errors].some((value) =>
    /CATEGORY_COLLECTION_UNAVAILABLE|UNSUPPORTED_EVIDENCE_SHAPE|KEYWORD_FALLBACK_UNAVAILABLE/i.test(value)
  );

  if (errors.length > 0) return input.itemCount > 0 ? "partial" : "failed";
  if (input.itemCount > 0) return warnings.length > 0 || (input.filteredCount ?? 0) > 0 ? "partial" : "ready";
  if (hasUnsupportedSignal) return "unsupported";
  if ((input.extractedCount ?? 0) > 0 || (input.filteredCount ?? 0) > 0 || warnings.length > 0) return "filtered_empty";
  return "empty";
}
