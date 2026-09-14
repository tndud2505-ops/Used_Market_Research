# USED MARKET

국내 중고 사이트와 eBay의 PC 관련 매물을 수집·분류하고, 검증된 국내 개인 중고 단품의 가격 통계를 제공하는 운영 애플리케이션입니다.

- Public path: `/`
- 컴퓨터 맞추기: `/computer-builder.html` — 부품·세부 모델 선택, 수량, 가격별 부분 합계, 브라우저 저장·주소 공유
- 가격 분석: `/price-analysis.html` — 모델별 실제 금액 추이, 국내 통합·eBay·중고나라·번개장터 통계, 30일 화면을 최대 2년 범위에서 하루·한 달씩 이동
- Loopback port: `127.0.0.1:8789`
- Compose project: `used-market-domestic`
- 운영 검색·PC 디렉터리: 번개장터, 중고나라, eBay 공식 Browse API
- 비활성 소스: 다나와 장터, 헬로마켓, 리씽크몰, 쿨엔조이, 당근, 퀘이사존

```bash
npm ci
npm test
npm run pc:contract
npm run test:pc:live-specialist
docker compose up -d --build
```

실제 eBay 검색에는 `.env` 또는 AWS 러너의 보호된 환경 파일에 `EBAY_CLIENT_ID`와 `EBAY_CLIENT_SECRET`을 설정합니다. 인증정보는 Git에 커밋하지 않습니다.
`test:pc:live-specialist`는 현재 비활성인 다나와 장터 adapter를 진단 목적으로 실제 요청하므로 운영자가 명시적으로 점검할 때만 실행합니다.

컴퓨터 맞추기와 가격 분석은 국내 개인 중고·정상 작동·KRW 통계를 사용합니다. 판매중 평균, 판매완료 매물의 마지막 표시가, 근거가 있는 확인 거래가는 서로 대체하지 않습니다. 없는 날짜는 차트의 공백, 없는 부품 가격은 부분 합계로 표시합니다. 과거 차트 조회가 최근 30일 조합 가격을 바꾸지 않습니다. 호환성은 제공된 소켓·메모리 규격만 확인하며 BIOS·크기·전원 커넥터는 별도 확인이 필요합니다.

SSD·HDD·파워서플라이의 공개 제품 ID는 각각 `제조사 × 용량 구간`, `제조사 × 용량 구간`, `제조사 × 정격 출력 구간`으로만 구성합니다. 세부 제품명은 검색 별칭이고 M.2·NVMe·폼팩터·효율·모듈러 방식은 보조 필터입니다. 제조사를 확정할 수 없으면 `기타/미분류 제조사`로 분리합니다. 과거 `as_of`에 해당하는 통계 창이 보존돼 있지 않으면 현재 통계로 대체하지 않고 `503 HISTORICAL_PRICE_STATS_UNAVAILABLE`을 반환합니다.
