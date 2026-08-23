---
name: used-market-global-wiki
description: Verified operating knowledge for the standalone global used-listings application.
type: reference
scope: apps/global
source: code-verified and user-approved
verified: 2026-08-24
---

# USED MARKET Global Wiki

This is the durable starting point for the global application. Code and executable contracts win when this document drifts. Update this wiki in the same change whenever marketplaces, routing, source permissions, or deployment ownership change.

## Current Scope

- One standalone English application for Japan and United States used-listing discovery.
- Public entry: `https://global.used-pick.com/global/`.
- Public route ownership: `/global/` and the approved `/global/api` endpoints only.
- Runtime source ownership: seven internal marketplace adapters, including the official eBay Browse API.
- The application owns its source, UI, harness, fixtures, Cloudflare Worker, D1 database, AWS Node/Chromium runner, Named Tunnel, release scripts, and persistent result directory.
- The app must not import, mount, route to, or test against a sibling application's runtime.

Read first:

- Product entry: `README.md`
- User flow: `USER_MANUAL.md`
- Runtime boundary: `docs/APP_SCOPE.md`
- Deployment and rollback: `DEPLOYMENT.md`
- Harness overview: `harness/README.md`
- Latest pagination verification: `docs/worklog/2026-08-24-pagination-ux.md`

## Marketplace Matrix

| Country | UI label | Key | Current integration | Role and limits |
| --- | --- | --- | --- | --- |
| Japan | Mercari JP | `mercari_jp` | Internal public-page collector | Broad Japanese resale inventory. Automated access policy remains a release risk requiring review. |
| Japan | Yahoo! Auctions | `yahoo_auction_jp` | Internal public-page collector | Auctions, rare goods, parts, cameras, audio, vehicles, and collectibles. Do not describe the 2017 listing-count claim as current. |
| Japan | Rakuma | `rakuma` | Internal public-page collector | Price comparison and fashion, bags, shoes, kids, beauty, and general goods coverage. |
| United States | Poshmark | `poshmark` | Internal public-page collector | Real resale marketplace with strong fashion emphasis. Public-page access can change. |
| United States | Vinted US | `vinted` | Internal public-page collector | Real secondhand marketplace with strong apparel emphasis and a smaller US footprint. |
| United States | Unclaimed Baggage | `unclaimed_baggage` | Internal public product-page collector | Curated resale retailer, not a peer-to-peer marketplace. It adds shippable goods but is not broad local C2C coverage. |
| United States | eBay | `ebay` | Official Browse API collector | Production Client ID and Client Secret mint a cached Application access token through the client-credentials flow. |

The United States `All` option sends `ebay`, `poshmark`, `vinted`, and `unclaimed_baggage`. eBay results remain linked to their official listing pages.

Considered but not implemented:

- Facebook Marketplace is not implemented. Its scale is attractive, but general consumer-listing search is not available as an open integration and automated collection requires Meta permission.
- Mercari US is not implemented. It is shipping-friendly, but its published conduct rules restrict robots, crawlers, and scrapers.
- OfferUp is not implemented because region access and automation restrictions make the current AWS location unreliable.

## Search And UI Contracts

- UI chrome, metadata, accessibility labels, errors, empty states, sorting, and filters are English.
- Original Japanese listing text is preserved and marked with `lang="ja"` when appropriate.
- Country switching resets the selected source to `All`, sorting to `Recommended`, and clears price bounds.
- Internal US search includes exactly `ebay`, `poshmark`, `vinted`, and `unclaimed_baggage`.
- Japan aggregate search can contain multiple currencies. Price sorting and price-range filtering are disabled when currencies cannot be compared safely.
- Single-currency results support `Recommended`, `Price: Low to High`, `Price: High to Low`, and `Newest` when the necessary data exists.
- Result counts are verified rows in the current authoritative runner session, not the marketplace's advertised total. Source summaries, filtered items, and quality counts must agree after every tab, page, sort, or filter operation.
- Search concurrency defaults to one. Busy searches return HTTP 429 with `Retry-After` instead of starting overlapping Chromium work.
- Collection input is cached briefly and identical in-flight work is deduplicated. Sort and price controls are reapplied to cached source results.
- Unsafe listing and image schemes or hosts are never inserted into clickable result markup.
- eBay uses the official Browse API and is present in `collector/logic/sites.ts` and United States `/global/api/search` payloads. Credentials exist only in the protected AWS runner environment.

Primary code and contracts:

- UI and request selection: `web-backend/public/app.js`
- Internal source registry: `collector/logic/sites.ts`
- Source and extractor coverage: `harness/foreign-site-contract.mjs`
- General UI behavior: `harness/foreign-ui-contract.mjs`
- English, security, responsive, and eBay UI behavior: `harness/foreign-english-ui-contract.mjs`
- eBay OAuth and result normalization: `harness/ebay-api-contract.mjs`
- United States collection and pagination policy: `harness/us-search-policy-contract.mjs`
- United States production source matrix: `harness/us-search-matrix-live.mjs`

