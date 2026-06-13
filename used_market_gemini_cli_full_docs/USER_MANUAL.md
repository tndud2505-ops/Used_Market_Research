# User Manual

## What this project does

This CLI collects used-market listings, normalizes the raw listing data, merges the results, and can send alerts or summaries.

## Basic workflow

1. Configure `.env`.
2. Build the project with `npm run build`.
3. Check provider readiness with `npm run provider-check`.
4. Run one of the commands below.

## Useful commands

List supported sites:

```bash
npm run sites
```

Check a site login flow:

```bash
node dist/MCP/logic/index.js login-check --site joonggonara
```

Search one marketplace:

```bash
node dist/MCP/logic/index.js search --site bunjang --keyword "GTX 1660 SUPER" --limit 5
```

Normalize one marketplace result set:

```bash
node dist/MCP/logic/index.js normalize --site bunjang --keyword "GTX 1660 SUPER" --limit 5
```

Run the full market workflow:

```bash
node dist/MCP/logic/index.js full --sites joonggonara,bunjang,daangn --keyword "RTX 3060" --limit 5
```

Run scheduled jobs once:

```bash
node dist/MCP/logic/index.js scheduler-daemon run-once
```

Run reporter once:

```bash
node dist/MCP/logic/index.js reporter-daemon run-once
```

## Output

Generated outputs are written under `merge/result/` and runtime state may be written under `runs/`.

## Troubleshooting

- If provider check fails, confirm `MODEL_PROVIDER` and API keys.
- If Sheets sync fails, confirm the spreadsheet ID and service account path.
- If notifications fail, confirm the webhook or Discord settings.
