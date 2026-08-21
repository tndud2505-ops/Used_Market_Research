# Repository operating rules

Read `README.md` and `used_market_gemini_cli_full_docs/SETUP.md` first.

- Domestic and global are separate applications. Never import code, harnesses, fixtures, environment files, or result storage across `apps/domestic` and `apps/global`.
- Use each app's own `package-lock.json`, `.env.example`, tests, deployment scripts, and documentation.
- Never commit `.env`, credentials, tokens, private keys, browser profiles, generated results, backups, HAR files, or deployment probe output.
- Run the changed app's deterministic tests before committing. Run `scripts/verify.ps1` or `scripts/verify.sh` when a change affects both apps or repository packaging.
- Treat live marketplace tests and production deployments as explicit operator actions; deterministic tests must not require production credentials.
