# AWS Ubuntu 러너 운영

## 2026-10-11 조회/통계 메모리 격리

2026-10-14 20:40~20:42 KST: 숫자 `9600` 검색이 K/KF/X 계열을 찾도록
검색 전용 matcher를 수정했다. 정확한 `9600K` 선택과 제품 identity는 유지한다.
지정 모델 매물 조회는 기존 product 인덱스의 equality/IN seek를 사용한다.
운영 DB 읽기 전용 비교에서 결과 전체가 같았고 Corsair 표본은 648ms→6ms,
9600 계열은 155ms→6ms였다. 모든 과거 시간 초과의 원인이 입증된 것은 아니다.
브라우저 GET은 일시 네트워크/timeout 및 의미 오류 코드 없는 502/504에 한 번만
재시도하며 사용자 취소·인증·자료 무결성 오류를 빈 결과로 바꾸지 않는다.
다른 진행 중 UI 변경을 섞지 않고 운영 기준의 4개 에셋과 matcher만 Worker
`9a7d1686-c7a6-49b2-835d-d465a12df461`로 배포했다. AWS는 유휴 확인 후
정상 설치기로 search-index와 matcher 두 모듈을 반영하고 SHA256을 대조했다.
내부/외부 인스턴스 `ae3b8cda-7bab-4622-a01e-74c4a914587b` 일치,
새 OOM·자동 재시작 0, 기존 합산 3397MiB 배분 유지. 코드·환경 복구본은
`/home/ubuntu/used-market-deploy-backups/lookup-before-20261014.tar.gz`이며 DB는 없다.
두 공개 도메인 health·홈·모델 API 및 실제 브라우저 9600 검색/KF 선택,
Corsair 응답, Hitachi 차트의 데스크톱/모바일 표시를 확인했다.
public-catalog·price-recovery·pc-service·pc-tools·HTML analytics 계약과 build는 통과했다.
pc-ui 계약의 기존 stale projection/source table 불일치는 남아 있으며 전체 suite 성공은 아니다.
추가 발견: Corsair >1200W의 국내 6행은 무선랜카드로, AX 숫자를 PSU 모델·출력으로
해석하는 분류와 구조화 카테고리 신뢰 경로의 별도 교정이 필요하다.
이번 배포는 해당 identity·원장·가격 이력을 변경하지 않았다. 응답 성공을 분류 정확성으로 보지 않는다.

2026-10-13 13:24 KST: 최신 identity 상태 조회의 외부 쿼리가 source 인덱스로
사이트 전체 이력을 반복 스캔하던 경로를 후보 snapshot의 rowid 조회로 고정했다.
같은 운영 DB 읽기 트랜잭션에서 기존/수정 결과 Map의 완전 일치를 확인했다.
3RSYS 풀타워 표본은 9,779ms→3ms, i5-8400은 248ms→31ms,
i3-6100은 331ms→51ms였다. 무결성 검사는 범위·판정 기준을 그대로 유지하고
iterator로 읽어 전체 행 배열을 보관하지 않는다. 게시 전 단계 로그도 분리했다.
정상 설치기 완료, 변경 2개 모듈 SHA256 일치, 내부/외부 Runner 인스턴스 일치를
확인했다. 코드 복구본은 `query-before-20261013.tar.gz`이며 DB는 포함하지 않는다.
메인 사이트 health·PSU·i5-8400·Samsung DDR3 4GB·i3-6100·HGST 일별 조회는
200이었다. 단, 기간 요약은 여전히 10월 10일 계산의 LAST_PUBLISHED이며,
이는 10월 13일 전체 작업의 2시간 제한 실패를 성공으로 바꾸지 않는다.
수정 후 다음 정상 예약 전체 실행의 계산·검증·활성 게시 완료는 별도 확인해야 한다.
한정 계약 검사는 통과했으나 전체 npm test는 기존 광고 동의 UI/계약 불일치로
실패했다. 해당 UI를 이 통계 수정에 섞어 배포하지 않았다.

