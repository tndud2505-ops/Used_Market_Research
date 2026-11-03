# USED PICK 구현 요청 프롬프트 — 최신 수정안

이 문서와 이미지 3장을 함께 전달하세요. 이전 professional-ui-preservation/PROPOSAL.md와 충돌하는 사항은 이 문서가 우선합니다. 현재 산출물은 디자인 제안이며 서비스 코드 변경이나 배포는 수행하지 않았습니다.

## 다른 작업자에게 전달할 프롬프트

현재 USED PICK의 검색·카테고리·가격 데이터 로직을 유지하면서 아래 UI 변경을 구현해 주세요.

1. 검색 페이지 상단의 영문 슬로건, 큰 홍보 제목, 설명, 표시가격 비교 서비스 배지를 제거하세요. 카테고리 탭은 기존 사이트 헤더 바로 아래로 최대한 붙이세요.
2. 모델 선택·사이트 선택·검색창을 하나의 조밀한 도구 영역으로 정리하세요. 기존 필터와 정렬 및 가격 범위 기능은 유지하세요.
3. 검색 결과는 항상 왼쪽 필터와 오른쪽 매물 목록 구조를 유지하세요. 모델이 하나만 남아도 분석 패널로 자동 전환하지 마세요. 모델 1개와 매물 1개는 다른 상태입니다. 한 모델에 해당하는 여러 매물은 모두 목록으로 표시하세요.
4. 검색 화면의 가격 흐름·대표가격·분석 패널을 제거하세요. 선택 모델이 하나로 확정되면 결과 도구 줄에 '가격 그래프 보기 ↗' 버튼 하나만 표시하세요. 각 매물 행에 반복하지 마세요. 클릭하면 별도 창/탭에 해당 모델의 가격 정보 페이지를 여세요. 원래 검색 조건과 목록은 유지하세요.
5. 가격 정보 페이지에서는 상단 홍보 문구를 제거하고 '가격 분석 · 모델명'과 '현재 매물 보기'를 한 줄로 배치하세요. 그래프와 출처별 가격 비교 표를 본문 폭으로 배치하세요.
6. '이 가격의 비교 기준', '매물 조건도 확인하세요' 카드 및 별도 안내 버튼을 제거하세요. 필요한 출처·통화·기간·표본·비교 단위는 표의 열 또는 짧은 caption으로 표시하세요. 같은 정보를 반복하지 마세요. 판매완료 표시가는 실제 체결가와 구별되는 기존 명칭을 유지하세요.
7. 컴퓨터 맞추기 상단은 '컴퓨터 맞추기'와 기존 부품 찾기·저장·인쇄 행동 한 줄로 정리하세요. 영문 슬로건과 홍보 문장 및 설명을 제거하세요. 부품은 선으로 구분되는 통합 표로 정돈하고 합계는 표 하단에 통합하세요. 판매중/판매완료 합계는 별도로 유지하세요.
8. 기능성 행·구분선을 우선하고 설명 카드, 반복 안내, 장식 pill을 추가하지 마세요. 모델 선택 dialog, 저장/수량/제거/인쇄 및 키보드 접근성을 유지하세요.
9. 실제 가격·표본·기간·출처·통화는 기존 API와 계산 결과만 사용하세요. publication/window/currency 검증, 누락 가격, 부분합, 저장 실패 처리를 보존하세요. 미확인 값을 0으로 만들지 마세요.
10. 390px에서는 동일 정보와 흐름이 읽히도록 행을 재배치하세요. 기능 변경을 이미지에서 추론하지 마세요. 실제 구현 후 검색 여러 모델/한 모델/매물 0개/1개, 그래프 새 창, 가격 표, 구성 저장 및 모바일을 확인하세요.

## 이미지

- [01 검색: 한 모델로 좁혀진 상태에서도 매물 목록 유지](./01-search.png)
- [02 가격 정보: 그래프와 출처 비교 표](./02-price.png)
- [03 컴퓨터 맞추기: 통합 표와 하단 합계](./03-builder.png)

## 생성 이미지의 구현 제외 사항

이미지는 배치 참고입니다. 아래 생성 오차는 구현하지 마세요.

- 03의 'ONE 이용 안내'는 생성 오류입니다. 실제 문구는 '이용 안내' 한 번입니다. 공통 헤더는 기존 흰색 스타일로 통일하세요.
- 01의 지역/상태 등 필터는 예시입니다. 현재 제공 중인 필터만 유지하며 새 필터를 만들지 마세요. 국내 전체에 eBay 매물을 섞거나 USD를 자동 원화 환산하지 마세요.
- 이미지의 숫자·가격·날짜·제품 사진·표본·합계는 모두 예시입니다. 복사하거나 실제 검증값으로 취급하지 마세요.
- 02의 비교 단위가 caption에서 중복된 부분은 한 번만 표시하세요. 그래프 기준은 현재 API 통계 정의를 유지하세요. 임의 다중 출처 선택 기능을 추가하지 마세요.
- 03의 호환성 확인 링크는 새 검증 기능 추가를 뜻하지 않습니다. 기존 호환성 정보를 적절한 위치에 유지하세요. 제거 행동도 누락하지 마세요.

