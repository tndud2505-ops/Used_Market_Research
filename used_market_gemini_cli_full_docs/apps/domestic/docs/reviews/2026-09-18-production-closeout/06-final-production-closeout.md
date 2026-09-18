# USED PICK 최종 운영 인수 점검 결과

검증일: 2026-09-18 KST
실제 운영 조회 범위: 21:35~21:47 KST
문서 성격: **이번 실행 결과 및 미완료 항목 기록. 운영 전체 완료 선언이 아니다.**

## 1. 최종 판정

**AWS Runner 최신 교체는 차단 상태다.** 기존 서비스를 중지하거나 설치·롤백을 반복하지 않았다. 현재 Python 공개 health 요청의 403을 `1010`까지 특정했지만, 기존 Cloudflare 인증이 BIC 설정 읽기에 `403 / 9109`를 반환해 정책 확인·조정을 완료하지 못했다.

반면 로컬 전체 검사, 현재 Worker 버전 조회, 798개 공개 API 감사, 두 도메인 자산 일치, 과거 미제공 응답 검사와 운영 원장 읽기는 실제로 수행했다. 최신 운영은 과거 보고의 `parts-ux-v4`가 아니라 **`ui-a-v1`** 이다. 후속 담당자는 이 최신 배포를 보존해야 한다.

| 항목 | 판정 | 이번 실제 결과 |
|---|---|---|
| 저장소·기존 작업 보존 | 완료 | HEAD `6b89f1d5d2002e8327626c64de351fc6d62deb0c`; 기존 untracked 8개 보존 |
| 앱 `npm test` | 완료 | exit 0 |
| 루트 `scripts/verify.ps1` | 완료 | exit 0 |
| `git diff --check` | 완료 | 최초 및 21:53:47 KST 최종 확인 exit 0; 소스 수정 없음 |
| SSH / sudo 읽기 | 완료 | 기존 키·기존 호스트·엄격한 호스트 확인으로 exit 0 |
| Worker 현재 버전 확인 | 완료 | `4b0e6967-4927-46ac-b0ee-0b9cb57becb2`, 100% |
| 이번 Worker/UI 배포 | 미실행 | 이미 최신 운영 자산이 로컬과 일치; 재배포하지 않음 |
| 공개 798개 API 독립 감사 | 완료 | exit 0, 798/798 HTTP 200, 계약 실패 0 |
| G.Skill 5개 별칭 | 완료 | 동일한 27개 ID 집합 |
| 두 도메인 자산 대조 | 완료 | 일반 HTML 및 실제 참조 자산 20개 바이트 SHA-256 일치 |
| 미보존 과거 날짜 응답 | 완료 | `2026-09-16` 양 도메인 503 / HISTORICAL_PRICE_STATS_UNAVAILABLE / no-store |
| 정식 배포 preflight | 실패 | 현재 조회에 근거한 `PC_PUBLICATION_NOT_RECENT`, exit 2 |
| 추가 Python 공개 health | 실패 | HTTP 403, `error code: 1010`, CF-Ray 확보 |
| Cloudflare BIC 설정 읽기 | 차단 | HTTP 403 / code 9109; 기존 인증 범위에서 중단 |
| 보안 이벤트·Access 정책 상세 | 미실행 | 관리 API 접근 경계 이후 다른 인증으로 우회하지 않음 |
| 최신 Runner 설치·배포 | 차단 | 정상 공개 검증의 접근 정책이 해결되지 않아 서비스 변경 안 함 |
| 새 패키지·새 복구 사본 | 미실행 | 차단 상태에서 불필요하게 생성하지 않음 |
| 현재 설치 소스 전체 비교 | 미완료 | 설치 파일 hash 수집은 완료; Git/압축/staging/설치 후 4단계 대조는 미실행 |
| 실제 대용량 정기 게시·최종 활성화 | 미실행 | 수동 재게시·자동 실행 성공을 기록하지 않음 |
| 실제 브라우저 검증 | 차단 / 미실행 | 실제 external-ai-orchestrator 스킬 미확보 |
| 원장 구성원 독립 재계산 | 미실행 | API 추적 필드 검사를 원장 재계산으로 확대하지 않음 |
| v19·품질 80개 후속 변경 | 미실행 | v18 분류 의미와 master 유지 |
| 이번 배포 잠금·중단 서비스 | 정리 대상 없음 | owner 생성·서비스 중지·배포 프로세스 실행 0회; 최종 정상 서비스 확인 |