### United States source operations

| Source | Initial request | Additional results | Search and sorting scope | Live matrix |
| --- | --- | --- | --- | --- |
| eBay | 30 listings through the official Browse API | Validated `offset:N` cursors, followed within the bounded additional-search budget | Price and date controls apply to the collected window; official result order is the acquisition order | `iphone 13`, `nike shoes`, `pokemon cards` |
| Poshmark | Verified cards from the first rendered public page, exposed in 30-row chunks | Within-page continuation only; no synthetic page 2 and no claim beyond that rendered page | Price controls apply to the collected window; Newest is unavailable without a valid listing date | Same three queries |
| Vinted US | Up to 30 relevant public listing cards | Continue within the 96-card page, then follow the verified next-page control, 30 results at a time | Price controls apply to the collected window; Newest is unavailable without a valid listing date | Same three queries |
| Unclaimed Baggage | Up to 30 relevant public product cards | Follow the verified Shopify next-page control, 30 results at a time | Price controls apply to the collected window; Newest is unavailable without a valid listing date | Same three queries |

The UI shows 30 rows per page. The runner owns a normalized, memory-only search session for 10 idle minutes, promotes active sessions in an LRU capped at 32, and keeps at most 1,000 verified rows per session. The server—not the browser—enforces each additional visible window step at no more than 160 rows and retains the bounded 160→320→480→640 source-window policy. Sort, price filters, tabs, and numbered pages query the same session without marketplace I/O unless the user selects the one page immediately beyond the authoritative window; numeric price is the primary key in both directions and quality warnings only break equal-price ties. Vinted and Unclaimed Baggage cursors preserve within-page offsets so continuation does not skip unused cards on the current source page. An exhausted source is explicitly marked and is not restarted from page one while another source continues. Cursor, generation, query, category, site set, and limit are bound together; stale, replayed, or mismatched continuations are rejected.

Numbered pagination exposes the current authoritative `session.available_count` plus exactly one reachable next-page control. Up to seven reachable pages are shown directly. Longer sessions use a compact sequence that retains the first page, authoritative last loaded page, current-page neighbors, and the immediately reachable next page, with ellipses for omitted ranges. It does not turn the 640-row capacity into a false total page count. A final non-numbered locked ellipsis only indicates that more pages may become available. The browser prefetches session-only page 2 and page 3 and keeps them in a generation-bound page cache, so a cached 1→3 jump renders without another request. The immediately next page performs exactly one request: a session-only window read when rows are already buffered, or one cursor continuation otherwise. A generation change discards the browser page cache. If that request cannot fill the requested view page, the current page remains visible while authoritative counts and continuation state are updated. Page changes move focus to the result count instead of attempting to focus the disabled current-page button. At 320px, the compact controls retain 40px targets and wrap to no more than two rows.

Request-level overload is preserved as HTTP 429 with `Retry-After`; it is not rewritten as a generic 503. The UI displays the wait time and offers a retry. A failed marketplace in a partial aggregate response shows its normalized error. The current retry action rebuilds one coherent aggregate session rather than splicing a source-only response into an incompatible cursor generation.

`npm run us:matrix:live` runs 12 sequential production checks (three queries × four sources), observes `Retry-After`, and records latency, counts, collection state, valid price/link/image rates, cursor advancement, and cross-page duplicate counts. For eBay, Vinted, and Unclaimed Baggage, at least one validated follow-up must succeed across the matrix; every source must return usable results. It deliberately does not persist listing titles, URLs, sellers, eBay item IDs, or raw response bodies.

## Deployment Boundary

- Public edge: Cloudflare Worker `used-market-global` at `https://global.used-pick.com/global/`.
- Persistent edge cache: dedicated D1 database `used-market-global-free`.
- Private origin: `global-runner.used-pick.com` through the dedicated Named Tunnel only.
- Host OS: Ubuntu 24.04 on the global Lightsail instance.
- Release root: `/opt/used-market-global-runner`.
- Loopback origin: `127.0.0.1:8790`.
- Persistent results: `/var/lib/used-market-global-runner/results`.
- Services: `used-market-global-runner.service` and `used-market-global-tunnel.service`.
- The origin environment and bearer token are mandatory. Only `/global/health` is intentionally public at the tunnel origin.
- Releases are timestamped, health-checked with a real Rakuma Chromium search, and switched through `/opt/used-market-global-runner/current`.
- The former AWS and local-PC global Docker resources were backed up and removed on 2026-08-19. The old AWS IP now redirects to the HTTPS custom domain.

Configuration and deployment proof:

