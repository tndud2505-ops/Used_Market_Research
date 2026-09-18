# USED PICK 압축형 UI·가격 오류 진단 — 2026-09-18

## 현재 판정

**실제 코드 수정 및 결정론적 자동 검사 완료. 실제 브라우저 검수·정식 배포·배포 후 검증은 미완료.**

운영 가격 오류의 원인은 공개 GET 응답과 기존 클라이언트 검증 코드를 연결해 확인했다. 날짜가 다른 게시 결과를 성공으로 반환하는 서버 경계 검증을 수정했지만, 최신 정확 집계를 생성하거나 운영에 적용하지 않았다. 따라서 **가격 서비스 복구 완료가 아니다.**

이 문서의 최신 작업 범위가 2026-09-17 A안의 큰 제목·소개 영역·오른쪽 구성 요약보다 우선한다. 새 앱이나 시안 이미지를 만들지 않았다.

## 인수·보존 기준

- 실제 인수 HEAD: `6b89f1d5d2002e8327626c64de351fc6d62deb0c`. 과거 `75849b6`을 현재 상태로 사용하지 않았다.
- 수정 직전 추적 파일과 인덱스는 깨끗했다. `checkpoint/compact-ui-before-20260918` 브랜치를 위 HEAD에 생성했다.
- 다른 작업자의 미추적 배포 셸 파일 및 이전 에이전트 JSON·patch·SHA256 출력은 수정하거나 이 작업의 커밋에 포함하지 않는다.
- 에이전트 1의 HTTP 오류 비밀정보 제거·게시 청크/manifest 무결성 검증은 기존 코드를 재사용한다.
- 에이전트 2의 소수 단가 정밀도·근삿값 기호·필터 초기화·대문자 미제공 상태·기간/통화 검증은 보존한다. `pc-tools-core.mjs`, `pc-tools-catalog.mjs`는 수정 전 기준과 동일하다.
- 이 작업에서는 다른 배포 담당자나 외부 에이전트를 실행하지 않았으며, Worker/Runner 배포를 수행하지 않았다. 다음 배포 전에는 별도로 동시 작업과 배포 소유권을 다시 확인해야 한다.

## 실제 수정 파일

| 파일 | 변경 |
|---|---|
| `web-backend/public/index.html`, `app.js` | 홍보 블록·표어·서비스 배지 제거. `workspace-title`, `workspace-intro`는 화면 공간을 차지하지 않는 접근성용 요소로 보존하고 초기화 기본 문구도 변경 |
| `web-backend/public/computer-builder.html` | 오른쪽 요약 제거, 작은 도구 모음, 전체 폭 부품표, 합계 하나, 공유 주소·선택/상세 native dialog, canonical |
| `web-backend/public/price-analysis.html` | 홍보 영역 제거, 현재 매물 링크를 기존 차트 도구 모음으로 이동 |
| `web-backend/public/used-market-categories.html` | 실제 `/categories` 문서에 공통 헤더·스타일·skip link 적용 |
| `web-backend/public/guide.html`, `privacy.html`, `terms.html` | 공통 스타일 캐시 버전만 변경. 기존 main 본문 보존 |
| `web-backend/public/ui-concept-a.css` | 상단 간격 축소, 7열 native table·44px 목표 행, 표 내부 가로 스크롤, 한 개 합계, 상세창·공유·인쇄 스타일 |
| `web-backend/public/pc-tools.js` | 수량 독립 열, 판매중/완료 단가, 활성 가격만 합산, 미확인 가격의 상태 분리, 상세·재시도, 저장/주소 갱신/복사 실패 표시, 게시 기준 혼합 합산 방지 |
| `web-backend/public/pc-tools-data.mjs` | 검증 실패에도 실제 HTTP 상태와 자체 생성한 공개 요청 URL 보존. 임의 원 응답을 오류 기록에 넣지 않음 |
| `market/logic/pc-price-readiness.mjs` | 과거 요청뿐 아니라 오늘·as_of 생략 요청에서도 게시 기간/일수/as_of와 요청을 검증 |
| `harness/pc-ui-contract.mjs`, `pc-agent2-ui-contract.mjs`, `pc-ui-concept-a-contract.mjs` | 승인된 한 개 합계·새 자산 구조로 갱신. 기존 가격·기간·캐시·통화·오류 안전 조건 보존 |
| `harness/pc-compact-ui-contract.mjs`, `pc-compact-render-contract.mjs` | 새 구조·서버 경계·진짜 UI 함수와 이벤트 핸들러의 결정론적 회귀 검사 |
| `harness/pc-compact-browser.mjs` | 기존 v18 브라우저 하네스를 인수해 native picker·7열·모바일 가로 스크롤·단일 합계·실제 생성 공유 URL·새 격리 컨텍스트 복원 기준으로 갱신. 문법 검사만 완료, 실제 브라우저 미실행 |
| `package.json` | 새 결정론적 검사를 `test:ui-a`와 기존 `npm test` 경로에 연결 |

