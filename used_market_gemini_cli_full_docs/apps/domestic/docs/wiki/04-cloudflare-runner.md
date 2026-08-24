# Cloudflare Runner 아키텍처

마지막 갱신: 2026-08-20
상태: Named Tunnel·AWS Runner·Worker 운영 배포 및 live 검증 완료

## 역할

```text
Cloudflare Cron Trigger
  -> Worker scheduled(controller, env, ctx)
  -> HTTPS POST /api/runner/run
  -> Node JobRunner
  -> Browser/CDP collector
  -> market snapshot + scheduler result
```

Cloudflare Worker는 현재 Node/CDP 브라우저 수집기를 직접 실행하지 않는다. Worker는 주기·인증·호출 경계를 담당하고, 실제 브라우저 세션과 기존 부품 로직은 Node 러너가 담당한다.

사용자 실시간 검색은 별도 흐름이다.

```text
Browser (used-pick.com)
  -> Cloudflare Worker POST /api/search
  -> Named Tunnel https://runner.used-pick.com/api/search
  -> AWS Node runner: SQLite 색인 조회 + 최근 매물 확인
  -> Worker: AWS 응답 전달, 장애 때만 D1 대체
  -> Browser: 30개씩 번호 페이지
```

검색 세션 안에서 사이트·정렬을 바꾸는 흐름은 다음과 같다.

```text
전체 검색 스냅샷
  -> view_sites: 선택 사이트 결과를 즉시 조회
  -> focus_sites + collect_view: 선택 사이트의 최신 후보만 비동기 보강
  -> Browser: 선택 사이트 3페이지(90개)까지 백그라운드 선읽기
  -> 정렬 변경: 현재 배열 즉시 정렬 + SQLite 같은 스냅샷 조회
```

`sites`는 수집 키를 구성하는 사이트 묶음이고 `view_sites`는 응답 필터다. `focus_sites`는 보강할 원 사이트만 제한한다. `collect_view`는 사이트 탭 진입처럼 결과 창을 넓히는 요청이며, 정렬·가격 범위·일반 페이지 이동에는 사용하지 않는다.

운영 확인에서는 사이트 탭 변경 직후 AWS `index_page_reads`가 증가하고, 이어지는 집중 보강에서 `source_collection_attempts`가 선택 사이트 수만큼만 증가해야 한다. 낮은 가격 전환은 `index_page_reads`만 증가하고 `live_collection_runs`·`source_collection_attempts`·`index_ingest_commits`는 증가하지 않아야 한다.

Cloudflare만으로 이 경로를 대체하지 않는 이유는 Workers 런타임이 현재 프로젝트의 Node 서비스·원 사이트 수집 경계를 그대로 소유하지 않기 때문이다. AWS SQLite가 최대 100,000개 활성 상품의 주 색인이다. D1은 5개 사이트별 최근 2,500개, 전체 최대 10,000개만 보관한다. AWS 러너가 없으면 UI 자체는 열리지만 D1의 제한된 최근 결과만 반환하거나, 대체 데이터가 없으면 오류를 표시한다.

## 코드 위치

- Worker: `cloudflare/worker.mjs`
- 배포 설정: `cloudflare/wrangler.jsonc`
- Worker 자체 하네스: `cloudflare/harness.mjs`
- Node 실행 서비스: `web-backend/logic/runner-service.ts`
- 인증 엔드포인트: `POST /api/runner/run`
- 상태 확인: `GET /api/runner/status`
- 색인 갱신 확인: `GET /api/search/refresh/:token`
- 운영자 색인 상태: `GET /api/index/status`
- 색인 구현: `aws-runner/search-index.mjs`

## 보안 경계

