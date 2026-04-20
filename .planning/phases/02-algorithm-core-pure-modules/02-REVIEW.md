---
phase: 02-algorithm-core-pure-modules
reviewed: 2026-04-20T00:00:00Z
depth: standard
files_reviewed: 4
files_reviewed_list:
  - claude-usage-tracker/src/lib/peak-detector.ts
  - claude-usage-tracker/test/peak-detector.test.ts
  - claude-usage-tracker/src/lib/schedule.ts
  - claude-usage-tracker/test/schedule.test.ts
findings:
  critical: 0
  warning: 3
  info: 4
  total: 7
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-04-20
**Depth:** standard
**Files Reviewed:** 4
**Status:** issues_found

## Summary

Reviewed core pure-function modules implementing peak detection and schedule generation. These are the algorithmic heart of the project—both functions are well-tested, deterministic, and have no external I/O dependencies.

**Strengths:**
- Comprehensive test coverage with clear test structure and well-factored helpers (`makeSnapshot`, `makeDay`, `makeSevenDayFixture`)
- Deterministic algorithms suitable for unit testing; pure functions with no side effects
- Robust timezone handling via `Intl.DateTimeFormat` (avoids date-fns dependency for this critical path)
- Good tiebreaking logic for peak detection (midpoint distance from noon, then earliest startHour)
- Clear step comments in main algorithms (Steps 1–7 in peakDetector)

**Issues Found:**
- 3 logic/type warnings related to null-safety and boundary edge cases
- 4 code quality issues: unused variables, confusing parameter names, missing edge-case clarification

---

## Warnings

### WR-01: Potential null-dereference in `getLocalHour` when Intl format returns missing hour part

**File:** `claude-usage-tracker/src/lib/peak-detector.ts:16–26`

**Issue:**
The `getLocalHour` function safely handles missing `hourPart` by using the nullish coalescing operator (`??`), but the logic is fragile. If `parts.find()` returns a part where `value` is unexpectedly nullish (though unlikely), the code falls back to `"0"`. More importantly, the special case for `h === 24` (line 25) is undocumented—callers don't know this edge case exists.

```typescript
const hourPart = parts.find((p) => p.type === "hour");
const h = parseInt(hourPart?.value ?? "0", 10);
return h === 24 ? 0 : h; // Intl can return 24 for midnight; normalize to 0
```

This is good defensive code, but the fallback `?? "0"` silently returns hour 0 if something goes wrong, which could mask data quality issues upstream.

**Fix:**
Add a runtime assertion to catch unexpected nullish values, or log a warning:

```typescript
const hourPart = parts.find((p) => p.type === "hour");
if (!hourPart?.value) {
  console.warn(`[peak-detector] Unable to extract hour from Intl.DateTimeFormat for ${isoTimestamp} in ${timezone}; defaulting to 0`);
  return 0;
}
const h = parseInt(hourPart.value, 10);
return h === 24 ? 0 : h;
```

**Severity:** Warning (defensive code exists, but silent fallback could mask issues)

---

### WR-02: Unhandled `peakBlock.sumDelta` could be negative or zero after filtering

**File:** `claude-usage-tracker/src/lib/peak-detector.ts:37–112`

**Issue:**
In `peakDetector()`, the `maxSum` is initialized to `-Infinity` (line 74) and the algorithm finds the window with the highest sum. However, if *all* snapshots have `delta === 0` or negative (due to window resets), the function still returns a result with `sumDelta: -Infinity` or a negative value. The function signature doesn't document this edge case, and callers might not expect a "peak" with negative utilization.

This is especially risky in the hourly-delta loop (lines 56–71): if all snapshots are error status or have null utilization, the algorithm skips them and processes nothing, leaving `hourlyDelta` as all zeros. Then `maxSum = 0` is returned legitimately, which is correct—but the type doesn't signal that the peak may not be meaningful.

**Fix:**
Either (a) return `null` when `maxSum <= 0` to signal "no peak detected," or (b) document in the return type that `sumDelta` may be zero or negative. For the current implementation, adding a check is safer:

```typescript
// Step 6: After computing peakBlock, check if result is meaningful
if (maxSum <= 0) {
  console.warn(`[peak-detector] No positive usage detected; all hourly deltas are zero or negative. Returning null.`);
  return null;
}

const midpoint = (bestStart + 2) % 24;
const peakBlock: PeakBlock = { startHour: bestStart, endHour: (bestStart + 4) % 24, sumDelta: maxSum, midpoint };
return { peakBlock, midpoint };
```

**Severity:** Warning (edge case with weak documentation)

---

### WR-03: `parseHHMM` does not validate hour/minute bounds in `schedule.ts`

**File:** `claude-usage-tracker/src/lib/schedule.ts:16–19`

**Issue:**
The `parseHHMM` helper parses `"HH:MM"` strings but does not validate that `hour ∈ [0, 23]` or `minute ∈ [0, 59]`. If an invalid time like `"25:90"` is passed via `options.overrideStartTime`, it will be accepted and propagated through to `FireTime` objects without validation.

```typescript
function parseHHMM(s: string): { hour: number; minute: number } {
  const [h, m] = s.split(":").map(Number);
  return { hour: h ?? 0, minute: m ?? 0 };
}
```

