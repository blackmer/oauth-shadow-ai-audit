# OAuth & Shadow AI Control Audit Dashboard — Agent Instructions

Per-repo binding for any agent working here. Model-agnostic: the roles are **Builder**
and **Reviewer**, never specific models. Full reasoning lives in
`~/repos/agent-context/agent-collaboration-protocol.md`; this file is the short,
enforceable surface that travels with the repo.

## What this repo is

A browser-based dashboard that audits OAuth application and service-principal access in
Google Workspace and Microsoft 365 / Entra ID tenants. The user loads CSV/JSON exports
from their admin consoles; the dashboard returns findings ranked by an inspectable scope
risk taxonomy. **All processing is client-side — no backend, no data transmission, no
persistence, no telemetry.** This is a design invariant, not an implementation detail.

> **This repo is public-facing.** It carries a LICENSE, invites issues and PRs, and has
> been shared with reviewers. Hold a higher bar than for an internal repo.

Layout: `index.html`, `src/`, `lib/`, `styles/`, `taxonomy/`, `iocs/`, `docs/`.
Status and history: `README.md`, `CHANGELOG.md`.

## Collaboration protocol

- Agents coordinate through **repo-local artifacts, not chat**: `TASK.md` (intent —
  Marc owns), `REVIEW.md` (Reviewer's findings — sole writer), and `git diff` + commit
  messages (the implementation record). No standing `IMPLEMENTATION.md`.
- **Builder** implements; **Reviewer** reviews the diff against `TASK.md` and writes
  findings grouped Blocking / Should Fix / Consider / Resolved. The Builder fixes in
  code with resolutions in commit messages, and never edits `REVIEW.md`.
- **Single writer per file.** On conflict, the authoritative writer wins and the
  discrepancy is surfaced, never silently reconciled.

## Run it

Static site, no build step. Serve the folder locally and open in a browser:

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

## Scope & constraints (public repo — higher bar)

- **No secrets, no client or tenant data.** Never commit real tenant exports, account
  IDs, tenant IDs, or infrastructure identifiers. Use synthetic fixtures only. The
  pre-commit hook is the backstop, not the policy.
- **Preserve the client-side invariant:** no backend calls, no telemetry, no
  persistence. Any change that would send data anywhere is out of scope.
- **Internal taxonomy stays internal** (rabbits, elephants, Class A/B/C) — it never
  appears in public output, comments, or commit messages.
- Pull `agent-context` at session start; push at session end. Multi-step unfinished work
  goes on a feature branch; small finished changes commit straight to main.
