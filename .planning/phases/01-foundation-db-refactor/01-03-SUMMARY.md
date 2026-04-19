---
phase: 01-foundation-db-refactor
plan: "03"
subsystem: database
tags: [sqlite, typescript, parsing, raw_json, normalization]

# Dependency graph
requires:
  - phase: 01-02
    provides: "simplified 7-column SnapshotRow schema with raw_json TEXT column and normalizeUsagePayload"
provides:
  - "queries.ts: ParsedSnapshot interface, parseSnapshot, parseSnapshots pure functions"
  - "queries.test.ts: 10-test DATA-06 coverage for cookie-auth, bearer-auth, demo, extra_usage, malformed JSON"
affects:
  - "01-05 (analysis.ts refactor — switches from typed columns to parseSnapshot)"
  - "Any consumer of SnapshotRow that needs typed derived fields"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Read-side parsing layer: raw_json -> ParsedSnapshot via pure functions"
    - "Cookie-auth vs bearer-auth detection via presence of 'usage' key in payload"
    - "Cents-to-dollars conversion: Math.round(cents) / 100"
    - "Null-safe JSON.parse via safeParseRaw wrapper"

key-files:
  created:
    - "claude-usage-tracker/src/lib/queries.ts"
    - "claude-usage-tracker/test/queries.test.ts"
  modified: []

key-decisions:
  - "ParsedSnapshot field names mirror old typed-column names exactly, so analysis.ts switch-over in plan 05 requires minimal changes"
  - "centsToDollars applied only to monthlyLimit and usedCredits (not utilization, which is already a ratio)"
  - "safeParseRaw returns null for both null input and JSON.parse failures — no throw, all derived fields gracefully null"
  - "Cookie-auth unwrap: presence of 'usage' key at root is the sole discriminator"

patterns-established:
  - "safeParseRaw pattern: null guard + try/catch returning null on both branches"
  - "normalizeUsagePayload called with unwrapped usagePayload regardless of auth mode"

requirements-completed:
  - DATA-06

# Metrics
duration: 12min
completed: 2026-04-19
---

# Phase 01 Plan 03: queries.ts Read-Side Parser Summary

**Pure read-side parsing layer that converts raw_json SnapshotRow into ParsedSnapshot, handling cookie-auth and bearer-auth payloads and converting extra_usage cents to dollars**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-04-19T00:00:00Z
- **Completed:** 2026-04-19T00:12:00Z
- **Tasks:** 2 (TDD: RED then GREEN)
- **Files modified:** 2 created

## Accomplishments

- Created `queries.ts` with `ParsedSnapshot` interface, `parseSnapshot`, and `parseSnapshots` pure functions — no DB access, no side effects
- Created `queries.test.ts` with 10 test cases covering all DATA-06 scenarios: null raw_json, bearer-auth, cookie-auth, demo, cents-to-dollars, absent extra_usage, malformed JSON, boolean is_enabled, empty array, 2-row array
- All 10 tests pass (exit 0); TypeScript reports no errors on queries.ts

## Task Commits

Each task committed atomically:

1. **Task 1: Create queries.test.ts (TDD RED)** — `296b615` (test)
2. **Task 2: Create queries.ts (TDD GREEN)** — `1d43d23` (feat)

**Plan metadata:** (docs commit follows)

_Note: TDD plan — test commit first (RED, import fails), then implementation commit (GREEN, 10/10 pass)_

## Files Created/Modified

- `claude-usage-tracker/src/lib/queries.ts` — ParsedSnapshot interface + parseSnapshot + parseSnapshots pure functions
- `claude-usage-tracker/test/queries.test.ts` — 10 test cases for DATA-06 coverage

## Decisions Made

- `ParsedSnapshot` field names mirror the old typed-column names exactly so plan 05's `analysis.ts` refactor is a minimal rename, not a rewrite
- `centsToDollars` arrow: `Math.round(cents) / 100` — rounds before dividing to avoid floating-point drift at the cent level (e.g., 283 cents -> 2.83 exactly)
- Cookie-auth detection: presence of `"usage"` key at payload root is the sole discriminator; no auth_mode column needed since it was removed in plan 02

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

- `db.test.ts` fails with `Cannot find module 'better-sqlite3'` when run via `npx tsx` outside the tracker's node_modules context. This is a pre-existing environment issue unrelated to plan 03 work. `queries.test.ts` passes all 10 tests independently.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `queries.ts` is ready for import by `analysis.ts` (plan 05)
- `ParsedSnapshot` provides the same field names as the old typed columns, so the switch-over is drop-in at the call site
- No blockers

---
*Phase: 01-foundation-db-refactor*
*Completed: 2026-04-19*
