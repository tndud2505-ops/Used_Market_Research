# AWS Ubuntu 러너 운영

## Price publication verification (2026-09-24)

Collection, classification, and daily price calculations remain on AWS. The
Worker retains public API routing, authentication, caching, the daily trigger,
and D1 fallback. Publication uploads use four-row chunks; identity bootstrap
uses 100-scope pages. These are search/statistics scopes, not unique listings.

Before activation, the Worker calls the configured Runner's authenticated
`/api/runner/verify-stats-publication` endpoint. AWS reads the staged D1 rows
back through the authenticated `/admin/product-stats-readback` endpoint in
four-row pages, then checks versions, traceability, per-chunk manifests and the
complete canonical row checksum. The caller cannot submit a skip-verification
flag. The Worker only accepts the matching AWS verdict and performs the
predecessor/count guard and pointer swap in one D1 transaction. A failed check
preserves the current publication. No new secret or paid Workers plan is needed.

Deploy the Worker readback routes and then the Runner through the normal
installer, before starting a publication. Do not run publication during this
brief mixed-version window. `pc_stats_readback_verified` logs the AWS verifier
receipt; publisher output records elapsed and process CPU milliseconds. The
verifier's process CPU measure can include concurrent Runner work.

운영 결정·수집 주기·실패 단계별 대응은 [게시 운영 위키](../docs/wiki/09-price-publication-operations.md), 당시 배포 ID·CPU 실측·남은 문제는 [2026-09-24 기록](../docs/worklog/2026-09-24-aws-publication-verification.md)에 보존한다.

## Bunjang lifecycle tracking (2026-09-14)

The scheduled Bunjang collection rechecks stored listing URLs through the same
public `/api/pms/v1/products/{pid}/detail/web` endpoint used by Bunjang's web app.
Product identity must match; `SOLD_OUT` is sold, `DELETED` is deleted, and hidden
or inaccessible products are not counted as sales. Bunjang numeric status `2`
means deleted and `3` means sold.

Each source run checks up to 1,500 Bunjang listings, with 200 ms pacing and an
eight-minute budget. Listings last checked at least six hours ago are eligible;
this does not guarantee a six-hour refresh for every listing. A generic access
block or rate limit stops the batch. The authenticated `/api/runner/run` job
`bunjang-lifecycle-recheck` invokes the same path for an operator-requested run.
It shares the scheduler lock and refuses disabled or unapproved sources.

The existing daily compaction policy is unchanged: keep each listing's latest
snapshot and archive older detail into aggregates. A later sold observation uses
the last retained asking price, not a confirmed transaction price. eBay remains
in active-price collection but is excluded from sold-price statistics and HTML
lifecycle rechecks. Statistics become public through the normal stats publication.

이 디렉터리는 현재 `runner.mjs`를 AWS Ubuntu 24.04에서 실행하기 위한 설치·환경·systemd·Cloudflare Tunnel·헬스체크 파일만 담는다.

PC 디렉터리의 승인된 운영 대상은 다음 4곳이다. 범용 검색은 다나와를 제외한 3곳을 사용한다.

- 번개장터: `bunjang`
- 중고나라: `joonggonara`
- 다나와 중고 가격비교: `danawa` (공개 통합검색 HTML, 중고 상품만)
- eBay: `ebay` (공식 Browse API)

중고나라와 번개장터는 매시간 11개 부품군 검색과 하루 단위 전체 제품 master 순회를 수행한다. eBay는 공식 Browse API로 부품군 검색과 정확 모델 순회를 수행하며 해외 중고 시장군으로 분리한다. 분류와 `market_pool` 분리가 끝난 projection만 공개한다. 비활성 소스는 스케줄 이벤트·수집 대상·공개 사이트 목록에서 제외된다. 개별 운영 소스가 HTTP 차단이나 응답 변경으로 실패하면 우회하지 않고 해당 source만 격리하며 다른 source와 이전 publication은 유지한다.

공개 PC 화면은 저장된 catalog·listing·stats를 조회하며 페이지 요청 중 원 사이트를 호출하지 않는다. 동일 제품·시장군·상태·통화 조건으로 조회하되 매물 freshness와 일일 통계 publication/as_of는 따로 확인한다. RESERVED·SOLD 표시가격은 실제 체결가가 아니며, 출처가 구조적으로 제공한 확인 체결금액만 별도 통계로 표시한다.