## 2. 과거 CPU 503과 현재 health 403은 다른 사건이다

### 과거 CPU 503 — 기존 해결 보고 유지

2026-09-17의 31,149,081바이트 단일 통계 요청은 `exceededCpu / Worker exceeded CPU time limit`로 실패했다는 기존 실행 증거가 있다. 40행 이하 조각을 비활성 staging에 저장하고 검증 후 활성화하는 기존 수정은 이번에 변경하지 않았다.

과거 성공: 62개 조각, 2,465행, 유표본 범위 1,106개. 이 성공을 **현재 Runner 후보의 새 대용량 게시 성공**이라고 기록하지 않는다. 정기 게시 최종 활성화의 현재 코드 CPU·무결성 통합 검증은 여전히 남아 있다.

### 현재 공개 health 403 — 이번 실제 진단

- 요청: `GET https://runner.used-pick.com/health`
- 실행 위치: 기존 AWS 서버, Python urllib 기본 클라이언트
- 서버 응답 기록: **2026-09-18 21:39:22.617696 KST**
- HTTP: **403**
- Content-Type: `text/plain; charset=UTF-8`
- CF-Ray: **`a3d069be694fea21-ICN`**
- Request ID: 응답에서 확인하지 못함 (`null`)
- 제한된 오류 본문: **`error code: 1010`**
- 자동 재시도, User-Agent·계정·IP 변경: **없음**
- 진단 프로세스 exit 0은 오류 수집 완료를 뜻한다. health 통과가 아니다.
- 로컬 health의 인스턴스는 확인했지만 공개 JSON이 없으므로 이 요청의 local/public 동일 인스턴스 판정은 불가하다.

Cloudflare 공식 문서에서 1010은 클라이언트/브라우저 서명에 따른 접근 차단으로 설명하며 Browser Integrity Check(BIC)를 관련 설정으로 안내한다. 따라서 현재 재현은 CPU·일일 사용량 소진이 아니라 이 접근 차단 계열의 증거다. **2026-09-17 16:33:34 요청에도 동일 규칙이 적용됐다고 소급 확정하지 않는다.** 당시 CF-Ray·본문은 없다.

과거 installer의 공개 검사 PASS와 추가 urllib FAIL도 모두 유효한 별도 기록으로 유지한다.

### 관리 API에서 확인한 정확한 경계

기존 Wrangler OAuth를 그대로 사용했다. 토큰 값은 출력·문서화하지 않았다.

1. `GET /zones?name=used-pick.com` — HTTP 200.
2. `GET /zones/1277954a1cc9364e0d326ce25c556410/settings/browser_check`
   - **2026-09-18 21:45:12.719959 KST**
   - HTTP **403**
   - code **9109**
   - 원문: **`Unauthorized to access requested resource`**
   - CF-Ray: `a3d07234c9ba5503-ICN`

해당 경계에서 중단했다. 다른 토큰·계정으로 반복 호출하지 않았고 BIC/WAF/Access 설정을 변경하지 않았다. 이것을 키 만료, Worker 배포 권한 부재, 유료 플랜 필요로 일반화하지 않는다. 같은 인증으로 Worker 읽기는 성공했다.

필요한 최소 조치: **현재 사이트 소유자의 정상 Cloudflare 관리 세션에서 이 CF-Ray와 설정을 확인하고, 필요한 경우 `runner.used-pick.com`의 `GET /health`에만 BIC를 조정한다.** 전체 WAF·인증·rate limiting 해제는 대상이 아니다. 조정 후 같은 AWS/Python urllib 조건으로 한 번 검증해야 한다.

### 서버 과거 로그의 범위

`2026-09-17 07:32:30~07:34:30 UTC`의 Runner/Tunnel journal 조회는 exit 0, 173개 항목이 있었다. 그중 `/health`, `403`, `exceededCpu`, CPU time limit에 해당하는 검색 결과는 0개였다.

따라서 “과거 로그가 모두 삭제됐다”고 할 근거도, 정확한 차단 규칙을 확정할 근거도 없다. Cloudflare 보안 이벤트 상세·Access 정책은 관리 API 경계 이후 확보하지 못했다.

## 3. 현재 소스와 실제 배포

### 검증 소스

