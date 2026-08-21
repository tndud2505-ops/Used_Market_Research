# 검색 UX·품질 하네스

## 검색 세션 정책

`npm run search-session:contract`는 전체 검색 스냅샷의 사이트 보기, 선택 사이트 집중 보강, 낮은 가격 원본 수집 요청을 fixture로 검증합니다. 외부 사이트를 호출하지 않으므로 운영 배포 전에는 live 검색과 브라우저 흐름을 추가로 확인합니다.

`moajung.com`을 화면 기준으로 삼되, 결과 품질과 실패 상황을 같은 케이스로 반복 검증하기 위한 최소 하네스입니다.

## 실행

fixture 기반 검증은 외부 사이트와 서버가 없어도 실행됩니다.

```bash
npm run harness
```

실제 검색 API를 확인하려면 먼저 웹 백엔드를 실행한 뒤 live smoke를 실행합니다.

```bash
npm run build
npm run web

node harness/run.mjs --mode live --case CASE-LIVE-001
```

결과는 다음에 저장됩니다.

```text
merge/result/harness/<run-id>/output.json
merge/result/harness/<run-id>/report.md
```

## 현재 자동 지표

- `result_valid_rate`: 제목·가격·원본 URL이 모두 있는 결과 비율
- `link_integrity`: 원본 URL이 HTTP(S)인 결과 비율
- `hard_noise_leak_rate`: 고장·부품용·구매희망·판매완료가 최종 결과에 남은 비율
- `duplicate_rate`: URL 또는 ID 중복 비율
- `relevance_precision_at_10`: 검색어 필수 토큰을 만족하는 상위 결과 비율
- `partial_failure_transparency`: 일부 플랫폼 실패가 warning/error로 설명되는지
- `site_search_coverage`: live 케이스에 지정된 사이트가 실제 raw 결과를 반환했는지
- `price_history_data_present`: 검색 응답에 컴퓨터 부품 가격 이력이 연결됐는지

## 개선 루프

하네스는 실패 시 자동 배포하지 않고 `improvement_proposals`에 다음 행동만 기록합니다. 제안이 실제 규칙 변경으로 이어질 때는 실패 fixture와 회귀 케이스를 먼저 추가합니다.

```text
fixture/live 결과
→ 품질 지표 계산
→ 실패 원인 기록
→ 개선 제안 생성
→ 사람이 검토
→ fixture 추가 또는 collector/market 규칙 수정
→ 전체 회귀 재실행
```

모아줌 비교 피드백은 웹 화면의 `UX 검증` 섹션에서 입력하며, `merge/result/ux-feedback/<날짜>/`에 JSON으로 저장됩니다.

Cloudflare Worker 계약은 별도 하네스로 확인합니다.

```bash
npm run cloudflare:harness
```

실제 브라우저에서 검색·더보기 중복·찜 요약·사이트별 회색 비활성·모바일 접근성을 확인하려면 웹 백엔드를 실행한 뒤 다음을 수행합니다.

```bash
npm run browser:contract
```

이 검사는 `npx --yes --package @playwright/cli playwright-cli`를 사용하며, 라이브 사이트 응답과 열린 Playwright 브라우저 세션이 필요합니다.
