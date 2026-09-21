---
name: external-ai-orchestrator
description: Route substantial, separable work to external AI supporting agents using fresh roster, login, quota, and execution-route data. Use for provider selection, scoped delegation, browser verification, or external-agent orchestration; not for ordinary single-agent work.
---

# External AI Orchestrator

Use this skill when a task materially benefits from an external supporting agent: independent investigation, repository implementation, repetitive inspection, rendered UI/browser verification, or a second review. Keep tightly coupled or ordinary work with the primary agent.

## Minimal routing workflow

1. Inspect the current roster and runner availability. Read [runtime-and-routing.md](references/runtime-and-routing.md) for authoritative locations, freshness, quota selection, and roster maintenance.
2. Select a currently enabled account/agent whose fresh remaining quota and provider fit the subtask. Never rely on IDs, login state, or quota values copied from an earlier run; IDs can change.
3. Choose the route in [cli-browser-routes.md](references/cli-browser-routes.md): ordinary platform subagent, direct OpenCodex/Codex CLI, or WorkBuddy/CodeBuddy. Use inspect/read-only by default; use write only for explicitly owned, disjoint paths.
4. Give the supporting agent a self-contained prompt with the exact outcome, workspace, allowed domains or local URLs, permitted interactions, forbidden mutations, and required evidence. The primary agent reviews the actual diff, URLs, screenshots, and claims, then runs the important verification itself.

## Invariants

- Preserve user authority. Reading and analysis are the default. Browser state changes, messages, uploads, purchases, publication, deployment, credential use, and other external mutations require explicit authorization in the current task.
- Treat roster metadata as routing data, never as a place to store or reveal credentials. Do not print account secrets, tokens, browser profiles, or volatile quota snapshots into this skill or a repository.
- Keep delegated work inside the assigned workspace and scope. Do not alter global login, proxy, browser, MCP, approval, provider, or routing configuration to force access.
- Use the current usage source before dispatch. If the selected provider is unavailable or insufficient, follow the documented fallback and report the exact blocker; do not silently claim that a site or provider failed when only a nested route failed.
- Do not publish, deploy, delete unrelated files, or make irreversible changes as an incidental delegation step.

For detailed roster operations, freshness, backups, recovery, and reporting, read [runtime-and-routing.md](references/runtime-and-routing.md). For execution routes, prompt contracts, browser evidence, official-source checks, and failure-layer diagnosis, read [cli-browser-routes.md](references/cli-browser-routes.md).
