---
phase: 02-algorithm-core-pure-modules
plan: "01"
subsystem: algorithm
tags: [peak-detection, pure-function, tdd, timezone, algorithm]
dependency_graph:
  requires:
    - claude-usage-tracker/src/lib/usage-window.ts
    - claude-usage-tracker/src/lib/queries.ts
  provides:
    - claude-usage-tracker/src/lib/peak-detector.ts
  affects:
    - scheduler (Phase 3 — consumes peakDetector output)
tech_stack:
  added: []
  patterns:
    - Intl.DateTimeFormat for IANA timezone-aware hour and date bucketing
    - 4-hour sliding window with modular midnight-wrap arithmetic
    - Deterministic tiebreaking via midpoint-to-noon distance then earliest startHour
key_files:
  created:
    - claude-usage-tracker/src/lib/peak-detector.ts
    - claude-usage-tracker/test/peak-detector.test.ts
  modified: []
decisions:
  - "Accumulate only positive deltas (>0 guard) to avoid polluting hourlyDelta with reset-boundary noise"
  - "Tiebreak algorithm: minimize |midpoint - 12| first, then minimize startHour — deterministic for any input"
  - "getLocalHour normalizes Intl hour=24 to 0 (midnight edge case in some locales)"
metrics:
  duration: "~4 min"
  completed: "2026-04-20T14:30:46Z"
  tasks_completed: 2
  files_created: 2
  files_modified: 0
---

# Phase 2 Plan 01: peak-detector.ts — Pure Peak Detection Function Summary

**One-liner:** Pure TypeScript 4-hour sliding-window peak detector with IANA timezone bucketing, midnight-wrap, and deterministic tiebreaking.

## What Was Built

`peak-detector.ts` is the analytical core of the optimizer. Given `ParsedSnapshot[]` and an IANA timezone string, it:

1. Filters to `status="ok"` snapshots and counts distinct local calendar days — returns `null` if fewer than 3 days (insufficient data)
2. Builds a 24-element `hourlyDelta` array by iterating snapshot pairs and calling `computeUsageDelta()` to accumulate five-hour utilization deltas into user-local hour buckets (via `Intl.DateTimeFormat`)
3. Slides a 4-hour window across all 24 positions with modular midnight-wrap (`% 24`)
4. Resolves ties: midpoint closest to noon wins; earliest `startHour` breaks further ties
5. Returns `{ peakBlock: { startHour, endHour, sumDelta, midpoint }, midpoint }` or `null`

The companion test suite covers all branches: insufficient data (0/1/2/3 days), basic peak detection, midnight-wrap block (hours 22–01), and both tiebreak paths.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Implement peak-detector.ts | b385a2e | claude-usage-tracker/src/lib/peak-detector.ts |
| 2 | Write peak-detector.test.ts | cf33cdb | claude-usage-tracker/test/peak-detector.test.ts |

## Test Results

- **New tests:** 11 (4 describe blocks, 11 it blocks)
- **Full suite:** 95 tests pass, 0 fail (verified in main repo — worktree lacks node_modules for better-sqlite3 tests, which is an environment artifact, not a regression)
- **Exit code:** 0

## Decisions Made

1. **Positive-delta guard:** Only deltas `> 0` are accumulated into `hourlyDelta`. Zero and negative values (window resets, null utilization) are silently skipped — avoids polluting the histogram with baseline noise.

2. **Tiebreak algorithm:** `minimize |midpoint - 12|` first (prefer daytime peaks), then `minimize startHour` (prefer earlier start). This is deterministic for any input combination.

3. **Midnight normalization:** `getLocalHour()` normalizes `Intl` hour value `24` to `0` — this edge case occurs in some platforms/locales for exact midnight timestamps.

4. **Local date bucketing for day count:** `getLocalDateStr()` uses `Intl.DateTimeFormat` with `year/month/day` options — the day-count threshold uses the same timezone as the hourly bucketing, so UTC-midnight data spanning midnight in user-local time counts correctly.

## Deviations from Plan

None — plan executed exactly as written.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced. This is a pure in-memory function with no I/O.

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| claude-usage-tracker/src/lib/peak-detector.ts | FOUND |
| claude-usage-tracker/test/peak-detector.test.ts | FOUND |
| .planning/phases/02-algorithm-core-pure-modules/02-01-SUMMARY.md | FOUND |
| Commit b385a2e (feat) | FOUND |
| Commit cf33cdb (test) | FOUND |
