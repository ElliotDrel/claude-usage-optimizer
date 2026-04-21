---
phase: 04-scheduler-wiring
verified: "2026-04-21T17:30:00Z"
status: passed
score: 5/5 must-haves verified
overrides_applied: 0
re_verification: false
---

# Phase 4: Scheduler Wiring Verification Report

**Phase Goal:** An in-process 60-second tick loop registered in `instrumentation.ts` fires the sender for matching scheduled slots, recomputes the schedule nightly at 03:00 UTC, catches up on recent missed fires after restart, and honors a global pause toggle.

**Verified:** 2026-04-21T17:30:00Z  
**Status:** PASSED — All observable truths verified; all artifacts exist, substantive, and wired; all key links functional; data flows correctly.

## Goal Achievement Summary

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `scheduler.ts` is registered in `instrumentation.ts` (gated behind `ENABLE_SCHEDULER=true` during development) and its 60s tick invokes the sender for any fire whose timestamp is ≤ now and not yet recorded in `schedule_fires_done` | ✓ VERIFIED | `src/instrumentation.ts` imports and calls `startScheduler(db)` behind `shouldStartScheduler` gate; `src/lib/scheduler.ts` defines 60s tick with `setInterval(60_000)` that calls `runTick` which reads `schedule_fires` and `schedule_fires_done`, checks `isDue` condition (timestamp ≤ now AND not in done list), and calls `send()` for matching fires |
| 2 | At 03:00 UTC daily, the scheduler reads all historical `status='ok'` snapshots, recomputes the peak block and fire chain, and persists the result to the documented `app_meta` keys | ✓ VERIFIED | `src/lib/scheduler.ts` lines 295-350 implement recompute: `shouldRecomputeSchedule(nowFn, lastGeneratedAt)` checks UTC hour >= 3 AND date < today; calls `querySnapshots(config, { status: 'ok' })` → `parseSnapshots()` → `peakDetector()` → `generateSchedule()`; converts `FireTime[]` to UTC ISO via `fireTimeToUtcIso()`; writes 4 app_meta keys atomically |
| 3 | On process restart, a fire missed by <15 minutes fires immediately; a fire missed by ≥15 minutes is skipped | ✓ VERIFIED | `src/lib/scheduler.ts` `catchUpOnStartup()` lines 228-267 reads `schedule_fires` and `schedule_fires_done`, iterates all fires, checks `isMissed` (fireDate <= now AND not in done) AND `isRecent` (fireDate > now - 15 min); fires recent missed fires via `send()` in try/catch; skips older ones silently |
| 4 | Setting `app_meta.paused='true'` causes every subsequent tick to skip all fires until the flag is cleared; the global state survives restarts | ✓ VERIFIED | `src/lib/scheduler.ts` `runTick()` lines 284-289 reads `paused` from app_meta; if `'true'`, logs and returns early without running steps 2-3; all subsequent ticks check paused state; state persists in SQLite |
| 5 | All required `app_meta` keys are read and written by the running system | ✓ VERIFIED | `src/lib/scheduler.ts` `initializeAppMeta()` lines 37-56 writes all 10 keys with INSERT OR IGNORE: schedule_fires, schedule_fires_done, schedule_generated_at, peak_block, schedule_override_start_time, peak_window_hours, anchor_offset_minutes, default_seed_time, user_timezone, paused; all keys are read in tick and recompute logic; test suite (test/scheduler.test.ts) verifies all 10 keys initialized with correct defaults |

**Score:** 5/5 observable truths verified

### Required Artifacts

| Artifact | Purpose | Status | Evidence |
|----------|---------|--------|----------|
| `src/lib/scheduler.ts` | Core scheduler module with startScheduler named export | ✓ VERIFIED | File exists (447 lines); exports `startScheduler(db, opts?)` returning `{ stop }` (line 418); exports `tickOnce(db, nowFn?)` for testing (line 396); contains `initializeAppMeta`, `catchUpOnStartup`, `runTick` private functions; `npm run build` compiles without error |
| `src/instrumentation.ts` | Next.js startup hook that gates scheduler registration | ✓ VERIFIED | File exists; imports `getDb` and `startScheduler` (lines 6-7); implements `shouldStartScheduler` gate with conditions `(NODE_ENV=production OR ENABLE_SCHEDULER=true) AND !config.demoMode` (lines 15-18); calls `startScheduler(db)` if gate passes (line 22); captures `scheduler.stop()` in shutdown handler alongside `collector.stop()` (lines 33-34) |
| `test/scheduler.test.ts` | Comprehensive fake-clock unit tests | ✓ VERIFIED | File exists (385 lines); imports `startScheduler` and `tickOnce` (line 20); defines 11 test cases covering: initializeAppMeta (2 tests), pause toggle (1), shouldRecomputeSchedule gate (1), catch-up on startup (2), stop() function (1), tick fires due slot (2), nightly recompute (2); uses fake-clock injection via `nowFn` parameter throughout |

