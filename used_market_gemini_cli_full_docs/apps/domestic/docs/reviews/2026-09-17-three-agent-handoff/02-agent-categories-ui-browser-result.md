# 에이전트 2 — 카테고리·UI·브라우저 결과

> **후속 결과 안내 (2026-09-17):** 사용자의 재개 요청 이후 실제 소스에 단가·조건 초기화·준비 상태·기간 보호 수정을 적용했다. 최신 결과는 같은 폴더의 `02-agent2-resume-result.md`를 따른다. 아래 v3 기록의 “후속 패치 미적용”은 과거 상태이며, 해당 패치를 현재 v4 후보에 다시 적용하면 안 된다. 새 후보의 공개/브라우저 검증은 아직 완료되지 않았다.

## 최종 인수인계 상태 — 2026-09-17, 증거 대조 14:40:14 KST

**PARTIAL_HANDOFF / 수정·독립 검증 수행, 후속 패치 통합 및 브라우저 재검증 대기. 전체 완료 아님.**

`UI_SOURCE_EDITING_STOPPED`: 에이전트 2는 공유 앱 소스의 추가 수정을 멈췄다. 에이전트 1은 아래 해시와 동시 작업자를 대조한 뒤 후보를 통합할 수 있다. 운영 DB·수집·게시·서비스 제어·배포·git add/commit은 이 역할이 실행하지 않았다. 본 문서는 배포 승인서가 아니다.

### 1. 실제 수행 결과

| 검사 | 판정 | 범위와 근거 |
|---|---|---|
| 에이전트 2 신규 회귀 하네스 | PASS | `node harness/pc-agent2-ui-contract.mjs`; 미완료 집계 배제, 표본 정책, 오류 구분, ID/URL, 통화, 등록 필터 경로 |
| 기존 가격 도구 / light-user / UI 하네스 | PASS | `pc-tools-contract.mjs`, `pc-light-user-contract.mjs`, `pc-ui-contract.mjs`를 각각 실행, 모두 exit 0 |
| 가격 선택 788개 / 탐색 메인보드 10개 | PASS | 로컬 등록 범위의 결정론 검사. 실제 시장 전체 매물 검사 또는 전수 수집 성공이 아님 |
| 앱 JS 문법 / 소유 파일 diff 공백 검사 | PASS | JS/core/data `node --check`, 범위 제한 `git diff --check`, 모두 exit 0 |
| 공개 일반 URL/API | PASS, 한정 범위 | 14:33:53–14:34:00 GET 검사. 카탈로그 v5, 지스킬 별칭 5종×동일 27 ID, 대표 9종 KRW 및 RAM eBay/USD |
| 공개·로컬 앱 자산 일치 | PASS | HTML 2개 + JS/core/data/CSS 4개 SHA-256 일치. 14:40 소스 재대조도 일치. 수행자·정식 배포 절차의 적합성을 대신 증명하지 않음 |
| 독립 API ↔ 보존된 브라우저 견적 합계 | PASS | 에이전트 2의 원 API 계산과 다른 실행의 14:32 화면 보고서·이미지를 대조. 같은 게시 ID/기준 시각/구성원 정보와 9개 행을 확인 |
| 직접 브라우저 재실행 | BLOCKED / 미실행 | 필수 `external-ai-orchestrator/SKILL.md` 실제 위치를 찾지 못함. 새 브라우저·개인 프로필을 실행하지 않음 |
| 반올림 단가×수량 표시 | FAIL, 수정 후보 PASS | v3 화면에 `126,238원 × 2 = 252,475원`. 분리 사본 패치는 `126,237.5원 × 2 = 252,475원`으로 교정. 아직 공유 소스 미적용 |
| 조건 초기화의 저장 견적 간섭 | FAIL, 수정 후보 PASS | 기존 reset이 selectCategory를 호출해 저장 부품의 제조사/세대를 다시 적용함. 분리 패치는 필터만 지우고 견적·사이트는 유지. 실제 브라우저 재검증 필요 |
| 모바일 정확한 가로 폭 | 일부 FAIL | 분석 전체 페이지 PNG 폭 391px / 테스트 viewport 390px. 9종 견적 PNG 폭 390px. 기존 +1px 허용을 완전 PASS로 사용하지 않음 |
| 일반 URL에서 최종 브라우저 캐시 검증 | BLOCKED / 직접 미실행 | 검토한 다른 실행의 9종 견적 URL은 `?qa=full` 사용. 별도 일반 URL GET 일치와 브라우저 캐시 검증은 다름 |
| 전체 npm test | PASS (재검사 exit 0) | `tmp/pc-agent2-npm-test-recheck-20260917.log`. 최초 14:29 실행은 공유 게시 테스트 `invalid publication normalization version` / 400≠200로 실패했으나, 다른 역할의 동시 변경 이후 재실행은 통과. 미적용 후속 패치까지 검증한 것은 아님 |
| 운영 배포·DB 쓰기·통합 커밋 | 해당 없음 | 역할 1 전담. 실행하지 않음 |

