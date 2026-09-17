# 에이전트 1 — 실제 실행 결과

작성: 2026-09-17 14:40 KST. 마지막 소스 해시 대조: 14:39:57 KST.

## 최종 판정

**역할 전체 완료: BLOCKED. 로컬 수정·테스트 및 운영 읽기 검증은 수행했다. 이 세션의 운영 쓰기·배포·통합 커밋은 0회다.**

과거 `PC_PUBLICATION_NOT_RECENT`를 현재 차단 사유로 재사용하지 않는다.
14:26 정식 preflight는 PASS였고 운영 게시와 Worker는 다른 실행에서 실제 변경됐다.
하지만 현재 운영 작업자의 소유권·복구 지점·배포 후보 전체를 인수하지 못했다.
동시 실행의 운영 변경이 계속 확인되어 추가 배포나 이동 중인 작업 트리의 커밋은 하지 않았다.

## 1. 이번 세션에서 실제 바꾼 것

기존 분할 게시 client/Worker/migration의 최초 구현은 이 세션의 성과가 아니다.
그 변경을 읽고 아래 결함을 추가 수정했다.

### HTTP 오류 관측

`aws-runner/pc-stats-publication-client.mjs`

- 비JSON 503을 `null`로 잃던 경로에 상태코드, 시작 시각, 소요시간,
  content-type, CF-Ray, request ID와 제한된 오류 본문 발췌를 추가했다.
- 응답은 스트리밍으로 최대 1 MiB까지만 읽고 초과하면 취소한다.
- 알고 있는 토큰 및 일반적인 인증·비밀번호 필드를 자르고 가리는 순서를 검증했다.
  전체 요청 데이터·인증 헤더를 진단 메시지에 출력하지 않는다.
- 관리자 리다이렉트를 따라가지 않으며 401/403/429에 자동 재시도를 추가하지 않았다.

### 분할 게시 무결성

`cloudflare/public-product-stats.mjs`

- 분할 descriptor의 해시만 확인하고 전체 행의 checksum을 그대로 신뢰하던 결함을 수정했다.
- 비활성 staging의 실제 저장 행을 canonical key 순서로 다시 읽어
  `statsChecksum`과 같은 JSON 바이트열의 SHA-256을 스트리밍 재계산한다.
- 행 개수, 키 집합, 실제 유표본 범위 개수, normalization/parser/rule/filter,
  동일 as_of, 구성원 추적 메타데이터의 형식을 확인한 뒤 활성화를 허용한다.
- 개별 페이지는 최대 80행·원문 stats 약 2 MiB, 최대 35페이지다.
  범위를 넘으면 검증을 생략하지 않고 실패한다. 실제 Worker CPU/메모리 성능은 미검증이다.
- 구성원 checksum 필드의 존재·형식과 전체 게시 payload 해시를 확인하는 것이지,
  운영 원장 구성원의 독립 재추적까지 이번 테스트에서 완료했다는 뜻은 아니다.
- 이전 게시 ID/checksum이 달라졌으면 전환을 거부한다. 운영 단일 쓰기 소유권은
  여전히 별도로 확보해야 하며, 이 검사는 임의의 동시 운영 DB 쓰기를 허용하는 장치가 아니다.

### 전체 범위 bootstrap 연결

`cloudflare/worker.mjs`, 위 모듈, 두 게시 실행 파일

- 인증된 읽기 전용 `GET /admin/product-stats-scopes`를 추가했다.
  현재 활성 manifest와 다섯 식별 필드를 같은 D1 읽기 batch로 반환한다.
- 가격 값은 반환·복사하지 않으며 응답에 `no-store`를 적용한다.
- 정기 게시기는 에이전트 3의 `fullPublicationScopes(..., { externalActive })`에
  실제 읽은 증거를 전달한다. 이전 D1 범위를 포함한 전체 scope를 새로 계산한다.
- 정기/수동 importer가 활성화 시 예상 predecessor를 전달하도록 연결했다.
- 이 경로가 현재 공개 Worker에 포함됐는지는 배포 패키지와의 해시 대조가 없어 미확인이다.
  구 Worker에 없다면 호환성 유지형 단계 전환이 필요하다. gate를 우회하지 않았다.

### 실행형 테스트

- 신규 `harness/pc-agent1-publication-http-contract.mjs`: 9개 합성 HTTP 검사.
- 신규 `harness/pc-agent1-chunk-integrity-contract.mjs`: 실제 SQLite in-memory
  테이블·제약조건을 이용한 13개 검사. 운영 DB는 열지 않았다.
- `package.json`의 `test:pc-release` 및 전체 `npm test`에 연결했다.
- 공유 publication contract는 D1 증거를 실제 전달하는 새 호출을 검사하도록 강화했다.

## 2. 재현 → 수정 → 재검증

처음 추가한 SQLite 검사 8개 중 5개가 실제로 실패했다.

