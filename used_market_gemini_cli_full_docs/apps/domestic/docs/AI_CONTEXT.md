# AI Context

## 목적

국내 중고 PC·컴퓨터 부품 매물을 여러 플랫폼에서 수집하고, 기존 부품 정규화 로직으로 구성·가격·신뢰 신호·가격 이력을 비교하는 서비스다.

## 현재 운영 기준 (2026-10-02)

- 운영 소스는 번개장터·중고나라·다나와 중고·eBay다. AWS가 수집·결정론 분류·SQLite 저장·일일 통계 계산·전체 게시 검증을 담당한다.
- Worker는 화면/API·인증·캐시·일일 호출·D1 통계 사본을 유지한다. Workers Free이며 `FREE_TIER_MODE=false`는 결제 플랜 표시가 아니다.
- 매물은 주기적으로 갱신하고 통계는 매일 03:00 KST에 게시 작업을 호출한다. 매물 freshness와 통계 publication/as_of를 따로 확인한다.
- 2026-09-24 Free CPU 장애 후, 4행 업로드·100개 활성 범위 페이지와 AWS 전체 readback 검증을 적용했다. 검증 우회나 유료 전환을 한 것이 아니다.
- 현재 계약·복구: [통계 게시 운영 위키](wiki/09-price-publication-operations.md). 배포/게시 ID·CPU 실측·남은 품질 문제: [당일 기록](worklog/2026-09-24-aws-publication-verification.md).
- 현재 수집 target set은 `pc-targets:5:full-master-v15`, enabled 대상 2,444개다. 대상 내용이 같은 이전 수집 기록은 원래 시각과 성공·실패 증거를 보존하며, 새 Intel i5-7600 대상 3개는 아직 수집 성공을 주장하지 않는다. 통계 범위 수는 고유 매물 수가 아니다.
- 운영 SQLite 점검은 mode=ro/query_only로 한다. ACTIVE·enabled 대상과 4개 운영 소스만 집계한다. 가격 게시 성공은 AWS·D1·공개 API의 게시 ID로 확인한다.
- CPU 모델은 제조사·Intel 제품군·전체 모델 번호와 접미사를 함께 대조한다. Intel i5-7600을 Ryzen 5 7600에 연결하지 않으며, master에 없는 Intel 모델은 통계에서 제외한다. 완제품 PC와 다른 부품 묶음도 단품 통계에서 제외한다.
- D1 전체 범위와 읽기 검증은 publication 인덱스와 rowid 커서를 사용한다. AWS가 새 전체 계산 결과를 먼저 준비하며, 관측 시각만 달라진 매물 재전송은 D1 쓰기를 하지 않는다. 인증·전체 범위·체크섬·중복 게시 방지는 유지한다.
- 2026-10-02 전체 4,422개 통계 범위를 `47ce427c-a446-4723-9f3f-b7e17b84c93f`로 게시했다. `published=true`, `aws-readback-v1`이며 AWS·D1 전체 범위와 공개 API를 대조했다. 삼성 DDR5 16GB 국내 판매중 평균은 279,789.47원·19건이며 다나와 2건을 포함한다. 잘못 연결된 Intel i5-7600과 확인한 i3 완제품·RAM 묶음은 해당 단품 통계에서 제외했다.
- 최신 Worker 배포는 `04a59064-42fd-4ee2-a544-4057306bdeeb`다. PC API의 내부 캐시는 유지하고 브라우저 사본은 재검증해 수정 전 링크·가격이 오래 남지 않게 한다. 자동 수집은 재개했고 이번 한 번 실행 예약 `used-pick`은 `PAUSED`다.
- 다나와의 최근 85개 수집 요청은 접근 제한으로 실패했으며 이전 정상 관측을 게시에 사용했다. 모든 출처의 최신 수집 성공이나 실제 체결가 확인을 주장하지 않는다.
- 삼성 DDR5 16GB의 번개장터 `424284059`는 SOLD 마지막 표시가 2,200,000원이며 `IQR_HIGH`로 표시돼 있다. 저장 본문이 없고 공개 HTML도 일반 셸만 반환해 실제 단품 제안·체결가 여부는 미확인이다. 숫자만으로 통계에서 제거하거나 과거 산정 기준을 바꾸지 않았다. GTX 980 Ti의 중고나라 `230740228`은 공개 본문에서 20주년 소장품 설명을 확인했으며 다른 부품 묶음 근거는 없었다.
- 비활성 소스의 과거 공개 매물과 잘못 적격 처리된 사기주의 글은 별도 품질 과제다. 체크섬 통과나 health만으로 가격 품질 해결을 주장하지 않는다.
- 2026-10-02 CPU 분류·수량·본문 보존·target set 변경의 `npm run test:pc`는 통과했다. 이후 브라우저 캐시 수정의 서비스·UI 계약도 통과했다. 2026-09-24 전체 `npm test`의 기존 `analysis-table-pane` 불일치 기록은 당시 기록으로 보존한다.