- 저장소: `C:\DeVelop\USED_WEB`
- 앱: `used_market_gemini_cli_full_docs/apps/domestic`
- 검증 HEAD: **`6b89f1d5d2002e8327626c64de351fc6d62deb0c`**
- 커밋 시각: 2026-09-17 22:45:29 KST
- 제목: `feat: release PC pricing and UI updates`
- `pc-price-readiness.mjs` installer 필수 확인·복사·문법 검사 보완은 이미 존재한다. 재패치하지 않았다.
- 이번 애플리케이션·installer·분류기 소스 변경: **0개**
- 이번 새 배포 패키지 / SHA-256: **없음**
- 이번 생성한 전달물은 이 결과 문서와 `07-local-execution-handoff.md`의 다운로드 첨부다. 연결 도구의 파일 전송 허용 호스트 오류로 저장소에 복사하지 못했다.
- 최종 저장소 HEAD는 21:53:47 KST에도 `6b89f1d5d2002e8327626c64de351fc6d62deb0c`였다. 이번 새 커밋·push: **없음**. 두 문서의 저장소 존재 여부도 False로 확인했다.
- 로컬 담당자가 첨부를 지정 폴더에 저장한 뒤 관련 파일만 선별 커밋해야 한다.

### 현재 Worker / UI

- 현재 Worker: **`4b0e6967-4927-46ac-b0ee-0b9cb57becb2`**, 100%.
- 운영 배포 생성 시각: **2026-09-17 22:46:17.838 KST**.
- 버전 생성: 같은 날 22:46:16.585 KST.
- 실제 페이지 마커: **`ui-a-v1`**.
- 2026-09-18 21:45:49~21:45:55 KST, 두 도메인 20개 HTML/실제 참조 자산 SHA-256 일치.
- 이 배포는 이번 실행이 수행한 것이 아니다.
- 15:37 배포 `e93a0857...`와 parts-ux-v4를 현재 최신으로 간주하거나 무조건 복구 대상으로 지정하지 않는다.
- 기존 v4 브라우저 스크립트의 고정 자산 기대값은 현재 UI와 다르다. 현재 운영을 내리지 말고 실제 최신 UI에 맞는 명시적 검증 기대값·선택자를 검토해야 한다.

처음 `npx --no-install wrangler ...`는 CLI 패키지가 없어 exit 1이었다. Cloudflare API 권한 오류가 아니다. 정식 배포 코드가 쓰는 고정 `wrangler@4.121.0`으로 Worker 읽기는 exit 0이었다. 애플리케이션 의존성 파일은 변경하지 않았다.

### 현재 Runner

종료 확인 **2026-09-18 21:47:20.854201 KST**:

| 서비스 | PID | active/substate | enable |
|---|---:|---|---|
| used-market-runner.service | 1987599 | active/running | enabled |
| used-market-tunnel.service | 1987600 | active/running | enabled |

- 로컬 health: HTTP 200, `ok=true`.
- 프로세스 인스턴스: **`68467b95-a693-4af6-9d86-43da17e31260`**
- 프로세스 시작: 2026-09-17 16:33:36.057 KST.
- 롤백 때 시작된 기존 인스턴스가 계속 실행 중이다. 최신 Runner 적용으로 판정하지 않는다.
- 종료 시 `scheduler_active=true`, `publication_active=false`, `active_run=false`. 정상 진행 중인 수집은 종료하지 않았다.
- 시작 점검의 여유 공간: 50,236,411,904바이트.
- local/public의 **새** 동일 인스턴스 검증: 미완료.
- 이번 service stop/restart/install/rollback: 0회.

## 4. 운영 DB·관측·게시 보존

두 번 모두 `mode=ro`, `PRAGMA query_only=ON`, 읽기 트랜잭션으로 조회했다. migrate·초기화·운영 DB 덮어쓰기·수집·재분류·재게시를 실행하지 않았다.

| 테이블 | 21:35 count / max ID | 21:47 count / max ID |
|---|---:|---:|
| raw_listings | 198,104 / 872,864 | 198,312 / 873,072 |
| listing_snapshots | 241,535 / 919,276 | 241,775 / 919,516 |
| normalized_listings | 959,375 / 2,660,067 | 959,900 / 2,660,592 |

기존 정기 수집이 진행되며 기록이 증가했다. 이를 이번 실행의 신규 수집 성과라고 하지 않는다. 위 비교는 count/max ID 감소가 없다는 확인이지 전체 행 동일성 검사 또는 전체 DB 무결성 검사가 아니다.

활성 pipeline은 v18 / pc-parser-v8 / pc-rules-v18 / pc-filter-v7 / pc-master-v5로 유지됐다.