### Key Link Verification

| From | To | Via | Status | Evidence |
|------|----|----|--------|----------|
| `src/lib/scheduler.ts` → `src/lib/sender.ts` | Fire execution | `send(config, { scheduledFor, isAnchor })` | ✓ WIRED | Imported line 14; called in `catchUpOnStartup()` line 247 and `runTick()` line 363 with proper opts bag; response result.status logged |
| `src/lib/scheduler.ts` → `src/lib/db.ts` (app_meta) | Metadata read/write | `db.prepare(SELECT/INSERT...).get/run()` on app_meta table | ✓ WIRED | `readMeta()` (lines 61-66) selects from app_meta; `writeMeta()` (lines 71-75) inserts/updates via ON CONFLICT; used throughout for all 10 keys |
| `src/lib/scheduler.ts` → `src/lib/peak-detector.ts` | Schedule recompute | `peakDetector(parsedSnapshots, timezone)` | ✓ WIRED | Imported line 15; called line 313 during recompute with result checked for null; fallback to generateSchedule with null peakBlock |
| `src/lib/scheduler.ts` → `src/lib/schedule.ts` | Schedule generation | `generateSchedule(peakBlock, options)` | ✓ WIRED | Imported line 16; called line 317 with peakBlock and ScheduleOptions; returns FireTime[] that is converted to UTC ISO timestamps |
| `src/lib/scheduler.ts` → `src/lib/db.ts` (querySnapshots) | Historical data for recompute | `querySnapshots(config, { status: 'ok' })` | ✓ WIRED | Imported line 13; called line 309 to fetch all status='ok' snapshots; result parsed via `parseSnapshots()` before passing to peakDetector |
| `src/instrumentation.ts` → `src/lib/scheduler.ts` | Scheduler registration | `startScheduler(db)` in register() | ✓ WIRED | Imported line 7; called line 22 inside shouldStartScheduler gate; stop function captured for shutdown handler |
| `test/scheduler.test.ts` → `src/lib/scheduler.ts` | Test imports | `import { startScheduler, tickOnce }` | ✓ WIRED | Imported line 20; both functions called throughout all 11 test cases; tickOnce used for precise tick testing without interval wait |

### Data-Flow Trace (Level 4)

| Component | Data Variable | Source | Produces Real Data | Status |
|-----------|---------------|--------|-------------------|--------|
| `runTick` — recompute block | `schedule_fires` (ScheduledFire[]) | `generateSchedule()` result → converted to UTC ISO | Yes — `peakDetector()` parses real snapshots from DB; `generateSchedule()` computes real FireTime array | ✓ FLOWING |
| `catchUpOnStartup` | `schedule_fires` and `schedule_fires_done` | Read from app_meta via `readMeta()` | Yes — values are persisted ScheduledFire[] from previous scheduler runs; parsed via `parseFiresJson()` | ✓ FLOWING |
| `runTick` — fire execution | `isDue` condition result | Read from `schedule_fires` and `schedule_fires_done` | Yes — timestamps compared against `nowFn()` which is injected (production: real time; tests: frozen time) | ✓ FLOWING |
| `tickOnce` test injection | `nowFn` parameter | Test passes frozen `new Date("2026-04-20T...")` | Yes — tests verify behavior at specific clock times; test suite confirms 128/128 tests pass, including 11 scheduler tests | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Test | Result | Status |
|----------|------|--------|--------|
| Initialization writes all 10 app_meta keys with correct defaults | `test/scheduler.test.ts` line 97: "initializes all 10 app_meta keys with documented defaults on startup" | PASS — getMeta assertions on all 10 keys confirm exact default values | ✓ PASS |
| Catch-up fires recent missed sends | `test/scheduler.test.ts` line 189: "fires a missed send within the 15-minute window" | PASS — fire 10 min old is caught up; schedule_fires_done includes timestamp | ✓ PASS |
| Catch-up skips old missed sends | `test/scheduler.test.ts` line 222: "skips a missed send older than 15 minutes" | PASS — fire 20 min old is skipped; send_log COUNT = 0 | ✓ PASS |
| Pause toggle suppresses fires | `test/scheduler.test.ts` line 139: "skips catch-up fires when paused = 'true'" | PASS — paused=true suppresses catch-up; send_log COUNT = 0 | ✓ PASS |
| Tick fires due slots | `test/scheduler.test.ts` line 271: "fires a due slot not in the done list" | PASS — tickOnce fires due slot; schedule_fires_done updated | ✓ PASS |
| Tick skips already-done slots | `test/scheduler.test.ts` line 299: "skips a slot already in the done list" | PASS — already-done slot does not fire; send_log COUNT = 0 | ✓ PASS |
| Recompute triggers at 03:00 UTC when needed | `test/scheduler.test.ts` line 329: "triggers recompute when schedule_generated_at is from a previous day" | PASS — stale schedule_generated_at detected; new timestamp written with today's date | ✓ PASS |
| Recompute skips when already done today | `test/scheduler.test.ts` line 359: "does not trigger recompute when schedule_generated_at is already today" | PASS — today's schedule_generated_at unchanged after tickOnce | ✓ PASS |
| Full test suite passes | `npm test` (terminal output from 2026-04-21) | 128/128 tests pass, including 11 scheduler-specific tests; 0 failures | ✓ PASS |

