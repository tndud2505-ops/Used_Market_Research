# USED PICK — 로컬 실행 담당자 인수인계

작성: 2026-09-18 KST
현재 실행 결과: 함께 제공하는 `06-final-production-closeout.md`
**이 파일은 로컬 Codex/Claude 등 기존 저장소에서 작업하는 담당자에게 전달할 실행 지시서다. 계획만 재작성하지 말고 아래 남은 일을 수행하고 증거를 갱신한다.**

## 전달 방법 — 저장소에는 아직 복사되지 않았다

이 파일과 06 결과 문서는 다운로드 첨부로 생성됐다. Chat On Steroids의 파일 전송 허용 호스트 오류로 지정 저장소 복사는 실패했고, 2026-09-18 21:53:47 KST에 두 경로의 파일 없음과 기존 HEAD 유지까지 확인했다. 이번 문서 커밋·push는 없다.

로컬 담당자에게 **이 첨부 자체를 전달**해도 된다. 저장소에 보관할 때는 기존 파일이 새로 생겼는지 먼저 확인하고, 덮어쓰지 않은 상태에서 아래 폴더에 두 문서를 저장한다.

```text
C:\DeVelop\USED_WEB\used_market_gemini_cli_full_docs\apps\domestic\docs\reviews\2026-09-17-three-agent-handoff\
  06-final-production-closeout.md
  07-local-execution-handoff.md
```

두 파일은 계획만 담은 문서가 아니라 이번 실제 진단·검사 결과와 그 이후의 남은 실행 지시다. 로그·DB·비밀값·HAR는 첨부하지 않았다.

## 0. 가장 먼저 알아야 할 현재 상태

2026-09-18 21:35~21:47 KST에 실제 조회했다. 이후 바뀔 수 있으므로 재개 직전 다시 확인한다.

| 대상 | 실제 확인값 | 재개 판단 |
|---|---|---|
| 코드 HEAD | `6b89f1d5d2002e8327626c64de351fc6d62deb0c` | 옛 129cc2d/4931803으로 reset 금지. 이후 문서 커밋 또는 더 최신 HEAD도 보존 |
| Worker | `4b0e6967-4927-46ac-b0ee-0b9cb57becb2`, 100% | 2026-09-17 22:46:17 KST 배포. 옛 e93a0857보다 최신 |
| UI | **ui-a-v1** | 두 도메인 20개 자산 로컬과 일치. v4로 되돌리지 않음 |
| AWS Runner | 기존 롤백 인스턴스 계속 실행 | 최신 Runner 교체는 아직 미완료 |
| Runner instance | `68467b95-a693-4af6-9d86-43da17e31260` | 9월 17일 16:33:36 KST 시작. 고정 expected_before로 재사용 금지 |
| 서비스 | Runner/Tunnel active/running/enabled | PID 1987599 / 1987600. 재개 때 재조회 |
| 마지막 종료 상태 | scheduler_active=true | 정상 수집을 강제 종료하지 말 것 |
| 활성 pipeline | v18 / parser-v8 / rules-v18 / filter-v7 / master-v5 | 분류 의미 변경·v19 활성화 금지 |
| 게시 | `1d112ab0-6f45-4224-8ba3-a5d026427d86`, 2,465행 | 기준 9월 17일 14:14:40 KST. 새 갱신 성공이 아님 |
| 공개 API | 798/798 HTTP 200, 계약 실패 0 | 가격 확보·브라우저 PASS·정기 게시 갱신 정상과 구별 |
| preflight | **exit 2 / PC_PUBLICATION_NOT_RECENT** | 과거 문구 재사용이 아니라 이번 실제 결과 |
| Python 공개 health | **403 / 1010** | 정상 접근 정책 해결이 Runner 교체의 선행 조건 |
| Cloudflare 설정 조회 | **403 / 9109** | 기존 OAuth의 관리 API 접근 경계 |
| 실제 브라우저 | 미실행 | 실제 external-ai-orchestrator 스킬 미확보 |
| 앱/루트 검사 | 모두 exit 0 | 소스 변경 후 다시 실행할 것 |

