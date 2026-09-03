# PC service contracts

기본 검증은 범용 중고검색의 화면별 회귀가 아니라 PC 부품 가격 서비스의 데이터 무결성과 운영 경계를 확인한다.

```powershell
npm test
npm run test:pc
npm run index:harness
npm run cloudflare:harness
```

필수 차단 항목은 원본 불변성·PII 제거·거짓 SOLD 방지·시장군/통화 분리·중복 실행 방지·서명 cursor·원자적 publication·인증/복구 경계다. 실사이트 수집, 브라우저 비교, 부하 측정은 운영자가 명시적으로 실행하며 `npm test`에 포함하지 않는다.

네 계약 축은 다음과 같다.

- `pc-domain-contract.mjs`: 분류·원장·PII·SOLD·시장군·통계 구성원
- `pc-source-policy-contract.mjs`: canonical 정책·격리·scheduler authority·eBay OAuth/USD
- `pc-publication-contract.mjs`: 통계 요청 범위·checksum·원자적 active pointer·실패 복구
- `pc-service-contract.mjs`: 인증·서명 cursor·snapshot·backup·D1 fallback·오류 비노출

정책 검토 중인 번개장터·다나와·쿨엔조이는 기본 계약에서 실제 호출하지 않는다. 승인 상태와 운영 활성화가 모두 충족된 뒤에만 별도 canary를 추가한다.
