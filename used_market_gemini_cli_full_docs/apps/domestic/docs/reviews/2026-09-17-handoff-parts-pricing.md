# USED PICK 후속 실행 인수인계 — 운영 반영·수집·가격 검증 완료용

## 용도와 기준 시점

이 문서는 같은 작업 공간에서 남은 작업을 실제로 수행하기 위한 인수인계서다. 새 설계 제안서나 완료 보고서가 아니다.

운영 상태의 마지막 직접 확인은 **2026-09-17 10:24 KST**다. 로컬 소스와 보조 스크립트는 인수인계 작성 시 다시 읽었다. 이후 실제 파일·DB·공개 응답이 바뀌었다면 현재 상태를 우선한다.

이전 문서의 “재분류 진행 중”, “통계 저장부 수정 미적용”은 과거 상태다. **복사본 181,194건 재분류는 검증 통과했고, 운영 원본 반영·전체 통계 게시·Worker/UI 배포·최종 실사용 검증은 아직 완료되지 않았다.**

## 1. 원래 사용자 요청과 이번 작업자의 임무

사용자는 https://used-pick.com/ 및 C:\DeVelop\USED_WEB에서 기존 하네스에 따라 일반 사용자가 컴퓨터 부품을 고르기 쉽게 카테고리를 개선하고, 부품별 수집·검색 누락과 컴퓨터 맞추기·가격 분석 반영을 끝까지 확인하라고 요청했다. 특히 G.Skill이 검색되지만 가격 분석에서 빠지는 문제를 해결해야 한다.

사용자는 여러 차례 계속 진행하고 모두 작업하라고 요청했다. **계획만 제출하거나 “배포만 남았다”면서 정상적으로 수행할 수 있는 작업을 중단하지 않는다.**

종료점은 **남은 결함 수정 → 운영 원본 보호 → 일관된 분류·매물·통계 반영 → 서버·화면 배포 → 실제 수집 → 공개 API·브라우저의 검색/가격/견적 검증 → 증거가 있는 최종 보고**다.

기존 승인 범위는 이어서 수행한다. 접근 권한 부족·보안 차단·외부 수집 제한을 우회하거나 유료 자원·미승인 소스를 임의로 추가하지 않는다. 진짜 외부 차단이 있으면 완료로 포장하지 말고 정확한 지점과 사용자에게 필요한 최소 조치를 알린다.

## 2. 작업 공간과 운영 위치

```text
저장소: C:\DeVelop\USED_WEB
가상 경로: /used_web
앱: C:\DeVelop\USED_WEB\used_market_gemini_cli_full_docs\apps\domestic
앱 가상 경로: /used_web/used_market_gemini_cli_full_docs/apps/domestic
작성 시 HEAD: 612a60fc1e742c9d01182f415becaeda3eebb902

웹: https://used-pick.com/
Runner: https://runner.used-pick.com/
이전 확인 SSH: ubuntu@13.125.31.116
기존 로컬 키: %USERPROFILE%\.ssh\LightsailDefaultKey-ap-northeast-2.pem
서버 앱: /opt/used-market-runner
운영 DB: /var/lib/used-market-runner/search-index.sqlite
보호된 환경 파일: /etc/used-market-runner/runner.env
서비스: used-market-runner.service / used-market-tunnel.service
```

**수정본은 미커밋 로컬 작업 트리에 있다.** 수정된 추적 파일 29개 외에 신규 코드·테스트·문서가 있고 `tmp/`의 보조 도구·증거는 Git에서 무시된다. 원격 저장소를 새로 clone하는 것만으로는 이어받을 수 없다.

`git reset --hard`, `git clean`, 작업 트리 일괄 복원/삭제를 하지 않는다. 기존 사용자 임시 파일과 다른 프로젝트 변경을 보존한다. 마지막에는 본 작업의 검증된 소스·테스트·문서만 선별 커밋하고, push는 저장소 규칙·승인 범위에 맞춘다.

SSH 서버의 프로젝트 정체성을 앱·DB·서비스로 다시 확인한다. 기존 인증을 쓰고 키/토큰/환경 파일 내용을 출력·커밋하지 않는다. 호스트 키 검사를 끄지 않는다.

처음 읽을 파일:

```text
# 루트
AGENTS.md
README.md
used_market_gemini_cli_full_docs/SETUP.md
# 적용되는 하위 AGENTS.md도 확인

# 이하 앱 상대 경로
README.md
package.json
docs/wiki/05-harness-loop.md
docs/wiki/04-cloudflare-runner.md
docs/AI_CONTEXT.md
DEPLOYMENT.md
docs/reviews/2026-09-16-light-user-parts-audit.md
docs/reviews/2026-09-16-continuation-qc.md
```

