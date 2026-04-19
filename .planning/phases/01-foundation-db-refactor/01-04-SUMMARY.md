---
phase: 01-foundation-db-refactor
plan: "04"
subsystem: database
tags: [sqlite, collector, write-path, demo-seeder, insertSnapshot, parseSnapshot]

# Dependency graph
requires:
  - phase: 01-02
    provides: "6-field insertSnapshot signature in db.ts"
  - phase: 01-03
    provides: "parseSnapshot / ParsedSnapshot in queries.ts"
provides:
  - "collector.ts write path fully simplified — 4 insertSnapshot call sites with 6 fields each"
  - "pollDemo rawJson encodes five_hour/seven_day utilization for parseSnapshot read-back"
  - "collector-singleton.ts demo seeder uses insertSnapshot (no raw SQL INSERT)"
affects:
  - "01-05 analysis layer — reads snapshots via parseSnapshot, no more typed columns"
  - "Any code that calls insertSnapshot or reads demo-seeded data"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Demo utilization encoded as JSON object in raw_json: { five_hour: { utilization, resets_at }, seven_day: { utilization, resets_at } }"
    - "pollDemo read-back via parseSnapshot(row) instead of typed column access"
    - "insertSnapshot used inside db.transaction() wrapper — safe for better-sqlite3 synchronous API"

key-files:
  created: []
  modified:
    - "claude-usage-tracker/src/lib/collector.ts"
    - "claude-usage-tracker/src/lib/collector-singleton.ts"

key-decisions:
  - "pollDemo encodes utilization into raw_json as { five_hour: { utilization, resets_at }, seven_day: { utilization, resets_at } } — this shape passes normalizeUsagePayload's isUsageBucket check so parseSnapshot can decode it"
  - "normalizeUsagePayload stays in collector.ts for in-memory delta computation (computePollingDelta) — only removed from insertSnapshot call sites"
  - "insertSnapshot calls inside db.transaction() in the seeder are safe: better-sqlite3 transactions are synchronous and nestable"

patterns-established:
  - "Pattern: All insertSnapshot call sites use exactly 6 named fields — timestamp, status, endpoint, responseStatus, rawJson, errorMessage"
  - "Pattern: Demo data utilization encoded in raw_json, not typed columns; read path always uses parseSnapshot"

requirements-completed:
  - DATA-01

# Metrics
duration: 12min
completed: 2026-04-19
---

# Phase 01 Plan 04: Collector Write Path Simplification Summary

**Write path fully decoupled from dropped columns — all 4 insertSnapshot call sites reduced to 6 fields; demo seeder uses insertSnapshot with structured raw_json instead of raw SQL with 11 old columns.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-04-19T00:00:00Z
- **Completed:** 2026-04-19T00:12:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Removed all 9 structured-column params (authMode, fiveHourUtilization, fiveHourResetsAt, sevenDayUtilization, sevenDayResetsAt, extraUsageEnabled, extraUsageMonthlyLimit, extraUsageUsedCredits, extraUsageUtilization) from 4 insertSnapshot call sites in collector.ts
- pollDemo now encodes utilization values into raw_json as a structured JSON object parseable by normalizeUsagePayload/parseSnapshot; read-back uses parseSnapshot instead of typed column access
- collector-singleton.ts demo seeder replaced raw SQL INSERT (11 columns) with insertSnapshot calls using structured raw_json inside the existing db.transaction() wrapper

## Task Commits

Each task was committed atomically:

1. **Task 1: Simplify collector.ts write path** - `a35c029` (feat)
2. **Task 2: Update collector-singleton.ts demo seeder** - `5a1ebfa` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `claude-usage-tracker/src/lib/collector.ts` — 4 insertSnapshot call sites simplified to 6 fields; pollDemo uses parseSnapshot for read-back; parseSnapshot import added
- `claude-usage-tracker/src/lib/collector-singleton.ts` — raw SQL INSERT replaced with insertSnapshot + structured raw_json

## Decisions Made
- Demo utilization encoded as `{ five_hour: { utilization, resets_at }, seven_day: { utilization, resets_at } }` in raw_json — this shape is recognized by `normalizeUsagePayload`'s window detection, so `parseSnapshot` can decode it without special-casing the demo path
- `normalizeUsagePayload` retained in collector.ts for in-memory delta computation only; removed only from DB write parameters
- `insertSnapshot` called inside `db.transaction()` in the seeder — safe because better-sqlite3 is synchronous

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Write path is now fully consistent with the simplified schema (no code writes to dropped columns)
- Plan 05 (analysis layer) can safely call `parseSnapshot`/`parseSnapshots` for all read-side computation
- TypeScript compiles both files without errors; all 16 db/queries tests pass

---
*Phase: 01-foundation-db-refactor*
*Completed: 2026-04-19*