This violates the principle that configuration should be validated at entry points. Downstream code (the scheduler) may assume hours are `[0, 23]` and produce incorrect output.

**Fix:**
Add bounds checking and throw or log an error on invalid input:

```typescript
function parseHHMM(s: string): { hour: number; minute: number } {
  const [h, m] = s.split(":").map(Number);
  const hour = h ?? 0;
  const minute = m ?? 0;
  
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error(`Invalid time "${s}": hour must be [0, 23] and minute must be [0, 59]`);
  }
  
  return { hour, minute };
}
```

**Severity:** Warning (configuration validation gap; could cause runtime inconsistency)

---

## Info

### IN-01: Unused variable `h` in `getLocalHour` can be simplified

**File:** `claude-usage-tracker/src/lib/peak-detector.ts:24`

**Issue:**
The variable `h` is assigned but only used immediately in the following ternary. This is minor, but the code would be clearer if written more directly:

Current:
```typescript
const h = parseInt(hourPart?.value ?? "0", 10);
return h === 24 ? 0 : h;
```

More concise:
```typescript
const hour = parseInt(hourPart?.value ?? "0", 10);
return hour === 24 ? 0 : hour;
```

Or even:
```typescript
return (parseInt(hourPart?.value ?? "0", 10) % 24) || 0;
```

The modulo approach (`% 24`) is idiomatic for hour normalization but less readable than the explicit ternary.

**Fix:** Rename `h` to `hour` for clarity (single-letter variables should only be loop counters per CONVENTIONS.md).

**Severity:** Info (naming convention)

---

### IN-02: `distinctDays.size < 3` check duplicates logic without explaining why 3 days

**File:** `claude-usage-tracker/src/lib/peak-detector.ts:47–50`

**Issue:**
The check `if (distinctDays.size < 3) return null` is correct—the algorithm needs at least 3 days of data for a meaningful peak. However, this magic number is not explained anywhere in the code or comment. A future maintainer might not understand why 3 is chosen.

**Fix:**
Add a comment explaining the rationale:

```typescript
// Step 2: Need ≥3 days of data to detect a pattern (robust against single-day anomalies)
const distinctDays = new Set(
  okSnapshots.map((s) => getLocalDateStr(s.timestamp, timezone))
);
const MIN_DAYS_FOR_PEAK = 3;
if (distinctDays.size < MIN_DAYS_FOR_PEAK) return null;
```

**Severity:** Info (documentation; improves maintainability)

---

### IN-03: Test fixture `makePeakBlock` in `schedule.test.ts` assumes fixed relationships

**File:** `claude-usage-tracker/test/schedule.test.ts:7–14`

**Issue:**
The test helper `makePeakBlock(midpoint)` always sets `startHour = (midpoint - 2 + 24) % 24` and `endHour = (midpoint + 2) % 24`, hardcoding a 4-hour window with 2 hours on each side. This is correct for the peak-detector output but assumes a specific structure. If the algorithm ever changes (e.g., to a 5-hour window), the tests would silently produce incorrect fixtures.

**Fix:**
Document the assumption or add a comment:

```typescript
// Factory for schedule tests: assumes a 4-hour peak with midpoint at hour H,
// meaning startHour = H-2 and endHour = H+2 (mod 24).
function makePeakBlock(midpoint: number): PeakBlock {
  return {
    startHour: (midpoint - 2 + 24) % 24,
    endHour: (midpoint + 2) % 24,
    sumDelta: 100,
    midpoint,
  };
}
```

**Severity:** Info (test clarity)

---

### IN-04: Missing edge-case test for `generateSchedule` with invalid/empty input

**File:** `claude-usage-tracker/test/schedule.test.ts`

**Issue:**
The test suite covers null peak, overrides, and 5-hour spacing, but does not test invalid/malformed input:
- Empty string for `overrideStartTime` → currently treated as null (correct), but untested
- Non-time strings like `"invalid"` → `parseHHMM("invalid")` returns `{hour: NaN, minute: NaN}` and silently corrupts the schedule

Add a test case or error handling for invalid input.

**Fix:**
Either add validation tests:

```typescript
describe("generateSchedule — error handling", () => {
  it("throws on invalid overrideStartTime format", () => {
    assert.throws(
      () => generateSchedule(null, { overrideStartTime: "not-a-time" }),
      /Invalid time/
    );
  });

  it("treats empty string overrideStartTime as null", () => {
    const fires1 = generateSchedule(null, { overrideStartTime: "" });
    const fires2 = generateSchedule(null);
    assert.deepEqual(fires1, fires2);
  });
});
```

Or add error handling in `parseHHMM` (see WR-03 above).

**Severity:** Info (test coverage gap; related to WR-03)

---

## No Critical Issues Found

All reviewed modules are:
- **Functionally correct** — algorithms implement the specified behavior (peak detection, 5-hour spacing)
- **Well-tested** — 40+ test cases covering null input, edge cases (midnight wrap, tiebreaking), and normal flow
- **Free from security vulnerabilities** — pure functions with no I/O, injection, or auth concerns
- **Deterministic** — suitable for use in production scheduling

---

_Reviewed: 2026-04-20_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
