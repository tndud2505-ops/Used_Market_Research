#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="${APP_ROOT:-/opt/used-market-runner}"
RUNNER_USER="${RUNNER_USER:-usedrunner}"
TUNNEL_USER="${TUNNEL_USER:-cloudflared}"
RUNNER_ENV_DIR="${RUNNER_ENV_DIR:-/etc/used-market-runner}"
RUNNER_ENV_FILE="${RUNNER_ENV_FILE:-${RUNNER_ENV_DIR}/runner.env}"
TUNNEL_ENV_DIR="${TUNNEL_ENV_DIR:-/etc/cloudflared}"
TUNNEL_TOKEN_FILE="${TUNNEL_TOKEN_FILE:-${TUNNEL_ENV_DIR}/used-market-runner.token}"

log() {
  printf '[aws-runner] %s\n' "$*"
}

fail() {
  printf '[aws-runner] ERROR: %s\n' "$*" >&2
  exit 1
}

if [[ "${EUID}" -ne 0 ]]; then
  fail 'root 권한으로 실행하세요: sudo bash configure-ubuntu24.sh'
fi

[[ -f "$RUNNER_ENV_FILE" ]] || fail "환경 파일이 없습니다. 먼저 install-ubuntu24.sh를 실행하세요: ${RUNNER_ENV_FILE}"
[[ -f /etc/systemd/system/used-market-tunnel.service ]] || fail 'Tunnel systemd 유닛이 없습니다. 먼저 install-ubuntu24.sh를 실행하세요.'

read_env_value() {
  local key="$1"
  awk -F= -v wanted="$key" '$1 == wanted { sub(/^[^=]*=/, ""); print; exit }' "$RUNNER_ENV_FILE"
}

existing_runner_token="$(read_env_value CLOUDFLARE_RUNNER_TOKEN)"
existing_import_url="$(read_env_value D1_IMPORT_URL)"
existing_stats_import_url="$(read_env_value D1_STATS_IMPORT_URL)"
existing_import_token="$(read_env_value CLOUDFLARE_MANUAL_RUN_TOKEN)"
existing_ebay_client_id="$(read_env_value EBAY_CLIENT_ID)"
existing_ebay_client_secret="$(read_env_value EBAY_CLIENT_SECRET)"
existing_chromium_path="$(read_env_value CHROMIUM_PATH)"
existing_node_options="$(read_env_value NODE_OPTIONS)"
existing_search_cache_ttl="$(read_env_value RUNNER_SEARCH_CACHE_TTL_MS)"
existing_index_enabled="$(read_env_value RUNNER_INDEX_ENABLED)"
existing_index_mode="$(read_env_value RUNNER_INDEX_MODE)"
existing_index_dir="$(read_env_value RUNNER_INDEX_DIR)"
existing_index_path="$(read_env_value RUNNER_INDEX_PATH)"
existing_pc_shadow_write="$(read_env_value PC_PARTS_SHADOW_WRITE_ENABLED)"
existing_pc_scheduler="$(read_env_value PC_PARTS_SCHEDULER_ENABLED)"
existing_pc_source_governance="$(read_env_value PC_SOURCE_GOVERNANCE_JSON)"
existing_pc_specialist_urls="$(read_env_value PC_SPECIALIST_SEARCH_URLS_JSON)"
existing_public_url="$(read_env_value RUNNER_PUBLIC_URL)"
existing_tunnel_token=''
if [[ -f "$TUNNEL_TOKEN_FILE" ]]; then
  existing_tunnel_token="$(head -n 1 "$TUNNEL_TOKEN_FILE")"
fi

printf 'Cloudflare Worker가 AWS 러너 호출에 사용할 토큰을 입력하세요.\n'
read -r -s -p 'CLOUDFLARE_RUNNER_TOKEN (비워두면 기존값 유지): ' runner_token_input
printf '\n'
runner_token="${runner_token_input:-$existing_runner_token}"
[[ -n "$runner_token" ]] || fail 'CLOUDFLARE_RUNNER_TOKEN은 비워둘 수 없습니다.'

printf 'eBay Browse API 애플리케이션 인증정보를 입력하세요.\n'
read -r -p 'EBAY_CLIENT_ID (비워두면 기존값 유지): ' ebay_client_id_input
ebay_client_id="${ebay_client_id_input:-$existing_ebay_client_id}"
read -r -s -p 'EBAY_CLIENT_SECRET (비워두면 기존값 유지): ' ebay_client_secret_input
printf '\n'
ebay_client_secret="${ebay_client_secret_input:-$existing_ebay_client_secret}"
[[ -n "$ebay_client_id" ]] || fail 'EBAY_CLIENT_ID는 비워둘 수 없습니다.'
[[ -n "$ebay_client_secret" ]] || fail 'EBAY_CLIENT_SECRET은 비워둘 수 없습니다.'

