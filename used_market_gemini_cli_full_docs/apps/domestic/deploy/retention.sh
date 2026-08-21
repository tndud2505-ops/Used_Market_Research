#!/usr/bin/env bash
set -Eeuo pipefail

app_root="${USED_MARKET_ROOT:-/opt/used-market-domestic}"
compose_file="${app_root}/current/docker-compose.yml"
retention_days="${RESULT_RETENTION_DAYS:-14}"

if [[ ! "$retention_days" =~ ^[0-9]+$ ]] || (( retention_days < 1 )); then
  echo 'RESULT_RETENTION_DAYS must be a positive integer' >&2
  exit 2
fi

result_status=0
if [[ -f "$compose_file" ]]; then
  docker compose -f "$compose_file" exec -T used-market-domestic sh -eu -c \
    "find /app/merge/result -mindepth 1 -type f -mtime +${retention_days} -delete; find /app/merge/result -depth -mindepth 1 -type d -empty -delete" \
    || result_status=$?
fi

# Remove only dangling images created by this Compose project. Never prune the host.
mapfile -t stale_images < <(docker image ls --quiet --filter dangling=true --filter label=com.docker.compose.project=used-market-domestic | sort -u)
if (( ${#stale_images[@]} > 0 )); then
  docker image rm "${stale_images[@]}" || true
fi

if (( result_status == 0 )); then
  echo "domestic retention: ok (results>${retention_days}d)"
else
  echo "domestic retention failed with ${result_status}" >&2
fi
exit "$result_status"
