# 2026-08-14 카테고리 기준 통합 작업 기록

## 요청

중고나라 카테고리 페이지는 결과가 나오는데 서비스의 카테고리 결과가 사이트마다 섞이거나 비는 원인을 확인하고, 중고나라 기준으로 통합 가능한 사이트만 묶는다. 분류 근거와 검증 결과를 계속 남긴다.

## 확인한 사실

- 중고나라 `https://web.joongna.com/search?category=19`는 `오토바이` 공식 검색 페이지이며 실제 오토바이 매물이 반환된다.
- 중고나라 메뉴에는 21개 1차 카테고리가 있고 `18`은 메뉴에 없다.
- 번개장터는 확인된 공식 category ID가 있는 항목만 안전하게 통합할 수 있다.
- 헬로마켓과 리씽크몰은 현재 공식 category ID 매핑이 없고 키워드 검색만 가능하다.
- 기존 Worker는 헬로마켓·리씽크몰의 키워드 결과를 모든 카테고리에서 `selectable: true`로 표시하고 있었다.
- 그 결과 `무료나눔` 요청에서 리씽크몰의 일반 상품이 무료나눔으로 섞이는 등 키워드 누수가 확인됐다.

## 반영한 변경

- Worker 카탈로그에서 헬로마켓·리씽크몰을 `unavailable/selectable:false`로 표시했다.
- Worker live search와 D1 fallback이 category 요청에서 공식 매핑이 없는 사이트를 호출하지 않도록 했다.
- 명시적으로 지원하지 않는 사이트를 함께 요청하면 400으로 반환하게 했다.
- category live contract가 사이트별 매핑을 읽고, 공식 사이트는 200 내용 검증, 비공식 사이트는 400 검증을 하도록 바꿨다.
- `npm run category:record`로 분류 매트릭스와 실행별 JSON을 남기게 했다.

## 다음 검증

```powershell
npm run build
npm run category:record
npm run category:harness
npm run category:live
npm run category:matrix:live
npm run browser:contract
```

검증 중 외부 사이트의 429·차단·일시적 빈 결과는 매핑 오류로 판단하지 않고 해당 실행의 warning/error로 분리한다. 공식 category URL과 ID가 바뀌었을 때만 `category-catalog.ts`와 `category-source-map.mjs`를 함께 갱신한다.

## 이번 실행 결과

- `npm run build`: 통과
- `npm run category:record`: 21개 1차 / 31개 canonical 기록 생성
- `npm run category:harness`: 통과, 124개 계획 검사
- `npm run cloudflare:harness`: 통과, 22개 검사
- `npm run category:live`: 통과, 187/187 케이스
  - 31개 검색 가능 canonical의 통합·개별·다중 카테고리 요청 확인
  - 공식 매핑이 없는 헬로마켓·리씽크몰 명시 요청은 400으로 차단 확인
- `npm run category:matrix:live`: 완료
  - 중고나라 21/21 공식 매핑·결과 확인
  - 번개장터 20개 공식 매핑 결과 확인, 1개 미매핑 제외
  - 헬로마켓 21개, 리씽크몰 21개는 공식 매핑 없음으로 제외
- 로컬 브라우저 확인
  - 카테고리 32개 렌더링 확인
  - 헬로마켓 선택 시 `fashion`, `motorcycle`, `free_share`가 비활성화됨
  - 번개장터 선택 시 `luxury`, `travel`이 비활성화되고 `motorcycle`·`fashion_men_jumpsuit`는 활성화됨
  - 중고나라 → 오토바이 클릭 시 `총 16개`, `중고나라 16개` 결과 확인
- 로컬 정적 서버가 `.mjs`를 `application/octet-stream`으로 내려 모듈 UI가 멈추던 문제도 `text/javascript`로 수정하고 asset query를 갱신했다.

실행 JSON은 `merge/result/harness/category-mapping/latest.json`, `merge/result/harness/category-live/latest.json`, 그리고 category matrix 실행 폴더에 저장했다.

## 21개 상위 카테고리 실제 사이트 비교표

`npm run category:compare`를 실행해 중고나라 기준 21개를 사이트별로 직접 비교했다.

- 중고나라: 21/21 공식 매핑, 21/21 실제 검색 pass, 각 20개 상품의 원본 category ID 일치율 100%.
- 번개장터: 17개 공식 매핑·실제 검색 pass, 4개는 공식 매핑 없음으로 제외했다. 제외 항목은 수입명품·레저/여행·중고차·무료나눔이다.
- 헬로마켓: 21개 모두 키워드 검색만 가능. 15개 카테고리에서 결과 상품이 추출됐지만 공식 category ID가 없어 통합 대상에서 제외했다.
- 리씽크몰: 21개 모두 키워드 검색만 가능. 19개 카테고리에서 결과 상품이 추출됐지만 공식 category ID가 없어 통합 대상에서 제외했다.
- 실제 브라우저 교차 확인: 중고나라 `category=19`에서 선택 카테고리 `오토바이`, 실제 매물·가격 요약이 확인됐다. 번개장터 `750800`에서 `오토바이/스쿠터`, 상품 20,750개가 확인됐다. 헬로마켓은 `오토바이` 키워드 결과 592개를 표시했다. 리씽크몰은 브라우저 화면의 현재 요약이 4개였지만 수집기 원자료는 20개를 보고해 시점/초기 HTML 차이가 확인됐으므로 `warn`으로 남겼다.

