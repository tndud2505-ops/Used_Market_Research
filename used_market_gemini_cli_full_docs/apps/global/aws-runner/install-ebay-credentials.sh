#!/usr/bin/env bash
set -Eeuo pipefail

if (( EUID != 0 )); then
  exec sudo bash "$0" "$@"
fi

runner_env_file="${RUNNER_ENV_FILE:-/etc/used-market-global-runner/runner.env}"
runner_user="${RUNNER_USER:-usedglobalrunner}"
health_script="/opt/used-market-global-runner/current/aws-runner/health-check.sh"

fail() {
  printf '[global-ebay-credentials] ERROR: %s\n' "$*" >&2
  exit 1
}

[[ "$runner_env_file" == /etc/used-market-global-runner/runner.env ]] || fail 'unexpected runner environment path'
[[ -f "$runner_env_file" ]] || fail 'runner environment file is missing'
[[ -f "$health_script" ]] || fail 'runner health script is missing'
id -u "$runner_user" >/dev/null 2>&1 || fail 'runner user is missing'

IFS= read -r client_id_b64 || fail 'Client ID input is missing'
IFS= read -r client_secret_b64 || fail 'Client Secret input is missing'
client_id="$(printf '%s' "$client_id_b64" | base64 --decode 2>/dev/null)" || fail 'Client ID encoding is invalid'
client_secret="$(printf '%s' "$client_secret_b64" | base64 --decode 2>/dev/null)" || fail 'Client Secret encoding is invalid'
unset client_id_b64 client_secret_b64

[[ "$client_id" =~ ^[-A-Za-z0-9._~+/]+$ ]] || fail 'Client ID contains unsupported characters'
[[ "$client_secret" =~ ^[-A-Za-z0-9._~+/]+$ ]] || fail 'Client Secret contains unsupported characters'

runner_token="$(sed -n 's/^CLOUDFLARE_RUNNER_TOKEN=//p' "$runner_env_file" | head -n 1)"
[[ -n "$runner_token" ]] || fail 'runner authentication token is missing'

backup="$(mktemp /etc/used-market-global-runner/.runner.env.ebay-backup.XXXXXX)"
candidate="$(mktemp /etc/used-market-global-runner/.runner.env.ebay-next.XXXXXX)"
response_file="$(mktemp)"
cp --preserve=mode,ownership,timestamps "$runner_env_file" "$backup"

restore_previous() {
  local exit_code=$?
  trap - ERR
  install -o root -g "$runner_user" -m 0640 "$backup" "$runner_env_file"
  systemctl restart used-market-global-runner.service || true
  rm -f -- "$backup" "$candidate" "$response_file"
  unset client_id client_secret
  printf '[global-ebay-credentials] ERROR: verification failed; previous environment restored\n' >&2
  exit "$exit_code"
}
trap restore_previous ERR

awk '!/^EBAY_CLIENT_ID=/ && !/^EBAY_CLIENT_SECRET=/ && !/^EBAY_BROWSE_API_TOKEN=/' "$runner_env_file" > "$candidate"
printf 'EBAY_CLIENT_ID=%s\nEBAY_CLIENT_SECRET=%s\n' "$client_id" "$client_secret" >> "$candidate"
install -o root -g "$runner_user" -m 0640 "$candidate" "$runner_env_file"
unset client_id client_secret

systemctl restart used-market-global-runner.service
ready=false
for _ in {1..24}; do
  if RUN_SEARCH_SMOKE=false HEALTH_REQUEST_TIMEOUT=2 RUNNER_BASE_URL=http://127.0.0.1:8790 RUNNER_TOKEN="$runner_token" bash "$health_script" >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 5
done
[[ "$ready" == true ]] || fail 'runner did not become ready after credential update'

status="$(curl --silent --show-error --max-time 60 \
  --request POST \
  --header "Authorization: Bearer ${runner_token}" \
  --header 'Content-Type: application/json' \
  --data '{"keyword":"iphone 13","sites":["ebay"],"sort":"recommended","limit":1,"refresh_index":true}' \
  --output "$response_file" \
  --write-out '%{http_code}' \
  http://127.0.0.1:8790/global/api/search)"
[[ "$status" == 200 ]] || fail "eBay search returned HTTP ${status}"

EBAY_RESPONSE_FILE="$response_file" node --input-type=module - <<'NODE'
import { readFile } from 'node:fs/promises';
const payload = JSON.parse(await readFile(process.env.EBAY_RESPONSE_FILE, 'utf8'));
const source = payload?.data?.sources?.find((entry) => entry?.key === 'ebay');
const acceptableState = source?.collection_state === 'ready' || source?.collection_state === 'partial';
if (payload?.status !== 'success' || !source || !acceptableState || source?.errors?.length) {
  throw new Error('eBay source did not return a usable collection state');
}
if (!Array.isArray(payload?.data?.items) || !payload.data.items.some((item) => item?.site === 'ebay')) {
  throw new Error('eBay Browse API returned no verified listing');
}
NODE

trap - ERR
rm -f -- "$backup" "$candidate" "$response_file"
printf '[global-ebay-credentials] ok (Production credentials stored; live Browse API search passed)\n'