현재 로컬 게시:
- ID: `1d112ab0-6f45-4224-8ba3-a5d026427d86`
- 행 수: **2,465**
- 기준 시각: 2026-09-17 14:14:40.255 KST
- 로컬 게시 시각: 2026-09-17 14:36:59.245 KST
- 로컬 저장 checksum: `893cd30f5474c00fad8e7c84c296a4a1e8b2d8738a77bc2fde708e35a2a21568`
- 21:47 현재 게시 행 digest: `c21384275ec0f5070a2b9197920f363455fcf7b70b1af175fb4f15956ec75276`

마지막 digest는 canonical_product_id/market_pool/condition_code/currency/days 순서의 7개 열(canonical_product_id, market_pool, condition_code, currency, days, through_date, stats_json)을 UTF-8 compact JSON 배열+LF로 해싱한 **이 종료 시점의 값**이다. 시작 시 같은 digest를 계산하지 않았으므로 전후 digest 동일이라고 기록하지 않는다.

D1 payload checksum `317d7c4b...`는 과거 감사 값이다. 이번 D1 저장행 전체 재조회·payload checksum 재계산은 미실행이다. 로컬 저장 checksum, 위 행 digest, D1 payload checksum을 서로 동일 비교하지 않는다.

복구 사본:
- 이번 새 사본/quick_check: **없음**.
- 과거 전체 검사 사본: `/var/lib/used-market-runner/backups/runner-final-20260917T071416Z/`
- 과거 최신 중지 시점 사본: 같은 경로에 `-resume` 접미사.
- 앞선 전체 quick_check PASS와 나중 사본의 DB/WAL 바이트·논리 검사 기록을 구분한다.
- 이 오래된 DB를 현재 운영 원본 위에 덮어쓰면 안 된다. 실제 교체 직전에 새 복구 준비가 필요하다.

## 5. 공개 API·게시 신선도·브라우저

독립 도구 실제 실행:
`node harness/pc-agent3-public-api-audit.mjs --after --publication-id 1d112ab0-6f45-4224-8ba3-a5d026427d86`

2026-09-18 21:42:30~21:43:52 KST, exit 0. 여기서 `--after`는 기존 릴리스에 대한 감사 모드이며 이번에 새로 배포했다는 뜻이 아니다.

- public-pc-5, 공개 732개 / 도구 798개.
- 788개 가격 선택 항목과 10개 탐색 전용 메인보드 분리.
- 9개 부품군 전수 응답 798/798 HTTP 200, 계약 실패 0.
- G.Skill/gskill/G SKILL/G-SKILL/지스킬은 동일 27 ID.
- 현재 공개 가격의 게시 ID·버전·기간·통화·시장·표본 정책·추적 메타데이터 계약 검사 PASS.
- 가격 확보 여부·원장 구성원 재계산·화면 검증까지 통과했다는 뜻은 아니다.

독립 9행/총 10개 수량(RAM 2개) 합계는 이번 API에서도 **1,295,937.32원, 가격 있는 행 7/9의 부분 합계**였다. 과거 금액을 고정 정답으로 재사용한 것이 아니라 새 API 응답으로 재계산한 결과다. 동일한 게시가 유지돼 값이 같았다. 호환 추천 견적도, 브라우저 화면과의 대조 결과도 아니다.

날짜 검사:
- `as_of=2026-09-17`: 실제 해당 게시 기간이 있어 HTTP 200과 계약 검사 PASS.
- `as_of=2026-09-16`: 두 도메인 모두 503 / HISTORICAL_PRICE_STATS_UNAVAILABLE / no-store.
- 과거 날짜가 모두 503이어야 한다고 고정하지 않는다. 존재하는 정확 게시와 미제공 날짜를 구분한다.

정식 preflight:
- 실행 시각: 2026-09-18 21:37:35 KST.
- exit **2**, `AWS_PC_RELEASE_NOT_READY:PC_PUBLICATION_NOT_RECENT`.
- 현재 health에서도 `publication_recent=false`, 마지막 성공은 2026-09-17 14:36:59 KST.
- 이 결과는 현재 조회에 근거한다. API 계약 통과로 게시 갱신 문제를 숨기지 않는다.
- 2026-09-18 02:55~03:30 KST journal 창에는 항목 0개였다. 이 좁은 창만으로 자동 job 미실행/실패 원인을 확정하지 않았다. pc_publication_runtime과 실제 job 설정·trigger 기록 대조가 남았다.
- 이번 수동 daily job / 자동 schedule 성공 확인: 모두 없음.

