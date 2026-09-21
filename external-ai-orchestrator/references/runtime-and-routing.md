# Runtime and routing

Read this reference before selecting an external agent or changing roster metadata. It is intentionally about routing and authority, not provider credentials.

## Authoritative runtime data

- Roster: `%USERPROFILE%\.codex\agent-runtime\agents.json`.
- Roster command: `%USERPROFILE%\.codex\agent-runtime\agent-roster.ps1`.
- Devin and Google Antigravity per-model remaining amounts and reset windows: the desktop `AI 사용량` shortcut at `C:\Users\tndud\OneDrive\Desktop\AI 사용량.lnk`, which opens `http://127.0.0.1:10101/`. Use the panel as the primary quota source; use the roster/status route as a fallback or login check.
- WorkBuddy/CodeBuddy credits: use the configured roster/provider status and the current provider output. A roster `usage-set` value is a manual snapshot, not proof of live quota.

Treat `agents.json` as routing metadata. Do not copy account secrets, tokens, browser profiles, or volatile quota amounts into a skill, repository, prompt, or report. Current agent IDs are examples only and can change; resolve them from `list` for every dispatch.

## Freshness and selection

Make one fresh selection pass before dispatch:

1. Read the non-secret roster projection and run `status` to confirm the roster timestamp, OpenCodex availability, and CodeBuddy availability.
2. Check the relevant provider's current login and remaining quota/reset window. Exclude disabled, logged-out, exhausted, or clearly insufficient accounts. Do not repeatedly refresh unchanged quota during one short task.
3. Match the model to the independent subtask: Gemini Flash for broad inspection/comparison/verification, SWE-oriented Devin for repository debugging or implementation, Terra for balanced implementation/tests, Claude Fable for careful reasoning/review, Antigravity Opus for the hardest independent analysis, and WorkBuddy Deepseek for fast inspection/drafting/office work while credits are available.
4. Prefer a provider with enough capacity for the whole assigned scope. If no preferred Devin or Antigravity route has enough capacity or direct execution is unavailable, use `gpt-5.6-luna` with maximum reasoning as the first fallback when that route is available. Never select an Astra model unless the user explicitly requests Astra in the current task.
5. Record the provider/model actually used, why it fit, any substitution, and any exact blocker in the final report. Never expose account identifiers beyond what is needed to identify the selected agent, and never expose secrets.

The primary agent owns integration decisions and independently verifies important findings. A supporting agent's summary is a lead, not final proof.

## Supported roster commands

These are the only actions implemented by `agent-roster.ps1`:

```powershell
$rosterScript = Join-Path $env:USERPROFILE '.codex\agent-runtime\agent-roster.ps1'
& $rosterScript list
& $rosterScript status
& $rosterScript enable -Id <agent-or-account-id>
& $rosterScript disable -Id <agent-or-account-id>
& $rosterScript add -Id <new-agent-id> -Runner <opencodex|codebuddy> -Model <model> -AccountId <account-id> [-Provider <provider>] [-DisplayName <name>] [-AccountLabel <label>] [-Roles <role1>,<role2>]
& $rosterScript remove -Id <agent-or-account-id>
& $rosterScript usage-set -Id <account-id> [-BaseRemaining <n>] [-BaseTotal <n>] [-BonusRemaining <n>] [-BonusTotal <n>] [-ExpiresAt <timestamp>]
& $rosterScript run -Id <agent-id> -Prompt '<self-contained prompt>' -Workspace '<absolute workspace>' -Mode <inspect|write>
```

Use `list` to resolve `<agent-id>` and `<account-id>`; do not guess or persist current IDs. `run` requires an enabled agent, an enabled linked account, a resolvable workspace, and a prompt. Its default mode is `inspect`; `write` grants a writable execution sandbox and must be limited to paths explicitly assigned by the primary agent.

`add` requires `-Id`, `-Runner`, `-Model`, and `-AccountId`; optional provider/labels/roles are metadata. `enable` and `disable` accept either agent or account IDs. `remove` removes an agent by ID, or removes an account only when no agents remain linked to it. `usage-set` requires an account ID, updates only supplied fields, and stamps `observedAt`; it does not fetch provider usage.

Do not invent extra actions or flags. In PowerShell, use an array for multi-valued `-Roles` when needed (for example, `-Roles @('inspection','verification')`) rather than copying a display-table string.

## Backup, recovery, and safe updates

For mutating roster actions, the script writes a temporary sibling file, copies the current roster to `agents.json.bak`, then replaces `agents.json`; it also refreshes the roster's `updatedAt`. The backup is a recovery artifact, not a live quota source. A failed or interrupted update may leave `.tmp` or `.bak`; do not delete either incidentally.

Before `add`, `remove`, `enable`, `disable`, or `usage-set`, confirm the exact roster path and target ID from a non-secret projection, check that the mutation is authorized, and avoid concurrent roster writes. Afterward, run `list`/`status` and inspect the changed fields without printing secrets. If recovery is necessary, stop further writes, preserve the current roster, verify that the `.bak` belongs to this roster, and ask for/confirm authorization before restoring it through an explicit, recoverable file operation. The roster script has no restore action; do not pretend that `restore` or another unsupported subcommand exists.

Never edit provider login, proxy, service catalog, MCP, browser, approval, or global routing settings as a workaround. If status, quota, or a runner cannot be obtained, report the failing layer and use one safe documented fallback only.

## Final reporting

Report concisely:

- provider/model and route actually used, with the selection reason;
- inspect versus write mode and the scoped workspace/path;
- evidence produced (changed paths, tests, URLs, screenshots, extracted facts, or console/network observations);
- substitutions, stale/ambiguous quota, or exact failure layer and fallback attempted;
- any user action still required.

Do not report account secrets, tokens, full volatile quota payloads, or claims not independently checked by the primary agent.
