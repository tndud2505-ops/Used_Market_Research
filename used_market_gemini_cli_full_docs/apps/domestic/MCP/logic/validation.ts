import { listSupportedSites } from "../../collector/logic/sites.js";
import { resolveCategory } from "../../market/logic/category-catalog.js";
import type { CategorySelection, SearchCommandInput } from "./types.js";

export type ValidationErrorCode =
  | "INVALID_SITE"
  | "INVALID_KEYWORD"
  | "INVALID_LIMIT"
  | "PLACEHOLDER_INPUT";

export class ValidationError extends Error {
  constructor(
    public readonly code: ValidationErrorCode,
    message: string,
    public readonly details?: string
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

const PLACEHOLDER_PATTERN = /^\{.+\}$/;

function isPlaceholder(value: string) {
  return PLACEHOLDER_PATTERN.test(value.trim());
}

function supportedSiteKeys() {
  return listSupportedSites().map((site) => site.key);
}

export function validateSite(site: string) {
  if (typeof site !== "string" || site.trim() === "") {
    throw new ValidationError("INVALID_SITE", "Site must be a non-empty string");
  }

  if (isPlaceholder(site)) {
    throw new ValidationError(
      "PLACEHOLDER_INPUT",
      `Placeholder input detected for site: ${site}`,
      "Provide a concrete site key such as joonggonara, bunjang, daangn, or ebay"
    );
  }

  if (!supportedSiteKeys().includes(site)) {
    throw new ValidationError(
      "INVALID_SITE",
      `Unsupported site: ${site}`,
      `Use one of: ${supportedSiteKeys().join(", ")}`
    );
  }
}

export function validateKeyword(keyword: string) {
  if (typeof keyword !== "string" || keyword.trim() === "") {
    throw new ValidationError("INVALID_KEYWORD", "Keyword must be a non-empty string");
  }

  if (isPlaceholder(keyword)) {
    throw new ValidationError(
      "PLACEHOLDER_INPUT",
      `Placeholder input detected for keyword: ${keyword}`,
      "Provide a concrete search keyword"
    );
  }
}

export function validateCategory(category?: CategorySelection) {
  if (!category) return;
  if (!category.id || !category.label || !Array.isArray(category.path)) {
    throw new ValidationError("INVALID_KEYWORD", "Category must include id, label, and path");
  }
  if (!resolveCategory(category.id)) {
    throw new ValidationError("INVALID_KEYWORD", `Unsupported category: ${category.id}`);
  }
}

export function validateLimit(limit: number, min = 1, max = 100) {
  if (!Number.isInteger(limit) || limit < min || limit > max) {
    throw new ValidationError(
      "INVALID_LIMIT",
      `Limit must be an integer between ${min} and ${max}`,
      `Received: ${String(limit)}`
    );
  }
}

export function validateSearchInput(input: SearchCommandInput) {
  validateSite(input.site);
  validateKeyword(input.keyword);
  validateCategory(input.category);
  validateLimit(input.limit);
}

export function validateSites(sites: string[]) {
  if (!Array.isArray(sites) || sites.length === 0) {
    throw new ValidationError("INVALID_SITE", "At least one site must be provided");
  }

  for (const site of sites) {
    validateSite(site);
  }
}

export function buildCollectorValidationFailure(
  input: Partial<SearchCommandInput>,
  error: ValidationError
) {
  return {
    site: typeof input.site === "string" ? input.site : "",
    keyword: typeof input.keyword === "string" ? input.keyword : "",
    login_status: "unknown" as const,
    items: [],
    next_action: "validate_inputs",
    errors: [
      `${error.code}: ${error.message}`,
      ...(error.details ? [error.details] : [])
    ]
  };
}

export function buildCliErrorPayload(error: unknown) {
  if (error instanceof ValidationError) {
    return {
      status: "error",
      error: error.code,
      message: error.message,
      ...(error.details ? { suggestion: error.details } : {})
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    status: "error",
    error: "INTERNAL_ERROR",
    message
  };
}
