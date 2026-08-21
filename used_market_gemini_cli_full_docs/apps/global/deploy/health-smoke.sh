#!/usr/bin/env bash
set -Eeuo pipefail

base_url="${1:-http://127.0.0.1}"
mode="${2:-proxy}"
tmp_dir="$(mktemp -d)"
trap 'rm -rf -- "$tmp_dir"' EXIT

request() {
  local method="$1" path="$2" expected="$3" headers="$tmp_dir/headers" body="$tmp_dir/body"
  local status
  local -a method_args=(--request "$method")
  [[ "$method" == HEAD ]] && method_args=(--head)
  status="$(curl --silent --show-error --max-time 15 "${method_args[@]}" --dump-header "$headers" --output "$body" --write-out '%{http_code}' "${base_url}${path}")"
  if [[ "$status" != "$expected" ]]; then
    printf 'FAIL %s %s: expected %s, got %s\n' "$method" "$path" "$expected" "$status" >&2
    sed -n '1,20p' "$body" >&2
    return 1
  fi
}

request GET /global/health 200
grep -Eqi 'ok|healthy' "$tmp_dir/body" || { echo 'FAIL /health body is not healthy' >&2; exit 1; }
request HEAD '/global/?country=jp' 200

if [[ "$mode" == "proxy" ]]; then
  request HEAD / 308
  grep -Eqi '^Location:[[:space:]]*/global/\?country=jp' "$tmp_dir/headers" || { echo 'FAIL root redirect target is incorrect' >&2; exit 1; }
  request GET /api/search 404
  request GET /health 404
  grep -Eqi '^Content-Security-Policy:' "$tmp_dir/headers" || { echo 'FAIL missing CSP header' >&2; exit 1; }
  grep -Eqi '^X-Content-Type-Options:[[:space:]]*nosniff' "$tmp_dir/headers" || { echo 'FAIL missing nosniff header' >&2; exit 1; }
  request GET /global/api/categories 200
  request GET /global/api/not-public 404
  request GET /global/api/search 405

  if [[ "$base_url" == https://* ]]; then
    grep -Eqi '^Strict-Transport-Security:' "$tmp_dir/headers" || { echo 'FAIL missing HSTS on HTTPS' >&2; exit 1; }
  else
    ! grep -Eqi '^Strict-Transport-Security:' "$tmp_dir/headers" || { echo 'FAIL HSTS must not be sent over HTTP' >&2; exit 1; }
  fi
fi

echo "health smoke: ok (${base_url}, ${mode})"
