# USED PICK — 배포 문제 및 3개 에이전트 공통 인수인계

작성 기준: 2026-09-17 14:02:31~14:03:20 KST의 직접 조회.
이 문서는 작업 지시서다. 에이전트를 실제 생성하거나 운영을 배포했다는 보고가 아니다.
현재 조회 때는 운영 데이터를 변경하지 않았다. 이후 상태는 다시 확인한다.

## 1. 작업 위치와 우선 읽을 자료

- 기존 저장소: `C:\DeVelop\USED_WEB` / Chat On Steroids 가상 경로 `/used_web`
- 앱: `C:\DeVelop\USED_WEB\used_market_gemini_cli_full_docs\apps\domestic`
- 공개 서비스: `https://used-pick.com/`
- Runner: `https://runner.used-pick.com/`
- 서버 앱: `/opt/used-market-runner`
- 운영 DB: `/var/lib/used-market-runner/search-index.sqlite`
- 현재 로컬 HEAD 확인값: `b993ab7`; 기능 수정 커밋: `8fcabf5`.

기존 저장소에서 진행한다. 새 clone, reset, clean, 일괄 복원으로 기존 변경을 없애지 않는다.
루트 `AGENTS.md`, `README.md`, `used_market_gemini_cli_full_docs/SETUP.md`, 앱 `README.md`,
`DEPLOYMENT.md`, `docs/wiki/05-harness-loop.md`, `docs/wiki/04-cloudflare-runner.md`,
`docs/AI_CONTEXT.md`, `docs/reviews/2026-09-17-handoff-parts-pricing.md`를 읽는다.
과거 문서의 날짜가 오래된 소스 승인·버전·미배포 설명은 현재 레지스트리/DB/실행 증거보다 우선하지 않는다.
외부 AI/CLI/에이전트 기반 브라우저를 실행할 경우 루트 규칙의 external-ai-orchestrator 스킬을 실제 위치에서 확인한다.

## 2. 지금 배포를 막는 실제 오류

14:02:56의 정식 준비 검사:

```text
node cloudflare/deploy.mjs --preflight-only
PREFLIGHT_EXIT=2
AWS_PC_RELEASE_NOT_READY:PC_PUBLICATION_NOT_RECENT
```

서버의 정기 게시 작업은 아래와 같이 두 번 실패했다. 13:54의 '게시 진행 중' 설명은 이제 과거 상태다.

| 보고서 | 시작~종료 KST | 결과 |
|---|---|---|
| regular-publication.json | 13:50:16~13:54:41 | 정기 작업 HTTP 502 / failed |
| regular-publication-retry1.json | 13:56:41~14:00:58 | 정기 작업 HTTP 502 / failed |

게시기 안쪽 오류:

```text
PC_STATS_PUBLISHER_FAILED:1
Error: D1_STATS_IMPORT_HTTP_503: {}
/opt/used-market-runner/aws-runner/publish-pc-stats-runner.mjs:192
```

두 시도는 각각 2,086행, 표본 있는 범위 1,106개, 요청 본문 31,149,081바이트를 준비한 뒤 실패했다.
실패 요청 주소는 보호된 설정의 `/admin/import-product-stats`다.
이 증거만으로 503이 Cloudflare edge, Worker, D1, 일시적인 장애 중 어디서 발생했는지는 확정할 수 없다.
`{}`는 게시기의 JSON 파싱 기본값일 수도 있어 원 응답 본문이 비어 있었다는 증거가 아니다.
요청 크기·처리 시간·D1 작업량은 조사 대상이지 확정 원인이 아니다. 요금제 변경부터 요구하지 않는다.

14:03:19 조회에서는 게시기 프로세스가 없었고, 소유자 파일도 없었다.
14:02:32 health는 publication_active=false, publication_recent=false, last_error=null이었다.
last_error=null은 게시 성공을 뜻하지 않는다. 실제 작업 보고서에는 실패가 기록돼 있다.
다음 작업자는 현재 PID/잠금/작업자를 다시 확인한 뒤 소유권을 잡는다.