로컬 로그: `tmp/pc-agent2-ui-contract-final-20260917.log`, `tmp/pc-agent2-tools-contract-20260917.log`, `tmp/pc-agent2-light-user-contract-20260917.log`, `tmp/pc-agent2-ui-existing-contract-20260917.log`, `tmp/pc-agent2-npm-test-20260917.log`.

전체 재검사는 빌드 + test:pc + test:pc-tools를 실행해 exit 0으로 종료했다. 초기 게시 테스트 실패를 숨기거나 하네스를 약화하지 않았고, 역할 1/다른 실행의 공유 코드 변경 이후 결과로 구분했다. 루트 `scripts/verify.ps1`과 미적용 후속 후보의 전체 통합 테스트는 이 역할에서 미실행이며 최종 릴리스 소스 고정 뒤 역할 1의 검사 대상이다.

### 2. 기존 구현과 이번 수정의 구분

이미 존재했던 것은 카테고리별 기본 세부 필터, G.Skill 별칭, 빈 검색 차트 초기화, RAM 개당 가격 정책, 부분 합계 기본 계산, 모바일 CSS, 저장/수량/삭제 기본 흐름이다. 이를 이번 신규 개발이라고 보고하지 않는다. 메인 검색 7 / 가격 도구 9 / 내부 수집 11 범위를 변경하지 않았다. master/분류/수집/API 서버 파일도 수정하지 않았다.

이번에 실제 공유 소스에 추가한 변경:

- 카테고리를 바꾸면 분석 화면의 canonical ID와 URL도 함께 갱신. 빈/잘못된 모델 및 탐색 전용 메인보드 URL이 가격 선택으로 우회 진입하지 않도록 검증.
- `aggregate_incomplete=true`인 대표값이 합계로 들어가는 결함을 먼저 실패 테스트로 재현한 뒤 배제. 비정상 표본 수와 중앙값 범위도 검사. 표본 3~4건은 mean과 median이 같은 값이어도 중앙값으로 표기.
- API 오류, 미제공 통계, 게시 준비 중, 실제 0~2건 표본 부족을 구분. 공개 오류 코드는 보존하되 응답 원문·임의 메시지는 노출하지 않음.
- GPU `칩 제조사`, RAM `모듈 제조사` 구분. 선택 사이트 기준으로 가격 정렬하며 eBay는 USD 데이터로 정렬. 제조사별 견적은 해당 scope를 사용하고 전체 가격으로 되돌아가지 않음.
- RAM `16GB × 2개 = 총 32GB`, 부품별 단가·수량·금액을 추가. 수량 입력 중 표 전체를 교체하지 않고 가격 상세만 갱신. 부분 합계를 명시하고 누락 이유를 안내.
- 모바일 모델 선택 목록에서 모델/가격/조작 버튼을 겹치지 않도록 행 배치와 줄바꿈 조정. 육안 검토에서 모델명·숫자·버튼·축은 식별되지만, 아래 남은 결함 때문에 모바일 전체 PASS는 아님.
- 프런트엔드 전용 회귀 하네스, 원 API 독립 감사 도구, 보존된 브라우저 증거 대조 도구를 추가.

동시 실행의 변경: 최종 `parts-ux-v3` 자산 버전 승격, `coherentStats`의 daily-only source 처리, 기존 `harness/pc-tools-contract.mjs` 추가 변경은 이 역할이 작성하지 않았다. 확인 후 보존했다. 최초 작업의 v2로 되돌리지 않았다. 공개 반영을 이 역할이 수행했다고 주장하지 않는다.

### 3. 9개 부품군 / 독립 실제 가격 대조

등록 필터 검사 수: CPU 186, GPU 94, RAM 216, 메인보드 32, SSD 70, HDD 40, PSU 84, 케이스 36, 쿨러 30 = 788. 탐색 전용 메인보드 10개는 별도 배제했다. 부품별 제조사/세대/소켓/용량/칩셋 등의 기존 카탈로그 범위만 사용했다.

아래는 **비호환 경고 검사용** 구성이지 추천 견적이 아니다. CPU LGA1700 / 보드 AM5 및 RAM DDR4 / 보드 DDR5 충돌이다. 저장된 실제 화면에도 두 충돌 경고가 있었다. SSD/HDD/PSU/케이스/쿨러는 카탈로그의 넓은 구간 참고 시세이며 정확 개별 모델 가격이 아니다.

