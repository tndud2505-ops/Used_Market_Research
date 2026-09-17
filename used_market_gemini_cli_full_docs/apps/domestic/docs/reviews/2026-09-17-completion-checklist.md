# Parts/prices release execution checklist — 2026-09-17

## 최종 운영 반영 — 14:39 KST

이 절이 아래의 차단 당시 기록보다 최신이며 최종 판정이다. **릴리스는 운영에 반영됐고 핵심 검증을 통과했다.**

- 원인: 31,149,081바이트 통계 게시를 한 Worker 요청에서 처리해 무료 플랜 CPU 한도를 초과했다. Cloudflare tail의 실제 결과는 `exceededCpu`, 예외는 `Worker exceeded CPU time limit.`이었다.
- 수정: 통계를 최대 40행씩 인증·버전·범위·구성원 추적성·조각 checksum으로 검증해 비활성 staging에 저장하고, 62개 조각의 순서·합계·manifest checksum·실제 D1 행 수를 다시 확인한 뒤 active pointer를 한 번만 교체한다.
- 최종 운영 게시: `1d112ab0-6f45-4224-8ba3-a5d026427d86`, 2,465행, 표본 있는 범위 1,106개, checksum `317d7c4b99db53335d27ab2b7471362b38c3f432534467d12385347db0527df0`. 첫 성공 게시 `b4e10072-2262-4e68-939c-5c2d1e0e57ac` 이후 강화한 행 계약·D1 재조회 checksum 검증까지 같은 데이터로 다시 통과했다.
- 운영 버전: normalization 18 / `pc-parser-v8` / `pc-rules-v18` / `pc-filter-v7`; target set `pc-targets:5:full-master-v13`, 2,441개.
- 최종 Worker: `9ec9ef1d-0beb-465c-b03f-f79e9c02ce3d`. 정식 `cloudflare:release`가 하네스·dry-run·준비 검사·D1 migration·공개 도메인 smoke를 모두 통과했다.
- 최종 운영 확인: D1 active pointer와 공개 가격 API가 모두 `1d112ab0-6f45-4224-8ba3-a5d026427d86`를 반환한다. Runner·Tunnel 재시작 후 로컬/공개 health와 `cloudflare/deploy.mjs --preflight-only`가 통과했다.
- 전체 공개 감사: 798개 도구 노드 HTTP 200, 가격 대상 788개가 모두 v18, 지스킬 5개 표기가 같은 27개 ID, 통계 모순·API 오류 0. 메인보드 탐색 전용 10개는 가격 버전 검사 대상에서 분리했다.
- 실제 브라우저: 35개 모델, 9개 부품군·RAM 2개로 총 10개 수량, 독립 합계, 호환성 충돌 표시, 차트·검색·URL 복원·모바일 표를 확인했다. 브라우저 오류와 실패한 자체 API는 0이다.
- 최종 전체 검증: `scripts/verify.ps1` 통과. 실제 국내 릴리스 표본 수집은 중고나라 44/44, 번개장터 44/44 성공했다. eBay 871개 대상은 이번 제한 표본 수집에서 실행하지 않았으므로 전체 시장 수집 완료로 확대 해석하지 않는다.
- 복구 지점: `/var/lib/used-market-runner/backups/parts-v18-20260917T021100Z/search-index.sqlite`, SHA-256 `b8d20efb18d4e24dff475bc692dee8b81b48392dea894ba80d53e216c147ba98`; 이전 Worker `cc892532-f8de-4810-89ce-20ffe6ed9f92`도 보존했다.
- 남은 품질 범위: 미등록·제외 매물 80개는 추가 검토 후보로 유지한다. 정상 제외나 시장 전체 검증으로 단정하지 않는다.

## Operator and baseline

- Operator: this Chat On Steroids execution; all production mutations are owned by this execution, not delegated to prior chats.
- Handoff read in full (346 lines). Root/application operating and deployment documents read.
- Initial check 10:56 KST: HEAD `612a60fc1e742c9d01182f415becaeda3eebb902`; 29 modified tracked files and additional untracked release files preserved.
- Confirmed existing SSH host by application, database and service identity. Runner and named tunnel are active. No second deployment/reclassification process observed.
- Current target set remains `pc-targets:4:full-master-v12`; publication last success `2026-09-14T13:00:29.118Z`, `publication_recent=false`. Recent collection is not release completion.
- Plan display tool is unavailable because the connector has unattributed chat identity; filesystem execution and this checklist remain authoritative. No mutation has been bypassed.
- `external-ai-orchestrator/SKILL.md` is absent from the existing `.codex`, `.agents`, `.claude`, and `.gemini` skill locations. No external AI account or agent has been invoked.

