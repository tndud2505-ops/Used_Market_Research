# 2026-08-19 Cloudflare Production Release

## Decision

The global app uses a fully isolated deployment pattern: a dedicated Cloudflare Worker and D1 database serve the public application, and a dedicated AWS Node/Chromium runner is reachable only through its own Named Tunnel.

## Live boundary

- `https://global.used-pick.com/global/`
- Worker `used-market-global`
- D1 `used-market-global-free`
- Tunnel origin `global-runner.used-pick.com`
- AWS services `used-market-global-runner.service` and `used-market-global-tunnel.service`
- Loopback `127.0.0.1:8790`
- Persistent results `/var/lib/used-market-global-runner/results`

No sibling application's Worker, database, runner, hostname, source code, harness, or documents are referenced.

## Migration and cleanup

The old AWS Docker result volume was archived twice, copied into the new persistent result directory, and content-checked before removal. The exact global container, image, result volume, and two global networks were removed. NAS volumes were retained. Local-PC resources were label-checked, five archives were retained, and every confirmed global container, image, volume, and network was removed. KStock and NAS resources were not changed.

## Verification

- `npm test` passed.
- Global UI contracts passed: 48 general checks and 132 English/security/responsive checks.
- Cloudflare Worker dry-run passed with the dedicated D1 and 10 static assets.
- Public health returned Worker + D1 ready and origin available.
- Public Rakuma search returned 26 rendered results in the browser.
- Price high-to-low rendered from `￥80,000` down to `￥2,500`.
- Public Vinted US rendered 30 results.
- Browser console warnings and errors were empty.
- The retired AWS IP returns HTTP 308 to the HTTPS custom domain.

## Operational rule

Never delete host-wide Docker resources. If rollback is needed, use the retained systemd release and result archives. Do not restore port 8788 or the old Compose project as an informal workaround.