**핵심: Worker/UI를 또 배포하는 작업이 아니다. 접근 정책 → 안전한 Runner 교체 → 게시 갱신 경로 → 현재 UI 실제 브라우저 검증이 남아 있다.**

## 1. 로컬 담당자에게 그대로 전달할 요청

> `C:\DeVelop\USED_WEB`의 USED PICK 기존 작업을 이어서 수행해 주세요. 먼저 이 파일과 `06-final-production-closeout.md`, 루트 AGENTS.md 및 기존 운영 문서를 읽으세요.
>
> 현재 Worker `4b0e6967...`와 UI `ui-a-v1`는 이미 배포돼 있고 공개 798개 API·20개 자산 검사를 통과했습니다. 이전 parts-ux-v4로 되돌리거나 전체 수집·v18 재분류·단일 대용량 통계 import를 다시 만들지 마세요.
>
> 미완료 우선순위는 (1) AWS Python urllib 공개 `/health`의 403/1010 접근 정책 해결, (2) 최신 검증 소스를 정식 installer로 Runner에 적용, (3) 현재 PC_PUBLICATION_NOT_RECENT의 원인과 정기 게시 최종 활성화 검증, (4) 실제 스킬을 적용한 ui-a-v1 브라우저 검증입니다.
>
> 기존 인증으로 BIC 설정 GET이 403/9109였으므로 다른 UA·IP·계정·토큰으로 우회하지 마세요. 정상 소유자 관리 경로에서 필요한 경우 `GET runner.used-pick.com/health`에만 BIC를 조정하고 동일 AWS/Python 조건으로 검증하세요. 전체 WAF/Access/rate limit 해제는 금지합니다.
>
> 새 clone/reset --hard/clean/git add .을 하지 마세요. 다른 작업자의 변경·잠금을 보존하고 배포 쓰기는 한 명만 수행하세요. 이전 tmp의 PID·owner·manifest를 그대로 실행하지 말고 새 현재값·복구 지점·hash 봉인을 만드세요. 원본 관측과 DB/WAL을 보존하고 복구 시 오래된 DB를 원본에 덮어쓰지 마세요.
>
> 실행한 것만 완료로 기록하고, 수동 daily job 성공/자동 schedule 성공/실제 브라우저 결과를 구분하세요. 최종 결과를 06 문서에 갱신하고 관련 변경만 선별 커밋하세요. 차단이 남으면 정확한 시간·요청·HTTP/exit·제한된 오류·증거·최소 조치 하나를 기록하세요.

## 2. 위치·필독 자료

- 저장소: `C:\DeVelop\USED_WEB`
- Chat On Steroids: `/used_web`
- 앱: `used_market_gemini_cli_full_docs\apps\domestic`
- 운영: `https://used-pick.com/`, `https://www.used-pick.com/`
- Runner 공개: `https://runner.used-pick.com/`
- 서버 앱: `/opt/used-market-runner`
- 운영 DB: `/var/lib/used-market-runner/search-index.sqlite`

처음 읽을 파일:
1. 루트 `AGENTS.md`, `README.md`, `used_market_gemini_cli_full_docs/SETUP.md`, 앱 `README.md`.
2. 앱 `aws-runner/README.md`, `install-ubuntu24.sh`, `health-check.sh`.
3. 앱 `docs/wiki/04-cloudflare-runner.md`, `05-harness-loop.md`.
4. `docs/reviews/2026-09-17-three-agent-handoff/`의 01~06 결과 문서.
5. `docs/design/2026-09-17-ui-concept-a/IMPLEMENTATION.md`와 현재 UI 코드.
6. CPU 해결 기존 보고 `2026-09-17-parts-pricing-release-result.md`, `2026-09-17-completion-checklist.md`.

문서 안의 시점이 섞여 있다. 이전 “최종” 문구보다 **현재 실제 운영 조회**를 우선한다.

## 3. 첫 실행 — 현재 상태 인수, 읽기 전용

PowerShell:
```powershell
Set-Location 'C:\DeVelop\USED_WEB'
Get-Date -Format o
git status --short
git diff --cached --name-only
git rev-parse HEAD
git log -5 --format="%h %cI %s"
git diff --check
```

