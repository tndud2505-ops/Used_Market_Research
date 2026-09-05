# Cloudflare Runner 연결

이 디렉터리는 Cloudflare Worker와 AWS Ubuntu 러너를 연결하는 Worker 코드다.

## 역할 분리

- Cloudflare Worker: 화면·사전수집 PC catalog/listing/stats 읽기 API·Cron watchdog·수동 실행 인증·AWS 러너 호출
- AWS Node 러너: source registry에서 `APPROVED + ENABLED`이고 governance 검증을 통과한 사이트만 사전수집·분류·publication 생성
- `POST /api/runner/run`: 허용된 스케줄러 작업 하나 또는 묶음을 실행하는 인증된 Node 엔드포인트
- `POST /api/search`: rollback용 legacy 범용 검색 경로. PC 디렉터리는 호출하지 않음

공개 PC 화면은 검증된 하나의 publication manifest에 속한 projection만 조회한다. 좌측 부품·용량·제조사·모델·사이트 필터, 사이트별 매물 결과, 현재 ACTIVE·RESERVED 평균·중앙값, SOLD 직전 마지막 표시가격 평균·중앙값, 최근 30일 그래프는 모두 같은 `publication_version`/`as_of` 범위를 사용한다. RESERVED·SOLD 표시가격은 실제 체결가가 아니며, 확인된 체결금액은 별도 통계로 표시한다.

다나와 장터·중고나라·번개장터·헬로마켓·리씽크몰·eBay·쿨엔조이는 registry의 운영 승인과 공개 경로 제약을 통과한 사전수집 projection에서만 노출한다. 국내 개인 중고, 업자 중고, 리퍼비시, 해외 중고는 `market_pool`로 분리하며 HTTP 403·captcha가 발생한 소스는 우회하지 않고 backoff·quarantine을 적용한다.

수동 실행도 작업 결과 저장 뒤 알림 dispatch와 reporter 후처리를 실행한다. 후처리 경고가 있으면 전체 응답은 `partial_success`가 되며 `postprocess.warnings`에서 원인을 확인할 수 있다.

사전수집은 Cloudflare Browser Run이 아니라 AWS 러너에서 처리한다. 공개 PC 읽기 API는 요청 중 원 사이트를 호출하지 않는다. 매물과 가격 통계는 AWS SQLite를 먼저 읽고 Worker Cache API에 5분간 응답을 저장한다. D1 매물 fallback은 기본 비활성이며, 작은 일일 가격 통계만 AWS 읽기 실패 때 D1 fallback을 사용할 수 있다. Worker의 `RUNNER_URL`과 legacy `SEARCH_RUNNER_URL`은 Cloudflare Tunnel 공개 URL이어야 하며, 로컬 `localhost`는 사용할 수 없다.

## 로컬 검증

```powershell
npm run cloudflare:harness
npm run test
```

## Node 서버 환경변수

```powershell
$env:CLOUDFLARE_RUNNER_TOKEN = "긴-랜덤-토큰"
npm run web
```

Cloudflare Secret에도 같은 값을 `RUNNER_TOKEN`으로 저장한다.

## Cloudflare 로컬 실행·배포

실제 공개 Node 러너 URL을 환경변수로 넣은 뒤 실행한다. 배포 스크립트가 URL 없이 실행되는 것을 막는다.

```powershell
npm run cloudflare:dev
npx wrangler secret put RUNNER_TOKEN --config cloudflare/wrangler.jsonc
npx wrangler secret put MANUAL_RUN_TOKEN --config cloudflare/wrangler.jsonc
$env:CLOUDFLARE_RUNNER_URL = "https://<public-node-runner>/api/runner/run"
$env:CLOUDFLARE_SEARCH_RUNNER_URL = "https://<public-node-runner>/api/search"
$env:CLOUDFLARE_FREE_TIER_MODE = "false"
npm run cloudflare:deploy
```

Named Tunnel DNS가 전파된 뒤에는 다음 프로필로 운영 주소를 자동으로 넣어 배포할 수 있다.

```powershell
$env:CLOUDFLARE_TUNNEL_MODE = "named"
$env:CLOUDFLARE_FREE_TIER_MODE = "false"
npm run cloudflare:deploy
```

이 프로필은 `https://runner.used-pick.com`을 러너·검색·원본 주소로 사용한다. DNS가 아직 없으면 배포하지 말고 먼저 아래 CNAME을 추가한다.

Cron 표현식은 Cloudflare 기준 UTC다. 수집은 AWS 러너에서 처리되며, 연속 D1 매물 mirror와 D1 매물 fallback은 기본적으로 끈다. D1 매물 fallback을 운영자가 명시적으로 켜도 완전한 collection manifest가 있고 2시간 이내일 때만 허용한다. 작은 일일 가격 통계 publication은 fallback용으로 계속 사용할 수 있다. `FREE_TIER_MODE=false`이고 Worker에는 Browser/Queue 바인딩을 배포하지 않는다.

## 수동 실행

