# Portable development setup

## Requirements

- Git
- Node.js 22 or newer
- npm 10 or newer
- Chrome or Chromium for live marketplace collection
- Docker Desktop for the optional local container workflow

## One-command preparation

From the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1
```

or:

```bash
bash scripts/setup.sh
```

This installs dependencies from the lockfile and copies `.env.example` to the ignored `.env` only when missing.

## Configuration

The safe template is committed as `apps/domestic/.env.example`.

Local secrets belong only in the corresponding `.env` file. Never commit Production eBay credentials, Cloudflare runner tokens, Gemini keys, Google service-account files, Discord tokens, webhook URLs, SSH keys, or generated OAuth tokens.

For ordinary deterministic development, private credentials are not required. Live collection needs a local Chrome/Chromium installation. Set `LOCAL_BROWSER_BINARY` only when automatic discovery does not find it.

The eBay integration needs `EBAY_CLIENT_ID` and `EBAY_CLIENT_SECRET` for a real Browse API request. Production values belong in the protected runner environment, not in this repository. `EBAY_BROWSE_API_TOKEN` is an optional short-lived override for diagnostics.

## Verify

```powershell
powershell -File .\scripts\verify.ps1
```

or run an app independently:

```bash
cd used_market_gemini_cli_full_docs/apps/domestic
npm test
```

Live harnesses and deployment commands are intentionally separate because they access external marketplaces or production infrastructure.

## Local web servers

Build first, then start the app from its directory:

```bash
npm run build
npm run web
```

Environment files, generated `dist`, `node_modules`, runtime results, browser captures, backups, and deployment probes are ignored by Git and must be recreated locally.
