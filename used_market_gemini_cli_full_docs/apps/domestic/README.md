# USED MARKET

국내 중고 사이트와 eBay의 PC 관련 매물을 수집·분류하고, 검증된 국내 개인 중고 단품의 가격 통계를 제공하는 운영 애플리케이션입니다.

- Public path: `/`
- Loopback port: `127.0.0.1:8789`
- Compose project: `used-market-domestic`
- PC directory sources: Danawa Market (domestic specialist), eBay (overseas PC parts)
- Legacy search sources: Joonggonara, Hello Market, Rethink Mall, eBay
- Specialist review queue: Quasarzone (HTTP 403), Coolenjoy (robots denied)

```bash
npm ci
npm test
npm run pc:contract
npm run test:pc:live-specialist
docker compose up -d --build
```

실제 eBay 검색에는 `.env` 또는 AWS 러너의 보호된 환경 파일에 `EBAY_CLIENT_ID`와 `EBAY_CLIENT_SECRET`을 설정합니다. 인증정보는 Git에 커밋하지 않습니다.
`test:pc:live-specialist`는 다나와 장터의 PC 카테고리를 실제 요청하므로 운영자가 명시적으로 점검할 때만 실행합니다.
