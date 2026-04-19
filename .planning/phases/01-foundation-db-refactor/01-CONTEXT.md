# Phase 1: Foundation & DB Refactor - Context

**Gathered:** 2026-04-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Delete the two legacy directories (`Claude Message Sender/` and the stale root `claude-usage-tracker/`), land the simplified `usage_snapshots` schema with a one-shot idempotent migrator, move normalization from the write path to a new `queries.ts` read path, and fully simplify `collector.ts` — all while keeping every existing dashboard panel rendering correctly off the new read path.

</domain>

<decisions>
## Implementation Decisions

### Stale root cleanup
- **D-01:** No data preservation needed. Delete the untracked `claude-usage-tracker/` at repo root and the `Claude Message Sender/` directory outright — no migration of `.env.local` or SQLite files required.
- **D-02:** After cleanup, `Claude Usage Tracker/claude-usage-tracker/` is the one canonical tracker tree. No restructuring of that path in Phase 1; folder cleanup happens organically in later phases as merged functionality is built.

### Schema simplification
- **D-03:** `usage_snapshots` drops to exactly 7 columns: `(id, timestamp, status, endpoint, response_status, raw_json, error_message)` plus indexes on `timestamp` and `status`. Dropped columns (`auth_mode`, `five_hour_utilization`, `five_hour_resets_at`, `seven_day_utilization`, `seven_day_resets_at`, `extra_usage_enabled`, `extra_usage_monthly_limit`, `extra_usage_used_credits`, `extra_usage_utilization`) are redundant extracts already captured in `raw_json`.
- **D-04:** Migration approach: CREATE `usage_snapshots_new` → COPY the 7 surviving columns from the old table → DROP old → RENAME new. All inside a single transaction. Idempotent via `app_meta.schema_version='simplified-v1'` marker. No re-fetch from claude.ai.

### Collector write path — full simplification
- **D-05:** Phase 1 does the full write-path cleanup, not just a minimal INSERT fix. Remove the `normalizeUsagePayload` call from `collector.ts` (it no longer belongs on the write side). Simplify `insertSnapshot` to accept and write only the 7 new columns. Strip out all structured-field extraction (`fiveHourUtilization`, `fiveHourResetsAt`, `sevenDayUtilization`, `sevenDayResetsAt`, `extraUsage*`) from the collector.

### Read path — queries.ts
- **D-06:** Create `src/lib/queries.ts` as the single read-side module. It uses `JSON.parse(row.raw_json)` + the existing `normalizeUsagePayload` to extract the values that `analysis.ts` currently reads from typed columns. `analysis.ts` is updated to go through `queries.ts` instead of reading columns directly. `normalize.ts` stays pure and untouched — it just moves from write-side to read-side caller.
- **D-07:** `queries.ts` scope in Phase 1 is the minimum needed to keep existing dashboard panels rendering — heatmap, hourly bars, usage timeline, extra-usage card. No future-phase helpers (peak detector inputs, schedule queries) included yet.

### Claude's Discretion
- Exact SQL for `queries.ts` helpers (`json_extract` vs `JSON.parse` per query — whichever is cleaner per case)
- How `SnapshotRow` TypeScript interface is redefined to match the 7-column schema
- Whether `analysis.ts` is refactored in-place or thin-wrapped via `queries.ts` return types

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design spec (primary source of truth)
- `2026-04-16-tracker-sender-merge-design.md` §5 — Full DB schema, migration procedure, `app_meta` key list, `queries.ts` read-path design
- `2026-04-16-tracker-sender-merge-design.md` §8 — Migration plan sequencing (Phase 1 = step 1: DB refactor)

### Requirements
- `.planning/REQUIREMENTS.md` — DATA-01, DATA-02, DATA-05, DATA-06, UI-08, DEPLOY-06 (the 6 requirements this phase covers)

### Existing code to understand before changing
- `Claude Usage Tracker/claude-usage-tracker/src/lib/db.ts` — Current schema (15 columns), existing SCHEMA/MIGRATIONS constants, `insertSnapshot` signature
- `Claude Usage Tracker/claude-usage-tracker/src/lib/analysis.ts` — All column reads that must migrate to `queries.ts`
- `Claude Usage Tracker/claude-usage-tracker/src/lib/collector.ts` — Write path to simplify (normalizeUsagePayload call + structured-field extraction)
- `Claude Usage Tracker/claude-usage-tracker/src/lib/normalize.ts` — Pure function that moves to read-side caller; do not change its signature

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/normalize.ts` (`normalizeUsagePayload`): Pure function. Move the call from collector.ts to queries.ts — no changes to the function itself.
- `src/lib/usage-window.ts` (`computeUsageDelta`): Pure function used in `analysis.ts`; stays untouched. `queries.ts` or updated `analysis.ts` will still call it with parsed values.
- `src/lib/db.ts` (`getDb`, `querySnapshots`): `getDb` stays; `querySnapshots` return type changes to the new 7-column `SnapshotRow`.

### Established Patterns
- Idempotent migration via `app_meta` key-value check: already used in `db.ts` (`migrateExtraUsageMoneyToDollars`). Phase 1 migrator follows the same pattern.
- `better-sqlite3` synchronous API with WAL mode: unchanged.
- Named exports only; no default exports in lib files.
- `function` keyword for top-level named functions; `camelCase` verb-first naming.

### Integration Points
- `src/instrumentation.ts` → `collector-singleton.ts` → `collector.ts`: the write path. Phase 1 simplifies `collector.ts` and `db.ts`; `instrumentation.ts` itself is untouched.
- `src/app/api/dashboard/route.ts` → `analysis.ts` → `db.ts`: the read path. Phase 1 inserts `queries.ts` between `analysis.ts` and the raw `SnapshotRow` columns.
- All 4 API routes (`/dashboard`, `/poll`, `/snapshots`) and dashboard components remain externally unchanged — same JSON shapes out.

</code_context>

<specifics>
## Specific Ideas

- "There's no data to preserve in the stale root — just delete it." (Area 1 discussion)
- The legacy directory structure is an artifact of renaming the project from `claude-usage-tracker` to `claude-usage-optimizer` while merging two subprojects. Phase 1 deletes the junk; later phases will reshape the canonical tree as new functionality is built.

</specifics>

<deferred>
## Deferred Ideas

- Moving the canonical app from `Claude Usage Tracker/claude-usage-tracker/` to a flat path — will happen organically as the merged functionality is built in later phases.
- `queries.ts` helpers for peak detection inputs (snapshots → hourly buckets) — Phase 2 scope.
- `send_log` and `app_meta` additional key writes — Phase 3/4 scope.

</deferred>

---

*Phase: 01-foundation-db-refactor*
*Context gathered: 2026-04-19*
