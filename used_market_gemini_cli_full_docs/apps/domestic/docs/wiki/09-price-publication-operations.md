# 가격 통계 게시와 장애 대응

기준: 2026-10-02 운영 코드. 2026-09-24 수치와 배포 식별자는 [장애·변경 기록](../worklog/2026-09-24-aws-publication-verification.md)에 보존한다. 새 게시 성공은 해당 실행의 실제 영수증으로 확인한다.

## 운영 결정

Workers Free를 유지한다. AWS가 수집·분류·통계 계산과 전체 통계 검증을 담당하고, Worker는 화면/API·인증·캐시·일일 작업 호출·D1 통계 사본을 담당한다. Worker를 제거하거나 유료 플랜으로 전환한 변경이 아니다. 코드의 `FREE_TIER_MODE=false`는 AWS/Tunnel 연결 모드이며 Cloudflare 결제 플랜을 뜻하지 않는다.

수집 간격을 늘려도 한 Worker 요청이 처리하는 전체 데이터의 CPU 비용은 줄지 않는다. 요청 사이 대기 시간과 요청 안의 CPU 사용 시간은 다르므로, 큰 검증은 AWS로 옮기고 Worker 요청 크기를 나눈다.

## 수집·분류·통계의 차이

| 작업 | 실행 위치·의미 |
| --- | --- |
| 수집 | AWS가 승인된 사이트의 대상 검색을 수행하고 매물 원본·관측을 SQLite에 기록 |
| 분류·필터 | AWS의 결정론적 규칙이 부품·모델·상태·시장군·가격 비교 적격성을 판정. 이 경로에 실행 중 LLM 호출은 없음 |
| 통계 계산 | AWS가 같은 제품·시장군·상태·통화·기간의 적격 관측을 집계해 표본 수·평균·중앙값 등을 생성 |
| 게시 검증 | 계산 결과가 D1에 빠짐없이 같은 내용으로 저장됐는지 버전·추적성·행 수·체크섬을 대조 |
| 공개 조회 | 저장된 AWS 매물/통계를 Worker가 전달·캐시. 화면 요청이 수집을 실행하지 않음 |

검증 성공은 전송·저장 무결성을 뜻한다. 사기주의 글 같은 원본을 분류기가 잘못 적격 처리한 문제까지 해결했다는 뜻은 아니다. 매물 최신성과 일일 통계 최신성도 따로 판단한다.

수집 대상 수, 통계 범위 수, 고유 매물 수를 구분한다. 통계 범위는 `canonical_product_id + market_pool + condition_code + currency + days` 조합이다. 여러 범위에 같은 매물이 포함될 수 있으며 `crawl_runs.collected_count` 합계도 고유 매물 수가 아니다.

## 주기와 처리 범위

| 작업 | 현재 KST 기준 |
| --- | --- |
| 중고나라 | 매시 04분·34분 |
| 번개장터 | 매시 11분 |
| 다나와 중고 | 매시 19분 |
| eBay | 매시 44분 |
| 통계 게시 호출 | 매일 03:00, Worker `0 18 * * *`가 AWS `daily-price-refresh` 호출 |
| 이번 복구 예약 | Codex 자동화 `used-pick`, 2026-10-02 09:05 한 번만 실행. 작업 종료 후 비활성화하며 추가 날짜로 반복하지 않음 |

AWS 수집 tick은 30초, 소스별 jitter는 0~120초다. `HOURLY_CATEGORY` 최소 간격은 55분, `DAILY_MASTER`는 24시간이다. 한 회차 사이트별 최대 85개 대상, 대상 동시 처리 6개로 분할한다. 원 사이트의 모든 페이지를 매번 전수 조회한다는 의미가 아니다. 실제 기준은 `collector/logic/pc-source-registry.mjs`, 활성 target set, `/health`의 `pc_parts.collection_capacity`다. 03:00은 호출 시각이며 완료 시각은 계산량에 따라 늦어진다.

다나와는 접근 제한 재발을 줄이기 위해 예외적으로 1시간마다 최대 85개 대상을 순차 요청하며 요청 시작 사이를 최소 5초 띄운다. 403·429·캡차/접근 차단이 확인되면 그 회차의 남은 요청을 중단한다. 이미 수집한 정상 자료와 마지막 성공 자료는 보존하고, 요청하지 않은 대상을 실패로 기록하지 않는다. 차단 회차에는 기존 재시도 대기를 적용하고 연속 3회차 실패하면 6시간 격리한다. 대기 만료 후 활성 스케줄의 다음 회차에서 재시도하며, 정상 응답 확인 전에는 복구로 판단하지 않는다. 정상 회차가 유지될 때 현재 85개 배치는 전체 모델의 일일 순회량을 충족한다.

