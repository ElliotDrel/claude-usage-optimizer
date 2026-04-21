---
phase: 04-scheduler-wiring
reviewed: 2026-04-21T16:45:00Z
depth: standard
files_reviewed: 3
files_reviewed_list:
  - src/lib/scheduler.ts
  - src/instrumentation.ts
  - test/scheduler.test.ts
findings:
  critical: 0
  warning: 2
  info: 3
  total: 5
status: issues_found
---

# Phase 04: Code Review Report

**Reviewed:** 2026-04-21T16:45:00Z
**Depth:** standard
**Files Reviewed:** 3
**Status:** issues_found

## Summary

Reviewed the scheduler module core implementation, instrumentation wiring, and test coverage. Overall solid foundation with strong defensive patterns (try/catch wrapping, proper error isolation, fallback timezone handling). Three minor code quality issues identified:

1. **Parser function duplication** — `parseFiresJson` and `parseDoneJson` implement identical error-handling boilerplate; candidate for extraction.
2. **Unused time injection parameter** — `tickOnce` accepts `nowFn` but `runTick` does not receive the timeout value.
3. **Missing send timeout in tests** — Test helpers invoke `startScheduler` without `sendTimeoutMs`, risking slow/hung send operations in test environments.

No critical security or logic bugs found. All timing logic, state persistence, and error propagation are correctly implemented.

---

## Warnings

### WR-01: Duplicate JSON parsing with identical error handling

**File:** `src/lib/scheduler.ts:82-112`

**Issue:** 
Functions `parseFiresJson` (lines 82–94) and `parseDoneJson` (lines 100–112) are nearly identical — both wrap `JSON.parse`, check `Array.isArray`, and return `[]` on failure. This violates DRY and creates maintenance risk if the error recovery strategy changes (e.g., logging different message patterns or returning a fallback value instead of `[]`).

**Fix:**
Extract a generic `parseJsonArray` helper:
```typescript
/**
 * parseJsonArray — safely parse a JSON string into T[].
 * Returns empty array on parse failure or non-array value.
 */
function parseJsonArray<T = unknown>(raw: string, label: string): T[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      console.error(`[scheduler] corrupt ${label}, resetting to []`);
      return [];
    }
    return parsed as T[];
  } catch {
    console.error(`[scheduler] corrupt ${label}, resetting to []`);
    return [];
  }
}

// Usage:
const fires = parseJsonArray<ScheduledFire>(readMeta(db, "schedule_fires"), "schedule_fires");
const firesDone = parseJsonArray<string>(readMeta(db, "schedule_fires_done"), "schedule_fires_done");
```

---

### WR-02: `tickOnce` accepts `nowFn` but doesn't pass `sendTimeoutMs` to `runTick`

**File:** `src/lib/scheduler.ts:396–403`

**Issue:**
`tickOnce` function signature accepts `nowFn?: () => Date` but does not accept (and thus cannot pass) `sendTimeoutMs` to `runTick`. This is asymmetrical with `startScheduler`, which accepts both options and threads them through. Test cases (lines 206, 288, 343) call `startScheduler` with `sendTimeoutMs: 50` but `tickOnce` has no equivalent facility, forcing test writers to choose between:
1. Using `tickOnce` for unit-test isolation (cannot set send timeout)
2. Using `startScheduler` (accepts timeout, but also starts the interval loop)

**Fix:**
Update `tickOnce` to accept `sendTimeoutMs`:
```typescript
export async function tickOnce(
  db: Database.Database,
  nowFn?: () => Date,
  sendTimeoutMs?: number
): Promise<void> {
  const config = getConfig();
  const clockFn = nowFn ?? (() => new Date());
  await runTick(db, config, clockFn, sendTimeoutMs);
}
```

Then update test calls (e.g., line 288, 313, 343) to pass `sendTimeoutMs` for consistency:
```typescript
await tickOnce(db, () => frozenNow, 50);
```

---

## Info

### IN-01: Inconsistent comment indentation in `fireTimeToUtcIso`

**File:** `src/lib/scheduler.ts:185–187`

**Issue:**
The comment on line 185 ("Probe: interpret as UTC first") lacks leading spaces and appears less integrated with the surrounding code. Other comments in the module (lines 19, 29, 58, 77, 114) follow consistent indentation. Minor style issue, but worth aligning.

**Fix:**
```typescript
  // Probe: interpret as UTC first
  const probeUtc = new Date(`${localIso}Z`);
```

---

### IN-02: Debug output log lacks timestamp prefix

**File:** `src/lib/scheduler.ts:255–257` and throughout

**Issue:**
Console logs use `[scheduler]` prefix but lack timestamps (e.g., line 255: `console.log("[scheduler] catch-up fired at ...")`). Other modules in the codebase (per CONVENTIONS.md) prefer bracketed module tags; this is consistent. However, for a long-running background service, timestamps in logs help correlate events across multiple ticks. Consider adding a helper or structured logging.

**Fix:**
Not critical, but for future improvement: create a logging helper:
```typescript
function log(msg: string) {
  const now = new Date().toISOString();
  console.log(`[${now}] [scheduler] ${msg}`);
}
```

This is deferred until the project adopts structured logging.

---

### IN-03: Unused parameter in `catchUpOnStartup` due to error isolation

**File:** `src/lib/scheduler.ts:245–265`

**Issue:**
The `sendTimeoutMs?: number` parameter is accepted in `catchUpOnStartup` (line 232) and passed to `send()` (line 250), but if `send()` throws an error, the timeout value is never used again for that fire — the error is logged and the loop continues (lines 258–264). This is correct behavior per the design (D-03: per-fire error isolation), but the parameter feels redundant on line 250 since timeout errors are not specially handled.

**Fix:**
No change required; this is clarified by the D-03 comment on line 263. Just document:
```typescript
/**
 * sendTimeoutMs — timeout for send() calls. Errors are logged and loop continues
 * (per D-03 error isolation). Used to short-circuit long-hanging sends in tests.
 */
```

---

## Cross-File Observations

### Instrumentation wiring is clean

`src/instrumentation.ts` correctly:
- Checks `NEXT_RUNTIME === "nodejs"` before starting scheduler
- Respects `NODE_ENV` and `ENABLE_SCHEDULER` flags per D-01
- Suppresses scheduler in demo mode
- Registers SIGTERM/SIGINT handlers that stop the scheduler

However, per CONCERNS.md line 56, the `process.exit(0)` call may bypass Next.js shutdown sequencing. This is noted as a known issue and out of scope for this review, but flagged here for context.

### Test coverage is strong

`test/scheduler.test.ts` covers:
- ✅ App meta initialization (D-04)
- ✅ Pause toggle (SCHED-12)
- ✅ Recompute time-gate (SCHED-01, before 03:00 UTC)
- ✅ Catch-up on startup (SCHED-10)
- ✅ Tick fires due slot and skips done slots (SCHED-11)
- ✅ Nightly recompute with stale/fresh schedule_generated_at

One minor weakness: tests rely on `startScheduler` + brief `setTimeout` for async completion (e.g., line 210: `await new Promise((r) => setTimeout(r, 800))`). This is brittle if the test environment is slow. Consider using a mock clock or deterministic async flow — but the current approach works and matches the project's test style.

---

## Conclusion

The scheduler module is well-structured and implements the intended design (D-01 through D-04, T-04-01 through T-04-04, SCHED-01 through SCHED-12) robustly. The two warnings (duplication and asymmetry) are code quality improvements that do not affect correctness or performance. No security or critical logic issues found.

---

_Reviewed: 2026-04-21T16:45:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