printf 'D1_IMPORT_URL은 선택입니다. 비워두면 수집 결과를 D1로 import하지 않습니다.\n'
read -r -p "D1_IMPORT_URL [${existing_import_url}]: " import_url_input
import_url="${import_url_input:-$existing_import_url}"
if [[ -n "$import_url" && ! "$import_url" =~ ^https:// ]]; then
  fail 'D1_IMPORT_URL은 https:// URL이어야 합니다.'
fi

printf 'D1_STATS_IMPORT_URL은 PC 가격 통계 publication에 필요합니다. 매물 D1 import와 별도로 설정할 수 있습니다.\n'
read -r -p "D1_STATS_IMPORT_URL [${existing_stats_import_url}]: " stats_import_url_input
stats_import_url="${stats_import_url_input:-$existing_stats_import_url}"
if [[ -n "$stats_import_url" && ! "$stats_import_url" =~ ^https:// ]]; then
  fail 'D1_STATS_IMPORT_URL은 https:// URL이어야 합니다.'
fi

if [[ -n "$import_url" || -n "$stats_import_url" ]]; then
  read -r -s -p 'CLOUDFLARE_MANUAL_RUN_TOKEN (비워두면 기존값 유지): ' import_token_input
  printf '\n'
  import_token="${import_token_input:-$existing_import_token}"
  [[ -n "$import_token" ]] || fail 'D1 import URL을 설정할 때 import token도 필요합니다.'
else
  import_token=''
fi

printf 'Cloudflare Dashboard의 Tunnel 설정에서 복사한 토큰을 입력하세요.\n'
read -r -s -p 'Cloudflare Tunnel token (비워두면 기존값 유지): ' tunnel_token_input
printf '\n'
tunnel_token="${tunnel_token_input:-$existing_tunnel_token}"
[[ -n "$tunnel_token" ]] || fail 'Cloudflare Tunnel token은 비워둘 수 없습니다.'

printf 'Cloudflare Tunnel의 공개 Runner origin을 입력하세요. 배포 후 외부 health 검증에 사용합니다.\n'
read -r -p "RUNNER_PUBLIC_URL [${existing_public_url}]: " public_url_input
public_url="${public_url_input:-$existing_public_url}"
public_url="${public_url%/}"
[[ "$public_url" =~ ^https://[^/]+$ ]] || fail 'RUNNER_PUBLIC_URL은 경로 없는 https:// origin이어야 합니다.'

chromium_path="${existing_chromium_path:-/usr/bin/chromium}"
node_options="${existing_node_options:---max-old-space-size=2048}"
search_cache_ttl="${existing_search_cache_ttl:-300000}"
index_enabled="${existing_index_enabled:-true}"
index_mode="${existing_index_mode:-shadow}"
index_dir="${existing_index_dir:-/var/lib/used-market-runner}"
index_path="${existing_index_path:-/var/lib/used-market-runner/search-index.sqlite}"
pc_shadow_write="${existing_pc_shadow_write:-true}"
pc_scheduler="${existing_pc_scheduler:-false}"
pc_source_governance="${existing_pc_source_governance:-{}}"
pc_specialist_urls="${existing_pc_specialist_urls:-{}}"

umask 077
env_tmp="${RUNNER_ENV_FILE}.tmp.$$"
cat > "$env_tmp" <<EOF
RUNNER_PORT=8787
CLOUDFLARE_RUNNER_TOKEN=${runner_token}
EBAY_CLIENT_ID=${ebay_client_id}
EBAY_CLIENT_SECRET=${ebay_client_secret}
RUNNER_SEARCH_CACHE_TTL_MS=${search_cache_ttl}
RUNNER_INDEX_ENABLED=${index_enabled}
RUNNER_INDEX_MODE=${index_mode}
RUNNER_INDEX_DIR=${index_dir}
RUNNER_INDEX_PATH=${index_path}
PC_PARTS_SHADOW_WRITE_ENABLED=${pc_shadow_write}
PC_PARTS_SCHEDULER_ENABLED=${pc_scheduler}
PC_SOURCE_GOVERNANCE_JSON=${pc_source_governance}
PC_SPECIALIST_SEARCH_URLS_JSON=${pc_specialist_urls}
RUNNER_PUBLIC_URL=${public_url}
D1_IMPORT_URL=${import_url}
D1_STATS_IMPORT_URL=${stats_import_url}
CLOUDFLARE_MANUAL_RUN_TOKEN=${import_token}
CHROMIUM_PATH=${chromium_path}
NODE_OPTIONS=${node_options}
EOF
chown root:"$RUNNER_USER" "$env_tmp"
chmod 0640 "$env_tmp"
mv -f -- "$env_tmp" "$RUNNER_ENV_FILE"

install -d -o root -g "$TUNNEL_USER" -m 0750 "$TUNNEL_ENV_DIR"
tunnel_tmp="${TUNNEL_TOKEN_FILE}.tmp.$$"
printf '%s\n' "$tunnel_token" > "$tunnel_tmp"
chown root:"$TUNNEL_USER" "$tunnel_tmp"
chmod 0640 "$tunnel_tmp"
mv -f -- "$tunnel_tmp" "$TUNNEL_TOKEN_FILE"

systemctl daemon-reload
systemctl enable used-market-runner.service used-market-tunnel.service
systemctl restart used-market-runner.service
systemctl restart used-market-tunnel.service

if ! systemctl is-active --quiet used-market-runner.service; then
  journalctl -u used-market-runner.service -n 40 --no-pager >&2 || true
  fail 'used-market-runner.service가 시작되지 않았습니다.'
fi

if ! systemctl is-active --quiet used-market-tunnel.service; then
  journalctl -u used-market-tunnel.service -n 40 --no-pager >&2 || true
  fail 'used-market-tunnel.service가 시작되지 않았습니다.'
fi

RUNNER_PUBLIC_URL="$public_url" bash "$APP_ROOT/aws-runner/health-check.sh" --require-public

log '환경변수와 Tunnel 토큰을 저장하고 두 서비스를 순서대로 시작해 로컬·외부 health를 확인했습니다.'