## 3. 사용자가 해결할 권한 문제와 개발자가 고칠 문제

| 구분 | 현재 근거 | 조치 |
|---|---|---|
| SSH/기본 sudo | 13:51 재검사 성공. 이번 서버 읽기 전용 sudo도 성공 | 키 재발급·보안 전체 해제 요청 불필요 |
| Worker dry-run | 13:51 단독 실행 exit 0 | 실제 배포 아님. 모의 검사 차단 주장은 유지하지 않음 |
| Cloudflare 배포 상태 조회 | 13:54 조회 성공 | 실제 배포 쓰기 권한 전체가 검증된 것은 아님 |
| 과거 연결 도구 보안 거부 | 이전 보고서에 기록; 특정 서비스 정지 요청의 현재 거부는 재현하지 않음 | 재현 시에만 명령·시각·원문을 사용자에게 전달 |
| 현재 503 | 게시 import 요청 2회 실패 | 에이전트 1이 사용자와 로그 확인 및 원인 해결 담당 |
| 배포 준비 검사 | PC_PUBLICATION_NOT_RECENT | 정상 전체 게시로 해결. 검사 삭제·--app-only 우회 금지 |
| UI/가격/미분류 결함 | 검증·수정 미완료 | 에이전트 2·3 작업. 권한 차단으로 돌리지 않음 |

사용자가 로컬에서 점검할 최소 범위:
1. 13:50~14:01 KST 실패 요청의 Cloudflare Worker/플랫폼 로그에서 원인과 요청 식별자를 확인한다.
2. 가능한 경우 상태코드, 요청 시각, CF-Ray/요청 ID, 비밀값을 가린 오류·응답 발췌만 공유한다.
3. 실제 계정 인증/리소스 권한 거부가 확인되면 해당 계정·리소스의 필요한 권한만 복구한다.
4. 503을 이유로 WAF 전체 해제, CAPTCHA 우회, 토큰 공개, 무작정 재시도하지 않는다.

## 4. 이미 수행된 것으로 확인된 작업

아래 운영 변경의 수행자/세션은 이 문서 작성자가 확정하지 않는다. 저장된 실행 결과와 현재 상태로 확인했다.
- 코드·테스트·문서: `8fcabf5`, `b993ab7`. 이전 미커밋 수정도 포함됐으며 모두 이번에 새로 만든 것은 아니다.
- R3 앱 npm test, 루트 scripts/verify.ps1 및 추가 하네스는 이전 최종 소스에서 PASS.
- 검증 사본 199,225건 처리, RAM 23,694건의 추가 수정. 비RAM 175,531건 결과 해시 보존.
- 운영 원본 백업: 13:20:51, 2,001,731,584바이트, quick_check=ok, 원본 관측 202,242건 일치.
- 운영 정규화: 13:24:40, 202,242건에 v18 적용, 원본 DB 전체 교체 false.
- 현재 pipeline: pc-parser-v8 / pc-rules-v18 / pc-filter-v7 / pc-master-v5.
- Runner 핵심 4개 파일은 13:53 검사에서 로컬 수정본과 SHA-256 일치. 전체 파일 일치 검사는 별도 필요.
- 로컬 검색용 자료: 해당 보고서 시점 19,186개, stale=0/missing=0. 현재 운영 전체의 영구 보증은 아님.
- 국내 실제 검증 수집: 중고나라·번개장터 각각 44개 검색어 성공, 실패/미실행 0.
- 중고나라 수신 299건·새 관측 284건, 번개장터 수신 274건·새 관측 86건.
- 지스킬 한글 27개는 두 소스에서 모두 요청 성공. 요청 제품 일치 결과가 있었던 대상은 각각 9개/11개.
- 요청 성공은 표본 존재·충분한 표본·가격 게시 성공과 다르다. 수신 수는 검색어 간 중복을 포함할 수 있다.

## 5. 아직 안 끝난 상태

