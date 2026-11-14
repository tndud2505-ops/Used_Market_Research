#!/usr/bin/env bash
set -Eeuo pipefail
[[ "$EUID" -eq 0 ]] || { echo 'Run as root.' >&2; exit 1; }
app_root=/opt/used-market-runner
for name in linux_morning_pipeline.lock partitioned_heavy_work.lock; do
  [[ -f "/home/ubuntu/Kstock/tmp/$name" ]] || { echo 'KSTOCK admission lock unavailable.' >&2; exit 1; }
done
for name in daangn-trial-core.mjs collect-daangn-trial.mjs publish-daangn-trial.mjs; do
  node --check "$app_root/aws-runner/$name"
done
node --check "$app_root/collector/logic/daangn-public-search.mjs"
install -d -o usedrunner -g usedrunner -m 0700 /var/lib/used-market-runner/daangn-trial
for kind in service timer; do
  install -o root -g root -m 0644 "$app_root/aws-runner/used-market-daangn-trial.$kind" "/etc/systemd/system/used-market-daangn-trial.$kind"
done
systemd-analyze verify /etc/systemd/system/used-market-daangn-trial.service /etc/systemd/system/used-market-daangn-trial.timer
systemctl daemon-reload
systemctl enable --now used-market-daangn-trial.timer
systemctl show used-market-daangn-trial.timer -p ActiveState -p NextElapseUSecRealtime