선택 부품은 `부품 | 모델명 | 수량 | 판매중 단가 | 판매완료 표시가(단가) | 변경 | ×`의 일곱 열이다. 빈 부품도 같은 행의 `미선택 / 부품 선택`이다. 긴 모델명 전체와 RAM 모듈 용량·수량 계산은 모델명 또는 가격 버튼으로 여는 상세창에서 확인하도록 구현했다. 실제 픽셀 행 높이·터치 조작·광고로 인한 넘침은 아직 브라우저에서 검수하지 못했다.

합계는 판매중 대표 단가만 사용한다. 확인된 가격이 없으면 0원을 출력하지 않고 `합계 계산 불가`와 사유를 표시한다. 판매완료 표시가는 행·상세창의 비교 자료이며 실제 체결가 또는 별도 완성 견적으로 표시하지 않는다.

자산 버전: 변경 UI는 `compact-ui-v1`, 실제 수정된 데이터 모듈은 `parts-data-v5`. 수정하지 않은 core/catalog는 `parts-ux-v4`, chart는 `ui-a-v1`을 유지한다. 운영 설정·수집·분류·게시 파이프라인·의존성 manifest/lock은 변경하지 않았다(package.json의 테스트 명령만 변경).

## 2·3페이지 가격 오류 — 현재 응답으로 확인한 내용

2026-09-18 21:55 KST 및 22:28 KST 공개 GET 재조회에서 다음 문제가 계속 재현됐다.

| 항목 | 실제 값 |
|---|---|
| 모델 | `cpu:intel:i5-12400f`, `ram:samsung:ddr4:16gb`, `ram:corsair:ddr3:8gb` |
| 요청 | `days=30`, `market_pool=KR_C2C_USED`, `condition=USED_WORKING`, `currency=KRW`; as_of 생략 또는 `2026-09-18` |
| HTTP | `200` |
| 응답 요청 창 | `2026-08-20 ~ 2026-09-18` |
| 실제 게시 창 | `2026-08-19 ~ 2026-09-17` |
| 게시 기준 시각 | `2026-09-17T05:14:40.255Z` |
| 게시 ID | `1d112ab0-6f45-4224-8ba3-a5d026427d86` |
| 기존 클라이언트 결과 | 요청·게시 기간 불일치를 거부. `HISTORICAL_PRICE_STATS_UNAVAILABLE` 분류 |

기존 서버 경계 검증은 `query.isHistorical`인 경우에만 잘못된 게시 창을 확인해, 오늘 요청에는 오래된 게시 결과를 HTTP 200으로 통과시켰다. 현재 후보는 같은 경우 `EXACT_STATS_NOT_READY` / `PUBLISHED_WINDOW_MISMATCH`, HTTP 503, `Cache-Control: no-store`로 거부하며 오래된 가격을 오늘 가격으로 대체하지 않는다. 이 변경은 합성 응답을 사용하는 실제 guard 함수 테스트에서 확인했으며 **운영 서버에 적용된 결과가 아니다**.

