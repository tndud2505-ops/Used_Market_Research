# CLI, platform, and browser routes

Use this reference after the current roster/quota selection in [runtime-and-routing.md](runtime-and-routing.md). Choose one route per delegated subtask and keep permissions narrow.

## Route distinctions

### Ordinary platform subagent

Use the platform's built-in subagent/multi-agent path when it is already available and sufficient for an independent task. Keep the same prompt contract, read-only default, explicit workspace ownership, and primary-agent verification. This route is distinct from the local roster and does not justify editing provider configuration.

### Direct OpenCodex/Codex CLI through the roster

For an `opencodex` agent, invoke the roster's `run` action with the resolved agent ID, prompt, absolute workspace, and `-Mode inspect` or `-Mode write`. The script translates `inspect` to `codex exec ... -s read-only --ephemeral -C <workspace>` and `write` to `workspace-write`. It verifies the agent/account are enabled and the workspace resolves, then adds a guard against unrelated publication, deployment, deletion, and credential access.

Do not bypass the roster to select an unverified account or model. A missing `codex` command is a direct-runner failure; report it as such and use the safe fallback if available.

### WorkBuddy/CodeBuddy through the roster

For a `codebuddy` agent, invoke the same roster `run` action. Inspect mode passes only `Read,Glob,Grep`; write mode passes `Read,Glob,Grep,Edit,Write,Bash`. The script locates an installed CodeBuddy executable or its supported bundled entry point and disables session persistence for the run.

Important current limitation: WorkBuddy roster `inspect` mode does not include Bash or Playwright, so it cannot provide browser execution through that route. Do not claim that a WorkBuddy inspect result includes a live browser check. If browser verification is required, use a purpose-built browser tool or a separate per-run direct Playwright/browser route with the needed ephemeral capability; otherwise report the exact blocker.

## Prompt contract

Every delegated prompt must state:

- the exact question or deliverable and what counts as done;
- the absolute workspace and owned files/paths; no unrelated edits;
- allowed external domains or local URLs, if browsing is needed;
- permitted interactions and an explicit read-only boundary unless write is authorized;
- forbidden actions: sign-in, CAPTCHA solving, posting, messaging, uploads, purchases, publication, deployment, credential/profile access, or destructive changes unless the user explicitly authorized the specific action;
- required evidence and format: changed paths/diff summary, commands and results, URLs, screenshots saved outside the repository, extracted facts, and console/network errors as relevant.

Keep prompts self-contained. Do not pass secrets or ask a supporting agent to discover credentials. Do not make a write-mode assignment overlap another agent's writable paths.

## Real browser verification

Use browser work for official product/source verification, user-owned site inspection, search-result classification, and rendered desktop/mobile UI flows. Prefer an available purpose-built browser connector/tool. If it is unavailable, use the repository/runtime Playwright CLI path only after confirming Node.js, npm, and `npx` are available; grant capability per run and ephemerally. Browser access must be read-only unless the current user request explicitly authorizes a state-changing action.

For each browser run, record the tested URL, viewport, exact flow, observed labels/result counts/enabled actions/navigation, relevant console or network errors, and screenshots outside the repository unless an existing ignored-artifact convention explicitly applies. Snapshot before using element references and again after navigation or major DOM changes; stale references require a fresh snapshot.

For official-source verification, restrict to the official vendor/source domain named by the task and return the exact product/model name and page URL, observed variant tokens (for example `M/I`, `D4/D5`, `WIFI`, `II/V2`, `ICE`), and whether the page proves the exact product, a sibling variant, or only a family/category. Report access failure or ambiguity instead of guessing.

Do not sign in, solve CAPTCHAs, purchase, post, message, upload, deploy, or trigger live collection as incidental verification. Do not download remote media merely to work around preview restrictions.

## Browser failure-layer diagnosis

Separate the failing layer before choosing a fallback:

1. provider login, quota, or direct-run availability;
2. browser/MCP/Playwright permission or missing executable;
3. local server reachability;
4. DNS/TLS or site authentication;
5. robots/rate limit;
6. page behavior or application logic.

Try one safe in-scope fallback, such as a direct provider execution or Playwright CLI when the purpose-built browser is unavailable. Do not change global login, proxy, browser, MCP, approval, allowlist, or routing settings to force access. If the same blocker remains, report the exact layer, attempted fallback, and missing evidence; never describe a nested-agent permission failure as proof that the website itself is inaccessible.
