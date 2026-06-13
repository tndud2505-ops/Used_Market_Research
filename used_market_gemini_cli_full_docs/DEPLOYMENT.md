# Deployment Guide

## Requirements

- Node.js 20 or newer
- A Gemini API key if `MODEL_PROVIDER=gemini`
- Optional credentials for Google Sheets, Naver Open API, and Discord features

## 1. Install

```bash
npm install
```

## 2. Configure environment

Copy `.env.example` to `.env` and fill only the integrations you need.

Required baseline:

- `MODEL_PROVIDER`
- `GEMINI_API_KEY` when using Gemini API mode

Optional integrations:

- `GOOGLE_SHEETS_SPREADSHEET_ID`
- `GOOGLE_SHEETS_CREDENTIALS_JSON`
- `NAVER_OPENAPI_CLIENT_ID`
- `NAVER_OPENAPI_CLIENT_SECRET`
- `REPORTER_SUMMARY_WEBHOOK_URL`
- `MESSAGE_WEBHOOK_URL`
- `DISCORD_WATCH_BOT_TOKEN`

Keep secret files outside Git and inside a local `secrets/` directory.

## 3. Build

```bash
npm run build
```

## 4. Smoke checks

```bash
npm run provider-check
npm run sites
```

## 5. Common runtime commands

Single search:

```bash
node dist/MCP/logic/index.js search --site bunjang --keyword "RTX 3060" --limit 5
```

Market snapshot:

```bash
node dist/MCP/logic/index.js market-snapshot --sites joonggonara,bunjang,daangn --keyword "RTX 3060" --limit 5
```

Full merge workflow:

```bash
node dist/MCP/logic/index.js full --sites joonggonara,bunjang,daangn --keyword "RTX 3060" --limit 5
```

Scheduler once:

```bash
node dist/MCP/logic/index.js scheduler-daemon run-once
```

Reporter once:

```bash
node dist/MCP/logic/index.js reporter-daemon run-once
```

## 6. Production notes

- Run scheduler and reporter with a process manager or OS scheduler.
- Do not commit `.env`, `runs/`, `logs/`, `dist/`, or `secrets/`.
- Keep webhook and API credentials rotated if they were ever exposed locally.
