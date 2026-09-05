# AWS Ubuntu 러너 운영

이 디렉터리는 현재 `runner.mjs`를 AWS Ubuntu 24.04에서 실행하기 위한 설치·환경·systemd·Cloudflare Tunnel·헬스체크 파일만 담는다.

legacy 검색의 승인된 러너 대상은 다음 4곳이다.

- 중고나라: `joonggonara`
- 헬로마켓: `hellomarket`
- 리싱크몰: `rethinkmall`
- eBay: `ebay` (공식 Browse API)

PC 디렉터리의 운영 대상은 중고나라·번개장터·다나와 장터·헬로마켓·리씽크몰·eBay·쿨엔조이이다. 다나와는 11개 부품군별 공개 카테고리 목록을, 나머지 검색형 사이트는 매시간 부품군 검색과 하루 단위 전체 제품 master 순회를 사이트별 기존 스크립트로 수행한다. 리씽크몰은 리퍼비시 시장군, eBay는 해외 중고 시장군으로 분리한다. 분류와 `market_pool` 분리가 끝난 projection만 공개한다. 개별 사이트가 HTTP 차단이나 응답 변경으로 실패하면 우회하지 않고 해당 source만 격리하며 다른 source와 이전 publication은 유지한다.

공개 PC 화면은 사전수집으로 완성된 catalog·listing·stats projection만 조회하며 페이지 요청 중 원 사이트를 호출하지 않는다. 좌측 필터와 사이트별 매물 결과, 현재 ACTIVE·RESERVED 평균·중앙값, SOLD 직전 마지막 표시가격 평균·중앙값, 최근 30일 그래프는 동일 publication 범위에서 응답한다. RESERVED·SOLD 표시가격은 실제 체결가가 아니며, 출처가 구조적으로 제공한 확인 체결금액만 별도 통계로 표시한다.

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

공개 매물·가격 통계의 주 저장소는 AWS SQLite다. `D1_BACKGROUND_MIRROR_ENABLED=false`와 Worker의 `D1_LISTING_FALLBACK_ENABLED=false`가 기본이다. 이 상태에서는 `D1_IMPORT_URL`과 token이 남아 있어도 scheduler와 lifecycle 확인이 D1 매물을 자동 갱신하거나 Worker가 오래된 D1 매물을 fallback으로 공개하지 않는다. D1 매물 fallback을 명시적으로 켜더라도 완전한 collection manifest가 있고 2시간 이내인 snapshot만 허용한다. 단순 `export-pc-listings-now.mjs` 결과 upsert는 누락된 판매완료·삭제 행을 퇴역시키지 않으므로 authoritative snapshot 교체로 취급하지 않는다. 가격 통계 publication용 `D1_STATS_IMPORT_URL`은 훨씬 작은 일일 fallback 데이터 경로이므로 매물 mirror와 별도로 계속 사용할 수 있다.

기존 비활성 검색행은 자동으로 SOLD/DELETED로 추정하지 않는다. 서비스 중지 후 아래 명시 명령을 한 번 실행하면 먼저 SQLite 복구 백업을 만들고 `UNAVAILABLE_UNKNOWN`으로 이행한다.

```bash
sudo systemctl stop used-market-runner.service
sudo -u usedrunner node --env-file=/etc/used-market-runner/runner.env /opt/used-market-runner/aws-runner/backfill-legacy-inactive.mjs --confirm-unavailable-unknown-backfill
sudo systemctl start used-market-runner.service
```

PC 사전수집·공개 전환에 포함할 source는 registry의 운영자 승인 기록과 `runtime_status:"ENABLED"`를 갖춰야 한다. 다나와는 내장 카테고리 adapter를 사용하므로 별도 URL 설정이 필요 없다. 검색 URL이 필요한 쿨엔조이는 허용 host와 `{query}` 자리표시자가 고정된 `PC_SPECIALIST_SEARCH_URLS_JSON`만 사용할 수 있다. source 실패 시 이전 데이터 보존, backoff, 격리 기록을 남긴다.

