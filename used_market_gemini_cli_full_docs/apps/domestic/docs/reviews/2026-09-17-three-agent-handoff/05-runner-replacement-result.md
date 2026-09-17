# USED PICK — Runner 교체 시도 및 종료 상태

확인 시각: **2026-09-17 16:34:57 KST**.

## 최종 상태

**기존 Cloudflare Worker/UI 배포는 이번 작업에서 되돌리지 않았다. AWS Runner는 새 코드 설치와 파일 검증까지 수행했으나, 마지막 추가 공개 확인에서 HTTP 403이 발생해 이전 코드로 자동 복구했다. 따라서 최신 Runner 교체 완료는 아니다.**

| 항목 | 판정 |
|---|---|
| 이전 Worker/UI 배포 | 이전 15:37:39 KST 배포 유지; 이번에 Worker를 다시 배포하거나 롤백하지 않음 |
| SSH와 sudo | 이번 실행에서 정상. 과거 연결 차단은 기본 접속에서 재현되지 않음 |
| 설치 의존 파일 보완 | 완료: pc-price-readiness.mjs의 필수 검사·복사·문법검사 추가 |
| 전체 루트 검증 | PASS / exit 0 |
| 후보 소스 | 4931803ccc7e6579953e4edcb0660147e39cf02e; 원격 Git push 없음 |
| 정상 패키지·서버 스테이징 | 75개 설치 파일의 Git/압축/서버 해시 일치 |
| 전체 복구 사본 검사 | PASS / PRAGMA quick_check=ok |
| 정식 설치 | PASS; installer의 로컬·공개 health 검사도 PASS |
| 설치 후 파일 검사 | PASS / 75개 |
| 추가 Python 공개 health 확인 | FAIL / HTTP 403: Forbidden |
| 자동 복구 | 이전 코드·설정으로 복구, 기존 DB 덮어쓰기 없음 |
| 종료 후 서비스 | Runner 및 Tunnel 모두 active/running |
| 복구 코드 재대조 | 교체 전 파일 119개 모두 일치, 불일치 0 |
| 관측·게시 보존 | 관측 208,529건, 정규화 885,586건, 기존 게시 메타데이터 유지 |
| 남은 배포 잠금 | 없음: 이번 owner 제거 확인 |

## 실제 실행 흐름

16:04 KST에 같은 SSH 연결이 성공했다. 일반 사용자로 DB 경로 존재 확인이 실패했던 것은 상위 디렉터리 0750 권한 때문이었고, sudo 읽기로 실제 DB가 있음을 확인했다. 키 만료나 DB 삭제로 판단하지 않는다.

실제 배포 전 설치 스크립트가 새 Runner 의존 모듈 `market/logic/pc-price-readiness.mjs`를 복사하지 않는 결함을 고쳤다. `aws-runner/install-ubuntu24.sh`와 `harness/aws-runner-deploy-contract.mjs` 두 파일만 추가 커밋했다. 전체 `scripts/verify.ps1`은 exit 0이었다.

첫 압축 시도는 Git 하위 디렉터리 기준 때문에 비어 있었고, 다음 시도는 하위 tree의 속성 적용에서 Windows CRLF가 들어가 해시가 달랐다. 두 번 모두 서비스 중지 전에 거부됐으며, 검사 기준을 낮추지 않았다. 저장소 루트에서 LF를 유지해 압축하고 실제 압축 안의 모든 설치 파일 바이트를 Git blob과 비교하도록 고쳤다.

검증된 패키지:

- 파일: `runner-final-20260917T071416Z.tar.gz`
- SHA-256: `d6fdef72d14fad615f65034f92062b95b4ab09e7ebb6f90639f46bfc3b7ccf40`
- 소스 commit: `4931803ccc7e6579953e4edcb0660147e39cf02e`
- 설치 대상: 75개 파일

기존 수집을 강제로 종료하지 않고 idle을 기다렸다. 16:21:56 KST 첫 중지 후 최신 SQLite 사본을 만들었지만, 전체 quick_check가 120초 제한을 넘어 기존 서비스를 자동 재시작했다. 검사는 별도 사본에서 기존 서비스를 켠 채 다시 수행해 **16:31:28 KST에 PASS**했다. 이는 DB 손상이 아니라 검사 시간 제한 초과였으며, 첫 시도에서 installer는 아직 실행되지 않았다.

두 번째 절차는 이미 전체 검사를 통과한 복구 사본을 먼저 확인한 뒤, 중지 시점의 더 최신 DB/WAL 사본을 추가로 만들어 모든 복사 바이트 해시·원장 건수·버전·게시 행 digest를 대조했다. 새 사본에 전체 quick_check를 별도로 수행했다고 주장하지 않는다. 긴 전체 검사를 중지 구간에서 다시 반복하지 않은 것이다.