외부 AI·에이전트 기반 브라우저 검증은 루트 규칙의 `external-ai-orchestrator` 스킬을 적용한다. 실제 제공 위치에서 확인하고 읽지 못한 것을 읽었다고 하지 않는다.

동시 작업자가 있는지 확인하고 운영 DB 쓰기·배포 담당을 한 명으로 정한다. 과거 “다른 작업 스트림” 기록만 보고 누군가가 나머지를 처리할 것으로 가정하지 않는다.

## 3. 완료된 구현·검증과 남은 운영 상태

### 로컬 수정본

- 부품별 필터: CPU 세대/소켓, GPU 세대/VRAM, RAM DDR/개당 용량, 메인보드 실제 제조사/소켓/칩셋, SSD·HDD 용량 구간, 파워 정격 출력, 케이스 크기, 쿨러 종류.
- `G.Skill`, `gskill`, `G SKILL`, `G-SKILL`, `지스킬` 검색을 통일했다. 검색 전용 별칭과 제품 식별 별칭은 분리한다.
- RAM `32GB(16GB×2)`를 16GB 모듈 2개로 연결하고 총액과 개당 가격을 분리했다. Samsung B-die 같은 칩 제조사와 모듈 제조사를 구분한다.
- 불명확한 키트·방열판만 판매·고장품·완제품·다른 부품 묶음은 단품 대표가격에서 제외한다.
- 일별 통계를 잘못 합쳐 중앙값이 사라지던 문제에 대해 **완전한 게시 단위의 정확한 전체/사이트별 요약 저장·조회 경로**를 추가했다.
- 조건 변경에 따른 분석 모델 동기화, 빈 검색의 이전 차트 제거, 표본 부족·부분 합계 안내와 모바일 표를 개선했다.
- 케이스·쿨러의 정상 중고 단품을 제조사×종류 참고 시세에 연결했다. 정확 모델별 시세라는 뜻은 아니다.
- 메인보드 정확 모델 3개 추가: MSI MAG B650 TOMAHAWK WIFI, MSI PRO B760M-A WIFI DDR4, ASRock B550M Steel Legend.
- 전수 검사에서 발견한 Core Ultra 12종, Vega 56/64, Radeon VII, ASUS ROG CROSSHAIR VIII IMPACT의 추가 분류/가격 연결 결함을 수정했다.
- 재분류 동안만 승인 별칭 조회 집합을 재사용하는 최적화를 추가했고 **985개 입력에서 기존 결과와 동일함**을 테스트했다. 일반 운영에 오래된 캐시를 남기는 방식이 아니다.

```text
기존 운영: 공개 729개 / 도구 795개 / 가격 선택 가능 785개
준비된 v5: 공개 732개 / 도구 798개 / 가격 선택 가능 788개
메인보드: 정확 모델 32개 + 탐색 전용 분류 10개
가격 도구: 9개 부품군
내부 수집: 확장카드/ODD 포함 11개 부품군
```

788개 검증은 정상적으로 기술된 합성 매물이 등록 항목과 통계로 연결됨을 뜻한다. 모두 실제 매물이 있거나 시장 전체를 등록했다는 뜻이 아니다. 숫자는 현재 카탈로그에서 다시 산출한다.

### 운영 DB 복사본 검증 — 이미 완료

```text
검증 소스:
/var/lib/used-market-runner/staging/parts-v18-20260916-source
검증 DB:
/var/lib/used-market-runner/staging/parts-v18-20260916/pc-v18-stage.sqlite
보고서:
/var/lib/used-market-runner/staging/parts-v18-20260916/pc-v18-stage-report.json
로그:
/var/lib/used-market-runner/staging/parts-v18-20260916/stage-r2.log

확인 결과: phase=staging_passed / snapshots=181194 / decision=ACTIVE / groups=84
```

181,194는 관측 기록 수이지 고유 매물 수가 아니다. 84개 그룹은 지스킬·메인보드·케이스·쿨러 중심 미리보기이며 운영 전체 가격 게시가 아니다. `ACTIVE`는 검증 DB 상태다. 보고서·소스 일치를 확인해 유효한 결과를 재사용하고, 이미 끝난 검증을 이유 없이 반복하지 않는다.

### 실제 운영 — 마지막 확인 시 이전 버전

