# USED PICK 부품·규격 누락 조사

검사일: 2026-11-10. 이번 재개 공개 UI 확인 14:20–14:27 KST. 같은 날 사용자 시나리오 검사 12:43–13:12 KST의 명시된 증거만 재사용했다. 수치와 목록은 관측 시점 값이다.

## 요약
- 직접 확인: CPU 목록과 신제품 선택지, 메인보드 소켓·칩셋·크기·메모리·46개 모델, SSD 유형·용량·23개 제조사·161개 그룹, HDD 설치 방식·크기·용량·70개 그룹, PSU 정격 출력·폼팩터·133개 그룹.
- 같은 날 검사 증거 재사용: GPU 94개 선택지 및 RTX3060/RX580, RAM SK hynix DDR3 64GB, 케이스 39개 그룹/Fractal 표본, 쿨러 33개 그룹/Noctua 표본. 이 조사에서 전 모델의 상세 검색을 다시 실행한 것은 아니다.
- 9개 카테고리는 현재 제공된다. 카테고리 존재와 일부 필터/표본 대조는 전체 모델 검증 또는 전체 분모 확정이 아니다. 전체 안정 ID 목록 및 모든 규격 조합 대조는 미완료다.
- 신규 권고: SSD 기존 제조사 연결 1건, 케이스 크기 분류 근거 보강 1묶음, 메인보드 정확 모델 추가 후보 2개. 사이트 코드·분류 데이터는 변경하지 않았다.

## 1. 우선순위 높음: Solidigm P44 Pro의 제조사 연결

공개 화면: https://used-pick.com/?category_code=SSD
- 제목 “솔라디임 P44 pro NVMe M.2 ssd 512gb(SK하이닉스 P41과 동급)”, 표시가격 145,000원, 번개장터, 화면 날짜 11.10 14:11.
- 카드의 연결 그룹은 “SK hynix SSD 257-512GB”다. 새로고침 후에도 같은 제목·연결을 확인했다.
- Solidigm 제조사 및 Solidigm 257–512GB 그룹은 이미 선택지에 있다. 신규 제조사 추가가 아니라 실제 제품명과 비교 대상 문구를 구별하는 연결 검토가 우선이다.
- 공식 Product Brief는 P44 Pro를 Solidigm 제품으로 명시하며 512GB/1TB/2TB, M.2 22×80mm, PCIe 4.0 x4/NVMe 1.4를 설명한다.
- 근거: https://www.solidigm.com/content/dam/solidigm/en/site/products/client/d6/p44/documents/P44-Pro-Product-Brief.pdf
- 내부 목록에서 관측한 외부 목적지 식별자: m.bunjang.co.kr/products/446307199. 외부 매물 페이지에는 들어가지 않았다.
- 판단: 제목·공식 제품 브랜드와 연결 그룹의 불일치 후보. 괄호 안 비교 문구가 원인인지 내부 계산은 미확인이다. 제품 자체를 삭제하거나 유효 매물을 제외하지 말고 식별 후보와 별칭 우선순위를 검토하는 것이 적절하다.
- 증거: 06-ssd.png, 07-ssd-brands.txt, 08-ssd-reload.png, 08-ssd-reload.txt.

## 2. 우선순위 높음: Fractal 케이스를 모두 미들타워로 묶는 분류

공개 화면: https://used-pick.com/?category_code=CASE&model_id=case%3Afacet%3Amid-tower%3Afractal-design
- 같은 날 12:43–13:12 검사에서 Define 7 XL 100,000원, Node 304 100,000원, Mood 190,000원이 MID_TOWER로 묶였다. 해당 검사는 새로고침 후 동일함을 확인했다. 이 조사에서 그 원본 화면과 텍스트를 읽고 공식 사양을 추가 대조했다.
- Define 7 XL: 공식 full tower, 604×240×566mm. 공식 분류와 현재 미들타워 표시에 명확한 차이가 있다.
  https://www.fractal-design.com/products/cases/define-series/define-7-xl/define-7-xl-black-light-tg/
- Mood: 공식 지원 문서가 small form factor case라고 명시한다.
  https://support.fractal-design.com/support/solutions/articles/4000207810-mood-aio-compatibility
- Node 304: 공식 Mini ITX/Mini DTX 보드 지원, 374×250×210mm, 19.5L다. 일반 미들타워와 같은 호환성으로 받아들이지 않도록 별도 크기 검토가 필요하다.
  https://www.fractal-design.com/products/cases/node-series/node-304/node-304-black/
