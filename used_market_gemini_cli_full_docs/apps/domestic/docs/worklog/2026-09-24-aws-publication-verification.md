# 2026-09-24 가격 통계 게시 장애와 AWS 검증 전환

상태: 운영 배포 및 새 전체 게시 검증 완료. 이 문서는 당시 증거이며 현재 대응 절차는 [가격 통계 게시 운영 위키](../wiki/09-price-publication-operations.md)를 따른다. 날짜가 지난 식별자를 최신 운영 상태로 단정하지 않는다.

## 원인과 결정

매물 수집은 정상인데 일일 가격 통계 게시가 중단됐다. Worker가 전체 통계를 다시 파싱·체크섬 검증하고 전체 범위 목록을 한 응답으로 만들면서 Workers Free의 CPU 한도를 초과했다. 실시간 tail에서 `/admin/product-stats-scopes`도 `Exceeded CPU Limit`을 확인했다. 당시 전체 통계는 2,534개 범위, `stats_json` 합계 약 51.2 MB, 게시 JSON 약 57.9 MB였다. 이는 매물 2,534개라는 의미가 아니다.

`cpu_ms` 한도 확대 배포는 Cloudflare API code `100328`(Free에서 CPU limits 설정 미지원)로 거절됐고 설정을 되돌렸다. 유료 전환은 하지 않았다. 사용자는 무료 플랜을 유지하며 무거운 검증을 AWS로 옮기고 Worker의 API·인증·캐시·일일 호출·D1 사본 역할을 유지하도록 승인했다. 단순 요청 간격 증가 대신 요청별 처리량과 계산 위치를 바꾼 결정이다.

먼저 전체 체크섬 확인 후 기존 게시를 복구했다. 복구 게시 ID는 `e563c5b0-b53a-4cd7-a4ec-f39bddcfff7c`, 체크섬은 `a99c9e18267c2e4582f513259eb0849ff7c9e620a58b8bfdb62287db437a07fe`, 게시 시각은 `2026-09-24T04:36:23.949Z`다. 그 뒤 아래 구조 변경과 새 게시를 검증했다.

## 적용한 변경

- 활성 범위 조회 100개씩, 업로드 4행씩, 저장 행 재조회 4행씩으로 분리했다. 행 ID를 먼저 읽고 실제 통계는 rowid로 조회해 반복 OFFSET 전체 행 스캔을 피한다.
- Worker가 고정된 인증 AWS 검증 API를 호출한다. AWS가 D1 전체 저장 행·청크·버전·추적성·체크섬을 검증하고 Worker는 검증 응답과 활성화 조건만 확인한다.
- 이전 활성 게시 ID/체크섬과 새 행/청크 수를 같은 D1 트랜잭션에서 재확인한다. 동시 게시 충돌 시 전체 전환이 취소된다.
- 동일 청크의 응답 손실 재시도, 인증 거절, 위조된 검증 주장, 내용 변조, 활성화 경쟁 조건을 결정론 하네스로 확인했다.
- 게시 프로세스와 AWS 검증에 별도 시간·CPU 측정을 추가했다. 수집·분류 규칙, 무료 플랜, 공개 페이지 자산은 이번 변경으로 교체하지 않았다.

## 운영 증거

| 항목 | 확인 결과 |
| --- | --- |
| Worker 버전 | `0b74fa19-6154-429d-84bd-a2512e11136a`, 트래픽 100% |
| Worker 배포 | `2026-09-24T05:39:56.176Z` / 14:39:56 KST |
| AWS 인스턴스 | `cadd217c-6392-4195-a418-12a949b94d43`, 내부·공개 health 일치 |
| AWS 배포 완료 | `used-pick-verifier-deploy-20260924.service`, Result=success, ExecMainStatus=0, `AWS_VERIFIER_DEPLOY_SUCCESS` |
| 새 게시 ID | `c481e126-52bb-477a-94b3-afecf2685104` |
| 새 체크섬 | `599af318d5ed3ae0b25efe8fc75323d92d4eaf9e298b21ff47a2f2791886a793` |
| 기준 시각 | `2026-09-24T05:42:38.279Z` / 14:42:38 KST |
| 게시 시각 | `2026-09-24T05:54:09.140Z` / 14:54:09 KST |
| 후처리 포함 완료 | `2026-09-24T05:55:36.662Z`, HTTP 200, trigger=completed |
| 범위 | 2,534개, 표본 있는 범위 1,125개, 634개 청크 |
| AWS 검증 | `aws-readback-v1`, 전체 체크섬 일치, 676페이지 |
| 게시 프로세스 | 경과 693,566 ms, CPU 479,230 ms. 후속 백업·압축 시간은 이 측정에서 제외 |
| AWS readback | 경과 9,473 ms, process CPU 5,188 ms. 동시 Runner 요청 CPU가 포함될 수 있음 |
| 무결성 | quick_check=ok, FK 위반·통계 구성원 불일치·잘못된 SOLD 증거·시장군 불일치 0 |