```text
catalog: public-pc-4
normalization: 17
parser: pc-parser-v7
rule: pc-rules-v17
filter: pc-filter-v6
target set: pc-targets:4:full-master-v12
정기 수집: 최근 실행 확인
publication_recent: false
마지막 게시 성공: 2026-09-14T13:00:29.118Z
제품 선택 검색: G.Skill 27개 / 지스킬 0개
운영 반영 완료 마커: 없음
```

지스킬 가격 응답의 중앙값 누락도 남았다. 로컬 수정 완료와 운영 해결을 구분한다.

목표 버전 묶음:

```text
versionKey: pc-normalization-v18-parts-prices
normalizationVersion: 18
parserVersion: pc-parser-v8
ruleVersion: pc-rules-v18
filterVersion: pc-filter-v7
modelVersion: pc-master-v5
catalog: public-pc-5
target set: pc-targets:5:full-master-v13
declared targets: 2441
```

더 새 버전이 운영 중이면 v18로 되돌리지 않는다. 분류 의미를 바꾸면 동일 버전의 과거 결과를 몰래 덮어쓰지 않는다.

## 4. 파일과 테스트

핵심 구현:

```text
market/logic/pc-product-search.mjs
market/logic/pc-parts-classifier.mjs
market/logic/pc-parts-directory.mjs
market/logic/pc-public-catalog.mjs
market/data/pc-product-master-v2.mjs
cloudflare/pc-directory-http.mjs
aws-runner/pc-shadow-pipeline.mjs
aws-runner/pc-parts-ledger.mjs
aws-runner/pc-stored-price-publication.mjs
aws-runner/pc-price-stats-http.mjs
aws-runner/publish-pc-stats-runner.mjs
aws-runner/complete-pc-stats-publication.mjs
aws-runner/import-pc-stats-publication.mjs
aws-runner/reclassify-pc-snapshots.mjs
aws-runner/republish-pc-projections.mjs
aws-runner/reconcile-local-pc-projections.mjs
aws-runner/pc-staged-normalization-import.mjs
web-backend/public/pc-tools-catalog.mjs
web-backend/public/pc-tools-core.mjs
web-backend/public/pc-tools-data.mjs
web-backend/public/pc-tools.js
web-backend/public/pc-tools.css
web-backend/public/computer-builder.html
web-backend/public/price-analysis.html
web-backend/public/index.html
```

주요 테스트:

```text
harness/pc-light-user-contract.mjs
harness/pc-stored-price-publication-contract.mjs
harness/pc-local-projection-contract.mjs
harness/pc-catalog-ingestion-contract.mjs
harness/pc-reclassification-alias-contract.mjs
harness/pc-staged-normalization-import-contract.mjs
```

```powershell
# 루트
powershell -NoProfile -File .\scripts\verify.ps1
git diff --check
# 앱
npm test
node harness/pc-staged-normalization-import-contract.mjs
```

staged-import 테스트는 작성 시 `npm test` 연결 목록에 없으므로 별도 실행한다. 기존 전체 테스트·루트 검증·로컬 브라우저·125개 fixture 품질 평가가 이전 실행에서 통과했다. 코드가 바뀌면 관련 및 최종 전체 테스트를 다시 한다. fixture를 새 독립 인간 검수 데이터라고 표현하지 않는다.

```powershell
# 로컬 합성 가격 검증 — 실제 운영 증거가 아님
node tmp/pc-light-user-browser.mjs
# 배포 후 실제 API 전수 검사
node tmp/pc-resume-full-audit.mjs --after
# 배포 후 실제 API+브라우저 검증 — 모의 데이터 대체 없음
node tmp/pc-live-v18-browser.mjs
```

기존 증거: `tmp/pc-resume-full-audit-before.json`, `tmp/pc-resume-catalog-pipeline-audit.json`, `tmp/pc-light-user-live-audit.json`, `tmp/pc-light-user-browser/`.

운영 `--after`와 브라우저 최종 성공은 아직 확인되지 않았다. 스크립트 존재와 성공 보고서를 구분하고 새 실행에서는 이전 증거를 보존한다.

## 5. 보조 도구의 위험 지점 — 읽고 검증한 뒤 실행

### 배포 스크립트가 전체 완료 절차는 아니다

`tmp/pc-deploy-v18.sh`는 백업·재분류·지스킬 수집·로컬 매물 반영·Runner 설치를 포함하지만, **전체 통계 생성/검증/재게시와 Worker/UI 배포를 포함하지 않는다.** 이것만 실행하고 전체 완료라고 하지 않는다.