## Acceptance status

Historical checkpoint status: **BLOCKED; NOT DEPLOYED at that earlier checkpoint**. The final resolution and production result are recorded in the authoritative update above.

| Gate | Status | Evidence / remaining action |
|---|---|---|
| Source and tests | PASS | Existing modifications preserved. Final R3 app `npm test`, root `scripts/verify.ps1`, additional contracts and `git diff --check` passed. |
| Production version | FAIL | Public catalog v4, normalization v17, old target set still live. R3 is not an installed release. |
| G.Skill alias search | FAIL | Ordinary live URLs: G.Skill=27, gskill=0, G SKILL=0, G-SKILL=27, 지스킬=0. Fixed source contracts pass; operational set equality does not. |
| G.Skill price | FAIL | All 27 live API responses inspected; exact publication IDs absent. Three products have contradictory source summaries. No post-release success claimed. |
| RAM quantities | BLOCKED | Source contracts and 30 real stored kit examples pass unit×quantity checks in the corrected staging copy. Public v18 quantity/price verification requires deployment. |
| Component coverage | BLOCKED | All nine categories and 80 real unregistered/excluded examples inspected. 788 price targets and 10 browse-only boards separated. New production collection/publication not executed. |
| Search/statistics/tools linkage | FAIL | Current all-node audit detects contradictory summaries in 136 of 795 old-catalog nodes; no exact active publication/member checksum is exposed. |
| Full publication | FAIL | Previous D1 publication remains active, 2,294 rows at normalization v16 versus Runner v17. New complete publication not prepared or activated on production. |
| Collection and recurring publication | BLOCKED | New Korean targets have zero observed executions in this release. Approved fresh-query collector and regular-publication fixes pass deterministic contracts only. |
| Full quote | BLOCKED | Corrected nine-category/10-unit independent API-to-UI acceptance cannot run against an undeployed v18 release. Current-site diagnostic is separate evidence, not an acceptance pass. |
| UI interactions | BLOCKED | The v18 browser acceptance script has not passed on production. Current-site diagnostic does not substitute for it. |
| Mobile and cache | BLOCKED | Ordinary URLs show the old release; new cache namespace/UI source is not deployed. |
| Recovery and closure | BLOCKED | Code/settings/services/D1/Worker recovery points exist. Fresh stopped-service production DB backup was blocked before execution. No unsafe partial cutover performed. |

## Execution evidence

- Ignored baseline: `tmp/pc-owner-health-20260917-105656.json`.
- Read-only DB/staging comparison: `tmp/pc-release-current-audit-20260917.json`.
- Final R3 tests: `tmp/pc-release-r3-npm-test.log`, `tmp/pc-release-r3-root-verify.log`.
- Full unchanged-production audit, completed 12:06:42 KST: `tmp/pc-resume-full-audit-before.json`. An older before file was preserved, not overwritten without a copy.
- Detailed result and acceptance limitations: `2026-09-17-parts-pricing-release-result.md`.

This document is an execution ledger, not a completion claim.

## Executed corrections and additional evidence

- First app `npm test`: PASS, `tmp/pc-release-npm-test-20260917.log`. First root `scripts/verify.ps1`: PASS, `tmp/pc-release-root-verify-20260917.log`. Final reruns are required after the additional changes below.
- Staging reuse contract now preserves strict equality by default; explicit unchanged-only mode reuses only snapshots AND raw rows equal in every column. Changed originals are deferred, never overwritten. The regression verifies source rows, snapshot rows and foreign keys after catch-up.
- Current production-copy rehearsal started with **199,225** snapshots. **136,125** sealed normalizations were reused, **45,069** changed-source snapshots deferred, and **18,031** later snapshots require normal classification. This is not yet production activation or publication.
- The normal daily publisher now rebuilds the union of current observed scopes and previous published scope identities. No previous prices are carried over, no partial product selector can publish, and the activated full checksum/count/key manifest must match exactly. Complete member checksums are retained and exposed by the read route.
- Collection ticks and the daily publisher now serialize their writes: an in-progress crawl finishes first, then full publication and protected compaction run. The scheduler gate is released even when publication fails.
- Edge PC-read cache namespace advanced to v2; alias audits now compare all 27 canonical IDs, not just totals. Browse-only board facets are counted separately and cannot acquire exact price values.
- Bounded release collection tool validates 27 Korean G.Skill targets, eight other price representatives, and nine broad-market samples: 44 targets per approved domestic source. Its contract makes zero network requests; real request results remain a separate completion gate.
- Exclusive production owner: `parts-v18-20260917T021100Z`, kernel lock `/run/lock/used-pick-parts-release.lock` held by this connected execution. No second deployment operator was observed.

