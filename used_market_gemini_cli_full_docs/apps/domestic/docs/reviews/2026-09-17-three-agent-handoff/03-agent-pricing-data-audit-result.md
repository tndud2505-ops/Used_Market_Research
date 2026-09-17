# 에이전트 3 — 분류·가격·수집·독립 API 감사 결과

작성: 2026-09-17 14:58:21 KST. 기존 작업 트리의 3번 역할 결과이며, 운영 배포 승인서가 아니다.

## 1. 최종 판정

**담당 로컬 수정·검증은 완료. 운영 전체 완료 판정은 보류.** 공개 API 감사: **FAILED**, 로컬 전용 하네스: **PASS**, D1의 앞선 성공 스냅샷 독립 감사: **PASS**. 그 이후 활성 게시의 D1 전체 재조회는 **BLOCKED / Cloudflare 7403**이다. 운영 SQLite 원장 대조와 분류 수정의 후속 버전 전환도 미완료다.

운영 DB·수집·정규화·게시·서비스·Worker 쓰기, git add/commit/배포는 이 역할에서 수행하지 않았다. 기존 코드·기존 202,242건 정규화·44개씩 검증 수집을 이번 역할의 신규 성과로 계산하지 않았다. 작업 중 외부 세션의 운영 변경이 관찰됐으며 수행 세션은 확정하지 않았다.

| 검사 | 상태 | 범위 / 주의 |
| --- | --- | --- |
| 현재 기간 API | PASS | 798개 요청, HTTP 200 798개; 버전·통화·기간·표본 정책 검사 |
| 카탈로그·G.Skill 별칭 | PASS | public-pc-5; 공개 732, 도구 798 = 가격 788 + 탐색전용 보드 10 |
| 과거 기간 | FAIL | as_of=2026-09-16, HTTP 200; ALL:active:AGGREGATE_INCOMPLETE, ALL:active:MEDIAN_MISSING, ALL:active:MEAN_MISSING, ALL:sold:AGGREGATE_INCOMPLETE, ALL:sold:MEDIAN_MISSING, ALL:sold:MEAN_MISSING, EXACT_AGGREGATE_NOT_READY, EXACT_PUBLICATION_MISSING, MEMBER_TRACE_MISSING, bunjang:active:AGGREGATE_INCOMPLETE, bunjang:active:MEDIAN_MISSING, bunjang:active:MEAN_MISSING, bunjang:sold:AGGREGATE_INCOMPLETE, bunjang:sold:MEDIAN_MISSING, bunjang:sold:MEAN_MISSING, joonggonara:active:AGGREGATE_INCOMPLETE, joonggonara:active:MEDIAN_MISSING, joonggonara:active:MEAN_MISSING |
| D1 앞선 스냅샷 체크섬·범위 | PASS | 2465행 독립 해시; 이전 2294범위 중 2294유지, 171추가, 0삭제. 대상 ID b4e10072-2262-4e68-939c-5c2d1e0e57ac |
| 앞선 공개 API ↔ 같은 D1 스냅샷 | PASS | 559개 범위의 값·게시 ID·구성원 추적 대조. 나머지 요청범위 229개는 해당 D1 게시행 없음 |
| 새 활성 게시 D1 전체 재조회 | BLOCKED | 14:54:36 KST, Cloudflare API code 7403 / exit 1. 앞선 성공을 새 게시 전체 검증으로 확대하지 않음 |
| RAM·분류 수정 후보 | PASS / 운영 미반영 | 격리 사본 22개 사례 + 7개 범주 경계 검사; 788개 합성 등록 항목 + 18개 부정 사례. 시장 전체 실매물 검사 아님 |
| 실제 원장 구성원 재계산 | BLOCKED | 운영 SQLite 읽기 요청이 연결 도구 안전 판정 단계에서 차단됨 |
| 2,086행 실패 후보의 정확한 키 차집합 | BLOCKED | 그 시점의 준비 키 스냅샷 미확보. 2,294→2,465의 실제 게시 차집합과 혼동하지 않음 |
| 브라우저·화면 합계 대조 | 미실행 / 담당 2 | API 산술 검증을 실제 브라우저 검증으로 대체하지 않음 |
| 통합 커밋·정식 배포 | 미실행 / 담당 1 | 로컬 해시·검사 결과 전달; 배포 후보 소스 고정 후 전체 재검증 필요 |

