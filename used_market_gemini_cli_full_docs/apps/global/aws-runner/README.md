# Global AWS Node Runner

This directory deploys only the global marketplace application to Ubuntu 24.04. It runs Node.js and Chromium directly under systemd and does not require a container runtime.

## Fixed production boundary

- Application root: `/opt/used-market-global-runner`
- Service: `used-market-global-runner.service`
- Unix user: `usedglobalrunner`
- Environment: `/etc/used-market-global-runner/runner.env`
- Persistent results: `/var/lib/used-market-global-runner/results`
- Tunnel service: `used-market-global-tunnel.service`
- Tunnel token: `/etc/cloudflared/used-market-global-runner.token`
- Loopback endpoint: `127.0.0.1:8790`
- Tunnel hostname: `global-runner.used-pick.com`
- Public application route: `/global/`

The current release is an atomic symlink at `/opt/used-market-global-runner/current`. Source releases are stored under `releases/YYYYMMDDTHHMMSSZ`. Every release links `merge/result` to the dedicated persistent result directory, so updates and rollbacks do not lose collected data.

## First installation

Upload the complete global app directory to a temporary directory on the Ubuntu host, then run:

```bash
sudo bash aws-runner/install-ubuntu24.sh
```

The installer validates Ubuntu 24.04, installs Node.js 22 and Chromium, creates the dedicated user and directories, builds a release, registers systemd, and runs the health check.

Port 8790 allows the new systemd runner to be verified without colliding with the legacy process on 8788 during cutover. The dedicated Node entry point forces `PORT=8790` and `HOST=127.0.0.1`, and the web server binds that host explicitly.

Set secrets only on the server:

```bash
sudoedit /etc/used-market-global-runner/runner.env
sudo systemctl restart used-market-global-runner.service
```

Never place real secrets in `.env.example` or a release archive.

Configure eBay Production credentials from the operator PC:

```cmd
aws-runner\configure-ebay.cmd
```

The hidden prompts request the Production App ID (Client ID) and Cert ID (Client Secret). The values travel only through SSH stdin and are stored in the protected runner environment. The installer performs a real eBay Browse API search and restores the previous environment if verification fails.

Configure the Cloudflare Tunnel token through the hidden interactive prompt:

```bash
sudo bash /opt/used-market-global-runner/current/aws-runner/configure-tunnel.sh
```

The Cloudflare public hostname must route `global-runner.used-pick.com` to `http://127.0.0.1:8790`. The token is written with mode `0640` and is never copied into a release.

## Update

From a newly uploaded global source directory:

```bash
sudo bash aws-runner/update-release.sh
```

The update uses `npm ci`, compiles TypeScript, removes development dependencies, runs the runner contract, atomically switches `current`, restarts the service, and waits for the global health endpoint. A failed activation restores the previous release. Five successful releases are retained.

## Health and logs

```bash
bash /opt/used-market-global-runner/current/aws-runner/health-check.sh
sudo systemctl status used-market-global-runner.service --no-pager
sudo journalctl -u used-market-global-runner.service -n 200 --no-pager
```

The health check requires `/global/health` to identify itself as the global app, verifies the Japan page and categories API, runs a real Rakuma Chromium search with at least one ready listing, and confirms that the unprefixed `/health` route is not served. It also proves authenticated access succeeds and unauthenticated page/API requests return 401.

## Rollback

Rollback to the newest release other than `current`:

```bash
sudo bash /opt/used-market-global-runner/current/aws-runner/rollback.sh
```

Or select an exact retained release:

```bash
sudo bash /opt/used-market-global-runner/current/aws-runner/rollback.sh 20260819T010203Z
```

The requested release ID is strictly validated and must resolve inside the dedicated release directory. If rollback health fails, the script restores the release that was current before the attempt.

## Local contract

```bash
node aws-runner/runner-contract.mjs
```

The contract prevents service-name, port, storage, release, runtime, and application-boundary drift.
