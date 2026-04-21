---
phase: 4
phase_name: "Scheduler Wiring"
project: "Claude Usage Optimizer"
generated: "2026-04-21"
counts:
  decisions: 5
  lessons: 5
  patterns: 4
  surprises: 3
missing_artifacts:
  - "04-VERIFICATION.md"
  - "04-HUMAN-UAT.md"
---

# Phase 4 Learnings: Scheduler Wiring

## Decisions

### schedule_fires stored as object array, not string array
`schedule_fires` in `app_meta` stores `{ timestamp: string; isAnchor: boolean }[]` rather than a plain `string[]`. This preserves anchor identity across process restarts so the downstream fire execution knows which send is the anchor.

**Rationale:** If only timestamps were stored, a restarted process could not distinguish the anchor from non-anchor fires when persisting `schedule_fires_done`. Losing anchor identity would break send telemetry.
**Source:** 04-01-SUMMARY.md (decisions field)

---

### sendTimeoutMs added to opts bag beyond plan spec
`startScheduler(db, opts?)` accepts an optional `sendTimeoutMs` that is threaded through to `catchUpOnStartup` and `runTick`. This was not in the original plan spec.

**Rationale:** Without a configurable timeout, catch-up tests would block 60 seconds per test run waiting for the real `claude` CLI. Tests need sub-100ms timeouts to be fast; production uses the full default.
**Source:** 04-01-SUMMARY.md (Deviations section)

---

### initializeAppMeta kept private in scheduler.ts
The function that seeds all 10 `app_meta` defaults was kept private to `scheduler.ts` rather than exported from `db.ts`.

**Rationale:** This is a scheduler-specific startup concern — it makes no sense for any other module to call it independently. Keeping it private enforces the invariant that `app_meta` is only initialized through `startScheduler`.
**Source:** 04-01-SUMMARY.md (decisions field)

---

### Scheduler gated on NODE_ENV + ENABLE_SCHEDULER + !demoMode in instrumentation.ts
The production gate uses `(NODE_ENV=production || ENABLE_SCHEDULER=true) && !config.demoMode` rather than just `NODE_ENV=production`.

**Rationale:** Developers need a way to test the scheduler locally without deploying. The `ENABLE_SCHEDULER=true` opt-in provides this without accidentally running it in demo mode (which would fire real sends against demo data).
**Source:** 04-02-PLAN.md (D-01 context), 04-02-SUMMARY.md

---

### tickOnce exported from scheduler.ts as test injection point
`tickOnce(db, nowFn?)` was added as a named export wrapping the private `runTick`, allowing tests to drive one tick without waiting for the 60-second interval.

**Rationale:** Plan NOTE clause explicitly called for this addition if `runTick` was not directly accessible. Tests for SCHED-01 and SCHED-11 require calling a single tick with deterministic clock values — `startScheduler` + 200ms wait is fragile timing; `tickOnce` is deterministic.
**Source:** 04-02-PLAN.md (NOTE in Task 2), 04-02-SUMMARY.md

---

## Lessons

### getDb() singleton breaks per-test database isolation
`getDb()` caches the first opened connection and returns it on all subsequent calls, even with different config paths. Tests that create a new db per test and pass different `dbPath` values still receive the first (potentially closed) handle.

**Context:** Discovered during GREEN phase when the second scheduler test received a closed db handle via `getDb()`. Fix: tests use `new Database(path)` directly from `better-sqlite3`, bypassing the singleton entirely.
**Source:** 04-01-SUMMARY.md (Deviation 3)

---

### tickOnce tests must set schedule_generated_at=today to prevent recompute overwriting test data
When `schedule_generated_at` is empty (the `initializeAppMeta` default), `shouldRecomputeSchedule` returns true for any UTC hour ≥ 3, causing `tickOnce` to overwrite `schedule_fires` with a freshly generated schedule before the fire execution step runs.

**Context:** The SCHED-11 "fires due slot" test set up a specific `schedule_fires` entry then called `tickOnce`. The tick recomputed and replaced `schedule_fires`, so the expected timestamp was never in `schedule_fires_done`. Fix: set `schedule_generated_at` to today's date before calling `tickOnce` in tests that don't want recompute to trigger.
**Source:** 04-02-SUMMARY.md (Deviations section), debugging in this session

---

### tickOnce committed to working tree but not to the executor's worktree
The Wave 1 executor agent added `tickOnce` to `scheduler.ts` in the main working tree (as an uncommitted change) but did not commit it. The Wave 2 executor agent's worktree was created from the committed HEAD, so it saw `scheduler.ts` without `tickOnce`. Tests that imported `tickOnce` failed with "is not a function."

**Context:** Working tree and committed HEAD diverged silently — git shows this via `git diff` but the worktree isolation mechanism only sees committed state. The fix required manually adding `tickOnce` to the worktree's `scheduler.ts` and committing it before the tests could pass.
**Source:** This session (post-merge debugging)

---

### Jitter arithmetic must use total-minutes reduction, not conditional ternary
The original jitter calculation `ft.hour + Math.floor((ft.minute + ft.jitterMinutes) / 60 === 0 ? 0 : 0)` always evaluated to `ft.hour + 0` — the dead ternary returned 0 in both branches. Jitter minutes that pushed the minute field past 59 produced invalid times.