## 2. 이번에 실제 수정한 내용

### 2.1 게시 범위의 첫 전환 안전장치

`aws-runner/pc-publication-scopes.mjs`: 로컬 완료 게시가 비었을 때 이전 D1 범위를 알 수 없는 상태로 진행하지 않는다. `externalActive`의 게시 ID·checksum·row_count·조회 시각·범위 키를 검증하고, 오래된 증거·중복 키·잘못된 기간을 거부한다. 이전 **가격값이 아니라 범위 식별자만** 합치므로 값은 같은 기준 시각·규칙으로 다시 계산해야 한다. 현재 범위에 가격을 복사하거나 gate를 제거하지 않았다.

호출 계약: `fullPublicationScopes(db, observedScopes, { externalActive })`. 첫 전환에서 증거가 없으면 `PC_STATS_EXTERNAL_ACTIVE_SCOPES_REQUIRED`로 안전하게 실패한다. 실제 D1 조회 및 publisher 연결은 1번 담당이며 진행 문서에서 인수 확인을 받았다.

### 2.2 내부 통계 준비 실패와 시장 표본 부족 분리

`aws-runner/pc-price-stats-http.mjs`: 미완성 집계에 `availability.status=UNAVAILABLE`, `EXACT_STATS_NOT_READY` 또는 `HISTORICAL_EXACT_STATS_UNAVAILABLE`를 표시한다. 해당 상태를 ‘시장 표본 부족’이나 높은 신뢰도로 오인시키지 않고 대표값을 억제한다. 요청 과거 날짜와 게시 날짜가 다르면 `HISTORICAL_PRICE_STATS_UNAVAILABLE` 오류를 내어 다른 날짜의 요약을 대신 반환하지 않는다.

1번은 runner/Worker의 상태 코드·no-store 처리를 통합해야 한다. 2번은 준비 미완료 안내를 화면에 연결해야 한다. 로컬 수정 존재를 운영 반영 증거로 사용하지 않았다.

### 2.3 독립 감사 도구

`harness/lib/pc-independent-price-audit.mjs`와 역할 전용 하네스는 프런트엔드 `coherentStats/metricValue/buildTotals`를 전혀 가져오지 않는다. 원 API의 단가·수량으로 직접 계산하고 통화·시장·조건·기간·게시 ID가 다른 행을 합치지 않는다. 가격이 하나도 없을 때 0원 완성 견적을 만들지 않는다.

`tmp/pc-resume-full-audit.mjs`는 작업 중 다른 세션 수정이 발견돼 덮어쓰지 않았다. 대신 `harness/pc-agent3-public-api-audit.mjs`를 만들고 동일 목적의 더 엄격한 전수 검사를 실행했다. 일반 URL을 사용했고 캐시 우회 쿼리·원 사이트 수집·관리자 쓰기를 호출하지 않았다.

### 2.4 활성 v18을 보존한 분류 수정 후보

기존 코드 22개 추가 사례 중 6개가 실패했다: 모순된 RAM 총용량에 KIT/each가 붙는 두 사례, 동등한 RAM 곱셈 표기 반복, Intel 랜카드 범주, SSD 128G 약식 용량, 한글 darkFlash 제조사.

`harness/lib/pc-agent3-v19-candidate-source.mjs`는 기준 SHA-256을 먼저 확인하고 격리 사본에서 수정 후보를 만든다. 후보는 같은 실패를 해소했고 정상 KIT·개당 가격·모순 표기·노트북/서버/고장/방열판·칩 제조사 구분 및 기존 788개 합성 등록 범위를 검사했다. 활성 분류기 파일은 수정하지 않았다.

다음 미사용 버전의 normalization/parser/rule/filter와 전환 계획을 1번과 합의한 뒤 일관된 사본 전체에서 영향·품질·구성원 추적을 검증해야 한다. 후보의 ‘v19’ 명칭은 운영 활성화 또는 버전 예약을 뜻하지 않는다. 새 정확 모델은 등록하지 않았다. SN520은 기존 제조사·용량 구간에 대한 표기 처리일 뿐 정확 모델 가격 등록이 아니며, 리안리 케이스 역시 규격을 추정해 가격 항목을 만들어 넣지 않았다.

