#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
apps=(
  "$repo_root/used_market_gemini_cli_full_docs/apps/domestic"
  "$repo_root/used_market_gemini_cli_full_docs/apps/global"
)

node_major="$(node --version | sed 's/^v//' | cut -d. -f1)"
if [[ "$node_major" -lt 22 ]]; then
  echo "Node.js 22 or newer is required. Found $(node --version)." >&2
  exit 1
fi

npm_major="$(npm --version | cut -d. -f1)"
if [[ "$npm_major" -lt 10 ]]; then
  echo "npm 10 or newer is required. Found $(npm --version)." >&2
  exit 1
fi

for app in "${apps[@]}"; do
  echo "[setup] Installing $app"
  npm --prefix "$app" ci
  if [[ ! -f "$app/.env" ]]; then
    cp "$app/.env.example" "$app/.env"
    echo "[setup] Created local $app/.env from the safe example."
  fi
done

echo '[setup] Installing the Chromium browser used by the global UI harness'
node "${apps[1]}/node_modules/@playwright/cli/playwright-cli.js" install-browser chromium

echo '[setup] Complete. Add private values only to each ignored .env file.'