`runner.mjs`는 위 사이트를 사이트별 동시성 제한 안에서 병렬 수집한다. 서로 다른 검색은 최대 4개가 동시에 실행되고 16개까지 대기하며, 한 검색의 소스 작업은 최대 16개다. AWS 로컬 SQLite가 주 검색 색인이고 D1에는 변경된 최근 핵심 매물만 백업한다.

rollback용 legacy `/api/search`의 첫 검색은 사이트별 최대 160개 후보를 확인한 뒤 품질 필터 후 사이트마다 최대 160개, 전체 최대 640개를 SQLite에 보존한다. 번호 페이지는 우리 서버의 같은 스냅샷에서 30개씩 조회하므로 원 사이트를 다시 호출하지 않는다. 저장 결과의 마지막에서만 사용자가 `다음 매물 더 찾기`를 눌러 사이트별 수집 창을 160→320→480→640개로 확장하며, 전체 스냅샷 상한은 1,000개다. 가격·정렬 변경은 커서를 초기화하고 원 사이트가 아니라 SQLite의 새 1페이지를 조회한다.

## 구조

```text
Cloudflare Worker Cron / 수동 실행
          │ HTTPS POST + Bearer token
          ▼
Cloudflare Tunnel 공개 호스트명
          ▼ outbound 연결
AWS Ubuntu
  ├─ used-market-runner.service : 127.0.0.1:8787
  └─ used-market-tunnel.service  : cloudflared → localhost:8787
```

사용자는 기존 사이트 주소를 사용한다. Worker의 러너 URL만 Tunnel 공개 호스트명으로 바꾼다.

중요: `runner.mjs`는 `../cloudflare/live-search.mjs`를 import한다. 따라서 AWS로 올릴 때 `aws-runner/` 폴더만 따로 올리지 말고 프로젝트 루트 전체를 올리거나, 설치 스크립트의 첫 번째 인자로 프로젝트 루트를 지정한다.

## 1. Cloudflare Tunnel 준비

Cloudflare Dashboard에서 다음을 만든다.

1. Zero Trust → Networks → Tunnels → Create Tunnel
2. AWS 서버용 Linux 환경을 선택하고 토큰을 복사한다.
3. Public Hostname을 추가한다. 예: `runner.example.com`
4. Service를 `http://127.0.0.1:8787`로 지정한다.
5. Tunnel 토큰은 설치 후 `configure-ubuntu24.sh`가 묻는 입력란에 붙여넣는다.

