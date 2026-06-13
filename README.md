# Used Product Searcher

Public release of the used-market search workspace.

The runnable project lives in `used_market_gemini_cli_full_docs/`.

Start here:

- User guide: `used_market_gemini_cli_full_docs/USER_MANUAL.md`
- Deployment guide: `used_market_gemini_cli_full_docs/DEPLOYMENT.md`
- Environment template: `used_market_gemini_cli_full_docs/.env.example`

Main capabilities:

- Collect listings from supported marketplaces
- Normalize and score search results
- Run scheduled market snapshots
- Send optional reporter and Discord watch notifications

Quick start:

```bash
cd used_market_gemini_cli_full_docs
npm install
cp .env.example .env
npm run build
npm run provider-check
```
