# USED PICK Android TWA 출시 안내

작성일: 2026-11-12 (Asia/Seoul). 앱 생성·서명 AAB 업로드·필수 스토어 설정·내부 테스트 배포·**한국 프로덕션 심사 제출**을 완료했다. **정식 공개 출시와 구분한다.** 아래 빌드 절차와 초안에는 최초 준비 당시의 기록도 포함한다.

## Play 업데이트0.1.2 심사 제출 완료 (2026-11-14)

- 기존 프로덕션0.1.0(1)은 실제 콘솔에서 **Google Play에 제공됨**, 게시일11월14일 오후12:55·대상 국가1개로 확인했다. 최신0.1.2(3)은 새 프로덕션 릴리스2로 제출했다. 릴리스명은 `0.1.2 — 시세 화면·시작 동작 개선`, 기존 한국 대상/출시율100%를 유지했다. 별도 앱이나 중복 릴리스를 만들지 않았다.
- 같은0.1.2 무서명 AAB의 기존 빌드 해시와 현재 native 입력4개의 SHA256이 빌드 영수증과 같음을 확인했다. 보호된 기존 업로드 키로 별도 복사본을 서명하고 JAR 검증을 통과했으며 Play가 **3(0.1.2), min24, target36**으로 받아들였다. 서명 AAB SHA256 `9af2d6e0f24002d9517ef1ad2a20f5225ce9d91fa18ca649369f12e3a68ef582`. 지원 기기 증감은 모든 폼 팩터에서0이었다.
- 출시 노트·번들·기존 대상 범위를 확인해 저장한 뒤, 게시 개요의 변경1개만 Google 검토로 전송했다. 사전 자동 검사가 끝나고 **‘변경사항을 검토 중입니다’**가 표시된 것을 확인했다.0.1.2의 승인/스토어 공개 완료와 구분한다. 관리형 게시와 기존 보안 보호·계정/테스터·정책 신고는 바꾸지 않았다. [심사 상태](https://play.google.com/console/u/1/developers/5880950647940851885/app/4975596290357962377/publishing).
- [최종 직접 설치 APK0.1.2](https://github.com/tndud2505-ops/Used_Market_Research/releases/download/android-v0.1.2/used-pick-0.1.2-direct.apk)를 공개 URL에서 다시 받아923,190바이트·SHA256 `0c0f7a4cd8734e0af49795353c73f670fddb7b854580bc824e5004d404930e1e` 일치를 재확인했다. 최신 웹 source `44cb374`의 compact 화면과 운영 health도 확인했다. TWA가 현재 운영 웹을 표시하므로 웹 UI 변경을 이유로 native 버전/파일을 불필요하게 새로 만들지 않았다.
- 실행: Aside 실행 도구/CLI가 현재 세션에 없어 CUA의 기존 로그인 Chrome4로 같은 앱과 트랙을 이어 처리했다. 업로드 선택 창은 첫 semantic click에서 event timeout이 있었지만 전송되지 않았음을 확인한 후 실제 AX 업로드 버튼으로 chooser를 연결해 한 번만 파일을 올렸다. 화면 캡처는 Chrome CDP timeout으로 저장하지 못했으며, 실제 접근성 UI의 접수/검사 종료/검토 중 문구와 영수증을 확인했다. 증거는 ignored `mobile/artifacts/0.1.2/play-submission-receipt.json`에 보존한다.

## 현재 직접 설치판0.1.2 — 모바일 시세·시작 화면 정리 (2026-11-14)

- [직접 설치 APK0.1.2 받기](https://github.com/tndud2505-ops/Used_Market_Research/releases/download/android-v0.1.2/used-pick-0.1.2-direct.apk). 버전 `0.1.2(3)`, 패키지 `com.usedpick.app`,923,190바이트, SHA256 `0c0f7a4cd8734e0af49795353c73f670fddb7b854580bc824e5004d404930e1e`. 공개 GitHub 자산을 다시 내려받아 서명 빌드와 동일한 bytes/hash를 확인했다. 비초안·정식 Releases `android-v0.1.2`는 빌드 소스 main `5beffd9d35f89212230b789871949da9b653c40c`를 가리킨다.
- 기본 한 사이트/선택형 비교, 오른쪽 가격 축, 정확한 관측 기준·날짜 터치 읽기와 세로 페이지 스크롤, 중복 기간 없이 날짜 조회 한 줄을 적용했다. 즐겨찾기 버튼을 제거했고 시세는 매물 위에서 열려 Android 뒤로 가기/닫기로 원래 위치에 돌아온다. 운영469 `f8159046-36be-4708-9e51-fd83256d6111`100%를 확인했다. 수치 계산·분류·통계·가격 게시 데이터는 변경하지 않았다.
- Bubblewrap custom splash와 이미지5개를 생성 단계에서 제거했다. API31+ 시스템 준비 화면에는 투명 drawable/흰 배경을 적용한다. 런처 아이콘·원래 인증서/패키지/도메인은 그대로다. 초기 흰 준비 화면까지 없애는 보장은 하지 않는다. API24–30는 기본 흰 theme을 쓰며 이번 실제 실행 검증은 API36이다.
- 같은 보호 서명으로 새로 빌드해 API36 격리 AVD에서 기존 직접 설치판0.1.1 위 업데이트를 확인했다. 콜드 실행·주소창 없는 실제 운영 검색/새 시세·Android hardware Back 후 URL/목록/스크롤 유지, 최종 평균/중앙값 기준 표시를 확인했다. USED PICK FATAL/ANR·LicenseClient/Pairip 로그0. 초기 에뮬레이터 부팅의 System UI ANR는 Wait로 회복한 별도 OS 사건으로 기록했다. 실물 휴대폰과 Play 설치/제출 검증을 대신하지 않는다.
- 전체 `scripts/verify.ps1` 통과 및 변경한 기존 UI28/미리보기10/차트 검사를 확인했다. 빌드·서명·기기·GitHub 다운로드 영수증은 ignored `mobile/artifacts/0.1.2`, 웹 배포/복구 증거는 `tmp/mobile-chart-20261114`와 [11월14일 이력](daily_history/2026-11-14.md)을 따른다. 이후 같은 native0.1.2 AAB를 Play에 업로드하고 심사 제출한 결과는 위 최신 상태를 따른다. 아래0.1.1은 이전 배포 이력이다.

## 이전 직접 설치판 0.1.1 — 최신 main 통합·운영 반영 완료 (2026-11-14)

- 전달 링크는 [used-pick-0.1.1-direct.apk](https://github.com/tndud2505-ops/Used_Market_Research/releases/download/android-v0.1.1/used-pick-0.1.1-direct.apk)다. 버전 `0.1.1(2)`, 패키지 `com.usedpick.app`, 1,074,966바이트, SHA-256 `852e514f8a0a76f8facc63ca280df84d0ffc4e7d6ea307b0d6b60e7a98f6c051`. 실제 공개 다운로드의 해시가 새 서명 원본과 일치했다.
- 원격 main의 기존 두 커밋과 작업 중인 앱 소스를 통합한 뒤, 누락된 당근 수집 의존 모듈까지 포함한 main `f95c55d381bb246011528d8e112472918f1d8aca`에서 **새로 컴파일**했다. GitHub 태그 `android-v0.1.1`도 이 빌드 커밋을 가리킨다. 이후의 출시 기록·화면 캡처 커밋은 Android 코드·버전·빌드 자산을 바꾸지 않는다. 0.1.0 파일을 이름만 바꾸거나 재서명해 새 버전이라고 하지 않았다.
- 기존 직접 설치판과 같은 보호된 서명 정체성을 사용해 API36에서 `adb install -r` 업데이트를 통과했다. Play 서명본은 서명이 달라 직접 설치판으로 덮어쓸 수 없으므로 그 경우 기존 앱을 삭제해야 한다. Play용 지문을 보존하면서 운영 관계 파일에 직접 설치 인증서를 추가했고, 실제 앱의 최신 검색 화면·문의 이동/복귀·콜드 재실행에서 주소창이 없었다. 라이선스/치명적 예외 로그0을 확인했다.
- Google DAL API는 직접 설치 인증서에 대해 3600초 음성 캐시 결과를 반환했고, 기존 Play 인증서는 `linked:true`였다. 게시된 두 인증서·실제 Chrome TWA 화면과 이 API 관찰을 구분한다. 검사 우회 플래그·설치 주체 위장을 사용하지 않았으며, 실제 사용자 휴대폰·Play 스토어 설치를 검증했다고 주장하지 않는다.
- 운영 웹에는 독립 시세 창·출처별 컴퓨터 시세·최신 차트 배치와 PM9A3 M.2 오분류 교정·Z890 정확 모델 연결·페이지별 캐릭터를 반영했다. 최종 Worker463 `223f1e8c-b615-449e-92fe-435b65404ea1` 100%와 실제 공개 파일/PC·모바일 동작을 확인했다. 새 AAB의 Play 업로드·심사 제출은 이번 직접 설치 배포 범위에 포함하지 않았다.
- 빌드·서명·기기·GitHub 검증 영수증은 무시되는 `mobile/artifacts/0.1.1/`에 보존한다. 원래 0.1.0 빌드 영수증은 `mobile/artifacts/0.1.0/build-receipt-original.json`으로 보존했고, Android 도구 버전/의존성은 바꾸지 않았다. 자세한 운영·분류 수리 근거는 [11월14일 이력](daily_history/2026-11-14.md)을 따른다.

## 0.1.0 최초 직접 설치 대응 이력 (2026-11-14)

- 최초 대응 파일은 [used-pick-0.1.0-direct.apk](https://github.com/tndud2505-ops/Used_Market_Research/releases/download/android-v0.1.0/used-pick-0.1.0-direct.apk)였다. 현재 전달은 위0.1.1을 사용한다. 11월13일 전달한 `used-pick-0.1.0-play.apk`는 Play 설치 경로 검사로 직접 설치 시 라이선스 오류가 발생하므로 직접 설치용으로 사용하지 않는다. 릴리스 본문과 기존 자산 라벨도 정정했다.
- 검증된 기존 무서명 빌드의 418개 ZIP 항목을 그대로 유지하고 보호된 기존 업로드 키로 별도 서명했다. 원본·Play 추출 APK를 수정하거나 Play 보호 설정·설치 주체를 변경하지 않았다. 패키지 `com.usedpick.app`, 버전 `0.1.0(1)`, 1,074,966바이트, APK SHA-256 `d0eb7377035f116bb4f394e3151be354f48c0463aa56c906c2f60cda80f6a919`다.
- 직접 설치 인증서는 기존 업로드 인증서 `C1:33:1F:65:FA:A5:5A:A8:E3:6C:BD:B9:19:9D:A3:6C:11:8C:B1:9F:55:82:88:C8:11:12:37:37:95:29:FB:1D`이며 Play 앱 서명 인증서와 다르다. **기존 Play 서명 USED PICK을 삭제한 뒤 설치**해야 한다. 운영 Digital Asset Links에는 Play 인증서만 있으므로 직접 설치판은 주소창이 있는 Chrome Custom Tab으로 열린다. 이 작업에서 도메인 관계 파일이나 운영 웹을 배포하지 않았다.
- API36의 기존 격리 AVD에 직접 설치한 뒤 실제 매물 화면·82초 실행 유지·강제 종료 후 콜드 재실행을 확인했다. 로그에 기존 LicenseClient/Pairip/라이선스 오류·치명적 예외가 없었으며, GitHub 공개 URL에서 다시 내려받은 해시가 서명 원본과 일치했다. 실제 사용자 휴대폰 검증이나 Play 스토어 설치 검증을 뜻하지 않는다. 증거는 무시되는 `mobile/artifacts/0.1.0/direct-qa-20261114/receipt.json`에 있다.

## 실제 제출 상태 (2026-11-12)

- Google Play 앱 ID `4975596290357962377`, 패키지 `com.usedpick.app`, 한국어·무료. 사용자가 정책 준수/미국 수출법 선언과 IARC 약관을 각각 승인한 뒤 실행했다.
- 내부 테스트 트랙 `4701331891611961285`에 **0.1.0(1)** 배포 완료: 콘솔의 ‘내부 테스터에게 제공됨’, 게시 시각 **14:06 KST** 확인. 테스터는 소유자 본인 한 명이며 다른 앱/테스터 목록은 변경하지 않았다. [테스트 참여](https://play.google.com/apps/internaltest/4701331891611961285). 최초 심사 전에는 패키지 기반 임시 이름이 표시될 수 있다.
- 스토어 이름·설명·512px 아이콘·1024×500 그래픽·실제 운영 모바일 화면 두 장 저장. 쇼핑 카테고리, 지원 웹사이트/이메일, 개인정보처리방침, 앱 접근, 광고 있음, 정부/금융/건강 해당 없음 등 필수 설정 저장. 대상 연령 13~15/16~17/18+, IARC 한국 3세 이상/ESRB Everyone/PEGI 3 결과 저장.
- Data safety: 대략적 위치·앱 상호작용·인앱 검색 기록·기기/기타 식별자를 수집한다고 신고했다. HTTPS 암호화·비일시적/필수 수집, 분석 목적(검색 기록은 기능 제공도 포함), 개발자 대신 처리하는 서비스 제공자 예외에 따라 제3자 공유 없음으로 저장했다. 계정 생성 없음, 전용 삭제 신청 경로 없음으로 답했다. GA client ID를 식별자에서 누락하지 않았고 AdMob 수집을 있다고 신고하지 않았다. 공급자 설정이나 실제 수집이 바뀌면 신고도 갱신한다.
- Play가 재서명한 범용 APK를 콘솔에서 내려받아 `apksigner verify --print-certs` 통과. APK SHA-256 `ccf38939bb58aac967fa13c64771a6175bd48f351d006f568f94736748c1dce7`.
- **실제 Play 앱 서명 SHA-256:** `49:A3:8A:DF:9F:8E:13:23:39:6F:49:A1:1D:A7:B4:0D:19:DE:DE:E0:4B:E1:4F:D2:5A:B6:EE:8E:86:0D:64:C1`. 콘솔 값과 내려받은 APK 인증서가 일치한다. 업로드 키 지문과 다르다.
- 위 지문으로 Digital Asset Links를 실제 게시했다. 배포 `5fe07054-f4b3-4ed3-ab02-fcf19bb6dfeb`, 두 도메인의 `/.well-known/assetlinks.json`에서 HTTP 200·JSON·정확한 패키지/관계/지문 확인. 다른 작업이 이어서 게시한 `47492b12-ba62-427b-b6c9-59a7fa99ac4e`는 이 PWA/관계 파일을 보존한 별도 패치이며, 이 문서는 이전 버전을 재활성화하도록 지시하지 않는다.
- 한국 프로덕션 트랙 `4698995743312743188` release 1, `0.1.0 — 첫 출시`와 등록정보 등 변경11개를 최종 전송했다. 전송 후 Google 자동 검사도 완료되어 **‘변경사항을 검토 중입니다’** 표시를 확인했다. 관리형 게시 사용 중지 상태이므로 승인 후 게시되는 흐름이다. [실제 게시 개요](https://play.google.com/console/u/1/developers/5880950647940851885/app/4975596290357962377/publishing). 승인·공개는 아직 확인되지 않았다. 스토어 공개 확인 전에는 웹의 Play 다운로드 URL을 활성화하지 않는다.
- 기기 검증 범위: 격리된 새 API36 AVD에 실제 Play 서명 APK를 직접 설치했다. 사용자가 Chrome 약관 동의를 별도로 승인한 후 진단 전송을 끄고 계정 없이 진행했다. 주소 표시줄 없는 USED PICK 실제 화면, 가격 분석 이동, 외부 원문이 주소 표시줄 있는 Custom Tab으로 열림과 복귀, 한 번의 재실행을 스크린샷으로 확인했다. Google Digital Asset Links `assetlinks:check`도 정확한 도메인/패키지/Play 인증서 관계에 `linked: true`를 반환했다. `android-qa/google-dal-check.json`과 기기 증거를 구분해 보존한다.
- 이 기기 검증은 **Play 서명 APK의 직접 설치(sideload)**이며 Play 스토어를 통한 설치는 아니다. 기기 로그에 `LicenseClient: Local install check failed due to wrong installer`와 라이선스 서비스 처리 오류가 있다. 실제 TWA 화면 성공을 Play 설치 경로의 라이선스 검증 성공으로 확대하지 않는다. Google은 자동 보호 APK의 설치 경로 검사를 안내한다. 보호 설정을 끄거나 설치 주체를 위장하지 않았다. [Google 자동 보호 안내](https://support.google.com/googleplay/android-developer/answer/10183279?hl=en). 최종 기기 범위와 정리 영수증은 `mobile/artifacts/0.1.0/android-qa/evidence.json`을 따른다.
- 기기 한계: 가격 분석에서 뒤로가기는 Translate UI를 닫은 뒤 LicenseActivity가 나타나 정상 네이티브 복귀를 통과했다고 보지 않았다. 약 30초 뒤 앱 프로세스가 System.exit(0)로 끝나고 Chrome의 TWA 화면이 유지됐다. 치명적 USED PICK Java 크래시로 단정하지 않는다. 앱의 설치 프롬프트/유료 광고 UI는 관찰되지 않았고 자사 Train Gallery 홍보는 보였다. 기기 네트워크 수준 광고 요청과 오프라인 재시도는 미측정이다. 웹 브라우저의 오프라인/광고 분기 검증은 별도 통과 기록을 따른다.
- 테스트 종료: 소유한 emulator-5580/ADB5038을 정상 종료(exit 0)했고 launcher32032/QEMU38256/ADB23612와 해당 리슨 포트가 남지 않았음을 primary가 독립 확인했다. 기존 ADB5037·다른 AVD는 건드리지 않았으며 격리 AVD 데이터는 추후 Play 설치 검증을 위해 보존했다.

## 확정한 대상과 콘솔 관찰

### 한국어 스토어 소개 개선 (2026-11-12)

- 짧은 설명을 **‘중고 PC 부품 매물 검색부터 모델별 가격 분석, 컴퓨터 구성별 시세 비교까지.’**(44자)로 개선했다. 상세 설명은 ‘살 때도, 팔 때도’로 시작하는 842자이며 검색·가격 분석·구성 비교·회원가입 없이 이용을 나누어 설명한다. 실제 거래가와 판매완료 표시가, 외부 거래, 인터넷 연결과 자사 홍보 안내를 유지했다. 과장된 순위·수익·최저가 보장이나 존재하지 않는 기능을 넣지 않았다.
- 기존 브랜드의 주황·짙은 잉크색·연녹색을 사용해 1024×500 대표 배너와 1080×1920 휴대전화 소개 이미지 **4장**을 제작했다. 순서는 매물 검색 → 그래픽카드 필터 → RTX 3060 가격 흐름 → Ryzen 5 5600/RTX 3060 부분 구성이다. 예시 가격은 캡처 당시의 실제 화면이며 현재 가격이나 완제품 견적으로 보장하지 않는다.
- 원본은 소유한 API36 AVD에서 캡처한 실제 TWA 1080×2340 화면이다. 코드로 만든 HTML/CSS 레이아웃에 원본을 비율 유지해 배치했으며 앱의 데이터나 UI를 새로 그리지 않았다. 상태 표시줄을 제외하고 가격 차트의 날짜 축과 구성 합계가 보이게 조정했다. `mobile/artifacts/0.1.0/store-v2/raw/capture-receipt.json`에 원본과 동작 증거를 보존한다. 이는 여전히 직접 설치한 Play 서명 APK 검증이며 Play 스토어 설치 경로 검증으로 확대하지 않는다.
- 재사용 가능한 소스는 `mobile/store-listing/listing.ko.json`, `artwork.html`, `render.mjs`다. 출력은 무시되는 `mobile/artifacts/0.1.0/store-v2/`의 PNG·`preview.html`·`artwork-receipt.json`이다. 기존 Play 아이콘과 앱 이름·패키지·AAB는 유지했다. 전용 도구 패키지의 `package.json`을 `USED_PICK_ARTWORK_TOOLS`, 설치 Chromium 경로를 `USED_PICK_ARTWORK_CHROME`로 지정한 뒤 `node mobile/store-listing/render.mjs`로 다시 만든다. 앱 의존성/lockfile은 바꾸지 않는다.
- Google Play 기본 한국어 등록정보에 짧은/긴 설명과 대표 배너·스크린샷을 저장했다. 이미지 네 장의 순서와 입력 문구 일치를 확인했다. 새 소개 그래픽 **5개**에는 AI로 생성/수정한 애셋 표시를 적용했고 기존 아이콘은 선택하지 않았다. [Google AI 애셋 선언 안내](https://support.google.com/googleplay/android-developer/answer/17262077?hl=ko)를 읽고 실제 제작 방식에 맞춰 공개했다.
- 소개 변경4개를 한 번에 전송했다. 콘솔의 기존 심사 재시작 안내를 확인하고 요청한 소개 수정을 반영하기 위해 재전송했다. 기존 AAB/프로덕션 버전을 새로 만들거나 중복 앱을 생성하지 않았다. **최종 자동 검사 완료 후 ‘변경사항을 검토 중입니다’**를 확인했고, 서버에서 다시 연 한국어 문구와 이미지4장/순서도 일치했다. **공개 완료와 구분**한다. 기록은 일일 이력과 출력 폴더의 `submission-receipt.json`을 따른다.
- 2026-11-12 후속: 시그니처 캐릭터 ‘픽이’가 들어간 소개 이미지(2026-11-13 초기 마스코트를 다듬은 `00-character-original.png`로 교체)를 휴대전화 스크린샷 첫 번째로 추가해 5장이 됐다. 실제 검색 화면 캡처를 그대로 쓰고 캐릭터는 AI 생성 애셋으로 라벨링했다. 저장 상태와 검토 전송 여부는 일일 이력을 따른다.
- 렌더 검증: 다섯 이미지의 크기·PNG RGB3채널·용량, 문자 수 제한, 실제 이미지 decode와 개별 화면 JavaScript 오류 없음 확인. 데스크톱1440px/모바일390px 소개 미리보기를 확인했고 모바일 가로 넘침은 없었다. 차트 축·구성 합계의 잘림을 수정했다. 밀도 스캐너의 문서 title 안 `PICK` 단어 중복은 정상 브랜드 표기로 판단했고 불필요한 하단 브랜드 반복은 제거했다. 테스트 AVD/ADB5038 정상 종료, 소유 PID8988/37060/38236 및 리슨 포트 부재를 통합 담당이 독립 확인했다.

| 항목 | 값 / 상태 |
| --- | --- |
| 서비스 원본 | `https://used-pick.com` 한 origin |
| Android 방식 | Bubblewrap 기반 Trusted Web Activity, 브라우저가 웹 콘텐츠 실행 |
| 패키지 | `com.usedpick.app` — 앱 생성·첫 AAB 업로드 완료 |
| 앱 이름 | `USED PICK — 중고 PC 부품 시세` |
| 런처 이름 / 한국어 표기 | `USED PICK` / 유즈드픽 |
| 최초 실행 주소 | **`https://used-pick.com/?source=app`** — 쿼리까지 유지 |
| manifest / scope | `/manifest.webmanifest` / `/` |
| 아이콘 | `/icons/app-192.png`, `/icons/app-512.png`, `/icons/maskable-512.png`, `/icons/play-store-512.png`; 기존 `/assets/mark.svg` 기반, primary 소유 |
| 색상 | 배경 `#f5f6f8`, 상태·테마·내비게이션 `#ffffff` |
| Android SDK | compile/target **36**, min **24** (Android 7.0 이상) |
| 기능 범위 | Custom Tabs fallback; 알림·위치·Billing·AdMob 네이티브 SDK 추가 없음 |

2026-11-12 실제 콘솔에서 개발자 **세계최강개발자**의 **조직(ORGANIZATION) 계정**과 앱·패키지를 대조했다. 기존 앱 우리여정·Train Gallery는 이번 작업으로 변경하지 않았다. 계정 ID와 로그인 정보는 공개 스토어 문구에 넣지 않는다.

이 계정의 필수 절차로 ‘12명 / 14일’을 요구하지 않는다. 해당 조건은 2023-11-13 이후 생성된 **신규 개인 계정**에 관한 규칙이다. 조직 계정에서도 실제 콘솔이 요구하는 테스트와 심사를 따른다. [Google Play 개인 계정 테스트 요건](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en)

웹 PWA 최초 배포/공개 기록 버전은 `4712d620-5722-4177-82ee-9b942dcf4e92`이며 실제 production 설치 가능성 오류가 없었다. 무서명 AAB의 별도 복사본 **`mobile/artifacts/0.1.0/used-pick-0.1.0-upload.aab`**를 보호된 업로드 키로 서명하고 `jarsigner` 검증 후 Play에 올렸다. 이후 실제 배포 인증서와 관계 파일도 검증했으며, 최신 상태는 위 제출 기록을 따른다.

## 재현 가능한 기본 빌드: 키를 만들지 않는 경로

`apps/domestic/mobile`은 웹 애플리케이션과 별도의 npm 패키지다. 부모 `package.json`이나 lockfile을 수정하지 않는다. 직접 의존성 `@bubblewrap/cli`와 `@bubblewrap/core`는 **1.27.0**으로 고정했고 전이 의존성·npm integrity는 `mobile/package-lock.json`에 고정했다. npm registry의 버전·integrity와 설치 결과를 대조했다. 생성 템플릿의 Gradle **8.11.1**, Android Gradle Plugin **8.9.1**, Android Browser Helper **2.7.4**도 명시 버전이다. Gradle 배포 ZIP의 공식 SHA-256을 wrapper에 넣는다. 바이트 단위 동일 APK까지 보장하는 빌드라는 주장은 하지 않는다.

필요 도구: Node.js 22+, npm 10+, JDK 21, Android SDK Platform 36와 Build Tools 35.0.0. Gradle/메이븐 다운로드용 인터넷은 필요하다. SDK 설치와 라이선스 수락은 자동화하지 않는다. `JAVA_HOME`과 `ANDROID_HOME`은 기존 설치 경로를 가리켜야 한다. Gradle SDK 자동 다운로드를 껐으며 Gradle 사용자 캐시는 `mobile/.cache/gradle`로 한정한다. 기존 사용자 Gradle 프로필·서명키를 읽는 설정을 추가하지 않는다.

```powershell
Set-Location 'C:/DeVelop/USED_WEB/used_market_gemini_cli_full_docs/apps/domestic/mobile'
npm ci --ignore-scripts --no-audit --no-fund --cache .cache/npm
npm test
npm run android:init
npm run android:check
npm run android:build
```

`android:init`은 고정된 Bubblewrap core의 `TwaGenerator`로 프로젝트를 생성한다. 대화형 `bubblewrap init`의 서명키 생성 단계를 호출하지 않는다. 체크아웃의 public manifest·아이콘만 읽어서 이미지 생성기에 공급하며 Android 메타데이터에는 실제 production URL을 유지한다. 초기화는 이미 생성된 프로젝트를 덮어쓰지 않는다. PWA 파일이 없으면 명시적으로 중단한다. `source-assets.sha256.json`과 이후 빌드 검사로 생성 시 사용한 자산을 구분한다. 이 검사는 프로덕션 배포 완료를 증명하지 않는다.

변경 후에는 아래를 실행한다. 버전은 추적되는 `mobile/twa-manifest.json`에서 관리한다. Play에 다시 업로드할 때 `appVersionCode`는 해당 앱의 기존 최대값보다 높아야 한다. 단순 재생성은 버전을 올리지 않는다.

```powershell
npm run android:update
npm run android:check
npm run android:build
```

`android:update`도 core 생성기를 사용하며 삭제 명령 없이 알려진 생성 파일을 다시 쓴다. `android/`는 생성 전용이므로 수작업 수정은 유지 대상으로 삼지 않는다. `jcenter()`를 `mavenCentral()`로 바꾸고 Gradle ZIP checksum·SDK 자동 다운로드 금지 설정을 재적용한다. 패키지를 바꾸려면 이 설정뿐 아니라 primary 소유의 `app-settings.mjs`에 있는 Android referrer·Play URL 검증 대상도 함께 맞춰야 한다.

빌드 산출물은 모두 무서명이다.

| 경로 (`mobile/` 기준) | 용도 |
| --- | --- |
| `android/app/build/outputs/apk/release/app-release-unsigned.apk` | 실제 컴파일된 APK; 서명 전 설치 불가 |
| `android/app/build/outputs/bundle/release/app-release.aab` | 실제 컴파일된 AAB; 업로드 키 서명 전 Play 제출 불가 |
| `android/build-receipt.json` | 빌드 시각·패키지·정확한 launch URL·버전·lockfile 및 산출물 SHA-256 |
| `android/source-assets.sha256.json` | 생성기에 입력한 public 자산 SHA-256 |

`android/`, `artifacts/`, `.cache/`, `node_modules/`, keystore/JKS/private key/APK/AAB는 `mobile/.gitignore`로 제외한다. 생성 결과·로컬 캐시·빌드 영수증·자격증명은 커밋하지 않는다. 추적 설정의 `signingKey`는 빈 값이고 `fingerprints`도 빈 배열이다. 장기 서명 정체성이나 프로덕션 지문은 이 패키지가 생성하지 않는다.

## Bubblewrap 원래 CLI 명령과 차이

기본 경로는 현재 Android Studio SDK 레이아웃에서 동작하는 core 생성 + Gradle 무서명 빌드다. `npm run twa -- ...`는 고정 설치한 원래 CLI를 실행한다. 전역 설치나 최신 버전을 받는 `npx` 호출은 필요 없다. [Bubblewrap CLI 공식 명령](https://github.com/GoogleChromeLabs/bubblewrap/blob/main/packages/cli/README.md)

원래 명령의 정확한 형태는 다음과 같다. **이 선택 경로는 이번 작업에서 실행하지 않았다.** 원래 `init`은 서명키에 대해 질문하고 없는 키를 생성할 수 있으므로, 보호된 저장소에 보존된 업로드 키를 준비한 operator만 실행한다. 기본 경로와 출력 폴더를 섞지 않는다.

```powershell
# mobile/에서 시작. 경로는 실제 설치를 입력한다. 비밀값을 설정 파일에 넣지 않는다.
$jdkPath = Read-Host '실제 JDK 루트 경로'
$standaloneSdkPath = Read-Host 'Bubblewrap이 지원하는 standalone Android SDK 루트 경로'
New-Item -ItemType Directory -Force .cache | Out-Null
$cliConfig = Join-Path (Get-Location) '.cache/bubblewrap-config.json'
$cliJson = @{ jdkPath = $jdkPath; androidSdkPath = $standaloneSdkPath } | ConvertTo-Json
[System.IO.File]::WriteAllText($cliConfig, $cliJson, (New-Object System.Text.UTF8Encoding $false))
$bubblewrap = Join-Path (Get-Location) 'node_modules/@bubblewrap/cli/bin/bubblewrap.js'
node $bubblewrap init --config=$cliConfig --manifest=https://used-pick.com/manifest.webmanifest --directory=.cache/cli-project
# 질문에서 확정 패키지와 /?source=app, 실제 보호된 기존 업로드 키를 선택한다.
Set-Location .cache/cli-project
node $bubblewrap update --config=$cliConfig --skipVersionUpgrade
node $bubblewrap build --config=$cliConfig --skipSigning
```

이 CLI 1.27.0의 `build`는 **Build Tools 36.1.0**을 별도로 요구한다. 현재 머신에는 35.0.0·36.0.0이 있고 36.1.0은 없다. CLI는 없으면 설치를 시도하므로 이번에는 호출하지 않았다. 또한 CLI SDK 경로 검사는 루트의 `tools/` 또는 `bin/`을 기대한다. `cmdline-tools/latest/bin`만 있는 Android Studio SDK 루트를 그대로 주면 통과하지 않는다. 임의 디렉터리를 만들어 검사를 속이지 않는다. 선택 경로를 쓰려면 해당 레이아웃과 도구를 operator가 준비한다. 원래 `update`는 생성 파일을 지우고 다시 쓰므로 손으로 고친 Android 프로젝트에서 실행하지 않는다.

`--skipSigning`을 빼면 CLI는 키 비밀번호를 묻거나 `BUBBLEWRAP_KEYSTORE_PASSWORD`·`BUBBLEWRAP_KEY_PASSWORD`를 사용하고 `app-release-signed.apk`, `app-release-bundle.aab`를 만든다. 비밀번호를 명령행 인수·Git·공유 로그에 적지 않는다. 기본 경로에서 만든 AAB는 아래처럼 primary가 나중에 별도로 서명할 수 있다.

```powershell
# mobile/에서, primary가 보호된 업로드 키를 준비한 후 직접 실행하는 별도 단계.
$uploadKey = Read-Host '보호된 업로드 keystore의 실제 경로'
$uploadAlias = Read-Host '실제 alias'
New-Item -ItemType Directory -Force artifacts | Out-Null
jarsigner -keystore $uploadKey -signedjar artifacts/used-pick-upload.aab android/app/build/outputs/bundle/release/app-release.aab $uploadAlias
jarsigner -verify -verbose -certs artifacts/used-pick-upload.aab
```

이 대화형 예제 대신 이번에는 DPAPI 보호 비밀번호를 프로세스 환경변수로 전달해 별도 복사본에 서명했다. 재서명 후에는 산출물 SHA-256을 새로 기록하고 Play Console이 업로드 인증서를 받아들이는지 확인한다. 임시 debug 키로 서명한 파일을 업로드 키·앱 서명 정체성으로 삼지 않는다. [Android 앱 서명과 Play App Signing](https://developer.android.com/studio/publish/app-signing)

현재 primary가 준비한 업로드 정체성은 저장소 밖 `C:/Users/tndud/.codex/private/used-pick/upload.p12`, alias `used-pick-upload`다. 비밀번호는 같은 보호 경로의 `upload-password.dpapi`에 DPAPI 암호화로 저장했고 현재 사용자와 SYSTEM만 ACL 접근을 허용했다고 primary가 보고했다. `upload-certificate.pem`은 공개 **업로드 인증서**다. 파일 내용을 저장소·문서·공유 로그에 복사하지 않는다. DPAPI 파일을 다른 머신에 복사하는 것만으로 비밀번호 복구를 보장할 수 없으므로 **기기 이전 전에** primary가 keystore와 비밀번호의 암호화된 별도 백업·복구 가능성을 확인해야 한다. 이 문서는 그 백업이 완료됐다고 기록하지 않는다. 이 업로드 인증서의 지문을 Play 앱 서명 지문으로 게시하지 않는다.

## Digital Asset Links: 실제 Play 앱 서명 인증서만

TWA는 웹 origin과 Android 앱의 소유 관계를 검증한다. 실패하면 주소 표시줄이 있는 Custom Tab으로 fallback한다. Play App Signing 사용 시 **Play의 앱 서명 키**와 개발자가 AAB에 쓰는 **업로드 키**를 구분한다. 서비스 도메인의 관계 파일에는 Play가 사용자 기기에 배포하는 APK를 서명한 인증서의 SHA-256이 필요하다. 업로드 키나 임시 debug 키의 지문으로 대신하지 않는다. [Chrome TWA 시작 안내](https://developer.chrome.com/docs/android/trusted-web-activity/quick-start), [TWA 서명키와 Digital Asset Links](https://developer.chrome.com/docs/android/trusted-web-activity/android-for-web-devs)

앱 생성·Play App Signing 설정 후 Play Console의 **App integrity / App signing**에서 **App signing key certificate**의 SHA-256을 확보한다. 회전된 키가 있으면 실제 배포 대상에 쓰이는 인증서들을 각각 확인한다. 다음 도구는 패키지와 32바이트 콜론 구분 SHA-256을 받아 **로컬 후보 파일만** 만든다. 형식만으로 인증서의 출처를 증명할 수는 없으므로 콘솔 원본과 대조한다.

```powershell
# mobile/에서. 이 입력은 공개 인증서 지문이며 키 비밀번호가 아니다.
$playPackage = Read-Host '콘솔에서 확정한 package name'
$playSha256 = Read-Host 'Play App signing key certificate의 실제 SHA-256'
npm run assetlinks -- --package $playPackage --play-sha256 $playSha256
```

결과는 `mobile/artifacts/assetlinks.json`. 기존 후보가 있으면 덮어쓰지 않는다. 콜론 없는 문자열, 짧은 값, placeholder, 단일 바이트 반복 dummy는 거부한다. 인증서 회전 시 `--play-sha256`을 반복해 전달한다. 실제 지문이 없는 동안 후보를 만들거나 public 경로에 예제 지문을 게시하지 않는다. 이번에는 콘솔에서 실제 지문을 확보한 뒤 후보를 생성하고 public에 게시했다.

primary가 확인된 후보를 **`https://used-pick.com/.well-known/assetlinks.json`**에 게시한다. 필수 관계는 `delegate_permission/common.handle_all_urls`, namespace는 `android_app`, package는 확정한 실제 값이다. HTTP 200·JSON Content-Type·인증 없는 접근·리디렉션 없는 응답과 정확한 인증서를 확인한다. HTTPS·manifest·아이콘·service worker 배포와 관계 파일 배포는 별개다. 로컬 설치 APK의 서명이 다르면 Play용 관계 파일로는 TWA 검증이 되지 않는 것이 정상이다. 내부 앱 공유(Internal App Sharing)도 별도 재서명될 수 있으므로 내부 테스트 트랙과 혼동하지 않는다.

## 웹·설치형 광고와 다운로드 UI

웹 자산의 구현·배포 검증은 primary 소유다. 현재 소스에서 `app-settings.mjs`는 일반 웹 유료 광고를 켜고 설치형 유료 웹 광고는 끈다. `adfit.js`는 설치형으로 판단되면 paid AdFit 슬롯과 SDK 요청을 시작하지 않으며 house promotion은 별도 분기로 유지한다. 표시 모드와 Android referrer는 **표시용 힌트**다. `source=app`은 최초 진입 출처이며 그 자체가 인증·권한·설치 검증은 아니다. 내부 페이지 이동과 외부 Custom Tab fallback까지 실제 Android에서 확인해야 한다.

**이 패키지에 네이티브 AdMob은 구현되어 있지 않다.** JS 설정이나 AdFit ID를 AdMob ID로 바꿔도 네이티브 광고가 생기지 않는다. AdMob에는 별도 Android Google Mobile Ads SDK 통합, Android manifest 앱 ID, 초기화·동의 처리, Activity와 광고 UI·수명주기 구현이 필요하다. 순수 TWA 콘텐츠는 외부 브라우저가 그리므로 네이티브 배너를 웹 안에 단순히 끼워 넣을 수 없다. Android 레이어를 추가하는 후속 설계·개인정보 검토·디바이스 검증이 필요하며 Bubblewrap 재생성으로 수정이 유실되지 않게 해야 한다. 가짜 앱 ID·광고 단위 ID를 추가하지 않았다. [공식 Android Mobile Ads 통합 안내](https://developers.google.com/admob/android/quick-start)

현재 Train Gallery 자사 앱 홍보 배너가 설치형에서도 유지되면 Play **‘광고 포함: 예’**가 초안이다. house ad도 해당한다. ‘AdFit 비활성화’나 ‘AdMob 없음’을 ‘광고 없음’으로 해석하지 않는다. 단순 메뉴의 ‘다른 앱’ 링크 예외와 화면 배너는 다르다. [Play 광고 포함 신고 안내](https://support.google.com/googleplay/android-developer/answer/9859455?hl=en)

웹 다운로드 UI는 `playStoreUrl: null` 동안 Play 링크를 숨긴다. 브라우저가 설치 프롬프트를 제공하면 PWA 설치 버튼을 쓸 수 있다. 앱이 실제 공개된 뒤 primary가 검증한 Play listing URL을 설정한다. 패키지 가용성, 비공개 테스트 링크, 초안 앱 양식만으로 공개 다운로드 가능하다고 표시하지 않는다.

## 스토어 한국어 문구 초안

아래는 공개 문구 초안이다. 계정 식별자·운영 인프라·키 관련 정보는 포함하지 않는다.

문자 수 한도는 이름 30자, 짧은 설명 80자, 상세 설명 4,000자다. [공식 스토어 등록정보 안내](https://support.google.com/googleplay/android-developer/answer/9859152?hl=en)

- 앱 이름 (30자 이내): **USED PICK — 중고 PC 부품 시세**
- 짧은 설명 (80자 이내): **중고 PC 부품 매물을 검색하고 가격 분석과 컴퓨터 시세를 비교해 보세요.**
- 기본 언어: `ko-KR`; 앱 / 무료; 카테고리 초안: 쇼핑.
- 웹사이트: `https://used-pick.com/`; 개인정보처리방침: `https://used-pick.com/privacy.html`.
- 지원 이메일 초안: 현재 공개 문의 페이지의 `tndud2503@gmail.com`. 실제 지원 수신 가능 여부와 조직 계정의 공개 연락처 요구를 제출자가 확인한다.

상세 설명 초안 (4,000자 이내):

> 유즈드픽(USED PICK)은 중고 PC 부품을 찾고 가격을 비교할 때 쓰는 검색·시세 서비스입니다.
>
> CPU, 그래픽카드, 메모리, 저장장치 등 원하는 부품의 매물을 찾아보세요. 여러 중고거래 사이트의 매물과 가격 정보를 살펴보고, 가격 분석과 컴퓨터 시세 화면에서 구매·판매 전 참고할 정보를 확인할 수 있습니다.
>
> • 부품 이름과 조건으로 중고 매물 검색
> • 상품별 가격 분석과 시세 비교
> • 컴퓨터 구성에 필요한 부품 가격 확인
> • 관심 매물의 원문 사이트로 이동
>
> 회원가입 없이 이용할 수 있으며 인터넷 연결이 필요합니다. 매물 가격과 판매 상태는 원문 사이트에서 최종 확인해 주세요. 표시되는 시세는 참고 정보이며 실제 거래 가격이나 판매 가능 여부를 보장하지 않습니다.
>
> USED PICK은 검색과 가격 정보를 제공하며 거래의 당사자가 아닙니다. 거래·결제·배송은 이동한 외부 사이트의 안내를 따라주세요. 앱에 자사 서비스 홍보가 표시될 수 있습니다.

제출용 그림은 실제 Android 앱 캡처를 사용한다. 512×512 스토어 PNG 아이콘(`play-store-512.png`), 1024×500 feature graphic(JPEG 또는 alpha 없는 24-bit PNG), 최소 2장의 실제 화면 캡처가 필요하다. 캡처는 각 변 320~3840px, 긴 변이 짧은 변의 2배 이내인 규격을 따른다. 최신 소개 개선에서는 실제 TWA 화면으로 구성한 1080×1920 이미지4장과 대표 배너를 Play에 올렸으며, 최초 단순 캡처2장과 구분해 `store-v2/`에 보존했다. [공식 스토어 시각 자산 규격](https://support.google.com/googleplay/android-developer/answer/9866151?hl=en)

## Data safety와 개인정보 초안: 소스 근거와 미확인 항목

TWA라는 이유로 ‘수집 없음’으로 신고하지 않는다. 서비스가 관리하는 웹 콘텐츠에서 발생하는 전송·분석을 포함해 검토한다. Google의 Data safety 안내는 자체 제어 웹 콘텐츠와 외부 웹 탐색을 구분한다. 최종 답변은 실제 출시 앱과 웹 배포, 공급자 계약·콘솔 설정에 맞춰 제출자가 확정한다. [Data safety 신고 범위](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en)

| 관찰된 코드·방침 (`apps/domestic/` 기준) | 초안에 반영할 내용 |
| --- | --- |
| `web-backend/public/privacy.html` (시행일 2026-10-14) | 회원가입 없음; 검색어·선택 조건 전송, IP/브라우저/접속 기록, GA4와 AdFit, 문의·삭제 요청 경로를 설명 |
| `cloudflare/html-analytics.mjs`, `cloudflare/worker.mjs`, `web-backend/public/analytics.js` | HTML에 GA4를 주입. Google signals·광고 개인화는 false이지만 분석 자체는 유지. 로컬 HTML에 태그가 없다는 것만으로 앱 분석이 없다고 할 수 없음 |
| 검색 UI·서버 호출 | 검색어/조건은 기기 밖으로 전송: 인앱 검색 기록 등 App activity 분류와 앱 기능 목적을 검토 |
| GA4 스크립트 | 페이지 이용·상호작용과 쿠키/클라이언트 식별자: App activity와 Device or other IDs, Analytics 목적을 검토. IP에서 대략적 위치를 추론하는지 공급자 설정 확인 |
| 개인정보처리방침의 접속 기록 | 서버·호스팅 측 IP/기기·브라우저/접속시각: 보안·부정 이용 방지 목적. 실제 보관 기간과 최종 데이터 유형은 운영 정책 확인 |
| `app.js`의 즐겨찾기, `pc-tools.js`의 저장 구성 | localStorage 저장. 해당 값이 동기화·분석으로 전송되지 않는 범위는 로컬 저장과 외부 수집을 구분 |
| `app-settings.mjs`, `adfit.js`, `promotions/train-gallery/motion.js` | 설치형 paid AdFit 비활성화 의도, house promotion 유지. 실제 Android 네트워크 확인 전 ‘광고 데이터 전송 없음’ 단정 금지 |
| 잔존 파일 `adsterra.js` | 파일은 있으나 현재 public HTML/JS의 import·실행 호출 검색에서는 로더 사용 근거 없음. 파일 존재만으로 활성 공급자라 신고하지 않되 출시 네트워크에서 재확인 |
| `contact.html`, `support.html` | 공개 이메일 문의와 은행송금 후원 안내 존재. 문의에 실제 보내는 개인정보·외부 앱 이동을 구분하고, 최종 앱의 후원 노출과 Play 결제 정책 적합성을 제출 전 확인 |

현재 소스만으로 확정할 수 없는 항목: GA4 실제 수집 필드·보존 기간·지역별 동의, 처리업체의 서비스 제공자 예외 및 ‘공유’ 해당 여부, 사용자별 선택 가능성, 모든 전송의 암호화 여부, 백엔드 접속 로그 보관·삭제 처리. ‘Google signals 꺼짐’은 ‘식별자 없음’을 뜻하지 않는다. privacy 페이지를 앱에서도 열 수 있게 두고 앱·웹 광고 차이와 실제 보관·삭제 절차를 최종 출시 상태에 맞춰 primary가 반영한다. 웹 변경으로 수집 방식이 바뀌면 AAB 변경이 없어도 신고·방침을 갱신한다.

로그인이 없는 현재 기능에 회원 탈퇴 플로우를 꾸며내지 않는다. 삭제 문의는 공개 문의 페이지를 사용하되 요청 처리 가능 범위를 확인한다. 앱 접근성 항목은 현재 기능에 별도 로그인 불필요로 초안 작성하고, 외부 거래 사이트의 로그인은 별도 서비스임을 설명한다. 콘텐츠 등급/IARC, 대상 연령, 광고 포함, Data safety, 개인정보 URL 및 관련 앱 콘텐츠 설문을 실제 기능 기준으로 작성한다. 현재 패키지는 위치·연락처·카메라·광고 ID 권한을 의도적으로 추가하지 않는다. 최종 merged manifest와 기기 동작은 제출자가 확인한다.

## 제출 순서와 사람이 확정할 항목

1. 조직 계정·앱·패키지·versionCode를 대조한다. 최초 앱 생성·정책/수출 동의는 사용자 승인 후 완료했으며 새로 반복하지 않는다.
2. 조직의 법적 이름·주소·결제 프로필 일치, D-U-N-S, 조직 웹사이트·전화·연락처의 검증 상태와 실제 콘솔 알림을 확인한다. 조직이 이미 앱을 운영한다는 사실이 모든 인증 완료를 증명하지는 않는다. 계정 소유자의 인증 자료·결제·구매를 이 빌드 도구가 다루지 않는다. [조직 계정 필수 정보](https://support.google.com/googleplay/android-developer/answer/13628312?hl=en)
3. primary의 manifest·아이콘·service worker·광고 분기 배포 영수증을 확인한다. Android 새 앱·업데이트 제출은 2026-08-31부터 **target API 36 이상**이다. 이 템플릿은 36을 사용하며 2026-11-12 기준 연장 마감일도 지났다. [현재 target API 요구](https://support.google.com/googleplay/android-developer/answer/11926878?hl=en)
4. 서명된 업로드 AAB와 인증서·패키지를 대조하고 키 백업·복구 가능성을 확인한다. 최초 Play App Signing·업로드·실제 **Play 앱 서명** 관계 파일 게시는 완료했다. 별도 암호화 백업은 완료했다고 주장하지 않는다.
5. 내부 테스트 트랙에서 설치한 Play 서명 앱으로 정확한 `/?source=app` 시작, 주소 표시줄 없는 검증된 TWA, 뒤로가기·외부 원문 이동·정책 페이지·오프라인 안내·paid AdFit 미요청·house 표시를 확인한다. 원래 브라우저/Custom Tab fallback에서도 기능을 확인한다. 컴파일 성공이나 웹 브라우저 테스트를 Android 검증으로 대신하지 않는다.
6. 실제 화면으로 스토어 자산을 준비하고 위 문구·광고 신고·Data safety·대상 연령·등급을 확정한다. 내부 테스트/사전 출시 보고서와 콘솔이 제시하는 문제를 확인한 뒤 심사·공개는 사용자가 승인한 범위에서 primary가 수행한다. Play listing이 공개된 실제 증거가 생긴 뒤 웹 다운로드 링크를 연결한다.

## 이번 작업의 검증 기록

- 환경 확인: Node **24.15.0**, npm **11.12.1**, Temurin JDK **21.0.12.1**, SDK Platform **android-36**, Build Tools **35.0.0 / 36.0.0**. SDK 설치나 라이선스 수락 없음.
- `npm install --ignore-scripts --no-fund --no-audit`로 전용 lockfile 생성 및 CLI/core **1.27.0** 설치 확인.
- `npm test`: assetlinks의 필수 실제 형식·패키지 입력, dummy 거부, 회전 인증서 중복 제거 **2개 통과**. 테스트용 합성 지문은 메모리에만 있고 파일·프로덕션에 게시하지 않음.
- `npm run android:init`: 실제 manifest/PNG 아이콘으로 Android 소스 생성, launch URL과 compile/target API 검사 통과.
- 첫 실제 Gradle 빌드 세션 **50103**: Android 컴파일 단계 진입 후 Browser Helper 2.7.4의 최소 API **24** 요구로 manifest merge 실패. 설정의 23을 24로 바로잡음. 해당 세션은 실패 종료를 확인했으며 병렬 중복 실행하지 않음.
- `npm run android:update` 후 수정 빌드 세션 **80673**: **BUILD SUCCESSFUL in 39s**, exit 0. 무서명 APK **1,030,863 bytes**, SHA-256 `d5c7ba1519b278d71a67fbf7b9250b04843205d4b2175ccfeb9494a6ef3d9e9b`; 무서명 AAB **1,109,175 bytes**, SHA-256 `257b831479679bbce1a238537dd88526780ea8bba7c3f361d952ce009b136bf2`. 영수증 `mobile/android/build-receipt.json`, 빌드 완료 시각 `2026-11-12T04:30:24.473Z` (13:30 KST). 실행 중인 빌드 없음.
- 실제 APK의 `aapt2 dump badging/resources`: package `com.usedpick.app`, versionCode `1`, versionName `0.1.0`, minSdk `24`, target/compile `36`, launch URL **`https://used-pick.com/?source=app`**, web manifest URL 확인. APK 권한은 라이브러리의 `com.usedpick.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`만 표시. AAB ZIP에는 서명 블록 파일(`META-INF/*.RSA/DSA/EC/SF`)과 `.so` native 라이브러리 없음. Gradle의 `signReleaseBundle` task 이름만으로 서명 완료라고 판단하지 않음.
- 위 빌드 후 `npm ci --ignore-scripts --no-audit --no-fund --cache .cache/npm`: lockfile로 **281개 설치, exit 0**. 재설치 뒤 `npm test` **2개 통과**, `npm run android:check` 및 두 스크립트의 `node --check` 통과. 재컴파일은 반복하지 않았으며 컴파일 성공과 기기 실행 증거를 구분함.
- `npm audit --omit=optional --audit-level=high --json`: 고정한 최신 Bubblewrap 의존성에 **high 3 / moderate 7** 보고. ZIP 추출 경로 관련 `extract-zip` 및 구형 `file-type`·`uuid` 전이 의존성 포함. 이 경로는 SDK ZIP 설치·Play API·외부 입력 이미지 로딩을 호출하지 않고 저장소의 자산만 생성기에 공급한다. 자동 `audit fix --force`로 호환성을 깨는 다운그레이드를 하지 않음. npm 패키지는 Android 런타임에 포함되지 않는다.
- Android 패키징 담당 보조 작업자는 키·브라우저 프로필·콘솔에 접근하지 않았다. 통합 담당이 이후 업로드 키 서명·Play 앱 생성/업로드·실제 Play 인증서 대조·관계 파일 게시를 수행했다. 이 구분은 위 최초 빌드 기록과 최신 제출 상태를 함께 읽기 위한 것이다.


제출 산출물: `mobile/artifacts/0.1.0/`에 업로드한 서명 AAB, `store-assets/`의 아이콘·1024×500 그래픽·실제 모바일 캡처 2개, `receipt.json`, `android-qa/`의 Play 서명 APK와 별도 기기 증거를 보존한다. AAB SHA-256: `00af525e69fd88db265bc0f3fd5defd58b7f7b2a9035459341a3d98f2cc164a2`. 산출물 존재만으로 기기 TWA 검증이나 스토어 공개를 증명하지 않는다.
