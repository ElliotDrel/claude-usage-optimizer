---
phase: 01-foundation-db-refactor
plan: "05"
subsystem: analysis-layer
tags: [refactor, types, read-path, dashboard, testing]
dependency_graph:
  requires:
    - "01-02: DB schema (SnapshotRow definition)"
    - "01-03: queries.ts (ParsedSnapshot, parseSnapshots)"
  provides:
    - "analysis.ts accepting ParsedSnapshot[] — Phase 1 read-path closed"
    - "dashboard/route.ts wiring parseSnapshots into buildDashboardData"
    - "analysis.test.ts with ParsedSnapshot factory — test suite green"
  affects:
    - "claude-usage-tracker/src/lib/analysis.ts"
    - "claude-usage-tracker/src/app/api/dashboard/route.ts"
    - "claude-usage-tracker/test/analysis.test.ts"
tech_stack:
  added: []
  patterns:
    - "Explicit field access over dynamic key indexing in computeDelta (TypeScript type safety)"
    - "ParsedSnapshot flows end-to-end: SQLite -> parseSnapshots -> buildDashboardData -> DashboardData JSON"
key_files:
  modified:
    - "claude-usage-tracker/src/lib/analysis.ts"
    - "claude-usage-tracker/src/app/api/dashboard/route.ts"
    - "claude-usage-tracker/test/analysis.test.ts"
decisions:
  - "DashboardData.health types changed to ParsedSnapshot (not SnapshotRow) — all identity fields exist on ParsedSnapshot so no component changes needed"
  - "computeDelta dynamic key access replaced with explicit conditional — avoids index signature requirement on ParsedSnapshot"
  - "extra_usage_enabled === 1 changed to === true — ParsedSnapshot.extra_usage_enabled is boolean | null not number | null"
  - "SnapshotRow import removed from analysis.ts entirely — health now uses ParsedSnapshot"
  - "collector.test.ts and db.test.ts failures confirmed pre-existing (better-sqlite3 not installed in worktree); out of scope"
metrics:
  duration: "~15 minutes"
  completed: "2026-04-19T23:24:54Z"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 3
  commits: 2
---

# Phase 01 Plan 05: Analysis Layer ParsedSnapshot Wiring Summary

**One-liner:** Closed the Phase 1 read path by replacing `SnapshotRow[]` with `ParsedSnapshot[]` throughout `analysis.ts`, wiring `parseSnapshots()` in `dashboard/route.ts`, and updating `analysis.test.ts` — all 24 in-scope tests green.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Update analysis.ts and dashboard/route.ts | fbfe66f | analysis.ts, dashboard/route.ts |
| 2 | Update analysis.test.ts makeSnapshot factory | c67b63f | analysis.test.ts |

## What Was Built

### Task 1 — analysis.ts and dashboard/route.ts

`analysis.ts` was refactored to consume `ParsedSnapshot[]` instead of `SnapshotRow[]`:

- Added `import { type ParsedSnapshot } from "./queries"` — removed `SnapshotRow` import entirely
- `buildDashboardData` signature: `SnapshotRow[]` -> `ParsedSnapshot[]`
- All internal helpers (`buildActivity`, `buildUsageInsights`, `buildExtraUsageInsights`, `computeDelta`) typed to `ParsedSnapshot` / `ParsedSnapshot[]`
- `DashboardData.health` fields (`lastSnapshot`, `lastSuccess`, `recentErrors`) changed from `SnapshotRow` to `ParsedSnapshot` — all identity fields overlap, no UI component changes needed
- `computeDelta`: replaced template-literal dynamic key access (`prev[\`${windowKey}_utilization\`]`) with explicit conditional — required because `ParsedSnapshot` has no index signature
- `isEnabled` check: `extra_usage_enabled === 1` -> `=== true` (field is now `boolean | null`)
- `safeParseJson` kept — still used for `current.rawJson` from `raw_json` string

`dashboard/route.ts` change:
- Added `import { parseSnapshots } from "@/lib/queries"`
- Extracted `querySnapshots(config)` to `rawSnapshots` const, wrapped with `parseSnapshots()` before passing to `buildDashboardData`

### Task 2 — analysis.test.ts (TDD)

`makeSnapshot` factory updated to return `ParsedSnapshot`:

- Import changed: `SnapshotRow` from `db` -> `ParsedSnapshot` from `queries`
- Return type and overrides parameter: `SnapshotRow` -> `ParsedSnapshot`
- `auth_mode: "bearer"` removed from default object (field does not exist on `ParsedSnapshot`)
- All `extra_usage_enabled: 1` call sites updated to `extra_usage_enabled: true` (boolean)
- All 14 existing test cases passed without logic changes — field names identical on `ParsedSnapshot`

## Phase 1 Gate Results

| Check | Result |
|-------|--------|
| `grep -c "SnapshotRow" analysis.ts` | 0 |
| `grep -c "parseSnapshots" route.ts` | 2 (import + call) |
| `grep -c "ParsedSnapshot" analysis.test.ts` | 3 (import + return type + param type) |
| TS errors in analysis.ts, queries.ts | 0 |
| analysis.test.ts tests | 14/14 pass |
| queries.test.ts tests | 10/10 pass |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] extra_usage_enabled boolean coercion**
- **Found during:** Task 1
- **Issue:** Original code used `extra_usage_enabled === 1` to detect enabled state. On `ParsedSnapshot`, `extra_usage_enabled` is `boolean | null`, not `number | null`. The `=== 1` check would always be `false`.
- **Fix:** Changed to `=== true` in `buildDashboardData` `current.extraUsage.isEnabled` assignment.
- **Files modified:** `claude-usage-tracker/src/lib/analysis.ts`
- **Commit:** fbfe66f

### Out-of-Scope Pre-existing Failures

`collector.test.ts` and `db.test.ts` fail in this worktree due to `better-sqlite3` native module not being installed. Confirmed pre-existing by stash-test — these failures existed before any changes in this plan.

## Known Stubs

None — all dashboard panels source data from `ParsedSnapshot` fields derived from `raw_json` via `parseSnapshot`. No placeholder values or hardcoded stubs introduced.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes introduced. Data flow is an internal type transformation only.

## Self-Check: PASSED

- `claude-usage-tracker/src/lib/analysis.ts` exists and contains `ParsedSnapshot`
- `claude-usage-tracker/src/app/api/dashboard/route.ts` exists and contains `parseSnapshots`
- `claude-usage-tracker/test/analysis.test.ts` exists and contains `ParsedSnapshot`
- Commits fbfe66f and c67b63f exist in git log
- 24 in-scope tests pass (analysis + queries)