collection target은 `HOURLY_CATEGORY`와 `DAILY_MASTER`로 나뉜다. 전자는 모든 11개 부품군을 매시간 확인하고, 후자는 GPU·CPU 정확 모델과 RAM 세대·용량·제조사, 저장장치 용량·제조사 등 versioned master 전체를 24시간 간격으로 순회한다. `PC_SOURCE_TARGETS_PER_RUN`은 한 사이트를 한 번에 과도하게 호출하지 않도록 순회 배치를 제한한다.

다나와 11개 부품군의 실제 목록 수집 진단은 다음 명령으로만 실행한다. 결정적 테스트에는 포함하지 않는다.

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
npm run pc:reclassify -- --db C:\path\to\search-index.sqlite --normalization-version 2 --parser-version pc-parser-v2 --rule-version pc-rules-v2 --filter-version pc-filter-v2
npm run pc:reclassify -- --db C:\path\to\search-index.sqlite --normalization-version 2 --parser-version pc-parser-v2 --rule-version pc-rules-v2 --filter-version pc-filter-v2 --apply --confirm-reclassification
```

새 pipeline 버전은 `STAGED`로 등록된다. 사람이 검수한 품질 보고서가 모든 목표와 무결성 차단 조건을 통과해야 `ACTIVE`가 되며, 이후 목표 미달·무결성 오류·기준선 저하가 확인되면 정확한 이전 버전으로 자동 롤백된다.

## 5. 헬스체크

로컬 러너, 승인된 4개 대상 사이트와 SQLite 색인 활성 상태를 확인한다.

```bash
bash /opt/used-market-runner/aws-runner/health-check.sh
```

Tunnel 공개 URL까지 확인한다.

```bash
RUNNER_PUBLIC_URL=https://runner.example.com \
  bash /opt/used-market-runner/aws-runner/health-check.sh --require-public
```

실제 수집 작업 1개까지 검증하려면 토큰을 환경변수로 주고 실행한다. 이 명령은 중고나라·헬로마켓·리싱크몰·eBay를 실제로 요청하므로 점검할 때만 사용한다.

```bash
RUNNER_TOKEN='<CLOUDFLARE_RUNNER_TOKEN>' \
  bash /opt/used-market-runner/aws-runner/health-check.sh --run-job --job gpu-fast-scan
```

실패 시 로그:

```bash
journalctl -u used-market-runner.service -n 100 --no-pager
journalctl -u used-market-tunnel.service -n 100 --no-pager
```

공개 URL이 로컬 `/health`와 같은 JSON을 반환해야 한다. `target_sites`는 다음 4개와 정확히 같아야 한다.

```json
["ebay", "hellomarket", "joonggonara", "rethinkmall"]
```

## 6. 운영 점검표

- [ ] Cloudflare Public Hostname이 `http://127.0.0.1:8787`을 가리킨다.
- [ ] Worker의 `CLOUDFLARE_RUNNER_URL`이 Tunnel URL의 `/api/runner/run`까지 포함한다.
- [ ] Worker `RUNNER_TOKEN`과 AWS `CLOUDFLARE_RUNNER_TOKEN`이 동일하다.
- [ ] `used-market-runner.service`와 `used-market-tunnel.service`가 active다.
- [ ] 두 서비스가 enable 상태이며 로컬·공개 `/health`의 `process_instance.id`가 같다.
- [ ] `/health`의 대상 사이트가 승인된 4개이고 `search_index.enabled`가 `true`다.
- [ ] AWS 여유 디스크가 5GB 이상이다. 미만이면 배포 전에 EBS를 확장한다.
- [ ] 현재 운영 모드는 `cache_first`이며 stale 비율·갱신 지연·자원 경고를 모니터링한다.
- [ ] 연속 D1 매물 mirror와 매물 fallback은 각각 `D1_BACKGROUND_MIRROR_ENABLED=false`, `D1_LISTING_FALLBACK_ENABLED=false`다.
- [ ] AWS 보안 그룹에서 8787을 공개하지 않았다.
- [ ] 대상 사이트의 이용약관·robots·접근 제한을 준수한다.

## 파일 설명

| 파일 | 역할 |
|---|---|
| `runner.mjs` | 승인된 4개 사이트 제한 병렬 수집·캐시 우선 검색 HTTP 서버 |
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
