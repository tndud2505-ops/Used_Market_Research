# Used Market Gemini CLI

Public release of a used-market automation CLI.

This project can:

- collect listings from supported marketplaces
- normalize raw listing data
- merge and score market snapshots
- run scheduled jobs
- send optional summary and Discord-based notifications

## Project layout

- `MCP/logic/`: CLI entrypoint and provider runtime
- `collector/logic/`: site collection logic
- `market/logic/`: normalization and pricing logic
- `merge/logic/`: merged output handling
- `reporter/logic/`: reporter and notification logic
- `scheduler/logic/`: scheduled execution logic
- `web-backend/logic/`: API layer

## Quick start

```bash
npm install
cp .env.example .env
npm run build
npm run provider-check
npm run sites
```

## Main commands

```bash
node dist/MCP/logic/index.js login-check --site joonggonara
node dist/MCP/logic/index.js search --site bunjang --keyword "GTX 1660 SUPER" --limit 5
node dist/MCP/logic/index.js market-snapshot --sites joonggonara,bunjang,daangn --keyword "RTX 3060" --limit 5
node dist/MCP/logic/index.js full --sites joonggonara,bunjang,daangn --keyword "RTX 3060" --limit 5
node dist/MCP/logic/index.js scheduler-daemon run-once
node dist/MCP/logic/index.js reporter-daemon run-once
```

## Documentation

- Deployment: `DEPLOYMENT.md`
- User guide: `USER_MANUAL.md`
- Environment template: `.env.example`
