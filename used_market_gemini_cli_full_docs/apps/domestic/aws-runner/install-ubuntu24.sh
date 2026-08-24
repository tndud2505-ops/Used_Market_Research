#!/usr/bin/env bash
set -Eeuo pipefail

# Ubuntu 24.04 기준 AWS 러너 설치 스크립트.
# 실행 위치의 프로젝트 루트에서 runner.mjs와 live-search.mjs를 복사하고
# Node, Chromium, cloudflared, systemd 유닛을 준비한다.

APP_ROOT="${APP_ROOT:-/opt/used-market-runner}"
RUNNER_USER="${RUNNER_USER:-usedrunner}"
TUNNEL_USER="${TUNNEL_USER:-cloudflared}"
RUNNER_ENV_DIR="${RUNNER_ENV_DIR:-/etc/used-market-runner}"
RUNNER_ENV_FILE="${RUNNER_ENV_FILE:-${RUNNER_ENV_DIR}/runner.env}"
TUNNEL_ENV_DIR="${TUNNEL_ENV_DIR:-/etc/cloudflared}"
TUNNEL_TOKEN_FILE="${TUNNEL_TOKEN_FILE:-${TUNNEL_ENV_DIR}/used-market-runner.token}"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_ROOT="${1:-$(cd -- "${SCRIPT_DIR}/.." && pwd)}"

log() {
  printf '[aws-runner] %s\n' "$*"
}

fail() {
  printf '[aws-runner] ERROR: %s\n' "$*" >&2
  exit 1
}

on_error() {
  printf '[aws-runner] ERROR: installation failed near line %s\n' "$1" >&2
}

trap 'on_error "$LINENO"' ERR

if [[ "${EUID}" -ne 0 ]]; then
  fail 'root 권한으로 실행하세요: sudo bash aws-runner/install-ubuntu24.sh'
fi

if [[ ! -f "${SOURCE_ROOT}/aws-runner/runner.mjs" ]]; then
  fail "runner.mjs를 찾을 수 없습니다: ${SOURCE_ROOT}/aws-runner/runner.mjs"
fi

for required_file in live-search.mjs category-filter.mjs category-source-map.mjs target-sites.mjs; do
  if [[ ! -f "${SOURCE_ROOT}/cloudflare/${required_file}" ]]; then
    fail "runner.mjs가 import하는 파일이 없습니다: ${SOURCE_ROOT}/cloudflare/${required_file}. 프로젝트 루트 전체를 업로드하세요."
  fi
done

export DEBIAN_FRONTEND=noninteractive
log '기본 패키지 설치'
apt-get update
apt-get install -y ca-certificates curl gnupg jq software-properties-common

node_major=0
if command -v node >/dev/null 2>&1; then
  node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || printf '0')"
fi

if (( node_major < 22 )); then
  log 'Node.js 22 설치'
  node_setup_file="$(mktemp)"
  trap 'rm -f -- "$node_setup_file"' EXIT
  curl --fail --silent --show-error --location https://deb.nodesource.com/setup_22.x -o "$node_setup_file"
  bash "$node_setup_file"
  rm -f -- "$node_setup_file"
  trap 'on_error "$LINENO"' ERR
  apt-get install -y nodejs
fi

command -v node >/dev/null 2>&1 || fail 'Node.js 설치 후 node 명령을 찾지 못했습니다.'

install_chromium() {
  local package_name=''
  local candidate
  for candidate in chromium chromium-browser; do
    if apt-cache policy "$candidate" | grep -qE 'Candidate: [^ (]'; then
      package_name="$candidate"
      break
    fi
  done

  if [[ -n "$package_name" ]]; then
    apt-get install -y "$package_name"
    return
  fi

  log 'APT Chromium 패키지가 없어 snap Chromium을 설치합니다.'
  apt-get install -y snapd
  systemctl enable --now snapd.socket
  snap install chromium
}