브라우저:
실제 external-ai-orchestrator/SKILL.md는 확인한 사용자 홈 .codex/.agents/.claude/.gemini 및 C:\DeVelop의 .codex/.agents, 총 6개 후보 경로에서 발견되지 않았다. 전 시스템에 존재하지 않는다고 단정하지 않는다. 가짜 스킬·옵션 삭제·개인 브라우저 프로필 사용 없이 미실행으로 남겼다.

현재 ui-a-v1에서 데스크톱·390×844, 9종 필터/검색/차트/URL, RAM 수량·소수 정밀도, 저장·새로고침·삭제·매물 이동, 독립 API 합계와 화면·스크린샷 검증이 필요하다.

## 6. 수집 현황과 별도 품질 범위

현재 health의 활성 대상 기준:

| 소스 | 대상 연결 | 성공 이력 있음 | 성공 이력 없음 | 실패 표시 |
|---|---:|---:|---:|---:|
| joonggonara | 1,570 | 1,570 | 0 | 0 |
| bunjang | 1,570 | 1,570 | 0 | 0 |
| ebay | 871 | 871 | 0 | 0 |

이 표는 health 집계다. 현재 대상 목록과 원장 행을 독립 join한 전수 감사는 아니다. 과거의 “eBay 871개 미실행”을 현재 상태로 재사용하지 않는다. 소스별 연결 수와 고유 target 2,441개는 다른 분모다.

실제 DB 전체 runtime에는 과거 버전·비활성 소스도 포함된다:
- bunjang 8,389행, joonggonara 10,754행, ebay 6,784행.
- 이 세 소스의 전체 runtime 행에서 last_started_at 없음/성공 이력 없음은 각각 0.
- eBay의 과거 포함 runtime에는 failure_count>0 행 11개가 있다. 위 활성 health의 실패 0과 범위를 혼합하지 않는다.
- crawl_runs의 과거 미종료 RUNNING은 bunjang 9개, joonggonara 5개, ebay 5개. 마지막 시작일은 각각 9월 17일/14일/14일이다. 이 19개가 현재 동시에 실행 중이라는 뜻은 아니다.
- 현재 읽힌 최근 실제 성공: joonggonara 21:36:42 KST 종료, bunjang 21:20:58 종료, ebay 20:48:58 종료. 원장에 SUCCEEDED/finished_at/요청 수를 확인했다.
- 미종료 기록 정리·상태 변경은 하지 않았다.

남은 별도 감사: 활성 target 기준 성공/실패/실제 시도 중/시도 없음/성공 이력 없음의 join 대조, 지스킬 27개별 수신·저장·제품 일치·제외 사유, 통계 원장 구성원 독립 재계산, 품질 80개와 격리 v19 후보 영향 평가. 이들은 Runner 코드 교체 완료와 별도 판정한다. 승인 소스와 메인 7종/도구 9종/내부 11종 범위는 변경하지 않았다.

## 7. 실행 증거와 도구 제약

아래는 모두 앱 상대 경로이며 ignored tmp의 로컬 증거다. 원 응답·로그를 Git에 넣지 않는다.

| 증거 | 내용 |
|---|---|
| tmp/final-closeout-npm-test-20260918.log | 앱 검사 exit 0 |
| tmp/final-closeout-root-verify-20260918.log | 루트 검사 exit 0 |
| tmp/final-closeout-server-before-20260918.json | 서비스·hash 수집·원장·로컬 health 시작 점검 |
| tmp/final-closeout-preflight-20260918.log | 현재 게시 신선도 실패 |
| tmp/final-closeout-python-health-diagnostic-20260918.json | 403/1010/CF-Ray 및 과거 journal 조회 |
| tmp/final-closeout-worker-deployments-20260918.log | no-install CLI 미확보 실패 |
| tmp/final-closeout-worker-pinned-20260918.log | 현재 Worker 버전 조회 성공 |
| tmp/final-closeout-cloudflare-auth-scopes-20260918.log | 기존 인증 범위 확인 |
| tmp/final-closeout-cloudflare-security-read-20260918.json | 설정 GET 403/9109 |
| tmp/final-closeout-runtime-audit-20260918.json | runtime/crawl_runs 집계 |
| tmp/final-closeout-public-api-audit-20260918.log | 독립 감사 요약 |
| tmp/pc-agent3-public-after-2026-09-18T12-42-30-325Z/report.json | 798개 상세 감사 |
| tmp/final-closeout-assets-history-20260918.json | 20개 자산 및 과거 미제공 응답 |
| tmp/final-closeout-server-closure-20260918.json | 최종 서비스·원장·게시 digest·잠금 |

