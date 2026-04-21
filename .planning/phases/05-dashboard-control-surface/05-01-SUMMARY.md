---
phase: 05
plan: 01
subsystem: Dashboard API Layer
tags: [api, data-layer, schedule, history]
requires: [04-scheduler-wiring]
provides: [dashboard-data-with-schedule, app-meta-control]
affects: [05-02-dashboard-ui, 05-03-dashboard-forms]
tech_stack:
  added: []
  patterns: [REST API, data-from-db, schedule-recompute]
decision_refs: [D-01, D-02]
key_files:
  created:
    - src/app/api/app-meta/route.ts
  modified:
    - src/lib/analysis.ts
    - src/lib/db.ts
    - src/lib/scheduler.ts
duration: ~25 minutes
completed_date: 2026-04-21T23:39:10Z
---

# Phase 5 Plan 01: Dashboard API Layer Summary

**Objective:** Extend the dashboard API layer to surface schedule state and send history. Add a `PATCH /api/app-meta` endpoint that atomically writes override values, immediately recomputes the schedule, and returns the new schedule to the client.

**One-liner:** Dashboard now returns schedule data and send history; PATCH endpoint enables UI control of overrides with instant recompute.

## Completed Tasks

All 6 tasks completed successfully. No checkpoints or blockers encountered.

| Task | Name | Status | Commit |
|------|------|--------|--------|
| 1 | Extend DashboardData type with schedule and send history | ✓ | c07abe2 |
| 2 | Update buildDashboardData to compute schedule and send history | ✓ | c07abe2 |
| 3 | Ensure send_log query helper exists in db.ts | ✓ | c07abe2 |
| 4 | Update GET /api/dashboard to return extended DashboardData | ✓ | c07abe2 |
| 5 | Create PATCH /api/app-meta endpoint for override writes and recompute | ✓ | f3ee57b |
| 6 | Verify setAppMeta and recomputeSchedule helpers exist | ✓ | f3ee57b |

## Implementation Details

### Task 1-2: Extended DashboardData Type and buildDashboardData

**Added types:**
- `ScheduleData` interface with fields:
  - `peakBlock: { startHour, endHour, midpoint, sumDelta } | null` — peak block detection result
  - `scheduleFires: FireTime[]` — today's 5 scheduled sends in user-local time
  - `tomorrowFires: FireTime[]` — tomorrow's schedule (for preview)
  - `scheduleGeneratedAt: string | null` — timestamp of last recompute
  - `isPaused: boolean` — global pause state from app_meta

- `SendLogEntry` interface for UI display:
  - `id, firedAt, scheduledFor, status, durationMs, question, responseExcerpt`
  - Maps send_log rows to client-friendly format

**Extended DashboardData:**
- Added `scheduleData: ScheduleData` field
- Added `sendHistory: SendLogEntry[]` field (last 20 rows from send_log)

**buildDashboardData updates:**
- Reads app_meta for peak_block, schedule_fires, schedule_generated_at, paused
- Parses JSON fields with fallbacks (null for missing peak_block, [] for missing fires)
- Queries send_log with limit=20 and descending order, reverses for correct display order
- Transforms SendLogRow to SendLogEntry format with status enum mapping

### Task 3: Database Query Helpers

**Added functions to db.ts:**
- `getAppMeta(config)`: Returns Map<string, string> of all app_meta rows
- `setAppMeta(config, key, value)`: Upserts a single key-value pair (ON CONFLICT DO UPDATE)
- `querySendLog(config, opts?)`: Queries send_log with optional limit and orderDesc flags

### Task 4: GET /api/dashboard Extension

**No changes required.** The existing GET handler already calls `buildDashboardData()`. Since `buildDashboardData` now computes schedule and send history, the response automatically includes:
- `scheduleData` with peak block, today's fires, tomorrow's fires, generation timestamp, pause state
- `sendHistory` with last 20 send attempts

Response shape validated by TypeScript build.

### Task 5-6: PATCH /api/app-meta Endpoint

**New file: src/app/api/app-meta/route.ts**

