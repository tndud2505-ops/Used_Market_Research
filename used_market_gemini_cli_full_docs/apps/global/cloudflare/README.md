# Global Cloudflare application

This directory is an independent Cloudflare Worker and D1 edge application for the global marketplace UI. Its Assets binding publishes the existing global UI from `../web-backend/public`; it never imports domestic application code, assets, runners, or storage.

## Scope

- Japan internal results: Mercari JP, Yahoo! Auctions, Rakuma
- United States internal results: Poshmark, Vinted US, Unclaimed Baggage
- United States external search: eBay official search link
- English UI under `/global/`
- Bearer-authenticated global runner search with ephemeral origin sessions
- D1 caching for category metadata only; live search responses are never stored or replayed

The Worker does not scrape marketplaces and never calls the domestic runner. It forwards the UI's `POST /global/api/search` JSON body unchanged to `https://global-runner.used-pick.com/global/api/search`, using a separate `RUNNER_TOKEN`. Search results and session identifiers stay in the runner's bounded in-memory session store and are not written to or replayed from D1. D1 is limited to category/API metadata caching. The legacy `search_response_cache` migration remains only for backward-compatible purge and account-deletion cleanup; it is not part of the live search path.

## Verify

```powershell
node harness.mjs
npx --yes --package wrangler@4.124.0 wrangler deploy --dry-run --config wrangler.jsonc
```

## Provision and deploy

The production D1 binding is provisioned in `wrangler.jsonc`. For a new account or disaster recovery, create a replacement database, copy its generated UUID into `wrangler.jsonc`, then apply the migration and deploy.

```powershell
# Disaster recovery only: create the database if it does not already exist.
npx --yes --package wrangler@4.124.0 wrangler d1 create used-market-global-free
npx --yes --package wrangler@4.124.0 wrangler secret put RUNNER_TOKEN --config wrangler.jsonc
npx --yes --package wrangler@4.124.0 wrangler d1 migrations apply used-market-global-free --remote --config wrangler.jsonc
node release.mjs
```

Never bind this Worker to the domestic D1 database. The custom domain is `global.used-pick.com`; the domestic domains remain separate.