연결 도구에서 별도로 실행 전 거부된 요청:
- 로컬 서버 요약/hash 대조 helper 파일 생성.
- 로컬 migration/ledger 소스 검색 요청.
- 원문: `요청의 보안 상태를 결정하지 못해 이 도구 요청은 OpenAI에 의해 차단되었습니다.`
- 이는 Cloudflare HTTP 403과 다른 사건이다. 서버/HTTP exit를 만들어 붙이지 않았다.
- 거부된 helper는 생성·실행하지 않았고 같은 요청을 다른 셸로 재작성하지 않았다. 독립적으로 허용된 테스트·SSH 읽기·공개 감사는 계속 수행했다.
- 거부 응답 자체에 정확한 초단위 시각이 없어 추정값을 기록하지 않는다.

### 첨부 전달과 저장소 저장의 구분

두 Markdown 파일은 실제 생성·검증했다. 그러나 첫 결과 문서를 저장소로 전송한 `download_artifact`가 다음 오류로 실패했다.

`ChatGPT file download URL is outside the trusted file host (host: oaisdmntprwestus3.blob.core.windows.net).`

이는 Cloudflare 운영 오류가 아니라 연결 도구의 첨부 전송 제한이다. 같은 첨부를 다른 셸·전송 경로로 우회하지 않았다. 2026-09-18 21:53:47 KST 최종 확인에서 지정 06/07 경로 모두 파일 없음, 기존 HEAD·untracked 8개 그대로, staged 변경 없음, diff check exit 0이었다. 따라서 **다운로드 첨부 생성 완료 / 저장소 저장·선별 커밋·push 미실행**으로 판정한다.

## 8. 종료·재개

종료 시 owner 파일 없음, `used-pick-parts-release` 커널 잠금 없음, Runner/Tunnel 정상. 정상 SQLite 잠금은 Runner가 유지하며 해제 대상이 아니다. 이 실행이 띄운 검사 명령은 종료 상태를 확인했다. 사용자의 다른 agent/browser/process는 종료하지 않았다.

**로컬 재개는 `07-local-execution-handoff.md`를 먼저 읽는다.** 이미 최신인 Worker/UI를 다시 배포하지 말고, 정상 공개 health 접근 문제부터 해결한다. 소유권·새 복구 지점·해시 봉인을 확보한 뒤 정식 installer로 Runner를 교체한다. 실제 교체·정기 게시·자동 schedule·브라우저 결과를 각각 별도로 업데이트한다.

---

## 8. 후속 실제 실행 결과 — 2026-09-18 22:36~23:25 KST

이 절은 위 종료 기록 이후 같은 날 수행한 실제 후속 결과다. 완료·실패·복구·차단을 분리한다.

### 완료: `/health`의 1010 해소

- Cloudflare Configuration Rule `Disable BIC for runner health GET`을 생성·활성화했다.
- rule ID: `4871db85134441fb90dc0e412befe396`
- expression: `(http.host eq "runner.used-pick.com" and http.request.uri.path eq "/health" and http.request.method eq "GET")`
- 변경 설정은 Browser Integrity Check OFF 하나뿐이다. 전역 BIC, WAF, Access, rate limit은 변경하지 않았다.
- 같은 AWS Python `urllib` 조건에서 공개 `/health`가 HTTP 200, JSON, local/public 동일 인스턴스로 바뀌었다. 확인 당시 CF-Ray는 `a3d0bd9d2d29aa87-ICN`이었다.
- 복구 방법은 이 rule을 disable/delete하거나 BIC 값을 원복하는 것이다.

### 완료: 결정적 검사와 배포 후보 봉인

- 앱 `npm test`: exit 0.
- 루트 `scripts/verify.ps1`: exit 0.
- `git diff --check`: exit 0.
- 검증 source commit: `5fcc5aea342c05741e54301b5eb02a0a0b2396a3` (`fix: compact PC tools and reject stale price scopes`). 이 commit은 이번 실행 중 외부 동시 작업이 생성했고, 임의 reset하지 않았다.
- LF `git archive` 후보: `used-pick-5fcc5aea.tar.gz`, 22,509,106 bytes, SHA-256 `dd0fac54a30f92b4bb5db5b8b4581b89c2b61c468a2a02b9480c1b2c1bccb90c`.
- 현재 installer에서 다시 산출한 설치 대상은 75개다. manifest SHA-256은 `534b24ba857a0684a9b74f028d36e38e1a75c2231610a3b2e20f7e1e3e48728e`다.
- Git blob → archive → 서버 staging 해시 불일치 0개였다.