### Requirements Coverage

| Requirement | Phase Mapping | Description | Evidence | Status |
|-------------|---------------|-------------|----------|--------|
| **SCHED-01** | Phase 4 | System recomputes the optimal schedule at 03:00 UTC daily using all historical `status='ok'` snapshots | `src/lib/scheduler.ts` `shouldRecomputeSchedule()` checks UTC hour ≥ 3; recompute block calls `querySnapshots(config, { status: 'ok' })`; test suite includes 2 tests on recompute gate | ✓ SATISFIED |
| **SCHED-10** | Phase 4 | On restart, any missed fire within the last 15 minutes fires immediately; older misses are skipped | `src/lib/scheduler.ts` `catchUpOnStartup()` compares `fireDate > (now - 15 min)` condition; test suite includes 2 catch-up tests | ✓ SATISFIED |
| **SCHED-11** | Phase 4 | An in-process 60-second tick loop invokes the sender for any fire time whose timestamp is ≤ now and not yet marked done today | `src/lib/scheduler.ts` `runTick()` implements 60s tick via `setInterval(60_000)` at line 437; fire execution checks `fireDate <= now && !firesDone.includes()`; test suite includes 2 tick-fire tests | ✓ SATISFIED |
| **SCHED-12** | Phase 4 | User can globally pause automatic sending via a dashboard toggle; scheduler honors pause state on every tick | `src/lib/scheduler.ts` `runTick()` reads `paused` from app_meta and returns early if `'true'`; test suite includes 1 pause toggle test | ✓ SATISFIED |
| **DATA-04** | Phase 4 | `app_meta` key-value store holds documented keys (schedule_fires, schedule_fires_done, schedule_generated_at, peak_block, schedule_override_start_time, peak_window_hours, anchor_offset_minutes, default_seed_time, user_timezone, paused) and is read and written by the running system | `src/lib/scheduler.ts` `initializeAppMeta()` writes all 10 keys; all keys read in tick/recompute logic; test suite includes 2 tests verifying initialization and idempotence | ✓ SATISFIED |

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `src/lib/scheduler.ts` | `return []` on JSON parse failure (lines 87, 92, 105, 110) | ℹ️ INFO | Safe defensive coding; guards against corrupted app_meta; failures logged; tick continues |
| `src/lib/scheduler.ts` | Intl.DateTimeFormat fallback try/catch (lines 162-170) | ℹ️ INFO | Safe error handling for invalid timezone; falls back to America/Los_Angeles; logged |
| All scheduler code | Clock injection via `nowFn` parameter | ℹ️ INFO | Intentional testability pattern; no bare `new Date()` calls outside default assignment; excellent for test coverage |

**No blockers, warnings, or stubs detected.** All patterns are intentional safety measures or testability fixtures.

### Human Verification Required

None. All phase goal aspects are programmatically verifiable and covered by automated tests.

## Completeness Assessment

**What was built:**

1. **`src/lib/scheduler.ts`** (447 lines) — Core scheduler module providing:
   - `initializeAppMeta(db)` — Writes all 10 DATA-04 app_meta keys with INSERT OR IGNORE on startup
   - `catchUpOnStartup(db, config, nowFn)` — Reads schedule_fires, fires missed sends within 15-min window (SCHED-10), persists updates
   - `shouldRecomputeSchedule(nowFn, lastGeneratedAt)` — Returns true when UTC hour ≥ 3 AND schedule is stale (SCHED-01)
   - `fireTimeToUtcIso(firetime, timezone, nowFn)` — DST-aware local-to-UTC conversion using Intl.DateTimeFormat probe-and-correct
   - `runTick(db, config, nowFn)` — Three-step tick: pause check → recompute check → fire execution (SCHED-11, SCHED-12)
   - `startScheduler(db, opts?)` — Public API; initializes app_meta, runs catch-up, sets up 60s interval, returns { stop }
   - `tickOnce(db, nowFn?)` — Public API for test injection; runs one tick synchronously

