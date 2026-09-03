# 컴퓨터 부품 가격 이력과 그래프

## 데이터 흐름

다음 흐름은 rollback용 legacy 범용 검색 그래프다. 공개 PC 디렉터리 화면은 이 경로에서 원 사이트를 호출하지 않고, 아래의 사전수집 publication만 사용한다.

```text
사이트 검색
  -> 기존 컴포넌트 카탈로그 정규화
  -> market snapshot 저장
  -> market/logic/history-reader.ts
  -> web-backend/logic/price-history-service.ts
  -> GET /api/market/history 또는 search 응답의 data.price_history
  -> SVG 가격 변동 그래프
```

## 어떤 로직을 재사용하는가

- `market/logic/componentCatalog.ts`: GPU·CPU·RAM·SSD 패턴과 canonical name
- `market/logic/normalize.ts`: 매물 제목·설명에서 구성품과 listing type 추출
- `market/logic/pricing.ts`: part/full_pc/semi_pc 범위별 snapshot 계산
- `market/logic/history-reader.ts`: 저장된 날짜별 snapshot과 수동 seed 병합
- `web-backend/logic/price-history-service.ts`: 검색어에 맞는 component history 선택, 날짜별 가중 평균, 추세 계산

## 그래프 원칙

- 주황 실선: 실제 수집된 `observed` 데이터
- 회색 점선: `manual_seed` 기준값
- 실제 관측일이 2일 미만이면 방향을 `unknown`으로 유지한다.
- `up/down/flat`은 실제 관측값 2개 이상에서만 계산한다.
- 화면에는 표본 수와 실제 관측일 수를 같이 보여준다.

## 운영상 주의

한 번의 검색 결과는 시세 추세가 아니다. 스케줄러가 반복 실행되고 서로 다른 날짜의 동일 구성 snapshot이 누적돼야 추세가 생긴다. 수동 seed는 빈 그래프를 방지하는 참고값이지 실제 거래 데이터로 표시하지 않는다.

## PC 부품 30일 통계

기존 그래프와 새 제품 통계는 목적과 원장이 다르다.

```text
AWS raw_listings / listing_snapshots
  -> normalized_listings / listing_items / product_master
  -> daily_price_stats + daily_price_stat_members
  -> 검증된 D1 catalog / listing / public_product_stats publication
  -> GET /api/pc/catalog + /api/pc/listings
  -> GET /api/products/:canonicalProductId/price-stats
  -> 좌측 필터 → 사이트별 매물 결과 + 가격 요약·30일 그래프
```

- 활성 매물은 하루의 마지막 유효 관측을 한 번 센다.
- SOLD는 최초 SOLD 날짜에 `sold_last_ask_price`를 한 번 센다.
- 현재 매물과 판매완료 직전 마지막 표시가격은 각각 평균·중앙값·표본 수를 제공한다.
- `sold_last_ask_price`는 실제 체결가가 아니다. 출처가 실제 체결금액을 구조적으로 제공한 경우만 `확인된 체결가`로 별도 집계한다.
- 서로 다른 market pool이나 통화를 합산하지 않는다.
- 표본 0~2건은 대표가격을 숨기고, 3~4건은 중앙값과 표본 경고만 제공한다.
- 통계 구성원은 `daily_price_stat_members`에서 원문 관측까지 역추적할 수 있다.
- 최근 30일 그래프는 날짜별 ACTIVE 중앙값과 SOLD 마지막 표시가격 중앙값·표본 수를 별도 시리즈로 표시한다. 표본이 없는 날은 0원으로 만들거나 보간하지 않는다.
