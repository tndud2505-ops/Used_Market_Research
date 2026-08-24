# AWS Ubuntu 러너 운영

이 디렉터리는 현재 `runner.mjs`를 AWS Ubuntu 24.04에서 실행하기 위한 설치·환경·systemd·Cloudflare Tunnel·헬스체크 파일만 담는다.

현재 러너의 대상 사이트는 다음 5곳이다.

- 번개장터: `bunjang`
- 중고나라: `joonggonara`
- 헬로마켓: `hellomarket`
- 리싱크몰: `rethinkmall`
- eBay: `ebay` (공식 Browse API)

`runner.mjs`는 위 사이트를 사이트별 동시성 제한 안에서 병렬 수집한다. 서로 다른 검색은 최대 4개가 동시에 실행되고 16개까지 대기하며, 한 검색의 소스 작업은 최대 16개다. AWS 로컬 SQLite가 주 검색 색인이고 D1에는 변경된 최근 핵심 매물만 백업한다.

사용자 첫 검색은 사이트별 최대 160개 후보를 확인한 뒤 품질 필터 후 사이트마다 최대 160개, 전체 최대 640개를 SQLite에 보존한다. 번호 페이지는 우리 서버의 같은 스냅샷에서 30개씩 조회하므로 원 사이트를 다시 호출하지 않는다. 저장 결과의 마지막에서만 사용자가 `다음 매물 더 찾기`를 눌러 사이트별 수집 창을 160→320→480→640개로 확장하며, 전체 스냅샷 상한은 1,000개다. 가격·정렬 변경은 커서를 초기화하고 원 사이트가 아니라 SQLite의 새 1페이지를 조회한다.

## 구조

```text
Cloudflare Worker Cron / 수동 실행
          │ HTTPS POST + Bearer token
          ▼
Cloudflare Tunnel 공개 호스트명
          ▼ outbound 연결
AWS Ubuntu
  ├─ used-market-runner.service : 127.0.0.1:8787
  └─ used-market-tunnel.service  : cloudflared → localhost:8787
```

사용자는 기존 사이트 주소를 사용한다. Worker의 러너 URL만 Tunnel 공개 호스트명으로 바꾼다.

중요: `runner.mjs`는 `../cloudflare/live-search.mjs`를 import한다. 따라서 AWS로 올릴 때 `aws-runner/` 폴더만 따로 올리지 말고 프로젝트 루트 전체를 올리거나, 설치 스크립트의 첫 번째 인자로 프로젝트 루트를 지정한다.

## 1. Cloudflare Tunnel 준비

Cloudflare Dashboard에서 다음을 만든다.

1. Zero Trust → Networks → Tunnels → Create Tunnel
2. AWS 서버용 Linux 환경을 선택하고 토큰을 복사한다.
3. Public Hostname을 추가한다. 예: `runner.example.com`
4. Service를 `http://127.0.0.1:8787`로 지정한다.
5. Tunnel 토큰은 설치 후 `configure-ubuntu24.sh`가 묻는 입력란에 붙여넣는다.

