#!/usr/bin/env bash
set -Eeuo pipefail

BASE_URL="${RUNNER_BASE_URL:-http://127.0.0.1:8787}"
PUBLIC_URL="${RUNNER_PUBLIC_URL:-}"
TIMEOUT_SECONDS="${RUNNER_HEALTH_TIMEOUT_SECONDS:-15}"
RUN_JOB=false
JOB_NAME="${RUNNER_HEALTH_JOB:-gpu-fast-scan}"
RUNNER_TOKEN_INPUT="${RUNNER_TOKEN:-}"

usage() {
  cat <<'EOF'
사용법:
  bash health-check.sh
  RUNNER_PUBLIC_URL=https://runner.example.com bash health-check.sh
  RUNNER_TOKEN='...' bash health-check.sh --run-job

옵션:
  --run-job       인증된 실제 수집 작업 1개를 실행합니다. 기본 작업은 gpu-fast-scan입니다.
  --job NAME      --run-job에서 실행할 작업명을 바꿉니다.
EOF
}

while (($# > 0)); do
  case "$1" in
    --run-job) RUN_JOB=true ;;
    --job)
      (($# >= 2)) || { usage >&2; exit 2; }
      JOB_NAME="$2"
      shift
      ;;
    -h|--help) usage; exit 0 ;;
    *) printf '알 수 없는 옵션: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

normalize_url() {
  printf '%s' "${1%/}"
}

check_health() {
  local label="$1"
  local base_url
  local payload
  base_url="$(normalize_url "$2")"
  printf '[health] %s %s/health\n' "$label" "$base_url"
  payload="$(curl --fail --silent --show-error --max-time "$TIMEOUT_SECONDS" \
    -H 'accept: application/json' "$base_url/health")" || {
    printf '[health] FAIL: %s health endpoint에 연결할 수 없습니다.\n' "$label" >&2
    return 1
  }

  if command -v jq >/dev/null 2>&1; then
    printf '%s\n' "$payload" | jq -e '
      .ok == true and
      .service == "used-market-aws-runner" and
      .search_index.enabled == true and
      ([.target_sites[]] | sort) == ["bunjang", "hellomarket", "joonggonara", "rethinkmall"]
    ' >/dev/null || {
      printf '[health] FAIL: %s 응답의 서비스명·대상 사이트가 예상과 다릅니다.\n' "$label" >&2
      printf '%s\n' "$payload" >&2
      return 1
    }
  else
    printf '%s\n' "$payload" | grep -q '"ok": true' || return 1
  fi
  printf '[health] OK: %s\n' "$label"
}

if command -v systemctl >/dev/null 2>&1; then
  systemctl is-active --quiet used-market-runner.service || {
    printf '[health] FAIL: used-market-runner.service가 active가 아닙니다.\n' >&2
    exit 1
  }
  if [[ -n "$PUBLIC_URL" ]]; then
    systemctl is-active --quiet used-market-tunnel.service || {
      printf '[health] FAIL: 공개 URL을 검사하는데 used-market-tunnel.service가 active가 아닙니다.\n' >&2
      exit 1
    }
  fi
fi

check_health local "$BASE_URL"

if [[ -n "$PUBLIC_URL" ]]; then
  check_health public "$PUBLIC_URL"
fi

if [[ "$RUN_JOB" == true ]]; then
  [[ -n "$RUNNER_TOKEN_INPUT" ]] || {
    printf '[health] FAIL: --run-job에는 RUNNER_TOKEN 환경변수가 필요합니다.\n' >&2
    exit 2
  }
  base_url="$(normalize_url "$BASE_URL")"
  idempotency_key="health-check-$(date -u +%Y%m%dT%H%M%SZ)-$$"
  request_body="$(jq -cn --arg job "$JOB_NAME" --arg key "$idempotency_key" '{job_name: $job, idempotency_key: $key}')"
  printf '[health] authenticated job=%s 실행\n' "$JOB_NAME"
  curl --fail --silent --show-error --max-time 120 \
    -X POST "$base_url/api/runner/run" \
    -H "authorization: Bearer ${RUNNER_TOKEN_INPUT}" \
    -H 'content-type: application/json' \
    -H "idempotency-key: ${idempotency_key}" \
    --data "$request_body" | jq . 2>/dev/null || {
      printf '[health] FAIL: authenticated runner job가 실패했습니다.\n' >&2
      exit 1
    }
fi

printf '[health] 전체 확인 완료\n'