## 게시 순서와 보호 조건

1. AWS의 `daily-price-refresh`가 진행 중 수집을 마칠 때까지 기다리고 다음 수집 tick과 겹치지 않게 게시 잠금을 잡는다.
2. 게시 자식 프로세스가 전체 통계를 계산한다. 현재 활성 D1 범위는 `GET /admin/product-stats-scopes?offset=0&after_rowid=0`부터 100개씩 커서로 읽고 페이지별 게시 ID·체크섬을 맞춘다. 선택적인 `PC_STATS_PUBLICATION_OUTPUT`은 첫 전송 전에 새 계산 결과를 덮어쓰기 없이 저장하는 운영 복구 파일이다.
3. `POST /admin/stage-product-stats`로 4행씩 staging한다. 손실된 성공 응답 등 일부 일시적 오류만 동일 게시 ID·청크 번호·체크섬으로 한 번 재시도한다. 인증·검증 거절은 재시도하지 않는다.
4. Worker의 `/admin/activate-product-stats`가 설정된 AWS `/api/runner/verify-stats-publication`을 인증 호출한다. 클라이언트가 준 검증 완료 주장이나 임의 검증 URL을 신뢰하지 않는다.
5. AWS가 인증된 `/admin/product-stats-readback`으로 행 ID 100개씩 커서 조회하고, 실제 행 4개씩·청크 명세 40개씩 다시 읽는다. 실제 행과 청크 요청은 최대 8개 병렬로 처리하며, 끝난 요청 자리에는 다음 페이지를 즉시 배정한다. 느린 페이지 하나가 다른 요청 전체를 대기시키지 않으며 전체 행·청크 체크섬, 버전·추적성·표본 수를 검증한다. 읽기 영수증은 D1의 실제 `rows_read`·`rows_written`을 포함한다.
6. Worker는 `aws-readback-v1`의 게시 ID·체크섬·개수 응답을 대조한다. D1 트랜잭션 안에서 이전 활성 게시와 새 게시 행/청크 수를 다시 확인한 후 활성 포인터를 전환한다. 충돌하면 트랜잭션 전체를 취소한다.
7. AWS는 검증된 같은 게시본을 `pc_stored_price_publications`에 저장하고 `pc_publication_runtime`에 성공을 기록한다. 이후 백업·기존 보존 정책에 따른 압축까지 끝나야 작업 완료 응답이 나온다.

Worker의 기존 범위 축소·유표본 범위 급감 보호도 유지한다. 관련 거절은 전송 오류와 구분하고, 실제 제품 체계 변경이나 표본 감소 이유를 검토하기 전에 acknowledgement를 만들어 통과시키지 않는다. 운영 게시기는 `PC_STATS_PRODUCT_IDS`를 이용한 일부 제품 병합을 허용하지 않는다.

검증 전 실패 시 이전 게시를 유지한다. D1 활성화 뒤 AWS 저장/후처리만 실패할 수도 있으므로 HTTP 오류만 보고 중복 게시하거나 D1 포인터를 되돌리지 않는다. D1과 AWS의 게시 ID를 먼저 대조한다. 일반 현재 통계는 AWS 읽기 실패 시 D1 사본으로 대체할 수 있지만, 명시적 과거 `as_of` 조회는 현재 D1 통계로 대신하지 않는다. D1 매물 fallback은 기본 비활성이다.

현재 AWS readback은 메모리에 전체 행을 모은다. 페이지 요청 제한 15초, 추가 페이지 시작 제한 80초, Worker의 검증 호출 제한 95초가 있다. 이는 무제한 크기 처리를 보장하지 않으며 향후 데이터 증가 시 바이트 수·메모리·실측 시간으로 용량을 다시 판단한다. `PC_STATS_PUBLICATION_TIMEOUT_MS`는 개별 게시 HTTP 요청 제한으로, 전체 계산 완료를 보장하는 시간이 아니다.

## 장애 시 읽기 전용 확인 순서

### 소규모 오류 복구

통계 사본은 성공한 활성 게시본 한 벌만 유지한다. 새 게시의 첫 청크에서는 마지막
전송 활동 후 6시간이 지난 비활성 임시 사본을 정리해 실패 사본이 공간을 차지하지
않게 한다. 현재 활성 사본, 지금 재시도하는 게시 ID, 최근 전송 중인 사본은 보존한다.
성공 시 이전 사본과 남은 임시 사본은 기존 활성화 트랜잭션에서 삭제한다.
교정을 위해 따로 만든 전체 복구 파일은 실제 게시와 조회 검증이 끝난 뒤 정리하고,
게시 ID·체크섬·교정 범위 같은 작은 작업 영수증만 남긴다. 원본 매물 보존 정책은 별개다.

