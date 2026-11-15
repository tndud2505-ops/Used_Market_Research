# Domestic deployment

## Current production: Worker + AWS Runner

`used-pick.com` uses the Cloudflare Worker and the AWS Runner behind
`runner.used-pick.com`. Use [Worker deployment](cloudflare/README.md),
[AWS installation](aws-runner/README.md), and the
[publication runbook](docs/wiki/09-price-publication-operations.md).
The 2026-09-24 protocol release deployed Worker readback routes first, then
Runner, and verified one fresh complete publication. Avoid publishing during
a mixed-version window; future release order depends on API compatibility.

## Web and Android release QA

Use `npm run test:release-ui` for the shared desktop-web, mobile-web and actual
Android TWA flow. The Android package is `com.usedpick.app`; a mobile viewport
alone does not count as an app check. The existing analysis browser harness
owns this flow, and `mobile/` exposes the same command without copying it.
Its Playwright library is pinned in the application's own devDependencies and
lockfile; use the repository setup/`npm ci` instead of relying on a parent
directory's temporary browser tools. An installed Chrome/Chromium is required.

Select the connected test device and its private ADB/CDP ports explicitly.
For the existing USED PICK test emulator, the operator configuration is:

```powershell
$env:USED_PICK_ANDROID_SERIAL = 'emulator-5620'
$env:USED_PICK_ADB_SERVER_PORT = '5048'
$env:USED_PICK_ANDROID_CDP_PORT = '9313'
npm run test:release-ui -- --candidate
```

The device must already be running with the release APK installed. The harness
checks its package/version and native TWA task; it does not create a device,
install an APK, reset data, or use another app's ADB port. `--candidate` supplies
the checked-out static files to the owned pages while keeping the trusted
production origin and public price APIs. It restores those overrides afterward.
Without `--candidate`, the same flow checks ordinary published resources.

`npm run cloudflare:app-release` runs the candidate joint QA before publication,
then public smoke and the joint QA against the deployed version. A reviewed,
already uploaded static version can use the same entry point without bundling
unrelated backend changes:

```powershell
node cloudflare/release.mjs --version <exact-version-uuid> --version-config <reviewed-wrangler-config>
```

This mode does not upload another version or run data migrations. It retains the
exact previous production version for the existing rollback path. Missing app
evidence is a failure, not a silent skip. Screenshots and the compact report go
to ignored `tmp/`; cosmetic layout differences are warnings. These checks cover
the selected release scenarios, not every model or marketplace calculation.

## Optional Docker / Nginx deployment

The following is the separate container profile, not the current production
Runner path `/opt/used-market-runner`.

Deploy only this directory to `/opt/used-market-domestic`. The app publishes `127.0.0.1:8789` and owns `used-market-domestic_results`.

```bash
sudo bash deploy/update.sh /path/to/domestic
curl -fsS http://127.0.0.1:8789/health
curl -I http://127.0.0.1:8789/
```

Host Nginx routes `/` and `/api/*` here. Store eBay credentials only in the protected runtime environment; never bake them into the image or repository.
