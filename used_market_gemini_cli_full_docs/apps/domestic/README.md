# USED MARKET

국내 중고 사이트와 eBay의 PC 관련 매물을 수집·분류하고, 검증된 국내 중고 부품의 가격 통계를 제공하는 운영 애플리케이션입니다.

국내 평균(`KR_DOMESTIC_USED`)은 개인 중고(`KR_C2C_USED`)와 국내 업체 중고(`KR_DEALER_USED`)의 유효 표본을 함께 계산합니다. 다나와는 `상품명 중고` 통합검색에서 신품·완제품·서버용·고장 제품을 제외하고, 상품 규격별 일반 표시가격을 한 표본으로 수집합니다. 가격비교의 판매처 수는 표본 수로 세지 않습니다. 원래 판매자 구분과 출처를 보존하며, eBay는 해외 통계로 분리합니다. 다나와 판매중 가격은 판매완료나 실제 거래가격으로 집계하지 않습니다.

- Public path: `/`
- 컴퓨터 맞추기: `/computer-builder.html` — 부품·세부 모델 선택, 수량, 가격별 부분 합계, 브라우저 저장·주소 공유
- 가격 분석: `/price-analysis.html` — 모델별 실제 금액 추이, 국내 통합·eBay·중고나라·번개장터·다나와 통계, 30일 화면을 최대 2년 범위에서 하루·한 달씩 이동
- Loopback port: `127.0.0.1:8789`
- Compose project: `used-market-domestic`
- 운영 검색: 번개장터, 중고나라, eBay 공식 Browse API
- PC 디렉터리: 위 검색 소스와 다나와 중고 가격비교
- 비활성 소스: 기존 다나와 장터 adapter, 헬로마켓, 리씽크몰, 쿨엔조이, 당근, 퀘이사존

운영 구조와 장애 대응은 [위키](docs/wiki/README.md)에서 시작합니다. [가격 통계 게시 운영](docs/wiki/09-price-publication-operations.md)은 AWS/Worker 역할·수집 주기·검증·복구 절차를, [2026-09-24 장애 기록](docs/worklog/2026-09-24-aws-publication-verification.md)은 CPU 장애 원인·구조 변경 결정·실제 배포 및 게시 증거를 보존합니다. Workers Free를 유지하며 전체 통계 검증은 AWS에서 수행합니다.

```bash
npm ci
npm test
npm run pc:contract
npm run test:pc:live-specialist
docker compose up -d --build
```

실제 eBay 검색에는 `.env` 또는 AWS 러너의 보호된 환경 파일에 `EBAY_CLIENT_ID`와 `EBAY_CLIENT_SECRET`을 설정합니다. 인증정보는 Git에 커밋하지 않습니다.
`test:pc:live-specialist`는 현재 비활성인 다나와 장터 adapter를 진단 목적으로 실제 요청하므로 운영자가 명시적으로 점검할 때만 실행합니다.

컴퓨터 맞추기와 가격 분석은 국내 개인·업체 중고의 정상 작동·KRW 통계를 사용합니다. 판매중 평균, 판매완료 매물의 마지막 표시가, 근거가 있는 확인 거래가는 서로 대체하지 않습니다. 없는 날짜는 차트의 공백, 없는 부품 가격은 부분 합계로 표시합니다. 과거 차트 조회가 최근 30일 조합 가격을 바꾸지 않습니다. 호환성은 제공된 소켓·메모리 규격만 확인하며 BIOS·크기·전원 커넥터는 별도 확인이 필요합니다.

SSD·HDD·파워서플라이의 공개 제품 ID는 각각 `제조사 × 용량 구간`, `제조사 × 용량 구간`, `제조사 × 정격 출력 구간`으로만 구성합니다. 세부 제품명은 검색 별칭이고 M.2·NVMe·폼팩터·효율·모듈러 방식은 보조 필터입니다. 제조사를 확정할 수 없으면 `기타/미분류 제조사`로 분리합니다. 과거 `as_of`에 해당하는 통계 창이 보존돼 있지 않으면 현재 통계로 대체하지 않고 `503 HISTORICAL_PRICE_STATS_UNAVAILABLE`을 반환합니다.
