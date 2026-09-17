# Runner replacement follow-through — 2026-09-17

The user asked whether the site was deployed and whether this assistant could replace the AWS Runner. This execution explicitly resumes the previously blocked Runner deployment. Existing Worker/UI deployment is not repeated.

## Observed and completed

- 16:04 KST: the original SSH connection succeeded, host `ip-172-26-0-85`, user `ubuntu`. Both Runner and Tunnel were active. The initial ordinary-user DB path test returned false because its parent is mode 0750; a separate `sudo -n` check confirmed the actual DB exists. This was not a missing database.
- Existing administrator permission works. Disk free about 53 GiB; no separate publication/collection CLI writer was found, but the regular Runner scheduler was active.
- Current runtime classifier/master/ledger/shadow module hashes match the intended v18 source. Existing DB and v18 publication must be retained.
- Found and fixed a genuine installer defect: `runner.mjs` now imports `market/logic/pc-price-readiness.mjs`, but the installer did not copy it. Required-file, copy and syntax checks were added, together with a deployment regression assertion.
- Full root `scripts/verify.ps1` passed (exit 0), including npm tests. Source commit `4931803ccc7e6579953e4edcb0660147e39cf02e` contains only that installer/test correction, building on `129cc2d`.
- Two package attempts failed BEFORE service stop: an empty archive caused by Git's subdirectory-relative archive behavior, then CRLF conversion when archiving a subtree without root attributes. Both attempts released their owner file; no service stop or database replacement occurred.
- Fixed package generation to run at repository root with `core.autocrlf=false` and `core.eol=lf`, and compare the actual bytes of every runtime archive member with its reviewed Git blob before upload.
- Final package `runner-final-20260917T071416Z.tar.gz`: SHA-256 `d6fdef72d14fad615f65034f92062b95b4ab09e7ebb6f90639f46bfc3b7ccf40`. All 75 runtime files passed local archive verification and server staging verification.

## In progress, not yet reported complete

The approved foreground deployment command holds `/run/lock/used-pick-parts-release.lock` and its own `parts-release-owner.txt`. It is waiting for the EXISTING scheduler tick to become idle, with a bounded timeout. It will not kill an active collector. Last public health at 16:19:18 KST was HTTP 200, `scheduler_active=true`, `last_tick_at=2026-09-17T07:12:14.294Z`.

After an idle check, the command takes a fresh stopped-source SQLite backup, verifies logical counts/publication content and quick_check, invokes the normal `install-ubuntu24.sh`, checks all installed hashes, and compares local/public process instance IDs. On failure after service stop it restores CODE/SETTINGS only and restarts both services; it never restores an old production DB over recent observations.

Optional authenticated publication-scope precheck (`node --env-file ...` and GET only) was rejected by the connector before execution. It was not rerouted with another credential/tool. This optional probe is distinct from the already-approved running deployment. Do not run the prepared authenticated postcheck to bypass that denial; public, unauthenticated health and the deployment's existing consistency checks remain separate evidence.

Evidence: `tmp/runner-replacement-preflight-20260917.json`, `tmp/runner-replacement-root-verify-20260917.log`, `tmp/runner-replacement-package-r3.json`, `tmp/runner-replacement-deploy-r3-20260917.log`. No v19 activation, manual reclassification, collection or price publication is requested by this replacement.

## Closed — 16:34:57 KST

Final status: **ROLLED_BACK_AND_HEALTHY / Runner replacement NOT active**. The normal installer, its local/public health checks and all 75 installed file hashes passed, but a subsequent Python public `/health` recheck returned HTTP 403. The guarded deployment restored the old code/settings and restarted both services; no DB overwrite. All 119 recorded old source hashes, source/observation/normalization counts and published metadata were then rechecked successfully; owner file absent. The 403 was not retried via alternate credentials/client.

The first service-stop attempt had timed out at its 120-second full backup check and also restored the old healthy services. The same backup's full check was completed while production stayed running: PASS at 16:31:28. The resumed attempt kept that validated recovery point and additionally captured/byte-verified the freshest stopped DB/WAL. Detailed timings and separate backup proofs are in `05-runner-replacement-result.md`.

Current issue is the additional public health 403, not lack of SSH/sudo. Earlier Worker/UI deployment remains separate and was not rolled back. Evidence: `tmp/runner-replacement-closure-20260917.json`. No deployment process/owner was left running.
