import { spawn } from 'node:child_process';
import { pcCollectionTargetSetV2 } from './pc-directory-http.mjs';
import { PC_SOURCE_REGISTRY } from '../collector/logic/pc-source-registry.mjs';

const tunnelMode = (process.env.CLOUDFLARE_TUNNEL_MODE ?? 'named').trim().toLowerCase();
const appOnly = process.argv.includes('--app-only');
const preflightOnly = process.argv.includes('--preflight-only');
if (appOnly && preflightOnly) {
  console.error('Choose either --app-only or --preflight-only, not both');
  process.exit(2);
}
const namedTunnelOrigin = 'https://runner.used-pick.com';
const expectedLegacySites = Object.freeze(PC_SOURCE_REGISTRY
  .filter((source) => source.public_search === true
    && source.policy_status === 'APPROVED' && source.runtime_status === 'ENABLED')
  .map((source) => source.key)
  .sort());
const expectedPcDirectorySites = Object.freeze(PC_SOURCE_REGISTRY
  .filter((source) => source.directory_source === true
    && source.policy_status === 'APPROVED' && source.runtime_status === 'ENABLED')
  .map((source) => source.key)
  .sort());
const expectedPcTargetSet = pcCollectionTargetSetV2();
const expectedPcCategoryCodes = Object.freeze([...new Set(expectedPcTargetSet.targets
  .filter((target) => target.enabled !== false)
  .map((target) => target.categoryCode))].sort());
const expectedPcSourceTargetCounts = Object.freeze(expectedPcTargetSet.targets.reduce((counts, target) => {
  if (target.enabled === false) return counts;
  for (const sourceKey of target.sourceKeys || []) counts[sourceKey] = (counts[sourceKey] || 0) + 1;
  return counts;
}, {}));
const schedulerRecentMs = 2 * 60 * 60 * 1000;
const publicationRecentMs = 26 * 60 * 60 * 1000;
let preflightFailed = false;

function isRecentTimestamp(value, maxAgeMs) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) && parsed <= Date.now() && Date.now() - parsed <= maxAgeMs;
}

function pcReadinessBlockReasons(health) {
  const pcParts = health?.pc_parts || {};
  const reasons = [];
  const actualSites = Array.isArray(health?.target_sites) ? [...health.target_sites].sort() : [];
  if (JSON.stringify(actualSites) !== JSON.stringify(expectedLegacySites)) reasons.push('RUNNER_TARGET_SITES_MISMATCH');
  if (pcParts.ledger_ready !== true) reasons.push('PC_LEDGER_NOT_READY');
  if (pcParts.scheduler_enabled !== true) reasons.push('PC_SCHEDULER_DISABLED');
  if (!isRecentTimestamp(pcParts.last_succeeded_at, schedulerRecentMs)) reasons.push('PC_SCHEDULER_NOT_RECENT');

  const collectionTargets = pcParts.collection_targets || {};
  if (collectionTargets.target_set_version !== expectedPcTargetSet.targetSetVersion
    || Number(collectionTargets.declared_target_count) !== expectedPcTargetSet.targets.length
    || Number(collectionTargets.enabled_target_count) !== expectedPcTargetSet.targets.filter((target) => target.enabled !== false).length) {
    reasons.push('PC_COLLECTION_TARGET_SET_MISMATCH');
  }
  if (Number(collectionTargets.monitor_target_count) !== 0) reasons.push('MONITOR_COLLECTION_TARGET_PRESENT');
  if (JSON.stringify([...(collectionTargets.category_codes || [])].sort()) !== JSON.stringify(expectedPcCategoryCodes)) {
    reasons.push('PC_COLLECTION_CATEGORY_COVERAGE_MISMATCH');
  }
  for (const sourceKey of expectedPcDirectorySites) {
    if (Number(collectionTargets.source_target_counts?.[sourceKey] || 0) !== Number(expectedPcSourceTargetCounts[sourceKey] || 0)) {
      reasons.push(`PC_COLLECTION_SOURCE_TARGETS_MISMATCH:${sourceKey}`);
    }
  }

  const sourceReadiness = Array.isArray(pcParts.source_readiness) ? pcParts.source_readiness : [];
  const readinessKeys = sourceReadiness.map((source) => source?.source_key).filter(Boolean).sort();
  if (JSON.stringify(readinessKeys) !== JSON.stringify(expectedPcDirectorySites)) {
    reasons.push('PC_SOURCE_READINESS_INCOMPLETE');
  }
  for (const source of sourceReadiness) {
    if (source?.policy_status === 'REVIEW_REQUIRED') reasons.push('REVIEW_REQUIRED_SOURCE_IN_READINESS');
    if (!expectedPcDirectorySites.includes(source?.source_key) || source?.ready !== true
      || source?.policy_approved !== true || source?.runtime_enabled !== true
      || source?.canary_evidence !== true || source?.recent_committed_crawl !== true) {
      reasons.push(`PC_SOURCE_NOT_READY:${source?.source_key || 'unknown'}`);
    }
  }
  if (pcParts.all_sources_ready !== true) reasons.push('PC_ALL_SOURCES_NOT_READY');
  if (!Array.isArray(pcParts.review_required_active_sources)) {
    reasons.push('PC_REVIEW_REQUIRED_STATE_MISSING');
  } else if (pcParts.review_required_active_sources.length > 0) {
    reasons.push('REVIEW_REQUIRED_SOURCE_ACTIVE');
  }
  if (pcParts.rollback_projection_ready !== true) reasons.push('PC_ROLLBACK_PROJECTION_NOT_READY');
  if (pcParts.publication_configured !== true) reasons.push('PC_PUBLICATION_NOT_CONFIGURED');
  if (pcParts.publication_recent !== true
    || !isRecentTimestamp(pcParts.publication_last_success_at, publicationRecentMs)) {
    reasons.push('PC_PUBLICATION_NOT_RECENT');
  }
  return [...new Set(reasons)];
}

