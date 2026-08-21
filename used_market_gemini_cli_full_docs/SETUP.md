# Portable development setup

## Requirements

- Git
- Node.js 22 or newer
- npm 10 or newer
- Chrome or Chromium for live marketplace collection
- Docker Desktop only for the domestic app's optional local container workflow; the global production Docker path is retired

## One-command preparation

From the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1
```

or:

```bash
bash scripts/setup.sh
```

This installs dependencies from each independent lockfile, installs the Chromium browser used by the global UI harness, and copies `.env.example` to the ignored `.env` only when missing. Linux hosts may require the normal Playwright/Chromium OS libraries supplied by their distribution.

## Configuration

Safe templates are committed separately:

- `apps/domestic/.env.example`
- `apps/global/.env.example`

Local secrets belong only in the corresponding `.env` file. Never commit Production eBay credentials, Cloudflare runner tokens, Gemini keys, Google service-account files, Discord tokens, webhook URLs, SSH keys, or generated OAuth tokens.

For ordinary deterministic development, private credentials are not required. Live collection needs a local Chrome/Chromium installation. Set `LOCAL_BROWSER_BINARY` only when automatic discovery does not find it.

The global eBay integration needs `EBAY_CLIENT_ID` and `EBAY_CLIENT_SECRET` only for a real Browse API request. Production values belong in the protected runner environment, not in this repository.

## Verify

```powershell
powershell -File .\scripts\verify.ps1
```

or run an app independently:

```bash
cd used_market_gemini_cli_full_docs/apps/domestic
npm test

cd ../global
npm test
npm run test:ui
```

Live harnesses and deployment commands are intentionally separate because they access external marketplaces or production infrastructure.

## Local web servers

Build first, then start the selected app from its own directory:

```bash
npm run build
npm run web
```

Environment files, generated `dist`, `node_modules`, runtime results, browser captures, backups, and deployment probes are ignored by Git and must be recreated locally.
