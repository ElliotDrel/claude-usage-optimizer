# Phase 6: VM Deployment & Hardening - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-22
**Phase:** 06-vm-deployment-hardening
**Areas discussed:** Backup mechanism, Notification trigger, Notification provider, HOSTING-STRATEGY.md scope

---

## Backup Mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| In-process Node.js | Scheduler handles it like the 03:00 UTC recompute — registered in instrumentation.ts. Keeps single-process constraint clean. | ✓ |
| Systemd timer | Separate .timer + .service unit at 04:15 UTC. More visible in journalctl but breaks the "one unit" constraint. | |

**User's choice:** In-process Node.js (Recommended)
**Notes:** Single-process constraint is the deciding factor.

---

## Notification Trigger

| Option | Description | Selected |
|--------|-------------|----------|
| Any single send failure | Since there are no retries (design spec §10), each failure IS exhaustion. Alert on status='error' or status='timeout'. | ✓ |
| N consecutive failures | Only alert after 3+ sends in a row fail. Requires a failure streak counter in app_meta. | |
| Stall only, no per-send alerts | Skip individual failure alerts; only notify on scheduler stall (>5 min). | |

**User's choice:** Any single send failure (Recommended)
**Notes:** Resolves the NOTIFY-01 "retry exhaustion" language — since there are no retries, the trigger is any failure.

---

## Notification Provider

| Option | Description | Selected |
|--------|-------------|----------|
| ntfy.sh | No account needed, public server. User configures topic name in app_meta. | |
| Discord webhook | User pastes webhook URL from their Discord server into app_meta. | ✓ |
| Either, user picks | App supports both; user sets provider key + URL in app_meta. | |

**User's choice:** Discord webhook

---

## HOSTING-STRATEGY.md Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Full rewrite | Replace whole doc with single-service reality. Old content in git history. | ✓ |
| Targeted patch | Only update §6.3.6–3.7 to remove Python steps. | |
| Archive + new doc | Keep old as historical, write new DEPLOYMENT.md. | |

**User's choice:** Full rewrite of existing file
**Notes:** User stated: "keep the doc but do a full rewrite. the goal is it should be as seamless for the user to use this as possible." Non-technical-user UX is the bar.

---

## Claude's Discretion

- Exact GCS upload approach (Node.js SDK vs. gsutil subprocess)
- Whether `app_meta.last_tick_at` is new or reuses existing key
- Discord embed field names and message text
- Whether backup uses `better-sqlite3` `.backup()` or spawns `sqlite3` CLI