공통: 국내 전체, KR_C2C_USED, USED_WORKING, KRW, 30일(2026-08-19~2026-09-17). 게시 ID `b4e10072-2262-4e68-939c-5c2d1e0e57ac`, normalization 18 / parser v8 / rule v18 / filter v7. 매 행의 ID·사이트·시장·통화·기간·게시·구성원 정보·단가·수량·행 합계는 아래 JSON에 저장했다.

| 부품 / 검증 ID | 수량 | 판매중 단가 → 행 금액(KRW) | 판매완료 단가 → 행 금액(KRW) |
|---|---:|---:|---:|
| CPU `cpu:intel:i5-12400f` | 1 | 187,688.24 → 187,688.24 | 145,714.29 → 145,714.29 |
| GPU `gpu:nvidia:rtx-3060-ti` | 1 | 318,981.54 → 318,981.54 | 313,300 → 313,300 |
| RAM `ram:g-skill:ddr4:16gb` | 2 | 129,500 → 259,000 | 126,237.5 → 252,475 |
| 보드 `motherboard:msi:pro-b650m-p` | 1 | 없음(1건) | 없음(1건) |
| SSD `ssd:samsung:capacity-bucket:513-gb-1-tb` | 1 | 226,086.36 → 226,086.36 | 218,634.62 → 218,634.62 |
| HDD `hdd:western-digital:capacity-bucket:gt-2-tb-le-4-tb` | 1 | 134,428.57 → 134,428.57 | 123,555.56 → 123,555.56 |
| PSU `psu:seasonic:watts-bucket:751-850` | 1 | 없음(1건) | 없음(0건) |
| 케이스 `case:facet:mid-tower:fractal-design` | 1 | 83,141.5 → 83,141.5 (4건 중앙값) | 없음(0건) |
| 쿨러 `cooling:facet:air-cpu:noctua` | 1 | 86,611.11 → 86,611.11 | 없음(2건) |

독립 계산: 판매중 **1,295,937.32원 / 8개 가격 포함 / 총 10개**, 판매완료 **1,053,679.47원 / 6개 가격 포함 / 총 10개**. 보존된 화면 표시 `1,295,937원`, `1,053,679원`과 원 단위 반올림 기준으로 일치했다. 부족 부품을 0원인 완성 견적으로 만들지 않았다.

eBay RAM 별도 응답: OVERSEAS_USED / USD, 판매중 단가 $92.47 / 수량 2 / $184.94. 국내 합계에 더하지 않았다. 이는 해당 1개 USD scope 검사이지 모든 해외 제품 감사가 아니다.

원 API 증거: `tmp/pc-agent2-public-2026-09-17T05-33-53-976Z/report.json`. 최종 독립 대조: `tmp/pc-agent2-final-evidence-20260917.json`. 가격 기대값 계산에 앱 `buildTotals`, `coherentStats`, `metricValue`를 사용하지 않았다. 원장/원 매물 분류 정확성, 게시 전체 범위 완전성은 역할 3/1의 별도 감사 대상이다.

### 4. 브라우저·이미지 검토의 출처와 한계

에이전트 2는 새 브라우저를 실행하지 않았다. 다른 실행이 만든 `tmp/pc-live-v18-browser/report.json`(14:31:54 시작, 14:32:18 저장)과 이미지들을 덮어쓰기 없는 별도 폴더 `tmp/pc-agent2-reviewed-browser-20260917-1432/`에 보존하고 해시를 기록했다.

기록 검토에서 9종 분석, 별칭/제조사 전환, 빈 검색, 국내/eBay, RAM 2개, 새로고침, 0 수량 복구, 삭제 후 재로딩, 모델 이동이 PASS로 기록돼 있다. JS 오류/자체 API 오류는 그 보고서에서 각각 0개다. 이는 **다른 실행의 기록을 검토한 결과**이며 이 역할의 직접 재실행 PASS가 아니다.

실제로 육안 검토한 보존 이미지:

- `analysis-desktop.png`: 1440×1047 전체 페이지, 모델명·요약·차트 축 식별 가능.
- `analysis-mobile.png`: 391×1256 전체 페이지. 스크립트 viewport는 390×844이므로 가로 1px 넘침이 남음. 카테고리 띠는 가로 스크롤이 필요함.
- `builder-all-parts-desktop.png`: 1440×1327. 9종·RAM 2개·부분 합계·소켓/DDR 경고 확인.
- `builder-all-parts-mobile.png`: 390×2686. 모델명·가격·수량·변경/삭제 버튼 확인. 단가 반올림 식의 불일치는 별도 FAIL. 긴 빈 영역도 보이며 광고/레이아웃 원인 확정은 아님.

