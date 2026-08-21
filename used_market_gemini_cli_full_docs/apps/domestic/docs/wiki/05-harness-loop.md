# 하네스와 개선 루프

## 검색 세션 정책 계약

```powershell
npm run search-session:contract
```

이 계약은 외부 사이트를 호출하지 않고 다음을 검증한다.

- 전체 검색과 특정 사이트 보기가 같은 수집 키를 사용한다.
- `view_sites`가 같은 SQLite 스냅샷에서 해당 사이트만 반환한다.
- `focus_sites`가 사이트 집중 수집 대상을 제한한다.
- 웹 UI가 사이트 결과를 먼저 렌더링한 뒤 비동기 보강 요청을 보낸다.
- 사이트 보강 뒤 스냅샷 3페이지(90개)를 미리 읽고 사용자가 이동한 현재 페이지를 유지한다.
- 웹 UI가 전체 스냅샷과 사이트별 응답을 분리해 다른 사이트 전환 때 0개로 깜빡이지 않는다.
- `낮은 가격`이 현재 결과를 즉시 숫자 가격순으로 재배열하고 `collect_view`를 호출하지 않는다.
- 정렬·가격 범위·페이지 이동이 SQLite 읽기만 사용하며 원 사이트 수집 카운터를 늘리지 않는다.
- `cache_first`가 stale 저장 결과를 먼저 응답하고 백그라운드 갱신을 예약한다.
- `shadow` 모드에서도 `refresh_index=false`인 보기 요청은 원 사이트 수집 없이 `index_view`로 응답한다.
- 숫자 가격이 위험 등급보다 먼저 적용돼 낮은 가격 결과에 가격 역전이 없다.

이 하네스 통과는 원 사이트 응답 품질까지 증명하지 않는다. 배포 전에는 `npm run search:matrix:live`와 브라우저에서 `전체 → 사이트 탭 → 3페이지 → 낮은 가격 → 다음 매물 더 찾기` 흐름을 별도로 확인한다.

## 실행 명령

```powershell
# fixture 회귀 검증
npm run harness

# 실제 사이트 smoke 검증
node harness/run.mjs --mode live --case CASE-LIVE-001

# Cloudflare Worker 계약 검증
npm run cloudflare:harness

# 실제 카테고리 단일·다중·비활성 회귀 (웹 서버 필요)
npm run category:live

# 실제 브라우저 검색·더보기·찜·회색 카테고리·모바일 회귀 (브라우저 세션 필요)
npm run browser:contract

# 웹 입력·스케줄러·Cloudflare를 포함한 전체 계약
npm test
```

`npm test`의 `site-extractor-contract.mjs`는 활성 중고나라·번개장터 수집기와 휴면 레거시 어댑터의 파서 회귀를 분리해 검사한다. 공개 제품 계약은 별도 Worker·UI 하네스에서 중고나라·번개장터·헬로마켓·리씽크몰 네 곳만 허용하는지 확인한다. `npm run harness`는 일반 품질 fixture를 실행하고, 서버가 켜진 환경에서는 `HARNESS_BASE_URL`로 live API를 지정할 수 있다.

카테고리 통합 계약은 일반 fixture와 별도로 `harness/category-contract.mjs`에서 확인한다. 모든 클릭 카테고리가 `source_category` 또는 `keyword` 수집 전략을 가지는지, 사이트별 `selectable/availability`가 일관적인지, 중고나라·번개장터의 여러 소스 ID를 합산하는 매핑과 다중 카테고리 cursor 병합이 유지되는지를 검사한다. 번개장터 공식 카테고리 API의 opaque cursor·`slice:v1` 내부 위치와 중고나라·번개장터 aggregate cursor도 `web-contract`와 live 회귀에서 함께 확인한다.

```powershell
npm test
```

## 개선 순서

```text
fixture/live 실행
  -> 지표와 사이트별 결과 확인
  -> 실패 원인 분류
  -> collector/normalize/merge/UI 중 한 영역만 제안
  -> 코드 또는 fixture 변경
  -> 다시 실행
  -> 통과 증거를 이 위키에 기록
```

## 피드백 저장

- 검색 진위: `merge/result/ux-feedback/<date>/`
- UI parity: `merge/result/ux-feedback/<date>/`
- API: `POST /api/feedback`
- 요약: `GET /api/feedback/summary`

하네스는 검색 결과가 존재한다는 사실만 검증하지 않는다. 원본 URL, 노이즈 누출, 중복, 부분 실패 표시, 각 사이트 커버리지, 가격 이력 연결까지 함께 확인한다.

웹 계약 하네스는 빈 요청·잘못된 카테고리·잘못된 사이트·범위를 벗어난 limit을 400 입력 오류로 처리하는지 확인한다. 스케줄러 계약은 7개 작업, cron 표현식, 재시도 backoff, 실패 배치 메타데이터를 확인한다. Cloudflare 계약은 5개 trigger 제한, 일일 가격 갱신 창, downstream 502 전파를 확인한다.

검색 전용 계약은 헬로마켓·리씽크몰의 fixture parser뿐 아니라 `POST /api/search-only` 입력 검증과 소스 catalog 노출도 확인한다. 브라우저 런타임이나 외부 사이트가 차단되면 503 warning과 복구 가능한 요청 URL을 반환한다.

브라우저 회귀에서는 검색, 카테고리 클릭, 다음 결과 중복 방지, 찜 요약, 사이트별 회색 비활성, 모바일 메뉴 접근성과 콘솔 오류를 확인한다. 원본 커서가 없는 헬로마켓·리씽크몰도 AWS 스냅샷 커서로 다음 결과를 제공하고, 외부 차단은 성공으로 위장하지 않고 `확인 필요`와 사용자용 복구 안내를 보여야 한다.
