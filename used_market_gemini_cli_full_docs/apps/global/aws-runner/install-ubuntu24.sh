#!/usr/bin/env bash
set -Eeuo pipefail

if (( EUID != 0 )); then
  exec sudo --preserve-env=APP_ROOT,RUNNER_USER,RUNNER_ENV_FILE,RESULT_ROOT,TUNNEL_USER,TUNNEL_TOKEN_FILE,CLOUDFLARE_RUNNER_TOKEN bash "$0" "$@"
fi

APP_ROOT="${APP_ROOT:-/opt/used-market-global-runner}"
RUNNER_USER="${RUNNER_USER:-usedglobalrunner}"
RUNNER_ENV_FILE="${RUNNER_ENV_FILE:-/etc/used-market-global-runner/runner.env}"
RESULT_ROOT="${RESULT_ROOT:-/var/lib/used-market-global-runner/results}"
TUNNEL_USER="${TUNNEL_USER:-usedglobaltunnel}"
TUNNEL_TOKEN_FILE="${TUNNEL_TOKEN_FILE:-/etc/cloudflared/used-market-global-runner.token}"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
source_root="$(cd -- "${1:-${script_dir}/..}" && pwd -P)"

log() {
  printf '[global-runner-install] %s\n' "$*"
}

fail() {
  printf '[global-runner-install] ERROR: %s\n' "$*" >&2
  exit 1
}

ensure_runner_token() {
  local token="${CLOUDFLARE_RUNNER_TOKEN:-}"
  local existing_token=''
  local token_written=false
  local env_tmp
  if [[ -f "$RUNNER_ENV_FILE" ]]; then
    existing_token="$(sed -n 's/^CLOUDFLARE_RUNNER_TOKEN=//p' "$RUNNER_ENV_FILE" | head -n 1)"
  fi
  token="${token:-$existing_token}"
  token="${token:-$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")}"
  [[ -n "$token" && "$token" != *[[:space:]]* ]] || fail 'runner token generation failed'
  env_tmp="$(mktemp "$(dirname "$RUNNER_ENV_FILE")/.used-market-global-runner-env.XXXXXX")"
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" == CLOUDFLARE_RUNNER_TOKEN=* ]]; then
      printf 'CLOUDFLARE_RUNNER_TOKEN=%s\n' "$token" >> "$env_tmp"
      token_written=true
    else
      printf '%s\n' "$line" >> "$env_tmp"
    fi
  done < "$RUNNER_ENV_FILE"
  if [[ "$token_written" != true ]]; then
    printf 'CLOUDFLARE_RUNNER_TOKEN=%s\n' "$token" >> "$env_tmp"
  fi
  install -o root -g "$RUNNER_USER" -m 0640 "$env_tmp" "$RUNNER_ENV_FILE"
  rm -f -- "$env_tmp"
  unset token existing_token CLOUDFLARE_RUNNER_TOKEN
}

source /etc/os-release
[[ "${ID:-}" == ubuntu && "${VERSION_ID:-}" == 24.04* ]] || fail 'Ubuntu 24.04 is required'
[[ -f "${source_root}/aws-runner/used-market-global-runner.service" ]] || fail 'service template is missing'
[[ -f "${source_root}/aws-runner/.env.example" ]] || fail 'environment template is missing'

export DEBIAN_FRONTEND=noninteractive
log 'installing base packages'
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl gnupg rsync fonts-noto-cjk

node_major=0
if command -v node >/dev/null 2>&1; then
  node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || printf '0')"
fi
if (( node_major < 22 )); then
  log 'installing Node.js 22'
  node_setup_file="$(mktemp)"
  trap 'rm -f -- "$node_setup_file"' EXIT
  curl --fail --silent --show-error --location https://deb.nodesource.com/setup_22.x -o "$node_setup_file"
  bash "$node_setup_file"
  rm -f -- "$node_setup_file"
  trap - EXIT
  apt-get install -y --no-install-recommends nodejs
fi
command -v node >/dev/null 2>&1 || fail 'node executable is missing after installation'
command -v npm >/dev/null 2>&1 || fail 'npm executable is missing after installation'

if ! command -v cloudflared >/dev/null 2>&1; then
  log 'installing cloudflared'
  cloudflared_arch="$(dpkg --print-architecture)"
  case "$cloudflared_arch" in
    amd64) cloudflared_asset='cloudflared-linux-amd64.deb' ;;
    arm64) cloudflared_asset='cloudflared-linux-arm64.deb' ;;
    *) fail "unsupported Debian architecture: ${cloudflared_arch}" ;;
  esac
  cloudflared_deb="$(mktemp --suffix=.deb)"
  curl --fail --silent --show-error --location \
    "https://github.com/cloudflare/cloudflared/releases/latest/download/${cloudflared_asset}" \
    -o "$cloudflared_deb"
  apt-get install -y "$cloudflared_deb"
  rm -f -- "$cloudflared_deb"