게시 프로세스 CPU는 2코어 전체 기준 해당 구간 평균 약 34.5%다. 앞서 수집 중 10.786초 구간의 CPU 1.0421초(2코어 약 4.83%)와 작업·측정 구간이 다르다. 어느 수치도 하루 전체 부하나 모든 수집 페이지의 전수 처리량으로 해석하지 않는다.

AWS `pc_publication_runtime`·`pc_stored_price_publications`, D1 활성 게시, 공개 가격 API의 게시 ID를 맞췄다. 표본은 `cpu:amd:ryzen-5-5600`, `motherboard:asrock:b150m-pro4`, `ssd:crucial:capacity-bucket:257-512-gb`이며 모두 HTTP 200, `x-search-data-source: aws-runner`, `EXACT_PUBLISHED`였다. 공개 7개 부품군 매물 API는 HTTP 200·FRESH였다. 미공개 CASE/COOLING/EXPANSION_CARD/ODD의 category_code 400은 수집 실패가 아니다.

11개 부품군 × 3개 운영 소스의 ACTIVE·enabled 대상에 미성공·실패·지연이 없었다. 최근 24시간 완료 수집은 번개장터 24회, 중고나라 35회, eBay 23회, eBay 1회 진행 중이었다. 기록된 요청 실패·HTTP 차단은 0이었다. Runner/Tunnel은 active·enabled, publication_recent=true였고, 이번 게시 관측 구간의 Worker 오류 tail에는 CPU 초과가 없었다.

## 검증 범위와 남은 문제

- build, PC 서비스·배포 계약, `test:pc-tools`, `test:pc-release`(HTTP 9/9, 무결성 18/18), `test:pc-final`, `test:ui-a`가 통과했다. Worker dry-run 및 실제 배포 완료 기록도 확인했다.
- 전체 `npm test`는 기존 수정 중인 화면의 `harness/pc-ui-contract.mjs:45`에서 멈췄다. 테스트가 기대하는 `analysis-table-pane`을 기존 `price-analysis.html` 수정이 제거한 불일치다. 이번 통계 변경과 분리해 기록하며 전체 테스트 통과로 보고하지 않는다. 새 브라우저 UI 검증을 수행했다는 의미도 아니다.
- 비활성 소스의 과거 매물이 공개 결과에 남아 있고, 판매글이 아닌 사기주의 글이 통계 적격으로 잡힌 사례는 기존 품질 과제다. 전송 체크섬 성공으로 이 문제가 해소됐다고 주장하지 않는다.
- 번개장터 판매상태 재확인 24시간 초과는 21건으로 기존과 같았다. 디스크 81% 사용·31 GB 여유, 메모리 available 약 4.8 GB였다. 증가 추세는 계속 점검한다.
- readback은 전체 내용을 AWS 메모리에 모으므로 데이터가 커지면 시간·메모리 재검증이 필요하다. 이번 성공은 향후 무제한 용량 보장이 아니다.

## 복구 자료 위치

비밀값·원본 결과·백업은 저장소에 복사하지 않았다. 아래는 당시 운영 서버의 보호된 자료 위치이며, 후속 보존 정책에 따라 존재 여부를 다시 확인한다.

- 코드/환경 백업: `/var/lib/used-market-runner/backups/code-before-aws-verifier-20260924/`
- 게시 완료 기록: `/var/lib/used-market-runner/verifier-release-receipt-20260924.json`
- 게시 실행 unit: `used-pick-verifier-publication-20260924.service`
- 동일 실행 키: `operator-aws-verifier-release-20260924-01` (진단용 식별자이며 재실행 지시가 아님)
- 배포 소스 묶음 SHA256: `36d8601c60fea7d4e1b8b9dc47de546cadcea0f62cbf05347ac6090bec5df50d`

09:00 KST 정기 점검 `used-pick`도 이 성공 기준선과 AWS 검증 로그를 확인하도록 갱신했다. 자동 점검은 읽기 전용이며 자동 배포·재시작·게시 재실행·결제 변경은 하지 않는다.
