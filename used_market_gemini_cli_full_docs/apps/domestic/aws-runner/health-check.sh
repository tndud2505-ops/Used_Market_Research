#!/usr/bin/env bash
set -Eeuo pipefail

BASE_URL="${RUNNER_BASE_URL:-http://127.0.0.1:8787}"
PUBLIC_URL="${RUNNER_PUBLIC_URL:-}"
TIMEOUT_SECONDS="${RUNNER_HEALTH_TIMEOUT_SECONDS:-15}"
WAIT_SECONDS="${RUNNER_HEALTH_WAIT_SECONDS:-60}"
RUN_JOB=false
REQUIRE_PUBLIC=false
JOB_NAME="${RUNNER_HEALTH_JOB:-gpu-fast-scan}"
RUNNER_TOKEN_INPUT="${RUNNER_TOKEN:-}"
LOCAL_INSTANCE_ID=''

usage() {
  cat <<'EOF'
사용법:
  bash health-check.sh
  RUNNER_PUBLIC_URL=https://runner.example.com bash health-check.sh
  RUNNER_PUBLIC_URL=https://runner.example.com bash health-check.sh --require-public
  RUNNER_TOKEN='...' bash health-check.sh --run-job

옵션:
  --run-job       인증된 실제 수집 작업 1개를 실행합니다. 기본 작업은 gpu-fast-scan입니다.
  --job NAME      --run-job에서 실행할 작업명을 바꿉니다.
  --require-public  공개 URL과 로컬 URL이 같은 새 Runner 인스턴스를 가리키는지 필수 검사합니다.
EOF
}

while (($# > 0)); do
  case "$1" in
    --run-job) RUN_JOB=true ;;
    --require-public) REQUIRE_PUBLIC=true ;;
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

if [[ "$REQUIRE_PUBLIC" == true && -z "$PUBLIC_URL" ]]; then
  printf '[health] FAIL: --require-public에는 RUNNER_PUBLIC_URL이 필요합니다.\n' >&2
  exit 2
fi

normalize_url() {
  printf '%s' "${1%/}"
}

check_health() {
  local label="$1"
  local base_url
  local payload
  local deadline
  local instance_id=''
  base_url="$(normalize_url "$2")"
  printf '[health] %s %s/health\n' "$label" "$base_url"
  deadline=$((SECONDS + WAIT_SECONDS))
  while ! payload="$(curl --fail --silent --show-error --max-time "$TIMEOUT_SECONDS" \
    -H 'accept: application/json' "$base_url/health" 2>/dev/null)"; do
    if (( SECONDS >= deadline )); then
      printf '[health] FAIL: %s health endpoint가 %s초 안에 준비되지 않았습니다.\n' "$label" "$WAIT_SECONDS" >&2
      return 1
    fi
    sleep 2
  done

  if command -v jq >/dev/null 2>&1; then
    printf '%s\n' "$payload" | jq -e '
      .ok == true and
      .service == "used-market-aws-runner" and
      .search_index.enabled == true and
      (.search_index.process_instance.id | type == "string" and length > 0) and
      (.target_sites | type == "array" and length > 0) and
      .pc_parts.ledger_ready == true and
      (.pc_parts.collection_targets.target_set_version | type == "string" and length > 0) and
      (.pc_parts.collection_targets.target_checksum | type == "string" and length > 0) and
      (.pc_parts.collection_targets.declared_target_count > 0) and
      (.pc_parts.collection_targets.enabled_target_count > 0) and
      (.pc_parts.collection_targets.enabled_target_count <= .pc_parts.collection_targets.declared_target_count) and
      .pc_parts.collection_targets.monitor_target_count == 0 and
      (.pc_parts.required_source_keys | type == "array" and length > 0) and
      (.pc_parts.source_readiness | type == "array") and
      (.pc_parts.review_required_active_sources | length) == 0
    ' >/dev/null || {
      printf '[health] FAIL: %s 응답의 서비스·대상 사이트·PC 수집 대상 세트가 예상과 다릅니다.\n' "$label" >&2
      printf '%s\n' "$payload" >&2
      return 1
    }
    instance_id="$(printf '%s\n' "$payload" | jq -er '.search_index.process_instance.id')"
    if [[ "$label" == local ]]; then
      LOCAL_INSTANCE_ID="$instance_id"
    elif [[ -n "$LOCAL_INSTANCE_ID" && "$instance_id" != "$LOCAL_INSTANCE_ID" ]]; then
      printf '[health] FAIL: 공개 Tunnel이 방금 시작한 로컬 Runner 인스턴스를 가리키지 않습니다.\n' >&2
      return 1
    fi
  else
    printf '%s\n' "$payload" | grep -q '"ok": true' || return 1
  fi
  printf '[health] OK: %s\n' "$label"
}

if command -v systemctl >/dev/null 2>&1; then
  for service in used-market-runner.service used-market-tunnel.service; do
    systemctl is-enabled --quiet "$service" || {
      printf '[health] FAIL: %s가 enable 상태가 아닙니다.\n' "$service" >&2
      exit 1
    }
    systemctl is-active --quiet "$service" || {
      printf '[health] FAIL: %s가 active 상태가 아닙니다.\n' "$service" >&2
      exit 1
    }
  done
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
