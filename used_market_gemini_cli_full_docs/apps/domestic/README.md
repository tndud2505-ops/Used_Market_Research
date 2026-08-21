# USED MARKET Domestic

한국 중고 검색 전용 독립 애플리케이션입니다. 해외 앱의 코드, 하네스, 결과 볼륨을 참조하지 않습니다.

- Public path: `/`
- Loopback port: `127.0.0.1:8789`
- Compose project: `used-market-domestic`
- Sources: Joonggonara, Bunjang, Hello Market, Rethink Mall

```bash
npm ci
npm test
docker compose up -d --build
```

UI는 해외 앱과 같은 시각 구조를 복사해 사용하지만 파일은 이 폴더가 독립 소유합니다.