기존 untracked 8개를 없애거나 커밋에 섞지 않는다:
- 루트 `.tmp-deploy-31e9f8f.sh`, `.tmp-deploy-current.sh`, `.tmp-run-republish-dry.sh`.
- 기존 handoff 폴더 `02-agent2-precision-reset.patch`, `03-agent-gskill-summary.json`, `03-agent-independent-api-quote.json`, `03-agent-source-manifest.json`, `SHA256SUMS.json`.

현재 프로세스·다른 작업자·배포 owner·커널 잠금·service enable/active·여유 공간·활성 pipeline·원장 count/max ID·현재 게시를 먼저 읽는다. `.git/index.lock`이나 운영 owner가 있으면 무작정 지우지 않는다.

기존 정상 SSH 접속 경로는 다음과 같다. 키 내용은 읽거나 채팅에 붙이지 않는다.
```powershell
ssh -i "$env:USERPROFILE\.ssh\LightsailDefaultKey-ap-northeast-2.pem" `
  -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 `
  ubuntu@13.125.31.116 `
  'sudo -n systemctl show used-market-runner.service used-market-tunnel.service -p Id -p MainPID -p ActiveState -p SubState -p UnitFileState'
```

이 주소·호스트 키가 현재 승인된 서버와 일치하는지 기존 설정으로 확인한다. host-key 경고를 무시하지 않는다.

운영 SQLite 감사는 `mode=ro`, `PRAGMA query_only=ON`, 읽기 트랜잭션으로 수행한다. 감사에 migrate·초기화·UPDATE를 섞지 않는다.

## 4. 최우선 — 403 정상 접근 정책 해결

### 확보된 증거

공개 요청:
- 2026-09-18 **21:39:22.617696 KST**
- AWS → `GET https://runner.used-pick.com/health`
- Python urllib 기본 요청, HTTP **403**
- 본문 **`error code: 1010`**
- CF-Ray **`a3d069be694fea21-ICN`**
- Content-Type `text/plain; charset=UTF-8`
- 증거: `tmp/final-closeout-python-health-diagnostic-20260918.json`

기존 Wrangler OAuth 관리 요청:
- 2026-09-18 **21:45:12.719959 KST**
- `/zones/1277954a1cc9364e0d326ce25c556410/settings/browser_check`
- HTTP **403**, code **9109**
- **`Unauthorized to access requested resource`**
- CF-Ray `a3d07234c9ba5503-ICN`
- 증거: `tmp/final-closeout-cloudflare-security-read-20260918.json`

1010은 공식 문서상 브라우저/클라이언트 서명 차단이다. 정확한 적용 규칙은 현재 정상 관리 권한으로 확인해야 한다. 2026-09-17의 원래 403에는 CF-Ray·본문이 없으므로 같은 원인이라고 소급 확정하지 않는다.

### 필요한 최소 조치

사이트 소유자의 **기존 정상 Cloudflare 관리 경로**에서 위 Ray·시각·호스트를 확인한다. 적절한 경우 다음 범위에만 BIC를 조정한다.

```text
(http.host eq "runner.used-pick.com"
 and http.request.uri.path eq "/health"
 and http.request.method eq "GET")
```

BIC만 대상으로 하는 선택적 설정/skip을 사용한다. 다른 보안 제품, 모든 remaining rules, Access, rate limiting을 함께 skip하지 않는다. 현재 정책을 읽고 기존 규칙을 보존하며 중복 규칙을 만들지 않는다. 승인된 변경의 rule ID·정확한 expression·전후 설정·시각·복구 방법을 기록한다.

**현재 OAuth의 거부를 다른 계정·토큰으로 회피하는 작업은 하지 않는다.** 관리자가 정상 권한으로 위 범위의 정책을 확인·조정하는 것이 필요하다. 토큰을 채팅에 보낼 필요는 없다. 권한 확대·유료 전환을 먼저 요구하지 않는다.

### 정책 해결 후 같은 조건의 1회 검사

정책 변경 근거 또는 정상 접근 허용 근거가 확보된 뒤 실행한다. 반복 polling이나 UA 변경용 스크립트가 아니다. 실패 시 exit 1과 제한된 진단을 남기고 중단한다.

