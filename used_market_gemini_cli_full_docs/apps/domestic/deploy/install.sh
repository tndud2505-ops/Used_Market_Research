#!/usr/bin/env bash
set -Eeuo pipefail

if (( EUID != 0 )); then exec sudo bash "$0" "$@"; fi
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
source_dir="$(cd -- "${1:-${script_dir}/..}" && pwd -P)"

source /etc/os-release
[[ "${ID:-}" == ubuntu && "${VERSION_ID:-}" == 24.04* ]] || { echo 'Ubuntu 24.04 is required.' >&2; exit 2; }
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl docker.io docker-compose-v2 rsync
systemctl enable --now docker
bash "${source_dir}/deploy/update.sh" "$source_dir"
echo 'domestic install: ok (host routing is managed separately)'