`used-market-stats.service`는 로컬 Unix 소켓으로만 통계 작업을 받는다. 공개 Runner와
별도 cgroup이며 DB·최종 가격 결과는 기존 저장소를 그대로 사용한다. 각 작업은 2시간
후 TERM, 5초 후 KILL로 종료된다. Runner 연결 종료도 고아 작업을 중단한다.
통계 계산뿐 아니라 게시 후 백업·압축도 이 서비스에서 수행한다. 개별 HTTP 요청
시간 제한과 작업 전체 제한은 별개다. 예약 호출의 HTTP 202는 접수이지 완료가 아니다.
실제 완료는 Runner의 `pc_publication_job_finished` 및 기존 게시 영수증으로 확인한다.
`publication-job-state.json` 한 파일에 대기 요청과 최근 8개 결과를 보존한다.
대기 요청은 재시작 후 실행하지만 실행 중 중단된 요청은 `interrupted`로 남겨
게시 ID 대조 전 자동 재게시하지 않는다. 다른 수집 작업 때문에 접수만 하고
사라지는 경로가 없으며 통계 서비스 준비 전에는 대기 상태를 유지한다.

`install-memory-budget.sh`가 OS용 1GiB를 제외한 실제 MemTotal의 절반(내림)을
`usedpick.slice`의 합산 MemoryMax로 계산한다. 2026-10-12부터 네 서비스의
개별 최대치를 합산 예산과 분리해, 쉬고 있는 백업 등의 여유를 통계가 사용할 수 있다.
현재 3,397MiB 합산 예산에서 Runner 최대 1,536MiB, 통계 최대 2,501MiB,
백업 최대 512MiB, Tunnel 최대 128MiB다. 동시에 이 최대치를 모두 쓸 수는 없다.
Runner/Tunnel의 MemoryLow와 OOM 우선순위를 설정해 조회를 우선 보호하고,
공통 MemoryHigh 감속은 사용하지 않는다. 완전한 OOM 방지 보장은 아니며
실제 합산 예산을 초과하면 통계가 실패할 수 있다. 통계 Node heap은
통계 상한의 55%다. 별도 384MiB heap 검증 자식도 같은 통계 서비스 안에서 실행하며
조회 서버는 검증 결과만 전달한다. 이는 예약 메모리가 아니며 OS 여유와 실제 사용량도 점검해야 한다.
Kstock 설정은 이 설치기가 변경하지 않는다.

2026-10-12 03시 정기 작업은 04:23 KST에 통계 cgroup 상한 1,733MiB를 넘어
OOM으로 종료됐다. 마지막 범위 계산/추적 로그 이후에 발생했으며, 정확한
할당 위치는 확정되지 않았다. 전체 결과를 검증하면서 두 번째 결과 배열과
대형 JSON 문자열을 유지하던 경로를 행 단위 검증·해시·저장으로 바꿨다.
기존 체크섬 형식과 트랜잭션 무결성은 유지한다. 추적 DB 행도 iterator로
읽으며, 단계별 heap/external/RSS 로그와 단계 사이 회수를 추가했다.
96MiB heap에서 약 40MiB 입력의 실제 검증·저장 계약 검사가 통과했다.
이는 다음 전체 예약 작업의 완료 증거를 대신하지 않는다.

일별 차트 조회는 사용하지 않는 기간 요약의 압축 해제를 생략한다.
health의 구형 색인 확인은 존재 여부만 읽는다. 다나와는 알려진 상품 카드가
있는 경우 바깥 wrapper 이름 변경만으로 실패하지 않게 했지만, HTTP 403은
해결된 것으로 간주하지 않으며 기존 10초/시간당·회당 20요청/6시간 격리를 유지한다.

2026-10-12 10:54~10:57 KST 적용 확인: 정상 설치기가 성공했고 8개 변경 파일의
운영 SHA256이 로컬과 일치했다. 실제 cgroup은 `/usedpick.slice`이며 합산
`memory.max=3562012672`, 세 상시 서비스가 그 아래로 이동했다. 백업 서비스의
Slice 설정도 동일하다. 새 slice의 OOM·high 이벤트는 0이다.
공개 health·PSU 매물 5건·i5-8400 및 Samsung DDR3 4GB 일별 차트 39행을
HTTP 200 / success로 확인했다(해당 표본 응답 약 1.0~2.4초).
일별 자료가 존재하더라도 중단된 전체 게시의 성공으로 보지 않는다.
코드만 포함한 복구본은
`/home/ubuntu/used-market-deploy-backups/stats-memory-before-20261012.tar.gz`다.
Kstock의 합산 slice 이행은 거래 재생성 안전 절차가 별도로 필요하며,
USED 설치 성공으로 Kstock 배분까지 완료됐다고 판단하지 않는다.

