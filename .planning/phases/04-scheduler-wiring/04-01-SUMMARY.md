---
phase: 04-scheduler-wiring
plan: 01
subsystem: scheduler
completed: "2026-04-20T20:39:06Z"
duration_minutes: 11
tags: [scheduler, app_meta, sqlite, tick-loop, clock-injection, tdd]

dependency_graph:
  requires:
    - "03-03: send() function and send_log schema"
    - "02-01: peakDetector() pure function"
    - "02-02: generateSchedule() pure function"
    - "01-xx: getDb(), querySnapshots(), parseSnapshots(), getConfig()"
  provides:
    - "startScheduler(db, opts?) named export — 60s tick loop with stop()"
    - "initializeAppMeta — all 10 app_meta keys seeded on startup"
    - "catch-up logic — fires missed sends within 15-minute restart window"
    - "nightly recompute detection — 03:00 UTC gate with shouldRecomputeSchedule"
  affects:
    - "04-02: instrumentation.ts scheduler registration reads startScheduler"
    - "05-xx: dashboard reads app_meta keys seeded by initializeAppMeta"

tech_stack:
  added: []
  patterns:
    - "Clock injection via opts?.nowFn — all time comparisons use injected nowFn, never bare new Date()"
    - "Fire-and-forget async catch-up: void catchUpOnStartup(...)"
    - "Per-fire try/catch in tick loop — D-03 error isolation"
    - "Intl.DateTimeFormat probe-and-correct for DST-aware local→UTC conversion"
    - "INSERT OR IGNORE (ON CONFLICT DO NOTHING) for idempotent app_meta defaults"

key_files:
  created:
    - src/lib/scheduler.ts
    - test/scheduler.test.ts
  modified: []

decisions:
  - "sendTimeoutMs added to opts bag (beyond plan spec) to make catch-up tests fast without real claude CLI waits"
  - "schedule_fires stored as {timestamp, isAnchor}[] not just string[] — preserves anchor identity across restarts"
  - "initializeAppMeta kept private in scheduler.ts (not exported from db.ts) — scheduler-specific concern"
  - "Jitter applied via totalMinutes arithmetic to handle hour boundary overflow correctly"

metrics:
  tasks_completed: 1
  tasks_total: 1
  files_created: 2
  files_modified: 0
  test_count: 7
  test_pass: 7
  tdd_gates: [RED, GREEN, REFACTOR]
---

# Phase 4 Plan 01: Scheduler Core Summary

In-process 60-second tick loop wired from peak-detector + schedule + sender into a durable SQLite-backed scheduler that survives process restarts.

## What Was Built

`src/lib/scheduler.ts` — single named export `startScheduler(db, opts?)` returning `{ stop }`.

### Key behaviors implemented

- **`initializeAppMeta(db)`** — writes all 10 DATA-04 app_meta keys with `ON CONFLICT(key) DO NOTHING` on every startup, ensuring Phase 5 dashboard never sees blank state
- **`catchUpOnStartup`** — on restart, reads `schedule_fires`, fires any entry whose timestamp is <= now AND > (now - 15 min), appends to `schedule_fires_done`, persists; entries >= 15 min old are silently skipped (SCHED-10)
- **`shouldRecomputeSchedule`** — returns true when UTC hour >= 3 AND `schedule_generated_at` date < today UTC (SCHED-01)
- **`runTick`** — three-step 60s tick: (1) pause check reads `app_meta.paused`, returns early if true (SCHED-12); (2) conditional nightly recompute via `querySnapshots` → `parseSnapshots` → `peakDetector` → `generateSchedule` → `fireTimeToUtcIso` → writes 4 app_meta keys; (3) fire execution with per-fire try/catch (SCHED-11, D-03)
- **`fireTimeToUtcIso`** — DST-aware local→UTC conversion using `Intl.DateTimeFormat` probe-and-correct approach; invalid timezone falls back to `America/Los_Angeles` (T-04-03)
- **Clock injection (D-02)** — `nowFn` threaded through all time comparisons; `new Date()` only used as the default assignment
- **Tick error isolation (T-04-04)** — `setInterval` callback wraps `runTick` in `.catch()` so unhandled errors never silently kill the interval
- **JSON parse guards (T-04-01)** — `parseFiresJson` and `parseDoneJson` wrap `JSON.parse` in try/catch, default to `[]` on corrupt input

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed broken jitter minute overflow in FireTime-to-UTC conversion**
- **Found during:** REFACTOR phase — code review of `runTick` recompute block
- **Issue:** Original expression `ft.hour + Math.floor((ft.minute + ft.jitterMinutes) / 60 === 0 ? 0 : 0)` always evaluated to `ft.hour + 0` due to the dead ternary. Jitter minutes that pushed past 60 would create an invalid minute value (e.g. minute=63).
- **Fix:** Replaced with `totalMinutes = ft.hour*60 + ft.minute + ft.jitterMinutes; jitteredHour = floor(totalMinutes/60) % 24; jitteredMinute = totalMinutes % 60`
- **Files modified:** `src/lib/scheduler.ts`
- **Commit:** `5d932a0`