- 판단: 새 카테고리를 무조건 늘리는 것보다 이미 있는 크기 필터와 실제 모델별 크기/지원 보드의 연결을 우선 확인한다. 제조사별 기본 그룹으로 모든 제품을 넣는 내부 구현 때문인지는 미확인이다.
- 거래 구성·상태·수집 시스템 정확성까지 확정하지 않았다. Define 7 XL의 화면 분류 대조와 Mood/Node304의 소형 규격 대조를 각각 구분한다.
- 재사용 증거: 2026-11-10 일일검사의 fractal_list_complete.png, fractal_list_complete_0.txt, zalman501_controls_fractal_recheck_0.txt. 기존 후보에 공식 근거를 보강한 것이며 같은 버그를 두 건으로 세지 않는다.

## 3. 우선순위 중간: 메인보드 정확 모델 후보 2개

공개 화면: https://used-pick.com/?category_code=MOTHERBOARD
현재 46개 모델 선택지에 아래 두 정확 모델이 없다. 국내 중고 목록 첫 페이지에서 각 1개 제목을 확인했고, 새로고침 후 재확인했다. 이 수는 전체 시장 수요 또는 독립 판매자 수가 아니다.

### ASRock B850 Steel Legend WiFi
- 제목 “ASRock(애즈락) B850 스틸레전드 WiFi 컴퓨터 메인보드 팝니다”, 250,000원, 번개장터, 11.10 13:29. “모델 미확인 · ASRock · B850” 표시.
- 공식: AM5/B850/DDR5, ATX 30.5×24.4cm. B850M Steel Legend WiFi와 구별해야 한다.
- 공식 근거: https://www.asrock.com/MB/AMD/B850%20Steel%20Legend%20WiFi/index.asp
- 내부에서 본 외부 목적지 식별자: m.bunjang.co.kr/products/352993565. 방문하지 않았다.

### MSI MAG B460M BAZOOKA
- 제목 “MSI 메인보드 B460M BAZOOKA 판매합니다”, 70,000원, 번개장터, 11.10 12:49. “모델 미확인 · MSI · B460” 표시.
- 공식: LGA1200/B460/mATX/DDR4. 공식 CPU 지원은 10세대 Intel Core 및 해당 Pentium Gold/Celeron 범위이며 LGA1200이라는 이유만으로 모든 세대 호환이라고 쓰면 안 된다.
- 공식 근거: https://www.msi.com/Motherboard/MAG-B460M-BAZOOKA/Specification
- 내부에서 본 외부 목적지 식별자: m.bunjang.co.kr/products/447380398. 방문하지 않았다.

판단: 대규모 모델 일괄 추가보다 정확 모델 항목과 실제 제목 별칭 연결의 우선순위 중간 후보다. 같은 칩셋/제조사의 다른 모델을 합치지 말고, 후속 표본과 리비전·BIOS·구성품 확인 후 확정한다. 증거: 03-motherboard.png/txt, 05-board-reload.png, 05-board-reload-loaded.txt.

## 유지된 상태와 기존 제안의 중복 방지
- LGA1851/LGA1150/LGA1155/AM3+/FM2+는 현재 메인보드 소켓 10개 전체 펼치기에서 모두 존재한다. 새 누락으로 보고하지 않는다. 필터 옆 수치는 모델/옵션 수와 실제 판매 매물 수를 구별한다.
- 메인보드 칩셋 필터는 63개 확장 제어, 크기는 ATX/M-ATX/Mini-ITX/E-ATX/확인 필요, 메모리는 DDR3/DDR4/DDR5/확인 필요를 제공한다. Mini-DTX는 일부 모델 설명에는 있으나 독립 크기 필터는 관측되지 않았다. 이 내용은 기존 제안이므로 새 알림 대상이 아니다.
- B660M DS3H DDR4는 현재 46개 선택지에 있다. 11/9에 이미 알린 추가 상태를 다시 새 해결이라고 알리지 않는다.
- SSD 유형 2.5형 SATA/외장/M.2 NVMe/M.2 SATA/불명확, 제조사×용량 그룹이 있다. 이번 필터 범위에는 M.2 길이와 PCIe 세대의 별도 선택지가 없다. 기존 제안 상태만 유지한다.
- HDD에는 내장/외장/불명확, 2.5/3.5인치, 용량·제조사가 있다. 이번 제공 필터 범위에는 SATA/SAS 인터페이스 구분이 없다. SAS 실제 수요 표본과 판별 근거가 부족해 자동 새 카테고리를 권고하지 않는다.
- PSU에는 정격 출력 7구간, ATX/SFX/SFX-L, 제조사 19개가 있다. CPU EPS/GPU PCIe 6+2·12VHPWR·12V-2x6 및 수량별 필터는 관측되지 않았다. 기존 제안을 반복 알리지 않는다. 중고 모듈러 케이블 포함 여부는 공식 신품 규격만으로 보장할 수 없다.
- Corsair SF1000 공식은 SFX·ATX3.1·12V-2x6 케이블을 설명한다. 예전 SF1000 필터 누락 원매물은 이번에 직접 재검증하지 않아 복구/지속을 확정하지 않았다. https://www.corsair.com/us/en/p/psu/cp-9020257-na/sf-series-sf1000-fully-modular-80-plus-platinum-sfx-power-supply-cp-9020257-na
- 누락 주요 카테고리 후보를 새로 확정하지 않았다. 케이스·쿨러는 이미 현재 제공되는 9개에 포함된다.