| 재현한 결함 | 수정 전 | 수정 후 |
|---|---|---|
| 잘못된 전체 checksum을 활성화 | FAIL | PASS |
| 같은 행 수로 저장 가격을 바꿔도 활성화 | FAIL | PASS |
| 같은 행 수로 scope ID를 바꿔도 활성화 | FAIL | PASS |
| 서로 다른 normalization의 staging 허용 | FAIL | PASS |
| 서로 다른 as_of의 staging 허용 | FAIL | PASS |

이후 인증, 빈 D1의 명시적 증명, 기존 scope 보존, predecessor 변경,
client→Worker 전체 왕복 검사를 추가해 최종 13개 모두 통과했다.

| 실행 | 결과 | 증거 |
|---|---|---|
| 인수 시 기존 npm test | PASS, exit 0 | tmp/agent1-inherited-npm-test-20260917-1420.log |
| 새 HTTP 검사 | PASS 9/9 | tmp/agent1-release-contracts.log |
| 새 SQLite/왕복 검사 | PASS 13/13 | tmp/agent1-release-contracts.log |
| 수정 후 전체 npm test | PASS, exit 0 | tmp/agent1-final-candidate-npm-test.log |
| 루트 scripts/verify.ps1 | PASS, exit 0 | tmp/agent1-root-verify.log |
| git diff --check | PASS, exit 0 | 실제 명령 결과; CRLF 안내는 오류 아님 |
| 14:38:36→14:39:57 담당 소스 9개 해시 | 변경 없음 | tmp/agent1-reviewed-source-hashes.json; tmp/agent1-final-verification-summary.json |

모두 로컬 코드 검증이며, 합성 자료를 실제 시장 수집이나 운영 가격 감사로 보고하지 않는다.
작업 트리 전체를 고정한 배포 패키지 검증은 아니다.

## 3. 직접 조회한 운영 상태 — 수행자와 관측을 구분

### 배포 준비 검사

14:26:02 KST에 실행한 `node cloudflare/deploy.mjs --preflight-only`:
`AWS PC scheduler and publication preflight passed.`, exit 0.
증거: `tmp/agent1-preflight-20260917-142602.log`.

### Runner 공개 health

14:31:33 KST 공개 GET은 HTTP 200, publication_active=false,
publication_recent=true, publication_last_success_at=2026-09-17T05:20:47.862Z였다.
이 게시를 이 세션이 실행한 것은 아니다.
증거: `tmp/agent1-live-public-check.json`.

### Worker 직접 상태 조회

- 배포 생성: 2026-09-17 14:30:29.581739 KST.
- deployment ID: `2490a52e-84fd-40d0-b022-1a69ed80350f`.
- version ID: `9ec9ef1d-0beb-465c-b03f-f79e9c02ce3d`, 100%.
- 읽기 명령 exit 0. 증거: `tmp/agent1-worker-status.json`.

이 세션은 해당 배포를 하지 않았다. 전체 소스/패키지와의 대응은 미확인이다.

### 최신 D1 활성 manifest 직접 읽기

읽기 전용 SELECT 결과, exit 0. 증거: `tmp/agent1-d1-active-summary.json`.

| 항목 | 값 |
|---|---|
| publication_id | 1d112ab0-6f45-4224-8ba3-a5d026427d86 |
| activated_at | 2026-09-17 14:36:58.620 KST |
| created_at/as_of 기준 | 2026-09-17 14:14:40.255 KST (manifest created_at 조회값) |
| checksum | 317d7c4b99db53335d27ab2b7471362b38c3f432534467d12385347db0527df0 |
| expected / actual rows | 2,465 / 2,465 |
| expected sampled scopes | 1,106 |
| parser / rule / filter | pc-parser-v8 / pc-rules-v18 / pc-filter-v7 |
| 행 normalization 최솟값 / 최댓값 | 18 / 18 |
| member_checksum 필드 누락 행 | 0 |

14:20의 게시와 별도로 14:36:58에도 활성 게시가 바뀌었다. 이것도 이 세션의 쓰기가 아니다.
checksum은 조회한 manifest 값이며, 운영 원장과 실제 구성원을 모두 다시 계산해
독립 검증한 결과로 과장하지 않는다. 행 수 일치만으로 가격 시스템 전체를 합격시키지 않는다.

## 4. 현재 실제 차단과 미완료

### 도구 정책 / 운영 소유권

- 14:18:48 KST 최초 SSH 읽기는 기존 서버에 접속했고 hostname을 받았다.
  이후 경로 test에서 exit 1로 종료됐으며 원인 메시지는 없었다.
  이것을 키 만료, sudo 부족, 앱 삭제의 증거로 해석하지 않는다.
- 뒤이은 경로·service·owner 읽기 조회는 실행 전 연결 도구에서 거부됐다.
  원문: `요청의 보안 상태를 결정하지 못해 이 도구 요청은 OpenAI에 의해 차단되었습니다.`
  거부 응답에는 정확한 초단위 KST 시각이 없어 임의 시각을 만들지 않았다.