## Recovery points prepared before production changes

- Previous Worker version: `cc892532-f8de-4810-89ce-20ffe6ed9f92` at 100%; captured in `tmp/pc-release-worker-before.json`.
- Previous active D1 publication: `e0175ff5-cb88-42b1-a2a2-789ba3287c8d`, 2,294 rows, checksum `7d3c3723451d271da095ec3a3d57e2f995d1e875ef6eba3efd2272d14a67a3c4`. D1 rows are normalization v16 while current Runner is v17; this is the observed pre-existing inconsistency, not the target state.
- D1 statistics-table SQL export: `tmp/pc-release-d1-backup-20260917.sql`, 240,162,487 bytes, SHA-256 `da3947ecb156612c2b3771ebdd6481ba9a3a4e5bf5e064007c7f9b0ae541cd9f`. Contains historical publications as well as the active one; keep out of Git.
- Protected runtime/services/settings archive: `/var/lib/used-market-runner/backups/parts-v18-20260917T021100Z/runtime-and-settings.tar.gz`, SHA-256 `0de6e11461be70864bd5931a7928445baa5108f2ff49e5a0b6abdf801e00a60e`. Archive contents and credentials have not been printed or committed.
- Live database recovery copy must be taken after the old Runner is drained and stopped. It has **not yet been taken**; the older staging DB is never a production restore image.

## Final R3 validation and the actual blocking boundary

- Current-copy classification rehearsal completed at **11:30:13 KST**. It reused 136,125 previously sealed rows and classified 63,100 deferred/new rows; all 199,225 original snapshots remained unchanged.
- Real stored observations exposed another defect: explicit `32GB (16GB×2)` without the word `KIT` was incorrectly excluded as ambiguous. The classifier now accepts a mathematically consistent declared total, preserves explicit per-module price precedence, and still excludes contradictory/unknown quantities.
- Only the affected **23,694 RAM snapshots** were recomputed. **175,531 non-RAM snapshots** were reused with identical normalization/item SHA-256 `44627a29cf3e88d847073d05c4c9faf9cf18ebc9c5c129c767579b559ff7267e`.
- Corrected stage passed at **12:00:33 KST**: `/var/lib/used-market-runner/staging/parts-v18-20260917/pc-v18-corrected-ram-report.json`. Eight source/test hashes are sealed in that report. The 127 deterministic fixture cases passed all quality gates; these percentages are not a manual-accuracy estimate for every marketplace observation.
- Current-copy comparable RAM identities increased from 1,709 to **2,583**. All 30 inspected eligible G.Skill two-module examples satisfy module price×2=listing total. Original raw observations and snapshot rows remain unchanged.
- The pre-existing 84-group price check predates the RAM correction. It is not treated as a full R3 price publication validation. A new complete same-time publication remains necessary.
- R3 runtime archive: 177 files, 574,314 bytes, SHA-256 `4496ed8f1f58af1d54cecdc96a07e95d558949e691a3586e474b5392cab7a350`; `/tmp/used-pick-parts-v18-20260917-r3.tar.gz` on the server. Extracted source: `/var/lib/used-market-runner/staging/parts-v18-20260917-release-source`.
- Exact connector error: `요청의 보안 상태를 결정하지 못해 이 도구 요청은 OpenAI에 의해 차단되었습니다.` The approved production drain/backup command was not executed. A Worker dry-run request was also rejected by the connector; it is not reported as passed.
- Formal **read-only** deployment readiness was executed using `node cloudflare/deploy.mjs --preflight-only`: exit 2 with `PC_COLLECTION_TARGET_SET_MISMATCH`, per-source target-count mismatches and `PC_PUBLICATION_NOT_RECENT`. No `--app-only`, readiness bypass, alternative privileged channel or partial publication was used.
- Consequently no production database was replaced, no new production normalization/collection/publication was committed, and no Runner/Worker/UI release was installed.

## Closure evidence

- Selected source/test/review commit: `8fcabf5f5f9132bae8dbeee7a6fe61968f2ea8f7` (53 files). No remote push or deployment was represented by this commit.
- At **12:18:23 KST**, Runner health remained HTTP 200 with ledger and scheduling ready; Runner and tunnel were both active. Targets were still v12 and publication remained stale. `tmp/pc-release-closure-state.json` also verifies all eight sealed critical source/test hashes against the committed working tree.
- Exclusive release owner was released; the server confirmed owner-file removal and that the stopped-service production database backup had not executed.
- Current mobile builder was visually inspected and still has clipped model/price content despite no document-level horizontal overflow. Current analysis-page diagnostic timed out and is not counted as a browser pass. See the result document for the exact distinction between old-site baseline evidence and blocked post-deployment verification.