## 3. 실제 게시·체크섬 증거

공개 전수 조회: 2026-09-17 14:45:38 KST ~ 2026-09-17 14:47:03 KST. 명시적 기대 게시 ID: `1d112ab0-6f45-4224-8ba3-a5d026427d86`.

D1 독립 감사 게시: `b4e10072-2262-4e68-939c-5c2d1e0e57ac`, 활성 시각 2026-09-17 14:20:47 KST, 데이터 기준 시각 2026-09-17 14:14:40 KST. 선언/계산 행 수 2465/2465.

- 선언 SHA-256: `317d7c4b99db53335d27ab2b7471362b38c3f432534467d12385347db0527df0`
- D1의 실제 저장행을 읽어 독립 계산한 SHA-256: `317d7c4b99db53335d27ab2b7471362b38c3f432534467d12385347db0527df0`

이전 2294개 실제 키는 모두 비교했고 삭제 0개, 추가 171개다. 2465개 행의 구성원 수·checksum 형식을 확인하고 공개 API의 게시된 559개 범위와 대조했다. 그러나 **양쪽에 같은 구성원 checksum이 있다고 원장 구성원을 독립 재계산한 것은 아니다**. 그 작업은 SQLite 차단으로 남아 있다.

2026-09-17 14:42:49 KST 일반 URL 재조회는 당시 D1 활성 ID `1d112ab0-6f45-4224-8ba3-a5d026427d86`와 대표 3개 응답 모두 일치했다. 활성 시각 2026-09-17 14:36:58 KST, checksum `317d7c4b99db53335d27ab2b7471362b38c3f432534467d12385347db0527df0`. 이전 감사 후 게시 ID가 바뀐 사실과 값·기준 시각이 동일한 사실을 구분했다. 앞선 조회와 뒤의 새 게시를 한 순간의 스냅샷처럼 합치지 않았다.

## 4. 27개 G.Skill 항목

각 행의 판매중/판매완료 수는 **공개 정확 기간 요약이 보고한 수**이다. 실제 원장 고유 매물 재계산은 미실행이다. 5개 별칭의 ID 집합은 비교했고, 기존 인수인계의 국내 27개 요청 성공을 별도로 재사용했다. **항목별 수신·저장·요청 제품 일치 건수는 현재 원장/실행 보고서 미확보로 BLOCKED**이며 표본 수에서 역산하지 않았다. 제외 집계 역시 API가 제공한 집계이며 고유 매물 수로 바꾸어 쓰지 않았다.

가격 조건: KR_C2C_USED / USED_WORKING / KRW / 30일 / 사이트 ALL. 1~2건은 대표값 없음, 3~4건은 중앙값, 5건 이상은 평균을 표에 사용한다. 판매완료 값은 마지막 표시가격이며 실제 체결가격이 아니다.