Runner·터널을 중단한 채 긴 재분류·수집·설치를 수행하므로 중단 시간이 길어질 수 있다. 외부 설치/통신 전제는 미리 확인하고 안전한 데이터 준비·최신분 반영 방식으로 중단을 줄인다. 새 분류만 활성화하고 불완전한 가격을 노출하지 않는다.

복구는 로컬 코드·DB·환경·서비스뿐 아니라 **D1 활성 게시와 Worker 버전**까지 일관되어야 한다. 로컬 DB 복원만으로 외부 게시까지 복구됐다고 가정하지 않는다.

### 재분류 및 복사본 재사용

직접 `reclassify-pc-snapshots.mjs` CLI는 `pipeline.initialize()`를 실행하지 않는다. 새 master 등록 전 바로 적용하면 정상 제품도 미등록으로 떨어질 수 있다. 래퍼의 초기화 순서와 중첩 트랜잭션 여부를 확인한다.

검증 DB 전체를 운영 DB에 덮어쓰면 이후 수집 기록을 잃는다. 하지 않는다.

`pc-staged-normalization-import.mjs`는 별도 테스트를 통과했지만 **운영 스크립트에 연결되지 않았다.** 원본 일치·스키마·버전·품질·자식 ID/외래키를 검증한 경우만 쓴다. 이후 `last_seen_at` 등 원본 값이 바뀌면 일치 검사가 실패할 수 있다. 검사를 없애 통과시키지 말고 안전한 재분류/변경분 처리 경로를 선택한다. 미리보기 게시·수집 성공 기록은 복사하지 않는다.

### 해시·패키지·과거 PID

```text
로컬: tmp/pc-v18-source.tar.gz
작성 시 bytes: 557391
sha256: 266f9b50b2fb045e787ce78ad24f51fa52b4643e4329739560269d144b285a2b
이전 서버 업로드: /tmp/used-pick-parts-v18-20260916-r2.tar.gz
```

소스/스크립트를 바꾸면 내용 목록·패키지·해시·검증 증거를 갱신한다. 해시만 바꾸어 검사를 무력화하지 않는다. 이 패키지는 Runner 소스이며 화면 자산 배포까지 대신하지 않는다. 사용할 신규 파일이 실제 포함됐는지 확인한다.

`pc-stage-v18.sh`, `pc-create-stage-copy.mjs`, `pc-resume-stage-v18.sh`는 이미 완료된 검증의 과거 도구다. 기존 파일 조건·과거 PID가 있으므로 그대로 재실행/종료 명령을 내리지 않는다.

### 감사 스크립트의 범위와 캐시

`pc-resume-full-audit.mjs --after`는 현재 모든 도구 노드에 정규화 18을 요구한다. 메인보드 탐색 전용 10개 분류는 가격 선택 대상이 아니므로 문서화된 빈 응답/버전 표기와 검사 조건을 대조한다. 이들은 선택 불가·대표가격 없음을, 실제 가격 대상 788개는 버전·정확 게시·통계 일치를 확인하도록 구분할 수 있다. 실제 결함을 임의 제외하거나 합격 기준을 낮추지 않는다.

G.Skill 27개 모두를 검색 가능하게 해야 하지만 모두에 가격을 만들어 넣으면 안 된다. 표본 없음·부족과 정상 표본의 잘못된 누락을 구분한다.

공개 PC 읽기 캐시는 작성 시 300초 TTL·고정 네임스페이스다. 캐시 회피용 쿼리만 확인하지 말고 일반 사용자의 원래 URL에서도 새 버전·통계가 나오는지 확인한다.

`publication_recent=false` 원인을 조사해 정기 게시 경로 자체를 복구한다. 수동 게시 1회로 정기 게시 오류를 숨기지 않는다.

## 6. 후속 실행 순서

### 1단계: 현황 확인·검증 결과 재사용

Git, 운영 버전, 정기 수집/게시 로그, 스테이징 보고서, 이후 관측 수, 동시 실행을 읽기 전용으로 확인한다. 과거 숫자를 현재값으로 복사하지 않는다.

181,194건 검증 결과가 적용 소스와 일치하면 활용한다. 긴 재분류를 다시 돌리기 전에 필요성을 판단한다. `docs/reviews/2026-09-17-completion-checklist.md` 등에 상태·명령·증거·시각을 기록한다.

### 2단계: 남은 결함·배포 준비

