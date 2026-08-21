# USED MARKET Global

Standalone English application for Japan and United States resale searches.

- Public URL: `https://global.used-pick.com/global/`
- Edge: Cloudflare Worker `used-market-global` and D1 `used-market-global-free`
- Private origin: Cloudflare Tunnel to `127.0.0.1:8790`
- Japan: Mercari JP, Yahoo! Auctions, Rakuma
- United States internal search: eBay Browse API, Poshmark, Vinted US, Unclaimed Baggage

eBay uses Production OAuth credentials stored only in the protected AWS runner environment. The runner automatically renews the short-lived Application access token.

```bash
npm ci
npm test
npm run test:ui
```

Production releases are operator-only actions. Follow `DEPLOYMENT.md`; do not run a release command as part of local setup or verification.

This directory owns its source, UI, fixtures, harness, Worker, D1 migrations, AWS runner, tunnel services, release path, and result storage. The former production Docker resources were retired after verified migration.

Durable project knowledge and current decisions live in `docs/WIKI.md`.