- 공개 카탈로그는 public-pc-4, 공개 729개/도구 노드 795개였다(14:02 조회).
- 준비한 v5는 공개 732개/도구 798개 = 가격 선택 788개 + 탐색 전용 메인보드 10개.
- 13:54 마지막 Worker 조회는 cc892532-f8de-4810-89ce-20ffe6ed9f92, 100%. 재배포 전 현재값을 다시 조회한다.
- 현재 로컬 정확 통계 게시 테이블의 완료 게시 수는 0개(14:03 조회).
- Runner 게시 성공 기록은 e0175ff5-cb88-42b1-a2a2-789ba3287c8d, 2,294행, 2026-09-14T13:00:29.118Z 그대로.
- 과거 D1 활성 게시 2,294행과 이번 준비 2,086행의 범위 키 차집합을 실제 D1에서 조사해야 한다.
  행 수 차이만으로 누락을 단정하지 말고, 필요한 모든 범위를 현재 규칙으로 재계산한다. 이전 가격 복사 금지.
- 지스킬 검색: G.Skill/G-SKILL=27, gskill/G SKILL/지스킬=0(14:02 일반 공개 URL).
- G.Skill DDR4 16GB: active 37/sold 8, DDR5 16GB: active 44/sold 5.
  두 응답 모두 v18이지만 평균·중앙값 null, aggregate_incomplete=true, 게시 ID 없음, 구성원 수 null.
  이는 완성된 정확 요약이 아니다. 일별 표본의 합을 고유 매물 수로 단정하거나 '시장 표본 부족'으로 덮지 않는다.
- 새 target set 2,441개 등록과 전체 실행은 다르다. 14:02 health 기준:
  중고나라 44/1,570 성공·1,526 never-succeeded, 번개장터 동일, eBay 0/871 성공·871 never-succeeded.
  실패 수는 세 소스 모두 0이었지만 never-succeeded를 모두 never-attempted로 바꿔 쓰지 않는다.
- all_sources_ready/coverage_ready=true도 전체 대상 실수집 완료가 아니다.
- 화면 배포, D1 대체 경로 정합성, 새 가격 견적 독립 합계, 최종 브라우저는 미완료다.
- 추가 미등록 표현·랜카드 오분류·모바일 잘림·분석 화면 대기 실패는 미해결 검토 대상이다.

## 6. 세 에이전트의 소유권과 실행 순서

- 에이전트 1: 유일한 운영 쓰기/배포/통합 커밋 담당. 게시 503, 배포, 복구, 운영 재수집 실행 담당.
- 에이전트 2: 카테고리·필터·분석/견적 화면·실제 브라우저 담당. 운영 쓰기 금지.
- 에이전트 3: 분류·RAM 단가·정확 통계·수집 증거·독립 API 감사 담당. 운영 쓰기 금지.

각자 01/02/03 역할 문서를 읽는다. 같은 파일의 동시 수정 금지. 공유 파일 변경은 담당자에게 패치 요구로 전달한다.
같은 작업 트리에서는 git add/commit/cherry-pick/배포 패키징을 에이전트 1만 수행한다.
에이전트 2·3은 자신이 바꾼 파일 목록·해시·테스트 결과를 제출한다. git add . 금지.
아직 진행 중인 작업자가 있으면 에이전트 1이 명시적으로 인수하기 전까지 새 운영 작업을 시작하지 않는다.

우선순위: 현재 부분 반영 상태의 안전성 점검 → 503 및 전체 범위 게시 해결 → 정확 가격 계약 검증
→ UI 변경 통합/최종 테스트 → 정식 배포 → 일반 URL API 및 브라우저 재검증 → 결과·커밋 정리.
UI 개선과 읽기 전용 데이터 감사는 병행 가능하다. 기능 재설계 때문에 가격 복구를 불필요하게 늦추지 않는다.

## 7. 공통 금지·검증 기준