if ! command -v chromium >/dev/null 2>&1 && ! command -v chromium-browser >/dev/null 2>&1 && [[ ! -x /snap/bin/chromium ]]; then
  log 'Chromium 설치'
  install_chromium
fi

CHROMIUM_PATH="${CHROMIUM_PATH:-}"
if [[ -z "$CHROMIUM_PATH" ]]; then
  for candidate in chromium chromium-browser /snap/bin/chromium; do
    if command -v "$candidate" >/dev/null 2>&1 || [[ -x "$candidate" ]]; then
      CHROMIUM_PATH="$(command -v "$candidate" 2>/dev/null || printf '%s' "$candidate")"
      break
    fi
  done
fi
[[ -n "$CHROMIUM_PATH" ]] || fail 'Chromium 실행 파일을 찾지 못했습니다.'

if ! command -v cloudflared >/dev/null 2>&1; then
  log 'cloudflared 설치'
  cloudflared_arch="$(dpkg --print-architecture)"
  case "$cloudflared_arch" in
    amd64) cloudflared_asset='cloudflared-linux-amd64.deb' ;;
    arm64) cloudflared_asset='cloudflared-linux-arm64.deb' ;;
    *) fail "지원하지 않는 Debian 아키텍처입니다: ${cloudflared_arch}" ;;
  esac
  cloudflared_deb="$(mktemp --suffix=.deb)"
  curl --fail --silent --show-error --location \
    "https://github.com/cloudflare/cloudflared/releases/latest/download/${cloudflared_asset}" \
    -o "$cloudflared_deb"
  apt-get install -y "$cloudflared_deb"
  rm -f -- "$cloudflared_deb"
fi

command -v cloudflared >/dev/null 2>&1 || fail 'cloudflared 설치 후 명령을 찾지 못했습니다.'

if ! id -u "$RUNNER_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$APP_ROOT" --create-home --shell /usr/sbin/nologin "$RUNNER_USER"
fi

if ! id -u "$TUNNEL_USER" >/dev/null 2>&1; then
  useradd --system --no-create-home --shell /usr/sbin/nologin "$TUNNEL_USER"
fi

log "애플리케이션 파일 설치: ${APP_ROOT}"
install -d -o root -g root -m 0755 "$APP_ROOT"
install -d -o root -g root -m 0755 "$APP_ROOT/aws-runner" "$APP_ROOT/cloudflare"

if [[ "$SOURCE_ROOT" != "$APP_ROOT" ]]; then
  cp -a "$SOURCE_ROOT/aws-runner/." "$APP_ROOT/aws-runner/"
  for required_file in live-search.mjs category-filter.mjs category-source-map.mjs target-sites.mjs; do
    install -m 0644 "$SOURCE_ROOT/cloudflare/${required_file}" "$APP_ROOT/cloudflare/${required_file}"
  done
fi

