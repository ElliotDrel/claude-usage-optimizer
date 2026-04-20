---
phase: 03-sender-module
plan: "03"
subsystem: api
tags: [nextjs, route-handler, sqlite, claude-cli, send-log]

# Dependency graph
requires:
  - phase: 03-sender-module
    provides: "03-01: send_log DDL + insertSendLog(); 03-02: send() function + QUESTIONS constant"
provides:
  - "POST /api/send-now HTTP endpoint that triggers a manual claude CLI send and returns the send_log row as JSON"
affects: [04-scheduler-wiring, 05-dashboard-control-surface]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Next.js route handler with dynamic=force-dynamic for non-cached POST endpoints"
    - "Minimal route handler: getConfig() → send() → NextResponse.json(result), error → 500"

key-files:
  created:
    - src/app/api/send-now/route.ts
  modified: []

key-decisions:
  - "No request body parsed — send() always uses defaults (D-05: manual fires write scheduled_for=NULL, is_anchor=0)"
  - "dynamic=force-dynamic ensures every POST triggers a fresh send, bypassing Next.js static caching"

patterns-established:
  - "Route handler pattern: export const dynamic + named HTTP method export + NextResponse.json"

requirements-completed: [SEND-01, SEND-05]

# Metrics
duration: ~15min
completed: 2026-04-20
---

# Phase 3 Plan 03: Send-Now Route Summary

**POST /api/send-now route wired to send() — manually invokable via curl, returns full SendLogRow JSON, verified live with status=ok and D-05 fields confirmed (scheduled_for=null, is_anchor=0)**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-04-20T19:20:00Z (estimated)
- **Completed:** 2026-04-20T19:37:45Z
- **Tasks:** 1 (+ checkpoint verification)
- **Files modified:** 1

## Accomplishments

- Created `src/app/api/send-now/route.ts` — minimal Next.js POST handler calling `send(config)` and returning `SendLogRow` as JSON
- Verified end-to-end: `curl -X POST http://localhost:3017/api/send-now` returned HTTP 200 with a complete `send_log` row (`status="ok"`, `duration_ms=30624`, real claude CLI response excerpt)
- D-05 confirmed: `scheduled_for=null` and `is_anchor=0` in live response — manual fires are correctly distinguished from scheduled fires

## Task Commits

1. **Task 1: Create POST /api/send-now route handler** - `931f417` (feat)

**Plan metadata:** *(this document)*

## Files Created/Modified

- `src/app/api/send-now/route.ts` — POST handler: `export const dynamic = "force-dynamic"`, calls `send(getConfig())`, returns `NextResponse.json(result)` on 200, `{ error }` + 500 on catch. ~20 lines.

## Decisions Made

- No request body is parsed. `send()` always fires with default options — this honors D-05 (manual fires write `scheduled_for=NULL`, `is_anchor=0`) and keeps the route to minimal surface area.
- `dynamic = "force-dynamic"` is exported at the module level to prevent Next.js from caching the route as a static response; every POST must hit the handler.

## Deviations from Plan

### Additional Work (Outside Plan Tasks)

**1. Repo restructure — app moved from subdirectory to repo root**
- **Occurred during:** Phase 3 (parallel to plan execution)
- **What happened:** Entire app was moved from `claude-usage-tracker/` subdirectory to the repo root. All `src/`, `test/`, `scripts/`, config files, and `package.json` are now at root.
- **Committed as:** `cdc1f11` — `refactor: move app to repo root — retire claude-usage-tracker/ subdirectory`
- **Impact:** No source code changes; import paths and conventions unchanged. Dev/prod scripts and CLAUDE.md Quick Reference already reflect root-level paths.

**2. npm audit fix — Next.js bumped from 16.2.2 to 16.2.4**
- **Occurred during:** Phase 3 (post-restructure)
- **What happened:** `npm audit fix --force` was run after the move to resolve all dependency vulnerabilities. Next.js bumped from 16.2.2 → 16.2.4; 0 vulnerabilities remaining.
- **Committed as:** `f98143c` — `fix: update next dependency version to ^16.2.4`
- **Impact:** Minor version bump; no breaking changes to application code.

---

**Total deviations:** 0 auto-fixes to plan tasks. 2 additional items (repo restructure + audit fix) occurred outside plan scope and were pre-committed before this plan ran.
**Impact on plan:** None — plan executed exactly as written for its defined scope.

## Issues Encountered

None. Route compiled cleanly, `send()` invoked successfully, sqlite row written on first curl test.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Phase 3 is complete: `send_log` DDL, `insertSendLog()`, `send()`, `QUESTIONS`, and `POST /api/send-now` are all live and tested.
- Phase 4 (Scheduler Wiring) can now import `send()` from `sender.ts` and register the 60s tick loop in `instrumentation.ts`. The `app_meta` keys (`schedule_fires`, `schedule_fires_done`, etc.) need to be provisioned as part of Phase 4.
- No blockers.

---
*Phase: 03-sender-module*
*Completed: 2026-04-20*
