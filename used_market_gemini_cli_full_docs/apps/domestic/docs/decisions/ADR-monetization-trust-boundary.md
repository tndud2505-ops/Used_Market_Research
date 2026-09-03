# ADR: 가격 통계와 수익화 경계

- 상태: 채택
- 날짜: 2026-08-29

## 결정

가격 통계·추천순·검색 결과는 광고와 독립적으로 계산한다. 광고·제휴 링크는 정확한 PC 상품 또는 카테고리 목적지가 검증된 경우에만 유기적 콘텐츠 뒤의 별도 모듈 한 곳에 표시한다. 범용 목적지 fallback, 초기 화면 광고, 결과 없음 광고, 가격/기준가격 영역 광고는 허용하지 않는다.

현재는 검증된 정확 목적지가 없어 `MONETIZATION_ENABLED=false`로 모든 제휴 모듈을 숨긴다. 생활용품 쿠팡 히어로·문맥 배너·우측 배너·빈 결과 CTA를 제거했다.

## 필수 경계

- 제휴 링크는 `rel="sponsored noopener noreferrer"` 또는 동등한 referrer 차단을 사용한다.
- 링크 바로 옆에 수수료 고지와 시세·추천순 무관 문구를 둔다.
- 제휴 가격과 `OPTION_AD` 매물은 통계 표본에 포함하지 않는다.
- 측정 이벤트에는 원문 검색어, 상품명, 전체 URL, 자유 입력, 영구 사용자 ID를 저장하지 않는다.
- 고지 누락, 허용되지 않은 목적지, 통계 오염은 fail-closed로 차단한다.

## 활성화 계약

- `AFFILIATE_ALLOWED_ORIGINS`에 등록된 HTTPS origin과 `AFFILIATE_OFFERS_JSON`의 승인·검토일·만료일을 모두 통과해야 한다.
- offer는 하나의 정확한 `canonical_product_id` 또는 `category_code`에만 연결한다. `/` 홈페이지와 범용 fallback은 거절한다.
- Worker는 유기 매물 응답과 별도인 `/api/monetization/contextual-offer`에서 offer를 최대 1개 반환한다. UI는 유기 결과와 페이지네이션 뒤의 전용 영역에만 표시한다.
- 전역 kill switch는 `MONETIZATION_ENABLED`이며 잘못된 JSON, 미승인·만료 offer, origin 불일치 때는 오류 대신 모듈을 숨긴다.
- `MONETIZATION_EVENT_SECRET`은 32바이트 이상의 운영 secret으로만 설정한다. 누락·부족 시 offer를 숨기며, 짧게 만료되는 HMAC event token 검증을 통과한 노출·클릭만 집계한다.
- 운영 secret은 소스나 `wrangler.jsonc`에 넣지 않고 `npx wrangler secret put MONETIZATION_EVENT_SECRET --config cloudflare/wrangler.jsonc`로 저장한 뒤 kill switch를 켠다.
- 운영자 문의 채널과 정확한 제휴 목적지가 공개되기 전에는 `MONETIZATION_ENABLED=false`를 유지한다.
- 측정은 `offer_id`, slot, 제품/카테고리 문맥별 일일 노출·클릭 합계만 저장하고 180일 후 삭제한다. 원문 검색어·상품명·전체 URL·IP·영구 사용자 ID는 측정 원장에 넣지 않는다.
- event token에는 짧게 만료되는 무작위 ID를 포함하고, 같은 token의 동일 이벤트 재사용은 dedup 원장에서 거절한다. 만료 token과 180일 초과 집계는 이벤트 유입 여부와 무관하게 scheduler가 정리한다.
- 운영자 bearer secret 비교는 고정 길이 digest를 사용한다. 공개 스모크가 실패하면 release 명령은 Wrangler의 직전 Worker 버전 rollback을 자동 실행한다.

## 후속 순서

무광고 기준선을 측정한 뒤 정확한 PC 문맥 제휴 모듈 1개, 목표가 알림의 프리미엄 수요, PC 모델별 고유 통계 콘텐츠 기반 수동 광고, 집계 데이터 권리와 SLA가 확인된 B2B 순으로 검토한다.