```powershell
Set-Location 'C:\DeVelop\USED_WEB\used_market_gemini_cli_full_docs\apps\domestic'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$probe = @'
import datetime, json, urllib.request, urllib.error, sys, re
now = lambda: datetime.datetime.now(datetime.timezone.utc).isoformat()
result = {"started_at": now(), "client": "default Python urllib", "retries": 0}
code = 1
try:
    with urllib.request.urlopen("http://127.0.0.1:8787/health", timeout=20) as r:
        local = json.load(r)
    result["local_instance"] = local["search_index"]["process_instance"]["id"]
    url = "https://runner.used-pick.com/health"
    try:
        with urllib.request.urlopen(url, timeout=20) as r:
            body = r.read(1048576)
            public = json.loads(body)
            result["public"] = {
                "at": now(), "http": r.status,
                "content_type": r.headers.get("content-type"),
                "cf_ray": r.headers.get("cf-ray"),
                "request_id": r.headers.get("x-request-id"),
                "instance": public["search_index"]["process_instance"]["id"],
            }
            result["same_instance"] = (
                result["local_instance"] == result["public"]["instance"]
            )
            code = 0 if local.get("ok") and public.get("ok") and result["same_instance"] else 1
    except urllib.error.HTTPError as e:
        text = e.read(4096).decode("utf-8", errors="replace")
        text = re.sub(
            r"(?i)(authorization|token|secret|password|cookie)([\s\"':=]+)[^\s<>\"']+",
            r"\1\2[REDACTED]", text
        )
        result["public"] = {
            "at": now(), "http": e.code, "content_type": e.headers.get("content-type"),
            "cf_ray": e.headers.get("cf-ray"), "request_id": e.headers.get("x-request-id"),
            "excerpt": text[:700],
        }
except Exception as e:
    result["error_type"] = type(e).__name__
result["finished_at"] = now()
result["status"] = "PASS" if code == 0 else "FAIL"
print(json.dumps(result, ensure_ascii=False))
sys.exit(code)
'@
$probe | ssh -i "$env:USERPROFILE\.ssh\LightsailDefaultKey-ap-northeast-2.pem" `
  -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 `
  ubuntu@13.125.31.116 'sudo -n python3 -' `
  1> "tmp/local-health-$stamp.json" 2> "tmp/local-health-$stamp.stderr.log"