**16:32:36 KST** idle 서비스 중지 → **16:33:23** 최신 복사본 검증 → **16:33:33** 정식 installer 및 설치 파일 75개 해시 통과. Installer 로그에는 로컬·공개 health와 인스턴스 일치 확인이 모두 성공으로 기록돼 있다.

이어서 추가한 Python `urllib.request.urlopen`의 **`https://runner.used-pick.com/health`** 재조회가 **16:33:34 KST에 HTTP 403**을 반환했다. 이 추가 확인 실패로 자동 복구 절차가 실행됐으며 **16:33:40 KST에 복구 health PASS**를 확인했다.

정식 installer의 공개 검사 PASS와 추가 Python 요청의 403을 구분한다. 이 증거만으로 Cloudflare 특정 규칙, User-Agent 차단, 인증 오류 또는 Runner 자체 고장 중 무엇인지 확정하지 않는다. 403 요청을 다른 클라이언트·헤더·계정으로 우회 재시도하지 않았다. 추가 인증된 publication scope GET도 별도로 연결 도구가 거부했으며 실행하지 않았다.

## 보호된 복구 지점

전체 검사 완료 사본:

`/var/lib/used-market-runner/backups/runner-final-20260917T071416Z/search-index.sqlite`

- 크기: 2,501,058,560 bytes
- SHA-256: `7c886ab8cea8491ef2bdc25d58c80fbe935baa6ef4c10cff8398d36c80c6961c`
- 전체 검사: quick_check=ok

추가 최신 복사본 및 코드·설정 복구:

`/var/lib/used-market-runner/backups/runner-final-20260917T071416Z-resume/`

- 최신 DB SHA-256: `019ed1c7a63c8a605f021d11fff73c12df0a076aa95c158b0f592e9f9b48b62b`
- 복사한 DB/WAL 바이트 일치, 관측 건수·버전·게시 내용 대조 PASS
- 코드·설정 복구 파일에는 운영 DB를 포함하지 않는다.
- 운영 DB 전체 복원/덮어쓰기 0회. 복구는 코드·설정만 대상으로 했다.

## 마지막 읽기 확인

16:34:57 KST:

- Runner PID 1987599, active/running.
- Tunnel PID 1987600, active/running.
- 교체 전 원본 코드 119개 SHA-256 불일치 0.
- raw_listings 179,853; listing_snapshots 208,529; normalized_listings 885,586.
- v18 / parser-v8 / rules-v18 / filter-v7 / master-v5 유지.
- 기존 게시 `1d112ab0-6f45-4224-8ba3-a5d026427d86`, 2,465행 유지.
- 로컬 게시 checksum `893cd30f5474c00fad8e7c84c296a4a1e8b2d8738a77bc2fde708e35a2a21568` 유지. 로컬 저장 표현과 D1 payload의 checksum 형식은 다르므로 두 값을 직접 동일 비교하지 않는다.
- release owner 파일 없음.

## 남은 한 가지 실행 차단

**서버에서 공개 `runner.used-pick.com/health`로 보낸 16:33:34 KST 요청이 왜 HTTP 403이었는지 확인해야 한다.** 기본 SSH/sudo와 정식 설치 스크립트는 통과했으므로 이 단계들을 다시 권한 미확보로 보고하지 않는다. 요청 식별 헤더는 당시 Python 예외 기록에 보존되지 않아 알 수 없으며, CF-Ray를 만들어 쓰지 않는다. 필요한 조치는 해당 시각·호스트의 403 로그/규칙 확인이며 WAF 전체 해제나 토큰 공개가 아니다.

가격 재게시·추가 원 사이트 수집·v19 활성화·브라우저 검증은 이번 코드 교체 작업에서 수행하지 않았다. 이전 실제 브라우저 스킬 미확보 항목을 해결했다고도 하지 않는다.

## 증거

- `tmp/runner-replacement-root-verify-20260917.log`
- `tmp/runner-replacement-preflight-20260917.json`
- `tmp/runner-replacement-package-r3.json`
- `tmp/runner-replacement-deploy-r3-20260917.log`
- `tmp/runner-replacement-offline-integrity-20260917.log`
- `tmp/runner-replacement-resume-20260917.log`
- `tmp/runner-replacement-closure-20260917.json`

원본 DB·설정·인증정보가 있는 복구 archive는 서버의 보호된 위치에만 보존하며 사용자 다운로드나 Git에 포함하지 않는다.
