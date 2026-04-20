# Phase 4: Scheduler Wiring - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-20
**Phase:** 04-scheduler-wiring
**Areas discussed:** Dev-mode gating, Clock injection / testability, Tick error isolation, app_meta initialization

---

## Dev-mode gating

| Option | Description | Selected |
|--------|-------------|----------|
| Env var only (ENABLE_SCHEDULER=true) | Uniform across all environments; no env-detection logic | |
| Auto-on in prod, opt-in in dev | Production always-on; dev requires ENABLE_SCHEDULER=true; demo mode also suppresses | ✓ |
| Auto-on unless demoMode | demoMode flag alone controls it; no separate env var | |

**User's choice:** Auto-on in prod, opt-in in dev
**Notes:** Matches the existing `demoMode` pattern in Config without adding complexity to production.

---

## Clock injection / testability

| Option | Description | Selected |
|--------|-------------|----------|
| Injectable nowFn (Recommended) | scheduler.ts accepts opts.nowFn for frozen-time unit tests | ✓ |
| Inline Date.now(), test pure logic only | No injection; scheduler.test.ts only tests the pure helper function | |

**User's choice:** Injectable nowFn
**Notes:** Enables direct unit coverage of catch-up (<15 min vs ≥15 min), 03:00 trigger detection, and fire-due detection without wall-clock waits.

---

## Tick error isolation

| Option | Description | Selected |
|--------|-------------|----------|
| Swallow + log, tick continues (Recommended) | Per-fire try/catch; tick loop survives individual send failures | ✓ |
| Per-tick catch only | One catch around entire tick body; bad send blocks remaining fires in same tick | |
| Let it propagate | No catch; uncaught error may crash process | |

**User's choice:** Swallow + log, tick continues
**Notes:** Consistent with Phase 3 D-01 (no retries — next slot is the natural retry). Persistent failures caught by Phase 6 stall notifications.

---

## app_meta initialization

| Option | Description | Selected |
|--------|-------------|----------|
| Write defaults immediately (Recommended) | initializeAppMeta(db) at startup via INSERT OR IGNORE | ✓ |
| Wait for first recompute | Keys only exist after 03:00 UTC first run | |

**User's choice:** Write defaults immediately
**Notes:** User asked for plain-language explanation of what app_meta keys are before deciding. Decision: ensures Phase 5 dashboard never shows blank state on first boot.

---

## Claude's Discretion

- Exact module structure of `scheduler.ts`
- Whether `initializeAppMeta` lives in `scheduler.ts` or `db.ts`
- Catch-up implementation detail (most-recent-missed-fire comparison logic)
- How 03:00 UTC recompute trigger is detected per tick

## Deferred Ideas

None raised during discussion.
