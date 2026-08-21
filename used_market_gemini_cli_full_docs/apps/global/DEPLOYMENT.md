# Global production deployment

Production uses Cloudflare Worker and D1 at the edge, plus a private AWS Ubuntu Node/Chromium runner reached only through a Cloudflare Named Tunnel.

## Live resources

- Public URL: `https://global.used-pick.com/global/`
- Worker: `used-market-global`
- D1: `used-market-global-free`
- Origin hostname: `global-runner.used-pick.com`
- AWS runner: `used-market-global-runner.service`
- Tunnel: `used-market-global-tunnel.service`
- Loopback origin: `127.0.0.1:8790`
- Release root: `/opt/used-market-global-runner`
- Persistent data: `/var/lib/used-market-global-runner/results`

The Worker owns public assets and APIs. It authenticates origin requests with `RUNNER_TOKEN`; the origin rejects every route except `/global/health` when the token is missing or wrong. Live search responses and session identifiers stay in the runner's bounded memory and are never written to or replayed from D1. D1 is limited to category/API metadata and legacy purge compatibility.

## Release gates

```powershell
npm test
npm run test:ui
node cloudflare/harness.mjs
npx --yes --package wrangler@4.124.0 wrangler deploy --dry-run --config cloudflare/wrangler.jsonc
node cloudflare/release.mjs
```

`cloudflare/release.mjs` applies D1 migrations, deploys the Worker, and verifies health, the retained English UI, categories, and a real Rakuma Chromium search. An empty or failed source does not pass.

## AWS update and rollback

Upload only this global app, then use:

```bash
sudo bash aws-runner/update-release.sh /path/to/uploaded/global
sudo bash /opt/used-market-global-runner/current/aws-runner/rollback.sh
```

The service uses Ubuntu 24.04, Node.js 22, Chromium, a mandatory environment file, bounded memory, and atomic timestamped releases. Health checks verify authentication and a live Rakuma result before activation.

## eBay Production credentials

Run `aws-runner/configure-ebay.cmd` on the operator PC. It prompts for the Production App ID and Cert ID without echoing them, sends them only through SSH stdin, restarts the runner, and requires a real eBay Browse API result. Credentials are stored only in `/etc/used-market-global-runner/runner.env`.

The Production keyset must remain subscribed to eBay marketplace account-deletion notifications. The callback is `https://global.used-pick.com/global/api/ebay/account-deletion`; its 32–80 character verification token is stored only as the Cloudflare Worker secret `EBAY_DELETION_VERIFICATION_TOKEN`. Deployments must preserve that secret and verify the callback challenge through `cloudflare/harness.mjs`.

## Retired Docker deployment

The former AWS container, image, `used-market-global_results` volume, and global Compose networks were backed up and removed on 2026-08-19. The final archive is retained under `/opt/used-market-global-runner/backups/`; copied data lives under `/var/lib/used-market-global-runner/results`.

The old AWS public IP now returns HTTP 308 to `https://global.used-pick.com`. Do not restore the Docker deployment or proxy port 8788 unless a deliberate rollback plan is approved. Never run host-wide Docker cleanup because unrelated NAS resources exist on the host.