| 제품 ID | 별칭 | 국내 요청 증거 | 판매중 / 완료 | 판매중 대표값 | 완료 대표값 | 가격 없음 / 상태 | API 제외 사유 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ram:g-skill:ddr3:4gb | 5/5 | 기존 2소스 요청 성공 / 원장 대조 BLOCKED | 7 / 0 | 18,850 | 없음 | 대표값 있음(상태별 구분) | PRICE_SCOPE_AMBIGUOUS:24 |
| ram:g-skill:ddr3:8gb | 5/5 | 기존 2소스 요청 성공 / 원장 대조 BLOCKED | 6 / 1 | 72,666.67 | 없음 | 대표값 있음(상태별 구분) | PRICE_SCOPE_AMBIGUOUS:8 |
| ram:g-skill:ddr3:16gb | 5/5 | 기존 2소스 요청 성공 / 원장 대조 BLOCKED | 0 / 0 | 없음 | 없음 | 게시된 판매중/완료 유효 표본 0 | API 제외 집계 없음 |
| ram:g-skill:ddr3:24gb | 5/5 | 기존 2소스 요청 성공 / 원장 대조 BLOCKED | 0 / 0 | 없음 | 없음 | 요청 범위 게시행 없음; 시장 0건 미확정 | API 제외 집계 없음 |
| ram:g-skill:ddr3:32gb | 5/5 | 기존 2소스 요청 성공 / 원장 대조 BLOCKED | 0 / 0 | 없음 | 없음 | 게시된 판매중/완료 유효 표본 0 | API 제외 집계 없음 |
| ram:g-skill:ddr3:48gb | 5/5 | 기존 2소스 요청 성공 / 원장 대조 BLOCKED | 0 / 0 | 없음 | 없음 | 요청 범위 게시행 없음; 시장 0건 미확정 | API 제외 집계 없음 |
| ram:g-skill:ddr3:64gb | 5/5 | 기존 2소스 요청 성공 / 원장 대조 BLOCKED | 0 / 0 | 없음 | 없음 | 요청 범위 게시행 없음; 시장 0건 미확정 | API 제외 집계 없음 |
| ram:g-skill:ddr3:96gb | 5/5 | 기존 2소스 요청 성공 / 원장 대조 BLOCKED | 0 / 0 | 없음 | 없음 | 요청 범위 게시행 없음; 시장 0건 미확정 | API 제외 집계 없음 |
| ram:g-skill:ddr3:128gb | 5/5 | 기존 2소스 요청 성공 / 원장 대조 BLOCKED | 0 / 0 | 없음 | 없음 | 요청 범위 게시행 없음; 시장 0건 미확정 | API 제외 집계 없음 |
| ram:g-skill:ddr4:4gb | 5/5 | 기존 2소스 요청 성공 / 원장 대조 BLOCKED | 1 / 0 | 없음 | 없음 | 상태별 1~2건: 대표값 없음 | API 제외 집계 없음 |
| ram:g-skill:ddr4:8gb | 5/5 | 기존 2소스 요청 성공 / 원장 대조 BLOCKED | 7 / 2 | 66,414.29 | 없음 | 대표값 있음(상태별 구분) | PRICE_SCOPE_AMBIGUOUS:57; WANTED:2; HISTORICAL_INACTIVE_SOURCE:5; ANOMALOUS_PRICE:1 |
| ram:g-skill:ddr4:16gb | 5/5 | 기존 2소스 요청 성공 / 원장 대조 BLOCKED | 15 / 8 | 129,500 | 126,237.5 | 대표값 있음(상태별 구분) | PRICE_SCOPE_AMBIGUOUS:17 |
| ram:g-skill:ddr4:24gb | 5/5 | 기존 2소스 요청 성공 / 원장 대조 BLOCKED | 0 / 0 | 없음 | 없음 | 요청 범위 게시행 없음; 시장 0건 미확정 | API 제외 집계 없음 |
| ram:g-skill:ddr4:32gb | 5/5 | 기존 2소스 요청 성공 / 원장 대조 BLOCKED | 6 / 4 | 317,500 | 230,000 | 대표값 있음(상태별 구분) | HISTORICAL_INACTIVE_SOURCE:3; PRICE_SCOPE_AMBIGUOUS:8; ANOMALOUS_PRICE:3; ANOMALOUS_LOW_PRICE:1 |
| ram:g-skill:ddr4:48gb | 5/5 | 기존 2소스 요청 성공 / 원장 대조 BLOCKED | 0 / 0 | 없음 | 없음 | 요청 범위 게시행 없음; 시장 0건 미확정 | API 제외 집계 없음 |
| ram:g-skill:ddr4:64gb | 5/5 | 기존 2소스 요청 성공 / 원장 대조 BLOCKED | 1 / 0 | 없음 | 없음 | 상태별 1~2건: 대표값 없음 | REPORT:1 |
| ram:g-skill:ddr4:96gb | 5/5 | 기존 2소스 요청 성공 / 원장 대조 BLOCKED | 0 / 0 | 없음 | 없음 | 요청 범위 게시행 없음; 시장 0건 미확정 | API 제외 집계 없음 |
| ram:g-skill:ddr4:128gb | 5/5 | 기존 2소스 요청 성공 / 원장 대조 BLOCKED | 0 / 0 | 없음 | 없음 | 요청 범위 게시행 없음; 시장 0건 미확정 | API 제외 집계 없음 |
| ram:g-skill:ddr5:4gb | 5/5 | 기존 2소스 요청 성공 / 원장 대조 BLOCKED | 0 / 0 | 없음 | 없음 | 요청 범위 게시행 없음; 시장 0건 미확정 | API 제외 집계 없음 |
| ram:g-skill:ddr5:8gb | 5/5 | 기존 2소스 요청 성공 / 원장 대조 BLOCKED | 0 / 0 | 없음 | 없음 | 요청 범위 게시행 없음; 시장 0건 미확정 | API 제외 집계 없음 |
| ram:g-skill:ddr5:16gb | 5/5 | 기존 2소스 요청 성공 / 원장 대조 BLOCKED | 14 / 5 | 322,500 | 307,500 | 대표값 있음(상태별 구분) | PRICE_SCOPE_AMBIGUOUS:2; ANOMALOUS_PRICE:7 |
| ram:g-skill:ddr5:24gb | 5/5 | 기존 2소스 요청 성공 / 원장 대조 BLOCKED | 1 / 0 | 없음 | 없음 | 상태별 1~2건: 대표값 없음 | API 제외 집계 없음 |
| ram:g-skill:ddr5:32gb | 5/5 | 기존 2소스 요청 성공 / 원장 대조 BLOCKED | 17 / 1 | 613,232.65 | 없음 | 대표값 있음(상태별 구분) | PRICE_SCOPE_AMBIGUOUS:9 |
| ram:g-skill:ddr5:48gb | 5/5 | 기존 2소스 요청 성공 / 원장 대조 BLOCKED | 2 / 0 | 없음 | 없음 | 상태별 1~2건: 대표값 없음 | API 제외 집계 없음 |
| ram:g-skill:ddr5:64gb | 5/5 | 기존 2소스 요청 성공 / 원장 대조 BLOCKED | 4 / 1 | 1,200,000 | 없음 | 대표값 있음(상태별 구분) | API 제외 집계 없음 |
| ram:g-skill:ddr5:96gb | 5/5 | 기존 2소스 요청 성공 / 원장 대조 BLOCKED | 0 / 1 | 없음 | 없음 | 상태별 1~2건: 대표값 없음 | API 제외 집계 없음 |
| ram:g-skill:ddr5:128gb | 5/5 | 기존 2소스 요청 성공 / 원장 대조 BLOCKED | 0 / 0 | 없음 | 없음 | 요청 범위 게시행 없음; 시장 0건 미확정 | API 제외 집계 없음 |

