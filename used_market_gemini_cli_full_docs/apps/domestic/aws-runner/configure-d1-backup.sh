#!/usr/bin/env bash
set -Eeuo pipefail

ENV_FILE="${RUNNER_ENV_FILE:-/etc/used-market-runner/runner.env}"
RUNNER_USER="${RUNNER_USER:-usedrunner}"
IMPORT_URL="${D1_IMPORT_URL_INPUT:-https://used-pick.com/admin/import-listings}"
STATS_IMPORT_URL="${D1_STATS_IMPORT_URL_INPUT:-https://used-pick.com/admin/import-product-stats}"

if [[ "${1:-}" != "--token-stdin" ]]; then
  printf 'Refusing to update D1 backup without --token-stdin\n' >&2
  exit 2
fi
if [[ "${EUID}" -ne 0 ]]; then
  printf 'Run as root\n' >&2
  exit 2
fi
if [[ ! "$IMPORT_URL" =~ ^https:// || ! "$STATS_IMPORT_URL" =~ ^https:// ]]; then
  printf 'D1 import URLs must use HTTPS\n' >&2
  exit 2
fi

IFS= read -r import_token
import_token="${import_token%$'\r'}"
[[ ${#import_token} -ge 32 ]] || { printf 'Import token is too short\n' >&2; exit 2; }

temp_file="$(mktemp)"
awk -F= -v import_url="$IMPORT_URL" -v stats_import_url="$STATS_IMPORT_URL" -v import_token="$import_token" '
  BEGIN { url_found = 0; stats_url_found = 0; token_found = 0 }
  { sub(/\r$/, "") }
  $1 == "D1_IMPORT_URL" { print "D1_IMPORT_URL=" import_url; url_found = 1; next }
  $1 == "D1_STATS_IMPORT_URL" { print "D1_STATS_IMPORT_URL=" stats_import_url; stats_url_found = 1; next }
  $1 == "CLOUDFLARE_MANUAL_RUN_TOKEN" { print "CLOUDFLARE_MANUAL_RUN_TOKEN=" import_token; token_found = 1; next }
  { print }
  END {
    if (!url_found) print "D1_IMPORT_URL=" import_url
    if (!stats_url_found) print "D1_STATS_IMPORT_URL=" stats_import_url
    if (!token_found) print "CLOUDFLARE_MANUAL_RUN_TOKEN=" import_token
  }
' "$ENV_FILE" > "$temp_file"
install -o root -g "$RUNNER_USER" -m 0640 "$temp_file" "$ENV_FILE"
rm -f -- "$temp_file"
printf '{"status":"success","d1_listing_url_configured":true,"d1_stats_url_configured":true,"d1_token_configured":true}\n'