```powershell
$headers = @{ Authorization = "Bearer $env:MANUAL_RUN_TOKEN"; "Content-Type" = "application/json" }
$body = @{ job_name = "gpu-fast-scan" } | ConvertTo-Json
Invoke-RestMethod -Uri "https://<worker-subdomain>.workers.dev/run" -Method Post -Headers $headers -Body $body
```

운영 전제: 공개 Node 러너의 HTTPS, 토큰 보관, 중복 실행 방지, 사이트 약관·접근 제한 준수 여부를 확인한다.

## AWS runner deployment profile

The active Worker/AWS profile:

- Static assets are served by the Worker Assets binding.
- `/api/pc/listings` and product price stats read precollected AWS SQLite projections first and use the Worker Cache API for repeated reads.
- `/api/pc/catalog` and `/api/pc/products` remain precollected/static directory reads.
- `/api/search` remains a legacy rollback path through Cloudflare Tunnel; the PC directory does not call it.
- Cron and manual jobs call the authenticated AWS `/api/runner/run` endpoint.
- D1 listing mirror and listing fallback are disabled by default. An explicit listing fallback accepts only a fresh complete snapshot; compact daily price stats remain available for AWS failure fallback.
- Browser Run and Queue are intentionally not deployed for this profile.
- Public GET responses and search POST bodies are cached to avoid duplicate origin/browser work.
- The legacy Node/CDP bridge is used only when the free-tier bindings are not present.

Resources created for this profile:

- D1 database: `used-market-free`
- Worker: `used-market-runner`

Validate and deploy:

```powershell
npm run cloudflare:harness
npx wrangler deploy --config cloudflare/wrangler.jsonc --dry-run
npx wrangler deploy --config cloudflare/wrangler.jsonc --keep-vars
```

Recommended one-command release:

```powershell
npm run cloudflare:release
```

The release command runs the harness and dry-run first, deploys the Worker with
the `used-pick.com` and `www.used-pick.com` custom domains, then checks the
public health endpoint, homepage, and category API on both domains. Set
`CLOUDFLARE_PUBLIC_URL` only when verifying a different production hostname.

The AWS profile intentionally keeps the collection boundary outside Cloudflare. Keep the Tunnel token, Worker `RUNNER_TOKEN`, and optional D1 import token out of Git.

If the runner reports a D1 import error for a missing projection column, apply
the checked-in migrations as an explicit operator recovery step before waiting
for the runner to produce a fresh publication:

```powershell
npm run cloudflare:migrate:remote
```

This command changes the remote D1 schema and is intentionally separate from
the normal release command. After the runner completes fresh source
collections and publication, run `npm run cloudflare:release`.

### Legacy live-search result budget

This section applies only to the rollback `/api/search` path, not the public PC directory. The search path starts with a bounded 160-candidate window per selected market.
When a user reaches the stored boundary, the selected market can deepen in
160-item steps up to 640 candidates; one combined SQLite snapshot keeps at most
1,000 listings. The browser renders 30-item pages and prefetches the first three
pages of a focused site view. Opening a loaded page is local, while the next
reachable page reads one more cursor slice from the same server snapshot. It
does not rerun or reshuffle the upstream search.
The runner executes at most four uncached
searches at once and queues sixteen more; an overloaded request receives
HTTP 429 with `Retry-After: 2`. Source work is also bounded, which protects a
small instance when several different searches arrive together. A queued
request waits at most 3 seconds, and a cursor is retained for 5 minutes by
default; an expired cursor returns HTTP 410 so it cannot page into a new
search window. The recommended AWS plan for this project is 4 GB RAM. A 2 GB
instance is only a constrained minimum for a runner-only machine; if other
applications share the machine, keep the 4 GB plan.

Price bounds are sent to the upstream marketplace when a confirmed parameter
exists (Joonggonara and Hello Market). Approved legacy sources without a
verified upstream price-range contract are searched in a bounded
price-ordered/page-limited window and filtered again locally. `REVIEW_REQUIRED`
sources such as Bunjang are not called. Every source is checked
again before merge, so a listing outside the requested range is never exposed.

The user-facing sort modes are `recommended`, `price_asc`, `price_desc`, and
`recent`. Sort and price-bound changes reset the cursor and read page 1 from the
same SQLite snapshot; they do not trigger a new marketplace collection.
`price_asc` and `price_desc` are disabled in the all-site view when KRW and USD
results are mixed without an exchange-rate contract. See
`docs/wiki/02-search-verification.md` and `docs/wiki/08-cache-search-ux.md` for
the verified source and cache policies.

## Named Tunnel public hostname

The production named Tunnel is already running on AWS with the public hostname
route `runner.used-pick.com`. If the hostname does not resolve, add this DNS
record in the `used-pick.com` zone:

```text
Type: CNAME
Name: runner
Target: d039956d-422c-41cd-ab4b-ce19d870b9fb.cfargotunnel.com
Proxy status: Proxied
```

After DNS propagation, set `CLOUDFLARE_RUNNER_URL`,
`CLOUDFLARE_SEARCH_RUNNER_URL`, and `CLOUDFLARE_ORIGIN_URL` to the
`https://runner.used-pick.com` endpoints, deploy the Worker, verify `/health`
and `/api/search`, then stop the temporary `trycloudflare.com` process.
