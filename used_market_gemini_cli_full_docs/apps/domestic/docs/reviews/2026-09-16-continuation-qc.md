# Continuation independent quality check

The current shared workspace has another ongoing implementation stream for the same
v18 parts/prices release. This review stream does not deploy or mutate the production
database concurrently with that stream. Runtime source changes already present are
preserved. The release owner should read this file before cutover.

## Available evidence

- Production identification succeeded through the existing approved SSH host.
  The source database uses normalization 17 / parser v7 / rules v17 / filter v6,
  with schema migrations 1–10. No production data were changed by this review.
- The new `pc-stored-price-publication` regression passed independently: six
  different-day G.Skill observations retain their exact total mean and the four-row
  Bunjang median. The original failure no longer reproduces in that stored path.
- `tmp/pc-resume-full-audit.mjs` audits every public tool catalog identity, including
  case/cooling, against the live price API at bounded concurrency 3. It stores
  before/after counts, source exclusions, HTTP failures, versions and search aliases
  in ignored JSON files. It performs no collection or administrative calls.

## Release checks to retain

- Validate the existing complete test suite after the master v5 changes, including
  the immutable v13 target ownership and new motherboard identity boundaries.
- Do not activate v18 while an unacknowledged/incomplete publication is being served.
  Preserve the exact pre-change database and Worker versions for rollback.
- New target IDs have no successful collection evidence until actually collected.
  Reclassifying old rows must not fabricate source-target success timestamps.
- The source publication summary is a 30-day cohort, not an arbitrary-date summary.
  Preserve `published_window`/`as_of`; a current publication must not silently become
  the response to an unavailable historical window.
- Report regression fixtures as regression fixtures, not as a newly human-reviewed
  independent evaluation dataset.

## Additional blocking census findings (14:22 UTC)

The exhaustive synthetic catalog-to-pipeline census checked all 788 selectable v5
identities. RAM, SSD, HDD, PSU, case and cooling passed. It found 16 genuine
unreachable/statistics-excluded identities: 12 Intel Core Ultra desktop products,
RX Vega 56/64, Radeon VII and ASUS ROG CROSSHAIR VIII IMPACT. The Core Ultra and
English Radeon names were not recognized by category detection; the exact Crosshair
model was incorrectly rejected because its display name does not contain a chipset.
The additional B450M DS3H failure was a census input issue (`rev 1.x` rather than a
numeric revision), not grounds for relaxing revision checks.

This QC stream is fixing those narrowly scoped classifier paths and adding a
deterministic census regression. Rebuild the source package and staging preview
after these changes; do not deploy an earlier v18 archive. We are not mutating the
production database or invoking a second deployment.

The live baseline audit completed for all 795 production tool entries. HTTP 200
alone hid invalid summaries: GPU 31, CPU 42, RAM 19, motherboard 5, SSD 21, HDD 17,
PSU 20 entries had one or more inconsistent aggregate/source metrics. Case/cooling
had no published samples. Full evidence is in ignored
`tmp/pc-resume-full-audit-before.json`; repeat with `--after` after cutover.

### Census remediation completed (14:28 UTC)

The classifier fix is now in the shared working tree. All 788 selectable identities
pass the complete synthetic ingestion census, with zero identity mismatches and zero
unexpected statistics exclusions. The new deterministic
`harness/pc-catalog-ingestion-contract.mjs` also passes 18 negative boundaries
(unknown Ultra suffix/tier, notebook/full-PC/mixed bundles, Vega multi-model lots,
accessories and defective products) and is included in `test:pc-tools`.
`pc-domain` and `pc-public-catalog` passed independently after this change.

Runtime changes are confined to `market/logic/pc-parts-classifier.mjs`; they include
bounded Core Ultra model recognition, English Vega 56/64 and Radeon VII recognition
with matching bundle/accessory guards, correct AMD identity for Radeon VII, and
authoritative exact-model fallback for motherboard names without chipset tokens.
No production database, pipeline version or collection success was changed by this
QC stream. The staging/deployment owner must regenerate the release archive so these
fixes participate in v18 reclassification rather than only future ingestion.

Independent final `npm test` plus `git diff --check` passed at 14:32 UTC with the
census contract included. The 125-record existing fixture quality evaluation also
passed all six targets with zero integrity blockers. These are regression results,
not new independent human-review observations. The uploaded staging tree was observed
to contain `pc-catalog-ingestion-contract.mjs`, so it is newer than the stale 14:20
archive noted earlier.

Operational caution: the standalone `reclassify-pc-snapshots.mjs` CLI does not call
`pipeline.initialize()` itself. The staging wrapper correctly does. Production
reclassification must likewise register the new v5 master before normalizing RAM
and motherboard identities; do not run the old CLI on a database containing only
the prior master and interpret the resulting unmatched rows as a valid dry-run.

## Optional short-outage staging reuse (14:58 UTC)

Production remains v17; the first staging process was still CPU-bound after 23
minutes. An optional guarded reuse helper is now available as
`aws-runner/pc-staged-normalization-import.mjs`. Its dedicated
`harness/pc-staged-normalization-import-contract.mjs` passed: two stage-normalized
observations import with remapped child IDs, a third later production observation
is retained for catch-up, source snapshots remain unchanged, and source mismatch,
wrong model/version/coverage or repeat imports fail closed. It copies no publication
preview or collection success records and does not activate the production version.

This helper is NOT wired into the production script and this stream has NOT invoked
it against production. The deployment owner may use it after the stage report is
sealed to avoid a second full classification pass while the service is stopped, or
retain the now-faster alias-snapshot reclassification route. Do not change the
production script after its archive/hash preflight without updating that evidence.

Post-deploy cache check: `cloudflare/free-tier.mjs` currently uses a stable
`used-market-pc-read-cache-v1.invalid` namespace with a 300-second TTL. A fresh
Worker deployment does not itself prove that an ordinary previously cached price
URL serves v18. Verify the ordinary production URLs (not only QA cache-busted URLs)
after cache expiry or an intentional namespace change before calling the release
fully verified. The exhaustive `--after` audit records every response's version.

Live UI QA was extended in the owner's existing `tmp/pc-live-v18-browser.mjs`:
after the RAM-only flow it restores all nine representative real production parts
from the build URL and independently sums their real API prices (10 units, including
two RAM modules). It checks both active/sold partial coverage, total amounts and
visible compatibility conflicts, then captures the full desktop/mobile quote. This
adds no new browser process or mocked data and has not yet been run on production.
