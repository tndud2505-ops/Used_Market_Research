#!/usr/bin/env bash
set -Eeuo pipefail

if (( EUID != 0 )); then
  exec sudo --preserve-env=APP_ROOT,RUNNER_USER,RUNNER_ENV_FILE,RESULT_ROOT,RELEASE_ID bash "$0" "$@"
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
source_root="$(cd -- "${1:-${script_dir}/..}" && pwd -P)"
app_root="${APP_ROOT:-/opt/used-market-global-runner}"
runner_user="${RUNNER_USER:-usedglobalrunner}"
runner_env_file="${RUNNER_ENV_FILE:-/etc/used-market-global-runner/runner.env}"
result_root="${RESULT_ROOT:-/var/lib/used-market-global-runner/results}"
releases_dir="${app_root}/releases"
release_id="${RELEASE_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"
release_dir="${releases_dir}/${release_id}"
current_link="${app_root}/current"
previous="$(readlink -f "$current_link" 2>/dev/null || true)"

log() {
  printf '[global-runner-update] %s\n' "$*"
}

fail() {
  printf '[global-runner-update] ERROR: %s\n' "$*" >&2
  exit 1
}

[[ "$app_root" == /* && "$app_root" != / && "$app_root" != /opt ]] || fail "unsafe APP_ROOT: ${app_root}"
[[ "$result_root" == /* && "$result_root" != / && "$result_root" != /var/lib ]] || fail "unsafe RESULT_ROOT: ${result_root}"
[[ "$release_id" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || fail 'RELEASE_ID must use YYYYMMDDTHHMMSSZ'
id -u "$runner_user" >/dev/null 2>&1 || fail "runner user does not exist: ${runner_user}"
[[ -f "$runner_env_file" ]] || fail "runner environment file is missing: ${runner_env_file}"
runner_token="$(sed -n 's/^CLOUDFLARE_RUNNER_TOKEN=//p' "$runner_env_file" | head -n 1)"

required_items=(
  package.json
  package-lock.json
  tsconfig.json
  MCP
  collector
  market
  merge
  reporter
  scheduler
  web-backend
  aws-runner
)
for item in "${required_items[@]}"; do
  [[ -e "${source_root}/${item}" ]] || fail "source item is missing: ${source_root}/${item}"
done

install -d -o root -g root -m 0755 "$app_root" "$releases_dir"
install -d -o "$runner_user" -g "$runner_user" -m 0750 "$result_root"
[[ ! -e "$release_dir" ]] || fail "release already exists: ${release_id}"
install -d -o "$runner_user" -g "$runner_user" -m 0755 "$release_dir"

for item in "${required_items[@]}"; do
  rsync -a "${source_root}/${item}" "${release_dir}/"
done
find "${release_dir}/aws-runner" -type f -name '*.sh' -exec chmod 0755 {} +
chown -R "$runner_user:$runner_user" "$release_dir"

log "installing Node dependencies for ${release_id}"
(
  cd "$release_dir"
  runuser -u "$runner_user" -- env HOME="/var/lib/used-market-global-runner" npm ci --include=dev --no-audit --no-fund
  runuser -u "$runner_user" -- env HOME="/var/lib/used-market-global-runner" npm run build
  runuser -u "$runner_user" -- env HOME="/var/lib/used-market-global-runner" npm prune --omit=dev --no-audit --no-fund
  node aws-runner/runner-contract.mjs
)

[[ -f "${release_dir}/dist/web-backend/logic/index.js" ]] || fail 'compiled web entry is missing'
if [[ -e "${release_dir}/merge/result" || -L "${release_dir}/merge/result" ]]; then
  rm -rf --one-file-system -- "${release_dir}/merge/result"
fi
ln -s "$result_root" "${release_dir}/merge/result"
chown -R root:root "$release_dir"
chown -h root:root "${release_dir}/merge/result"

rollback_failed_release() {
  local exit_code=$?
  trap - ERR
  printf '[global-runner-update] ERROR: release %s failed; restoring previous release\n' "$release_id" >&2
  if [[ -n "$previous" && -d "$previous" ]]; then
    ln -sfn "$previous" "${app_root}/.current-next"
    mv -Tf "${app_root}/.current-next" "$current_link"
    systemctl restart used-market-global-runner.service || true
  else
    rm -f -- "$current_link"
    systemctl stop used-market-global-runner.service || true
  fi
  exit "$exit_code"
}
trap rollback_failed_release ERR

ln -sfn "$release_dir" "${app_root}/.current-next"
mv -Tf "${app_root}/.current-next" "$current_link"
systemctl restart used-market-global-runner.service

healthy=false
for _ in {1..24}; do
  if RUN_SEARCH_SMOKE=false HEALTH_REQUEST_TIMEOUT=2 RUNNER_BASE_URL=http://127.0.0.1:8790 RUNNER_TOKEN="$runner_token" bash "${release_dir}/aws-runner/health-check.sh"; then
    healthy=true
    break
  fi
  sleep 5
done
[[ "$healthy" == true ]] || fail 'runner did not become healthy within 120 seconds'
RUNNER_BASE_URL=http://127.0.0.1:8790 RUNNER_TOKEN="$runner_token" bash "${release_dir}/aws-runner/health-check.sh"
trap - ERR

mapfile -t old_releases < <(find "$releases_dir" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -rn | tail -n +6 | cut -d' ' -f2-)
for old_release in "${old_releases[@]}"; do
  case "$old_release" in
    "$releases_dir"/*) rm -rf --one-file-system -- "$old_release" ;;
    *) fail "refusing unexpected release path: ${old_release}" ;;
  esac
done

log "update ok (${release_id})"
