# 2026-08-20 검색 세션 정책 운영 배포

## 결정과 구현

- 전체 검색의 수집 키는 검색어·카테고리·처음 선택한 사이트 묶음으로 고정했다.
- 사이트 탭은 `view_sites`로 같은 SQLite 스냅샷을 먼저 읽고, `focus_sites`와 `collect_view=true`로 현재 사이트만 보강한다.
- 브라우저는 전체 스냅샷과 사이트별 응답을 분리해 한 사이트 보강 뒤 다른 사이트로 바꿔도 0개로 깜빡이지 않는다.
- 낮은 가격순의 원 사이트 보강은 1차 배포에서만 사용했다. 아래 "2차 속도 정책 배포"가 이 동작을 대체한다.
- live 병합과 SQLite 페이지 모두 숫자 가격을 첫 정렬 키로 사용하며, 의심 항목은 순서를 왜곡하지 않고 경고만 유지한다.

## 운영 보완

- 278MB SQLite에서 서비스 재시작 때마다 전체 무결성 검사와 삭제 스캔이 실행돼 포트 복구가 수분 걸리는 문제를 확인했다.
- 전체 `integrity_check`는 스키마 마이그레이션 때만 실행하고, 지원하지 않는 사이트가 실제로 저장된 경우에만 정리 트랜잭션을 연다.
- 전체 무결성 검사는 배포 점검용 `aws-runner/migration-smoke.mjs`로 분리 유지한다.

## 배포

- AWS 최종 런타임 배포: `20260820T131758Z`
- AWS 가격 인덱스 배포: `20260820T131441Z`
- AWS 백업:
  - `/var/backups/used-market-runner/20260820T124832Z-search-session-policy`
  - `/var/backups/used-market-runner/20260820T130911Z-snapshot-view`
  - `/var/backups/used-market-runner/20260820T131441Z-price-primary`
  - `/var/backups/used-market-runner/20260820T131758Z-live-price-primary`
- Cloudflare Worker 최종 버전: `ab0d93a1-c888-47b8-a5f3-1a45211eb558`
- 공개 주소: `https://used-pick.com`, `https://www.used-pick.com`
- AWS 러너와 Named Tunnel은 모두 `active`, 공개·로컬 health는 HTTP 200이다.

## 검증 증거

- `npm test`: 통과
- `npm run index:harness`: 색인 117, 커서 31, 운영 계약 19, 통합 16, UI 신선도 10개 통과
- `npm run search-session:contract`: 23개 통과
- `node cloudflare/live-search-harness.mjs`: 141개 통과
- Cloudflare harness: 40개 통과
- 번개장터 낮은 가격 live 보강: 원 사이트 시도 1회, 가격 역전 0건
- 중고나라·번개장터 사이트 보기: `index_view`, 원 사이트 수집 0회
- 브라우저 전체 → 중고나라 → 번개장터 → 헬로마켓 낮은 가격 흐름 통과, 콘솔 오류·경고 0건

## 2차 속도 정책 배포 (최종)

- 1차 배포의 `acquisition_mode=price_asc` 원 사이트 보강과 `shadow` 유지 결정은 폐기했다.
- 운영 모드를 `RUNNER_INDEX_MODE=cache_first`로 바꿨다. 저장 결과가 있으면 오래된 결과도 즉시 표시하고 백그라운드 갱신을 예약하며, 캐시가 전혀 없는 검색만 원 사이트 동기 수집을 기다린다.
- `낮은 가격순`은 브라우저의 현재 배열을 즉시 숫자 가격순으로 바꾸고 같은 SQLite 스냅샷의 첫 페이지를 조회한다. 원 사이트 가격순 수집은 API에서 강제로 요청해도 `recent` 수집으로 정규화한다.
- 전체 검색 뒤 사이트 탭은 기존 결과를 즉시 표시하고 선택 사이트만 보강한다. 보강 결과는 30개씩 3페이지, 최대 90개를 미리 읽는다.
- 사이트 보강과 페이지 이동이 겹치면 요청할 때의 cursor와 현재 cursor를 비교해 오래된 페이지 응답이 새 스냅샷을 덮지 못하게 했다.
- stale 갱신 확인은 서버의 `poll_after_ms`를 1~20초 범위에서 따르고 최대 20초 backoff, 3분 절대 기한을 사용한다. 검색어·스냅샷·갱신 토큰이 바뀌면 이전 확인을 종료한다.

### 2차 배포

- AWS 백업: `/var/backups/used-market-runner/20260820T140105Z-cache-first-fast-sort`
- AWS 파일 SHA-256:
  - `runner.mjs`: `56548e81a2df6fddd0c31fba4473cf39c491a5c01b1ac98320d186d3079efb34`
  - `live-search.mjs`: `38fd5b74be5217e5c2d5e91afa6caff5cbcefa2ad10b8ee6d7b2e7e83c829520`
- Cloudflare Worker 버전: `db115350-8c3f-4a8e-aeda-d1c19a76c66e`
- `used-market-runner.service`, `used-market-tunnel.service` 모두 `active`; 공개·로컬 health HTTP 200

### 2차 검증

- `npm test`: UI 페이지네이션 40개, 검색 세션 정책 41개를 포함해 전체 통과
- `npm run index:harness`: 색인 117개, cursor 31개, 운영 계약 19개, 통합 25개, UI 신선도 13개 통과
- `node cloudflare/live-search-harness.mjs`: 141개 통과
- `npm run cloudflare:harness`: 40개 통과
- 운영 브라우저 `아이폰 15`: 전체 검색 결과 505개를 캐시 우선으로 표시, 콘솔 오류·경고 0건
- 전체 → 중고나라: 기존 2개를 약 1.1초 안에 먼저 표시한 뒤 307개로 보강
- 중고나라 1 → 3페이지: 30개 결과를 약 1.6초 안에 표시
- 낮은 가격순: 약 1.2초 안에 20,000원부터 오름차순으로 표시
- 가격 정렬 전후 운영 지표: `index_page_reads_total`만 5→6, `live_collection_runs_total` 2, `source_collection_attempts_total` 5, `index_ingest_commits_total` 2로 유지

## 남은 운영 조건

- 전환 시점 24시간 비교 표본은 21회뿐이며 `missing_rate=30.87%`, `stale_rate=33.64%`였다. 사용자가 속도 우선 전환을 결정했으므로 캐시 결과가 처음에는 오래됐거나 일부 부족할 수 있다. 백그라운드 갱신 지연과 누락률을 계속 관찰하고 문제가 커지면 위 AWS 백업과 `shadow` 설정으로 되돌린다.
