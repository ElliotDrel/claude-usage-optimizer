---
phase: 09-integration-gap-closure
reviewed: 2026-05-01T00:00:00Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - src/middleware.ts
  - src/proxy.ts
  - src/lib/peak-detector.ts
  - src/lib/scheduler.ts
  - test/peak-detector.test.ts
findings:
  critical: 0
  warning: 4
  info: 3
  total: 7
status: issues_found
---

# Phase 09: Code Review Report

**Reviewed:** 2026-05-01T00:00:00Z
**Depth:** standard
**Files Reviewed:** 5
**Status:** issues_found

## Summary

Reviewed the five files in scope for Phase 09 integration gap closure: the middleware re-export shim, the proxy/setup gate, the peak detector algorithm, the scheduler (the most complex module), and the peak detector test suite.

The algorithm logic in `peak-detector.ts` is sound and well-tested. The test suite covers the important behavioral cases cleanly. The proxy/middleware layer is correct and straightforward.

The scheduler has two bugs worth fixing before this phase closes: a stall-detection check that compares a value against itself (always passes, never fires), and a mid-day schedule recompute that resets the `done` list, which can cause already-fired sends to fire again. There are also three integer-parse calls missing NaN guards that can silently corrupt the schedule.

---

## Warnings

### WR-01: Stall detection always passes — reads value it just wrote

**File:** `src/lib/scheduler.ts:308,320-326`

**Issue:** Line 308 writes `last_tick_at` unconditionally at the top of `runTick`. Line 320 immediately reads it back into `lastTickAtStr`. Because both the write and the read happen inside the same synchronous block before any `await`, `lastTickAtStr` is always equal to `now.toISOString()`. The guard on line 321 (`lastTickAtStr !== now.toISOString()`) is therefore never true, so the stall detection branch on lines 322-331 can never execute.

**Fix:** Read `last_tick_at` before writing it, so the comparison is between the *previous* tick timestamp and now:

```typescript
// Step 1: Stall detection — read BEFORE the unconditional write
const lastTickAtStr = readMeta(db, "last_tick_at");
if (lastTickAtStr) {
  const lastTick = new Date(lastTickAtStr);
  const elapsedSeconds = (now.getTime() - lastTick.getTime()) / 1000;
  if (elapsedSeconds > 300) {
    console.error(`[scheduler] STALL DETECTED: ${elapsedSeconds}s since last tick`);
    void postDiscordNotification(...);
  }
}
// Write current timestamp after the check
writeMeta(db, "last_tick_at", now.toISOString());
```

---

### WR-02: `recomputeSchedule` resets `schedule_fires_done` mid-day, causing duplicate fires

**File:** `src/lib/scheduler.ts:562`

**Issue:** `recomputeSchedule` (called from PATCH `/api/app-meta`) writes `schedule_fires_done: "[]"` unconditionally on line 562. If the user adjusts an override mid-day after some fires have already executed, the done list is wiped. The existing scheduled fires retain their timestamps, and any whose `timestamp <= now` will be treated as un-done on the next tick and fire again.

**Fix:** Preserve fires that have already executed. After generating `scheduledFires`, carry forward any done entries whose timestamps still exist in the new fire list:

```typescript
const existingDone = parseDoneJson(readMeta(db, "schedule_fires_done"));
const newTimestamps = new Set(scheduledFires.map((f) => f.timestamp));
const retainedDone = existingDone.filter((ts) => newTimestamps.has(ts));

writeMeta(db, "schedule_fires", JSON.stringify(scheduledFires));
writeMeta(db, "peak_block", peakBlock ? JSON.stringify(peakBlock) : "");
writeMeta(db, "schedule_generated_at", now.toISOString());
writeMeta(db, "schedule_fires_done", JSON.stringify(retainedDone));
```

Note: Since `recomputeSchedule` re-jitters non-anchor fires, the new timestamps will differ from the old ones, so `retainedDone` will typically be empty — but this is still safer than unconditionally wiping on any recompute that happens to preserve a timestamp (e.g. anchor-only recompute via override).

---

### WR-03: `parseInt` for `peak_window_hours` passes `NaN` to `peakDetector` — silently wrong schedule

**File:** `src/lib/scheduler.ts:354,536`

**Issue:** `parseInt(readMeta(db, "peak_window_hours", "4"), 10)` returns `NaN` if the stored value is blank or non-numeric. `NaN` is then passed as `windowHours` to `peakDetector`. Inside the peak detector, `for (let offset = 0; offset < NaN; offset++)` never executes, so `maxSum` stays `-Infinity` and all windows appear equal. The midpoint computation also uses `Math.floor(NaN / 2) = NaN`, producing `NaN` for `midpoint` and `endHour`. The same `NaN` flows into `generateSchedule` and eventually into `fireTimeToUtcIso`, where `pad(NaN)` produces the string `"NaN"`, the constructed ISO string is invalid, and `new Date(...).toISOString()` throws a `RangeError`. This is caught by the surrounding `try/catch` (line 388), so the schedule silently fails to generate without any indication of the root cause.