## 이전 검색 설계 참고 (2026-08-30)

아래는 당시 범용 검색과 전환 과정의 기록이다. 운영 소스·수집 cadence·게시 구조는 위의 최신 기준을 우선하며 legacy `/api/search` 동작을 현재 PC 공개 API로 해석하지 않는다.

- 웹 서버: `npm run web`, 기본 포트 `8787`
- 스케줄러: `npm run scheduler`, 기본 시간대 `Asia/Seoul`
- 기본 결정론 하네스: `npm test`
- PC 서비스 네 계약 축: `npm run test:pc`
- Cloudflare Worker 계약 하네스: `npm run cloudflare:harness`
- PC 원장·분류·통계 계약: `npm run pc:contract`
- 운영 검색: 중고나라·헬로마켓·리씽크몰·eBay. 번개장터는 정책 검토 중이라 비활성이다.
- 당근은 지역별 결과를 정확히 구분할 수 없는 공개 검색 경계 때문에 운영 대상에서 제외한다.
- 검색 소유권: Cloudflare Worker가 정적 UI·공개 API·D1 장애 대체 경계를 담당하고, Named Tunnel 뒤 AWS Node 러너가 원 사이트 수집·품질 정책·SQLite 주 색인을 담당한다.
- legacy `/api/search` 결과 예산: 초기 사이트별 최대 160개·전체 최대 640개, 확장 스냅샷 최대 1,000개, PC·모바일 모두 30개씩 번호 페이지
- 최신성: 기본 6시간. 저장 결과를 먼저 표시한 뒤 최근 결과를 확인하고 신규·변경만 병합한다.
- legacy `/api/search` 검색 세션: 검색어·카테고리·처음 선택한 사이트 묶음이 수집 키다.
- legacy 사이트 집중 수집은 rollback 경로에만 남고 새 PC 디렉터리 화면에서는 호출하지 않는다.
- 낮은 가격: 현재 결과를 즉시 숫자 가격순으로 재배열하고 같은 SQLite 스냅샷의 가격순 페이지를 읽는다. 정렬 변경만으로 원 사이트를 다시 수집하지 않는다.
- 카테고리 검색 기준: 중고나라·번개장터의 공식 원본 카테고리 경로를 우선한다. 헬로마켓·리씽크몰·eBay는 명시 검색어가 있을 때만 키워드 결과를 로컬 카테고리 분류해 통합하고, 검색어 없는 카테고리 탐색에는 참여하지 않는다.
- 정렬: 추천, 낮은 가격, 높은 가격, 최신. 가격 정렬은 같은 SQLite 스냅샷을 숫자 가격 기준으로 읽으며 원 사이트를 다시 수집하지 않는다.
- 통화: eBay USD와 국내 KRW가 섞인 전체 보기에서는 환율 없는 오정렬을 막기 위해 가격순·가격 범위를 비활성화한다. 사이트 하나를 선택하면 해당 통화 안에서 정렬·필터링한다.
- 페이지: 사이트 보강으로 90개를 받으면 `1 2 3 4 … 마지막`을 표시한다. 1~3은 즉시 이동하고 4는 cursor 한 번으로 이동한다. 먼 마지막 페이지는 비활성 총량 표시다.
- PC 카테고리와 소스 정책: `docs/decisions/ADR-pc-parts-ledger-and-source-policy.md`
- 그래프: 실제 관측값과 수동 seed 분리, 2개 이상 관측일 전에는 추세 보류
- PC 전용 계층: `pc_parts_v1` 검색 projection과 AWS SQLite 원장에 원본·상태·제품 master·30일 통계를 분리 저장한다.
- PC 기본 UX: 사전수집형 제품 디렉터리다. 공개 catalog·products·listings 조회는 원 사이트 수집을 실행하지 않으며, 부품군·규격/용량·제조사·정확 모델 순으로 내부 publication을 탐색한다.
- PC 제품 master: Intel 6세대·Ryzen 1000·GTX 900 이후를 포함한 V3 828개 디렉터리 노드다. 공개 7개 부품군은 702개 모델이며 SSD 70개·HDD 40개·PSU 84개는 제조사와 연속 용량/정격출력 구간의 곱으로만 식별한다. GPU 칩 제조사와 보드 제조사는 별도 역할로 저장한다.
- PC 수집 주기: 승인된 소스 스크립트를 AWS Runner에서 매시간 분할 실행하고, 일별 가격 통계는 03:00 KST에 확정한다. 사용자 화면 요청은 수집 target을 만들거나 실행하지 않는다.
- 가격 의미: 판매완료는 명시적 SOLD만 인정하고, 통계에는 실제 체결가가 아닌 `sold_last_ask_price`를 사용한다. 기존 검색 `price_history`는 legacy read-only다.
- 메인보드 가격 의미: B550 같은 칩셋과 제조사·플랫폼 facet은 검색 조건일 뿐 통계 identity가 아니다. 기준가격과 저가 판정은 `pc-master-v4`의 검증된 정확 모델 `PRODUCT`에만 제공하고, 미확인 모델은 `EXACT_MODEL_REQUIRED`로 검색 결과에만 유지한다.
- 과거 가격 조회: 요청 `as_of`가 저장된 통계 창과 일치할 때만 반환한다. 보존되지 않은 과거 창은 현재 통계로 가장하지 않고 명시적 unavailable 응답을 낸다.
- 다나와 중고: 승인된 공개 통합검색 HTML로 수집하고 원본은 `KR_DEALER_USED`에 보존한다. 국내 평균 `KR_DOMESTIC_USED`는 국내 개인·업체 중고의 유효 표본을 합산하며 eBay는 제외한다. 기존 다나와 장터 adapter와 쿨엔조이는 비활성이다.

