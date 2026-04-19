---
phase: 01-foundation-db-refactor
plan: 02
subsystem: database
tags: [sqlite, schema-migration, better-sqlite3, tdd]
dependency_graph:
  requires: []
  provides: [simplified-usage-snapshots-schema, idempotent-migrator, narrowed-SnapshotRow, 6-field-insertSnapshot]
  affects: [collector.ts, analysis.ts, queries.ts]
tech_stack:
  added: []
  patterns: [idempotent-migration-via-app_meta, CREATE-COPY-DROP-RENAME, db.transaction-wrapping-DDL]
key_files:
  created: []
  modified:
    - claude-usage-tracker/src/lib/db.ts
    - claude-usage-tracker/test/db.test.ts
decisions:
  - "auth_mode string literal retained inside migrator PRAGMA check to detect old-schema databases — not a schema column"
  - "npm install run in worktree claude-usage-tracker to unblock tsx test runner (missing node_modules)"
metrics:
  duration_seconds: 250
  completed_date: "2026-04-19"
  tasks_completed: 2
  files_modified: 2
---

# Phase 1 Plan 2: DB Schema Simplification — Simplified schema, idempotent migrator, narrowed SnapshotRow, 6-field insertSnapshot

**One-liner:** Simplified usage_snapshots to 7 columns with a CREATE/COPY/DROP/RENAME idempotent migrator guarded by app_meta schema_version='simplified-v1', narrowed SnapshotRow interface, and 6-field insertSnapshot — all verified by 6 passing tests.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Rewrite db.ts — simplified schema, SnapshotRow, insertSnapshot, migrator | c6272f5 | claude-usage-tracker/src/lib/db.ts |
| 2 | Update db.test.ts — fix insert helper, add DATA-02/DATA-05, remove stale test | 04f7ccc | claude-usage-tracker/test/db.test.ts |

## What Was Built

### db.ts changes
- **SCHEMA** reduced from 12 columns to 7: `id, timestamp, status, endpoint, response_status, raw_json, error_message`
- **MIGRATIONS constant** deleted entirely (4 ALTER TABLE ADD COLUMN statements for extra_usage_* columns)
- **migrateExtraUsageMoneyToDollars** function deleted entirely
- **migrateToSimplifiedSchema** added: idempotent function checked via `app_meta.schema_version='simplified-v1'`; uses PRAGMA table_info to detect old-schema (auth_mode column present), then runs CREATE/COPY/DROP/RENAME inside a `db.transaction()` for atomicity; always writes schema_version and migrated_at markers
- **getDb** simplified: removed MIGRATIONS for-loop, removed migrateExtraUsageMoneyToDollars call, added migrateToSimplifiedSchema(db) call
- **SnapshotRow interface** narrowed from 16 fields to 7 fields matching the new schema
- **insertSnapshot data parameter** narrowed from 15 fields to 6: timestamp, status, endpoint, responseStatus, rawJson, errorMessage

### db.test.ts changes
- **insert helper** updated to 6-field signature (removed authMode, fiveHour*, sevenDay*, extraUsage*)
- **"inserts and retrieves snapshots" test** cleaned of stale five_hour_* assertions
- **"filters by since, until, and status" test** cleaned of stale fiveHourUtilization field in insert calls
- **"stores extra usage amounts in dollars" test** deleted (references removed fields)
- **DATA-02 test added**: PRAGMA table_info(usage_snapshots) returns exactly 7 columns in correct order
- **DATA-05 test added**: migrator is idempotent — schema_version set to simplified-v1; calling getDb twice produces exactly one schema_version row

## Verification Results

```
# tests 6
# pass 6
# fail 0
```

All acceptance criteria met:
- `grep -n "MIGRATIONS" db.ts` → nothing
- `grep -n "migrateExtraUsageMoneyToDollars" db.ts` → nothing
- `grep -n "five_hour_utilization" db.ts` → nothing
- `grep -c "simplified-v1" db.ts` → 2
- `grep -c "migrateToSimplifiedSchema" db.ts` → 2
- `grep -n "responseStatus" db.ts` → present in signature and .run() call
- `npx tsc --noEmit | grep "src/lib/db.ts:"` → nothing (no TS errors in db.ts)
- `grep -n "fiveHourUtilization" db.test.ts` → nothing
- `grep -n "extraUsageEnabled|extraUsageMonthlyLimit" db.test.ts` → nothing
- `grep -c "simplified-v1" db.test.ts` → 2
- `grep -c "PRAGMA table_info" db.test.ts` → 1

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Missing node_modules in worktree claude-usage-tracker**
- **Found during:** Task 1 verification (running npx tsx --test)
- **Issue:** `Cannot find module 'better-sqlite3'` — worktree had no node_modules
- **Fix:** Ran `npm install` in `claude-usage-tracker/` directory
- **Files modified:** none (node_modules is untracked)
- **Commit:** N/A (dependency install, not committed)

### Notes on auth_mode in db.ts

The `grep -c "auth_mode\|..."` check returns 1 because `"auth_mode"` appears as a string literal inside `migrateToSimplifiedSchema` to identify old-schema databases via PRAGMA table_info. This is intentional — the migrator must detect whether the old column exists to decide whether to run the CREATE/COPY/DROP/RENAME path. It is not a schema column, not an interface field, and not part of any INSERT/SELECT.

## Threat Model Compliance

| Threat | Mitigation Applied |
|--------|--------------------|
| T-02-01: Tampering via DROP TABLE in migration | Entire migration wrapped in `db.transaction()` — atomic rollback on any failure |
| T-02-04: SQL injection via insertSnapshot data | All values bound via parameterized `?` placeholders — no string interpolation |

## Known Stubs

None. Both files are complete implementations with no placeholder values, TODO comments, or hardcoded empty data flowing to UI.

## Self-Check: PASSED

- `claude-usage-tracker/src/lib/db.ts` — exists, verified
- `claude-usage-tracker/test/db.test.ts` — exists, verified
- Commit c6272f5 — confirmed in git log
- Commit 04f7ccc — confirmed in git log
- All 6 tests pass (exit 0)
