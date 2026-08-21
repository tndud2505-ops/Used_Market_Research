#!/usr/bin/env bash
set -Eeuo pipefail

if (( EUID != 0 )); then
  exec sudo --preserve-env=APP_ROOT,RUNNER_ENV_FILE bash "$0" "$@"
fi

app_root="${APP_ROOT:-/opt/used-market-global-runner}"
releases_dir="${app_root}/releases"
current_link="${app_root}/current"
runner_env_file="${RUNNER_ENV_FILE:-/etc/used-market-global-runner/runner.env}"
requested="${1:-}"

fail() {
  printf '[global-runner-rollback] ERROR: %s\n' "$*" >&2
  exit 1
}

[[ "$app_root" == /* && "$app_root" != / && "$app_root" != /opt ]] || fail "unsafe APP_ROOT: ${app_root}"
[[ -f "$runner_env_file" ]] || fail "runner environment file is missing: ${runner_env_file}"
runner_token="$(sed -n 's/^CLOUDFLARE_RUNNER_TOKEN=//p' "$runner_env_file" | head -n 1)"
current="$(readlink -f "$current_link" 2>/dev/null || true)"
[[ -n "$current" && -d "$current" ]] || fail 'current release is missing'

if [[ -n "$requested" ]]; then
  [[ "$requested" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || fail 'Release must be a timestamp shown under releases/'
  target="$(realpath -m "${releases_dir}/${requested}")"
else
  target="$(find "$releases_dir" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' \
    | sort -rn \
    | cut -d' ' -f2- \
    | grep -Fxv "$current" \
    | head -n 1 || true)"
fi

[[ -n "$target" && -d "$target" && -f "$target/dist/web-backend/logic/index.js" ]] || fail 'No rollback release available'
case "$target" in
  "$releases_dir"/*) ;;
  *) fail 'Refusing target outside releases directory' ;;
esac

wait_for_health() {
  local release_dir="$1"
  for _ in {1..24}; do
    if RUN_SEARCH_SMOKE=false HEALTH_REQUEST_TIMEOUT=2 RUNNER_BASE_URL=http://127.0.0.1:8790 RUNNER_TOKEN="$runner_token" \
      bash "${release_dir}/aws-runner/health-check.sh"; then
      RUNNER_BASE_URL=http://127.0.0.1:8790 RUNNER_TOKEN="$runner_token" \
        bash "${release_dir}/aws-runner/health-check.sh"
      return
    fi
    sleep 5
  done
  return 1
}

restore_current() {
  local exit_code=$?
  trap - ERR
  ln -sfn "$current" "${app_root}/.current-next"
  mv -Tf "${app_root}/.current-next" "$current_link"
  systemctl restart used-market-global-runner.service || true
  wait_for_health "$current" || printf '[global-runner-rollback] WARNING: restored release did not become healthy\n' >&2
  exit "$exit_code"
}
trap restore_current ERR

ln -sfn "$target" "${app_root}/.current-next"
mv -Tf "${app_root}/.current-next" "$current_link"
systemctl restart used-market-global-runner.service
wait_for_health "$target" || fail 'rollback target did not become healthy within 120 seconds'
trap - ERR

printf '[global-runner-rollback] ok (%s)\n' "$(basename "$target")"
