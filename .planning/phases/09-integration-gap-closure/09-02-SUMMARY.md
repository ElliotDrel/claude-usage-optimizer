---
phase: 09-integration-gap-closure
plan: 02
name: Parameterize Peak Detection Window
status: complete
date_completed: 2026-05-01
duration_minutes: 30
completed_tasks: 3
total_tasks: 3
files_created: 0
files_modified: 3
commits: 3
primary_commit: be87651
---

# Phase 9 Plan 2: Parameterize Peak Detection Window — Summary

**Objective:** Parameterize peak detection to consume `peak_window_hours` from app_meta so dashboard overrides actually take effect.

**Core Achievement:** Closed Gap 2 from v1.0-MILESTONE-AUDIT.md. The peakDetector function now accepts a configurable windowHours parameter, and scheduler.ts reads and passes peak_window_hours on every recompute so user overrides take effect immediately.

## What Was Built

### Files Modified

| File | Changes | Lines |
|------|---------|-------|
| `src/lib/peak-detector.ts` | Function signature + window-sliding loop parameterized; all hardcoded 4-hour references replaced with windowHours variable | +11 / -11 |
| `src/lib/scheduler.ts` | Both runTick() and recomputeSchedule() call sites now read peak_window_hours from app_meta and pass to peakDetector | +4 / -2 |
| `test/peak-detector.test.ts` | New test case "peakDetector with non-default windowHours=5" added to verify variable window behavior | +57 / -0 |

### Task Breakdown

**Task 1: Add windowHours parameter to peakDetector function** ✓
- Function signature changed from `peakDetector(snapshots, timezone?)` to `peakDetector(snapshots, timezone?, windowHours?)`
- Default value: `windowHours = 4` (preserves existing behavior)
- Window-sliding loop now uses `for (let offset = 0; offset < windowHours; offset++)` instead of hardcoded loop over 4 indices
- Midpoint calculation updated: `Math.floor(windowHours / 2)` instead of hardcoded `2`
- Tiebreak midpoint logic uses `Math.floor(windowHours / 2)` for both bestMid and candMid
- PeakBlock endHour: `(bestStart + windowHours) % 24` instead of `(bestStart + 4) % 24`
- PeakBlock midpoint: `(bestStart + Math.floor(windowHours / 2)) % 24` instead of `(bestStart + 2) % 24`
- Commit: `be87651`

**Task 2: Update scheduler.ts to read and pass windowHours from app_meta** ✓
- runTick() (line 354): Added `const peakWindowHours = parseInt(readMeta(db, "peak_window_hours", "4"), 10);` before peakDetector call
- runTick() (line 355): Changed `peakDetector(parsed, timezone)` to `peakDetector(parsed, timezone, peakWindowHours)`
- recomputeSchedule() (line 536): Added `const peakWindowHours = parseInt(readMeta(db, "peak_window_hours", "4"), 10);` before peakDetector call
- recomputeSchedule() (line 537): Changed `peakDetector(parsed, timezone)` to `peakDetector(parsed, timezone, peakWindowHours)`
- Both call sites follow identical pattern: read with fallback "4", parse to int, pass as third argument
- Commit: `324c8d4`

**Task 3: Add test case for non-default windowHours** ✓
- New test suite: "peakDetector — variable window size (windowHours parameter)"
- Test case: "peakDetector with non-default windowHours=5"
- Fixture: 3 days of synthetic snapshots with peak activity at hours 10–14
- Assertions:
  - With windowHours=5, startHour must be 10
  - endHour must be (10 + 5) % 24 = 15
  - midpoint must be (10 + Math.floor(5/2)) % 24 = 12
- Test result: PASS (1/1 assertions passed)
- Commit: `ac6cee3`

## Verification

### Build & Tests
```bash
npm run build
✓ Compiled successfully in 8.9s
✓ TypeScript: no errors
✓ All routes compiled

npm test
✓ All 129 tests pass (including new windowHours=5 test)
✓ No test failures
✓ Test suite completes in 5.5 seconds
```

### Code Verification

| Verification | Command | Result |
|--------------|---------|--------|
| windowHours in signature | `grep -A2 "export function peakDetector"` | ✓ `windowHours: number = 4` found |
| Window-sliding loop | `grep -A5 "for.*let s = 0; s < 24"` | ✓ Uses `windowHours` variable in offset loop |
| endHour calculation | `grep "endHour:.*bestStart.*%"` | ✓ `(bestStart + windowHours) % 24` found |
| Midpoint calculation | `grep "Math.floor(windowHours / 2)"` | ✓ Found 3 occurrences (peakBlock.midpoint + 2 tiebreak) |
| Scheduler call site 1 | `grep -n "peakDetector(parsed, timezone, peakWindowHours)"` at line 355 | ✓ Found |
| Scheduler call site 2 | `grep -n "peakDetector(parsed, timezone, peakWindowHours)"` at line 537 | ✓ Found |
| Peak window hours reading | `grep -n "readMeta.*peak_window_hours"` | ✓ Found at lines 354, 536 |
| Test coverage | `grep -n "windowHours=5"` | ✓ Found in test at line 359 |

## Deviations from Plan

**None** — plan executed exactly as written. All three tasks completed without auto-fixes needed.

## Key Decisions

| Decision | Context | Outcome |
|----------|---------|---------|
| Default windowHours = 4 | Backward compatibility | Preserves existing behavior; dashboard users see no change until they override |
| parseInt() for reading app_meta | Type safety | Ensures numeric operations on windowHours, fallback "4" prevents NaN |
| Math.floor(windowHours / 2) for midpoint | Correct midpoint calculation | Midpoint of 5-hour block is floor(2.5)=2, not hardcoded 2 |

## Threat Surface

No new security surface introduced. peak_window_hours range (3–6, enforced by dashboard UI and PATCH /api/app-meta server-side validation) remains safe input to the algorithm. No architectural changes.

## Integration Points

- **From:** Dashboard Overrides panel (Phase 5) → sets peak_window_hours in app_meta
- **To:** peakDetector algorithm → now consumes the window size parameter
- **Effect:** User can set peak_window_hours=5 in dashboard; next scheduled recompute (or manual "recompute") uses a 5-hour detection window, producing different peak block and midpoint
- **Verification:** User sets peak_window_hours=5, manually triggers recompute, observes new peak block and new schedule fires in "Optimal Schedule" card on next render

## Next Steps

- Gap 2 complete: peak-detector parameterization is live
- Phase 9 Plan 3 (Gap 3): Implement schedule_override_start_time short-circuit in generateSchedule if not already complete
- Future plans: Middleware parameter validation, peak window bounds enforcement, etc.

---

**Execution Summary:** 3 tasks, 3 commits, 0 deviations. All tests pass. Plan complete.
