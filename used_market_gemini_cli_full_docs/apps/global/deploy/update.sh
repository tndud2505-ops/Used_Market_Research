#!/usr/bin/env bash
set -Eeuo pipefail

if (( EUID != 0 )); then
  exec sudo --preserve-env=USED_MARKET_ROOT bash "$0" "$@"
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
source_dir="$(cd -- "${1:-${script_dir}/..}" && pwd -P)"
app_root="${USED_MARKET_ROOT:-/opt/used-market-global}"
releases_dir="${app_root}/releases"
release_id="$(date -u +%Y%m%dT%H%M%SZ)"
release_dir="${releases_dir}/${release_id}"
current_link="${app_root}/current"
previous="$(readlink -f "$current_link" 2>/dev/null || true)"

for required in Dockerfile docker-compose.yml deploy/health-smoke.sh; do
  [[ -f "${source_dir}/${required}" ]] || { echo "Missing ${source_dir}/${required}" >&2; exit 2; }
done

install -d -m 0755 "$releases_dir"
install -d -m 0755 "$release_dir"
rsync -a \
  --exclude '.git/' --exclude '.env' --exclude '.env.*' --exclude 'node_modules/' \
  --exclude 'dist/' --exclude '.playwright-cli/' --exclude 'merge/result/' \
  --exclude 'tmp/' --exclude 'secrets/' --exclude '*.pem' --exclude '*.key' \
  "${source_dir}/" "${release_dir}/"
chmod 0755 "${release_dir}"/deploy/*.sh

rollback_failed_release() {
  local exit_code=$?
  echo "Release ${release_id} failed; restoring previous release" >&2
  if [[ -n "$previous" && -d "$previous" ]]; then
    ln -sfn "$previous" "${app_root}/.current-next"
    mv -Tf "${app_root}/.current-next" "$current_link"
    docker compose -f "${previous}/docker-compose.yml" build
    docker compose -f "${previous}/docker-compose.yml" up -d --remove-orphans
  fi
  exit "$exit_code"
}
trap rollback_failed_release ERR

docker compose -f "${release_dir}/docker-compose.yml" build
ln -sfn "$release_dir" "${app_root}/.current-next"
mv -Tf "${app_root}/.current-next" "$current_link"
docker compose -f "${release_dir}/docker-compose.yml" up -d --remove-orphans

for _ in {1..24}; do
  if "${release_dir}/deploy/health-smoke.sh" http://127.0.0.1:8788 app-only; then
    break
  fi
  sleep 5
done
"${release_dir}/deploy/health-smoke.sh" http://127.0.0.1:8788 app-only
trap - ERR

# Keep five source releases. Deletion is constrained to this project's release directory.
mapfile -t old_releases < <(find "$releases_dir" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -rn | tail -n +6 | cut -d' ' -f2-)
for old_release in "${old_releases[@]}"; do
  case "$old_release" in
    "$releases_dir"/*) rm -rf --one-file-system -- "$old_release" ;;
    *) echo "Refusing unexpected release path: $old_release" >&2; exit 3 ;;
  esac
done

echo "update: ok (${release_id})"
