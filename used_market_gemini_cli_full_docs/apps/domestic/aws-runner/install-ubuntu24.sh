#!/usr/bin/env bash
set -Eeuo pipefail

# Ubuntu 24.04 기준 AWS 러너 설치 스크립트.
# 실행 위치의 프로젝트 루트에서 runner.mjs와 live-search.mjs를 복사하고
# Node, Chromium, cloudflared, systemd 유닛을 준비한다.

APP_ROOT="${APP_ROOT:-/opt/used-market-runner}"
RUNNER_USER="${RUNNER_USER:-usedrunner}"
TUNNEL_USER="${TUNNEL_USER:-cloudflared}"
RUNNER_ENV_DIR="${RUNNER_ENV_DIR:-/etc/used-market-runner}"
RUNNER_ENV_FILE="${RUNNER_ENV_FILE:-${RUNNER_ENV_DIR}/runner.env}"
TUNNEL_ENV_DIR="${TUNNEL_ENV_DIR:-/etc/cloudflared}"
TUNNEL_TOKEN_FILE="${TUNNEL_TOKEN_FILE:-${TUNNEL_ENV_DIR}/used-market-runner.token}"
PC_SOURCE_TARGETS_PER_RUN_OVERRIDE="${PC_SOURCE_TARGETS_PER_RUN_OVERRIDE:-}"
PC_SOURCE_TARGET_CONCURRENCY_OVERRIDE="${PC_SOURCE_TARGET_CONCURRENCY_OVERRIDE:-}"
# The first start may create a multi-GB recovery backup and migrate the ledger.
# Healthy releases return immediately; slow first starts must not be killed at 60s.
export RUNNER_HEALTH_WAIT_SECONDS="${RUNNER_HEALTH_WAIT_SECONDS:-7200}"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_ROOT="${1:-$(cd -- "${SCRIPT_DIR}/.." && pwd)}"

log() {
  printf '[aws-runner] %s\n' "$*"
}

fail() {
  printf '[aws-runner] ERROR: %s\n' "$*" >&2
  exit 1
}

on_error() {
  printf '[aws-runner] ERROR: installation failed near line %s\n' "$1" >&2
}

trap 'on_error "$LINENO"' ERR

if [[ "${EUID}" -ne 0 ]]; then
  fail 'root 권한으로 실행하세요: sudo bash aws-runner/install-ubuntu24.sh'
fi

if [[ ! -f "${SOURCE_ROOT}/aws-runner/runner.mjs" ]]; then
  fail "runner.mjs를 찾을 수 없습니다: ${SOURCE_ROOT}/aws-runner/runner.mjs"
fi

if [[ -n "$PC_SOURCE_TARGETS_PER_RUN_OVERRIDE" ]] && {
  [[ ! "$PC_SOURCE_TARGETS_PER_RUN_OVERRIDE" =~ ^[0-9]+$ ]] ||
  (( PC_SOURCE_TARGETS_PER_RUN_OVERRIDE < 100 || PC_SOURCE_TARGETS_PER_RUN_OVERRIDE > 128 ));
}; then
  fail 'PC_SOURCE_TARGETS_PER_RUN_OVERRIDE는 100~128 정수여야 합니다.'
fi
if [[ -n "$PC_SOURCE_TARGET_CONCURRENCY_OVERRIDE" ]] && {
  [[ ! "$PC_SOURCE_TARGET_CONCURRENCY_OVERRIDE" =~ ^[0-9]+$ ]] ||
  (( PC_SOURCE_TARGET_CONCURRENCY_OVERRIDE < 1 || PC_SOURCE_TARGET_CONCURRENCY_OVERRIDE > 8 ));
}; then
  fail 'PC_SOURCE_TARGET_CONCURRENCY_OVERRIDE는 1~8 정수여야 합니다.'
fi

for required_file in \
  live-search.mjs category-filter.mjs category-source-map.mjs target-sites.mjs \
  public-product-stats.mjs pc-directory-http.mjs pc-listings-contract.mjs; do
  if [[ ! -f "${SOURCE_ROOT}/cloudflare/${required_file}" ]]; then
    fail "runner.mjs가 import하는 파일이 없습니다: ${SOURCE_ROOT}/cloudflare/${required_file}. 프로젝트 루트 전체를 업로드하세요."
  fi