### 수행 후 복구: 최신 Runner 교체

- 2026-09-18 22:59~23:05 KST, 단일 lock/owner 아래 정식 installer를 실행했다.
- 온라인 SQLite 복구 사본 `PRAGMA quick_check=ok`, `listing_snapshots=243181`, SHA-256 `8a64329be74567426ce55893e4167edd93063f299c21eeb2a250381964abaa65`.
- 중지 시점 DB/WAL/SHM은 바이트 해시와 논리 요약을 검증했다. 보호 백업 경로는 `/var/lib/used-market-runner/backups/runner-5fcc5aea342c-20260918T135908Z`다.
- 75개 설치 파일 해시, 보호 설정, v18 pipeline, 게시 metadata/runtime/행 digest, count/max ID를 보존했다.
- 인스턴스는 `68467b95-a693-4af6-9d86-43da17e31260`에서 `9828e1e6-7a34-44e4-a450-34d750880a86`으로 바뀌었고 local/public 일치, 두 서비스 enabled+active, owner 제거를 확인했다.
- 그러나 교체 후 공개 API 감사는 798개 모두 HTTP 200이었어도 `EXACT_PUBLICATION_MISSING` 중심 680개 계약 실패를 냈다. 엄격한 새 가격 범위 검사와 오래된 게시를 함께 운영할 수 없다고 판정했다.
- 재게시 선행 검사가 차단된 상태에서 새 코드를 유지하지 않았다. 최신 DB는 덮어쓰지 않고 위 보호 archive에서 코드·설정만 이전 정상 Runner로 복구했다.
- 복구 스크립트의 첫 health가 서비스 준비 전에 실행되어 `connection refused`를 냈지만, archive 추출 전후 전체 DB summary의 완전 일치는 이미 통과했다. 이후 별도 검증에서 이전 158개 파일/설정 SHA-256 일치, 두 서비스 enabled+active, owner 없음, lock 사용 가능, local/public 새 복구 인스턴스 `6403dc8b-78f3-46b9-a152-1ce610e2bdcd` 일치를 확인했다.
- 최종 운영 상태는 **이전 Runner 코드·설정 복구 완료, 최신 DB 보존, Worker/UI 무변경**이다. 따라서 source commit `5fcc5aea...`의 Runner 운영 반영은 완료가 아니다.

### 차단: 게시 신선도와 최신 Runner 재적용

- 기존 활성 게시 ID는 계속 `1d112ab0-6f45-4224-8ba3-a5d026427d86`, runtime checksum `317d7c4b99db53335d27ab2b7471362b38c3f432534467d12385347db0527df0`, 2,465행, 게시 시각 `2026-09-17T05:36:59.245Z`다.
- 수동 `daily-price-refresh` endpoint 호출 전에 predecessor를 독립 확인하려고 AWS Python에서 `GET https://used-pick.com/admin/product-stats-scopes`를 1회 실행했다.
- 2026-09-18 23:10:25 KST, HTTP 403. Cloudflare Security Events는 Browser Integrity Check `Block`, Ray ID `a3d0ef1b0cd23121`, ASN Amazon, user-agent `Python-urllib/3.12`, host `used-pick.com`, path `/admin/product-stats-scopes`, method GET으로 기록했다.
- 403 뒤 다른 user-agent·클라이언트로 재시도하거나 rule 범위를 넓히지 않았다. 실제 `POST /api/runner/run` 호출은 0회이며 새 게시·분할 staging·최종 activation도 0회다.
- 최종 preflight는 `AWS_PC_RELEASE_NOT_READY:PC_PUBLICATION_NOT_RECENT`, exit 1이다.
- 복구 후 공개 API 재감사는 798/798 HTTP 200, 계약 실패 3개다: `ram:corsair:ddr3:16gb:EXACT_PUBLICATION_MISSING`, `ram:corsair:ddr3:4gb:EXACT_PUBLICATION_MISSING`, `ram:corsair:ddr3:4gb:UNAPPROVED_SOURCE:coolenjoy`. 독립 부분 합계는 1,295,937.32원, 가격 있는 행 7/9였지만 이를 새 고정 정답으로 승인하지 않는다.
- 다음 최소 조치는 BIC를 우회하지 않는 정상 인증된 내부 게시 경로를 확보하거나, 사이트 소유자가 exact-path 관리 요청 정책을 명시적으로 결정한 뒤 predecessor GET → 단 1회 daily job → 최종 activation → 새 ID API 감사 → preflight 순으로 재개하는 것이다.

