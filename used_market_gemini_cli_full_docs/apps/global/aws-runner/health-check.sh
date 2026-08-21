#!/usr/bin/env bash
set -Eeuo pipefail

base_url="${RUNNER_BASE_URL:-http://127.0.0.1:8790}"
runner_token="${RUNNER_TOKEN:-${CLOUDFLARE_RUNNER_TOKEN:-}}"
request_timeout="${HEALTH_REQUEST_TIMEOUT:-15}"
tmp_dir="$(mktemp -d)"
trap 'rm -rf -- "$tmp_dir"' EXIT

fail() {
  printf '[global-runner-health] ERROR: %s\n' "$*" >&2
  exit 1
}

request() {
  local method="$1" path="$2" expected="$3" tag="$4" auth_mode="${5:-authenticated}"
  local status
  local -a method_args=(--request "$method")
  local -a auth_args=()
  [[ "$method" == HEAD ]] && method_args=(--head)
  if [[ "$auth_mode" == authenticated && -n "$runner_token" ]]; then
    auth_args=(--header "Authorization: Bearer ${runner_token}")
  fi
  status="$(curl --silent --show-error --max-time "$request_timeout" \
    "${method_args[@]}" \
    "${auth_args[@]}" \
    --dump-header "${tmp_dir}/${tag}.headers" \
    --output "${tmp_dir}/${tag}.body" \
    --write-out '%{http_code}' \
    "${base_url}${path}")"
  [[ "$status" == "$expected" ]] || fail "${method} ${path}: expected ${expected}, got ${status}"
}

request GET /global/health 200 health unauthenticated
grep -Eq '"ok"[[:space:]]*:[[:space:]]*true' "${tmp_dir}/health.body" || fail 'health response is not healthy'
grep -Eq '"app"[[:space:]]*:[[:space:]]*"global"' "${tmp_dir}/health.body" || fail 'health response is not the global app'
grep -Eqi '^X-Used-Market-App:[[:space:]]*global' "${tmp_dir}/health.headers" || fail 'global app response header is missing'

request HEAD '/global/?country=jp' 200 page
grep -Eqi '^X-Used-Market-App:[[:space:]]*global' "${tmp_dir}/page.headers" || fail 'global page response header is missing'
request GET /global/api/categories 200 categories

if [[ "${RUN_SEARCH_SMOKE:-true}" == true ]]; then
  search_payload='{"keyword":"iphone 13","sites":["rakuma"],"sort":"recommended","limit":1}'
  search_status="$(curl --silent --show-error --max-time 60 \
    --request POST \
    --header "Authorization: Bearer ${runner_token}" \
    --header 'Content-Type: application/json' \
    --data "$search_payload" \
    --output "${tmp_dir}/search.body" \
    --write-out '%{http_code}' \
    "${base_url}/global/api/search")"
  [[ "$search_status" == 200 ]] || fail "POST /global/api/search: expected 200, got ${search_status}"
  SEARCH_RESPONSE_FILE="${tmp_dir}/search.body" node --input-type=module - <<'NODE'
import { readFile } from 'node:fs/promises';
const response = JSON.parse(await readFile(process.env.SEARCH_RESPONSE_FILE, 'utf8'));
const source = response?.data?.sources?.find((entry) => entry?.key === 'rakuma');
if (response?.status !== 'success' || !source || source.status !== 'ready' || source.collection_state !== 'ready') {
  throw new Error('Rakuma Chromium search did not reach the ready state');
}
if (!Array.isArray(response?.data?.items) || response.data.items.length < 1) {
  throw new Error('Rakuma Chromium search returned no verified listing');
}
NODE
fi

if [[ -n "$runner_token" ]]; then
  request HEAD '/global/?country=jp' 401 unauthenticated-page unauthenticated
  request GET /global/api/categories 401 unauthenticated-categories unauthenticated
fi

request GET /health 404 root-health

printf '[global-runner-health] ok (%s)\n' "$base_url"
