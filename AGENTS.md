# Repository operating rules

Read `README.md` and `used_market_gemini_cli_full_docs/SETUP.md` first.

- `apps/domestic` is the only application. eBay is a supported search site inside this application.
- Use the application's own `package-lock.json`, `.env.example`, tests, deployment scripts, and documentation.
- Never commit `.env`, credentials, tokens, private keys, browser profiles, generated results, backups, HAR files, or deployment probe output.
- Run the deterministic tests before committing. Run `scripts/verify.ps1` or `scripts/verify.sh` when a change affects repository packaging.
- Treat live marketplace tests and production deployments as explicit operator actions; deterministic tests must not require production credentials.
