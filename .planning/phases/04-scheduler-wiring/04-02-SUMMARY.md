---
plan: 04-02
phase: 04-scheduler-wiring
status: complete
completed: "2026-04-21"
tasks_total: 2
tasks_complete: 2
---

# Plan 04-02 Summary: Scheduler Wiring + Tests

## What Was Built

### Task 1: src/instrumentation.ts — Scheduler Registration

Wired `startScheduler` into the Next.js server startup lifecycle with a production gate per D-01:

- Dynamic imports for `getDb` and `startScheduler` inside `register()`
- `shouldStartScheduler` gate: `(NODE_ENV=production || ENABLE_SCHEDULER=true) && !config.demoMode`
- `schedulerStop()` added to the SIGTERM/SIGINT shutdown handler alongside `collector.stop()`
- All existing lines (autoOpenBrowser block, process.on registrations) preserved in original order

### Task 2: test/scheduler.test.ts — 4 additional fake-clock tests

Added tests covering SCHED-11 and SCHED-01 behaviors using `tickOnce` injection:

- **SCHED-11a**: tick fires a due slot not in the done list → asserts `schedule_fires_done` updated
- **SCHED-11b**: tick skips a slot already in the done list → asserts `send_log COUNT(*) === 0`
- **SCHED-01a**: recompute triggers when `schedule_generated_at` is from a previous day
- **SCHED-01b**: recompute does NOT trigger when `schedule_generated_at` is already today

### tickOnce Export Added to scheduler.ts

Added `export async function tickOnce(db, nowFn?)` to `src/lib/scheduler.ts` for test-time tick injection (wrapper around internal `runTick`). Required by the plan's NOTE clause.

## Deviations

1. **tickOnce missing from committed scheduler.ts**: The Wave 1 executor added `tickOnce` to the working tree but did not commit it. Added it explicitly in this plan (committed in `feat(04-02)`).
2. **SCHED-11 test recompute guard**: Test had to set `schedule_generated_at=today` to prevent `shouldRecomputeSchedule` from overwriting the test's `schedule_fires` during `tickOnce`. This is correct behavior — the scheduler recomputes when `generatedAt` is empty.

## Self-Check: PASSED

- `grep "shouldStartScheduler" src/instrumentation.ts` → match ✓
- `grep "startScheduler(db)" src/instrumentation.ts` → match ✓
- `grep "schedulerStop()" src/instrumentation.ts` → match inside shutdown ✓
- `grep "process.env.NODE_ENV" src/instrumentation.ts` → match ✓
- `grep "config.demoMode" src/instrumentation.ts` → match ✓
- `grep -c "it(" test/scheduler.test.ts` → 11 (≥ 8) ✓
- `npm run build` exits 0 ✓
- `npm test` → 128/128 pass, 0 fail ✓

## Key Files Modified

- `src/instrumentation.ts` — scheduler registration with D-01 gate and shutdown wiring
- `src/lib/scheduler.ts` — `tickOnce` export added
- `test/scheduler.test.ts` — 4 additional tests (SCHED-11, SCHED-01)
