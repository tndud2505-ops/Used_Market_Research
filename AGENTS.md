# Repository operating rules

## Local execution and Chat On Steroids routing

For work that needs local commands, browser QA, or deployment, first identify
whether the current execution path actually uses Chat On Steroids.

1. If `read` or `apply_patch` reaches this project, do not diagnose a missing
   approved folder. Folder access and command publication are separate.
2. When the current session is routed through Chat On Steroids managed roots or
   Core command publication:
   - Confirm that Core published `exec_command`, then run
     `powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\tndud\AppData\Roaming\chat-on-steroids\ensure-managed-roots.ps1" -RequireCommand`.
   - If the tool is absent, stop and report a stale/missing Core tool snapshot;
     do not blame the PC, login, Cloudflare, or project permissions.
   - Run `-RequireHealthy` only before browser QA performed through the Chat On
     Steroids Chrome companion. This check proves the tunnel and companion
     pairing required by that browser path.
   - A command-line production deployment through Core requires
     `-RequireCommand`, not Chrome companion pairing.
3. When Chat On Steroids is not the selected execution path, do not require its
   harness, tunnel, or Chrome companion. Use the available native command,
   browser, and deployment tools with the repository's normal authentication,
   preflight, and verification rules. A missing companion must not block a
   native command-line deployment.
4. Regardless of execution path, a passing unit test is not browser proof and a
   preflight is not a deployment. Report completion only from the actual
   browser/deploy tool call and its resulting production marker or equivalent
   receipt.

Read `README.md` and `used_market_gemini_cli_full_docs/SETUP.md` first.

- Always apply the local skill `used-pick-sample-preserving-filters` at
  `C:/Users/tndud/.codex/skills/used-pick-sample-preserving-filters/SKILL.md`
  when changing listing classification or statistics filters. Prevent excessive
  exclusion and overfitting that shrink valid samples as the first filtering
  quality priority, while preserving data integrity and verified product identity.

- `apps/domestic` is the only application. eBay is a supported search site inside this application.
- Use the application's own `package-lock.json`, `.env.example`, tests, deployment scripts, and documentation.
- Never commit `.env`, credentials, tokens, private keys, browser profiles, generated results, backups, HAR files, or deployment probe output.
- Run the deterministic tests before committing. Run `scripts/verify.ps1` or `scripts/verify.sh` when a change affects repository packaging.
- For defect recovery, do not launch a full historical recalculation or use
  `daily-price-refresh` as a routine repair. Use `pc:repair-stats` with explicit
  affected product/pool/condition/currency scopes. Defer representative-price
  changes below KRW 3,000 to the scheduled refresh. Product identity, currency,
  unit, corrupt evidence, or representative availability errors require only
  the affected scopes to be repaired. Preserve untouched prices and their
  actual as-of dates. A full repair is exceptional: require demonstrated
  systemic corruption or a calculation-basis migration that cannot be scoped.
  This recovery rule does not cancel the normal scheduled daily refresh.
- Treat live marketplace tests and production deployments as explicit operator actions; deterministic tests must not require production credentials.
- Follow `used_market_gemini_cli_full_docs/apps/domestic/docs/wiki/10-storage-operations.md`
  for storage maintenance. Final daily/source/period price results are durable
  history; do not shorten them to the raw-data or backup window. Keep required
  observation detail for 30 days and use verified lossless archival for older
  publication responses. Backup and successfully completed staging retention is
  at most 7 days, with explicit unresolved-recovery `.keep` pins and a last-known-
  good recovery exception. Use the storage tool and harness; do not create repeated
  full-DB copies inside code backups or staging. Run capacity preflight before
  a large recovery copy. Respect the backup maintenance lock during restores.
- Always apply `external-ai-orchestrator` when selecting or running external AI accounts, direct CLI/roster agents, or agent-driven browser verification. The approved workspace copy is `external-ai-orchestrator/SKILL.md`; keep provider, quota, CLI, browser, and failure-handling details there rather than duplicating them here.