2026-10-12 14:39~14:43 KST 재확인: 위 8개 파일의 운영 SHA256 및 실제
slice/개별 상한이 일치하며 배포 후 자동 재시작·OOM은 0이다. Runner의 약
1.5GiB 사용량 중 당시 anon은 약 249MB, 파일 캐시는 약 1.34GB였다.
child memory.max에 따른 캐시 회수 이벤트는 있으나 현재 memory pressure
avg10/60/300은 0이다. 공개 health·PSU·두 가격 조회는 200/success였다.
전체 통계 게시 영수증은 여전히 배포 전 실패 건이며 새 전체 실행은 미검증이다.
다나와 배포 후 12:20 실행은 20요청·20수집·39파싱·3파싱 실패로 부분 결과가
있었지만 실행 상태는 FAILED다. 0카드 HTTP 200은 자료 없음으로 처리하지 않았다.
이 결과만으로 실제 대체 wrapper 성공을 입증하지 않는다. 13:20 실행은 첫 요청
403으로 QUARANTINED, 정상 재시도 가능 시각은 19:20:20 KST다. 강제 재시도나
격리 해제 없이 반영 완료와 소스 접근 복구 미완료를 구분했다.

공개 `/health`는 인증된 CPU 매물 1건 조회가 5초 안에 정상 응답해야 200을 반환한다.
조회 장애는 503으로 드러나며 프로세스 실행 여부만으로 정상 판정하지 않는다.
별도 전체 재계산은 장애 복구 검증으로 실행하지 않는다. 다음 정상 예약 게시의
완료·메모리 최대치·복구 백업 생성은 실제 실행 후 확인한다.

2026-10-11 최종 배포: 사용자 승인으로 OS 1,024MiB를 남겼다. MemTotal 8,005,632KiB에서
USED 상한 합계는 3,397MiB (Runner 1,024 / 통계 1,733 / 백업 512 / Tunnel 128)다.
Kstock도 합계 3,397MiB를 적용했으며 컨테이너를 재시작하지 않았다.
공개 Worker 버전은 `ffcf04be-b5fc-46db-a357-892fce1d3a31`다.
실제 조회 기반 health, PSU 목록, i5-8400 및 Samsung DDR3 4GB 가격 조회가
HTTP 200으로 확인됐다. 이 확인은 다음 정기 전체 게시 성공을 의미하지 않는다.
코드 복구본은 `/home/ubuntu/used-market-deploy-backups/runtime-final-before-20261011.tar.gz`이며
DB 복사본을 포함하지 않는다. 집중 계약은 통과했으나 전체 verify는 기존
`pc-service-contract` 개인정보 안내 문구 기대값에서 실패했다.
게시 후 백업의 게시 ID·체크섬·행 수가 새 결과와 다르면 정리를 건너뛰고
`partial_success`로 기록한다. 같은 날 오래된 복구본을 새 복구본으로 오인하거나
백업 경고를 이유로 이미 성공한 게시를 재실행하지 않는다.
배포 후 현재 활성 게시본 4,932행의 읽기 전용 전체 검증도 통과했다
(21.1초, 프로세스 최대 RSS 418,228KiB, D1 쓰기 0). 새 정기 계산 성공의 대체 증거는 아니다.

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

2026-10-11 복구: `pc_lifecycle_queue`는 매물별 최신 상태만 담는 재생성 가능한 색인이다.
관측/원자료 변경 트리거가 이를 같은 트랜잭션에서 갱신하며, 기존 이력은 별도 스레드에서
고정 종료점까지 100개 identity씩 이행한다. 완료 전 진단은 `INITIALIZING`이며 0건으로 표시하지 않는다.
가격 이력·통계 필터는 변경하지 않는다. 항목별 실패 재시도 시간과 소스 차단 대기를 분리하고,
재확인 실행 결과는 `pc_lifecycle_runs`의 소스별 마지막 영수증 및 `pc_lifecycle_recheck_finished` 로그로 확인한다.
검색 수집 성공은 판매완료 복구 완료를 뜻하지 않는다. 중단 전 확인한 상태 변경도 공개 색인에 반영한다.