- Node 서버: `CLOUDFLARE_RUNNER_TOKEN`
- Cloudflare Secret: `RUNNER_TOKEN`
- 수동 실행: `MANUAL_RUN_TOKEN`
- 토큰은 저장소에 커밋하지 않는다.
- `RUNNER_URL`은 `localhost`가 아닌 공개 HTTPS 주소여야 한다.
- 허용된 `JobPlan` 이름만 실행한다.
- 같은 작업이 이미 실행 중이면 Node 데몬과 `/api/runner/run` 사이에서도 공유 파일 lock으로 중복 실행하지 않는다.
- 이 lock과 idempotency 파일은 같은 호스트의 공유 파일시스템 범위다. 컨테이너·다중 VM 배포에서는 공유 DB/KV/Durable Object로 교체해야 분산 중복 실행까지 막을 수 있다.
- Worker는 예약 실행 시 `cron + scheduled_time`을 idempotency key로 전달하고, Node는 최근 실행 결과를 파일에 보존해 Worker 재시도도 중복 실행하지 않는다. 수동 실행은 재시도에 같은 `Idempotency-Key` 헤더를 사용한다.
- Node 작업이 실패하면 `/api/runner/run`은 502로 응답해 Worker가 성공으로 오인하지 않게 한다.
- 웹/Cloudflare 수동 실행도 스케줄러 데몬과 동일하게 알림 dispatch와 reporter 후처리를 수행하며, 후처리 실패는 `partial_success`와 `postprocess.warnings`로 노출한다.

## 시간대

Cloudflare Cron은 UTC 기준으로 해석된다. 현재 Node 스케줄러의 `Asia/Seoul` 표기와 완전히 같은 시각이 필요하면 Cron 표현식을 UTC로 변환하고 배포 후 실제 실행 로그를 확인한다.

Free 플랜의 5개 Cron 제한 때문에 `daily-price-refresh`는 `0 */2 * * *` 트리거가 UTC 18시에 실행될 때만 GPU 작업과 함께 전달한다. 이 실행은 매일 약 03:00 KST이며, Node 스케줄러의 `Asia/Seoul` 매일 03:00과 맞춘다.

공식 참고:

- https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/
- https://developers.cloudflare.com/workers/configuration/cron-triggers/

## 현재 배포 전제

- Worker: `used-market-runner`
- 배포 Worker 버전: `61544219-71da-488f-b150-403d7abc45b4`
- 공개 사이트: `https://used-pick.com`, `https://www.used-pick.com`
- AWS 러너 공개 경계: `https://runner.used-pick.com` Named Tunnel
- 검색 색인: `cache_first`, 초기 사이트별 최대 160개·전체 최대 640개, 확장 스냅샷 최대 1,000개, 6시간 이후 stale 표시·백그라운드 갱신
- 화면 페이지: 30개씩 번호 페이지
- SQLite: 활성 100,000개, soft 750MB, hard 1GB
- 메모리: systemd `MemoryHigh=2560M`, `MemoryMax=3072M`
- Cron: Cloudflare 플랜 제한에 맞춘 5개 트리거
- Workers Logs: `observability.enabled=true`, 요청 100% sampling (트래픽 증가 시 비율 재조정)

Quick Tunnel은 운영 경로가 아니다. 배포 시 `CLOUDFLARE_TUNNEL_MODE=named`를 사용하고, `/health`의 `collection_window: 1000`과 `search_index.enabled`, 공개 `/api/search`의 `x-search-data-source: aws-runner`, 가격 범위와 페이지 cursor를 함께 확인한다.

2026-08-17 4사이트 배포 확인에서 AWS의 `used-market-runner.service`와 `used-market-tunnel.service`는 모두 `active`였다. 공개 runner·두 사용자 도메인의 health는 모두 HTTP 200이고, 검색 용량은 동시 4개·대기열 16개·확장 스냅샷 최대 1,000개다. 당시에는 `shadow` 모드를 유지했다.

2026-08-20 배포부터 `shadow`에서도 `refresh_index=false`인 사이트 보기·정렬 요청은 같은 SQLite 스냅샷을 읽는다. `collect_view=true` 또는 `expand_index=true`만 원 사이트 수집으로 넘어가므로 비교 모드를 유지하면서도 사이트 탭 자체가 5개 사이트를 재수집하지 않는다.

같은 날 2차 속도 배포에서 운영 모드를 `cache_first`로 전환했다. 전체 검색은 저장 결과를 먼저 반환하고, 사이트 탭은 같은 스냅샷의 해당 사이트 결과를 먼저 보여준 뒤 선택 사이트만 보강한다. 브라우저는 보강 결과 최대 90개를 미리 읽어 3페이지까지의 이동 대기를 줄인다. 정렬은 SQLite 조회만 사용하며 원 사이트 수집을 시작하지 않는다. 이 2차 정책이 위 `shadow` 설명보다 우선한다.