기존 검증 사본의 실제 RAM 키트 예시 30개를 재사용했고 관련 소스 8개 해시가 모두 일치했다. 그중 총액 290,000원·16GB 두 개는 개당 145,000원이다. 이 개별 매물 예시를 전체 시장 평균으로 사용하지 않았다.

기존 미분류 80개는 저장된 제목을 현재 분류기에 다시 넣어 결과와 제외 사유를 비교했다. Intel 랜카드 오분류, 128G 용량, 한글 케이스 표현은 수정 후보로 분리했다. 비PC·고장·묶음·서버/노트북은 제목과 기존 제외 사유로 확인 가능한 제외 후보이며, 모델 미상은 정상 제외로 확정하지 않고 후속 검토 대상으로 남긴다. 전체 설명과 현재 원장을 읽지 못했으므로 80개 전체의 최종 수작업 판정이나 모든 미분류의 대표성은 주장하지 않는다.

## 5. 9개 부품군 API 연결

| 부품군 | 도구 수 | HTTP 200 | 정확 게시 있음 | 판매중 가격 있음 | 완료 가격 있음 | 요청 게시행 없음 | 계약 실패 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| CASE | 36 (0 탐색전용) | 36/36 | 15 | 7 | 0 | 21 | 0 |
| COOLING | 30 (0 탐색전용) | 30/30 | 18 | 7 | 1 | 12 | 0 |
| CPU | 186 (0 탐색전용) | 186/186 | 170 | 122 | 74 | 16 | 0 |
| GPU | 94 (0 탐색전용) | 94/94 | 91 | 78 | 73 | 3 | 0 |
| HDD | 40 (0 탐색전용) | 40/40 | 37 | 32 | 17 | 3 | 0 |
| MOTHERBOARD | 42 (10 탐색전용) | 42/42 | 21 | 7 | 1 | 11 | 0 |
| PSU | 84 (0 탐색전용) | 84/84 | 59 | 29 | 11 | 25 | 0 |
| RAM | 216 (0 탐색전용) | 216/216 | 100 | 34 | 16 | 116 | 0 |
| SSD | 70 (0 탐색전용) | 70/70 | 48 | 38 | 27 | 22 | 0 |