$probeExit = $LASTEXITCODE
Write-Output "HEALTH_PROBE_EXIT=$probeExit"
```

이 코드 블록은 **로컬 재개용으로 제공한 예시이며 이번 세션에서 실행하지 않았다.** 이번 실제 실행 증거는 위 403 JSON이다. 본문에 민감정보가 포함될 수 있으므로 진단 파일도 검토 전 커밋·공유하지 않는다.

현재 인스턴스에서의 공개 접근 PASS는 접근 정책 해결 근거다. **교체 후에는 별도 실행하여 새 local/public 인스턴스가 같고 교체 전과 다른지 검증해야 한다.**

## 5. 최신 Runner 안전 교체 — 선행 조건 없으면 중단

### 후보를 다시 고정한다

현재 HEAD와 작업 트리를 확인한다. 이미 운영 Runner가 교체됐다면 중복 설치하지 않는다. 현재 설치 파일 hash와 Git blob을 비교해서 판단한다.

기존 보완인 `market/logic/pc-price-readiness.mjs` 필수 검사·복사·문법 검사는 이미 installer에 있다. 이를 다시 패치하지 않는다. 게시 client·순수 readiness 모듈 등 installer의 모든 직접/디렉터리 복사 의존성을 빠짐없이 확인한다.

기존 tmp 패키징/배포 스크립트에는 `4931803...`, 과거 before JSON, 오래된 PID/instance/owner/backup proof가 하드코딩돼 있다. **그대로 실행하지 않는다.**

검증한 현재 commit에서 패키지를 만들되:
- 저장소 루트의 Git attributes를 적용하고 LF를 유지한다.
- `git archive`의 하위 경로/중첩 prefix를 실제 tar 목록으로 확인한다.
- Git blob → 실제 압축 member bytes → 서버 staging → 설치 후 bytes의 동일 SHA-256을 확인한다.
- 실제 설치 대상 파일 목록을 현재 installer에서 검토한다. 과거 75개를 무조건 고정 정답으로 삼지 않는다.
- CRLF 오류가 생기면 패키징을 고친다. 해시 비교의 공백·줄바꿈 기준을 낮추지 않는다.
- 앱 분류기·master·pipeline/원장 의미가 현재 v18과 같은지 확인한다. v19 후보는 제외한다.

과거 패키지 `runner-final-20260917T071416Z.tar.gz` / `d6fdef72d14fad615f65034f92062b95b4ab09e7ebb6f90639f46bfc3b7ccf40`는 식별 참고용이지 새 현재 배포 후보가 아니다.

### 단일 소유권·복구·안전 전환

새 owner ID와 새 manifest를 만든다. `/run/lock/used-pick-parts-release.lock`과 owner 기록을 정상 방식으로 확보하고 다른 작업자의 잠금이 있으면 중단한다.

진행 중 수집/게시가 안전하게 끝나는지 제한된 시간 안에 기다린다. 마지막 점검에는 scheduler_active=true였다. 강제 종료·성공 상태 위조 금지. 안전한 전환 조건이 없으면 서비스는 계속 켜 두고 이 단계만 미완료로 기록한다.

서비스가 켜진 상태에서 일관된 복구 사본과 필요한 전체 무결성 검사를 먼저 준비한다. 이후 중지 시점의 최신 DB/WAL·코드·설정 사본을 추가로 확보하고 해시·논리 요약을 검증한다. 새 사본에 실제로 하지 않은 quick_check를 PASS로 기재하지 않는다.

코드·설정 복구 archive와 DB 사본은 보호된 서버 디렉터리에 보관한다. 전체 archive 내용·비밀값·DB를 Git/채팅에 넣지 않는다. 현재 데이터는 과거보다 증가했으므로 예전 DB 전체 덮어쓰기 복구는 금지다.

### 정식 installer

실제 staging 구조와 모든 선행 검증을 확인한 뒤에만 실행한다.
```bash
# SOURCE_ROOT는 새 검증 패키지에서 확인한 실제 앱 루트다.
# 이 줄만 복사 실행하지 말고 잠금·idle·새 복구 사본·해시 검증을 먼저 완료한다.
RUNNER_PUBLIC_URL=https://runner.used-pick.com \
  bash "$SOURCE_ROOT/aws-runner/install-ubuntu24.sh" "$SOURCE_ROOT"
