# Phase 1: Foundation & DB Refactor - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-19
**Phase:** 01-foundation-db-refactor
**Areas discussed:** Stale root data, Collector write path, App tree location

---

## Stale Root Data

| Option | Description | Selected |
|--------|-------------|----------|
| Canonical is active | `Claude Usage Tracker/claude-usage-tracker/` is active — stale root is leftovers | |
| Stale root is active | Root-level `claude-usage-tracker/` has newer data, needs migration | |
| No data to preserve | Treat as empty; just delete | ✓ |

**User's choice:** No data preservation needed — "don't worry about active tracker, let's just consider there's no data right now."
**Notes:** Delete the untracked root `claude-usage-tracker/` and `Claude Message Sender/` outright. No `.env.local` or SQLite migration required.

---

## Schema Simplification (Area 2 — Collector write path)

| Option | Description | Selected |
|--------|-------------|----------|
| Full simplification | Strip normalize call + structured fields from collector.ts; move to read path | ✓ |
| Minimum viable | Only fix INSERT to write 7 columns; leave compute logic in collector.ts | |

**User's choice:** Full simplification.
**Notes:** User initially asked "why is the schema dropping to 7 columns?" — explained that the dropped columns are redundant extracts already captured in `raw_json`. User then asked "what is status and endpoint?" — explained these are poll-attempt metadata not derivable from `raw_json`. User confirmed understanding and locked in the 7-column schema.

---

## App Tree Location

| Option | Description | Selected |
|--------|-------------|----------|
| Leave at current path | `Claude Usage Tracker/claude-usage-tracker/` stays as-is for Phase 1 | ✓ |
| Move to flat path | Rename to `tracker/` or similar during Phase 1 | |

**User's choice:** Leave current path; restructuring happens organically.
**Notes:** User clarified the directory structure is an artifact of renaming the project from `claude-usage-tracker` to `claude-usage-optimizer` while merging sender + tracker. Plan is to delete legacy folders and build merged functionality in-place; no explicit move step needed in Phase 1.

---

## Claude's Discretion

- Exact SQL helpers in `queries.ts` (`json_extract` vs `JSON.parse` per query)
- How `SnapshotRow` TypeScript interface is redefined
- Whether `analysis.ts` is refactored in-place or thin-wrapped

## Deferred Ideas

- Flat path restructuring (`tracker/` at root) — deferred to later phases
- `queries.ts` helpers for peak detection (Phase 2 scope)
