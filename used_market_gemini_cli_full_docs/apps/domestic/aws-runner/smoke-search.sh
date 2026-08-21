#!/usr/bin/env bash
set -Eeuo pipefail

BASE_URL="${RUNNER_BASE_URL:-http://127.0.0.1:8787}"
ENV_FILE="${RUNNER_ENV_FILE:-/etc/used-market-runner/runner.env}"
KEYWORD="${1:-아이폰 15}"
CATEGORY_ID="${SEARCH_CATEGORY_ID:-mobile}"
SORT="${SEARCH_SORT:-recommended}"

read_env_value() {
  local key="$1"
  awk -F= -v wanted="$key" '$1 == wanted { sub(/^[^=]*=/, ""); sub(/\r$/, ""); print; exit }' "$ENV_FILE"
}

runner_token="${RUNNER_TOKEN:-$(read_env_value CLOUDFLARE_RUNNER_TOKEN)}"
[[ -n "$runner_token" ]] || { printf 'RUNNER_TOKEN is unavailable\n' >&2; exit 2; }

request_body="$(jq -cn --arg keyword "$KEYWORD" --arg category_id "$CATEGORY_ID" --arg sort "$SORT" '{
  keyword: $keyword,
  category_id: $category_id,
  sites: ["joonggonara", "bunjang", "hellomarket", "rethinkmall"],
  sort: $sort,
  limit: 24,
  site_window: 40
}')"

curl --fail --silent --show-error --max-time 150 \
  -X POST "${BASE_URL%/}/api/search" \
  -H "authorization: Bearer ${runner_token}" \
  -H 'content-type: application/json' \
  --data "$request_body" \
  | jq '{
      status,
      data: {
        items: (.data.items | length),
        available: .data.quality.available_count,
        freshness: .data.freshness,
        sources: [.data.sources[] | {key, count, status, data_source}]
      }
    }'
