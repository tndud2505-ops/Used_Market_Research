#!/usr/bin/env bash
set -Eeuo pipefail

if (( EUID != 0 )); then
  exec sudo --preserve-env=CLOUDFLARE_TUNNEL_TOKEN,CLOUDFLARE_RUNNER_TOKEN,RUNNER_USER,TUNNEL_USER,TUNNEL_TOKEN_FILE,RUNNER_ENV_FILE,SKIP_PUBLIC_TUNNEL_HEALTH bash "$0" "$@"
fi

RUNNER_USER="${RUNNER_USER:-usedglobalrunner}"
TUNNEL_USER="${TUNNEL_USER:-usedglobaltunnel}"
TUNNEL_TOKEN_FILE="${TUNNEL_TOKEN_FILE:-/etc/cloudflared/used-market-global-runner.token}"
RUNNER_ENV_FILE="${RUNNER_ENV_FILE:-/etc/used-market-global-runner/runner.env}"
public_url='https://global-runner.used-pick.com'
token="${CLOUDFLARE_TUNNEL_TOKEN:-}"
runner_token="${CLOUDFLARE_RUNNER_TOKEN:-}"

fail() {
  printf '[global-runner-tunnel] ERROR: %s\n' "$*" >&2
  exit 1
}

id -u "$TUNNEL_USER" >/dev/null 2>&1 || fail "tunnel user does not exist: ${TUNNEL_USER}"
[[ -f /etc/systemd/system/used-market-global-tunnel.service ]] || fail 'tunnel service is not installed'
if [[ -z "$runner_token" && -f "$RUNNER_ENV_FILE" ]]; then
  runner_token="$(sed -n 's/^CLOUDFLARE_RUNNER_TOKEN=//p' "$RUNNER_ENV_FILE" | head -n 1)"
fi

if [[ -z "$token" && -t 0 ]]; then
  read -r -s -p 'Cloudflare Tunnel token: ' token
  printf '\n'
fi
if [[ -z "$token" && ! -t 0 ]]; then
  IFS= read -r token || true
  token="${token%$'\r'}"
fi
if [[ -z "$runner_token" && -t 0 ]]; then
  read -r -s -p 'Global runner shared token: ' runner_token
  printf '\n'
fi
[[ -n "$token" ]] || fail 'set CLOUDFLARE_TUNNEL_TOKEN or enter the token interactively'
[[ "$token" != *[[:space:]]* ]] || fail 'tunnel token must not contain whitespace'
[[ -n "$runner_token" ]] || fail 'set CLOUDFLARE_RUNNER_TOKEN or store a non-empty token in the runner environment file'
[[ "$runner_token" != *[[:space:]]* ]] || fail 'runner token must not contain whitespace'
id -u "$RUNNER_USER" >/dev/null 2>&1 || fail "runner user does not exist: ${RUNNER_USER}"

runner_env_tmp="$(mktemp "$(dirname "$RUNNER_ENV_FILE")/.used-market-global-runner-env.XXXXXX")"
runner_token_written=false
while IFS= read -r line || [[ -n "$line" ]]; do
  if [[ "$line" == CLOUDFLARE_RUNNER_TOKEN=* ]]; then
    printf 'CLOUDFLARE_RUNNER_TOKEN=%s\n' "$runner_token" >> "$runner_env_tmp"
    runner_token_written=true
  else
    printf '%s\n' "$line" >> "$runner_env_tmp"
  fi
done < "$RUNNER_ENV_FILE"
if [[ "$runner_token_written" != true ]]; then
  printf 'CLOUDFLARE_RUNNER_TOKEN=%s\n' "$runner_token" >> "$runner_env_tmp"
fi
install -o root -g "$RUNNER_USER" -m 0640 "$runner_env_tmp" "$RUNNER_ENV_FILE"
rm -f -- "$runner_env_tmp"

systemctl restart used-market-global-runner.service
runner_healthy=false
for _ in {1..24}; do
  if RUN_SEARCH_SMOKE=false HEALTH_REQUEST_TIMEOUT=2 RUNNER_BASE_URL=http://127.0.0.1:8790 RUNNER_TOKEN="$runner_token" bash "$(dirname "$0")/health-check.sh"; then
    runner_healthy=true
    break
  fi
  sleep 5
done
[[ "$runner_healthy" == true ]] || fail 'local runner health failed after restart'
RUNNER_BASE_URL=http://127.0.0.1:8790 RUNNER_TOKEN="$runner_token" bash "$(dirname "$0")/health-check.sh"

install -d -o root -g "$TUNNEL_USER" -m 0750 "$(dirname "$TUNNEL_TOKEN_FILE")"
token_tmp="$(mktemp "$(dirname "$TUNNEL_TOKEN_FILE")/.used-market-global-token.XXXXXX")"
trap 'rm -f -- "$token_tmp"' EXIT
printf '%s\n' "$token" > "$token_tmp"
chown root:"$TUNNEL_USER" "$token_tmp"
chmod 0640 "$token_tmp"
mv -f -- "$token_tmp" "$TUNNEL_TOKEN_FILE"
trap - EXIT
unset token CLOUDFLARE_TUNNEL_TOKEN

systemctl daemon-reload
systemctl enable --now used-market-global-tunnel.service
systemctl is-active --quiet used-market-global-tunnel.service || {
  journalctl -u used-market-global-tunnel.service -n 60 --no-pager >&2 || true
  fail 'tunnel service did not become active'
}

if [[ "${SKIP_PUBLIC_TUNNEL_HEALTH:-false}" != true ]]; then
  public_healthy=false
  for _ in {1..18}; do
    if RUN_SEARCH_SMOKE=false HEALTH_REQUEST_TIMEOUT=2 RUNNER_BASE_URL="$public_url" RUNNER_TOKEN="$runner_token" bash "$(dirname "$0")/health-check.sh"; then
      public_healthy=true
      break
    fi
    sleep 5
  done
  [[ "$public_healthy" == true ]] || fail "public tunnel health failed: ${public_url}"
  RUNNER_BASE_URL="$public_url" RUNNER_TOKEN="$runner_token" bash "$(dirname "$0")/health-check.sh"
fi

printf '[global-runner-tunnel] ok (%s -> http://127.0.0.1:8790)\n' "$public_url"
