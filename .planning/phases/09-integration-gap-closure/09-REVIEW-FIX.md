---
phase: 09-integration-gap-closure
fixed_at: 2026-05-01T00:00:00Z
fix_scope: critical_warning
findings_in_scope: 4
fixed: 4
skipped: 0
iteration: 1
status: all_fixed
---

# Phase 09: Code Review Fix Report

**Fixed at:** 2026-05-01T00:00:00Z
**Source review:** .planning/phases/09-integration-gap-closure/09-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 4
- Fixed: 4
- Skipped: 0

## Fixed Issues

### WR-01: Stall detection always passes — reads value it just wrote

**Files modified:** `src/lib/scheduler.ts`
**Commit:** 3cab575
**Applied fix:** Moved stall detection read before the unconditional write of `last_tick_at`. Previously the detection always passed because both values were identical. Now the comparison correctly uses the previous tick timestamp versus the current one.

### WR-02: `recomputeSchedule` resets `schedule_fires_done` mid-day, causing duplicate fires

**Files modified:** `src/lib/scheduler.ts`
**Commit:** 71a35d9
**Applied fix:** Preserve already-executed fire timestamps when recomputing the schedule. Instead of unconditionally wiping the done list with `"[]"`, the fix retains entries whose timestamps still exist in the new schedule, preventing duplicate fires if the user adjusts overrides mid-day.

### WR-03: `parseInt` for `peak_window_hours` and `anchor_offset_minutes` missing NaN guards

**Files modified:** `src/lib/scheduler.ts`
**Commit:** 71a35d9
**Applied fix:** Added NaN guards after both `parseInt` calls in `runTick` and `recomputeSchedule`. Values that are NaN or out of valid range are replaced with safe defaults (4 for peak_window_hours, 5 for anchor_offset_minutes), preventing NaN from propagating through the peak detector and schedule generator.

### WR-04: Tiebreak distance metric uses linear subtraction on circular hours

**Files modified:** `src/lib/peak-detector.ts`
**Commit:** 1281833
**Applied fix:** Introduced `circularDistFromNoon` helper function that computes the correct circular distance: `Math.min(d, 24 - d)`. Replaced both occurrences of linear distance `Math.abs(bestMid - 12)` and `Math.abs(candMid - 12)` with calls to this helper, ensuring correct tiebreak behavior for blocks whose midpoints wrap around midnight.

---

_Fixed: 2026-05-01T00:00:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