```

정상 순서 Runner → Tunnel, enable/active 확인. installer 성공 로그와 추가 Python 검증을 둘 다 보존한다. 추가 검사를 제거하거나 403을 무시해 완료 처리하지 않는다.

실패하면 코드·설정만 안전하게 복구하고 새 관측을 보존한다. health 복구·정상 service·자기 owner만 제거한 사실까지 확인한다. 정상 SQLite 잠금이나 다른 작업자의 lock을 지우지 않는다.

### 교체 합격 조건

동시에 확인해야 한다:
1. Git/압축/staging/설치 파일 SHA-256 일치.
2. local/public `search_index.process_instance.id`가 같고 fresh before ID와 다름.
3. Runner/Tunnel enabled + active/running.
4. raw/snapshot/normalized count와 max ID 감소 없음.
5. v18 pipeline 유지, 기존 게시 메타데이터 및 같은 표현의 행 digest 보존.
6. 새 공개 요청 403/429/인증 문제 없음, 추가 Python 검사도 PASS.
7. 배포 owner·작업 프로세스 정리 및 증거 저장.

코드만 바꿨다면 가격 재게시·전체 재분류·전체 실수집을 자동 부수 작업으로 하지 않는다.

## 6. 게시 신선도와 실제 정기 경로 — 교체와 별도 판정

현재 preflight의 유일하게 기록된 실패 사유는 `PC_PUBLICATION_NOT_RECENT`다. 직전 성공 시각은 2026-09-17 14:36:59 KST다.

먼저 `pc_publication_runtime`, 실제 daily-price-refresh job 설정·실행 기록·trigger·오류를 읽기 전용으로 대조한다. 03시 주변 journal 0개만으로 스케줄 미실행 원인을 단정하지 않는다.

실제 갱신 검증이 필요하면:
- 교체 이후 현재 소유권·복구 상태·현재 게시 predecessor를 다시 확인한다.
- 기존 **daily-price-refresh** 정식 경로와 실제 코드가 요구하는 인수를 사용한다. API body/관리 endpoint를 추정해서 만들지 않는다.
- 단 한 번의 제한된 실행으로 검증하고 자동·수동 job 중복을 피한다.
- 비활성 분할 저장뿐 아니라 **최종 활성화 단계**의 전체 checksum·행 수·범위·버전·predecessor와 Worker CPU 오류까지 확인한다.
- 40행 분할을 단일 31.1MB 요청으로 되돌리지 않는다. 현재 가격을 과거 범위에 복사하지 않는다.
- 실패 응답의 상태·시간·CF-Ray·content-type·제한된 오류를 기록하고 401/403/429/CAPTCHA 재시도/우회하지 않는다.
- 실제 새 게시가 생성되면 새 ID로 API 감사와 preflight를 다시 수행한다.
- 수동 job 호출 PASS와 자동 scheduler 실제 실행 PASS를 각각 기록한다. 미래 실행은 미실행이다.

Worker/UI 변경이 없다면 **Worker 재배포는 하지 않는다**. 불가피한 Worker 수정이 생기면 기존 `cloudflare/release.mjs`의 gate를 모두 통과한다. `--app-only`, gate 삭제, 오래된 버전 롤백으로 통과시키지 않는다.

## 7. 실제 검증 명령

아래 명령은 각 exit를 확인한다. 같은 작업 중복·403 반복 호출을 위한 일괄 재시도 스크립트로 사용하지 않는다.

```powershell
Set-Location 'C:\DeVelop\USED_WEB'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$app = Join-Path (Get-Location) 'used_market_gemini_cli_full_docs\apps\domestic'
Push-Location $app
npm test *> "tmp/local-npm-$stamp.log"
$npmExit = $LASTEXITCODE
Pop-Location

powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify.ps1 `
  *> "$app\tmp\local-root-verify-$stamp.log"
$rootExit = $LASTEXITCODE

git diff --check
$diffExit = $LASTEXITCODE
Write-Output "npm=$npmExit root=$rootExit diff=$diffExit"
```

권한·정상 접근 확인 후:
```powershell
Set-Location 'C:\DeVelop\USED_WEB\used_market_gemini_cli_full_docs\apps\domestic'
node cloudflare/deploy.mjs --preflight-only

# 저장소 정식 배포 코드에서 확인한 고정 Wrangler 버전.
npx --yes --package wrangler@4.121.0 wrangler deployments list `
  --config cloudflare/wrangler.jsonc

