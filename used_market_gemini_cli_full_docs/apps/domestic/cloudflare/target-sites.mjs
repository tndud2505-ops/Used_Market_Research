import { PC_SOURCE_REGISTRY } from "../collector/logic/pc-source-registry.mjs";

const PUBLIC_SEARCH_SOURCES = PC_SOURCE_REGISTRY
  .filter((source) => source.public_search)
  .sort((left, right) => left.public_search_order - right.public_search_order);

const OPERATIONAL_PUBLIC_SEARCH_SOURCES = PUBLIC_SEARCH_SOURCES
  .filter((source) => source.policy_status === "APPROVED" && source.runtime_status === "ENABLED");

const PC_DIRECTORY_SOURCES = PC_SOURCE_REGISTRY.filter((source) => source.directory_source === true);
const OPERATIONAL_PC_DIRECTORY_SOURCES = PC_DIRECTORY_SOURCES
  .filter((source) => source.policy_status === "APPROVED" && source.runtime_status === "ENABLED");

export const TARGET_SITES = Object.freeze(PUBLIC_SEARCH_SOURCES.map((source) => source.key));
export const OPERATIONAL_TARGET_SITES = Object.freeze(OPERATIONAL_PUBLIC_SEARCH_SOURCES.map((source) => source.key));
export const PC_DIRECTORY_SITES = Object.freeze(PC_DIRECTORY_SOURCES.map((source) => source.key));
export const OPERATIONAL_PC_DIRECTORY_SITES = Object.freeze(OPERATIONAL_PC_DIRECTORY_SOURCES.map((source) => source.key));

export const TARGET_SITE_LABELS = Object.freeze(Object.fromEntries(
  PUBLIC_SEARCH_SOURCES.map((source) => [source.key, source.name])
));

export function normalizeTargetSites(value, fallback = TARGET_SITES) {
  const values = Array.isArray(value) ? value : fallback;
  return [...new Set(values
    .filter((site) => typeof site === "string")
    .map((site) => site.trim().toLowerCase())
    .filter((site) => TARGET_SITES.includes(site)))];
}

export function normalizeOperationalTargetSites(value, fallback = OPERATIONAL_TARGET_SITES) {
  const values = Array.isArray(value) ? value : fallback;
  return [...new Set(values
    .filter((site) => typeof site === "string")
    .map((site) => site.trim().toLowerCase())
    .filter((site) => OPERATIONAL_TARGET_SITES.includes(site)))];
}
