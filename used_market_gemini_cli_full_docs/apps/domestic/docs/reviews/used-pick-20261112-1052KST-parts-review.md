# USED PICK 부품 누락 조사 · 2026-11-12 10:52 KST

## 실제 확인
- 실제 클라우드 Chrome의 별도 탭에서 https://api64.ipify.org/?format=text 를 열어 공개 IP 2a13:9500:1e4:45f::4d0:6f 확인. 요청 2a13:9500:1e4:45f::/64 포함. IP 선택·고정 기능은 제공된 도구에 없으며 고정했다고 주장하지 않는다.
- 이어 새 탭 https://used-pick.com/ 을 열었다. 최종 URL 동일, 문서 제목 Attention Required! | Cloudflare.
- 화면 문구: “Sorry, you have been blocked”, “You are unable to access used-pick.com”. Ray ID a591e5544c83c67f.
- 실제 스크린샷을 확인했다. 정상 중고 검색 UI는 나타나지 않았다. 차단 확인 즉시 기능 조작을 중단했고 새로고침·CAPTCHA·UA/IP/도메인 변경·다른 네트워크 우회는 하지 않았다.
- UA와 screen/window 크기는 이번 허용 도구에서 안전하게 읽은 값이 없어 확인 불가. HTTP 상태코드 403 자체는 읽지 않았으므로 단정하지 않는다.

## 독립 공식 자료 확인
Solidigm P44 Pro 공식 발표 원문과 공식 제품 사양을 읽었다.
- 발표 2022-10-18, 판매 예정은 해당 10월 말이다. 2026년 신제품으로 취급하지 않는다.
- Solidigm P44 Pro: 512GB/1TB/2TB, M.2 2280, PCIe 4.0 x4 NVMe.
- https://news.solidigm.com/en-WW/219296-solidigm-introduces-the-p44-pro-the-world-s-premier-enthusiast-solid-state-drive-ssd/
- https://www.solidigmtechnology.jp/products/client/pro-series/p44.html
검토 판단: 브랜드, 폼팩터, 인터페이스, 용량은 각각 구분해야 한다. 11/10 관측한 SK hynix 연결 후보를 오늘 다시 확인한 것은 아니며 현재 오분류 지속·복구나 새 누락을 확정하지 않는다. 국내 중고 수요 확인도 미실행이다.

## 실행 범위
기존 부품 조사 9단위 중 SSD 공식 자료 단계만 부분실행 1, 나머지 8 미실행, 전체 실행완료 0. 운영 UI 9단위 모두 미실행·개별 미판정이며 공통 접근 게이트는 환경차단이다. 전체 현재 카테고리·모델 분모는 미확정. CPU/GPU/RAM/메인보드/SSD/HDD/파워/케이스/쿨링의 현행 필터·모델·매물 대조를 통과 처리하지 않았다.
LGA1851/LGA1150/LGA1155/AM3+/FM2+의 11/10 존재 관측은 이력일 뿐 오늘 결과가 아니다.
기존 P44 Pro·Fractal·보드 모델 후보 모두 재검증 불가. 신규 추가/수정/삭제 확정 0.
오늘 UI 패치내역 확인·특별 UI 테스트도 차단으로 미실행. 정상이나 변경 없음으로 판정하지 않는다.

## 다음 시작점
지정 대역 접근 게이트 → 현재 카테고리/필터 목록 → P44 Pro·Fractal 기존 원사례 → 정확 보드 모델/SF1000 원매물 → HDD 32TB 범위·중고 수요 → 나머지 카테고리.
최신 기준묶음 v68 및 운영규칙·validation-contract를 읽었다. 이전 이력을 오늘 완료로 복사하지 않는다.
프로젝트 코드·설정·데이터·분류·배포 변경 없음.