메인 검색 7개 / 도구 9개 / 내부 수집 11개 범위를 확대하지 않았다. 메인보드 탐색전용 10개는 가격 선택과 분리했다. SSD/HDD·파워·케이스·쿨러의 넓은 구간/유형 가격을 정확 모델 가격으로 표기하지 않았다.

## 6. 독립 9종 견적 — 2번 전달용

| 부품군 | 제품 ID | 사이트 | 통화 | 판매중 표본 | 단가 정책 | 단가 | 수량 | 행 합계 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CPU | cpu:intel:i5-12400f | ALL | KRW | 34 | MEAN | 187,688.24 | 1 | 187,688.24 |
| GPU | gpu:nvidia:rtx-3060-ti | ALL | KRW | 79 | MEAN | 318,981.54 | 1 | 318,981.54 |
| RAM | ram:g-skill:ddr4:16gb | ALL | KRW | 15 | MEAN | 129,500 | 2 | 259,000 |
| MOTHERBOARD | motherboard:msi:pro-b650m-p | ALL | KRW | 1 | NO_REPRESENTATIVE | 없음 | 1 | 없음 |
| SSD | ssd:samsung:capacity-bucket:513-gb-1-tb | ALL | KRW | 176 | MEAN | 226,086.36 | 1 | 226,086.36 |
| HDD | hdd:western-digital:capacity-bucket:gt-2-tb-le-4-tb | ALL | KRW | 28 | MEAN | 134,428.57 | 1 | 134,428.57 |
| PSU | psu:seasonic:watts-bucket:751-850 | ALL | KRW | 1 | NO_REPRESENTATIVE | 없음 | 1 | 없음 |
| CASE | case:facet:mid-tower:fractal-design | ALL | KRW | 4 | MEDIAN | 83,141.5 | 1 | 83,141.5 |
| COOLING | cooling:facet:air-cpu:noctua | ALL | KRW | 9 | MEAN | 86,611.11 | 1 | 86,611.11 |

기준: 2026-09-17 14:14:40 KST, 게시 `1d112ab0-6f45-4224-8ba3-a5d026427d86`. 합계 **1,295,937.32원**, 가격 있는 행 **7/9**, 총 수량 **10**. **부분 합계 — 완성 견적 가격 아님**. 임의 가격을 채우거나 환율 없는 통화를 더하지 않았다. 소켓/DDR 충돌을 포함할 수 있는 검증 조합이지 추천 견적이 아니다. 화면에 표시되는 반올림·문구·수량·저장 결과와의 실제 브라우저 비교는 2번 담당이다.

## 7. 실제 수집 상태 — 2026-09-17 14:40:06 KST

| 소스 | 대상 연결 수 | 성공 이력 있음 | 실패 표시 | 성공 이력 없음 | 현재 시도중 | 시도한 적 없음 | 연속 30일 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| joonggonara | 1570 | 214 | 0 | 1356 | BLOCKED | BLOCKED | 미충족 |
| bunjang | 1570 | 44 | 0 | 1526 | BLOCKED | BLOCKED | 미충족 |
| ebay | 871 | 0 | 0 | 871 | BLOCKED | BLOCKED | 미충족 |