done

for required_file in \
  aws-runner/pc-collection-diagnostics.mjs \
  collector/logic/pc-source-registry.mjs \
  collector/logic/pc-source-adapters.mjs \
  collector/logic/danawa-search.mjs \
  collector/logic/pc-specialist-targets.mjs \
  market/logic/pc-parts-classifier.mjs \
  market/logic/pc-market-pools.mjs \
  market/logic/pc-search-query-variants.mjs \
  market/logic/pc-public-catalog.mjs \
  market/logic/pc-price-readiness.mjs \
  market/logic/pc-product-search.mjs \
  market/logic/pc-reviewed-listing-exclusions.mjs \
  market/logic/pc-parts-directory.mjs \
  market/data/pc-product-master-v1.mjs \
  market/data/pc-product-master-v2.mjs \
  market/data/browse-flows/index.mjs; do
  if [[ ! -f "${SOURCE_ROOT}/${required_file}" ]]; then
    fail "PC 원장 import 파일이 없습니다: ${SOURCE_ROOT}/${required_file}"
  fi
done

# The gate is outside the release tree and survives service restarts.
# Older runners must be stopped explicitly once; never overwrite their live code.
exec 9>/run/used-market-runner-install.lock
flock -n 9 || fail 'Another installer is active.'
LIVE_APP_ROOT="$(realpath -m -- "$APP_ROOT")"
[[ "$LIVE_APP_ROOT" != / && "$LIVE_APP_ROOT" != /opt && "$LIVE_APP_ROOT" != /var ]] || fail 'Unsafe APP_ROOT'
[[ ! -L "$APP_ROOT" ]] || fail 'Symlink APP_ROOT requires an explicit release migration.'
# The service sandbox and storage tools use these paths. Refuse a custom layout
# before stopping services instead of silently selecting a different database.
if [[ -f "$RUNNER_ENV_FILE" ]]; then
  for setting in RUNNER_INDEX_DIR=/var/lib/used-market-runner RUNNER_INDEX_PATH=/var/lib/used-market-runner/search-index.sqlite; do
    key="${setting%%=*}"; expected="${setting#*=}"
    configured="$(awk -F= -v key="$key" '$1 == key { sub(/\r$/, "", $2); print $2; exit }' "$RUNNER_ENV_FILE")"
    [[ -z "$configured" || "$configured" == "$expected" ]] || fail "Custom $key requires an explicit storage-path migration; existing data and services were not changed."
  done
fi
MAINTENANCE_FILE=/var/lib/used-market-runner/deployment-maintenance
[[ ! -e "$MAINTENANCE_FILE" ]] || fail 'A previous deployment gate is held; reconcile it before retrying.'
mkdir -p /var/lib/used-market-runner
install -m 0644 /dev/null "$MAINTENANCE_FILE"
GATE_HELD=true
RELEASE_SWITCHED=false
SERVICES_STOPPED=false
STAGE_ROOT=''
PREVIOUS_ROOT=''
finish_install() {
  local code=$?
  trap - EXIT
  if (( code != 0 )); then
    if [[ "$RELEASE_SWITCHED" == true && -n "$PREVIOUS_ROOT" ]]; then
      systemctl stop used-market-tunnel.service used-market-runner.service used-market-stats.service || true
      # Preserve the failed release for diagnosis; never copy the live database.
      failed_root="${LIVE_APP_ROOT}.failed.$(date +%s)"
      mv -- "$LIVE_APP_ROOT" "$failed_root"
      touch "$failed_root/.keep"
      mv -- "$PREVIOUS_ROOT" "$LIVE_APP_ROOT"
      printf '[aws-runner] Previous code restored. Maintenance remains held; verify services/configuration before releasing it.\n' >&2
    elif [[ "$SERVICES_STOPPED" == false && "$GATE_HELD" == true ]]; then
      rm -f -- "$MAINTENANCE_FILE"
    else
      printf '[aws-runner] Services remain stopped and maintenance is held. Resolve the failure and verify the selected release before resuming.\n' >&2
    fi
  fi
  if [[ -n "$STAGE_ROOT" && -d "$STAGE_ROOT" ]]; then rm -rf -- "$STAGE_ROOT"; fi
  exit "$code"
}
trap finish_install EXIT
RUNNER_WAS_ACTIVE=false
if systemctl is-active --quiet used-market-runner.service; then
  RUNNER_WAS_ACTIVE=true
  curl --fail --silent --max-time 10 http://127.0.0.1:8787/health \
    | jq -e '.maintenance == true and .draining == false and (.pc_parts.publication_job.status != "queued") and (.pc_parts.publication_job.status != "running") and (.pc_parts.publication_job.status != "interrupted")' >/dev/null \
    || fail 'Runner is busy or predates the drain gate. Defer deployment; older runners require an explicit idle shutdown first.'
