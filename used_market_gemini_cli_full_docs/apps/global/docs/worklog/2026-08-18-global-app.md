# 2026-08-18 Global App Worklog

## Outcome

The global application became a standalone English runtime with owned source, harness, docs, Docker image, public route, release root, and result volume. The AWS deployment is healthy and serves Japan and United States paths under `/global/`.

## Verified Changes

- Japan source set: `mercari_jp`, `yahoo_auction_jp`, and `rakuma`.
- United States internal source set: `poshmark`, `vinted`, and `unclaimed_baggage`.
- eBay added as an official external keyword search link while Browse API production approval is pending.
- eBay remains absent from the internal collector registry and `/global/api/search` requests.
- English UI covers metadata, navigation, validation, loading, results, partial states, errors, recent activity, accessibility copy, sorting, and price controls.
- Unsafe result links and image URLs are rejected.
- Search concurrency, work units, cache size, retry behavior, container memory, CPU, process count, logging, and Nginx routes are bounded.
- Source, runtime, harness, docs, deployment scripts, retention, route, and result volume are owned by this app.

## Verification

- `npm test`: build, app isolation, operations, runtime isolation, six-source extraction, search controls, and cache contracts passed.
- UI contracts: 48 baseline checks and 132 English UI checks passed.
- Browser QA: 1440x900 and 390x844 viewports showed all US tabs including eBay with no page overflow, framework overlay, console error, or console warning.
- eBay interaction: entering `iphone 13` produced `https://www.ebay.com/sch/i.html?_nkw=iphone+13`, opened in a new tab, and retained `noopener noreferrer`.
- Public health: `http://13.124.223.213/global/health` returned success after release.
- Released source: `/opt/used-market-global/releases/20260818T135627Z`.
- Container state after release: healthy, with eBay present in UI source and absent from the internal source array.

## Decisions Captured

- Keep Japan's three-source selection.
- Keep the current three-source US prototype set until an approved broad marketplace is available.
- Use eBay only as an external search link until production API access is approved.
- Do not implement Facebook Marketplace or Mercari US collection without a supported authorization path.
- Treat marketplace size claims separately from integration permission and technical reliability.

## Residual Risk

- The public endpoint is HTTP-only until a domain and TLS certificate are configured.
- Marketplace public pages and access controls can change without notice.
- Technical extraction does not establish permission for commercial collection or redistribution.
- Unclaimed Baggage is a curated retailer rather than a peer-to-peer marketplace.
- eBay API approval, credentials, quotas, and production response fixtures remain incomplete.

## Next Actions

1. Record the eBay approval result without storing credentials.
2. If approved, build and test the API adapter before changing internal source selection.
3. Complete the domain and TLS deployment gate.
4. Repeat live source and resource checks after any collector change.