이 표는 health의 원래 집계 명칭을 보존한다. 2,441개 target과 소스별 연결 수 1,570+1,570+871은 같은 분모가 아니다. `never_succeeded`를 ‘한 번도 시도하지 않음’으로 바꾸지 않았다. 실제 `pc_source_target_runtime`과 `crawl_runs` 대조가 막혀 시도중/시도없음 분리는 BLOCKED다. `coverage_ready=true` 및 실패 0을 전체 수집 완료로 판정하지 않았다. 중고나라 성공 수가 이전 44에서 214로 늘어난 관측은 다른 실행의 결과이며 이번 역할의 수집 성과가 아니다.

## 8. 테스트·소스 해시

앱 `npm test`: PASS / exit 0. 로그: `tmp/pc-agent3-final-npm-test-20260917.log`. 역할별 최종 검사 중 소유 소스 해시 변화: 없음. 결과 파일 생성 직후 `git diff --check`도 exit 0이었다. 다른 담당자의 파일에서 LF→CRLF 안내가 있었지만 검사는 실패하지 않았으며 해당 파일을 임의로 수정하지 않았다.

| 검사 | 상태 | exit | 로그 |
| --- | --- | --- | --- |
| pc-agent3-independent-price-contract | PASS | 0 | tmp/pc-agent3-final-tests-1789624182243/pc-agent3-independent-price-contract.log |
| pc-agent3-publication-bootstrap-contract | PASS | 0 | tmp/pc-agent3-final-tests-1789624182243/pc-agent3-publication-bootstrap-contract.log |
| pc-agent3-stats-readiness-contract | PASS | 0 | tmp/pc-agent3-final-tests-1789624182243/pc-agent3-stats-readiness-contract.log |
| pc-agent3-v19-candidate-contract | PASS | 0 | tmp/pc-agent3-final-tests-1789624182243/pc-agent3-v19-candidate-contract.log |
| pc-full-publication-contract | PASS | 0 | tmp/pc-agent3-final-tests-1789624182243/pc-full-publication-contract.log |
| pc-stored-price-publication-contract | PASS | 0 | tmp/pc-agent3-final-tests-1789624182243/pc-stored-price-publication-contract.log |
| pc-light-user-contract | PASS | 0 | tmp/pc-agent3-final-tests-1789624182243/pc-light-user-contract.log |

| 변경 소스 / 신규 도구 | SHA-256 |
| --- | --- |
| aws-runner/pc-publication-scopes.mjs | f78c99bbb7613a9d95602cdcaf7995cc557b4f9b777be4f1d08613975e24c0c3 |
| aws-runner/pc-price-stats-http.mjs | c930dee7e66cdef66cec98211859608087215b522234e410c2c640043aac4d73 |
| harness/lib/pc-independent-price-audit.mjs | 1ed49ae9d3439d7a01f25f9d918c24a5f2d68accf705dca8a0c8a58d1335d45c |
| harness/lib/pc-agent3-v19-candidate-source.mjs | 774cb9fe2fe81958cefc943c25e8483221c70f471ffa693ebc04ae52e1274f4c |
| harness/pc-agent3-independent-price-contract.mjs | 2c84b81c6554d74de809e9f17985faf58d7c0a93deee031e5a8bf0ab04b86c23 |
| harness/pc-agent3-publication-bootstrap-contract.mjs | 78276b00ec557091328cc74382a4bc6fb37d357d923de00da2f6c7f5aef63ebb |
| harness/pc-agent3-stats-readiness-contract.mjs | b1cce3f8b44211253f857b93f42ec55278f3c34475ea5d533daabd61171423c5 |
| harness/pc-agent3-v19-candidate-contract.mjs | 3a2e83bfe492dad8a3e4bed88a402595b55519e72da203ef1271442d559d5a73 |
| harness/pc-agent3-public-api-audit.mjs | 54fa77583e530416c3a096e6bf64b2e56f8738aec50d89a6e8aa686ac6dc8fec |
| harness/pc-agent3-d1-evidence-audit.mjs | 0b3d0217e1d646159092c92fdd3e04669a9f86b7911a71f66fe43b528651a043 |

정확한 통합 후보에 대한 루트 verify, 전체 재검증 및 패키지 해시 대조는 1번 담당에게 남긴다. 공유 작업 트리의 npm test 통과를 배포 소스 고정이나 운영 화면 검증으로 간주하지 않는다.