2. **`src/instrumentation.ts`** (modified) — Next.js startup hook:
   - Imports getDb and startScheduler dynamically
   - Implements D-01 gate: `(NODE_ENV=production OR ENABLE_SCHEDULER=true) AND !config.demoMode`
   - Calls `startScheduler(db)` if gate passes
   - Shutdown handler calls both `collector.stop()` and `schedulerStop()`

3. **`test/scheduler.test.ts`** (385 lines) — Comprehensive test suite:
   - 11 test cases covering all DATA-04, SCHED-01, SCHED-10, SCHED-11, SCHED-12 behaviors
   - Fake-clock injection via `nowFn` parameter throughout
   - All 128/128 tests in the full suite pass (including 11 scheduler-specific)

**Phase goal:** "An in-process 60-second tick loop registered in `instrumentation.ts` fires the sender for matching scheduled slots, recomputes the schedule nightly at 03:00 UTC, catches up on recent missed fires after restart, and honors a global pause toggle."

**Achieved:** ✓ All four sub-goals are implemented and tested:
- ✓ 60s tick loop fires matching scheduled slots
- ✓ Nightly 03:00 UTC recompute implemented and gated
- ✓ Catch-up on restart with 15-min window
- ✓ Global pause toggle honored every tick

**Success Criteria All Met:**
1. ✓ Scheduler registered in instrumentation.ts with ENABLE_SCHEDULER gate
2. ✓ 03:00 UTC recompute reads snapshots, detects peak, generates schedule, persists to app_meta
3. ✓ Catch-up fires < 15 min misses; skips ≥ 15 min
4. ✓ Pause toggle suppresses all fires
5. ✓ All 10 app_meta keys initialized and used

## Verification Details

**Key Implementation Insights:**

- **Clock injection (D-02):** All time logic uses `nowFn()` parameter (default: `() => new Date()`); zero bare `new Date()` calls in comparison logic. Enables comprehensive fake-clock testing.
- **Error isolation (D-03):** Each `send()` call wrapped in try/catch; errors logged with `[scheduler]` prefix; tick/catch-up continues after errors.
- **Idempotent initialization (D-04):** INSERT OR IGNORE ensures `initializeAppMeta` is safe to call repeatedly; user-set values never overwritten.
- **DST-aware timezone conversion:** `fireTimeToUtcIso()` uses Intl.DateTimeFormat probe-and-correct approach; validated by `Intl.DateTimeFormat` construction before use; falls back to America/Los_Angeles on error.
- **Per-fire persistence:** `schedule_fires_done` updated immediately after each successful send to prevent repeated fires (Pitfall 4 from research).

**Test Coverage Validation:**

All required test cases from plan frontmatter are present and passing:
- DATA-04: initializeAppMeta writes 10 keys with defaults (2 tests: initialization + idempotence)
- SCHED-10: catch-up < 15 min fires (1 test); catch-up ≥ 15 min skips (1 test)
- SCHED-11: tick fires due slot (1 test); tick skips already-done (1 test)
- SCHED-12: pause toggle suppresses fires (1 test)
- SCHED-01: recompute at 03:00 UTC when stale (1 test); recompute skips if already done (1 test)
- Additional: stop() function test (1 test); shouldRecomputeSchedule gate test (1 test)

**Total: 11 scheduler tests; all passing**

---

## Conclusion

**Phase 4 Goal Achievement: PASSED**

The scheduler wiring phase is complete. The in-process 60-second tick loop is wired and functional:

- **Scheduler module:** 447 lines of production code, fully tested
- **Integration:** Registered in instrumentation.ts behind development gate; production always-on
- **Data durability:** All state in SQLite app_meta; survives restarts
- **Test coverage:** 11 tests covering all behaviors; full test suite passes 128/128
- **Build:** `npm run build` succeeds; TypeScript clean
- **Requirements:** SCHED-01, SCHED-10, SCHED-11, SCHED-12, DATA-04 all satisfied

Ready to proceed to Phase 5 (Dashboard Control Surface).

---

_Verified: 2026-04-21T17:30:00Z_  
_Verifier: Claude (gsd-verifier)_