오류 수정 때문에 전체 과거 통계를 다시 계산하지 않는다. `npm run pc:repair-stats`는
명시한 모델·시장군·상태·통화 범위만 미리 계산하고 원장 변경을 되돌린다.
대표가격(평균·중앙값 등, 사이트·제조사·일별 값 포함)의 차이가 3,000원 미만이면
다음 정기 갱신으로 넘긴다. 모델 혼입, 통화·수량 단위 오류, 손상된 근거 또는
대표가격의 표시 가능 여부가 바뀌면 해당 범위만 교정한다. 정상 표본은 보존한다.

운영 입력은 `RUNNER_INDEX_PATH`, 기존 인증 환경과 함께 `PC_STATS_REPAIR_BASE_ID`,
`PC_STATS_REPAIR_SCOPES_JSON`(정확한 `canonical_product_id`, `market_pool`, `condition_code`,
`currency`, `days: 30` 목록), `PC_STATS_REPAIR_REASON`을 지정한다. 기본 사유는 `PRICE_CHANGE`이며
확인된 무결성 교정에는 `PRODUCT_IDENTITY`, `CURRENCY_OR_UNIT`, `CORRUPT_DATA`를 사용한다.
`PC_STATS_REPAIR_THRESHOLD_KRW`로 금액 기준을 바꿀 수 있다. `--apply`에는 복구 파일의
새 경로 `PC_STATS_REPAIR_OUTPUT`이 필요하다. 빈 대상이나 다른 버전·기준일의 혼합은 거절한다.

기준 게시본을 D1에서 전부 읽어 체크섬을 검증하지만 **재계산은 지정한 범위만** 한다.
나머지 행은 바이트 내용과 실제 기준일을 유지한다. 전송과 활성화는 기존 전체 게시본
검증을 그대로 거치므로 전체 전송이 전체 재계산을 뜻하지 않는다. 새로운 날짜의 통계로
위장하지 않으며, 오래된 기준 게시본의 교정만으로 현재 날짜의 준비 상태가 복구된다고
판단하지 않는다. 계산 결과와 기준 게시본은 게시 전에 복구 파일로 보존한다.

전역적인 데이터 손상이나 범위를 한정할 수 없는 계산 기준 변경만 전체 복구 대상으로
검토한다. 명시한 범위가 없거나 부분 교정이 실패했다고 전체 계산으로 자동 전환하지 않는다.
정기 일일 갱신은 이 오류 복구 정책과 별개다. 관련 하네스는
`harness/pc-scoped-stats-repair-contract.mjs`이며 `test:pc-release`에 포함된다.

### 운영 상태 확인

1. `https://runner.used-pick.com/health`와 내부 `http://127.0.0.1:8787/health`를 확인한다. `search_index.process_instance.id`가 같고 Runner/Tunnel 모두 `active`·`enabled`여야 한다. 디스크·메모리·`publication_active`도 확인한다.
2. 수집은 ACTIVE target set의 enabled 대상만 `source_keys_json`으로 펼치고 runtime을 `(source_id,target_id)`로 LEFT JOIN한다. PC 수집 소스는 bunjang/joonggonara/danawa/ebay다. 미성공·실패·지연을 11개 부품군별로 구분하고 시간별 3시간, 일별 48시간을 초기 경고 기준으로 사용한다. 진행 중 작업도 함께 판단한다.
3. 최근 24시간 `crawl_runs`의 성공/실패/진행 중과 `request_failure_count`, `http_blocked_count`, `collected_count`를 확인한다. 과거 target set이나 비활성 소스 이력을 현재 장애로 세지 않는다.
4. `/api/pc/catalog`에 공개된 부품군만 `/api/pc/listings?category_code=CPU&limit=1` 형태로 수량·freshness·source_counts를 확인한다. `category` 파라미터는 쓰지 않는다. 수집 11개 부품군 중 공개 API는 현재 7개이며 나머지 4개에 대한 400은 별도 API 계약이다.
5. 가격은 `pc_publication_runtime`, `pc_stored_price_publications`, D1 활성 게시와 `/api/products/{URL 인코딩한 canonical_product_id}/price-stats`의 게시 ID를 대조한다. 서로 다른 부품의 정확 모델을 표본으로 쓴다. 단일 빈 가격 표본만으로 전체 게시 장애로 판단하지 않는다.
6. Runner의 `pc_stats_readback_verified` 로그에서 게시 ID·`row_checksum_verified=true`·`verifier=aws-readback-v1`을 확인한다. 게시 자식 결과의 `elapsed_ms`, `cpu_time_ms`와 구별한다. readback의 `process_cpu_ms`에는 동시 Runner 작업이 포함될 수 있다.
7. Worker 오류 tail과 게시 작업 완료 기록을 대조한다. `Exceeded CPU Limit`, `PUBLICATION_READBACK_TIMEOUT`, 페이지/체크섬 불일치, 인증 오류를 구분한다. 번개장터 `operational_overdue_count` 증가와 디스크 증가도 추적한다. `coverage_ready`만으로 가격 정확성이나 게시 성공을 보장하지 않는다.

