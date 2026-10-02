# Domestic deployment

## Current production: Worker + AWS Runner

`used-pick.com` uses the Cloudflare Worker and the AWS Runner behind
`runner.used-pick.com`. Use [Worker deployment](cloudflare/README.md),
[AWS installation](aws-runner/README.md), and the
[publication runbook](docs/wiki/09-price-publication-operations.md).
The 2026-09-24 protocol release deployed Worker readback routes first, then
Runner, and verified one fresh complete publication. Avoid publishing during
a mixed-version window; future release order depends on API compatibility.

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