기존 수정본을 재설계하지 말고 목표 달성을 막는 결함만 고친다. 원래 매물 검색, 제품 선택 검색, 분류, 통계 저장, 견적/분석의 제품 ID를 대조한다.

실제 관측의 미분류·미등록·가격 제외 목록도 점검해 정상 제외와 잘못 누락된 일반 부품을 구분한다. 카탈로그 순회만으로 끝내지 않는다. 새 정확 모델은 제조사 자료로 규격·변형·리비전을 확인하고 테스트한다.

7개 공개/9개 가격/11개 수집 범위를 유지한다. 넓은 참고 시세를 정확 모델 가격처럼 표시하지 않는다. 테스트·디스크·백업·코드/DB/게시/Worker 복구 경로를 확인해 배포 절차를 완성한다.

### 3단계: 운영 분류·매물·통계 일관성

원본·코드·보호된 설정·서비스 파일·이전 Worker 버전·활성 게시 ID를 보존한다. 백업은 존재·크기·읽기 가능성과 복구 절차까지 확인한다.

동시 쓰기를 제어해 운영 DB에 새 버전을 별도 준비한다. 검증 이후 관측도 보존하고 대상 전체 처리 여부를 확인한다. 검색용 자료와 D1 대체 경로도 갱신해 오래된 잘못된 제품 ID가 한쪽에 남지 않게 한다.

전체 가격 통계는 활성 D1 범위를 **현재 다시 조회**해 누락 없이 준비한다. `tmp/pc-v18-active-d1-scopes.json`은 과거 결과다. 새 범위만 올려 기존 정상 제품을 지우거나 이전 버전 통계를 그대로 섞지 않는다.

`complete-pc-stats-publication.mjs`, `import-pc-stats-publication.mjs`, `publish-pc-stats-runner.mjs`의 입력·전제·역할을 읽고 맞는 순서로 사용한다. 전체 범위·버전·행 수·checksum·시각·구성원 추적·승인 소스·시장군·통화·판매완료 근거를 검증한다.

완전한 게시 승인 후 정확한 로컬 요약과 공개 읽기를 연결한다. 준비되지 않은 신규 버전을 먼저 노출하지 않도록 기존 정상 읽기/대체 경로 또는 검증된 전환 절차를 사용한다. 부분 게시를 성공으로 처리하지 않는다.

### 4단계: 실제 수집·정기 운영 복구

이전 승인·활성 소스는 중고나라·번개장터·eBay였다. 현재 레지스트리·승인·운영 상태를 재확인한다. 403/429/CAPTCHA/격리를 우회하지 않는다.

새 한글 G.Skill 27개 대상의 운영 등록과 승인 국내 소스의 실제 실행 결과를 기록한다. 설정 등록이나 스테이징 활성화만으로 수집 성공 시각을 만들지 않는다.

9개 부품군 대표 수집/저장/검색 반영을 확인하고, 전체 2,441개 대상의 등록·스케줄·성공/실패/미실행을 구분한다. 기존 85개/run 용량과 요청 간격/동시성 제한을 유지한다. 미실행 검색어를 검증 완료로 보고하지 않는다.

정상 매물은 새 통계에 포함되고 부적합 매물은 근거와 함께 제외되는지 확인한다. 수집 후 통계 갱신까지 수행한다. 정기 수집·게시가 복구됐는지 새 버전 정상 실행 증거를 확인한다. 관찰하지 못한 다음 주기의 성공을 추측하지 않는다.

### 5단계: 배포·공개 API·실제 브라우저

정식 릴리스/배포 스크립트와 준비 상태 검사를 사용한다. 이번 작업은 화면만 바꾸는 일이 아니므로 `--app-only`를 준비 상태 검사 우회 목적으로 쓰지 않는다.

실패 시 원인을 고치거나 복구한다. 앱 페이지 응답만으로 가격 시스템 정상이라고 판단하지 않는다. 전수 감사와 실제 브라우저를 실행하고, 모의 데이터로 대체해 운영 검증을 통과시키지 않는다. 테스트 결함과 서비스 결함을 구분한다.

브라우저/프로필은 1~2개 내에서 재사용·종료한다. RAM 단독뿐 아니라 9개 부품군·RAM 2개가 포함된 10개 수량 조합의 실제 API 합계와 화면을 비교한다. 의도적 비호환 테스트는 추천 견적이라고 표현하지 않는다.

## 7. 데이터 기준

