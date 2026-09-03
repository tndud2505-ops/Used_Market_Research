import { createHash } from "node:crypto";
import {
  PC_PART_CATEGORY_SEEDS_V2,
  PC_PART_FACET_SCHEMA_V2,
  PC_PRODUCT_MASTER_V2,
  PC_PRODUCT_MASTER_V2_VERSION
} from "../data/pc-product-master-v2.mjs";

const DIRECTORY_CURSOR_VERSION = 1;
const DEFAULT_SORT = "CATEGORY_NAME_ID_ASC";
const ALLOWED_SORTS = new Set([DEFAULT_SORT, "NAME_ID_ASC", "ID_ASC"]);
const CATEGORY_ORDER = new Map(PC_PART_CATEGORY_SEEDS_V2.map((category) => [category.code, category.order]));

function compareText(left, right) {
  const a = String(left).normalize("NFKC").toUpperCase();
  const b = String(right).normalize("NFKC").toUpperCase();
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareProducts(left, right, sort) {
  if (sort === "ID_ASC") return compareText(left.id, right.id);
  if (sort === "NAME_ID_ASC") return compareText(left.name, right.name) || compareText(left.id, right.id);
  return (CATEGORY_ORDER.get(left.category) ?? Number.MAX_SAFE_INTEGER) - (CATEGORY_ORDER.get(right.category) ?? Number.MAX_SAFE_INTEGER)
    || compareText(left.name, right.name)
    || compareText(left.id, right.id);
}

function asArray(value) {
  if (value === undefined || value === null || value === "") return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeStringValues(value, upper = false) {
  const normalized = asArray(value).map((item) => String(item).normalize("NFKC").trim()).filter(Boolean);
  const transformed = upper ? normalized.map((item) => item.toUpperCase()) : normalized;
  return [...new Set(transformed)].sort(compareText);
}

function scalarEquals(left, right) {
  if (typeof left === "number" || typeof right === "number") return Number(left) === Number(right);
  return String(left).normalize("NFKC").toUpperCase() === String(right).normalize("NFKC").toUpperCase();
}

function matchesAny(actual, requested) {
  if (requested.length === 0) return true;
  const actualValues = asArray(actual);
  return requested.some((expected) => actualValues.some((value) => scalarEquals(value, expected)));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function normalizeQuery(value) {
  return String(value || "").normalize("NFKC").trim().toLowerCase();
}

function termTokens(value) {
  const normalized = normalizeQuery(value);
  const tokens = normalized.split(/[^\p{L}\p{N}]+/gu).filter(Boolean);
  return { normalized, tokens, compact: tokens.join("") };
}

function searchableValues(product) {
  const values = [product.id, product.name, product.category, product.group, product.manufacturer, product.brand, ...product.aliases];
  for (const value of Object.values(product.browse_facets)) {
    for (const item of asArray(value)) values.push(item);
  }
  return values.filter((value) => value !== null && value !== undefined).map(termTokens);
}

function matchesQuery(product, query) {
  if (!query) return true;
  const requested = termTokens(query);
  const searchable = searchableValues(product);
  if (searchable.some((entry) => entry.normalized === requested.normalized || entry.compact === requested.compact)) return true;
  // Marketplace titles commonly omit the separator in suffixes (e.g. 2080ti,
  // 14700kf). Match the compact form against the compact facet/model value
  // while keeping the normal token check for broad queries such as "3060".
  if (requested.compact.length >= 4 && searchable.some((entry) => {
    for (let start = 0; start < entry.tokens.length; start += 1) {
      for (let end = start + 2; end <= entry.tokens.length; end += 1) {
        if (entry.tokens.slice(start, end).join("") === requested.compact) return true;
      }
    }
    return false;
  })) return true;
  const allTokens = new Set(searchable.flatMap((entry) => entry.tokens));
  return requested.tokens.length > 0 && requested.tokens.every((token) => allTokens.has(token));
}

function knownFacetNames(categories) {
  const names = new Set(["directory_node_type"]);
  for (const category of categories) {
    for (const name of Object.keys(PC_PART_FACET_SCHEMA_V2[category] || {})) names.add(name);
  }
  return names;
}

function normalizeOptions(options = {}) {
  const categories = normalizeStringValues(options.category, true);
  for (const category of categories) {
    if (!CATEGORY_ORDER.has(category)) throw new RangeError(`Unknown PC part category: ${category}`);
  }
  const sort = String(options.sort || DEFAULT_SORT).toUpperCase();
  if (!ALLOWED_SORTS.has(sort)) throw new RangeError(`Unsupported PC directory sort: ${sort}`);
  const limitNumber = Number(options.limit ?? 50);
  if (!Number.isInteger(limitNumber) || limitNumber < 1 || limitNumber > 100) {
    throw new RangeError("PC directory limit must be an integer from 1 to 100");
  }
  const facets = {};
  const validFacetNames = knownFacetNames(categories.length > 0 ? categories : [...CATEGORY_ORDER.keys()]);
  for (const [name, value] of Object.entries(options.facets || {})) {
    if (!validFacetNames.has(name)) throw new RangeError(`Unknown PC directory facet: ${name}`);
    const values = asArray(value).filter((item) => item !== undefined && item !== null && item !== "");
    if (values.length > 0) facets[name] = [...new Set(values)].sort((left, right) => compareText(String(left), String(right)));
  }
  return {
    category: categories,
    manufacturer: normalizeStringValues(options.manufacturer),
    brand: normalizeStringValues(options.brand),
    group: normalizeStringValues(options.group),
    node_type: normalizeStringValues(options.node_type, true),
    query: normalizeQuery(options.query),
    facets,
    sort,
    limit: limitNumber,
    cursor: options.cursor ? String(options.cursor) : null
  };
}

function cursorFingerprint(options) {
  const identity = {
    master_version: PC_PRODUCT_MASTER_V2_VERSION,
    category: options.category,
    manufacturer: options.manufacturer,
    brand: options.brand,
    group: options.group,
    node_type: options.node_type,
    query: options.query,
    facets: options.facets,
    sort: options.sort
  };
  return createHash("sha256").update(stableStringify(identity)).digest("base64url").slice(0, 24);
}

function encodeCursor(offset, fingerprint) {
  return Buffer.from(stableStringify({ v: DIRECTORY_CURSOR_VERSION, f: fingerprint, o: offset }), "utf8").toString("base64url");
}

function decodeCursor(cursor, fingerprint) {
  if (!cursor) return 0;
  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new TypeError("Invalid PC directory cursor");
  }
  if (!decoded || decoded.v !== DIRECTORY_CURSOR_VERSION || decoded.f !== fingerprint || !Number.isSafeInteger(decoded.o) || decoded.o < 0) {
    throw new TypeError("PC directory cursor does not match this query");
  }
  return decoded.o;
}

export function listPcPartCategoriesV2() {
  return PC_PART_CATEGORY_SEEDS_V2.map((category) => {
    const products = PC_PRODUCT_MASTER_V2.filter((product) => product.category === category.code);
    return {
      code: category.code,
      label: category.label,
      order: category.order,
      registered_node_count: products.length,
      registered_product_count: products.filter((product) => product.spec.directory_node_type === "PRODUCT").length,
      manufacturers: category.manufacturers.map((manufacturer) => ({
        value: manufacturer,
        registered_node_count: products.filter((product) => scalarEquals(product.manufacturer, manufacturer)).length
      })),
      brands: [...category.brands]
    };
  });
}

export function getPcPartFacetSchemaV2(category) {
  if (category === undefined || category === null || category === "") return PC_PART_FACET_SCHEMA_V2;
  const normalized = String(category).toUpperCase();
  if (!CATEGORY_ORDER.has(normalized)) throw new RangeError(`Unknown PC part category: ${normalized}`);
  return PC_PART_FACET_SCHEMA_V2[normalized];
}

export function queryPcPartsDirectoryV2(options = {}) {
  const normalized = normalizeOptions(options);
  const fingerprint = cursorFingerprint(normalized);
  const offset = decodeCursor(normalized.cursor, fingerprint);
  const filtered = PC_PRODUCT_MASTER_V2.filter((product) => {
    if (!matchesAny(product.category, normalized.category)) return false;
    if (!matchesAny(product.manufacturer, normalized.manufacturer)) return false;
    if (!matchesAny(product.brand, normalized.brand)) return false;
    if (!matchesAny(product.group, normalized.group)) return false;
    if (!matchesAny(product.spec.directory_node_type, normalized.node_type)) return false;
    if (!matchesQuery(product, normalized.query)) return false;
    return Object.entries(normalized.facets).every(([name, requested]) => matchesAny(product.browse_facets[name], requested));
  }).sort((left, right) => compareProducts(left, right, normalized.sort));
  if (offset > filtered.length) throw new RangeError("PC directory cursor offset is outside the result set");
  const items = filtered.slice(offset, offset + normalized.limit);
  const nextOffset = offset + items.length;
  return {
    items,
    total: filtered.length,
    limit: normalized.limit,
    sort: normalized.sort,
    next_cursor: nextOffset < filtered.length ? encodeCursor(nextOffset, fingerprint) : null
  };
}

export function pcPartsDirectoryForApiV2(options = {}) {
  const normalizedCategory = normalizeStringValues(options.category, true);
  return {
    master_version: PC_PRODUCT_MASTER_V2_VERSION,
    categories: listPcPartCategoriesV2(),
    facet_schema: normalizedCategory.length === 1 ? getPcPartFacetSchemaV2(normalizedCategory[0]) : getPcPartFacetSchemaV2(),
    products: queryPcPartsDirectoryV2(options),
    query: {
      category: normalizedCategory,
      manufacturer: normalizeStringValues(options.manufacturer),
      brand: normalizeStringValues(options.brand),
      group: normalizeStringValues(options.group),
      node_type: normalizeStringValues(options.node_type, true),
      query: normalizeQuery(options.query),
      facets: stableValue(options.facets || {}),
      sort: String(options.sort || DEFAULT_SORT).toUpperCase()
    }
  };
}