Cloudflare 공식 안내: [Tunnel setup](https://developers.cloudflare.com/tunnel/setup/), [AWS 배포 가이드](https://developers.cloudflare.com/tunnel/deployment-guides/aws/)

Tunnel 방식에서는 AWS 보안 그룹에 8787·80·443 인바운드 포트를 열 필요가 없다. SSH만 관리 목적으로 열고, 서버가 Cloudflare로 outbound 연결할 수 있어야 한다. 제한적인 방화벽이면 Cloudflare가 안내하는 7844 egress를 확인한다.

## 2. AWS에서 설치

프로젝트 루트를 AWS의 예를 들어 `/home/ubuntu/used-market`에 업로드한 뒤 실행한다.

```bash
cd /home/ubuntu/used-market
sudo bash aws-runner/install-ubuntu24.sh /home/ubuntu/used-market
```

설치 스크립트가 다음을 처리한다.

- Ubuntu 패키지·Node.js 22 설치
- Chromium 설치 및 실행 경로 확인
- `cloudflared` 설치
- `usedrunner`, `cloudflared` system user 생성
- `/opt/used-market-runner`에 러너와 필요한 `live-search.mjs` 배치
- `/etc/used-market-runner/runner.env` 생성
- `used-market-runner.service`, `used-market-tunnel.service` 등록
- Node 모듈을 추가로 설치하지 않고 검색 색인 계약·`.mjs` 문법검사

설치 스크립트는 AWS에서 실행해야 한다. 이 저장소 작업에서는 AWS에 접속하거나 설치를 실행하지 않는다.

## 3. 비밀값 설정 및 서비스 시작

```bash
sudo bash /opt/used-market-runner/aws-runner/configure-ubuntu24.sh
```

입력값:

- `CLOUDFLARE_RUNNER_TOKEN`: Cloudflare Worker가 `/api/runner/run` 호출 때 쓰는 긴 랜덤 토큰
- `EBAY_CLIENT_ID`: eBay Developer 애플리케이션 Client ID
- `EBAY_CLIENT_SECRET`: eBay Developer 애플리케이션 Client Secret
- `D1_IMPORT_URL`: 선택. 운영자 seed/recovery 또는 명시적으로 켠 background mirror가 `{ "items": [...] }`를 보내는 HTTPS import API
- `D1_BACKGROUND_MIRROR_ENABLED`: 기본 `false`. `true`일 때만 수집·상태 확인 결과를 D1에 연속 복제
- `D1_STATS_IMPORT_URL`: PC 전환 시 필수. checksum·row count가 포함된 완성 통계 publication을 받는 `/admin/import-product-stats`
- `PC_STATS_PRODUCT_IDS`: 현재 운영 게시기는 값이 있으면 `PC_STATS_PARTIAL_PUBLICATION_DISABLED`로 중단한다. 일부 제품만 기존 활성 통계에 병합하는 설정으로 사용하지 않는다.
- `PC_SOURCE_TARGETS_PER_RUN`: 사이트별 한 번의 수집 배치 크기. 기본 `85`, 현재 최소 `83`; 전체 일일 모델 순회에 부족하면 설정·health가 실패한다.
- `PC_SOURCE_TARGET_CONCURRENCY`: 사이트 내부 동시 요청 수. 기본 `6`, 허용 범위 `1~8`
- `CLOUDFLARE_MANUAL_RUN_TOKEN`: 선택한 import API의 Bearer 토큰
- `Cloudflare Tunnel token`: Dashboard에서 복사한 Tunnel 토큰

저장 위치와 권한:

- Runner 환경변수: `/etc/used-market-runner/runner.env` (`root:usedrunner`, `0640`)
- Tunnel 토큰: `/etc/cloudflared/used-market-runner.token` (`root:cloudflared`, `0640`)

서비스가 성공하면 다음 두 유닛이 부팅 시 자동 시작된다.

```bash
systemctl status used-market-runner.service --no-pager
systemctl status used-market-tunnel.service --no-pager
```

`configure-ubuntu24.sh`는 Runner를 먼저 재시작하고 Tunnel을 enable·재시작한 뒤, 로컬과 `RUNNER_PUBLIC_URL`의 `/health`가 같은 새 process instance를 반환하는지 확인한다. 이 외부 검증까지 통과해야 설정이 성공한 것으로 본다.

## 3.1 반복 배포

기존 서버에 새 release를 올릴 때도 설치 스크립트를 사용한다. Tunnel 토큰이 이미 있으면 스크립트가 `runner → tunnel` 순서로 재시작하고 로컬·외부 health를 필수 검증한다.

구버전 기본값처럼 기존 `PC_SOURCE_TARGETS_PER_RUN`이 `71` 미만이면 자동으로 덮어쓰지 않고 설치를 중단한다. 운영자가 처리량 변경을 승인한 뒤 다음처럼 명시적으로 올린다.

```bash
sudo env PC_SOURCE_TARGETS_PER_RUN_OVERRIDE=85 PC_SOURCE_TARGET_CONCURRENCY_OVERRIDE=6 \
  RUNNER_PUBLIC_URL=https://runner.example.com \
  bash aws-runner/install-ubuntu24.sh /home/ubuntu/used-market-release
```

D1-first 운영에서 AWS-first로 처음 전환할 때는 Worker를 먼저 배포해 `/api/pc/listings`와 가격 통계가 `x-search-data-source: aws-runner`로 응답하는지 확인한 뒤 AWS 러너를 배포한다. 반대 순서로 진행하면 기존 Worker가 자동 mirror가 멈춘 D1 매물을 계속 읽을 수 있다.

```bash
sudo env RUNNER_PUBLIC_URL=https://runner.example.com \
  bash aws-runner/install-ubuntu24.sh /home/ubuntu/used-market-release
```

`systemctl stop used-market-runner.service` 뒤 Runner만 다시 시작하는 배포 명령은 사용하지 않는다. Runner 중지는 `Requires=` 관계로 Tunnel도 내리므로 반드시 Tunnel을 다시 enable/start하고 공개 health까지 확인해야 한다.

## 4. Worker 연결

Cloudflare Worker 배포 환경에서 다음을 설정한다.

```text
CLOUDFLARE_RUNNER_URL=https://runner.example.com/api/runner/run
SEARCH_RUNNER_URL=https://runner.example.com/api/search
RUNNER_TOKEN=<CLOUDFLARE_RUNNER_TOKEN과 동일한 값>
```

저장소의 Worker 배포 스크립트는 `CLOUDFLARE_RUNNER_URL`과 `CLOUDFLARE_SEARCH_RUNNER_URL`을 사용한다. 실제 Worker Secret 이름은 `RUNNER_TOKEN`이다. 두 URL은 같은 Tunnel을 사용하되 각각 `/api/runner/run`, `/api/search`까지 포함한다.

새 환경의 첫 배포는 `RUNNER_INDEX_MODE=shadow`로 live·색인 비교 수치를 모을 수 있다. 현재 운영은 2026-08-20 검색 대기시간 개선 결정에 따라 `RUNNER_INDEX_MODE=cache_first`다. 저장 결과를 먼저 응답하고 stale이면 백그라운드 갱신하며, 캐시가 없는 검색만 동기 수집한다.

PC 원장 shadow dual-write는 `PC_PARTS_SHADOW_WRITE_ENABLED=true`로 켠다. 고주기 cadence는 운영자가 병행 수집 시작을 승인한 뒤 `PC_PARTS_SCHEDULER_ENABLED=true`로 켠다. 동시에 Worker의 `AWS_PC_SCHEDULER_AUTHORITY=true`를 적용해야 Cloudflare cron이 중복 수집을 멈추고 watchdog만 수행한다. 단, 하루 한 번의 `daily-price-refresh`는 완성된 통계 publication을 위해 계속 AWS Runner로 전달된다.

공개 매물·가격 통계의 주 저장소는 AWS SQLite다. `D1_BACKGROUND_MIRROR_ENABLED=false`와 Worker의 `D1_LISTING_FALLBACK_ENABLED=false`가 기본이다. 이 상태에서는 `D1_IMPORT_URL`과 token이 남아 있어도 scheduler와 lifecycle 확인이 D1 매물을 자동 갱신하거나 Worker가 오래된 D1 매물을 fallback으로 공개하지 않는다. D1 매물 fallback을 명시적으로 켜더라도 완전한 collection manifest가 있고 2시간 이내인 snapshot만 허용한다. 단순 `export-pc-listings-now.mjs` 결과 upsert는 누락된 판매완료·삭제 행을 퇴역시키지 않으므로 authoritative snapshot 교체로 취급하지 않는다. `D1_STATS_IMPORT_URL`은 매물 mirror와 별개인 일일 통계 사본 경로다. 수십 MB 통계도 있으므로 분할 전송·AWS 전체 검증을 사용한다.

`daily-price-refresh`는 게시 성공 후 백업을 만들고 `observationRetentionDays: 30`으로 압축한다. 현재 30일 통계 구성원 검증에 필요한 관측 상세와 매물별 최신 snapshot, 분류 교정·중복 판정·모델 후보 증거를 보존한다. 평균·중앙값·최솟값·최댓값·표본 수와 소스별 일일 통계도 유지한다. 대규모 최초 정리는 `compact-pc-storage.mjs`의 dry-run checksum을 확인한 뒤 서비스 중지 상태에서 `--apply --confirm-observation-prune --confirm-plan-checksum <checksum> --vacuum`으로 실행하는 별도 운영 조치다.

기존 비활성 검색행은 자동으로 SOLD/DELETED로 추정하지 않는다. 서비스 중지 후 아래 명시 명령을 한 번 실행하면 먼저 SQLite 복구 백업을 만들고 `UNAVAILABLE_UNKNOWN`으로 이행한다.

```bash
sudo systemctl stop used-market-runner.service
sudo -u usedrunner node --env-file=/etc/used-market-runner/runner.env /opt/used-market-runner/aws-runner/backfill-legacy-inactive.mjs --confirm-unavailable-unknown-backfill
sudo systemctl start used-market-runner.service
```

신규 PC 사전수집 대상 source는 registry의 운영자 승인 기록, `directory_source:true`, `runtime_status:"ENABLED"`를 모두 갖춰야 한다. 비활성 소스는 새 스케줄 대상에서 제외하지만 과거 공개 projection의 잔존 행까지 자동 제거됐다고 가정하지 않는다. 2026-09-24에 확인한 과거 소스·분류 품질 과제는 변경 기록에서 계속 추적한다. source 실패 시 이전 데이터 보존, backoff, 격리 기록을 남긴다.

collection target은 `HOURLY_CATEGORY`와 `DAILY_MASTER`로 나뉜다. 전자는 모든 11개 부품군을 매시간 확인하고, 후자는 GPU·CPU 정확 모델과 RAM 세대·용량·제조사, 저장장치 용량·제조사 등 versioned master 전체를 24시간 간격으로 순회한다. `PC_SOURCE_TARGETS_PER_RUN`은 한 사이트를 한 번에 과도하게 호출하지 않도록 배치를 제한한다. `/health`의 `pc_parts.collection_capacity`는 현재 target set과 사이트별 실행 횟수로 전체 순회 가능 여부를 계산하며, 기본값 `85`는 현재 운영 소스의 정상 회차 기준 일일 순회량을 충족한다. 다나와는 매시 19분에 최대 85개를 순차 요청하고 요청 사이를 최소 5초 띄운다. 403·429·접근 차단이 나오면 해당 회차를 중단하며, 이미 수집한 자료는 보존한다. 수동 수집도 같은 간격과 중단 정책을 사용한다.

실패한 개별 target은 다음 소스 실행부터 지수 백오프로 재시도한다. `/health`의 `source_readiness[].target_coverage`는 성공 target 수, 실패 target 수, 2회 주기 이상 성공하지 못한 stale target 수를 공개하며, `--require-pc-continuous`는 stale target이 남아 있으면 통과하지 않는다.

가격 통계 publication은 D1에 4행씩 staging하고 AWS의 전체 readback 검증을 통과한 뒤 Worker가 활성 포인터를 교체한다. `PC_STATS_PUBLICATION_TIMEOUT_MS`는 개별 게시 HTTP 요청에 쓰는 별도 제한이며 기본 15분이다. 전체 계산·후처리가 15분 안에 끝난다는 보장은 아니다. readback의 별도 제한과 오류 판정은 위 운영 위키를 따른다.

기존 다나와 장터 adapter의 실제 목록 수집 진단은 다음 명령으로만 실행한다. 이 legacy 진단은 현재 운영하는 `danawa-search.mjs` 중고 통합검색 수집과 다르며, 운영 스케줄이나 결정적 테스트에는 포함하지 않는다.

```bash
npm run test:pc:live-specialist
```

별도 사람이 검수한 JSON 데이터셋의 출시 지표는 다음 명령으로 집계한다. 작은 품질 편차는 보고만 하며, 거짓 SOLD·시장군 혼합·거짓 자동 병합은 종료 코드 2로 차단한다.

```powershell
npm run pc:quality-eval -- C:\path\to\pc-human-reviewed.json
npm run pc:quality-eval -- C:\path\to\pc-human-reviewed.json --ledger C:\path\to\search-index.sqlite --version-key pc-normalization-v2 --apply-version-decision --confirm-version-decision
```

관리자 분류 교정과 저위험 alias shadow 진입은 Runner의 `POST /api/admin/pc-classification-feedback`에 Runner bearer token을 사용한다. alias 자동 승격은 72시간 shadow, 서로 다른 매물 5개 이상, 2개 이상 소스 또는 공식 마스터 검증, 충돌 0건, 고정 검증셋 precision 99.5% 이상, 전체 회귀 무저하를 모두 요구한다. 검증 결과는 `PC_ALIAS_PROMOTION_EVIDENCE_JSON`에 alias ID 또는 정규화 alias를 키로 기록하며, 증거가 없으면 shadow에 남는다.

과거 snapshot은 원본을 수정하지 않고 새 정규화 버전으로 다시 처리할 수 있다. 기본은 dry-run이며 실제 반영 시 복구 백업을 먼저 만든다.

```powershell
npm run pc:reclassify -- --db C:\path\to\search-index.sqlite --normalization-version 3 --parser-version pc-parser-v2 --rule-version pc-rules-v2 --filter-version pc-filter-v2 --model-version pc-master-v3
npm run pc:reclassify -- --db C:\path\to\search-index.sqlite --normalization-version 3 --parser-version pc-parser-v2 --rule-version pc-rules-v2 --filter-version pc-filter-v2 --model-version pc-master-v3 --apply --confirm-reclassification
```

새 pipeline 버전은 `STAGED`로 등록된다. 사람이 검수한 품질 보고서가 모든 목표와 무결성 차단 조건을 통과해야 `ACTIVE`가 되며, 이후 목표 미달·무결성 오류·기준선 저하가 확인되면 정확한 이전 버전으로 자동 롤백된다.

## 5. 헬스체크

로컬 러너, 승인된 3개 대상 사이트와 SQLite 색인 활성 상태를 확인한다.

```bash
bash /opt/used-market-runner/aws-runner/health-check.sh
```

Tunnel 공개 URL까지 확인한다.

```bash
RUNNER_PUBLIC_URL=https://runner.example.com \
  bash /opt/used-market-runner/aws-runner/health-check.sh --require-public
```

스케줄러가 켜져 있고 모든 운영 소스의 최근 수집과 전체 target 처리량이 정상인지 확인한다.

```bash
RUNNER_PUBLIC_URL=https://runner.example.com \
  bash /opt/used-market-runner/aws-runner/health-check.sh --require-public --require-pc-continuous
```

실제 수집 작업 1개까지 검증하려면 토큰을 환경변수로 주고 실행한다. 이 명령은 번개장터·중고나라·eBay를 실제로 요청하므로 점검할 때만 사용한다.

```bash
RUNNER_TOKEN='<CLOUDFLARE_RUNNER_TOKEN>' \
  bash /opt/used-market-runner/aws-runner/health-check.sh --run-job --job gpu-fast-scan
```

실패 시 로그:

```bash
journalctl -u used-market-runner.service -n 100 --no-pager
journalctl -u used-market-tunnel.service -n 100 --no-pager
```

공개 URL이 로컬 `/health`와 같은 JSON을 반환해야 한다. `target_sites`는 다음 3개와 정확히 같아야 한다.

```json
["bunjang", "joonggonara", "ebay"]
```

## 6. 운영 점검표

- [ ] Cloudflare Public Hostname이 `http://127.0.0.1:8787`을 가리킨다.
- [ ] Worker의 `CLOUDFLARE_RUNNER_URL`이 Tunnel URL의 `/api/runner/run`까지 포함한다.
- [ ] Worker `RUNNER_TOKEN`과 AWS `CLOUDFLARE_RUNNER_TOKEN`이 동일하다.
- [ ] `used-market-runner.service`와 `used-market-tunnel.service`가 active다.
- [ ] 두 서비스가 enable 상태이며 로컬·공개 `/health`의 `process_instance.id`가 같다.
- [ ] `/health`의 대상 사이트가 승인된 3개이고 `search_index.enabled`가 `true`다.
- [ ] `health-check.sh --require-pc-continuous`가 통과하고 `collection_capacity.all_sources_sufficient`가 `true`다.
- [ ] AWS 여유 디스크가 5GB 이상이다. 미만이면 배포 전에 EBS를 확장한다.
- [ ] 현재 운영 모드는 `cache_first`이며 stale 비율·갱신 지연·자원 경고를 모니터링한다.
- [ ] 연속 D1 매물 mirror와 매물 fallback은 각각 `D1_BACKGROUND_MIRROR_ENABLED=false`, `D1_LISTING_FALLBACK_ENABLED=false`다.
- [ ] AWS 보안 그룹에서 8787을 공개하지 않았다.
- [ ] 대상 사이트의 이용약관·robots·접근 제한을 준수한다.

## 파일 설명

| 파일 | 역할 |
|---|---|
| `runner.mjs` | 승인된 3개 사이트 제한 병렬 수집·캐시 우선 검색 HTTP 서버 |
| `search-index.mjs` | SQLite WAL·FTS5 색인, 갱신·보관·백업·비교 지표 |
| `pc-parts-ledger.mjs` | 불변 원본·관측·상태·제품 master·30일 가격 통계 원장 |
| `pc-shadow-pipeline.mjs` | 분류·master match·시장군 분리 후 shadow dual-write |
| `install-ubuntu24.sh` | Ubuntu 24.04 설치·파일 배치·systemd 등록 |
| `configure-ubuntu24.sh` | 비밀값 입력·권한 설정·서비스 시작 |
| `used-market-runner.service` | Node 러너 systemd 템플릿 |
| `used-market-tunnel.service` | 토큰 파일 기반 cloudflared systemd 템플릿 |
| `health-check.sh` | 로컬·공개 URL·선택적 실제 수집 검사 |
| `smoke-search.sh` | 인증 토큰을 출력하지 않는 승인 사이트 실검색 점검 |
| `backfill-legacy-inactive.mjs` | 백업 후 기존 비활성 매물을 `UNAVAILABLE_UNKNOWN`으로 1회 이행 |
| `reset-shadow-metrics.mjs` | 첫 배포 점검값만 지우는 명시 확인형 shadow 지표 초기화 |
| `configure-d1-backup.sh` | stdin 토큰으로 D1 변경분 백업 경계를 설정 |
| `seed-d1-backup.mjs` | 활성 색인의 사이트별 최근 2,500개를 D1에 1회 시드 |
| `.env.example` | 환경변수 이름과 저장 위치 예시 |