2차 운영 검증에서 `아이폰 15` 전체 → 중고나라 전환은 기존 2개를 약 1.1초 안에 먼저 표시한 뒤 307개로 보강했고, 3페이지 이동은 약 1.6초였다. 낮은 가격순은 약 1.2초 안에 20,000원부터 오름차순으로 표시됐다. 정렬 전후 `index_page_reads_total`만 5에서 6으로 늘고 원 사이트 수집·시도·색인 반영 횟수는 변하지 않았다. Worker 버전은 `db115350-8c3f-4a8e-aeda-d1c19a76c66e`, AWS 롤백 백업은 `/var/backups/used-market-runner/20260820T140105Z-cache-first-fast-sort`다.

2026-08-21 페이지 회귀 배포부터 먼 페이지 번호는 직접 이동 버튼이 아니라 전체 페이지 수 정보로만 표시한다. 현재 내려받은 페이지와 바로 다음만 이동할 수 있고, `다음` 한 번은 cursor 한 번만 소비한다. 추가 수집도 같은 `다음` 문구를 사용한다. `price_desc`는 SQLite 스냅샷 내림차순과 고정 cursor를 지원한다. Worker 버전은 `bab67dfa-604f-4e7c-b285-168315805f79`, AWS 백업은 `/var/backups/used-market-runner/20260820T150133Z-pagination-high-price`다.

같은 날 후속 배포에서 AWS 실패 시 사용하는 D1 백업 검색에도 `price_desc`를 추가했다. 최소·최대 가격 조건을 그대로 적용하고 가격 없는 항목은 마지막에 둔 채 가격 내림차순으로 반환한다. 가격 적용 완료 뒤 진행 문구도 즉시 닫는다. 현재 Worker 버전은 `61544219-71da-488f-b150-403d7abc45b4`다.

러너 시작 시 전체 `PRAGMA integrity_check`는 스키마 마이그레이션 때만 실행한다. 평상시 재시작은 지원하지 않는 사이트가 실제로 저장돼 있을 때만 삭제 트랜잭션을 열며, 배포 전후 전체 무결성 검사는 `aws-runner/migration-smoke.mjs`로 명시 실행한다. 278MB 운영 DB 기준 재시작 포트 복구가 수분에서 약 10~40초로 줄었다.

Cloudflare 대시보드에서 방문자 요청은 Zone Analytics, Worker 실행·러너 프록시 로그는 Workers Logs에서 확인한다. Worker가 AWS로 보내는 하위 요청이 Zone HTTP 트래픽에 별도 방문자로 잡히지 않는 것은 정상이다.

## 장애와 안전한 대체

| 장애 | 사용자 영향 | 대체/복구 |
| --- | --- | --- |
| AWS 서비스 중지 | 새 실시간 검색 불가 | systemd `used-market-runner.service` 상태·로그 확인 후 재시작 |
| Named Tunnel 중지/DNS 오류 | Worker가 러너에 연결하지 못함 | `used-market-tunnel.service`, `runner.used-pick.com/health` 확인 |
| 원 사이트 하나 실패 | 다른 사이트 결과는 유지 | 성공 사이트만 병합하며 실패 사이트 누락 횟수는 올리지 않음 |
| 원 사이트 전체 실패 | 신규 반영 지연 | 마지막 저장 색인을 경과 시간·`stale` 상태와 함께 유지 |
| AWS 전체 검색 실패 | D1에 저장 데이터가 있을 때만 제한 대체 | 응답의 data source를 확인하고 실시간 결과처럼 표현하지 않음 |
| cursor 만료 | 다음 페이지 불가 | 새 검색을 시작해 새로운 고정 창 생성 |

검색 결과 신선도 기준은 6시간이다. 이 시간을 넘긴 색인은 `stale`과 확인 경과 시간을 표시한 채 먼저 응답하고 백그라운드 갱신을 예약한다. 운영 모드는 `RUNNER_INDEX_MODE=cache_first`이며, 캐시가 전혀 없는 검색만 원 사이트 동기 수집을 기다린다. 세부 결정은 `docs/decisions/ADR-cache-first-search-index.md`에 기록한다.