### 자동 스케줄과 브라우저 구분

- 복구 전 `scheduler_active=true`였던 실제 수집은 강제 종료하지 않고 약 6분 기다려 정상 idle로 끝났다. 이것은 daily 게시 성공이 아니다.
- 03:00 KST 자동 `daily-price-refresh`의 미래 성공은 여전히 미실행/미확인이다.
- 실제 브라우저 결과는 아래 절에 기록하며, API 산술을 브라우저 PASS로 대체하지 않는다.

### 실제 브라우저: 부분 PASS, 가격/시장 분리 FAIL

- 실행 중 사용자 작업으로 정식 workspace 스킬 `external-ai-orchestrator/SKILL.md`와 reference 두 개가 추가됐다. 모두 완독했다. 지정 roster script `%USERPROFILE%\.codex\agent-runtime\agent-roster.ps1`는 존재하지 않아 직접 roster route는 실패했다.
- 문서화된 안전 fallback으로 `gpt-5.6-luna`, `reasoning_effort=xhigh` 플랫폼 보조 에이전트를 사용했고, 격리된 Codex In-app Browser에서 `used-pick.com`만 읽기 전용 검증했다. 저장소 수정, 로그인, CAPTCHA, 업로드, 게시, 배포, 실수집은 하지 않았다.
- URL: `https://used-pick.com/computer-builder.html`, `https://used-pick.com/?category_code=RAM&model_id=ram%3Acorsair%3Addr3%3A4gb`.
- desktop 1280×720과 mobile 390×844에서 문서 전체 가로 넘침 없음. 모바일 modal은 x=4.5, width=366, height 약 760으로 clipping 없음. 카테고리 탭의 의도된 내부 가로 스크롤은 유지됐다. console warning/error는 관측되지 않았다.
- PASS: 9개 부품군과 군별 상세 필터, native dialog 열기/닫기/초점 복귀, `지스킬`/`G.Skill`, G.Skill DDR4 16GB, `16GB × 2개 = 총 32GB`, 빈 검색에서 `해당 조건의 모델이 없습니다.`와 이전 가격 제거, 필터 초기화 후 선택·수량 보존, 저장→reload 복구, 삭제 후 `#build=[]`, 매물 이동.
- 부분 FAIL: 수량 `0` 입력 후 blur 시 input은 0/invalid로 남고 hash/build는 기존 quantity 2를 유지했다. 유효한 1을 다시 입력하면 복구됐지만 자동 보정/복구로 판정하지 않는다.
- BLOCKED: 운영 게시 범위가 오래되어 UI가 `선택 기간과 게시 요약기간이 다릅니다. 현재 가격으로 대체하지 않습니다.`, `조회 실패`, `가격 조회 실패`를 표시한다. 따라서 국내 9행/10개 원 API 독립 합계와 화면 합계 비교는 수행할 수 없었다. 격리 브라우저의 direct API navigation도 `net::ERR_BLOCKED_BY_CLIENT`였다.
- FAIL: `국내 전체` radio가 선택된 상태에서도 가격 panel이 `해외 중고 · eBay 통계 · USD · 2026.08.20–2026.09.18`, `US$13.64`, 표본 30건을 유지하고 매물은 0건으로 표시했다. eBay 선택 시 USD 매물 33건은 보였지만 국내로 돌아와도 eBay summary가 남았다. 주 에이전트도 별도 격리 브라우저에서 같은 URL과 `국내 전체` selected + eBay/USD summary 동시 표시를 재확인했다.
- 브라우저 도구가 filesystem screenshot 저장 경로를 제공하지 않아 스크린샷은 실행 중 inline 증거만 남았고 저장소 파일로 만들지 않았다.

공식 근거(2026-09-18 확인):
- Cloudflare Error 1010: https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1010/
- Browser Integrity Check 및 선택적 적용: https://developers.cloudflare.com/waf/tools/browser-integrity-check/
