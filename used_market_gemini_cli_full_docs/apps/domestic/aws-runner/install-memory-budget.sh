#!/usr/bin/env bash
set -euo pipefail
# Reserve 1 GiB for the host, then split the remaining RAM equally with Kstock.
# Share idle capacity inside the project, without a shared memory.high throttle.
budget_mib=$(awk '/^MemTotal:/ {print int(($2 / 1024 - 1024) / 2)}' /proc/meminfo)
stats_mib=$((budget_mib - 768 - 128))
if (( stats_mib < 512 )); then echo 'USED_MEMORY_BUDGET_TOO_SMALL' >&2; exit 1; fi
# Allow an independent 384 MiB readback child during publication activation.
stats_heap_mib=$((stats_mib * 55 / 100))
for unit in used-market-runner used-market-stats used-market-backup-storage used-market-tunnel; do
  install -d -m 0755 "/etc/systemd/system/${unit}.service.d"
done
printf '[Unit]\nDescription=USED PICK shared project memory budget\n[Slice]\nMemoryAccounting=true\nMemoryLow=832M\nMemoryHigh=infinity\nMemoryMax=%sM\nMemorySwapMax=0\n' "$budget_mib" > /etc/systemd/system/usedpick.slice
# The aggregate cap, not the sum of child ceilings, protects the host/Kstock.
# Low protects hot HTTP pages from reclaim; OOM score prefers aborting offline
# work if the project actually exhausts its aggregate budget. Neither reserves RAM.
printf '[Service]\nSlice=usedpick.slice\nMemoryLow=768M\nMemoryHigh=infinity\nMemoryMax=1536M\nOOMScoreAdjust=-500\n' > /etc/systemd/system/used-market-runner.service.d/50-memory-budget.conf
printf '[Service]\nSlice=usedpick.slice\nMemoryHigh=infinity\nMemoryMax=%sM\nOOMScoreAdjust=500\nEnvironment=PC_STATS_HEAP_MB=%s\n' "$stats_mib" "$stats_heap_mib" > /etc/systemd/system/used-market-stats.service.d/50-memory-budget.conf
printf '[Service]\nSlice=usedpick.slice\nMemoryHigh=infinity\nMemoryMax=512M\nOOMScoreAdjust=500\n' > /etc/systemd/system/used-market-backup-storage.service.d/50-memory-budget.conf
printf '[Service]\nSlice=usedpick.slice\nMemoryLow=64M\nMemoryHigh=infinity\nMemoryMax=128M\nOOMScoreAdjust=-500\n' > /etc/systemd/system/used-market-tunnel.service.d/50-memory-budget.conf
printf 'USED_MEMORY_BUDGET_MIB=%s POOLED=true RUNNER_MAX=1536 STATS_MAX=%s BACKUP_MAX=512 TUNNEL_MAX=128\n' "$budget_mib" "$stats_mib"