## 신제품 순환 확인
- CPU 189개 목록에서 Ryzen7 9850X3D, Ryzen9 9950X3D2는 존재한다. 공식 9850X3D 출시일 2026-01-29, 9950X3D2 출시 발표 2026-04-22를 구분했다. 이미 추가된 모델을 다시 누락이라고 하지 않는다.
  https://www.amd.com/en/products/processors/desktops/ryzen/9000-series/amd-ryzen-7-9850x3d.html
  https://newsroom.amd.com/news/amd-launches-ryzen-9-9950x3d2-dual-edition-processor/
- Core Ultra 270K Plus/250K Plus는 이번 CPU 목록에서 발견되지 않았다. 기존 보류 후보다. Intel 공식 검색 자료의 2026-03-26 출시 안내를 확인했으나 해당 본문 직접 열기는 403으로 실패했다. 국내 중고 수요 표본도 이번에 확보하지 않아 추가 우선순위를 새로 높이지 않았다.
  https://game.intel.com/stories/demand-more-the-new-intel-core-ultra-200s-plus-series-processors/
- 신규 발표와 실제 출시, 모바일/서버와 데스크톱 제품을 혼동하지 않았다. 이번에 모든 제조사 신제품 발표를 전수 조사한 것은 아니다.

## 제한·미실행·다음 시작점
- CPU/메인보드/SSD/HDD/PSU를 직접 확인했고 나머지 4개는 위에서 지정한 오늘 검사 증거만 재사용했다. 모든 모델·용량·페이지·호환성·시세 계산을 확인한 것은 아니다.
- HDD 접근 도중 브라우저 관측 시간초과가 있었다. 새로고침 1회 후 정상 화면을 읽었다. 탭이 두 번 사라져 새 탭을 열어 이어갔다. 이를 사이트 장애로 단정하지 않았다.
- 공식 Intel 페이지 직접 열기 403 외 나열한 공식 제품 규격은 읽었다. 외부 중고 거래 페이지 방문·연락, 로그인·구매·게시·분류/코드/설정/Git 변경 없음.
- 다음: Solidigm P44 Pro 실제 모델/제조사 필터 연결 및 비교문구 처리, Fractal 크기별 모델 매칭, 새 보드 두 후보의 후속 독립 표본. 기존 B850M FORCE V2·Seasonic 별칭·SF1000·B550M 원사례는 현재 재검증 전 상태로 유지한다.
- 원본 공개 UI 캡처/AX·해시와 구체 사례는 동일 회차 증거 폴더에 보존한다. 검토 문서는 HOME PC 지정 reviews 폴더에 독립 파일로 저장하고 재읽기로 확인한다. Space 공유 기준에는 별도 parts 회차로 추가하고 기존 일일 검사 기록을 덮어쓰지 않는다.

## 저장 위치

검토 문서: C:/DeVelop/USED_WEB/used_market_gemini_cli_full_docs/apps/domestic/docs/reviews/used-pick-20261110-1420KST-parts-review.md

증거: 같은 reviews 폴더의 used-pick-20261110-1420KST-parts-evidence/ 아래에 이 문서의 PNG/TXT 이름으로 보존한다. 같은 날 일일 검사에서 재사용한 Fractal 증거도 이 하위 폴더에 사본을 두며 원본은 그대로 유지한다. 저장 검증 결과는 evidence-storage-verification.json에 기록한다.