- 나중의 로컬 진단 파일 목록/Runner 코드 검색 묶음도 같은 원문으로 거부됐다.
  다른 명령·계정·도구로 해당 거부를 우회하지 않았다. 모든 로컬 실행이 차단된 것은 아니다.
- 독립적으로 허용된 npm, root verify, 공개 GET, Worker/D1 읽기는 실제 실행했다.
- 기존 운영 작성자/잠금/PID/서비스/디스크와 새 복구 지점의 인수는 **BLOCKED**다.

거부된 서버 조회의 범위는 기존 SSH 연결에서 앱/DB 경로 확인,
두 systemd 서비스 상태 및 parts-release-owner 확인이다. 비밀 키 내용이나 토큰은 필요 없다.
사용자 측 최소 조치는 **현재 운영 배포 실행을 한 명의 소유자로 인수 정리하고,
이 읽기 전용 상태조회 요청을 정상 승인 가능한 상태로 만드는 것**이다.
보안 전체 해제, 키 재발급, WAF 해제, 유료 전환을 요구하지 않는다.

### 완료하지 않은 작업

| 작업 | 판정 / 이유 |
|---|---|
| 원래 503 반환 계층·원인 확정 | 미확정. 당시 플랫폼 로그·원 요청 ID와 대조 못 함. 현재 성공은 원인 증명이 아님 |
| 새 운영 복구 지점·전체 서버 파일 SHA 대조 | BLOCKED / 소유권·서버 상태 미인수 |
| 이 세션의 daily-price-refresh / 실제 재수집 | 미실행 / 다른 운영 쓰기 실행과 중복하지 않음 |
| 수동 호출 성공과 자동 cron 성공의 구분 | 미확인 / 수행자·trigger 증거 미인수; 미래 성공 추정 없음 |
| 에이전트 2·3 최종 통합/후보 고정 | BLOCKED / 최종 해시·승인 및 다른 동시 실행 변경 인수 필요 |
| 새 코드 Worker CPU·메모리/전체 대용량 게시 | 미실행 / 로컬 SQLite 합격으로 플랫폼 성능 보장하지 않음 |
| 정식 release / 새 후보 dry-run·실제 패키지 SHA | 미실행 / 움직이는 작업 트리를 배포 패키징하지 않음 |
| 현재 최종 릴리스의 독립 브라우저 검사 | 미실행 / 에이전트 2의 필수 스킬·브라우저 검증 미완료 |
| 과거 기간의 정확 통계 HTTP 처리 | 미완료 / 에이전트 3가 미게시 과거 기간의 HTTP 200 문제를 보고. data helper 개선과 Runner HTTP 매핑은 별도 통합 필요 |
| v19 분류 후보 | 적용하지 않음 / v18 의미를 몰래 변경하지 않음 |
| git add / commit / push | 미실행 / 미확인 동시 변경을 포함한 통합 커밋 방지 |

13:20 이전 백업으로 운영 DB를 덮어쓰거나 이미 적용된 v18 전체 재분류를 반복하지 않았다.

## 5. 에이전트 2·3 검토의 현재 인수 범위

- 에이전트 2의 14:32 문서는 아직 UI_WORK_IN_PROGRESS이며, 다른 실행의 v3 수정과
  배포가 있었다고 명시한다. 이 세션은 프런트엔드를 수정하지 않았다.
- 에이전트 3의 14:29 감사는 당시 `b4e10072-2262-4e68-939c-5c2d1e0e57ac`에 대해
  현재 기간 798개 HTTP 검사와 별칭을 통과했으나 과거 기간 검사에서 FAIL이었다.
  이것을 후속 `1d112ab0-...` 게시까지 독립 전수 검증한 것으로 확장하지 않는다.
- 실제 API 견적의 독립 합계와 브라우저 표시 합계 대조는 동일 작업이 아니다.
- 각 역할의 최종 결과·해시를 받아 최종 공개 릴리스를 고정한 다음 대조해야 한다.

## 6. 소스 식별 및 보관

HEAD 재확인: `b993ab70070909911eb1c96876d4c6e6afb548f0`.
이번 세션의 커밋/배포 패키지 hash: 해당 없음(생성하지 않음).

담당 소스 9개 해시는 `tmp/agent1-reviewed-source-hashes.json`에 저장했고
14:39:57 재대조에서 변경 0개였다. 이 파일의 해시는 선행 미커밋 변경도 포함한다.
새 두 하네스 외 기존 파일의 모든 diff를 이번 세션 단독 작성분으로 보지 않는다.

운영 응답·진단 JSON·일회성 로그는 ignored tmp에만 남겼다. DB/SQL dump,
비밀값, 사용자 프로필, HAR는 추가 생성·커밋하지 않았다.

**결론: 로컬 결함 수정과 22개 새 회귀 검사, 전체 npm/root 검증은 PASS.
운영은 다른 실행에서 회복·교체된 것을 확인했다. 소유권/최종 패키지/브라우저/
과거 통계 검증이 남아 있으므로 에이전트 1 전체 완료 또는 배포 완료로 선언하지 않는다.**