## 위험 경계

- 사이트 수집 결과는 공개 페이지와 접근 제한의 영향을 받는다.
- 판매완료·비활성·가격 이상 매물은 최종 비교에서 제외될 수 있다.
- 검색 목록 소실은 판매완료가 아니다. 3회 재확인 후에도 `UNAVAILABLE_UNKNOWN`으로만 이동한다.
- AWS 러너 장애 시 Worker는 D1의 제한된 저장 결과를 사용할 수 있지만 5개 사이트 원본 수집과 동일하지 않다.
- legacy `/api/search`는 저장 색인이 있으면 stale 결과를 먼저 제공하고 백그라운드 갱신을 예약할 수 있다. 새 PC 디렉터리 API는 cache miss에서도 원 사이트를 기다리거나 수집하지 않는다.
- 사이트 탭은 기존 전체 결과에서 즉시 필터링한 뒤 선택 사이트만 보강하고, 첫 3페이지(90개)를 미리 읽는다.
- 원 사이트가 가격 범위 파라미터를 지원하지 않으면 제한된 후보 창에 로컬 범위를 적용한다. 무제한 수집은 하지 않는다.
- `낮은 가격`은 확인한 후보 창 안의 품질 우선 가격순이다. 모든 원 사이트의 무한 목록에서 절대 최저가를 보장한다는 의미가 아니다.
- 토큰·API 키·계정 정보는 문서나 저장소에 기록하지 않는다.
- eBay는 `EBAY_CLIENT_ID`와 `EBAY_CLIENT_SECRET`으로 OAuth 토큰을 자동 발급·캐시한다. 짧은 수명의 `EBAY_BROWSE_API_TOKEN`은 진단용 선택 덮어쓰기다.

## 다음에 읽을 문서

- 사이트별 검색: `docs/wiki/02-search-verification.md`
- PC taxonomy·소스 정책: `docs/decisions/ADR-pc-parts-ledger-and-source-policy.md`
- 사전수집형 제품 디렉터리: `docs/decisions/ADR-precollected-pc-parts-directory.md`
- 가격 그래프: `docs/wiki/03-price-history.md`
- Runner 배포: `docs/wiki/04-cloudflare-runner.md`
- 검증 루프: `docs/wiki/05-harness-loop.md`
- 캐시·검색 UX: `docs/wiki/08-cache-search-ux.md`
- PC 원장·소스 정책: `docs/decisions/ADR-pc-parts-ledger-and-source-policy.md`