- Worker/D1 boundary: `cloudflare/wrangler.jsonc` and `cloudflare/harness.mjs`
- AWS runner boundary: `aws-runner/used-market-global-runner.service` and `aws-runner/runner-contract.mjs`
- Worker-to-runner authentication: `harness/cloudflare-runner-boundary-contract.mjs`
- Retired Docker fallback contract: `harness/ops-deployment-contract.mjs`
- Runtime route and source rejection: `harness/runtime-isolation-contract.mjs`
- Operator commands: `DEPLOYMENT.md`

The public endpoint uses the Cloudflare HTTPS custom domain. The AWS IP is not an application origin and only redirects to that domain.

## Source Policy And Risks

Technical reachability is not permission to collect or redistribute marketplace data. Before commercial use, obtain legal review or written source approval where required.

- eBay: the Production keyset is active and the Browse API uses an Application access token minted from the Production Client ID and Client Secret. Credentials and tokens must never enter source, fixtures, logs, screenshots, or repository history. Production activation is backed by the marketplace-account-deletion subscription at `https://global.used-pick.com/global/api/ebay/account-deletion`. The Worker handles the official SHA-256 challenge and acknowledges deletion notifications after purging any eBay D1 search-cache rows.
- eBay persistence boundary: searches containing `ebay` are not written to D1 response cache or runner market-result storage, and seller identifiers are not exposed in normalized eBay items. This keeps account-deletion handling conservative while retaining live result display. Official references: [Browse API](https://developer.ebay.com/develop/api/buy/browse_api), [OAuth credentials](https://developer.ebay.com/api-docs/static/oauth-credentials.html), and [Marketplace Account Deletion](https://developer.ebay.com/develop/guides-v2/marketplace-user-account-deletion).
- Facebook Marketplace: the March 2026 figure of more than 3.5 million daily US and Canada listings is a market-size fact, not integration permission. Official references: [Marketplace announcement](https://about.fb.com/news/2026/03/facebook-marketplace-new-meta-ai-tools-make-selling-faster-and-easier/) and [Automated Data Collection Terms](https://www.facebook.com/legal/automated_data_collection_terms).
- Mercari US: do not treat the undated 350,000-daily-listings claim as a current verified company metric. Automated access restrictions are documented in [Prohibited Conduct](https://www.mercari.com/us/help_center/topics/listing/policies/prohibited-conduct/).
- Mercari JP: automated monitoring and collection restrictions appear in the current [Platform Terms](https://static.jp.mercari.com/us/en/tos_platform).
- Yahoo! Auctions: the official 63-million-item page is dated July 2017. It proves historical scale only and must not be presented as a current count.
- Poshmark and Vinted: public-page collectors are operational prototypes. Terms, access controls, and data-center blocking can change independently of code.

Safe fallback when a source becomes unavailable: show a source-specific unavailable or partial state, keep other sources responsive, retain original links where permitted, and never bypass authentication, CAPTCHA, region controls, or anti-automation barriers.

## Decision Log

| Date | Decision | Why | Confirmation |
| --- | --- | --- | --- |
| 2026-08-18 | Keep this as a standalone global application with owned source, harness, docs, image, route, and volume. | Cross-runtime coupling caused scope confusion and shared failure modes. | `harness/app-isolation-contract.mjs` and `harness/runtime-isolation-contract.mjs`. |
| 2026-08-18 | Keep the visible application chrome English for both countries. | The global audience must not receive Korean navigation, errors, metadata, or accessibility copy. | `harness/foreign-english-ui-contract.mjs`. |
| 2026-08-18 | Use Mercari JP, Yahoo! Auctions, and Rakuma for Japan. | Together they cover broad fixed-price resale, auctions and rare goods, and price comparison. | `harness/foreign-site-contract.mjs`. |
| 2026-08-18 | Keep Poshmark, Vinted US, and Unclaimed Baggage as the initial internal US prototype set. | Two real secondhand marketplaces plus one shippable curated retailer were available before eBay approval. | Source registry and UI contracts. |
| 2026-08-18 | Add eBay as an external official-search link while Browse API approval is pending. | eBay was the strongest broad US candidate, but unapproved API use was not presented as production integration. | Historical UI contracts rejected eBay from internal requests. |
| 2026-08-20 | Promote eBay to an internal official Browse API source after Production credentials were issued. | Automatic client-credentials OAuth avoids expiring hand-entered tokens and adds broad US inventory without scraping eBay pages. | `harness/ebay-api-contract.mjs`, source registry, Worker allowlist, and live public smoke. |
| 2026-08-20 | Subscribe the Production keyset to marketplace account-deletion notifications instead of claiming the no-storage exemption. | The service can display marketplace data and previously cached general search responses, so the compliant path is an owned callback plus conservative cache purging. | `cloudflare/worker.mjs`, `cloudflare/harness.mjs`, and live eBay challenge verification. |
| 2026-08-18 | Do not implement Facebook Marketplace or Mercari US collection without permission. | Public consumer-search access and automated collection terms do not support the current approach. | This wiki plus a future approval record if the decision changes. |
| 2026-08-19 | Deploy with a dedicated Cloudflare Worker/D1 plus AWS systemd runner and Named Tunnel. | This provides the required operating pattern without sharing any sibling runtime or database. | Cloudflare harness, runner contract, public health, and live source smokes. |
| 2026-08-19 | Retire the former global Docker deployments after data migration and verified cutover. | Two runtimes on one small host caused resource contention and confused the production boundary. | Final archives, copied results, empty global Docker inventory, and old-IP redirect. |

## Verification Map

| Claim | Executable evidence | What it proves |
| --- | --- | --- |
| App owns its files and references | `harness/app-isolation-contract.mjs` | No cross-app imports, mounts, routes, or forbidden references. |
| Wiki matches code and deployment | `harness/wiki-contract.mjs` | Marketplace matrix, eBay boundary, routed paths, and deployment facts stay synchronized. |
| Seven internal adapters remain configured | `harness/foreign-site-contract.mjs`, `harness/ebay-api-contract.mjs` | Page collectors plus eBay OAuth, API result normalization, and token caching. |
| eBay deletion callback remains deployable | `cloudflare/harness.mjs` | GET challenge hashing, POST acknowledgement, D1 eBay-cache purge, and missing-secret failure are fixed contracts. |
| Search controls are correct | `harness/foreign-search-controls-contract.mjs` | Stable recommendation, price sorting, newest sorting, filters, and mixed-currency safeguards. |
| US collection windows are correct | `harness/us-search-policy-contract.mjs` | eBay offset paging, Vinted/Unclaimed page windows, exhausted-source cursors, bounded empty-page continuation, category intent, device accessory exclusion, quality counts, load-more, and public-login budget. |
| Search sessions are correct | `harness/server-search-session-contract.mjs`, `harness/search-session-policy-contract.mjs` | Memory-only TTL/LRU storage, authoritative 30-row pages and counts, 1,000-row cap, server-enforced 160-row steps, identity/cursor/generation isolation, site-tab reuse, and coherent retry. |
| Cache does not change control semantics | `harness/search-cache-contract.mjs` | TTL cache, in-flight deduplication, and control reapplication. |
| Public runtime is global-only | `harness/runtime-isolation-contract.mjs` | Route boundary, source allowlist, and public API restriction. |
| Retired Docker fallback remains reproducible | `harness/ops-deployment-contract.mjs` | The inactive fallback files remain internally consistent without representing the live deployment. |
| Cloudflare and origin stay isolated | `harness/cloudflare-runner-boundary-contract.mjs`, `cloudflare/harness.mjs`, and `aws-runner/runner-contract.mjs` | Dedicated resources, bearer authentication, D1 category cache only, non-persistent runner search sessions, systemd limits, tunnel route, and live-search activation rules. |
| Browser UI works | `harness/foreign-ui-contract.mjs` and `harness/foreign-english-ui-contract.mjs` | English UI, sorting, filtering, security, eBay internal tab, desktop/mobile layout, and console health. |

`npm run test:ui` starts its own temporary loopback server through `harness/run-ui-contracts.mjs`; it does not depend on Docker or a pre-existing local service.

Required local gates are `npm test`, `npm run test:ui`, and the Cloudflare dry run:

```bash
npm test
npm run test:ui
npx --yes --package wrangler@4.124.0 wrangler deploy --dry-run --config cloudflare/wrangler.jsonc
```

Required release gate: verify Worker/D1 health, the tunnel origin, `/global/?country=jp`, `/global/?country=us`, and at least one live marketplace search through the Cloudflare custom domain. AWS Nginx is redirect-only. Live source availability is operational evidence, not a deterministic fixture contract.

After any United States source or selector change, run `npm run us:matrix:live`. Start with the three default queries. Add a new query only when it represents a distinct failure class, then promote the smallest reproducible case into a deterministic fixture contract before changing relevance or pagination rules.

## Open Work

1. Monitor eBay OAuth and Browse API rate-limit responses without logging credentials or access tokens.
2. Review collection and redistribution permissions for every internal source before commercial launch.
3. Recheck AWS source availability, latency, partial-result behavior, Chromium cleanup, memory, swap, and HTTP 429 behavior after source changes.
4. Reassess whether Unclaimed Baggage should remain now that a broad approved US marketplace integration is available.
5. When any marketplace or route changes, update `README.md`, this wiki, the relevant harness, and the dated worklog in the same change.

Latest curated history: `docs/worklog/2026-08-20-ebay-api.md`.
