# USED PICK UI Concept A — 2026-09-17

> **Implementation update, 2026-09-17:** The user approved Concept A. The actual application UI has now been changed in the working tree, with the existing production data/calculation modules preserved. It is **not released** and **has not passed real-browser verification**. Current implementation, local preview, test evidence and the missing browser-skill prerequisite are recorded in [IMPLEMENTATION.md](./IMPLEMENTATION.md). The original design-only record below describes the earlier design task, not the latest implementation state.

## Status and scope

The user has approved Concept A and then requested a checkpoint commit of existing work BEFORE UI implementation, with actual-site browser review before and during the redesign. The original proposal did not modify production UI, backend, collection, prices or deployment settings. Implementation and deployment of Concept A have not started.

The working prototype is the self-contained `USED_PICK_UI_Concept_A.html` in this directory, also attached in the conversation. Conversation screenshots cover market, builder, analysis and guide, on desktop and mobile. All prototype prices, listings, sample counts and chart series are synthetic and visibly labelled as examples. Do not copy its fixture data or demo logic into production.

The initial automatic transfer failed on a trusted-file-host check. On the user's subsequent checkpoint request, the normal `download_artifact` action succeeded without changing security controls: 63,340 bytes, SHA-256 `dd55f96899e1be4d82fb6f757eae489d63c902e6afefe7dad8873fe59bdc3087`. The actual HTML, not a shell-reconstructed substitute, is now present for the checkpoint commit.

## Before-redesign checkpoint

- Observed starting HEAD: `4931803ccc7e6579953e4edcb0660147e39cf02e`, following the integrated `129cc2d` source/test commit.
- Re-ran the entire application `npm test` (build, pc, pc-tools, pc-release, pc-final): exit 0. This is deterministic verification, not a browser or live-price pass.
- Existing release/handoff Markdown documents are historical records of their stated time and execution owner. Preserve them without claiming their deployments or browser captures were performed by this design task.
- Exclude raw JSON evidence, the superseded v3 precision/reset patch, temporary deployment scripts, secrets, runtime results and browser profiles from the checkpoint. Existing copies are retained locally, not deleted.
- The required `external-ai-orchestrator/SKILL.md` was absent at the checked user-profile, workspace and repository skill paths. Actual browser execution has not been performed. Do not fabricate a skill file or remove the existing browser harness's skill requirement.
- Public page text/HTTP or asset-byte checks do not satisfy the user's requested actual-browser baseline. No application-source redesign or deployment should be reported as completed before that baseline is available.

## Review evidence

- Read repository AGENTS.md, README.md, SETUP.md, app package.json, docs/AI_CONTEXT.md, mobile UI guidelines and harness-loop guidance.
- Read current public/index.html, computer-builder.html, price-analysis.html, ui-refinement.css and styles.css tokens, plus existing logo SVG.
- Read public pages for the three principal routes and guide.html.
- Visually reviewed existing saved 2026-09-17 14:32 browser evidence for builder and analysis. These were prior-run captures, not new production browser verification.
- Also reviewed the older pc-search-desktop-reference-v5.png design reference; it is not evidence of the current production screen.
- A new production screenshot attempt from the isolated execution environment was rejected with ERR_BLOCKED_BY_ADMINISTRATOR. No browser security policies were changed.
- The new standalone prototype was rendered in memory with Chromium, without navigating to production or calling its APIs.
- Final prototype checks: 57/57 passed, including four navigation routes, seven sample categories, manufacturer/search/source filtering, price sorting, quantity changes, fractional unit precision, deletion, filter reset preserving the in-memory estimate, modal opening/closing, period/state switching, and mobile filter opening/closing.
- No whole-page horizontal overflow in the four prototype routes at 320, 360, 390, 768, 1024 and 1440 px. Category rails may scroll intentionally.
- Browser storage persistence across reload was not verified in the opaque rendering origin. Production E2E, real pricing accuracy and deployment are not covered by these prototype checks.