비교표와 원자료:

- `merge/result/harness/category-comparison/latest.md`
- `merge/result/harness/category-comparison/latest.csv`
- `merge/result/harness/category-comparison/latest.json`

분류 정책은 표의 `최종 판정`과 동일하게 유지한다. 공식 category ID가 없는 사이트는 검색 결과가 나오더라도 카테고리 통합에서 제외하고, 키워드 결과는 비교용 증거로만 남긴다.

리씽크몰의 원자료 추출 수와 브라우저 화면 수가 달라지는 문제는 카테고리 통합을 막는 현재 정책상 서비스 혼입으로 이어지지는 않지만, 리씽크몰을 향후 통합하려면 먼저 추출기와 초기 HTML/동적 렌더링 기준을 추가 점검해야 한다.

## 실제 운영 배포

`npm run cloudflare:release`로 실제 운영 배포를 완료했다.

- Worker: `used-market-runner`
- Version ID: `a6f797fa-c230-45ce-be49-4a8217aa6958`
- 운영 주소: `https://used-pick.com`, `https://www.used-pick.com`
- 두 도메인 `/health`: `ok=true`
- 두 도메인 `/api/categories`: 32개 카테고리 반환
- 배포 후 `POST /api/search`의 `motorcycle` + `joonggonara,bunjang` 요청: 성공, 20개 결과, 두 공식 사이트 모두 `ready`
- 배포 후 `hellomarket`을 명시한 `motorcycle` 요청: 400 차단 확인

릴리스 하네스 로그에 AWS 검색 러너 오류 시 D1/live fallback으로 전환하는 기존 경고가 있었지만, 배포 후 공개 검색 API는 실제 live 결과와 `success` 응답을 반환했다.

## 2026-08-14 결과량·가격검색 개선 기록

- 기존 문제: `limit=40`이 전체 결과 창으로 적용되어 여러 사이트를 선택하면 사이트별 결과가 10~20개로 쪼개졌다.
- 변경: 화면 페이지는 16개를 유지하고, 검색 원본 창은 선택한 사이트마다 최대 40개로 분리했다. 여러 사이트 선택 시 `40 × 사이트 수`를 품질 필터 후 보관한다.
- 사이트 탭: `당근`을 추가했다. 당근 공개 JSON-LD 검색 결과를 4개 지역에서 합산하며, 40개보다 실제 결과가 적으면 부족 수량을 경고하고 임의 상품으로 채우지 않는다.
- 가격 필터: 가격 적용 시 기존 배열만 재배열하지 않고 `min_price/max_price`가 포함된 새 검색 요청을 만든다. 운영 Worker는 가격 조건이 있는 요청을 live source 재검색 경로로 보낸다.
- 운영 러너: 여러 사이트 검색은 사이트별로 원본 러너를 호출해 한 번의 전역 40개 응답이 다시 분배되는 문제를 제거했다.
- 검증: `npm test` 통과, Cloudflare harness 22개, live-search harness 127개 통과. per-site synthetic contract에서 2개 사이트 각각 40개, 총 80개 보관을 확인했다.

## 2026-08-14 최종 운영 검증

- 품질 우선 수집량: 사이트별 후보를 최대 160개까지 먼저 수집한 뒤 중복·판매상태·키워드 품질을 판정하고, 최종 노출 창은 사이트별 최대 40개로 제한했다. 따라서 느려질 수 있지만 검색 가능한 원본을 더 넓게 확보한다.
- 당근 운영 검색: `오토바이` 단독 검색에서 `총 40개 · 1/3페이지`를 확인했다. 당근은 수원시 우만동·인계동·매탄동·원천동 4개 지역을 합산한다.
- 당근 품질 경고: 공개 원본 50개에서 정확 키워드 일치가 부족한 경우 소스 순위 fallback을 사용하고, `DAANGN_SOURCE_RANKED_FALLBACK` 경고를 함께 표시한다. `DAANGN_BELOW_TARGET`도 함께 기록해 40개를 임의로 만들어내지 않는다.
- 가격 재검색: 운영 화면에서 최소 10,000원·최대 80,000원 적용 후 새 요청으로 재검색했고, `총 26개 · 1/2페이지`와 모든 표시 가격의 범위 내 결과를 확인했다.
- 운영 배포: Worker `used-market-runner`, Version ID `da9c110f-e8da-44c8-8eef-fcf1a86b7397`, 주소 `https://used-pick.com` 및 `https://www.used-pick.com`.
- 최종 검증: `npm test` 전체 통과, Cloudflare harness 22개, live-search harness 127개, HTTP contract 32개, fixture 2/2 통과. 배포 화면에서도 당근 40개, 가격 재검색 26개, 지역·설명 표시를 확인했다.