if (tunnelMode !== 'named') {
  console.error('CLOUDFLARE_TUNNEL_MODE must be named while AWS_PC_SCHEDULER_AUTHORITY=true');
  process.exit(2);
}
const runnerUrl = process.env.CLOUDFLARE_RUNNER_URL?.trim()
  || (tunnelMode === 'named' ? `${namedTunnelOrigin}/api/runner/run` : undefined);
const searchRunnerUrl = process.env.CLOUDFLARE_SEARCH_RUNNER_URL?.trim()
  || (tunnelMode === 'named' ? `${namedTunnelOrigin}/api/search` : undefined);
const originUrl = process.env.CLOUDFLARE_ORIGIN_URL?.trim()
  || (tunnelMode === 'named' ? namedTunnelOrigin : undefined);
const freeTierMode = (process.env.CLOUDFLARE_FREE_TIER_MODE
  ?? (tunnelMode === 'named' || tunnelMode === 'custom' ? 'false' : 'true'))
  .trim().toLowerCase() !== 'false';
if ((tunnelMode === 'named' || tunnelMode === 'custom') && freeTierMode) {
  console.error('Named/custom Cloudflare Tunnel deployment requires CLOUDFLARE_FREE_TIER_MODE=false');
  process.exit(2);
}
if (!freeTierMode && (!runnerUrl || !/^https:\/\//i.test(runnerUrl))) {
  console.error('CLOUDFLARE_RUNNER_URL must be an https URL to /api/runner/run');
  process.exit(2);
}
if (!freeTierMode && (!searchRunnerUrl || !/^https:\/\//i.test(searchRunnerUrl))) {
  console.error('CLOUDFLARE_SEARCH_RUNNER_URL must be an https URL to /api/search');
  process.exit(2);
}
if (appOnly) {
  console.warn('Application-only deployment: skipping AWS source and publication readiness preflight');
} else if (tunnelMode === 'named') {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${namedTunnelOrigin}/health`, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    const health = await response.json();
    const readinessBlockReasons = pcReadinessBlockReasons(health);
    if (readinessBlockReasons.length > 0) {
      throw new Error(`AWS_PC_RELEASE_NOT_READY:${readinessBlockReasons.join(',')}`);
    }
    if (health?.pc_parts?.last_error) {
      console.warn(`AWS PC scheduler warning: ${String(health.pc_parts.last_error).slice(0, 300)}`);
    }
  } catch (error) {
    console.error(`Named Tunnel preflight failed for ${namedTunnelOrigin}/health: ${error instanceof Error ? error.message : String(error)}`);
    console.error('Update the AWS Runner and satisfy every directory-source canary, recent collection, rollback projection, and publication readiness gate before deployment.');
    preflightFailed = true;
  } finally {
    clearTimeout(timeout);
  }
}

if (preflightFailed) {
  process.exitCode = 2;
} else if (preflightOnly) {
  console.log('AWS PC scheduler and publication preflight passed.');
} else {
const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const wranglerPackage = process.env.CLOUDFLARE_WRANGLER_PACKAGE?.trim() || 'wrangler@4.121.0';
const args = [
  '--yes',
  '--package',
  wranglerPackage,
  'wrangler',
  'deploy',
  '--config',
  'cloudflare/wrangler.jsonc'
];
if (runnerUrl) {
  args.push('--var', `RUNNER_URL:${runnerUrl}`);
}
if (searchRunnerUrl) {
  args.push('--var', `SEARCH_RUNNER_URL:${searchRunnerUrl}`);
}
if (originUrl) {
  args.push('--var', `ORIGIN_URL:${originUrl}`);
}
if (process.env.CLOUDFLARE_FREE_TIER_MODE) {
  args.push('--var', `FREE_TIER_MODE:${freeTierMode}`);
}
const hasExplicitRuntimeVars = Boolean(
  runnerUrl || searchRunnerUrl || originUrl || process.env.CLOUDFLARE_FREE_TIER_MODE
);
if (!hasExplicitRuntimeVars) {
  args.push('--keep-vars');
}
// Windows exposes npm as npx.cmd; Node 24 requires shell resolution for this shim.
const child = spawn(command, args, {
  stdio: 'inherit',
  shell: process.platform === 'win32'
});

child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
}