# 반드시 그때 다시 읽은 실제 게시 ID를 넣는다.
# 아래 문자열을 현재값으로 고정하는 실행 스크립트로 사용하지 않는다.
$publicationId = '<방금 확인한 실제 활성 게시 ID>'
if ($publicationId.StartsWith('<')) { throw '실제 게시 ID 확인 필요' }
node harness/pc-agent3-public-api-audit.mjs --after --publication-id $publicationId
```

현재 카탈로그·pipeline 기대값이 달라졌다면 기존 도구의 `--manifest <명시적-release-manifest.json>`를 사용한다. API 응답 자체를 기대값으로 베껴 넣거나 v18/798로 운영을 강제 복구하지 않는다.

정확한 과거 게시가 존재하는 날짜는 200일 수 있다. 존재하지 않는 날짜에는 503/no-store 등 명시적 미제공이어야 하며 현재 요약을 과거로 위장하면 안 된다.

## 8. 실제 브라우저 — 최신 ui-a-v1을 대상으로 한다

확인한 6개 경로에서 실제 `external-ai-orchestrator/SKILL.md`를 찾지 못했다. 정식 스킬의 실제 위치·내용을 로컬 환경에서 확보하고 읽어 적용한다. 가짜 스킬 파일·빈 문서·필수 옵션 제거는 금지다.

기존 진단:
```powershell
node tmp/pc-live-v18-browser.mjs --run --skill-file '<실제 확인하고 읽은 SKILL.md 경로>'
```

**그대로 실행하면 현재 UI와 맞지 않을 수 있다.** 해당 스크립트에는 parts-ux-v4 자산 기대값과 예전 select 기반 UI 선택자가 있다. 현재는 ui-a-v1과 native dialog UI이므로 실제 코드에 맞게 검증 도구를 검토·보완한다. 기존 assertion을 지워 PASS시키거나 새 UI를 구버전으로 되돌리지 않는다. 자산 봉인·독립 산술·격리 컨텍스트·필수 스킬 확인은 유지한다.

필수 검증:
- 일반 운영 URL, 데스크톱과 **390×844**. ?qa=full 등 캐시 우회 주소만 검사하지 않는다.
- 9개 부품군 선택·세부 필터·검색·차트·URL 및 현재 UI dialog/닫기/초점 동작.
- 지스킬 한글/영문과 제조사 전환, 빈 결과에서 이전 가격 제거.
- 국내/eBay 시장·통화 분리.
- RAM 16GB × 2 = 총 32GB, 단가·수량·행 합계 소수 정밀도.
- 필터 초기화 후 견적·수량 보존, 저장·새로고침·잘못된 수량 복구·삭제·매물 이동.
- 9종/총 10개 수량의 원 API 독립 합계와 화면 비교. 같은 게시·기간·통화·시장·버전으로 계산하며 앱 집계 함수를 기대값에 재사용하지 않는다.
- 가격 없는 행은 부분 합계. 1,295,937.32원을 고정 정답으로 두지 않는다.
- 비호환 검사용 조합을 추천 견적이라고 하지 않는다.
- 실제 스크린샷의 모델명·가격·버튼·차트 축 잘림/겹침/가로 넘침을 육안 확인한다. +1px 허용으로 숨기지 않는다.

사용자 개인 프로필·저장 견적 대신 격리된 테스트 컨텍스트를 쓴다. 실제 스킬을 못 확보하면 브라우저만 미실행으로 남기고 독립 가능한 다른 작업을 계속한다. 구버전 스크린샷·합성 DOM 검사·API 산술은 실제 브라우저 PASS가 아니다.

## 9. 수집·원장·품질 후속은 별도

지금 health는 joonggonara 1570/1570, bunjang 1570/1570, eBay 871/871 성공 이력을 보고한다. “eBay 871개 미실행”은 현재 설명이 아니다.

다만 전체 runtime에는 과거 target·비활성 소스·미종료 RUNNING도 있다. 현재 `pc_collection_target_sets`/`pc_collection_targets`의 활성 범위에 맞춰 `pc_source_target_runtime`·`crawl_runs`를 대조한다.
- 성공, 실패 표시, 실제 현재 시도 중, 시도 없음, 성공 이력 없음을 각각 구분.
- 오래된 RUNNING 행을 현재 진행 중으로 단정하거나 성공으로 수정하지 않음.
- 고유 target 2441과 소스 연결 수 합계를 같은 분모로 쓰지 않음.
- health coverage_ready만으로 전체 수집·연속 30일·모든 제품 가격 확보 완료를 선언하지 않음.

원장 구성원 재계산과 지스킬 27개별 수신·저장·요청 제품 일치·제외 사유 감사는 별도 읽기 감사다. API의 member checksum이 같다는 사실만으로 원장 재계산을 완료한 것이 아니다.

품질 80개, RAM 모순 표기·랜카드·128G·케이스 제조사 후보는 별도 버전·회귀·영향·원장 전환 검증 후 판단한다. v18에 몰래 덮어쓰지 않는다. 승인 소스, 메인 검색 7종/가격 도구 9종/내부 수집 11종은 유지한다.

## 10. 완료 보고·선별 커밋

`06-final-production-closeout.md`에 완료/실패/차단/미실행을 분리해 추가한다. 과거 기록을 지워 새 성공처럼 만들지 않는다.

반드시 남길 결과:
- 이번 실제 변경 파일과 검증 source commit, 새 패키지 SHA-256.
- Worker/UI를 변경했는지 여부와 실제 버전/시각; Runner 설치 시각·이전/새 instance.
- 동일 local/public instance, enabled/active, 추가 Python 검사 결과.
- 새 복구 지점, 실제 실행한 무결성 검사와 시각, DB/WAL 및 관측·게시 보존.
- 새 게시/최종 활성화/CPU 결과, 수동 job/자동 schedule 별도 증거.
- API·자산·실제 브라우저 증거 경로.
- 원장/수집/80개 품질 후보의 미완료 범위.
- 최종 owner·잠금·자신이 만든 실행 프로세스 정리와 정상 서비스.

커밋 예시(실제 관련 변경만 지정):
```powershell
git diff --check
git diff --cached --name-only
# 실제로 바꾼 관련 파일을 한 개씩 명시하여 stage한다.
git add -- used_market_gemini_cli_full_docs/apps/domestic/docs/reviews/2026-09-17-three-agent-handoff/06-final-production-closeout.md
git diff --cached --check
git diff --cached --stat
# 다른 작업자 staged 변경이 섞였으면 임의 commit/reset 하지 말고 소유권을 정리한다.
git commit -m "docs: record USED PICK production closeout"
```

`git add .` 금지. DB/SQL dump/복구 archive/HAR/프로필/원 응답/비밀값/tmp 로그는 커밋하지 않는다. commit, push, 운영 배포를 서로 다른 수행 항목으로 보고한다.

## 11. 이번 전달물과 근거

이 문서는 후속 실행용이다. 여기의 교체/정책 수정/재게시/브라우저 예시를 이번 실행 완료로 해석하지 않는다. 이번 실제 수행 결과와 모든 로컬 증거 경로는 06 문서에 있다.

공식 참고:
- 1010 의미: https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1010/
- BIC의 호스트·경로별 선택적 적용: https://developers.cloudflare.com/waf/tools/browser-integrity-check/

**이번 종료: 기존 서비스 정상 유지, 최신 Worker/UI 보존, 앱·루트·공개 API·자산 검사 완료 / Runner 최신 교체·정기 게시 갱신·실제 브라우저 검증 미완료.**

---

## 11. 2026-09-18 23:25 KST 후속 상태 정정

상세 증거는 같은 디렉터리의 `06-final-production-closeout.md` 8절을 우선한다.

- `runner.used-pick.com`의 정확한 `GET /health`에만 BIC OFF Configuration Rule을 적용해 기존 403/1010은 해소했다. rule ID는 `4871db85134441fb90dc0e412befe396`이다.
- commit `5fcc5aea342c05741e54301b5eb02a0a0b2396a3` 후보를 새 백업·lock·owner·75개 파일 해시 검증으로 설치했으나, 오래된 게시와 엄격한 새 범위 검사 조합에서 공개 API 계약 실패 680개가 발생했다.
- 게시 endpoint는 호출하지 않았다. 선행 predecessor GET이 BIC 403(Ray `a3d0ef1b0cd23121`)이어서 재시도/우회 없이 중단했다.
- 최신 DB를 보존하고 코드·설정만 이전 정상 Runner로 복구했다. 현재 local/public 인스턴스는 `6403dc8b-78f3-46b9-a152-1ce610e2bdcd`, 두 서비스 enabled+active, owner 없음, lock 사용 가능이다.
- 현재 게시 ID는 여전히 `1d112ab0-6f45-4224-8ba3-a5d026427d86`; preflight는 `PC_PUBLICATION_NOT_RECENT`다. 복구 후 공개 API 감사는 798 HTTP 200, 계약 실패 3개다.
- 다음 작업은 exact 관리 GET의 정상 정책 결정 → predecessor 확인 → daily job 단 1회 → 최종 activation 검증 → 새 게시 ID API 감사/preflight → 그 뒤 최신 Runner 재적용 순서다. Worker/UI는 계속 재배포하지 않는다.
- 새 `external-ai-orchestrator` workspace 스킬을 적용한 격리 브라우저 검증은 완료했다. 9개 부품군·modal·G.Skill·16GB×2·저장/reload/delete·mobile overflow는 통과했으나 가격 합계는 stale publication으로 차단됐다. `국내 전체` 선택 상태에서 eBay/USD 가격 summary가 남는 시장 분리 실패와 invalid quantity 0 자동 복구 실패가 추가로 확인됐다. 상세 재현은 06 문서 8절을 본다.