모두 위 보존 폴더 기준이다. 새 스크린샷을 이 역할이 생성했다고 하지 않는다. 기존 브라우저 스크립트는 일부 기대값에 앱 helper를 여전히 사용하고, `readyChart`가 상태 대신 특정 `판매중 N건` 문구에 의존하며 `waitForFunction` timeout 인자 위치도 정리가 필요하다. 같은 스크립트가 14:31에 다른 실행으로 변경됐으므로 덮어쓰지 않았다. `?qa=full` 없이 일반 URL에서 최종 재검증하고 시작/실패 단계에서도 증거를 보존하도록 담당자가 조정해야 한다.

### 5. 전달하는 후속 패치 — 공유 소스에는 아직 미적용

파일: `02-agent2-precision-reset.patch` (이 문서와 같은 폴더).

효과: 통계 단가와 부품별 금액의 소수 정밀도를 유지하고 최종 합계 반올림을 안내한다. 조건 초기화는 필터만 초기화하고 저장 견적/사이트를 유지한다. `tmp/pc-agent2-prepare-followup.mjs`가 현재 v3 파일을 해시로 고정해 **분리 사본**을 생성·테스트했다. 원본 소스를 쓰지 않았다.

| 대상 | SHA-256 |
|---|---|
| 패치 적용 전 JS | `53c85ba1e2254be7dee0360e6ac340a4dc40625654905f9f91eb3c0d34b24ac5` |
| 분리 후보 JS | `c3f892632720592f3b6366eba3d8e8800a5492a426c418b8b5bff3b1c9c5b7bd` |
| 패치 파일 | `2cfa790c2635608c10aed818b3086272f3e46255c63bba54610da1f3a7dd4054` |

검사: 후보 `node --check` 및 표시·필터 상태 함수 테스트 PASS. `git apply --check .../02-agent2-precision-reset.patch` PASS(검사만 실행, 미적용). 결과: `tmp/pc-agent2-followup-candidate/result.json`, 로그 `tmp/pc-agent2-followup-contract-20260917.log`.

에이전트 1 통합 요청: 현재 JS 해시와 실제 작업자를 확인한 뒤 패치를 선별 적용하고, 새 자산 cache version을 HTML/import 전체에 일관되게 승격한다. v3로 고정한 역할 전용 하네스 기대값도 승인한 릴리스 manifest에 명시적으로 맞춘다. 새 하네스의 package.json 연결은 역할 1이 한다. 검사 삭제/정식 gate 우회는 하지 않는다. 후보 적용 뒤 일반 URL 브라우저에서 반올림 식·조건 초기화·모바일 1px 넘침을 재검증한다.

### 6. 이번 변경 파일과 현재 통합 소스 해시

다음 6개는 이번 수정과 동시 실행의 버전 승격이 합쳐진 현재 소스다. 모든 변경을 에이전트 2 단독 작성이라고 해석하지 않는다. 기준 14:40:14 KST.

| 앱 상대 경로 | SHA-256 |
|---|---|
| `web-backend/public/pc-tools.js` | `53c85ba1e2254be7dee0360e6ac340a4dc40625654905f9f91eb3c0d34b24ac5` |
| `web-backend/public/pc-tools-core.mjs` | `4110275001e6cb31c4f4aa39ed7cdafcb037aa6f4265b379f49985a6d1fae02e` |
| `web-backend/public/pc-tools-data.mjs` | `d13c415df80386af07e81bd78d421ba91543261ea21e3c6887271e4b30ec8caa` |
| `web-backend/public/pc-tools.css` | `8926c754bc7c892e50853c3a8408656ef700dc4abf17015693242ad0a3c4bffa` |
| `web-backend/public/computer-builder.html` | `d553c5d7a0461960f08d1bd45c5efd4d2dd715a204875698bd2091e0dbaf7e54` |
| `web-backend/public/price-analysis.html` | `d15f299403864b3555e304e88e7e20ad63e88a5f466e97140cdf51fa9b5e9826` |
| `harness/pc-agent2-ui-contract.mjs` (신규) | `8b557d524a4a28ce8488b4c9ec6b7d4168ca92d4d3b3e538c5975f3ee419a425` |