Implements PATCH handler that:
1. Validates request body: `{ key: string, value: string }`
2. Calls `setAppMeta(config, key, value)` to persist override
3. Calls `recomputeSchedule(config)` to regenerate schedule_fires immediately
4. Returns success response with newly computed scheduleFires array

**New function in scheduler.ts: `recomputeSchedule(config, nowFn?)`**

Extracted schedule recomputation logic from `runTick()` into a standalone function that:
- Reads timezone, anchor offset, default seed time, override start time from app_meta
- Queries all ok snapshots and runs peak detection
- Generates 5-fire schedule and converts to UTC ISO timestamps
- Writes schedule_fires, peak_block, schedule_generated_at, schedule_fires_done to app_meta
- Logs recompute event and propagates errors to caller

Supported override keys (per REQUIREMENTS.md DATA-04):
- `schedule_override_start_time` (format "HH:MM")
- `peak_window_hours` (integer 3–6)
- `anchor_offset_minutes` (integer 0–15)
- `default_seed_time` (format "HH:MM")
- `user_timezone` (IANA timezone name or UTC offset)
- `paused` ("true" or "false" string)

Error handling: 400 for missing fields, 500 for exceptions. Both log to console for debugging.

## Architecture Integration

**Data Flow:**
```
GET /api/dashboard
  ↓ calls buildDashboardData()
  ↓ reads app_meta (peak_block, schedule_fires, paused, etc.)
  ↓ queries send_log (limit 20, desc)
  ↓ returns DashboardData with scheduleData + sendHistory

PATCH /api/app-meta { key, value }
  ↓ writes to app_meta via setAppMeta()
  ↓ calls recomputeSchedule()
  ↓ reads snapshots, detects peak, generates schedule
  ↓ writes schedule_fires + peak_block to app_meta
  ↓ returns response with new scheduleFires
```

**Dependencies:**
- `analysis.ts` → imports from `db.ts`, `schedule.ts`, `config.ts`
- `scheduler.ts` → exports `recomputeSchedule`, imports from `db.ts`, `peak-detector.ts`, `schedule.ts`, `queries.ts`
- `app-meta/route.ts` → imports from `db.ts`, `scheduler.ts`

## Verification & Testing

**Build verification:**
- TypeScript compilation: ✓ No errors
- Next.js build: ✓ All routes registered including `/api/app-meta`
- Import validation: ✓ All functions exported and imported correctly

**API routes verified:**
- GET /api/dashboard → registered, returns extended DashboardData shape
- PATCH /api/app-meta → registered, accepts JSON body, returns success response

**Known stubs:** None. All fields have sensible defaults (null for missing peak_block, empty arrays for missing schedules, empty send history if no rows).

## Requirements Traceability

| Requirement | Task | Implementation |
|-------------|------|-----------------|
| UI-01: Data for peak block and today's 5 fires | 1-2 | `ScheduleData.peakBlock, scheduleFires` |
| UI-02: Data for override fields | 3-4 | `app_meta` read via `getAppMeta()` |
| UI-03: Override writes trigger recompute | 5-6 | `PATCH /api/app-meta` + `recomputeSchedule()` |

## Deviations from Plan

None. Plan executed exactly as written.

- All helpers (getAppMeta, setAppMeta, querySendLog, recomputeSchedule) created or verified to exist
- Type extensions follow existing conventions (PascalCase interfaces, nullable fields where appropriate)
- API route follows existing patterns (named exports, force-dynamic, error handling)
- Schedule recomputation logic extracted cleanly from scheduler tick

## Next Steps (Blocked on)

Plan 05-02 (Dashboard UI) can now proceed with:
- Schedule display components consuming `scheduleData`
- Send history panel consuming `sendHistory`
- Real-time schedule preview via tomorrow's fires

Plan 05-03 (Dashboard Forms) can proceed with:
- Form inputs wired to PATCH /api/app-meta
- Real-time schedule update on override change
- Validation of override values before submission

---

**Status:** COMPLETE  
**All tasks committed.** Ready for verifier and next plan in sequence.
