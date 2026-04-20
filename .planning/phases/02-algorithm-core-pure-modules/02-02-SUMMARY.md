---
phase: 02-algorithm-core-pure-modules
plan: "02"
subsystem: schedule
tags: [pure-function, scheduling, algorithm, typescript]
dependency_graph:
  requires: [peak-detector PeakBlock type]
  provides: [generateSchedule, FireTime, ScheduleOptions]
  affects: [Phase 4 scheduler — consumes FireTime array]
tech_stack:
  added: []
  patterns: [pure-function, TDD red-green]
key_files:
  created:
    - claude-usage-tracker/src/lib/schedule.ts
    - claude-usage-tracker/src/lib/peak-detector.ts
    - claude-usage-tracker/test/schedule.test.ts
  modified: []
decisions:
  - "peak-detector.ts stub created so TypeScript can resolve PeakBlock type before Plan 02-01 lands in main"
  - "jitter uses Math.floor(Math.random() * 6) for 0–5 inclusive integer range"
  - "override bypasses anchorOffsetMinutes by design (SCHED-09 / D-03)"
metrics:
  duration: "~10 minutes"
  completed: "2026-04-20T14:29:28Z"
  tasks_completed: 2
  files_created: 3
---

# Phase 02 Plan 02: Schedule Generation Summary

Pure TypeScript `generateSchedule` function producing 5 `FireTime` slots spaced 5 hours apart, with anchor derived from peak midpoint + offset (or override / default seed), and 0–5 min jitter on non-anchor slots.

## What Was Built

### `claude-usage-tracker/src/lib/schedule.ts`

Exports `FireTime`, `ScheduleOptions`, and `generateSchedule`. Algorithm:

1. Resolve anchor: override → peak midpoint + anchorOffsetMinutes → defaultSeedTime ("05:05")
2. Build 5-slot chain: `totalMinutes = anchorHour*60 + anchorMinute + n*5*60`, wrap mod 24
3. Non-anchors get `Math.floor(Math.random() * 6)` jitter (0–5 inclusive)

### `claude-usage-tracker/src/lib/peak-detector.ts` (stub)

Minimal stub providing only the `PeakBlock` interface export so `schedule.ts` compiles before Plan 02-01 lands. The `detectPeakBlock` stub throws if called.

### `claude-usage-tracker/test/schedule.test.ts`

15 tests across 5 describe blocks covering all behavioral contracts:

- **basic shape**: length=5, exactly 1 anchor, jitter=0 on anchor, non-anchors [0,5]
- **anchor calculation**: midpoint→hour, default offset=5, custom offset honored
- **5-hour spacing**: consecutive +5h mod 24, wrap past midnight (midpoint=22)
- **override short-circuit**: hour/minute from override, correct chain 14→19→0→5→10, peakBlock ignored
- **null peak fallback**: defaultSeedTime, custom seed, hardcoded "05:05" default

## TDD Gate Compliance

RED commit: `5a4897d` — `test(02-02): add failing test suite for generateSchedule`
GREEN commit: `b492810` — `feat(02-02): implement generateSchedule pure schedule function`

Both gates satisfied.

## Deviations from Plan

### Auto-added: peak-detector.ts stub

**Found during:** Task 1 setup
**Issue:** `peak-detector.ts` was being created by parallel Plan 02-01 in its own worktree and was not present in this worktree. `schedule.ts` uses `import type { PeakBlock } from "./peak-detector"` — TypeScript would fail to resolve the type at compile time.
**Fix:** Created a minimal stub with the `PeakBlock` interface export and a stub `detectPeakBlock` that throws. This is the exact interface specified in the plan's `<interfaces>` section.
**Files modified:** `claude-usage-tracker/src/lib/peak-detector.ts` (created)
**Rule:** Rule 3 (auto-fix blocking issue)
**Note:** When Plan 02-01 is merged, its `peak-detector.ts` will supersede this stub.

## Self-Check

- [x] `claude-usage-tracker/src/lib/schedule.ts` — created
- [x] `claude-usage-tracker/src/lib/peak-detector.ts` — created (stub)
- [x] `claude-usage-tracker/test/schedule.test.ts` — created
- [x] RED commit `5a4897d` — exists
- [x] GREEN commit `b492810` — exists
- [x] 15/15 schedule tests pass
- [x] 75/75 non-DB tests pass (2 pre-existing DB failures unrelated to this plan)

## Self-Check: PASSED