Corsair 문제 모델은 현재 카탈로그의 `Corsair DDR3 8GB Memory Module` / `ram:corsair:ddr3:8gb`로 정확히 확인했다. 요청 날짜를 실제 보존된 9월 17일로 명시하면 기간 검증이 맞는 HTTP 200 결과를 받을 수 있지만, 해당 모델의 판매중 표본은 0건으로 대표가격이 없다. 따라서 **오늘 요청의 기간 장애**와 **해당 보존 기간의 실제 표본 부족**은 별도 문제다.

## 원 API 독립 합계

진단용으로 **보존된 2026-08-19 ~ 2026-09-17**를 명시해 같은 게시 ID·버전·국내 시장·KRW의 자료를 가져왔다. 앱의 `buildTotals`, `metricValue`, `coherentStats`를 기대값 생성에 사용하지 않았다. raw 단가를 소수 정수(BigInt)로 변환한 독립 곱셈·덧셈이며, 오늘 견적이 아니다.

| 모델 ID | 판매중 표본 | 선택값 | 원 단가(KRW) | 수량 | 행 금액(KRW) |
|---|---:|---|---:|---:|---:|
| `cpu:intel:i5-12400f` | 34 | 평균 | 187,688.24 | 1 | 187,688.24 |
| `gpu:nvidia:rtx-3060-ti` | 79 | 평균 | 318,981.54 | 1 | 318,981.54 |
| `ram:samsung:ddr4:16gb` | 87 | 평균 | 141,565.39 | 2 | 283,130.78 |

원 합계 **789,800.56원**, 원 단위 예상 표시 **789,801원**, 수량 기준 가격 확인 4/4개. **실제 브라우저 화면 금액 대조는 미실행**이다. 이 숫자들을 앱 소스에 넣지 않았다.

## 검사와 증거

| 검사 | 확인한 결과 / 기록 |
|---|---|
| 수정 전 새 구조/기간 회귀 | 7개 중 6개 실패, 1개 통과: `tmp/compact-ui-20260918/regression-before.log` |
| `npm run test:ui-a` | 34개 통과(기존 15 + 구조/경계 8 + 실제 함수/핸들러 11): `ui-final.log` |
| `npm test` | build와 기존·신규 전체 결정론적 검사 exit 0: `npm-test-final.log` |
| 기존 source audit | 17개 통과: `tmp/ui-a-implementation-20260917/source-audit.json` |
| 루트 `powershell -File .\scripts\verify.ps1` | 최종 실행 로그 `tmp/compact-ui-20260918/root-verify-final.log` 및 `final-verification.json` |
| 로컬 HTTP smoke | **14/15**, 현재 가격의 기간 검사는 실패. 페이지/자산/카탈로그 성공을 가격 성공으로 처리하지 않음 |
| 실제 브라우저 | **미실행**. opt-in gate가 네트워크·브라우저 실행 전에 중단한 기록만 있음 |
| 정식 배포 preflight | **실패, exit 2**: `AWS_PC_RELEASE_NOT_READY:PC_PUBLICATION_NOT_RECENT` |
| 운영 일반 URL | 기존 UI 유지. 아래 운영 상태 참조. 배포 후 검증이 아님 |

`pc-compact-render-contract.mjs`는 합성 카탈로그/가격과 DOM 대역으로 실제 배포 대상 JS의 함수·입력/선택 핸들러를 실행한다. 브라우저 클릭·픽셀 렌더링 통과를 의미하지 않는다. 검사 범위에는 9종 선택·변경, RAM 16GB × 2, 소수 단가, 단일/부분/미확인 합계, 수량 0·음수·소수·빈값·초과 거부, 생성 공유 URL 복원, 저장·주소·복사 실패, 삭제 후 재초기화, 모델 목록 2·3페이지, 통화·기간 전환 후 과거 데이터 제거가 포함된다.

