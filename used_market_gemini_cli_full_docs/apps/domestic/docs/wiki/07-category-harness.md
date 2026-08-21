# 카테고리 연결 하네스

## 목적

사이트마다 카테고리 이름과 공식 ID가 다르더라도 화면·API·브라우저 수집기가 같은 canonical 카테고리 계획을 사용하게 한다. canonical 기준은 중고나라의 21개 1차 카테고리다. 새 사이트에 공식 카테고리 ID가 아직 없으면 `unavailable/selectable: false`로 기록하며, 키워드 추정 결과를 카테고리 통합 결과로 표시하지 않는다.

## 단일 연결 지점

- canonical 카테고리: `market/logic/category-catalog.ts`의 `CATEGORY_NODES`
- 사이트 등록부: 같은 파일의 `CATEGORY_SITE_REGISTRY`
- 계획 생성·검증 하네스: `market/logic/category-harness.ts`
- 사이트 브라우저 URL: `collector/logic/sites/<site>.ts`의 `categoryUrl()`
- API 노출: `GET /api/categories`의 `site_plans`, `source_bindings`

`resolveCategoryCollectionPlan(siteKey, categoryId)`는 다음 우선순위를 항상 지킨다.

1. 요청한 canonical 카테고리의 확인된 공식 ID가 있으면 `source_category` + `official`로 계획한다.
2. 공식 ID가 부모에만 있으면 `source_category` + `parent_fallback`으로 기록하지만 `selectable: false`로 둔다.
3. 공식 ID가 없으면 `keyword` + `unavailable`로 기록하고 사이트 카테고리 클릭을 막는다.

따라서 “사이트에는 없는 카테고리인데 클릭하면 빈 결과가 나오는” 상태를 정상 동작으로 취급하지 않는다.

## 새 사이트 추가 순서

1. `collector/logic/sites/<site>.ts`에 `BrowserSiteAdapter`를 추가한다. 공식 카테고리 URL을 지원하면 `categoryUrl(sourceCategoryId, limit, cursor)`를 구현한다.
2. `collector/logic/sites/index.ts`의 어댑터 목록과 `collector/logic/sites.ts`의 지원 사이트 목록에 같은 `siteKey`를 등록한다.
3. `market/logic/category-catalog.ts`의 `CATEGORY_SITE_REGISTRY`에 같은 `siteKey`를 추가한다.
   - 공식 ID가 확인된 항목만 `bindings`에 넣는다.
   - 아직 확인되지 않은 항목은 넣지 않는다. 하네스가 자동으로 회색 `unavailable` 계획을 만든다.
   - 한 canonical 카테고리가 여러 소스 ID로 나뉘면 `sourceCategoryIds`와 `collectionMode: "aggregate"`를 사용한다.
4. `harness/category-harness-contract.mjs` 또는 별도 사이트 계약에 공식 URL·ID·페이지네이션 fixture를 추가한다.
5. 아래 명령을 실행한다.

```powershell
npm run build
npm run category:harness
npm test
```

지원 사이트 목록과 `CATEGORY_SITE_REGISTRY`가 다르면 하네스 계약이 실패한다. 즉, 새 사이트를 수집 어댑터에만 추가하고 카테고리 연결을 빼먹는 실수를 배포 전에 잡는다.

## 검증 의미

`npm run category:harness`는 다음을 검사한다.

- 모든 canonical 카테고리와 등록 사이트에 유효한 계획이 있는지
- 중복 사이트·카테고리 ID와 존재하지 않는 부모/매핑을 거절하는지
- 공식 매핑이 없는 새 사이트가 `unavailable`·비선택 상태가 되는지
- 자식 카테고리에 부모 공식 ID만 있을 때 `parent_fallback`·비선택 상태가 되는지
- 수집 사이트 목록과 카테고리 사이트 등록부가 일치하는지

실제 외부 사이트의 ID가 유효한지는 기존 `npm run bunjang:taxonomy`, `npm run joonggonara:taxonomy`, `npm run category:live`에서 확인한다. 하네스 통과만으로 외부 사이트가 차단되지 않았거나 상품이 충분하다는 뜻은 아니다.

## 운영 원칙

- 화면에서 카테고리 연결 여부를 별도 조건문으로 다시 판단하지 않는다. `/api/categories.site_plans[site][category]`를 사용한다.
- `official`만 클릭 가능하다. `parent_fallback`과 `unavailable`은 회색으로 표시한다.
- 키워드 fallback 결과는 일반 키워드 검색의 `inferred` 결과로만 취급한다. canonical 카테고리 검색에서는 사이트를 호출하지 않는다.
- 새 사이트의 공식 매핑을 임의로 추정하지 않는다. 확인 전에는 등록부에서 비워 둔다.

## 현재 분류 기록

- 분류 규칙과 사이트별 매핑은 `docs/decisions/ADR-joongna-canonical-category-policy.md`에 기록한다.
- 실행별 JSON 증거는 `merge/result/harness/category-mapping/`에 남긴다.
- 기록 생성 명령은 `npm run category:record`다. 이 명령은 중고나라 기준 카테고리 수, 사이트별 official/parent_fallback/unavailable 수, 각 canonical의 원본 ID를 저장한다.
- 실제 검증은 `npm run category:live`와 `npm run category:matrix:live`로 반복한다. 외부 사이트 차단·429·빈 결과는 매핑 실패와 섞지 않고 warning/error로 남긴다.