**Context:** Caught during REFACTOR phase code review of `fireTimeToUtcIso`. Fix: `totalMinutes = ft.hour*60 + ft.minute + ft.jitterMinutes; jitteredHour = floor(totalMinutes/60) % 24; jitteredMinute = totalMinutes % 60`.
**Source:** 04-01-SUMMARY.md (Deviation 1)

---

### better-sqlite3 native module can become invalid after worktree operations on Windows
After merging worktrees, `npm list better-sqlite3` reported `invalid: "^12.8.0"` and test files that imported `better-sqlite3` failed at load time with "Cannot find module." `npm install` fixed it immediately.

**Context:** Tests passed 128/128 in the worktree but failed on the main branch post-merge with the native module error. Root cause appears to be Windows file-locking or path resolution issues affecting the native `.node` addon during worktree operations.
**Source:** This session (post-merge test gate failure)

---

## Patterns

### Clock injection via opts?.nowFn throughout scheduler module
All time comparisons in `scheduler.ts` use an injected `nowFn: () => Date` rather than calling `new Date()` directly. The default assignment is the only place `new Date()` appears.

**When to use:** Any module that contains time-dependent logic (intervals, comparisons, schedule generation) where tests need deterministic control over "now." Thread `nowFn` from the public entry point down through all private helpers.
**Source:** 04-01-PLAN.md (D-02), 04-01-SUMMARY.md

---

### INSERT OR IGNORE (ON CONFLICT DO NOTHING) for idempotent defaults
`initializeAppMeta` writes all 10 `app_meta` keys using `INSERT OR IGNORE INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING`. This makes every startup safe to call regardless of prior state.

**When to use:** Any time you need to seed configuration defaults into a SQLite key-value table at startup without overwriting values the user may have changed. Safe to call on every boot.
**Source:** 04-01-SUMMARY.md (tech_stack.patterns)

---

### Intl.DateTimeFormat probe-and-correct for DST-aware local→UTC conversion
To convert a user-local HH:MM fire time to UTC without a third-party date library: construct a candidate UTC date string, use `Intl.DateTimeFormat` to read back what the local clock would show, measure the offset, and correct. Wrap the `Intl.DateTimeFormat` construction in try/catch and fall back to `America/Los_Angeles` on invalid timezone (T-04-03).

**When to use:** Converting local-time schedule entries to UTC when you can't use a library like `date-fns-tz` or `luxon`. Node.js built-ins are sufficient but require the probe-and-correct pattern to handle DST correctly.
**Source:** 04-01-PLAN.md (fireTimeToUtcIso section), 04-01-SUMMARY.md

---

### Per-fire try/catch in tick loop for error isolation
Each `send()` call inside `runTick` is wrapped in its own `try/catch`. Errors log `[scheduler] send failed for fire at {timestamp}: {err.message}` and the loop continues to the next fire. The `setInterval` callback additionally wraps `runTick` in `.catch()` to catch unhandled rejections from the tick itself.

**When to use:** Any interval-based loop that calls a fallible external operation per item. Never let one failed item stop the loop or kill the interval. Two layers of protection: per-item try/catch + interval-level .catch().
**Source:** 04-01-PLAN.md (D-03, T-04-04), 04-01-SUMMARY.md

---

## Surprises

### Wave 1 executor committed tickOnce to working tree without staging it
The Wave 1 agent's final commit (`b0204ab`: "complete scheduler core plan") produced `scheduler.ts` with `tickOnce` visible in the working tree but the committed file did not include it. The worktree diverged from the HEAD silently.

**Impact:** Wave 2 executor's worktree started without `tickOnce`, causing 4 test failures. Required manual diagnosis (reading git diff on main, checking worktree scheduler.ts line count vs main), adding the function to the worktree, and committing before tests passed.
**Source:** This session (post-Wave-1-merge investigation)

---

### better-sqlite3 post-worktree-merge failure on Windows
After merging the Wave 2 worktree, 4 test suites that depend on `better-sqlite3` failed with "Cannot find module." `npm list` showed the package as `invalid`. This did not happen after the Wave 1 merge.

**Impact:** Required running `npm install` to fix. Low severity but unexpected — worktree merges should not affect `node_modules` on Windows in theory, but the native addon appears vulnerable to file-handle or registry state changes during worktree operations.
**Source:** This session (post-Wave-2-merge test gate)

---

### shouldRecomputeSchedule fires silently in tick tests with default app_meta state
When `initializeAppMeta` is called (by `startScheduler` or `tickOnce` internally), `schedule_generated_at` defaults to `''`. Any test that runs at UTC hour ≥ 3 without explicitly setting `schedule_generated_at` to today's date will trigger a recompute, overwriting whatever `schedule_fires` the test set up.

**Impact:** SCHED-11 "fires due slot" test silently produced wrong results — the expected fire timestamp was replaced by freshly generated schedule timestamps. The failure message showed unexpected timestamps rather than a missing function, making the root cause non-obvious.
**Source:** 04-02-SUMMARY.md, this session (SCHED-11 debugging)
