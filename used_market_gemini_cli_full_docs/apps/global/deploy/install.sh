#!/usr/bin/env bash
set -Eeuo pipefail

if (( EUID != 0 )); then exec sudo bash "$0" "$@"; fi
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
source_dir="$(cd -- "${1:-${script_dir}/..}" && pwd -P)"

source /etc/os-release
[[ "${ID:-}" == ubuntu && "${VERSION_ID:-}" == 24.04* ]] || { echo 'Ubuntu 24.04 is required.' >&2; exit 2; }
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl docker.io docker-compose-v2 nginx rsync
systemctl enable --now docker
install -m 0644 "${source_dir}/deploy/nginx-global-only.conf" /etc/nginx/sites-available/used-market-global
install -d -m 0755 /etc/nginx/snippets
install -m 0644 "${source_dir}/deploy/nginx-global-security-headers.conf" /etc/nginx/snippets/used-market-global-security-headers.conf
install -m 0644 "${source_dir}/deploy/nginx-global-proxy-params.conf" /etc/nginx/snippets/used-market-global-proxy-params.conf
ln -sfn /etc/nginx/sites-available/used-market-global /etc/nginx/sites-enabled/used-market-global
rm -f /etc/nginx/sites-enabled/default
rm -f /etc/nginx/sites-enabled/used-market /etc/nginx/sites-enabled/used-market-split
nginx -t
systemctl enable --now nginx
systemctl reload nginx
install -m 0644 "${source_dir}/deploy/used-market-global-retention.service" /etc/systemd/system/used-market-global-retention.service
install -m 0644 "${source_dir}/deploy/used-market-global-retention.timer" /etc/systemd/system/used-market-global-retention.timer
systemctl daemon-reload
systemctl disable --now used-market-retention.timer 2>/dev/null || true
bash "${source_dir}/deploy/update.sh" "$source_dir"
systemctl enable --now used-market-global-retention.timer
"${source_dir}/deploy/health-smoke.sh" http://127.0.0.1 proxy
echo 'global install: ok'