다나와 복구 단계는 10초 간격·회당/최근 1시간 20요청 상한이다. 예약/수동 경로는 같은 원장 예산을
확인하며, 요청 전에 RUNNING 실행을 남겨 재시작으로 예산이 초기화되지 않게 한다.
403/429는 즉시 중단·6시간 격리하고, 연속 2회 구조 오류는 해당 배치를 중단한다.
구조 오류가 있는 실행은 부분 성공 및 기존 단계별 지연으로 기록한다. 알려지지 않은 빈 화면은
자료 없음으로 간주하지 않는다. 실패 응답의 상태·유형·해시만 기록하고 HTML/쿠키는 저장하지 않는다.
이 상한에서는 전체 모델의 일일 갱신을 보장하지 않으며 접근 회복 확인 전 요청량을 올리지 않는다.

2026-10-11 23시 KST 운영 반영: AWS 설치·서비스 시작 및 주요 모듈 SHA256 일치를 확인했고,
Worker 배포 버전은 `059bcefb-25e6-44fb-8023-2f74a96c3266`이다. 파워 매물 및 i5-8400
가격 조회는 HTTP 200으로 확인했다. 이는 최신 집계·판매완료 누적 복구·다나와 접근 회복의
완료 증거가 아니다. 배포 임시 파일은 정리했으며, 10월 12일 05:15 KST 기존 1회 점검에서
색인 준비 상태·실제 재확인 영수증·다나와 예약 실행 결과를 함께 검증한다.

Keyword collection uses Bunjang's public web `/api/search/v8/web/search`
contract (`q`, `policyKey=pw.product.keyword`, `sort=latest`, `size=60`).
The retired `find_v2` endpoint returned HTTP 404 during the 2026-10-09 incident.
Follow `data.responses.mainGrid.searchResponse.cursor` for subsequent pages;
numeric product IDs must retain their decimal string identity in the ledger.
An empty grid is a valid empty result, but unrecognized response/product fields
are collection failures, not evidence that no listings exist. External ad rows
without product IDs do not become listings. The source-policy and bounded-query
contracts cover these distinctions, pagination, and the CLI extractor.

The scheduled Bunjang collection rechecks stored listing URLs through the same
public `/api/pms/v1/products/{pid}/detail/web` endpoint used by Bunjang's web app.
Product identity must match; `SOLD_OUT` is sold, `DELETED` is deleted, and hidden
or inaccessible products are not counted as sales. Bunjang numeric status `2`
means deleted and `3` means sold.
If legacy privacy redaction masked the product URL, a strictly numeric stored
source listing ID can recover the endpoint; the detail response must still
match that ID. Privacy masking itself is not relaxed.

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

다나와 운영 DB를 대상으로 한 별도 수동 수집은 Runner 서비스가 중지된 경우에만 허용한다. DB를 열기 전에 서비스 상태를 확인하며 중지 상태에서도 저장된 대기·격리는 유지한다. 운영 상태를 모르는 새 로컬 DB의 `pc:collect-local`은 다나와를 기본 대상에서 제외하고 명시적 요청도 거부한다. 구형 dmall 수집기는 fixture 테스트 전용이며 기본 live 호출을 거부한다. 접근 차단 진단을 위해 다른 경로로 반복 요청하지 않는다. 85건은 회차 상한이며 별도 수동 작업을 반복 실행해 시간당 호출을 늘리면 안 된다.

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
- `PC_SOURCE_TARGETS_PER_RUN`: 사이트별 한 번의 수집 배치 크기. 기본 `100`, 현재 최소 `100`; 전체 일일 모델 순회에 부족하면 설정·health가 실패한다.
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

구버전 기본값처럼 기존 `PC_SOURCE_TARGETS_PER_RUN`이 `100` 미만이면 자동으로 덮어쓰지 않고 설치를 중단한다. 운영자가 처리량 변경을 승인한 뒤 다음처럼 명시적으로 올린다.

