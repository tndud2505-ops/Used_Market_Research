# USED MARKET

국내 중고 사이트와 eBay 매물을 한 화면에서 검색하는 운영 애플리케이션입니다.

- Public path: `/`
- Loopback port: `127.0.0.1:8789`
- Compose project: `used-market-domestic`
- Sources: Joonggonara, Bunjang, Hello Market, Rethink Mall, eBay

```bash
npm ci
npm test
docker compose up -d --build
```

실제 eBay 검색에는 `.env` 또는 AWS 러너의 보호된 환경 파일에 `EBAY_CLIENT_ID`와 `EBAY_CLIENT_SECRET`을 설정합니다. 인증정보는 Git에 커밋하지 않습니다.