fi
command -v cloudflared >/dev/null 2>&1 || fail 'cloudflared executable is missing after installation'

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
  apt-get install -y snapd
  systemctl enable --now snapd.socket
  snap install chromium
}

chromium_path=''
for candidate in /usr/bin/chromium /usr/bin/chromium-browser /snap/bin/chromium; do
  if [[ -x "$candidate" ]]; then
    chromium_path="$candidate"
    break
  fi
done
if [[ -z "$chromium_path" ]]; then
  log 'installing Chromium'
  install_chromium
  for candidate in /usr/bin/chromium /usr/bin/chromium-browser /snap/bin/chromium; do
    if [[ -x "$candidate" ]]; then
      chromium_path="$candidate"
      break
    fi
  done
fi
[[ -n "$chromium_path" ]] || fail 'Chromium executable is missing after installation'

state_root="$(dirname "$RESULT_ROOT")"
if ! id -u "$RUNNER_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$state_root" --create-home --shell /usr/sbin/nologin "$RUNNER_USER"
fi
if ! id -u "$TUNNEL_USER" >/dev/null 2>&1; then
  useradd --system --no-create-home --shell /usr/sbin/nologin "$TUNNEL_USER"
fi

install -d -o root -g root -m 0755 "$APP_ROOT" "${APP_ROOT}/releases"
install -d -o "$RUNNER_USER" -g "$RUNNER_USER" -m 0750 "$state_root" "$RESULT_ROOT"
install -d -o root -g "$RUNNER_USER" -m 0750 "$(dirname "$RUNNER_ENV_FILE")"
install -d -o root -g "$TUNNEL_USER" -m 0750 "$(dirname "$TUNNEL_TOKEN_FILE")"

if [[ ! -f "$RUNNER_ENV_FILE" ]]; then
  env_tmp="$(mktemp)"
  sed \
    -e "s|^LOCAL_BROWSER_BINARY=.*$|LOCAL_BROWSER_BINARY=${chromium_path}|" \
    -e "s|^MERGE_RESULT_BASE=.*$|MERGE_RESULT_BASE=${RESULT_ROOT}|" \
    -e "s|^TRANSACTION_RESULT_BASE=.*$|TRANSACTION_RESULT_BASE=${RESULT_ROOT}/transactions|" \
    "${source_root}/aws-runner/.env.example" > "$env_tmp"
  install -o root -g "$RUNNER_USER" -m 0640 "$env_tmp" "$RUNNER_ENV_FILE"
  rm -f -- "$env_tmp"
else
  chown root:"$RUNNER_USER" "$RUNNER_ENV_FILE"
  chmod 0640 "$RUNNER_ENV_FILE"
fi
ensure_runner_token

service_tmp="$(mktemp)"
sed \
  -e "s|__APP_ROOT__|${APP_ROOT//|/\\|}|g" \
  -e "s|__RUNNER_USER__|${RUNNER_USER}|g" \
  -e "s|__RUNNER_ENV_FILE__|${RUNNER_ENV_FILE//|/\\|}|g" \
  "${source_root}/aws-runner/used-market-global-runner.service" > "$service_tmp"
install -o root -g root -m 0644 "$service_tmp" /etc/systemd/system/used-market-global-runner.service
rm -f -- "$service_tmp"

tunnel_service_tmp="$(mktemp)"
sed \
  -e "s|__TUNNEL_USER__|${TUNNEL_USER}|g" \
  -e "s|__TUNNEL_TOKEN_FILE__|${TUNNEL_TOKEN_FILE//|/\\|}|g" \
  "${source_root}/aws-runner/used-market-global-tunnel.service" > "$tunnel_service_tmp"
install -o root -g root -m 0644 "$tunnel_service_tmp" /etc/systemd/system/used-market-global-tunnel.service
rm -f -- "$tunnel_service_tmp"

node "${source_root}/aws-runner/runner-contract.mjs"
systemctl daemon-reload
bash "${source_root}/aws-runner/update-release.sh" "$source_root"
systemctl enable --now used-market-global-runner.service
runner_token="$(sed -n 's/^CLOUDFLARE_RUNNER_TOKEN=//p' "$RUNNER_ENV_FILE" | head -n 1)"
RUNNER_BASE_URL=http://127.0.0.1:8790 RUNNER_TOKEN="$runner_token" bash "${APP_ROOT}/current/aws-runner/health-check.sh"

if [[ -s "$TUNNEL_TOKEN_FILE" ]]; then
  systemctl enable --now used-market-global-tunnel.service
else
  log "tunnel token is not configured; run ${APP_ROOT}/current/aws-runner/configure-tunnel.sh after creating the Cloudflare Tunnel"
fi

log 'installation ok'
