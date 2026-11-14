# USED PICK 부품 누락 조사 · 2026-11-13 10:42 KST
## 실행 및 접근
- 실제 cloud cdp 브라우저 별도 탭에서 https://api64.ipify.org/?format=text 확인: 2a13:9500:1e4:45f::3c0:1b, 요청 2a13:9500:1e4:45f::/64 포함. IP 고정/선택 기능은 제공되지 않음.
- 일반 https://used-pick.com/ → https://used-pick.com/?category_code=CPU. 제목: 중고 PC·컴퓨터 부품 검색 | 중고 시세 비교 | USED PICK. 정상 검색 UI/실제 렌더링 화면 확인. 보안 확인 화면 없음. dotpass·UA/IP 변경·우회 없음.
- navigator.userAgent, screen/viewport 값은 별도 안전 제공 수단으로 읽지 않았으므로 미확인.
- 최신 Library prepare_materialize v68 확인. index/site 원장/validation-contract 및 11/10·11/11 parts 기록·운영규칙 읽음. 이후 수동 회차는 부모 전달 요약만 참고, 오늘 실행으로 복사하지 않음.

## 이번 실제 범위
9개 카테고리 모두 공개 UI 분류와 실제 화면을 직접 열었다. 옵션 표시 수: CPU189/GPU94/RAM216/메인보드46/SSD161/HDD70/파워133/케이스39/쿨러33. 합계981은 홈 모델·용량그룹 드롭다운 표시 수 합계일 뿐 전체 안정 ID 검증완료 분모가 아니다.
9개 조사단위 모두 부분실행, 전체완료0. 전 모델/모든 조합/신제품 출시·중고 수요 전수조사는 미완료.
- CPU: 제조사/제품군/세대/소켓/접미형 분류, 189 옵션 및 실제 목록.
- GPU: NVIDIA/AMD/Intel, 제품군/세대/VRAM, 94 옵션 및 실제 목록.
- RAM: 일반/노트북/서버/확인필요, DDR3/4/5, 개당용량·속도·제조사,216 그룹 및 실제 목록.
- 메인보드: 소켓10개 전체 펼치기, 칩셋/보드크기/메모리/제조사. LGA1851/LGA1150/LGA1155/AM3+/FM2+ 모두 제공. 새 누락으로 보고하지 않음.
- SSD: 2.5 SATA/외장/M.2 NVMe/M.2 SATA/기타, 용량·23제조사. Solidigm7그룹·15매물,512GB1매물까지 선택.
- HDD: 내장/외장/불명확·2.5/3.5인치·용량·제조사. SATA/SAS 분리 필터 없음은 기존 관찰 유지.
- PSU: 출력7구간·ATX/SFX/SFX-L·19제조사. CPU/GPU 커넥터 필터 없음은 기존 관찰 유지.
- 케이스: 미니/미들/빅타워·제조사. 쿨러: 공랭/AIO/케이스팬·제조사. 새 범주 추가 필요성 확정하지 않음.

## 새 정확 모델 후보: GIGABYTE Z890 AORUS ELITE WIFI7 (우선순위 중간)
재현: https://used-pick.com/?category_code=MOTHERBOARD&socket=LGA1851
소켓은 이미 지원되나 모델 선택은 '검색된 모델 없음', 결과8건. 다음 정확 제목 두 카드가 '모델 미확인 · GIGABYTE · Z890'으로 표시됨. 재방문 로딩 완료 후 같은 상태 재확인.
- 기가바이트 Z890 AORUS ELITE WIFI7 메인보드:330,000원,11.13 06:47, 번개장터 목적지 식별자447782373.
- 기가바이트 Z890 AORUS ELITE WIFI7 메인보드 팝니다:260,000원,11.12 13:39, 중고나라 목적지 식별자233992701.
외부 거래 페이지는 방문하지 않았고 서로 독립 판매자/실제 거래성사 여부는 미확인.
공식: https://www.gigabyte.com/Motherboard/Z890-AORUS-ELITE-WIFI7
공식 설명 및 설명서: LGA1851/Core Ultra(Series2)/Z890/DDR5/ATX30.5×24.4cm. ICE 등 변형과 구분하고 CPU 지원표/BIOS 확인 필요.
판단: 소켓 추가가 아니라 정확 모델 선택지와 매물 연결 추가 후보. 검색 가능 매물 자체가 없는 것은 아님. 내부 원인을 확인한 오류로 단정하지 않음.

## 기존 제안 보강·미검증
- PSU MSI MAG A850GN PCIE5 850W 매물50,000원(11.13 02:04)이 MSI751~850W 그룹으로 표시. 공식 사양은 EPS4+4핀2/PCIe6+2핀2/PCIe5.1 16핀1/850W/140×150×86mm/비모듈러.
  https://www.msi.com/Power-Supply/MAG-A850GN-PCIE5/Specification
  기존 커넥터 정보 필요성의 실제 표본 보강일 뿐 같은 개선을 새 오류로 중복 알리지 않음. 중고 구성품은 신품 사양만으로 보장하지 않음.
- Solidigm P44 Pro 2TB 및1TB 현재 표본은 Solidigm으로 표시. 512GB 선택은 'SSD인 솔리다임 P44 Pro 512GB'130,000원/중고나라230215800 한 건.
  https://used-pick.com/?category_code=SSD&manufacturer=Solidigm&model_id=ssd%3Asolidigm%3Acapacity-bucket%3A257-512-gb
  이전 문제 원매물 번개장터446307199는 이 표본에서 확보하지 못함. 기존 SK hynix 연결 문제가 해결됐다고 판단하지 않음.
- Fractal 크기 오분류 원사례, SF1000 원매물, 이전 B850 Steel Legend WiFi/B460M BAZOOKA 후보, HDD32TB 실제 수요는 이번 미재검증. 과거 상태 유지.
- HDD/SATA-SAS·SSD M.2길이/PCIe세대 관련 기존 제안은 반복 알리지 않음.

## 저장/제한 및 다음 시작
HOME read 실패: Tunnel-client has not been seen for 300 seconds. Ensure tunnel-client is running and connected.
HOME 프로젝트 저장과 재읽기 미완료. 클라우드 보고서·원시 AX·보존 가능한 PNG를 저장. Space 공동 파일은 병행 KSTOCK 변경을 덮어쓰지 않도록 이 회차 delta로 부모에게 전달하며 업로드 성공으로 보고하지 않는다.
다음: 기존 P44 Pro 원매물·Fractal 원사례 재확인 → Z890 정확모델 지원 후보 검토 → PSU커넥터/중고케이블 증거·HDD32TB 포함범위/수요 → 나머지 신제품/용량 경계 순환.
외부 거래 방문·로그인·설치·구매·분류/코드/설정/배포 변경 없음.


저장 갱신: HOME 연결 복구 후 2026-11-13 12:33 KST 문서 저장 및 실제 내용 재확인. 이전 미연결 표기는 실패 이력. Space 새버전 저장 미완료.