전체 자동 검사에 나타나는 합성 캐시 오류·의도적 503 경로와 실제 공개 API의 기간 장애는 구분한다. 정상 흐름의 가격 요청 실패를 예상 오류로 일괄 제외하지 않았다.

원 API 진단·독립 합계·최종 일반 URL 결과는 각각 `tmp/compact-ui-20260918/public-audit-before.json`, `independent-public-quote.json`, `final-public-check.json`이다. 원 응답 전체·HAR·프로필·비밀값을 커밋하지 않는다.

## 브라우저 차단과 미실행 범위

현재 파일 검색에서 `C:\Users\tndud\.agents\skills`, `.claude\skills`, `.gemini\skills`는 없었고, `.codex\skills` 및 `C:\DeVelop`의 SKILL.md 파일명 검색에서도 실제 `external-ai-orchestrator/SKILL.md`를 찾지 못했다. 추가 사용자 프로필 전체 검색은 연결 도구의 보안 판정으로 차단됐다. 차단을 다른 도구로 우회하지 않았다.

필요한 최소 조치는 **실제 `external-ai-orchestrator/SKILL.md`를 승인된 `/used_web` 경로에서 읽을 수 있도록 제공하는 것**이다. 임의의 대체 스킬은 만들지 않았다.

1440/1024/768/390/360/320px의 실제 렌더링, 메인 7개 카테고리·필터·관심 저장·원문 링크·목록 2/3 이동, Escape·포커스, 기존 캐시 사용자, 브라우저 저장 장애, 인쇄 결과, 광고/외부 자산, 전체 분석 기간/사이트 전환과 실패·재시도는 운영 수용검사에서 아직 통과 판정할 수 없다. **전후 스크린샷도 없다.** 갱신된 브라우저 하네스도 전체 운영 수용검사의 일부만 구현하며, 그 추가 범위를 결과에 명시한다.

## 배포·운영 상태와 복구 기준

이 작업의 **정식 배포 명령 실행·배포 시각·새 Worker 버전은 없다**. `npm run cloudflare:release`를 실행하기 위한 브라우저 확인과 preflight가 통과하지 않았기 때문이다. `--app-only`, 직접 Wrangler deploy, DB migration, Runner 교체·재분류·수집·전체 재게시로 우회하지 않았다.

읽기 전용 `wrangler deployments status`로 인수 전후 동일한 운영 상태를 확인했다.

- Worker 100% 버전: `4b0e6967-4927-46ac-b0ee-0b9cb57becb2`.
- 기존 배포 ID: `4eef73e8-68e6-422f-9ec3-d0f9eb44eaf9`.
- 그 기존 배포의 생성 시각: `2026-09-17T13:46:17.838963Z` (9월 17일 22:46 KST).
- 코드 복구 기준: `checkpoint/compact-ui-before-20260918` / `6b89f1d5d2002e8327626c64de351fc6d62deb0c`.
- 운영 DB·신규 관측·Worker 상태를 변경하지 않아 이번 작업의 운영 rollback은 실행하지 않았다. 위 Worker는 현재 상태의 식별점이지 이번에 브라우저 검증한 정상 버전이라는 뜻은 아니다.

2026-09-18 22:28 KST 일반 URL 재확인에서 메인·builder·analysis는 여전히 `ui-a-v1`; `/categories`는 기존 별도 스타일이었다. www의 `/`, `/categories`, `/categories/cpu`는 apex로 301→200, builder·analysis `.html` 경로는 www에서 동일 본문을 직접 200으로 제공했다. 따라서 모든 www 경로가 리다이렉트한다고 보고하지 않는다.

현재 준비된 후보는 코드·자동 검사 기준점이며, **브라우저 승인 또는 배포 승인 상태가 아니다**. 최신 정확 게시를 복구하고 실제 스킬의 절차로 브라우저를 검수한 뒤, 고정한 동일 후보에 전체 검사·정식 release·일반 URL/기존 캐시 재검증이 필요하다. 커밋 ID와 push 여부는 최종 실행 기록 및 작업 응답을 참조한다.
