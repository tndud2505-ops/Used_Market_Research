# 컴퓨터 부품 가격 이력과 그래프

## 데이터 흐름

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
