# Builder toolbar and price-read recovery

## Requested change

Fix the `EXACT_STATS_NOT_READY` graph/model-picker failure paths and place the
selection count, active total, sold total and existing Coupang offer next to
the computer-builder heading instead of underneath the parts table.

## Implementation

- Validate the Runner's price payload before selecting the preferred store.
  A semantically unavailable HTTP 200 can now reach the existing D1 fallback
  for implicit current requests. The fallback must pass the same readiness
  validation. Explicit dates still cannot borrow a current D1 publication.
- Validate price-cache hits before returning them. An invalid hit is evicted
  and gets one bounded origin refresh. Healthy hits do not call the Runner;
  errors and `no-store` responses are not cached.
- For the already-supported last completed daily publication, `window` now
  contains its actual dates and `requested_window` retains the requested dates.
  The allowed age/period policy has not been loosened. Two-day-old data and
  mismatched explicit dates remain unavailable.
- Move the original live `#build-summary` and `#contextual-offer` nodes into
  `.sf-builder-bar`. Remove the render-time relocation into `<tfoot>`.
  `builder-toolbar.css` isolates responsive, disclosure-popover and print rules.
- Preserve both quantity-adjusted totals and mixed-publication safeguards.
  Empty builds omit the unhelpful `0/0` coverage text, not the selection count.
- Replace duplicate retry buttons in builder price cells with one status/retry
  region above the model table. Model selection remains available without a
  representative price. Existing ad sponsorship/disclosure behavior remains.
- Update the builder/analysis script URLs to `pc-tools.js?v=builder-price-v1`.
  Unchanged shared calculation/data assets keep their existing versions.

## Verification

The baseline full `npm test` passed before editing. After editing, these passed:

- `node harness/pc-ui-contract.mjs`
- `npm run test:pc-final`, including 11 new synthetic price-recovery tests
- `npm run test:ui-a`: 18 UI contracts and 9 price-preview contracts
- `git diff --check` and syntax checks for the edited UI/Worker/browser harness

The existing footer-location assertion was updated to enforce the requested
header location and reject render-time footer relocation, rather than removed.
The browser acceptance harness has matching header-location assertions but was
not executed.

Final combined verification: `npm test` passed with exit code 0 after the
header-location assertion update. This includes the TypeScript build and all
PC domain/service, tools, publication, price-readiness/recovery and UI suites.

## Operational boundary

No production deployment, production database write, collection or publication
activation was performed. A combined verification/connection-health request
was blocked at the tool security check. Standalone local tests remained usable;
browser health was not established, so no browser QA or deployment was launched.

This validates recovery when a correct stored publication exists. It does not
prove that the live API currently contains such a publication for every model,
or that the reported production 503 has disappeared. Keep genuinely missing,
incomplete and stale publications unavailable instead of manufacturing prices.