## Proposed design system

- Preserve USED PICK branding and the existing logo; use orange sparingly for selected navigation and primary actions.
- Canvas #F5F6F8; panels #FFFFFF; main text #182331; secondary text #526071; muted text #687587; borders #E4E8ED.
- Accent #C94B26; accent tint #FFF1EB; sold-series color #237966; dark summary action #182B40.
- Pretendard / Noto Sans KR / Malgun Gothic system-font stack. No font binaries are distributed.
- Maximum outer content width 1296 px; 20 px horizontal desktop padding; 16 px mobile padding.
- Page title 28 px desktop / 23 px mobile. Body generally 13–14 px. Main prices 26–32 px. Keep implementation readability and accessibility checks separate from purely visual matching.
- Panels radius 14 px, buttons 8 px; subtle 1 px borders, minimal shadows, consistent spacing.
- Use tabular price digits; distinguish selected controls, normal prices and semantic warning states rather than highlighting every number.

## Page-by-page direction

### Market / index.html

Retain category → existing core filters → precise model or explicitly labelled reference range → current listings / price trend flow. Desktop: 224 px filter rail and flexible results column. Put the chosen comparison unit and two price meanings above aligned listing rows. Keep source, collection time, price and original-link action readable. Mobile: horizontal category rail, filter bottom sheet and compact vertically arranged listing rows. Actual listing thumbnails replace the prototype placeholders.

### Computer builder

Desktop: selected parts on the left and a sticky summary on the right. Standardize part / model / quantity / two price meanings. Keep unselected parts visibly unselected instead of zero-priced. Keep change and remove actions separate. Mobile: stacked part rows and a small summary jump control. Preserve all nine production tool categories, saved estimates and existing validation behavior.

### Price analysis

Category and model selection → separate registration / sold-last-ask summaries → chart → source comparison. Put comparison unit, market, currency, period and interpretation notes in a secondary column, below primary information on mobile. Use a mobile-sized SVG coordinate system rather than shrinking an 800 px chart's text to illegible labels.

### Guide and legal support pages

Shared header/footer, restrained reading-width article and desktop table of contents. The prototype includes a guide layout, not approved replacement legal content. Preserve current privacy/terms text until separately reviewed. Do not replace production legal links with prototype toast actions.

## Implementation boundaries after design approval

1. Recheck git status and concurrent agents before any production file editing. Baseline HEAD observed during this task was 129cc2d; the tree already contained other workers' deployment/document changes.
2. Keep exact DOM IDs, routes, event contracts, canonical model identities, market/currency scope and saved-estimate storage behavior compatible with app.js and pc-tools modules.
3. Preserve the distinction between exact PRODUCT models and reference buckets/facets. SSD/HDD/PSU range prices must not become falsely precise individual-model prices.
4. Preserve sold-last-ask versus actual transaction-price wording, missing-data states, sample rules, historical-window protections and missing-date chart gaps.
5. Preserve fractional unit arithmetic and only round at the established final presentation boundary. Filter reset must not erase saved estimates.
6. Reuse the approved layout/tokens, but connect to existing production data and price helpers. Do NOT replace the existing app with the demo HTML.
7. Consolidate styles deliberately; do not append another large uncontrolled override layer over styles.css, pc-tools.css and ui-refinement.css.
8. Run deterministic npm tests and applicable packaging checks, then real-browser regression and screenshot comparison. Review the required external-ai-orchestrator skill before repository-governed agent browser verification.
9. Design approval is not evidence of production validation or deployment. Run the documented explicit release process only when authorized, then verify the public assets and user flows.

## Next step

Design approval has been received. Complete the requested checkpoint, obtain and read the actual required browser skill, then inspect the current production pages in a real browser before editing the application. Preserve the approved calm price-comparison design rather than replacing the service with demo data or a new-parts shopping configurator.