## 9. 막힌 지점과 인수 요청

운영 SQLite 읽기 요청은 기존 SSH 경로를 통한 mode=ro / query_only / SELECT·PRAGMA 검사였다. 서버 실행 결과 대신 연결 도구가 다음을 반환했다.

> 요청의 보안 상태를 결정하지 못해 이 도구 요청은 OpenAI에 의해 차단되었습니다.

따라서 SSH 키 만료·sudo 부족·DB 권한 오류로 단정하지 않는다. 실행 전 차단이므로 서버 HTTP/exit 결과도 없다. 다른 셸·프록시·계정으로 우회하지 않았다. 로컬 수정·테스트 및 D1 읽기는 별도로 성공했다.

1번에 필요한 최소 인수 자료: 승인된 읽기 경로로 일관된 현재 원장 스냅샷 또는 비밀값을 제거한 집계 증거(27개 대상 요청/수신/저장/일치/제외, 구성원 checksum 재계산, 실행 상태 분리, 실패 2,086행 준비 키)를 확보한다. 보안 전체 해제·키 공개·전체 DB 덮어쓰기는 필요하지 않다.

### 별개의 새 차단 — Cloudflare 계정/서비스 접근

14:54:36 KST에 `used-market-free` D1의 새 활성 게시 저장행 전체를 다시 읽는 Wrangler 요청이 exit 1로 실패했다. 도구 자체 차단과 달리 이번에는 Cloudflare API가 다음을 반환했다.

> The given account is not valid or is not authorized to access this service [code: 7403]

위치: 앱 폴더. 도구: `npx --no-install wrangler d1 execute used-market-free --remote --config cloudflare/wrangler.jsonc`. 요청 경로는 계정/D1 데이터베이스의 `/query`이고 SELECT만 수행하려 했다. HTTP 상태는 보존된 JSON에 없으므로 추정하지 않는다. 오류 파일: `tmp/pc-agent3-d1-exact-final-20260917.json`.

필요한 최소 조치: 현재 Wrangler 인증 세션이 올바른 계정과 이 D1 리소스의 읽기 권한을 갖는지 확인·복구한다. 원문만으로 계정 자체 오류와 토큰 권한 문제를 더 세분화할 수 없다. 다른 계정/토큰으로 우회하거나 반복 호출하지 않았다. 읽기 재검사라 운영 복구나 쓰기 권한 확대는 필요하지 않다. 이전 2,465행 성공 감사는 해당 과거 스냅샷의 증거로만 유지한다.

1번은 두 런타임 파일의 변경과 합성 계약 하네스를 통합하고 게시/과거 조회의 HTTP 계약을 정리한 뒤 정식 배포해야 한다. 실제 공개 API/D1 감사는 명시적 검증 단계로 실행하며 기본 단위 테스트에 무조건 연결하지 않는다. 분류 후보는 별도 검토용이고 새 버전 합의·전체 영향 검사 전 활성 v18에 덮어쓰지 않는다. 2번은 이 보고서 및 `03-agent-independent-api-quote.json`의 단가/수량/부분 합계를 실제 화면과 대조한다.

## 10. 증거 파일

- 공개 전수 감사: `tmp/pc-agent3-public-after-2026-09-17T05-45-38-397Z/report.json`
- D1 감사: `tmp/pc-agent3-d1-evidence-result-20260917.json`
- 최종 역할 검사: `tmp/pc-agent3-final-tests-20260917.json`
- 원 분류 재현: `tmp/pc-agent3-classifier-audit-20260917.json`
- 분류 후보 확장 검사: `tmp/pc-agent3-v19-candidate-extended-20260917.log`
- 최신 health: `tmp/pc-agent3-health-current-20260917.json`
- 일반 URL 재확인: `tmp/pc-agent3-live-cache-final-20260917.json`

원 응답·DB 쿼리 출력·임시 생성 사본은 tmp에만 두었다. 요약 문서와 비밀값 없는 집계만 인수인계 산출물로 분리했다. 모든 상태는 해당 조회 시점 기준이며 이후 게시나 수집 성공을 예측하지 않는다.
