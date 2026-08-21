# USED MARKET applications

이 디렉터리는 완전히 분리된 두 애플리케이션만 소유합니다.

- `apps/domestic`: 국내 중고 검색, 한국어 UI, 자체 하네스·문서·배포
- `apps/global`: 일본/미국 중고 검색, 영어 UI, 자체 하네스·문서·배포

다른 PC 준비는 저장소 루트의 `scripts/setup.ps1` 또는 `scripts/setup.sh`를 사용하세요. 수동 설치는 각 앱에서 `npm ci`를 별도로 실행합니다.

상세 설정은 [SETUP.md](SETUP.md)를 확인하세요. 두 앱 사이의 코드·하네스·환경파일·결과 저장소 공유는 금지됩니다.