## 이미지 생성 프롬프트 원문

Built-in image_gen으로 생성했습니다.

### 01 검색

Create one high fidelity Korean USED PICK desktop website mockup, landscape 1440x900. Page: search results. White and pale gray, navy text, terracotta accent, fine dividers, minimal rounding, no shadows. Header contains ONLY USED PICK logo, 중고 시세, 컴퓨터 맞추기, 가격 분석, and ONE 이용 안내 at far right. NO login/signup. No hero, slogan or intro paragraph. Category tabs CPU / 그래픽카드 / RAM / 메인보드 / SSD / HDD / 파워서플라이 immediately under header, close spacing. One compact unified controls area: model selector, sites 국내 전체 / eBay (USD) / 중고나라 / 번개장터, and model-brand search field. Below: left filter sidebar and wide right search result list, like conventional shopping search. Show selected model Intel Core i7-10700, but retain ordinary listing search layout with THREE listings for that same model, thumbnails, seller titles, source, price aligned right. At results toolbar show exactly ONE button 가격 그래프 보기 ↗, which opens separate price information window. No inline graph, price summary, price-flow panel, large model heading or automatic detail view. Keep sort latest/low/high and min/max price controls. Results are horizontal rows separated by rules, NOT individual cards. No filler explanations. Korean legible. Mock prices illustrative.

### 02 가격 정보

High fidelity Korean USED PICK desktop web UI concept, 1440x900 landscape. Separate price-information page opened from search's 가격 그래프 보기 button. White, navy typography, terracotta and teal data lines, thin gray dividers, flat professional table UI. Header ONLY USED PICK / 중고 시세 / 컴퓨터 맞추기 / 가격 분석 and ONE 이용 안내 right. Immediately below a compact single line: 가격 분석 · Intel Core i7-10700 left, 현재 매물 보기 right. No marketing headline, English slogan, intro or explanatory sidebar. Compact model selector and site/period controls. Main content FULL WIDTH: a price trend chart (orange 판매중, teal 판매완료 표시가) above a SINGLE source-comparison TABLE. Table columns 출처 / 통화 / 기간 / 판매중 가격 / 표본 / 판매완료 표시가 / 표본. Two rows 번개장터 and 중고나라, both KRW, date range 2026.08.20–09.18. Example numbers in chart and table consistent, illustrative. Table caption has compact model identity and 비교 단위: 등록 모델. Missing values shown —, never fabricated zero. The labels keep sold displayed price distinct from actual transaction price, small column-header info icon allowed. NO 이 가격의 비교 기준 card, NO 매물 조건도 확인하세요 card, NO 가격 데이터 이용 안내 button, NO sidebar. No large summary cards, explanations, duplicate scope ribbons or promotional copy. Chart and table aligned to same grid, generous functional chart space, compact rows. No new account controls.

### 03 컴퓨터 맞추기

Create a high fidelity Korean USED PICK desktop web page mockup, landscape 1440x900. Page computer builder. Match professional existing navy/white/terracotta identity, fine gray rules, flat minimal UI. Header ONLY USED PICK, 중고 시세, 컴퓨터 맞추기 active, 가격 분석, ONE 이용 안내 at right. Immediately below one compact title/action line: 컴퓨터 맞추기 left, 부품 찾아보기 / 구성 저장 / 인쇄 right. NO English slogan, NO 내 PC 구성 시세로 확인하세요, NO intro paragraph, NO hero. Main content ONE unified full-width TABLE with horizontal rows CPU, 그래픽카드, RAM, 메인보드, SSD, HDD, 파워서플라이, 케이스, 쿨러. Columns 부품 / 선택 모델 / 수량 / 판매중 가격 / 판매완료 표시가 / 변경. A few example selected models, others + 부품 선택. Separate sale and sold displayed prices, missing prices — never zero. Quantity compact controls. Integrated bottom total row shows 판매중 합계 and 판매완료 합계; no separate right summary card, no duplicate total widget, no advisory card. Simple thin divider and a small 호환성 확인 link if necessary. Uniform row rhythm, 60px-ish row heights, aligned numerals, restrained line icons, whitespace functional not huge. No login/signup, no decorative cards, no promotional copy. Mock values illustrative. Keep all Korean concise and legible.

