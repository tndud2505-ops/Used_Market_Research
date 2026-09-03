# ADR: PC 부품 원장·소스 정책·공개 가격 통계

상태: 구현·운영 중  
결정일: 2026-08-29  
최종 갱신: 2026-09-01

## 결정

USED-PICK은 범용 중고 검색 데이터를 `legacy_general`로 보존하고, PC 부품 데이터는 `pc_parts_v1` collection과 AWS SQLite 원장에 분리한다. 기존 `SearchIndex`는 `/api/search`, cache-first, 서명 cursor, 페이지 snapshot용 projection으로 유지한다.

새 원장은 원본·관측·정규화·상태 이벤트·제품 master·일별 통계와 통계 구성원을 보관한다. 변경 없는 재관측은 확인 시각만 갱신하며 가격·상태·내용·가용성 변화 때만 snapshot을 추가한다. 허용한 원문은 PII를 제거한 뒤 immutable로 저장한다.

## 상태와 가격 의미

- 상태: `ACTIVE`, `RESERVED`, `SOLD`, `DELETED`, `EXPIRED`, `UNAVAILABLE_UNKNOWN`, `BLOCKED_OR_PRIVATE`
- `SOLD`는 구조화 상태, 공식 API, 명시적 판매완료 문구만 인정한다.
- 목록 소실은 최소 6시간 간격 3회 확인해도 `UNAVAILABLE_UNKNOWN`이며 `SOLD`가 아니다.
- `sold_last_ask_price`는 최초 SOLD 관측 직전 마지막 유효 표시가격이다.
- `transaction_price`는 출처가 실제 체결가격을 명시한 경우에만 별도 저장한다.
- 기본 통계는 `KR_C2C_USED + USED_WORKING + 정확한 제품 + 명확한 수량/가격범위`만 사용한다.
- 리퍼비시·해외·업자·신품·채굴·고장·미테스트·시스템·묶음·광고는 별도 cohort다.
- 별도 cohort의 상태·시장군 제외 사유는 기본 시세 혼입을 막는 표시 사유로 유지하되, 동일 condition·market pool 내부 통계에서는 표본으로 사용할 수 있다. `good_listing_eligible`은 국내 개인 중고 정상 작동 ACTIVE 단품에만 허용한다.

대표가격 정책은 n<3이면 null, n=3~4이면 중앙값만, n≥5이면 평균·중앙값, n≥10이면 10% 절사평균과 IQR을 추가한다. 각 scope는 매물 수·단위 수·최저·최고를 보존하고 SOLD 일별 통계에는 7일 이동 중앙값을 함께 둔다. 기준가격은 최근 30일 판매완료 직전 마지막 표시가격 중앙값이다. 사용자 문구는 “싸다”가 아니라 “기준가격보다 낮음”을 사용한다.

## 소스 정책

소스의 법적·운영 허용 상태와 기술 상태를 분리한다.

- 정책: `REVIEW_REQUIRED`, `APPROVED`, `DENIED`
- 런타임: `DISABLED`, `ADAPTER_READY`, `ENABLED`, `QUARANTINED`

기존 중고나라 HTML/Next, 번개장터 사이트 JSON, 헬로마켓 JSON/렌더링, 리씽크 HTML+Livewire, eBay Browse API 방식을 유지한다. API-only 전환은 하지 않는다. 다나와·퀘이사존·쿨엔조이도 각각의 사이트 adapter를 사용하며 운영자 승인 기록과 런타임 상태를 source registry에서 관리한다.

AWS Runner가 고주기 수집 scheduler의 단일 소유자다. Cloudflare cron은 전환 후 watchdog·복구 경계만 담당한다. 실제 사이트 canary와 정책 확인은 자동 테스트가 아니라 운영자 명시 작업이다.

승인 source도 정상 공개 경로만 사용하며 HTTP 차단·captcha를 우회하지 않는다. 실패는 source별 backoff·격리로 처리하고 다른 source와 마지막 공개 데이터를 보존한다. 30일 품질 지표는 최초·최근 성공 시각뿐 아니라 최근 31일의 성공일과 최대 공백을 계속 보고하되, 거짓 SOLD·시장군 혼합·중복 publication 같은 무결성 오류만 fail-closed로 차단한다.

## 공개와 복구

`GET /api/products/:canonicalProductId/price-stats`는 market pool과 통화를 하나씩만 허용한다. 판매완료 통계는 실제 거래가격이 아니라 마지막 표시가격이라는 고지를 포함한다. D1에는 완성된 `public_product_stats` publication만 row count·checksum 검증 후 active pointer를 원자적으로 교체한다.

기존 `price_history`는 legacy read-only이며 새 30일 통계에 사용하지 않는다. 30일 shadow 병행 수집이 끝나기 전에는 기존 공개 검색을 PC 전용으로 전환하지 않는다. `legacy_general` query와 projection은 일반 cache retention에서 제외해 명시적 rollback 종료 전까지 유지한다.

재확인으로 SOLD·비공개·확인불가가 된 매물은 원장과 SearchIndex·D1 projection을 함께 비활성화한다. 명시적 구조화 ACTIVE 증거로 잘못된 SOLD를 교정하면 과거 SOLD 표본도 철회한다. 저위험 별칭은 관리자 feedback으로만 후보·shadow에 진입하고, 명령서 20.4절의 72시간·독립 매물·소스·충돌·99.5% 고정 검증·회귀 조건을 모두 통과해야 승인된다.

정규화 pipeline은 parser·rule·filter·model 버전을 하나의 활성 버전으로 관리한다. 과거 원본은 dry-run 기본 재분류 작업으로 새 버전에 추가 처리하며 덮어쓰지 않는다. 완전한 인간 검수 품질 보고서가 기준 미달이거나 핵심 무결성 오류를 포함하면 새 버전을 `ROLLED_BACK`으로 바꾸고 기록된 직전 버전을 다시 `ACTIVE`로 복구한다.
