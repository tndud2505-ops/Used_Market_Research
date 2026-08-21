#!/usr/bin/env bash
set -Eeuo pipefail

if (( EUID != 0 )); then
  exec sudo --preserve-env=USED_MARKET_ROOT bash "$0" "$@"
fi

app_root="${USED_MARKET_ROOT:-/opt/used-market-global}"
releases_dir="${app_root}/releases"
current_link="${app_root}/current"
current="$(readlink -f "$current_link")"
requested="${1:-}"

if [[ -n "$requested" ]]; then
  [[ "$requested" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || { echo 'Release must be a timestamp shown under releases/' >&2; exit 2; }
  target="$(realpath "${releases_dir}/${requested}")"
else
  target="$(find "$releases_dir" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -rn | cut -d' ' -f2- | grep -Fxv "$current" | head -n 1)"
fi

[[ -n "$target" && -d "$target" && -f "$target/docker-compose.yml" ]] || { echo 'No rollback release available' >&2; exit 2; }
case "$target" in "$releases_dir"/*) ;; *) echo 'Refusing target outside releases directory' >&2; exit 3 ;; esac

docker compose -f "$target/docker-compose.yml" build
ln -sfn "$target" "${app_root}/.current-next"
mv -Tf "${app_root}/.current-next" "$current_link"
docker compose -f "$target/docker-compose.yml" up -d --remove-orphans
"$target/deploy/health-smoke.sh" http://127.0.0.1:8788 app-only
echo "rollback: ok ($(basename "$target"))"
