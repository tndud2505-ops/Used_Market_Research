# PC 서비스 검증 루프

`npm test`는 빌드 후 PC 원장·분류·소스 정책·eBay 해외 시장군·30일 통계·D1 publication·검색 projection·인증 및 복구 계약을 실행한다. 범용 패션/모바일 카테고리, 실사이트 비교 보고서, 브라우저 부하 하네스는 기본 차단 조건에서 제거했다.

기본 suite는 `pc-domain`, `pc-source-policy`, `pc-publication`, `pc-service` 네 축이다. `npm run index:harness`와 `npm run cloudflare:harness`는 설치·릴리스 호환 alias이며 같은 필수 계약을 재사용한다.

## 기본 검증

```powershell
npm test
```

루트 패키징까지 확인할 때는 다음을 사용한다.

```powershell
powershell -File .\scripts\verify.ps1
```

## 운영 검증

실사이트와 운영 서버는 결정론 테스트와 분리한다.

```bash
bash aws-runner/health-check.sh
bash aws-runner/smoke-search.sh
```

`--run-job`은 실제 수집을 발생시키므로 운영자 승인 후 승인된 소스에만 사용한다. `REVIEW_REQUIRED` 소스는 robots 응답이나 parser fixture만으로 활성화하지 않는다.

## 실패 기준

정확히 차단하는 항목은 보안·인증·대상 식별·원본/통계 데이터 무결성·거짓 SOLD·시장군 혼합·잘못된 자동 중복 병합·부분 publication·복구 실패다. 표본 정확도 같은 품질 지표는 인간 검수셋의 추세와 허용 범위로 판단한다.