- 공개 GET에서 원본 사이트 수집이나 대규모 원시 재집계를 하지 않는다.
- n<3 대표가격 없음, n=3~4 중앙값, n>=5 지원되는 평균/중앙값 정책을 유지한다. 없는 값을 최솟값/다른 통계로 꾸미지 않는다.
- 같은 매물의 여러 날 관측을 고유 매물 수로 오인하지 않는다. 일별 중앙값 평균을 기간 전체 정확 중앙값이라고 하지 않는다.
- KRW/USD, 시장군, 정상품/고장/신품/묶음을 계약대로 분리한다.
- 판매완료 마지막 표시가는 체결가가 아니다. 삭제·접속불가는 판매완료 근거가 아니다.
- 모듈 제조사/칩 제조사, 키트 총용량/개당 용량, 총액/개당 단가를 구분한다.
- 표본 부족은 명시한다. 0원 완성 견적이나 다른 제조사의 가격으로 대체하지 않는다.
- 사이트 통계를 전부 숨겨 오류 0건을 만드는 것은 수정이 아니다.
- 과거 조회에 현재 요약을 넣지 않는다. `as_of`, `published_window`, 차트 기간을 맞추거나 지원 불가를 명확히 표시한다.

## 8. 완료 판정표

| 항목 | 실제 완료 기준 |
|---|---|
| 소스·테스트 | 변경 보존, 최종 소스 전체/추가 테스트·diff 검사 통과 |
| 운영 버전 | 목표 버전 묶음 일치 또는 후속 버전 사용 근거 기록 |
| 지스킬 검색 | 5가지 표기의 동일 등록 집합 및 일반 사용자 검색 확인 |
| 지스킬 가격 | 27개 전수 확인, 정상 표본/부족/없음/제외 이유 기록, 내부 오류로 충분한 표본이 누락되지 않음 |
| RAM 수량 | 32GB(16GB×2)의 16GB 모듈 단가·수량 2배 확인, 불명확 키트 제외 |
| 부품 범위 | 9개 가격 부품군 및 관측 미분류/미등록 점검, 탐색 전용과 가격 대상 구분 |
| 연결 | 검색·통계·도구의 ID/조건/통화/기간 일치, 지원되는 정상 가격의 분석·견적 반영 |
| 게시 | 활성 게시 ID/checksum/행 수/버전/시각/구성원 추적 일치, 주요·대체 읽기 경로 정합성 |
| 수집·정기 게시 | 새 검색어 실수집 및 저장, 정기 오류 복구, 미실행 대상 별도 표시 |
| 견적 | 9개 부품·RAM 2개 실제 가격 독립 합산과 화면 일치, 부분 합계 및 확인 가능한 호환성 경고 |
| 화면 | 조건 전환·빈 결과·수량·저장/새로고침/삭제·매물 이동·사이트/통화 전환 |
| 모바일·캐시 | 읽을 수 있는 표·차트, 일반 URL 새 결과, 중요한 자체 API/브라우저 오류 없음 |
| 종료·복구 | 정상 서비스, 임시 작업 정리, 보호된 백업·복구 지점·결과 문서 유지 |

각 항목에 `PASS / FAIL / BLOCKED / 해당 없음(이유)`를 기록한다. 진짜 표본 부족은 데이터 오류가 아니지만, 원인 미확인 누락을 표본 부족이라고 덮지 않는다. 실제 실행 안 한 항목은 PASS가 아니다.

## 9. 최종 보고와 진행 방식

`docs/reviews/2026-09-17-parts-pricing-release-result.md` 등에 다음을 남긴다.

1. 실제 배포 여부·시각·코드/Worker/분류/게시 버전.
2. 9개 부품별 등록·검색·수집·가격 표본·가격 없음·오류 현황.
3. G.Skill 원인과 운영 전후 값. HTTP 200만으로 끝내지 않는다.
4. 실제 API 독립 계산 견적과 화면 합계·수량·부분 합계 검증.
5. 통과 명령, 감사 JSON·브라우저 보고서·화면 증거 위치.
6. 보호된 백업·복구 지점과 남은 범위 제한. 비밀값 제외.
7. 커밋 상태와 배포·소스 일치 여부.

중요 단계가 끝날 때 짧게 진행 상황을 알린다. 장시간 명령은 반환 세션을 추적하고 실행 중인 것을 완료라고 하지 않는다. 백그라운드에서 계속하겠다고 말만 남기지 않는다.

**수행 가능한 남은 작업은 직접 이어서 처리한다. 완료 기준을 충족하지 못하면 완료라고 말하지 않는다.**