fi
if [[ -S /run/used-market-stats/publisher.sock ]]; then
  curl --fail --silent --max-time 5 --unix-socket /run/used-market-stats/publisher.sock http://localhost/status \
    | jq -e '.active == false and .verification_active == false' >/dev/null \
    || fail 'Statistics or verification is active; defer deployment.'
fi
# Stop all admission paths before changing packages or installed files.
for service in used-market-tunnel.service used-market-runner.service used-market-stats.service; do
  if systemctl cat "$service" >/dev/null 2>&1; then systemctl stop "$service"; fi
done
SERVICES_STOPPED=true

validate_release() {
node --check "$APP_ROOT/aws-runner/runner.mjs"
node --check "$APP_ROOT/aws-runner/pc-collection-diagnostics.mjs"
node --check "$APP_ROOT/aws-runner/lifecycle-status-cache.mjs"
node --check "$APP_ROOT/aws-runner/lifecycle-queue.mjs"
node --check "$APP_ROOT/aws-runner/publish-pc-stats-runner.mjs"
node --check "$APP_ROOT/aws-runner/isolated-stats-publisher.mjs"
node --check "$APP_ROOT/aws-runner/stats-service.mjs"
node --check "$APP_ROOT/aws-runner/verify-pc-stats-runner.mjs"
node --check "$APP_ROOT/aws-runner/publication-job-state.mjs"
node --check "$APP_ROOT/aws-runner/reconcile-publication.mjs"
node --check "$APP_ROOT/aws-runner/pc-publication-maintenance.mjs"
node --check "$APP_ROOT/aws-runner/stream-stats-checksum.mjs"
node --check "$APP_ROOT/aws-runner/pc-stats-publication-client.mjs"
node --check "$APP_ROOT/aws-runner/search-index.mjs"
node --check "$APP_ROOT/aws-runner/backup-storage-policy.mjs"
node "$APP_ROOT/aws-runner/backup-storage-policy.mjs"
node --check "$APP_ROOT/aws-runner/migration-smoke.mjs"
migration_smoke_dir="$(mktemp -d)"
node "$APP_ROOT/aws-runner/migration-smoke.mjs" "$migration_smoke_dir/search-index.sqlite"
rm -rf -- "$migration_smoke_dir"
node --check "$APP_ROOT/aws-runner/pc-parts-ledger.mjs"
node --check "$APP_ROOT/aws-runner/pc-shadow-pipeline.mjs"
node --check "$APP_ROOT/aws-runner/compact-pc-storage.mjs"
node --check "$APP_ROOT/aws-runner/backfill-legacy-inactive.mjs"
node --check "$APP_ROOT/collector/logic/pc-source-registry.mjs"
node --check "$APP_ROOT/collector/logic/pc-source-adapters.mjs"
node --check "$APP_ROOT/collector/logic/danawa-search.mjs"
node --check "$APP_ROOT/market/logic/pc-market-pools.mjs"
node --check "$APP_ROOT/collector/logic/pc-specialist-targets.mjs"
node --check "$APP_ROOT/market/logic/pc-parts-classifier.mjs"
node --check "$APP_ROOT/market/logic/pc-search-query-variants.mjs"
node --check "$APP_ROOT/market/logic/pc-public-catalog.mjs"
node --check "$APP_ROOT/market/logic/pc-price-readiness.mjs"
node --check "$APP_ROOT/market/logic/pc-product-search.mjs"
node --check "$APP_ROOT/aws-runner/pc-stored-price-publication.mjs"
node --check "$APP_ROOT/aws-runner/pc-publication-scopes.mjs"
node --check "$APP_ROOT/aws-runner/collect-pc-release-sample.mjs"
node --check "$APP_ROOT/market/logic/pc-reviewed-listing-exclusions.mjs"
node --check "$APP_ROOT/market/logic/pc-parts-directory.mjs"
node --check "$APP_ROOT/market/logic/listing-lifecycle.mjs"
for browse_flow_file in "$APP_ROOT"/market/data/browse-flows/*.mjs; do
  node --check "$browse_flow_file"
done
node --check "$APP_ROOT/cloudflare/live-search.mjs"
node --check "$APP_ROOT/cloudflare/category-filter.mjs"
node --check "$APP_ROOT/cloudflare/category-source-map.mjs"
node --check "$APP_ROOT/cloudflare/target-sites.mjs"

}

export DEBIAN_FRONTEND=noninteractive
log '기본 패키지 설치'
apt-get update
apt-get install -y ca-certificates curl gnupg jq software-properties-common python3

node_major=0
if command -v node >/dev/null 2>&1; then
  node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || printf '0')"
fi

if (( node_major < 22 )); then
  log 'Node.js 22 설치'
  node_setup_file="$(mktemp)"
  curl --fail --silent --show-error --location https://deb.nodesource.com/setup_22.x -o "$node_setup_file"
  bash "$node_setup_file"
  rm -f -- "$node_setup_file"
  trap 'on_error "$LINENO"' ERR
  apt-get install -y nodejs
fi

command -v node >/dev/null 2>&1 || fail 'Node.js 설치 후 node 명령을 찾지 못했습니다.'

install_chromium() {
  local package_name=''
  local candidate
  for candidate in chromium chromium-browser; do
    if apt-cache policy "$candidate" | grep -qE 'Candidate: [^ (]'; then
      package_name="$candidate"
      break
    fi
  done

  if [[ -n "$package_name" ]]; then
    apt-get install -y "$package_name"
    return
  fi

  log 'APT Chromium 패키지가 없어 snap Chromium을 설치합니다.'
  apt-get install -y snapd
  systemctl enable --now snapd.socket
  snap install chromium
}

if ! command -v chromium >/dev/null 2>&1 && ! command -v chromium-browser >/dev/null 2>&1 && [[ ! -x /snap/bin/chromium ]]; then
  log 'Chromium 설치'
  install_chromium
fi

CHROMIUM_PATH="${CHROMIUM_PATH:-}"
if [[ -z "$CHROMIUM_PATH" ]]; then
  for candidate in chromium chromium-browser /snap/bin/chromium; do
    if command -v "$candidate" >/dev/null 2>&1 || [[ -x "$candidate" ]]; then
      CHROMIUM_PATH="$(command -v "$candidate" 2>/dev/null || printf '%s' "$candidate")"
      break
    fi
  done
fi
[[ -n "$CHROMIUM_PATH" ]] || fail 'Chromium 실행 파일을 찾지 못했습니다.'

if ! command -v cloudflared >/dev/null 2>&1; then
  log 'cloudflared 설치'
  cloudflared_arch="$(dpkg --print-architecture)"
  case "$cloudflared_arch" in
    amd64) cloudflared_asset='cloudflared-linux-amd64.deb' ;;
    arm64) cloudflared_asset='cloudflared-linux-arm64.deb' ;;
    *) fail "지원하지 않는 Debian 아키텍처입니다: ${cloudflared_arch}" ;;
  esac
  cloudflared_deb="$(mktemp --suffix=.deb)"
  curl --fail --silent --show-error --location \
    "https://github.com/cloudflare/cloudflared/releases/latest/download/${cloudflared_asset}" \
    -o "$cloudflared_deb"
  apt-get install -y "$cloudflared_deb"
  rm -f -- "$cloudflared_deb"
fi

command -v cloudflared >/dev/null 2>&1 || fail 'cloudflared 설치 후 명령을 찾지 못했습니다.'

if ! id -u "$RUNNER_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$APP_ROOT" --create-home --shell /usr/sbin/nologin "$RUNNER_USER"
fi

if ! id -u "$TUNNEL_USER" >/dev/null 2>&1; then
  useradd --system --no-create-home --shell /usr/sbin/nologin "$TUNNEL_USER"
fi

STAGE_ROOT="$(mktemp -d "${LIVE_APP_ROOT}.staging.XXXXXX")"
APP_ROOT="$STAGE_ROOT"
log "애플리케이션 파일 검증용 준비: ${APP_ROOT}"
install -d -o root -g root -m 0755 "$APP_ROOT"
install -d -o root -g root -m 0755 \
  "$APP_ROOT/aws-runner" "$APP_ROOT/cloudflare" \
  "$APP_ROOT/collector/logic" "$APP_ROOT/market/logic" "$APP_ROOT/market/data" \
  "$APP_ROOT/market/data/browse-flows"

if [[ "$SOURCE_ROOT" != "$APP_ROOT" ]]; then
  cp -a "$SOURCE_ROOT/aws-runner/." "$APP_ROOT/aws-runner/"
  for required_file in \
    live-search.mjs category-filter.mjs category-source-map.mjs target-sites.mjs \
    public-product-stats.mjs pc-directory-http.mjs pc-listings-contract.mjs; do
    install -m 0644 "$SOURCE_ROOT/cloudflare/${required_file}" "$APP_ROOT/cloudflare/${required_file}"
  done
  install -m 0644 "$SOURCE_ROOT/collector/logic/pc-source-registry.mjs" "$APP_ROOT/collector/logic/pc-source-registry.mjs"
  install -m 0644 "$SOURCE_ROOT/collector/logic/pc-source-adapters.mjs" "$APP_ROOT/collector/logic/pc-source-adapters.mjs"
  install -m 0644 "$SOURCE_ROOT/collector/logic/danawa-search.mjs" "$APP_ROOT/collector/logic/danawa-search.mjs"
  install -m 0644 "$SOURCE_ROOT/collector/logic/pc-specialist-targets.mjs" "$APP_ROOT/collector/logic/pc-specialist-targets.mjs"
  install -m 0644 "$SOURCE_ROOT/market/logic/pc-parts-classifier.mjs" "$APP_ROOT/market/logic/pc-parts-classifier.mjs"
  install -m 0644 "$SOURCE_ROOT/market/logic/pc-market-pools.mjs" "$APP_ROOT/market/logic/pc-market-pools.mjs"
  install -m 0644 "$SOURCE_ROOT/market/logic/pc-search-query-variants.mjs" "$APP_ROOT/market/logic/pc-search-query-variants.mjs"
  install -m 0644 "$SOURCE_ROOT/market/logic/pc-public-catalog.mjs" "$APP_ROOT/market/logic/pc-public-catalog.mjs"
  install -m 0644 "$SOURCE_ROOT/market/logic/pc-price-readiness.mjs" "$APP_ROOT/market/logic/pc-price-readiness.mjs"
  install -m 0644 "$SOURCE_ROOT/market/logic/pc-product-search.mjs" "$APP_ROOT/market/logic/pc-product-search.mjs"
  install -m 0644 "$SOURCE_ROOT/market/logic/pc-reviewed-listing-exclusions.mjs" "$APP_ROOT/market/logic/pc-reviewed-listing-exclusions.mjs"
  install -m 0644 "$SOURCE_ROOT/market/logic/pc-parts-directory.mjs" "$APP_ROOT/market/logic/pc-parts-directory.mjs"
  install -m 0644 "$SOURCE_ROOT/market/logic/listing-lifecycle.mjs" "$APP_ROOT/market/logic/listing-lifecycle.mjs"
  install -m 0644 "$SOURCE_ROOT/market/logic/bunjang-lifecycle.mjs" "$APP_ROOT/market/logic/bunjang-lifecycle.mjs"
  install -m 0644 "$SOURCE_ROOT/market/data/pc-product-master-v1.mjs" "$APP_ROOT/market/data/pc-product-master-v1.mjs"
  install -m 0644 "$SOURCE_ROOT/market/data/pc-product-master-v2.mjs" "$APP_ROOT/market/data/pc-product-master-v2.mjs"
  cp -a "$SOURCE_ROOT/market/data/browse-flows/." "$APP_ROOT/market/data/browse-flows/"
fi

chown -R root:root "$APP_ROOT/aws-runner" "$APP_ROOT/cloudflare" "$APP_ROOT/collector" "$APP_ROOT/market"
find "$APP_ROOT/aws-runner" "$APP_ROOT/cloudflare" "$APP_ROOT/collector" "$APP_ROOT/market" -type d -exec chmod 0755 {} +
find "$APP_ROOT/aws-runner" "$APP_ROOT/cloudflare" "$APP_ROOT/collector" "$APP_ROOT/market" -type f -exec chmod 0644 {} +
chmod 0755 "$APP_ROOT/aws-runner"/*.sh

validate_release
# A content marker binds health to this release, including uncommitted changes.
release_id="$(find "$APP_ROOT" -type f -print0 | sort -z | xargs -0 sha256sum | sed "s|$APP_ROOT/||" | sha256sum | cut -d ' ' -f1)"
printf '%s\n' "$release_id" > "$APP_ROOT/release-id"
if [[ -e "$LIVE_APP_ROOT" ]]; then
  PREVIOUS_ROOT="${LIVE_APP_ROOT}.previous.$(date +%s)"
  [[ ! -e "$PREVIOUS_ROOT" ]] || fail 'Recovery release path already exists.'
  mv -- "$LIVE_APP_ROOT" "$PREVIOUS_ROOT"
  touch "$PREVIOUS_ROOT/.used-market-release-backup"
fi
if ! mv -- "$STAGE_ROOT" "$LIVE_APP_ROOT"; then
  [[ -z "$PREVIOUS_ROOT" ]] || mv -- "$PREVIOUS_ROOT" "$LIVE_APP_ROOT"
  fail 'Release activation failed; previous files restored.'
fi
STAGE_ROOT=''
RELEASE_SWITCHED=true
APP_ROOT="$LIVE_APP_ROOT"

log '환경변수·토큰 디렉터리 준비'
install -d -o root -g "$RUNNER_USER" -m 0750 "$RUNNER_ENV_DIR"
install -d -o root -g "$TUNNEL_USER" -m 0750 "$TUNNEL_ENV_DIR"

if [[ ! -f "$RUNNER_ENV_FILE" ]]; then
  cat > "$RUNNER_ENV_FILE" <<EOF
RUNNER_PORT=8787
CLOUDFLARE_RUNNER_TOKEN=
EBAY_CLIENT_ID=
EBAY_CLIENT_SECRET=
RUNNER_SEARCH_CACHE_TTL_MS=300000
RUNNER_INDEX_ENABLED=true
RUNNER_INDEX_MODE=shadow
RUNNER_INDEX_DIR=/var/lib/used-market-runner
RUNNER_INDEX_PATH=/var/lib/used-market-runner/search-index.sqlite
PC_PARTS_SHADOW_WRITE_ENABLED=true
PC_PARTS_SCHEDULER_ENABLED=false
PC_SOURCE_TARGETS_PER_RUN=100
PC_SOURCE_TARGET_CONCURRENCY=6
PC_HELLOMARKET_DETAIL_LIMIT=40
PC_SOURCE_GOVERNANCE_JSON={}
PC_SPECIALIST_SEARCH_URLS_JSON={}
RUNNER_PUBLIC_URL=
D1_IMPORT_URL=
D1_BACKGROUND_MIRROR_ENABLED=false
D1_STATS_IMPORT_URL=
CLOUDFLARE_MANUAL_RUN_TOKEN=
CHROMIUM_PATH=${CHROMIUM_PATH}
NODE_OPTIONS=--max-old-space-size=2048
EOF
fi

set_env_value() {
  local key="$1"
  local value="$2"
  local temp_file
  temp_file="$(mktemp)"
  awk -F= -v wanted="$key" -v replacement="$value" '
    BEGIN { found = 0 }
    { sub(/\r$/, "") }
    $1 == wanted { print wanted "=" replacement; found = 1; next }
    { print }
    END { if (!found) print wanted "=" replacement }
  ' "$RUNNER_ENV_FILE" > "$temp_file"
  install -o root -g "$RUNNER_USER" -m 0640 "$temp_file" "$RUNNER_ENV_FILE"
  rm -f -- "$temp_file"
}

# 비밀값은 그대로 두고 검색 색인 운영값을 맞추되, 명시된 수집 처리량은 보존한다.
set_env_value RUNNER_SEARCH_CACHE_TTL_MS 300000
set_env_value RUNNER_INDEX_ENABLED true
if ! grep -q '^RUNNER_INDEX_MODE=' "$RUNNER_ENV_FILE"; then
  set_env_value RUNNER_INDEX_MODE shadow
fi
set_env_value RUNNER_INDEX_DIR /var/lib/used-market-runner
set_env_value RUNNER_INDEX_PATH /var/lib/used-market-runner/search-index.sqlite
set_env_value PC_PARTS_SHADOW_WRITE_ENABLED true
if ! grep -q '^PC_PARTS_SCHEDULER_ENABLED=' "$RUNNER_ENV_FILE"; then
  set_env_value PC_PARTS_SCHEDULER_ENABLED false
fi
if [[ -n "$PC_SOURCE_TARGETS_PER_RUN_OVERRIDE" ]]; then
  set_env_value PC_SOURCE_TARGETS_PER_RUN "$PC_SOURCE_TARGETS_PER_RUN_OVERRIDE"
elif ! grep -q '^PC_SOURCE_TARGETS_PER_RUN=' "$RUNNER_ENV_FILE"; then
  set_env_value PC_SOURCE_TARGETS_PER_RUN 100
fi
if [[ -n "$PC_SOURCE_TARGET_CONCURRENCY_OVERRIDE" ]]; then
  set_env_value PC_SOURCE_TARGET_CONCURRENCY "$PC_SOURCE_TARGET_CONCURRENCY_OVERRIDE"
elif ! grep -q '^PC_SOURCE_TARGET_CONCURRENCY=' "$RUNNER_ENV_FILE"; then
  set_env_value PC_SOURCE_TARGET_CONCURRENCY 6
fi
if ! grep -q '^PC_HELLOMARKET_DETAIL_LIMIT=' "$RUNNER_ENV_FILE"; then
  set_env_value PC_HELLOMARKET_DETAIL_LIMIT 40
fi
if ! grep -q '^PC_SOURCE_GOVERNANCE_JSON=' "$RUNNER_ENV_FILE"; then
  set_env_value PC_SOURCE_GOVERNANCE_JSON '{}'
fi
if ! grep -q '^PC_SPECIALIST_SEARCH_URLS_JSON=' "$RUNNER_ENV_FILE"; then
  set_env_value PC_SPECIALIST_SEARCH_URLS_JSON '{}'
fi
if ! grep -q '^D1_BACKGROUND_MIRROR_ENABLED=' "$RUNNER_ENV_FILE"; then
  set_env_value D1_BACKGROUND_MIRROR_ENABLED false
fi
set_env_value NODE_OPTIONS --max-old-space-size=2048

configured_pc_source_targets_per_run="$(awk -F= '$1 == "PC_SOURCE_TARGETS_PER_RUN" { sub(/\r$/, "", $2); print $2; exit }' "$RUNNER_ENV_FILE")"
if [[ ! "$configured_pc_source_targets_per_run" =~ ^[0-9]+$ ]] ||
  (( configured_pc_source_targets_per_run < 100 || configured_pc_source_targets_per_run > 128 )); then
  fail '기존 PC_SOURCE_TARGETS_PER_RUN이 현재 전체 target set을 감당하지 못합니다. 명시적으로 PC_SOURCE_TARGETS_PER_RUN_OVERRIDE=100을 지정해 다시 설치하세요.'
fi

chown root:"$RUNNER_USER" "$RUNNER_ENV_FILE"
chmod 0640 "$RUNNER_ENV_FILE"

log 'systemd 유닛 설치'
service_tmp="$(mktemp)"
sed \
  -e "s|__APP_ROOT__|${APP_ROOT//|/\\|}|g" \
  -e "s|__RUNNER_USER__|${RUNNER_USER}|g" \
  -e "s|__RUNNER_ENV_FILE__|${RUNNER_ENV_FILE//|/\\|}|g" \
  "$APP_ROOT/aws-runner/used-market-runner.service" > "$service_tmp"
install -o root -g root -m 0644 "$service_tmp" /etc/systemd/system/used-market-runner.service
rm -f -- "$service_tmp"

stats_tmp="$(mktemp)"
sed -e "s|__APP_ROOT__|${APP_ROOT//|/\\|}|g" \
  -e "s|__RUNNER_USER__|${RUNNER_USER}|g" \
  -e "s|__RUNNER_ENV_FILE__|${RUNNER_ENV_FILE//|/\\|}|g" \
  "$APP_ROOT/aws-runner/used-market-stats.service" > "$stats_tmp"
install -o root -g root -m 0644 "$stats_tmp" /etc/systemd/system/used-market-stats.service
rm -f -- "$stats_tmp"
bash "$APP_ROOT/aws-runner/install-memory-budget.sh"

tunnel_tmp="$(mktemp)"
sed \
  -e "s|__TUNNEL_USER__|${TUNNEL_USER}|g" \
  -e "s|__TUNNEL_TOKEN_FILE__|${TUNNEL_TOKEN_FILE//|/\\|}|g" \
  "$APP_ROOT/aws-runner/used-market-tunnel.service" > "$tunnel_tmp"
install -o root -g root -m 0644 "$tunnel_tmp" /etc/systemd/system/used-market-tunnel.service
rm -f -- "$tunnel_tmp"


systemctl daemon-reload
systemctl enable used-market-runner.service
systemctl enable used-market-stats.service
systemctl restart used-market-stats.service
bash "$APP_ROOT/aws-runner/install-backup-storage.sh" "$APP_ROOT"

if [[ -s "$TUNNEL_TOKEN_FILE" ]]; then
  configured_public_url="${RUNNER_PUBLIC_URL:-$(awk -F= '$1 == "RUNNER_PUBLIC_URL" { sub(/^[^=]*=/, ""); print; exit }' "$RUNNER_ENV_FILE")}"
  configured_public_url="${configured_public_url%/}"
  [[ "$configured_public_url" =~ ^https://[^/]+$ ]] || fail \
    '기존 Tunnel 배포에는 RUNNER_PUBLIC_URL이 필요합니다. configure-ubuntu24.sh로 저장하거나 실행 환경에 지정하세요.'
  set_env_value RUNNER_PUBLIC_URL "$configured_public_url"
  systemctl enable used-market-tunnel.service
  systemctl restart used-market-runner.service
  systemctl restart used-market-tunnel.service
  RUNNER_PUBLIC_URL="$configured_public_url" RUNNER_EXPECTED_RELEASE_ID="$release_id" \
    bash "$APP_ROOT/aws-runner/health-check.sh" --require-public
  log '반복 배포: runner → tunnel 순서로 재시작하고 로컬·외부 health를 확인했습니다.'
elif [[ "$RUNNER_WAS_ACTIVE" == true ]] || grep -Eq '^(CLOUDFLARE_RUNNER_TOKEN|RUNNER_TOKEN)=.+' "$RUNNER_ENV_FILE"; then
  systemctl restart used-market-runner.service
  curl --fail --silent --show-error --retry 10 --retry-connrefused --retry-delay 2 --max-time 10 http://127.0.0.1:8787/health \
    | jq -e --arg release "$release_id" '.ok == true and .pc_parts.ledger_ready == true and .release_id == $release and .maintenance == true' >/dev/null \
    || fail 'Local Runner release verification failed.'
fi

while IFS= read -r -d '' old_release; do
  if [[ "$old_release" != "$PREVIOUS_ROOT" && -f "$old_release/.used-market-release-backup" && ! -e "$old_release/.keep" ]]; then
    rm -rf -- "$old_release" || printf '[aws-runner] Cleanup deferred: %s\n' "$old_release" >&2
  fi
done < <(find "$(dirname -- "$LIVE_APP_ROOT")" -maxdepth 1 -type d -name "$(basename -- "$LIVE_APP_ROOT").previous.*" -mtime +7 -print0)
rm -f -- "$MAINTENANCE_FILE"
GATE_HELD=false
RELEASE_SWITCHED=false
log '설치 완료'
if [[ -n "$PREVIOUS_ROOT" ]]; then
  printf 'Previous code retained at %s (remove after verified recovery window, at most 7 days).\n' "$PREVIOUS_ROOT"
fi
printf '\n다음 단계:\n'
printf '  1) sudo bash %s/aws-runner/configure-ubuntu24.sh\n' "$APP_ROOT"
printf '  2) bash %s/aws-runner/health-check.sh\n' "$APP_ROOT"
if [[ ! -s "$TUNNEL_TOKEN_FILE" ]]; then
  printf '\n초기 설치에서는 runner만 enable합니다. configure-ubuntu24.sh가 Tunnel 설정·시작·외부 검증을 완료합니다.\n'
fi
