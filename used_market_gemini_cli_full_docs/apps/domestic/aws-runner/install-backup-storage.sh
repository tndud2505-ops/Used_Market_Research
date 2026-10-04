#!/usr/bin/env bash
set -Eeuo pipefail
app_root="${1:-/opt/used-market-runner}"
[[ "$EUID" -eq 0 ]] || { echo 'Run as root.' >&2; exit 1; }
[[ "$app_root" == /opt/used-market-runner ]] || {
  echo 'Backup storage units target /opt/used-market-runner only.' >&2; exit 1;
}
for filename in maintain-backup-storage.py used-market-backup-storage.service used-market-backup-storage.timer; do
  [[ -s "$app_root/aws-runner/$filename" ]] || { echo "Missing storage file: $filename" >&2; exit 1; }
done
python3 -c 'import ast,sys; ast.parse(open(sys.argv[1]).read())' "$app_root/aws-runner/maintain-backup-storage.py"
install -o root -g root -m 0644 "$app_root/aws-runner/used-market-backup-storage.service" /etc/systemd/system/used-market-backup-storage.service
install -o root -g root -m 0644 "$app_root/aws-runner/used-market-backup-storage.timer" /etc/systemd/system/used-market-backup-storage.timer
systemd-analyze verify /etc/systemd/system/used-market-backup-storage.service /etc/systemd/system/used-market-backup-storage.timer
systemctl daemon-reload
systemctl enable --now used-market-backup-storage.timer
systemctl is-active --quiet used-market-backup-storage.timer
systemctl show used-market-backup-storage.timer -p ActiveState -p NextElapseUSecRealtime
