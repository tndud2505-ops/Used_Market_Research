# UI Concept A implementation — 2026-09-17

## Current decision

**IMPLEMENTED IN LOCAL WORKING TREE / BROWSER VERIFICATION BLOCKED / NOT RELEASED.**

The user approved applying Concept A to the real application and asked for repeated checks. This task changed the real application files, not just the standalone design attachment. No commit, Worker deployment, Runner change, collection job, D1/SQLite production write or credential/profile change was performed by this task.

Normal production URLs `/`, `/computer-builder.html`, `/price-analysis.html` returned HTTP 200 at **2026-09-17 17:16:20 KST** and still referenced the old `ui-refinement.css`; none contained the new `data-ui-release="ui-a-v1"` marker. The public site was therefore still on the prior UI at this check. Source/API checks do not establish a browser pass.

## Changes implemented

- Shared `ui-concept-a.css` replaces the loaded `ui-refinement.css` on six pages. Existing `styles.css` and `pc-tools.css` remain the base; the old refinement file is retained for rollback/other legacy uses but is not stacked on the new theme.
- `index.html` / `app.js`: consistent header/title, real category-derived icon tabs, model/brand search wired to `applyCatalogSearch`, filter rail, native mobile filter dialog with the original filter DOM moved/restored, selected-model price summary above listings, expandable chart, aligned listing metadata and prices.
- `computer-builder.html` / `pc-tools.js`: selected parts and separate summary panel, native model picker dialog, explicit save and print controls, selected-category focus restoration, partial totals and unknown prices preserved. The summary jump is a button, not a hash anchor, so it does not erase the serialized build fragment.
- `price-analysis.html` / `pc-tools.js`: visible price-method/sample/date details, individual source comparison from the actual selected API scope, contextual comparison-unit information, valid current-listing links only for publicly browsable categories. Unknown publication coverage is labelled `표본 미확인`, not fabricated as zero samples.
- `pc-tools-chart.mjs`: chart coordinate width/tick density adapts to narrow containers; original data-gap and keyboard interaction logic remains. Actual rendered readability still needs a browser check.
- `guide.html`, `privacy.html`, `terms.html`: common navigation/theme/skip link and reading-width layout. Their original `<main>` content is identical after CRLF normalization; legal/document wording was not rewritten.
- New `harness/pc-ui-concept-a-contract.mjs`, registered as `npm run test:ui-a` and included in `npm test`.
- Existing `pc-agent2-ui-contract.mjs` checks the approved new UI asset version while retaining its data, price, quantity and scope assertions.

Core data files `pc-tools-core.mjs`, `pc-tools-data.mjs`, `pc-tools-catalog.mjs` were not edited and match the checked HEAD after line-ending normalization. No prototype prices, listings, sample counts or chart series were copied into production source.

## Checks actually performed

| Check | Result | Meaning |
|---|---|---|
| JS syntax checks | PASS | app.js, pc-tools.js, pc-tools-chart.mjs |
| Existing full `npm test` | PASS, exit 0 | Build and all existing deterministic suites |
| Root `scripts/verify.ps1` | PASS, exit 0 | Full deterministic suite, including new UI-A tests |
| New UI-A contract | 15/15 PASS | Source assertions and actual functions in a synthetic DOM-like harness; not real browser events |
| Source preservation audit | 14/14 PASS | Six HTML tag-balance checks, three document-copy comparisons, three unchanged data modules, CSS braces, tracked UI diff whitespace |
| Local HTTP / public data smoke | 12/12 PASS | Six local page responses, four local assets, real public catalog and one real public price-stat identity response |
| Normal production URL read | 3 HTTP 200, old UI retained | Verifies that the A candidate was not visible on those production routes |
| Real desktop/mobile layout and E2E | NOT RUN | Required global browser skill unavailable |
| Production UI release | NOT RUN | Do not deploy the unverified UI working tree |

The small CSS specificity correction for the selected-model toolbar was followed by another UI-A contract run and source audit. The full root suite had already passed immediately before this CSS-only correction. Browser-dependent visual assertions, reload/storage persistence in an actual browser, actual interaction focus behavior, print rendering, overflow measurements and screenshot matching are still pending.

The source-copy audit initially detected CRLF/LF differences immediately after an edited opening `<main>` tag. The check was corrected to normalize CRLF only; content/spacing/wording assertions were not removed. A later shell-quoted inline public-read command failed to parse before making requests; the standalone `audit-public.mjs` subsequently completed successfully. Synthetic cache/503 messages in the full test log are intentional failure-path fixtures, not observations of a production outage.

## Local preview available for the operator

At the last check, the preview was listening at **`http://127.0.0.1:60992`**, PID **85112**. It serves the actual modified `web-backend/public` files and forwards only allowlisted **public GET/HEAD** catalog/product/listing/price-stat requests to the real site. It does not read `.env`, use credentials, call admin/collection endpoints, or fabricate price responses. Mutating requests are rejected.

This is a loopback-only local preview, not a deployment. The preview deliberately disables non-allowlisted endpoints and third-party script execution, so advertising behavior is not represented. It is for the user's manual review; the assistant did not open a browser or claim pixel-level verification.

Runtime identity: `tmp/ui-a-implementation-20260917/preview-runtime.json`. Recheck the PID and command before stopping any process. Do not terminate other projects' local servers or personal browsers.

## Evidence and source ownership

All evidence/backups are ignored runtime outputs under `tmp/ui-a-implementation-20260917/`:

- `baseline/`: nine original UI/document/JS files copied before this task's edits.
- `npm-test-first.log`, `root-verify-final.log`, `ui-a-contract.log`.
- `source-audit.json`: current UI asset hashes, last checked HEAD and working-tree status.
- `preview-http-smoke.json`: local response hashes plus the real public API checks.
- `public-read-check.json`: latest ordinary public URL results and local preview health.
- `preview.mjs`, `audit-source.mjs`, `audit-public.mjs`: local helper scripts; not production replacements.

The repo HEAD changed concurrently from `4931803` to `75849b6edec42b431c0377a7e3acab95d1056e05`; this task did not make those commits. Existing changes to `cloudflare/wrangler.jsonc` and other workers' review/release outputs were preserved and are not part of this UI task. Recheck status and hashes before integration. Do not use `git add -A` to mix unrelated work into the UI commit.

Owned implementation files are the six page HTML files; app.js; pc-tools.js; pc-tools-chart.mjs; ui-concept-a.css; the UI-A harness; the modified agent2 asset-version assertion; package.json's test hook; and this implementation/design documentation. No new dependency was installed.

## Required next step

The repository's AGENTS.md requires applying the actual global **`external-ai-orchestrator/SKILL.md`** before agent-driven browser verification. Searches of the available approved roots, relevant skill-directory candidates, prior tool records and available Project/Library handoff documents did not provide that file or an exact accessible location. The user was asked for the actual file or location. No substitute skill was invented and no browser security setting was weakened.

After the file is available, read it, recheck concurrent work, and perform real-browser validation using its rules: desktop and 320/360/390px mobile, category/search/filter flow, native dialogs and Escape/focus, nine builder categories, quantity precision, save/reload/remove, failed storage, source/market/currency changes, missing and historical data states, chart labels and gaps, guide/legal navigation, console errors and screenshots against the approved design. Fix and rerun failures, then rerun deterministic/root checks on the frozen candidate. Only then consider the documented app-only Worker release path for this UI-only change; do not replace the Runner or republish price data just to deploy styling.