운영 SQLite는 `file:/var/lib/used-market-runner/search-index.sqlite?mode=ro`, `PRAGMA query_only=ON`, 짧은 조회를 사용한다. SSH는 기존 운영 계정·키를 사용하고 `BatchMode=yes`, `StrictHostKeyChecking=yes`, `ConnectTimeout=10`을 유지한다. 비밀값은 출력·문서화하지 않는다.

## 배포와 복구

- D1 커서 경로는 `0016_pc_stats_publication_cursor.sql`의 `(publication_id)` 인덱스가 필요하다. 마이그레이션 → Worker → AWS 순서로 적용한다. 기존 offset 요청도 지원하므로 두 코드 사이의 짧은 전환 기간에도 인증과 전체 검증을 유지한다. 이 마이그레이션은 기본 키와 중복된 청크 인덱스만 제거하며 가격 행을 삭제하지 않는다.
- 매물 재전송은 실질 필드 차이가 있을 때만 쓴다. 수집 시각만 바뀐 재전송은 쓰기 0이며, 같은 item ID를 다른 출처로 덮어쓰는 충돌은 전체 배치를 거절한다. D1 매물 사본이 필요 없는 정상 AWS 경로에서는 기존 `D1_BACKGROUND_MIRROR_ENABLED=false`를 유지한다.
- PC API 응답의 브라우저 캐시는 `no-cache, max-age=0, must-revalidate`로 재검증한다. UI fetch도 `cache: "no-cache"`를 사용한다. Worker 내부 캐시의 TTL은 유지하므로 브라우저 재검증이 매번 AWS/D1 조회를 뜻하지 않는다. 내부 캐시 namespace만 바꾸면 이미 브라우저에 저장된 응답은 갱신되지 않는다.
- 정적 import된 URL 정책 파일을 교체한 뒤에는 유휴 Runner를 재시작해야 새 수집에도 적용된다. 기존 synthetic 다나와 URL은 실제 `prod.danawa.com` 원문 주소로만 복구한다. 확인한 중고나라 본문은 이후 검색 응답에 본문이 없더라도 보존한다. GPU 수량만 확인되고 개당·일괄 가격 근거가 없으면 통계에서 제외한다.

- 이 프로토콜 전환은 Worker readback 경로를 먼저 배포하고 AWS Runner를 배포했다. 두 버전이 다른 동안 새 게시를 시작하지 않는다. 이후 변경도 API 호환성과 배포 순서를 먼저 확인한다.
- 실행 중인 수집·게시를 확인하고 기존 코드·보호된 환경 설정의 백업을 확보한다. AWS는 `install-ubuntu24.sh`를 사용해 Runner → Tunnel 순으로 재시작하고 내부·외부 인스턴스 일치를 확인한다. Runner만 재시작한 상태를 완료로 보고하지 않는다.
- 재발 시 기존 검증을 생략하거나 `active`를 직접 수정하지 않는다. 잘린 업로드의 반복 재시도, 일괄 수집, 재분류, DB 수정/삭제, 요금제 변경은 읽기 점검에 포함하지 않는다.
- 이미 실행 중인 `daily-price-refresh`는 완료 기록을 먼저 확인한다. 연결 timeout은 서버 작업 중단 증거가 아니다. 현재 idempotency 결과는 프로세스 메모리에 있으므로 재시작을 넘는 중복 방지를 가정하지 않는다.
- D1만 새 버전이고 AWS 저장이 실패했다면 해당 게시 전체 데이터의 체크섬을 다시 검증한 뒤 기존 저장 helper를 이용하는 운영자 복구로 다룬다. 단순 성공 시각 변경이나 무검증 포인터 전환은 복구가 아니다.
- 롤백은 변경 당시 호환되는 Worker/AWS 코드와 보호된 환경 백업을 사용한다. DB를 과거 코드 백업과 함께 덮어쓰지 않는다. 코드 롤백·재시작·게시 재실행은 명시적 운영 조치다.

검증 명령은 `npm run test:pc-release`, `npm run cloudflare:harness`를 우선 참고한다. 실제 게시 성공은 테스트가 아니라 새 게시 완료 기록과 공개 API 대조로 판정한다. 코드 경로는 [Project Map](../PROJECT_MAP.md), 설치 명령은 [AWS 운영 문서](../../aws-runner/README.md)에 있다.