**2. [Rule 2 - Missing critical functionality] Added `sendTimeoutMs` to opts bag**
- **Found during:** GREEN phase — catch-up test required a 50ms timeout to complete within test budget (default 60s timeout would block 60s per test run)
- **Issue:** No way to inject a short send timeout for tests; plan spec only listed `nowFn` in opts
- **Fix:** Added `sendTimeoutMs?: number` to `startScheduler` opts, threaded through to `catchUpOnStartup` and `runTick`
- **Files modified:** `src/lib/scheduler.ts`, `test/scheduler.test.ts`
- **Commit:** `af16b47`

**3. [Rule 2 - Missing critical functionality] Isolated test databases via direct `better-sqlite3` instantiation**
- **Found during:** GREEN phase — `getDb()` singleton caused all tests after the first to receive a closed db handle
- **Issue:** `getDb()` caches the first opened connection; subsequent calls with different config paths still return the first (possibly closed) handle
- **Fix:** Tests use `new Database(path)` directly (bypassing singleton), with inline schema setup and per-test cleanup. Catch-up tests verify `schedule_fires_done` (written to the isolated db) rather than `send_log` (written via the getDb singleton)
- **Files modified:** `test/scheduler.test.ts`
- **Commit:** `af16b47`

## TDD Gate Compliance

| Gate | Commit | Status |
|------|--------|--------|
| RED (failing tests) | `f5822db` | Confirmed — `Cannot find module '../src/lib/scheduler'` |
| GREEN (all pass) | `af16b47` | Confirmed — 7/7 pass |
| REFACTOR (clean up) | `5d932a0` | Confirmed — 7/7 still pass after fix |

## Known Stubs

None. All behaviors are fully wired. The recompute path produces real schedule data from historical snapshots; the fire path calls the real `send()` function.

## Threat Flags

No new threat surface beyond what the plan's threat model covered. All four threats mitigated:

| Threat | Mitigation | Location |
|--------|-----------|----------|
| T-04-01: Corrupt `schedule_fires` JSON | `parseFiresJson` try/catch defaults to `[]` | `scheduler.ts:68-81` |
| T-04-02: DoS via catch-up loop | Bounded to `schedule_fires` array (max 5 items) | accepted |
| T-04-03: Invalid timezone string | `Intl.DateTimeFormat` construction wrapped in try/catch, fallback to `America/Los_Angeles` | `scheduler.ts:145-155` |
| T-04-04: `runTick` error kills interval | `setInterval` callback wraps `runTick` in `.catch()` | `scheduler.ts:418` |

## Self-Check

Files created:
- `src/lib/scheduler.ts` — exists
- `test/scheduler.test.ts` — exists

Commits:
- `f5822db` — test(04-01): RED phase
- `af16b47` — feat(04-01): GREEN phase
- `5d932a0` — refactor(04-01): jitter fix

## Self-Check: PASSED