The same problem exists at line 345/525 for `anchorOffsetMinutes`: `NaN` propagates through `generateSchedule`'s slot math.

**Fix:** Add NaN guards after each `parseInt`:

```typescript
const rawWindowHours = parseInt(readMeta(db, "peak_window_hours", "4"), 10);
const peakWindowHours = Number.isNaN(rawWindowHours) || rawWindowHours < 1 ? 4 : rawWindowHours;

const rawOffset = parseInt(readMeta(db, "anchor_offset_minutes", "5"), 10);
const anchorOffsetMinutes = Number.isNaN(rawOffset) || rawOffset < 0 ? 5 : rawOffset;
```

Apply the same guards in both `runTick` (lines 354-355) and `recomputeSchedule` (lines 536, 525).

---

### WR-04: Tiebreak distance metric uses linear subtraction on circular hours

**File:** `src/lib/peak-detector.ts:91-92`

**Issue:** The noon-proximity tiebreak computes `Math.abs(midpoint - 12)` as linear distance. For circular hours, the correct distance is `Math.min(Math.abs(mid - 12), 24 - Math.abs(mid - 12))`. With the current formula, midpoints at hour 2 and hour 22 both yield distance 10, while hour 23 and hour 1 both yield 11 — which matches their linear distance from noon but not their circular distance (both 1am and 11pm are equidistant from noon on a 24-hour clock face). In practice this rarely matters, but it means two blocks whose midpoints wrap around midnight could be ordered incorrectly relative to their actual proximity to the peak-usage assumption.

**Fix:**

```typescript
function circularDistFromNoon(mid: number): number {
  const d = Math.abs(mid - 12);
  return Math.min(d, 24 - d);
}

// Replace both occurrences in the tiebreak:
const bestDist = circularDistFromNoon(bestMid);
const candDist = circularDistFromNoon(candMid);
```

---

## Info

### IN-01: `proxy.ts` wraps synchronous `getAppMeta` in `Promise.resolve` unnecessarily

**File:** `src/proxy.ts:19`

**Issue:** `getAppMeta` is a synchronous SQLite call, but it is wrapped in `Promise.resolve(getAppMeta(config))`. This has no functional effect — synchronous throws from `getAppMeta` still propagate correctly because the throw happens before `Promise.resolve` receives any value. However, the pattern implies the function is async and may mislead future readers into thinking it returns a promise.

**Fix:** Call directly without the wrapper:

```typescript
const meta = getAppMeta(config);
```

---

### IN-02: `middleware.ts` is a thin re-export shim — consider inlining or documenting intent

**File:** `src/middleware.ts:1-2`

**Issue:** The file re-exports `setupGate as middleware` and `config` from `./proxy`. Next.js requires the middleware file to be at `src/middleware.ts`, but the actual logic lives in `src/proxy.ts`. While functional, the indirection with the name alias (`setupGate → middleware`) creates a small naming inconsistency that could confuse when tracing the middleware call chain.

**Fix:** Either add a comment explaining why the logic is in `proxy.ts` rather than `middleware.ts` directly, or rename the function in `proxy.ts` from `setupGate` to `middleware` to avoid the alias:

```typescript
// src/middleware.ts
// Next.js requires middleware to live in src/middleware.ts.
// Implementation is in proxy.ts to keep it testable outside the Next.js
// module boundary (middleware.ts cannot be imported by test files directly).
export { setupGate as middleware } from "./proxy";
export { config } from "./proxy";
```

---

### IN-03: `makeSevenDayFixture` in test produces an invalid reset timestamp when `peakHour >= 23`

**File:** `test/peak-detector.test.ts:115`

**Issue:** `pad(peakHour + 1)` produces `"24"` when `peakHour = 23`, generating reset strings like `"2026-01-07T24:00:00Z"`. While current test calls only use hours 14 and 22, the helper is reusable and silently broken for edge-hour inputs. `new Date("2026-01-07T24:00:00Z")` behavior varies by JS engine.

**Fix:** Wrap the reset hour:

```typescript
const resetHour = (peakHour + 1) % 24;
const resetDateStr = resetHour === 0
  ? `2026-01-${pad(i + 2)}`   // midnight rolls to next day
  : `2026-01-${pad(i + 1)}`;
// ...
five_hour_resets_at: `${resetDateStr}T${pad(resetHour)}:00:00Z`
```

Or more simply, clamp to same-day midnight-next as ISO:

```typescript
five_hour_resets_at: new Date(`2026-01-0${i + 1}T${pad(peakHour)}:00:00Z`).toISOString()
  .replace(/T\d\d:/, `T${pad((peakHour + 1) % 24)}:`)
```

The simpler fix is just to add a note or guard in `makeSevenDayFixture` so the helper throws if called with `peakHour >= 23`.

---

_Reviewed: 2026-05-01T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