Cloudflare 공식 안내: [Tunnel setup](https://developers.cloudflare.com/tunnel/setup/), [AWS 배포 가이드](https://developers.cloudflare.com/tunnel/deployment-guides/aws/)

Tunnel 방식에서는 AWS 보안 그룹에 8787·80·443 인바운드 포트를 열 필요가 없다. SSH만 관리 목적으로 열고, 서버가 Cloudflare로 outbound 연결할 수 있어야 한다. 제한적인 방화벽이면 Cloudflare가 안내하는 7844 egress를 확인한다.

## 2. AWS에서 설치

프로젝트 루트를 AWS의 예를 들어 `/home/ubuntu/used-market`에 업로드한 뒤 실행한다.

```bash
cd /home/ubuntu/used-market
sudo bash aws-runner/install-ubuntu24.sh /home/ubuntu/used-market
```

설치 스크립트가 다음을 처리한다.

- Ubuntu 패키지·Node.js 22 설치
- Chromium 설치 및 실행 경로 확인
- `cloudflared` 설치
- `usedrunner`, `cloudflared` system user 생성
- `/opt/used-market-runner`에 러너와 필요한 `live-search.mjs` 배치
- `/etc/used-market-runner/runner.env` 생성
- `used-market-runner.service`, `used-market-tunnel.service` 등록
- Node 모듈을 추가로 설치하지 않고 검색 색인 계약·`.mjs` 문법검사

설치 스크립트는 AWS에서 실행해야 한다. 이 저장소 작업에서는 AWS에 접속하거나 설치를 실행하지 않는다.

## 3. 비밀값 설정 및 서비스 시작

```bash
sudo bash /opt/used-market-runner/aws-runner/configure-ubuntu24.sh
```

입력값:

- `CLOUDFLARE_RUNNER_TOKEN`: Cloudflare Worker가 `/api/runner/run` 호출 때 쓰는 긴 랜덤 토큰
- `EBAY_CLIENT_ID`: eBay Developer 애플리케이션 Client ID
- `EBAY_CLIENT_SECRET`: eBay Developer 애플리케이션 Client Secret
- `D1_IMPORT_URL`: 선택. `{ "items": [...] }`를 받는 HTTPS import API
- `CLOUDFLARE_MANUAL_RUN_TOKEN`: 선택한 import API의 Bearer 토큰
- `Cloudflare Tunnel token`: Dashboard에서 복사한 Tunnel 토큰

저장 위치와 권한:

- Runner 환경변수: `/etc/used-market-runner/runner.env` (`root:usedrunner`, `0640`)
- Tunnel 토큰: `/etc/cloudflared/used-market-runner.token` (`root:cloudflared`, `0640`)

서비스가 성공하면 다음 두 유닛이 부팅 시 자동 시작된다.

```bash
systemctl status used-market-runner.service --no-pager
systemctl status used-market-tunnel.service --no-pager
```

## 4. Worker 연결

Cloudflare Worker 배포 환경에서 다음을 설정한다.

```text
CLOUDFLARE_RUNNER_URL=https://runner.example.com/api/runner/run
SEARCH_RUNNER_URL=https://runner.example.com/api/search
RUNNER_TOKEN=<CLOUDFLARE_RUNNER_TOKEN과 동일한 값>
```

저장소의 Worker 배포 스크립트는 `CLOUDFLARE_RUNNER_URL`과 `CLOUDFLARE_SEARCH_RUNNER_URL`을 사용한다. 실제 Worker Secret 이름은 `RUNNER_TOKEN`이다. 두 URL은 같은 Tunnel을 사용하되 각각 `/api/runner/run`, `/api/search`까지 포함한다.

새 환경의 첫 배포는 `RUNNER_INDEX_MODE=shadow`로 live·색인 비교 수치를 모을 수 있다. 현재 운영은 2026-08-20 검색 대기시간 개선 결정에 따라 `RUNNER_INDEX_MODE=cache_first`다. 저장 결과를 먼저 응답하고 stale이면 백그라운드 갱신하며, 캐시가 없는 검색만 동기 수집한다.

## 5. 헬스체크

로컬 러너, 5개 대상 사이트와 SQLite 색인 활성 상태를 확인한다.

```bash
bash /opt/used-market-runner/aws-runner/health-check.sh
```

Tunnel 공개 URL까지 확인한다.

```bash
RUNNER_PUBLIC_URL=https://runner.example.com \
  bash /opt/used-market-runner/aws-runner/health-check.sh
```

실제 수집 작업 1개까지 검증하려면 토큰을 환경변수로 주고 실행한다. 이 명령은 번개장터·중고나라·헬로마켓·리싱크몰·eBay를 실제로 요청하므로 점검할 때만 사용한다.

```bash
RUNNER_TOKEN='<CLOUDFLARE_RUNNER_TOKEN>' \
  bash /opt/used-market-runner/aws-runner/health-check.sh --run-job --job gpu-fast-scan
```

실패 시 로그:

```bash
journalctl -u used-market-runner.service -n 100 --no-pager
journalctl -u used-market-tunnel.service -n 100 --no-pager
```

공개 URL이 로컬 `/health`와 같은 JSON을 반환해야 한다. `target_sites`에 다음 5개가 모두 있어야 한다.

```json
["bunjang", "ebay", "hellomarket", "joonggonara", "rethinkmall"]
```

## 6. 운영 점검표

- [ ] Cloudflare Public Hostname이 `http://127.0.0.1:8787`을 가리킨다.
- [ ] Worker의 `CLOUDFLARE_RUNNER_URL`이 Tunnel URL의 `/api/runner/run`까지 포함한다.
- [ ] Worker `RUNNER_TOKEN`과 AWS `CLOUDFLARE_RUNNER_TOKEN`이 동일하다.
- [ ] `used-market-runner.service`와 `used-market-tunnel.service`가 active다.
- [ ] `/health`의 대상 사이트가 5개이고 `search_index.enabled`가 `true`다.
- [ ] AWS 여유 디스크가 5GB 이상이다. 미만이면 배포 전에 EBS를 확장한다.
- [ ] 현재 운영 모드는 `cache_first`이며 stale 비율·갱신 지연·자원 경고를 모니터링한다.
- [ ] D1 저장이 필요하면 `D1_IMPORT_URL`과 import token을 모두 설정했다.
- [ ] AWS 보안 그룹에서 8787을 공개하지 않았다.
- [ ] 대상 사이트의 이용약관·robots·접근 제한을 준수한다.

## 파일 설명

| 파일 | 역할 |
|---|---|
| `runner.mjs` | 5개 사이트 제한 병렬 수집·캐시 우선 검색 HTTP 서버 |
| `search-index.mjs` | SQLite WAL·FTS5 색인, 갱신·보관·백업·비교 지표 |
| `install-ubuntu24.sh` | Ubuntu 24.04 설치·파일 배치·systemd 등록 |
| `configure-ubuntu24.sh` | 비밀값 입력·권한 설정·서비스 시작 |
| `used-market-runner.service` | Node 러너 systemd 템플릿 |
| `used-market-tunnel.service` | 토큰 파일 기반 cloudflared systemd 템플릿 |
| `health-check.sh` | 로컬·공개 URL·선택적 실제 수집 검사 |
| `smoke-search.sh` | 인증 토큰을 출력하지 않는 5개 사이트 실검색 점검 |
| `reset-shadow-metrics.mjs` | 첫 배포 점검값만 지우는 명시 확인형 shadow 지표 초기화 |
| `configure-d1-backup.sh` | stdin 토큰으로 D1 변경분 백업 경계를 설정 |
| `seed-d1-backup.mjs` | 활성 색인의 사이트별 최근 2,500개를 D1에 1회 시드 |
| `.env.example` | 환경변수 이름과 저장 위치 예시 |