chown -R root:root "$APP_ROOT/aws-runner" "$APP_ROOT/cloudflare"
find "$APP_ROOT/aws-runner" "$APP_ROOT/cloudflare" -type d -exec chmod 0755 {} +
find "$APP_ROOT/aws-runner" "$APP_ROOT/cloudflare" -type f -exec chmod 0644 {} +
chmod 0755 "$APP_ROOT/aws-runner"/*.sh

log '환경변수·토큰 디렉터리 준비'
install -d -o root -g "$RUNNER_USER" -m 0750 "$RUNNER_ENV_DIR"
install -d -o root -g "$TUNNEL_USER" -m 0750 "$TUNNEL_ENV_DIR"

if [[ ! -f "$RUNNER_ENV_FILE" ]]; then
  cat > "$RUNNER_ENV_FILE" <<EOF
RUNNER_PORT=8787
CLOUDFLARE_RUNNER_TOKEN=
EBAY_CLIENT_ID=
EBAY_CLIENT_SECRET=
RUNNER_SEARCH_CACHE_TTL_MS=300000
RUNNER_INDEX_ENABLED=true
RUNNER_INDEX_MODE=shadow
RUNNER_INDEX_DIR=/var/lib/used-market-runner
RUNNER_INDEX_PATH=/var/lib/used-market-runner/search-index.sqlite
D1_IMPORT_URL=
CLOUDFLARE_MANUAL_RUN_TOKEN=
CHROMIUM_PATH=${CHROMIUM_PATH}
NODE_OPTIONS=--max-old-space-size=2048
EOF
fi

set_env_value() {
  local key="$1"
  local value="$2"
  local temp_file
  temp_file="$(mktemp)"
  awk -F= -v wanted="$key" -v replacement="$value" '
    BEGIN { found = 0 }
    { sub(/\r$/, "") }
    $1 == wanted { print wanted "=" replacement; found = 1; next }
    { print }
    END { if (!found) print wanted "=" replacement }
  ' "$RUNNER_ENV_FILE" > "$temp_file"
  install -o root -g "$RUNNER_USER" -m 0640 "$temp_file" "$RUNNER_ENV_FILE"
  rm -f -- "$temp_file"
}

# 비밀값은 그대로 두고 검색 색인 운영값만 반복 배포 가능하게 맞춘다.
set_env_value RUNNER_SEARCH_CACHE_TTL_MS 300000
set_env_value RUNNER_INDEX_ENABLED true
if ! grep -q '^RUNNER_INDEX_MODE=' "$RUNNER_ENV_FILE"; then
  set_env_value RUNNER_INDEX_MODE shadow
fi
set_env_value RUNNER_INDEX_DIR /var/lib/used-market-runner
set_env_value RUNNER_INDEX_PATH /var/lib/used-market-runner/search-index.sqlite
set_env_value NODE_OPTIONS --max-old-space-size=2048

chown root:"$RUNNER_USER" "$RUNNER_ENV_FILE"
chmod 0640 "$RUNNER_ENV_FILE"

log 'systemd 유닛 설치'
service_tmp="$(mktemp)"
sed \
  -e "s|__APP_ROOT__|${APP_ROOT//|/\\|}|g" \
  -e "s|__RUNNER_USER__|${RUNNER_USER}|g" \
  -e "s|__RUNNER_ENV_FILE__|${RUNNER_ENV_FILE//|/\\|}|g" \
  "$APP_ROOT/aws-runner/used-market-runner.service" > "$service_tmp"
install -o root -g root -m 0644 "$service_tmp" /etc/systemd/system/used-market-runner.service
rm -f -- "$service_tmp"

tunnel_tmp="$(mktemp)"
sed \
  -e "s|__TUNNEL_USER__|${TUNNEL_USER}|g" \
  -e "s|__TUNNEL_TOKEN_FILE__|${TUNNEL_TOKEN_FILE//|/\\|}|g" \
  "$APP_ROOT/aws-runner/used-market-tunnel.service" > "$tunnel_tmp"
install -o root -g root -m 0644 "$tunnel_tmp" /etc/systemd/system/used-market-tunnel.service
rm -f -- "$tunnel_tmp"

node --check "$APP_ROOT/aws-runner/runner.mjs"
node --check "$APP_ROOT/aws-runner/search-index.mjs"
node --check "$APP_ROOT/aws-runner/search-index-harness.mjs"
node "$APP_ROOT/aws-runner/search-index-harness.mjs"
node --check "$APP_ROOT/cloudflare/live-search.mjs"
node --check "$APP_ROOT/cloudflare/category-filter.mjs"
node --check "$APP_ROOT/cloudflare/category-source-map.mjs"
node --check "$APP_ROOT/cloudflare/target-sites.mjs"

systemctl daemon-reload
systemctl enable used-market-runner.service

log '설치 완료'
printf '\n다음 단계:\n'
printf '  1) sudo bash %s/aws-runner/configure-ubuntu24.sh\n' "$APP_ROOT"
printf '  2) bash %s/aws-runner/health-check.sh\n' "$APP_ROOT"
printf '\n현재 runner 서비스만 enable 상태이며, Tunnel은 토큰 설정 후 시작합니다.\n'