```bash
sudo env PC_SOURCE_TARGETS_PER_RUN_OVERRIDE=100 PC_SOURCE_TARGET_CONCURRENCY_OVERRIDE=6 \
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

collection target은 `HOURLY_CATEGORY`와 `DAILY_MASTER`로 나뉜다. 전자는 모든 11개 부품군을 매시간 확인하고, 후자는 GPU·CPU 정확 모델과 RAM 세대·용량·제조사, 저장장치 용량·제조사 등 versioned master 전체를 24시간 간격으로 순회한다. `PC_SOURCE_TARGETS_PER_RUN`은 공통 배치 상한이며 기본값은 `100`이다. 다나와는 별도 보호 상한을 적용해 매시 19분에 최대 85개를 순차 요청하고 시작 사이를 최소 10초 띄운다. 403·429·접근 차단이 한 번이라도 나오면 해당 회차를 중단하고 즉시 6시간 격리한다. 수동 수집도 같은 간격·상한·저장된 대기/격리 상태를 준수한다. 기존 자료와 미요청 대상은 보존한다. `/health`의 `pc_parts.collection_capacity`는 다나와 상한을 반영하므로 일일 전체 순회량이 부족하면 그대로 보고한다. 하네스 `node harness/danawa-domestic-contract.mjs`는 동시 호출 간격, 배치 상한, 차단 후 중단·자료 보존·격리, 수동 재시도 금지를 원 사이트 호출 없이 검증한다.

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

저장 공간 정책은 [장기 통계·백업 운영 지침](../docs/wiki/10-storage-operations.md)을 따른다. 설치 시 `used-market-backup-storage.timer`도 활성화하며, 매일 06:30 KST에 검증된 백업·완료 staging만 정리한다. 복구 자료의 7일 보관을 최종 가격 이력에 적용하지 않는다. 실제 완료는 타이머 등록이 아니라 서비스 성공과 `action=complete` 영수증으로 판정한다.

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
| `lifecycle-status-cache.mjs` | 상태 재확인 대기 건수의 읽기 전용 별도 스레드 진단; 5분 캐시·15초 제한 |
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

판매 상태 재확인 대기 건수는 HTTP 이벤트 루프 밖에서 계산한다. 진단이 시간 초과되면
`PENDING`/`UNAVAILABLE`, 이전 성공값이 있으면 `STALE`로 표시하며, 이를 대기 0건이나
수집 정상으로 판정하지 않는다. `checked_at`과 소스별 실제 수집 완료 영수증을 함께 확인한다.
가격 조회의 `LAST_PUBLISHED` 응답도 조회 복구이지 최신 집계 완료 증거가 아니다.


### 미분류 제조사·메인보드 모델의 한정 보정

`pc:repair-unknown-identities`는 SSD/HDD 미분류 용량 버킷과 메인보드 플랫폼 버킷만 대상으로 한다. 같은 용량·수량·판매 단위·상태에서 근거가 확인된 제품으로만 이동하며, 원문·가격·수집 시각·기존 제외 사유는 유지한다. 활성 가격 게시물의 30일 관측 범위와 그 이후 관측만 보정한다. 전체 과거 재분류나 전체 DB 복사는 수행하지 않는다.

수집·게시가 idle인 상태에서 스케줄러를 잠시 중지하고, 기존 Runner 환경을 사용해 아래 순서로 실행한다. 복구 계획은 보호된 운영 디렉터리의 새 파일에 저장한다.

```sh
node aws-runner/repair-pc-unknown-identities.mjs plan /protected/path/identity-plan.json
node aws-runner/repair-pc-unknown-identities.mjs apply /protected/path/identity-plan.json
node aws-runner/repair-pc-unknown-identities.mjs mirror /protected/path/identity-plan.json
```

계획의 `normalizations`, `listings`, `scopes`, `checksum`을 검토한 뒤 적용한다. 적용 시 원본 행·증거·파이프라인이 달라졌으면 전체 트랜잭션을 취소한다. 계획에는 복구용 이전 행이 있으므로 일반 로그나 Git에 넣지 않는다. `mirror`는 변경된 활성 항목만 D1에 반영하며 같은 계획으로 재시도할 수 있다.

이동한 제품의 기존 게시 범위는 `pc:repair-stats`의 `PRODUCT_IDENTITY` 사유로 한정 보정한다. 기존 게시물에 없는 신규 제품 범위는 정상 예약 가격 갱신에서 생성한다. 보정 및 게시 확인 후 기존 스케줄러 설정을 복구한다.

### 중단된 예약 게시의 명시적 복구

예약 게시자는 D1에 쓰기 전에 완성된 AWS 응답을 비공개 준비 상태로 저장하고 Runner의 `publication-job-state.json`에 게시 ID, D1 체크섬, AWS 저장 응답 체크섬, 행 수와 직전 활성 게시물 정보를 기록한다. 준비 상태의 응답은 공개 조회에서 제외한다. 이 기록 이후 응답 실패나 재시작은 `interrupted`로 남으며 자동 재게시하지 않는다. `daily-price-refresh`는 다른 작업과 묶어서 접수할 수 없다.

유지보수 상태가 아니고 수집·게시·검증이 idle일 때, 기존 Runner 인증으로 `POST /api/runner/reconcile-publication`에 `{"key":"중단된 작업의 정확한 key"}`를 보낸다. 요청에 게시 결과나 해제 상태를 직접 지정하지 않는다.

새 작업은 준비 기록이 필수라는 표시를 접수 시 저장한다. 준비 기록 전에 재시작한 새 작업은 D1 쓰기가 불가능했으므로 `failed`로 정리한다. 이 표시가 없는 구형 작업에는 해당 판단을 적용하지 않는다.

- D1 활성 게시물의 전체 행을 재검증하고 AWS 준비 응답이 준비 시 체크섬과 일치하면, Runner가 AWS 응답과 게시 영수증을 한 트랜잭션으로 확정하고 `partial_success`로 해제한다. D1 활성화 직후 응답이 유실된 경우에도 이 경로로 복구한다. 백업·정리 완료까지 증명한 결과는 아니므로 `completed`로 표시하지 않는다.
- D1이 정확한 직전 게시물을 유지하고 후보 게시물에 활성화 이력이 없으면 `failed`로 정리한다. 준비된 D1 행은 삭제하지 않는다. 이후 새 작업 키를 접수할 수 있다.
- 준비 기록 없는 구형 작업, 후보 메타데이터 부재, 불일치, 활성 게시물 변경은 잠금을 유지한다. 파일 삭제나 새 키 반복 호출 대신 기존 D1·AWS 수동 대조 절차를 따른다.

### 유지보수 상태를 사용하는 배포

설치기는 `/var/lib/used-market-runner/deployment-maintenance`를 먼저 만들고 새 수집·게시 접수를 차단한다. 진행 중이거나 대기 중인 게시가 있으면 파일 교체 전에 중단한다. idle 확인 후 서비스를 정지하고, 별도 디렉터리의 코드·이행 검증을 통과한 릴리스만 설치한다. `release_id`가 로컬 및 설정된 공개 health 응답과 일치한 뒤 유지보수 상태를 해제한다. 최초의 미설정 설치는 기존처럼 enable까지만 수행한다.

첫 시작에는 대용량 DB 복구 백업·스키마 이행이 포함될 수 있어 설치기의 health 준비 대기는 기본 최대 2시간이다. 준비되면 즉시 진행하며 `RUNNER_HEALTH_WAIT_SECONDS`로 운영자가 조정할 수 있다. 대기 중에는 프로세스·백업 파일 증가·오류 로그를 확인하고, 새 설치나 백업을 중복 실행하지 않는다.

유지보수 신호를 지원하지 않는 구형 Runner의 첫 업그레이드는 자동 덮어쓰기를 거절한다. 운영자가 먼저 Tunnel을 정지하고 기존 수집·게시 영수증과 idle 상태를 확인해 Runner·통계 서비스를 명시적으로 정지한 뒤 설치한다. 기본 경로와 다른 DB 설정은 파일 교체 전에 거절하며 명시적인 저장 경로 이행이 필요하다.

교체 후 실패하면 이전 코드 디렉터리로 복원하고 서비스와 유지보수 상태를 정지 상태로 유지한다. 환경 파일·systemd 유닛 변경까지 자동으로 되돌린 결과는 아니다. 원인 및 설정을 대조하고 기존 릴리스를 시작해 health를 확인한 뒤에만 유지보수 파일을 제거한다. 이 상태에서 복구 API도 먼저 차단되므로 배포 복구를 완료한 다음 게시 복구를 수행한다. 실패 릴리스의 `.keep`은 미해결 복구 표시이며 해결 후 운영자가 해제한다. 일반 이전 코드 디렉터리는 7일이 지난 것부터 정리하되 마지막 정상 복구본은 보존한다. 운영 SQLite 파일을 코드 복구본으로 복사하지 않는다.
