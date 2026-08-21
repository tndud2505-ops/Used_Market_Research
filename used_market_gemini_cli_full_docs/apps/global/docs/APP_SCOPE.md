# Global app boundary

This folder owns the global source, English UI, Japan and United States fixtures, harness, Cloudflare Worker, D1 migrations, AWS Node/Chromium runner, Named Tunnel services, release scripts, and persistent results. Cross-app imports, databases, runners, and runtime mounts are forbidden and checked by `harness/app-isolation-contract.mjs` and `harness/cloudflare-runner-boundary-contract.mjs`.

Read `docs/WIKI.md` for the current marketplace matrix, decisions, risks, deployment boundary, and verification map.