- 원본 DB에 사본 전체 덮어쓰기 금지. 13:20 백업 뒤 들어온 실수집 관측을 복구 때 잃지 않는다.
- 현재 v18의 분류 의미를 바꾸면 같은 버전 결과를 몰래 재작성하지 않는다. 후속 버전·검증·전환 계획을 에이전트 1과 합의한다.
- 임의 가격, 사이트 일괄 숨김, 현재 통계를 과거 날짜에 대입하는 처리 금지.
- n<3 대표가격 없음, n=3~4 중앙값. KRW/USD, 시장군, 신품/고장/정상품/묶음, 키트/모듈 단위를 분리한다.
- 공개 GET에서 원 사이트 수집이나 대규모 원시 재집계 금지.
- 기존 승인 소스만 사용. 401/403/429/CAPTCHA/격리는 우회하지 않는다.
- 메인 검색 7개/가격 도구 9개/내부 수집 11개 범위를 몰래 바꾸지 않는다.
  이번 인수인계는 기존 범위의 사용자 선택 개선을 끝내는 작업이다. 메인 검색 7→9 확장은 별도 범위 결정이다.
- 합성 788개 등록 항목 테스트를 시장 전체 매물 검증이나 실수집 성공으로 보고하지 않는다.
- 비밀값·DB·SQL·프로필·HAR·운영 응답 원본·일회성 로그를 커밋하지 않는다.
- 최종 상태는 PASS/FAIL/BLOCKED/해당 없음(이유). 미실행은 '미실행'으로도 명시한다.

## 8. 증거 및 복구 파일

앱 기준:
- `tmp/pc-three-agent-baseline-2026-09-17T05-02-31-284Z.json`
- `tmp/pc-three-agent-preflight-20260917-140256.log`
- `tmp/pc-three-agent-server-20260917-140320.json`
- `tmp/pc-unblock-check-current-evidence-20260917-135348.json`
- `tmp/pc-unblock-check-worker-status-20260917-135400.json`
- `tmp/pc-unblock-check-worker-dry-run-20260917-135152.log`
- `tmp/pc-release-r3-npm-test.log`, `tmp/pc-release-r3-root-verify.log`

서버 보호된 보고서 기준 디렉터리:
`/var/lib/used-market-runner/backups/parts-v18-20260917T021100Z/`

그 안의 `database-backup-manifest.json`, `production-normalization-v18.json`,
`release-real-collection.json`, `production-data-evidence.json`, `local-projection-apply.json`,
`regular-publication.json`, `regular-publication-retry1.json`을 확인한다.
원본 백업 SHA-256: b8d20efb18d4e24dff475bc692dee8b81b48392dea894ba80d53e216c147ba98.
해시는 재사용 명령용 상수가 아니라 기존 증거다. 실행 시 현재 파일과 대조한다.
과거 owner/PID가 고정된 `tmp/pc-release-drain-backup.mjs` 및 배포 스크립트를 그대로 재실행하지 않는다.

## 9. 인수인계 저장 중 발견한 동시 수정 — 14:09:01 KST 추가

문서 작성자가 변경한 것은 이 인수인계 폴더와 tmp 진단 증거뿐이다.
14:02에는 없던 다음 작업 트리 변경을 14:09에 확인했다. 다른 실행에서 작업이 이어지고 있을 수 있으므로,
새 에이전트 1은 먼저 현재 작업자와 변경을 인수하고, 같은 파일을 중복 수정하거나 되돌리지 않는다.
파일 변경만 확인했으며 작성자·테스트 완료·운영 배포 여부는 확정하지 않았다.

- 수정: `aws-runner/import-pc-stats-publication.mjs`, `aws-runner/publish-pc-stats-runner.mjs`
- 수정: `cloudflare/public-product-stats.mjs`, `cloudflare/worker.mjs`, `cloudflare/wrangler.jsonc`
- 수정: `harness/pc-publication-contract.mjs`
- 신규: `aws-runner/pc-stats-publication-client.mjs`
- 신규: `cloudflare/migrations/0015_pc_stats_chunk_staging.sql`

이 신규 client/migration을 존재하지 않는 것으로 가정해 다시 만들지 않는다. migration 실행 여부와 호환성을 별도로 확인한다.
HEAD가 b993ab7이어도 작업 트리가 그 커밋과 같다는 뜻은 아니다. 신규 변경을 포함한 검증·소스 고정 없이 배포하지 않는다.