추가 산출물은 이 결과 문서, 위 패치, `tmp/pc-agent2-public-audit.mjs`, `tmp/pc-agent2-prepare-followup.mjs`, `tmp/pc-agent2-closeout.mjs` 및 보호된 tmp 증거다. 도구/이미지/로그 해시는 `tmp/pc-agent2-final-evidence-20260917.json`에 있다. 소스/검사/문서만 선별 통합하고 운영 응답·이미지·일회성 로그·tmp 원본은 커밋하지 않는다. `pc-tools-catalog.mjs`, `index.html`, backend/분류/원장 파일은 이 역할이 수정하지 않았다.

### 7. 필요한 외부 조치와 소유권

직접 브라우저 검증을 재개하려면 저장소 규칙이 지정한 실제 `external-ai-orchestrator/SKILL.md` 위치와 내용을 확인할 수 있어야 한다. 확인한 `.agents/.codex/.claude/.gemini/.agent` 및 저장소 후보 위치에서 발견하지 못했다. 브라우저 실행 자체가 보안 도구에 의해 거부된 결과는 없으며, **필수 스킬 확인 불가로 실행하지 않은 것**이다. 인증키 공개·보안 전체 해제·과금 전환은 요청하지 않는다.

역할 1: 미적용 패치 통합, 공유 게시 테스트의 버전 계약 대조, 소스 고정/새 asset version/정식 배포 검증. 역할 3: 전체 게시 범위·구성원·미등록/분류·실수집 검증. 에이전트 2가 해당 범위를 완료했다고 하지 않는다.

---

## 부록: 작업 중 기록 (현재 상태는 위 최종 절 우선)

## 진행 중 — 2026-09-17 14:21 KST

아래는 당시의 UI_WORK_IN_PROGRESS 기록이다. 현재는 위 최종 인수인계 상태와 해시를 따른다.

- Assigned role: agent 2. No DB writes, collection, publication, service control, deployment or git staging/commit.
- Baseline HEAD: b993ab70070909911eb1c96876d4c6e6afb548f0. Existing runner/Worker/shared-harness changes belong to other work and are not modified here.
- UI files were clean before edits; baseline hashes: `tmp/pc-agent2-baseline-hashes-20260917.json`.
- Initial bundled tool request returned `요청의 보안 상태를 결정하지 못해 이 도구 요청은 OpenAI에 의해 차단되었습니다.` A subsequent minimal `git status --short` succeeded. Do not report all command execution as blocked.
- The required global `external-ai-orchestrator/SKILL.md` has not been located in the repository or checked `.agents`, `.codex`, `.claude`, `.gemini`, `.agent` locations. No new browser or external AI process has been launched by this role. Browser execution remains BLOCKED pending the actual required skill, not attributed to a production API fault.
- Plan: reproduce deterministic UI contract defects; fix owned frontend files; run frontend tests; audit public read-only APIs; document browser/release-dependent checks honestly.

## 14:31 KST coordination checkpoint — source overlap / current public evidence

- At 14:30:36–14:30:41 public GET audit, the normal catalog URL returned `public-pc-5`, 732 public / 798 tool nodes. All five G.Skill spellings returned the same 27 IDs. All nine representative KRW responses identify publication `b4e10072-2262-4e68-939c-5c2d1e0e57ac`; this is no longer the 14:03 incomplete-publication baseline.
- A concurrent execution changed local HTML/import query versions from this role's `parts-ux-v2` to `parts-ux-v3`, and changed `coherentStats`'s daily-only source handling plus `harness/pc-tools-contract.mjs`. Those edits were NOT made by this role. The public JS SHA256 is `53c85ba1e2254be7dee0360e6ac340a4dc40625654905f9f91eb3c0d34b24ac5`, equal to the current local JS at 14:31:37. This role did NOT deploy. Attribution/complete release source freeze is still for the release owner to reconcile; do not overwrite concurrent edits or package a moving tree.
- Agent 2 is stopping further application-source edits while validating this combined v3 state. The independent role-specific regression harness will explicitly check the observed v3 asset contract (not revert to v2).
- Full `npm test` at 14:29 failed in the shared backend `harness/pc-service-contract.mjs` (then line 1145): HTTP 400 instead of 200, `invalid publication normalization version`. Frontend tests were not reached by that command. This role will run them separately; shared publication fixture/implementation reconciliation belongs to agent 1. Evidence: `tmp/pc-agent2-npm-test-20260917.log`.
- Independent raw-API quote: 9 categories / 10 units; active partial 1,295,937.32 KRW for 8/10 units; sold partial 1,053,679.47 KRW for 6/10 units. These are mathematical API expectations, not browser-observed totals. Browser comparison remains NOT RUN / BLOCKED on the required skill.
- Evidence: `tmp/pc-agent2-public-2026-09-17T05-30-36-054Z/report.json`. Existing active browser processes or another execution's screenshots are not this role's browser pass.
