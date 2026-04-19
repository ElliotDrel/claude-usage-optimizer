# Phase 1: Foundation & DB Refactor - Research

**Researched:** 2026-04-19
**Domain:** SQLite schema migration, TypeScript read/write path refactor, repo cleanup
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** No data preservation needed. Delete the untracked `claude-usage-tracker/` at repo root and the `Claude Message Sender/` directory outright — no migration of `.env.local` or SQLite files required.
- **D-02:** After cleanup, `Claude Usage Tracker/claude-usage-tracker/` is the one canonical tracker tree. No restructuring of that path in Phase 1; folder cleanup happens organically in later phases as merged functionality is built.
- **D-03:** `usage_snapshots` drops to exactly 7 columns: `(id, timestamp, status, endpoint, response_status, raw_json, error_message)` plus indexes on `timestamp` and `status`. Dropped columns (`auth_mode`, `five_hour_utilization`, `five_hour_resets_at`, `seven_day_utilization`, `seven_day_resets_at`, `extra_usage_enabled`, `extra_usage_monthly_limit`, `extra_usage_used_credits`, `extra_usage_utilization`) are redundant extracts already captured in `raw_json`.
- **D-04:** Migration approach: CREATE `usage_snapshots_new` → COPY the 7 surviving columns from the old table → DROP old → RENAME new. All inside a single transaction. Idempotent via `app_meta.schema_version='simplified-v1'` marker. No re-fetch from claude.ai.
- **D-05:** Phase 1 does the full write-path cleanup, not just a minimal INSERT fix. Remove the `normalizeUsagePayload` call from `collector.ts` (it no longer belongs on the write side). Simplify `insertSnapshot` to accept and write only the 7 new columns. Strip out all structured-field extraction (`fiveHourUtilization`, `fiveHourResetsAt`, `sevenDayUtilization`, `sevenDayResetsAt`, `extraUsage*`) from the collector.
- **D-06:** Create `src/lib/queries.ts` as the single read-side module. It uses `JSON.parse(row.raw_json)` + the existing `normalizeUsagePayload` to extract the values that `analysis.ts` currently reads from typed columns. `analysis.ts` is updated to go through `queries.ts` instead of reading columns directly. `normalize.ts` stays pure and untouched — it just moves from write-side to read-side caller.
- **D-07:** `queries.ts` scope in Phase 1 is the minimum needed to keep existing dashboard panels rendering — heatmap, hourly bars, usage timeline, extra-usage card. No future-phase helpers (peak detector inputs, schedule queries) included yet.

### Claude's Discretion
- Exact SQL for `queries.ts` helpers (`json_extract` vs `JSON.parse` per query — whichever is cleaner per case)
- How `SnapshotRow` TypeScript interface is redefined to match the 7-column schema
- Whether `analysis.ts` is refactored in-place or thin-wrapped via `queries.ts` return types

### Deferred Ideas (OUT OF SCOPE)
- Moving the canonical app from `Claude Usage Tracker/claude-usage-tracker/` to a flat path — will happen organically as the merged functionality is built in later phases.
- `queries.ts` helpers for peak detection inputs (snapshots → hourly buckets) — Phase 2 scope.
- `send_log` and `app_meta` additional key writes — Phase 3/4 scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DATA-01 | `usage_snapshots` persists the raw API payload verbatim in a `raw_json` column. | Already present in the old schema; new schema keeps it as the sole payload store. Confirmed in db.ts line 19. |
| DATA-02 | Simplified schema columns are exactly `(id, timestamp, status, endpoint, response_status, raw_json, error_message)` with indexes on `timestamp` and `status`. | Full current schema audited; migration SQL designed. |
| DATA-05 | A one-shot idempotent migrator runs at startup; preserves existing `raw_json`; marks completion via `schema_version='simplified-v1'`. | Existing `migrateExtraUsageMoneyToDollars` pattern maps directly to this. |
| DATA-06 | Dashboard read queries derive fields from `raw_json` via `json_extract` or `JSON.parse` + `normalizeUsagePayload`. | Full audit of every column read in `analysis.ts` completed; all mapped to JSON paths. |
| UI-08 | Existing dashboard panels (heatmap, hourly bars, usage timeline, extra-usage card) continue to render correctly under the new read path. | Every field consumed by each panel traced and covered by `queries.ts` design. |
| DEPLOY-06 | Python sender (`Claude Message Sender/`) and the stale root `claude-usage-tracker/` duplicate are deleted. | Directory contents and git status verified. Deletion scope documented below. |
</phase_requirements>

---

## Summary

Phase 1 is a pure structural refactor — no behavior changes, no new user-visible features. The deliverables are: (1) two directories deleted, (2) a narrower SQLite schema reached via an idempotent migrator that copies the surviving columns from the old table, (3) a new `queries.ts` module that replaces direct column reads with `JSON.parse(raw_json)` + `normalizeUsagePayload`, and (4) a simplified write path in `collector.ts` and `db.ts` that stores only the 7 new columns.

The current schema has 15 columns (11 original + 4 added by the MIGRATIONS constant). The 8 columns being dropped (`auth_mode`, `five_hour_utilization`, `five_hour_resets_at`, `seven_day_utilization`, `seven_day_resets_at`, `extra_usage_enabled`, `extra_usage_monthly_limit`, `extra_usage_used_credits`, `extra_usage_utilization`) are all derivable from `raw_json` at read time. The migration cannot use `ALTER TABLE DROP COLUMN` in older SQLite — the CREATE/COPY/DROP/RENAME pattern is the correct and only reliable approach.

The biggest risk is the test suite: 9 existing test files all use the old `SnapshotRow` interface with the 15-column shape. Every test that constructs a `SnapshotRow` via `makeSnapshot` or calls `insertSnapshot` must be updated. The `analysis.test.ts` file is the most impacted — all its `makeSnapshot` calls populate the old typed columns; after the refactor those snapshots must supply `raw_json` containing the equivalent data, which `queries.ts` will parse.

**Primary recommendation:** Implement the migrator first (safe, idempotent, purely additive to startup), then update `db.ts` types and `insertSnapshot`, then build `queries.ts`, then update `analysis.ts` to route through `queries.ts`, then update tests. Delete directories last to keep them available for reference until the rest compiles and tests pass.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Schema migration | DB layer (`db.ts`) | — | SQLite-level operation; runs at startup before any query |
| Raw payload storage | DB layer (`db.ts`, write path in `collector.ts`) | — | Collector writes; db.ts defines schema |
| Field extraction from raw_json | Read layer (`queries.ts`) | — | New module; bridges raw rows to typed values |
| Dashboard data assembly | Analysis layer (`analysis.ts`) | — | Consumes typed values from `queries.ts` |
| Directory deletion | Repo / filesystem | — | git rm operations, no code changes |

---

## Current State Audit

### Exact schema (15 columns)

```sql
-- Original SCHEMA constant in db.ts
CREATE TABLE usage_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ok',
  endpoint TEXT,
  auth_mode TEXT,               -- DROP
  response_status INTEGER,
  five_hour_utilization REAL,   -- DROP
  five_hour_resets_at TEXT,     -- DROP
  seven_day_utilization REAL,   -- DROP
  seven_day_resets_at TEXT,     -- DROP
  raw_json TEXT,
  error_message TEXT
);

-- Added by MIGRATIONS constant (4 ALTER TABLE ADD COLUMN statements)
-- extra_usage_enabled INTEGER   -- DROP
-- extra_usage_monthly_limit REAL -- DROP
-- extra_usage_used_credits REAL  -- DROP
-- extra_usage_utilization REAL   -- DROP
```

**Surviving columns (7):** `id`, `timestamp`, `status`, `endpoint`, `response_status`, `raw_json`, `error_message`
**Dropped columns (8):** `auth_mode`, `five_hour_utilization`, `five_hour_resets_at`, `seven_day_utilization`, `seven_day_resets_at`, `extra_usage_enabled`, `extra_usage_monthly_limit`, `extra_usage_used_credits`, `extra_usage_utilization`

### Current `SnapshotRow` interface (db.ts lines 91–108)

```typescript
export interface SnapshotRow {
  id: number;
  timestamp: string;
  status: string;
  endpoint: string | null;
  auth_mode: string | null;              // DROP
  response_status: number | null;
  five_hour_utilization: number | null;  // DROP
  five_hour_resets_at: string | null;   // DROP
  seven_day_utilization: number | null;  // DROP
  seven_day_resets_at: string | null;   // DROP
  extra_usage_enabled: number | null;   // DROP
  extra_usage_monthly_limit: number | null; // DROP
  extra_usage_used_credits: number | null;  // DROP
  extra_usage_utilization: number | null;   // DROP
  raw_json: string | null;
  error_message: string | null;
}
```

### Current `insertSnapshot` signature (db.ts lines 110–157)

Accepts 15 named fields; writes 15 columns. Full call sites:
- `collector.ts:232–248` — "no auth" error path
- `collector.ts:319–335` — success path (after `normalizeUsagePayload`)
- `collector.ts:376–392` — catch error path
- `collector.ts:474–490` — demo `pollDemo()` path
- `collector-singleton.ts:71–76` — demo seeding via raw `db.prepare().run()` (bypasses `insertSnapshot`)

### All `SnapshotRow` column reads in `analysis.ts`

`buildDashboardData` and its helpers read these columns directly:

| Column | Where in `analysis.ts` | What it's used for |
|--------|----------------------|-------------------|
| `five_hour_utilization` | `computeDelta()` line 123, `buildDashboardData` lines 319–323, `buildUsageInsights` line 188, `buildActivity` line 151 | 5h usage delta computation, current card, heatmap/bars |
| `five_hour_resets_at` | `computeDelta()` line 124, `buildDashboardData` line 322 | Window boundary comparison, current card |
| `seven_day_utilization` | `computeDelta()` line 123, `buildDashboardData` lines 325–329, `buildUsageInsights` line 189 | 7d usage delta, current card |
| `seven_day_resets_at` | `computeDelta()` line 124, `buildDashboardData` line 328 | 7d window boundary, current card |
| `extra_usage_enabled` | `buildDashboardData` line 333, `buildDashboardData` line 334 | extraUsage card enable flag |
| `extra_usage_monthly_limit` | `buildDashboardData` lines 313, 336, `buildExtraUsageInsights` lines 253–255, `buildExtraUsageInsights` line 283 | Budget totals, balance computation |
| `extra_usage_used_credits` | `buildDashboardData` lines 314, 338, `buildExtraUsageInsights` lines 257, 284, `buildActivity` line 152 | Credits spent, spend delta, activity contribution |
| `extra_usage_utilization` | `buildDashboardData` line 340 | extraUsage utilization percent |
| `raw_json` | `buildDashboardData` line 342 | `safeParseJson()` for rawJson field in current panel |

---

## Migration Path

### Idempotency check pattern

Follows existing `migrateExtraUsageMoneyToDollars` (db.ts lines 62–88) exactly:

```typescript
function migrateToSimplifiedSchema(db: Database.Database): void {
  const migrationKey = "schema_version";
  const current = db
    .prepare("SELECT value FROM app_meta WHERE key = ?")
    .get(migrationKey) as { value: string } | undefined;

  if (current?.value === "simplified-v1") {
    return; // Already done
  }
  // ... migration body
}
```

### Migration SQL (inside a single transaction)

```sql
-- Step 1: Create new table alongside old
CREATE TABLE usage_snapshots_new (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp       TEXT    NOT NULL,
  status          TEXT    NOT NULL,
  endpoint        TEXT,
  response_status INTEGER,
  raw_json        TEXT,
  error_message   TEXT
);

-- Step 2: Copy surviving columns (auth_mode, utilization cols, extra_usage cols are dropped)
INSERT INTO usage_snapshots_new
  (id, timestamp, status, endpoint, response_status, raw_json, error_message)
SELECT
  id, timestamp, status, endpoint, response_status, raw_json, error_message
FROM usage_snapshots;

-- Step 3: Drop old table
DROP TABLE usage_snapshots;

-- Step 4: Rename
ALTER TABLE usage_snapshots_new RENAME TO usage_snapshots;

-- Step 5: Recreate indexes (dropped with the old table)
CREATE INDEX IF NOT EXISTS idx_snapshots_timestamp ON usage_snapshots(timestamp);
CREATE INDEX IF NOT EXISTS idx_snapshots_status    ON usage_snapshots(status);

-- Step 6: Mark complete
INSERT INTO app_meta (key, value) VALUES ('schema_version', 'simplified-v1')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value;
INSERT INTO app_meta (key, value) VALUES ('migrated_at', datetime('now'))
  ON CONFLICT(key) DO UPDATE SET value = excluded.value;
```

**Critical note:** SQLite `ALTER TABLE DROP COLUMN` exists only in SQLite 3.35.0+ (2021). The project uses `better-sqlite3` which ships its own SQLite build, but the CREATE/COPY/DROP/RENAME pattern is universally portable and is what the design spec §5.5 prescribes. Use the pattern.

**`app_meta` table bootstrap:** The `app_meta` table is already created in the current SCHEMA constant. The migrator must handle the case where `app_meta` does not yet exist (fresh install with no existing db). The SCHEMA constant must continue to create `app_meta` with `CREATE TABLE IF NOT EXISTS`.

### Where migrator is called

`getDb()` already calls migrators sequentially (line 58: `migrateExtraUsageMoneyToDollars(db)`). Add `migrateToSimplifiedSchema(db)` before `migrateExtraUsageMoneyToDollars`. Once simplified schema is live, `migrateExtraUsageMoneyToDollars` is a no-op (the columns it updates no longer exist), so it should also be removed in the same change.

---

## queries.ts Design

### New `SnapshotRow` interface (7 columns)

```typescript
export interface SnapshotRow {
  id: number;
  timestamp: string;
  status: string;
  endpoint: string | null;
  response_status: number | null;
  raw_json: string | null;
  error_message: string | null;
}
```

### What `queries.ts` must provide

`analysis.ts` needs typed values for 9 formerly-typed columns. `queries.ts` provides them by parsing `raw_json` via `normalizeUsagePayload`.

**Strategy: hybrid.** For single-row lookups (current card), `JSON.parse` + `normalizeUsagePayload` in TypeScript is cleaner. For multi-row loops (heatmap, timeline, insights) the same approach applies — the loop already happens in TypeScript, so parse each row's `raw_json` inline. `json_extract` (SQLite function) is not needed because better-sqlite3's synchronous API makes per-row TypeScript parsing just as efficient and far more readable.

**Interface for parsed row values** (used by `analysis.ts`):

```typescript
// src/lib/queries.ts

import { normalizeUsagePayload } from "./normalize";

export interface ParsedSnapshot {
  // Identity columns (passthrough)
  id: number;
  timestamp: string;
  status: string;
  endpoint: string | null;
  response_status: number | null;
  error_message: string | null;
  raw_json: string | null;        // kept for the rawJson dashboard field

  // Derived from raw_json via normalizeUsagePayload
  five_hour_utilization: number | null;
  five_hour_resets_at: string | null;
  seven_day_utilization: number | null;
  seven_day_resets_at: string | null;
  extra_usage_enabled: boolean | null;
  extra_usage_monthly_limit: number | null;   // in dollars (normalizer returns cents; apply /100)
  extra_usage_used_credits: number | null;    // in dollars
  extra_usage_utilization: number | null;
}

export function parseSnapshot(row: SnapshotRow): ParsedSnapshot;
export function parseSnapshots(rows: SnapshotRow[]): ParsedSnapshot[];
```

**Why `ParsedSnapshot` mirrors the old column names:** `analysis.ts` references these names in ~25 places. If `ParsedSnapshot` uses the same names, `analysis.ts` changes are a single import swap + type change — no rename churn. The names `five_hour_utilization` etc. become field names on a TypeScript object rather than SQL columns.

**`extra_usage` dollars vs cents:** The old write path called `centsToDollars()` before writing. The normalizer (`normalize.ts:69–72`) returns the raw API values (`monthly_limit`, `used_credits`) which the API returns in cents. `queries.ts` must apply `/100` when populating `ParsedSnapshot.extra_usage_monthly_limit` and `extra_usage_used_credits`, matching what the old `insertSnapshot` did.

### Parsing logic skeleton

```typescript
function safeParseRaw(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function parseSnapshot(row: SnapshotRow): ParsedSnapshot {
  const payload = safeParseRaw(row.raw_json);
  // For cookie auth, raw_json is { usage: {...}, overage_spend_limit: ..., ... }
  // For bearer auth, raw_json is the usage payload directly
  // normalizeUsagePayload handles both via duck-type check on the top-level keys
  const usagePayload = payload && "usage" in payload
    ? (payload.usage as Record<string, unknown>)
    : (payload ?? {});

  const normalized = normalizeUsagePayload(usagePayload);
  const fiveHour = normalized.windows.find((w) => w.key === "five_hour");
  const sevenDay = normalized.windows.find((w) => w.key === "seven_day");

  const eu = normalized.extraUsage;
  const centsToDollars = (v: number | null): number | null =>
    v == null ? null : Math.round(v) / 100;

  return {
    id: row.id,
    timestamp: row.timestamp,
    status: row.status,
    endpoint: row.endpoint,
    response_status: row.response_status,
    error_message: row.error_message,
    raw_json: row.raw_json,
    five_hour_utilization: fiveHour?.utilization ?? null,
    five_hour_resets_at: fiveHour?.resetsAt ?? null,
    seven_day_utilization: sevenDay?.utilization ?? null,
    seven_day_resets_at: sevenDay?.resetsAt ?? null,
    extra_usage_enabled: eu ? eu.isEnabled : null,
    extra_usage_monthly_limit: eu ? centsToDollars(eu.monthlyLimit) : null,
    extra_usage_used_credits: eu ? centsToDollars(eu.usedCredits) : null,
    extra_usage_utilization: eu?.utilization ?? null,
  };
}

export function parseSnapshots(rows: SnapshotRow[]): ParsedSnapshot[] {
  return rows.map(parseSnapshot);
}
```

**Demo mode raw_json:** Demo snapshots in `pollDemo()` write `JSON.stringify({ demo: true })`. `normalizeUsagePayload` on `{ demo: true }` returns empty windows and `extraUsage: null`. All utilization fields parse as `null`. Dashboard panels handle null gracefully (existing code already branches on `!= null`). Demo seeding in `collector-singleton.ts` writes via `db.prepare().run()` directly — this must be updated to store `raw_json` containing the demo utilization values that the read path can parse back out.

---

## Write Path Changes

### `collector.ts` — what to remove

**Remove from the import list:**
```typescript
import { normalizeUsagePayload } from "./normalize";  // DELETE
```

**Remove from the success path in `pollOnce()` (lines 288–335):**
- Lines 288–290: `const normalized = normalizeUsagePayload(payload);` and the two `.find()` calls
- Lines 319–335: The 13-field `insertSnapshot` call replaces with a 6-field call:

```typescript
// NEW insertSnapshot call (success path)
insertSnapshot(this.config, {
  timestamp: new Date().toISOString(),
  status: "ok",
  endpoint: this.config.endpoint,
  responseStatus,
  rawJson,
  errorMessage: null,
});
```

**For the tier-polling delta computation** — `collector.ts` currently reads `fiveHour?.utilization` and `fiveHour?.resetsAt` from the `normalizeUsagePayload` call to drive `computePollingDelta`. After removing normalize from the write path, `collector.ts` must still compute the in-memory delta. Two options:

1. Call `normalizeUsagePayload(payload)` locally just for the delta computation (keep the import for this purpose only), not stored to DB.
2. Parse the already-built `rawJson` string back into an object and call normalize on that.

Option 1 is cleaner. Keep the `normalizeUsagePayload` import in `collector.ts` but use it only for the in-memory `computePollingDelta` call, not for any DB write. The key change is: normalized values no longer flow into `insertSnapshot`.

**Remove from the error paths (lines 232–248 and 376–392):**
- Remove the 8 `null` fields for utilization/extra_usage columns; reduce to 5 fields:

```typescript
insertSnapshot(this.config, {
  timestamp: new Date().toISOString(),
  status: "error",
  endpoint: this.config.endpoint,
  responseStatus: 0,
  rawJson: null,
  errorMessage: msg,
});
```

**Remove from `pollDemo()` (lines 474–490):**
- Current: passes `fiveHourUtilization`, `fiveHourResetsAt`, `sevenDayUtilization`, `sevenDayResetsAt` as typed columns
- New: must encode these values into a `raw_json` payload so the read path can parse them back:

```typescript
rawJson: JSON.stringify({
  five_hour: { utilization: fiveHourUtil, resets_at: fiveHourResets },
  seven_day: { utilization: sevenDayUtil, resets_at: sevenDayResets },
}),
```

This makes demo snapshots parseable by `normalizeUsagePayload` (which looks for `isUsageBucket` shaped objects) via `parseSnapshot` in `queries.ts`.

### `collector-singleton.ts` — demo seeder raw SQL

The `seedDemoData` function at line 71 calls `db.prepare()` with a raw SQL INSERT that lists `auth_mode`, `five_hour_utilization`, etc. as columns. This must be replaced with a 7-column insert that stores `raw_json` as a structured object parseable by `normalizeUsagePayload`:

```sql
INSERT INTO usage_snapshots
  (timestamp, status, endpoint, response_status, raw_json, error_message)
VALUES (?, ?, ?, ?, ?, ?)
```

With `raw_json` containing: `JSON.stringify({ five_hour: { utilization: X, resets_at: Y }, seven_day: { utilization: A, resets_at: B } })`

### New `insertSnapshot` signature (db.ts)

```typescript
export function insertSnapshot(
  config: Config,
  data: {
    timestamp: string;
    status: string;
    endpoint: string;
    responseStatus: number;
    rawJson: string | null;
    errorMessage: string | null;
  }
): void
```

6 parameters, not 15.

---

## Dashboard Panel Compatibility

### analysis.ts update strategy

`analysis.ts` currently imports `SnapshotRow` from `./db` and uses it as the row type. After the change:
- Import `ParsedSnapshot` from `./queries` instead of `SnapshotRow` from `./db`
- Import `parseSnapshots` from `./queries`
- `buildDashboardData` receives `SnapshotRow[]` (raw), calls `parseSnapshots(snapshots)` immediately, works with `ParsedSnapshot[]` for all downstream logic
- All internal helpers (`buildActivity`, `buildUsageInsights`, `buildExtraUsageInsights`) take `ParsedSnapshot[]` — field access is identical (same names)

The change to `analysis.ts` is essentially:
```typescript
// OLD
import type { SnapshotRow } from "./db";

// NEW
import type { SnapshotRow } from "./db";          // still used for the function signature
import { parseSnapshots, type ParsedSnapshot } from "./queries";  // added

export function buildDashboardData(
  snapshots: SnapshotRow[],    // raw rows from DB — signature unchanged
  ...
): DashboardData {
  const parsed = parseSnapshots(snapshots);   // add this one line
  // All internal code uses `parsed` instead of `snapshots`
  ...
}
```

The `DashboardData` interface uses `SnapshotRow | null` in two places (`health.lastSnapshot`, `health.lastSuccess`, `health.recentErrors`). These remain as `SnapshotRow` because they're surfaced in the JSON response (raw row data for the health panel). Only the computation code inside `buildDashboardData` uses `ParsedSnapshot`.

### Panel-by-panel compatibility check

| Panel | Component | Fields consumed | Source after refactor |
|-------|-----------|----------------|----------------------|
| Usage cards (current) | `UsageCards.tsx` | `data.current.fiveHour.utilization`, `.resetsAt`, `sevenDay`, `extraUsage` | `buildDashboardData` current block reads from `parsed` (ParsedSnapshot fields) |
| Heatmap | `Heatmap.tsx` | `data.activity.heatmap[].totalDelta` | `buildActivity(parsed)` via `computeDelta` using `ParsedSnapshot` field names |
| Hourly bars | `PeakHours.tsx` | `data.activity.hourlyBars[].totalDelta` | Same as heatmap |
| Usage timeline | `UsageTimeline.tsx` | `data.timeline[].fiveHourUtilization`, `.sevenDayUtilization`, `.extraUsageUsedCredits`, `.extraUsageBalance` | `timeline` built from `parsed` in `buildDashboardData` |
| Extra usage card | `ExtraUsageCard.tsx` | `data.extraUsageInsights.*`, `data.current.extraUsage.*` | `buildExtraUsageInsights(parsed)` |
| Collector health | `CollectorHealth.tsx` | `data.health.lastSnapshot`, `.lastSuccess`, `.recentErrors` | These stay as `SnapshotRow` (raw) — no typed column reads needed |

All panels are unaffected externally — the `DashboardData` JSON shape is unchanged.

---

## Deletion Scope

### What to delete

**`Claude Message Sender/`** (git-tracked, 4 files):
```
Claude Message Sender/claude_message_send_with_browser.py
Claude Message Sender/claude_message_send_with_CC_CLI.py
Claude Message Sender/requirements.txt
Claude Message Sender/test_send_now.py
```
Delete via `git rm -r "Claude Message Sender/"`.

**`claude-usage-tracker/.env.local`** (untracked, per `git ls-files --others`):
The only untracked file in `claude-usage-tracker/`. Per D-01, no data preservation needed. Delete with `rm`.

**`claude-usage-tracker/` is the canonical tree** — do NOT delete it. The CONTEXT.md D-01 reference to "stale root `claude-usage-tracker/`" is confusing because `claude-usage-tracker/` IS the canonical tree (43 git-tracked files). Re-reading the context: there is no separate `Claude Usage Tracker/claude-usage-tracker/` path in the actual repo — CLAUDE.md documentation references that path but it does not exist as a directory. The canonical app lives at `claude-usage-tracker/` (repo root, tracked).

**Key finding:** The repo root contains:
- `claude-usage-tracker/` — 43 git-tracked files — THIS IS THE CANONICAL TREE, keep it
- `Claude Message Sender/` — 4 git-tracked files — DELETE
- `claude-usage-tracker/.env.local` — 1 untracked file — DELETE (per D-01)

No `node_modules/`, no `data/` directory exists in `claude-usage-tracker/` (no local DB files present). The STATE.md "Blocker" about stale `.env.local` and SQLite files is the concern; per D-01, no preservation needed.

### What to preserve

Everything inside `claude-usage-tracker/src/`, `claude-usage-tracker/test/`, `claude-usage-tracker/scripts/`, and all config files — they are the canonical source.

---

## TypeScript Interface Changes

### `SnapshotRow` (db.ts) — new shape

```typescript
export interface SnapshotRow {
  id: number;
  timestamp: string;
  status: string;
  endpoint: string | null;
  response_status: number | null;
  raw_json: string | null;
  error_message: string | null;
}
```

### Downstream type breaks to fix

| File | What breaks | Fix |
|------|-------------|-----|
| `test/db.test.ts` | `insertSnapshot` call has 15 fields in helper `insert()` (line 30–47); `querySnapshots` returns rows with old column names (lines 88–93) | Update `insert()` to 6-field call; update `querySnapshots` assertions to 7 columns only |
| `test/analysis.test.ts` | `makeSnapshot()` factory (lines 24–45) populates 15 `SnapshotRow` fields; all snapshots use typed columns | `makeSnapshot` must use `ParsedSnapshot` shape (or its raw_json equivalent), or `analysis.ts` must accept `ParsedSnapshot[]` in tests |
| `collector-singleton.ts` | Demo seeder raw SQL INSERT lists old columns (line 71–77) | Update SQL to 6 non-id columns; update `raw_json` value to structured payload |
| `collector.ts` | `insertSnapshot` calls with 15 fields (4 call sites) | Reduce to 6-field calls at each site |
| `analysis.ts` | Reads `SnapshotRow` typed columns throughout | Route through `parseSnapshots()` from `queries.ts` |

### Test strategy for `analysis.test.ts`

Two options for updating tests:
1. **Preferred:** Change `makeSnapshot()` to be a `ParsedSnapshot` factory (not `SnapshotRow`). Tests directly construct the parsed shape — no raw_json encoding needed in tests.
2. **Alternative:** Change `makeSnapshot()` to produce a `SnapshotRow` where `raw_json` encodes the utilization values, and trust `parseSnapshot` to decode them. More realistic but more verbose test setup.

Option 1 is cleaner for unit tests — `buildDashboardData` tests don't need to test the parsing logic (that belongs in a `queries.test.ts`). If `analysis.ts` internally calls `parseSnapshots()` and then works with `ParsedSnapshot[]`, tests can inject `ParsedSnapshot[]` directly by exposing an internal helper, or by updating the public API to accept `ParsedSnapshot[]` instead of `SnapshotRow[]`.

**Recommendation:** Update `buildDashboardData` signature to accept `ParsedSnapshot[]` (not `SnapshotRow[]`). The route handler (`dashboard/route.ts`) calls `parseSnapshots(querySnapshots(...))` before passing to `buildDashboardData`. This keeps parsing concerns in one place (the route handler or `queries.ts`), and tests remain clean.

---

## Common Pitfalls

### Pitfall 1: Cookie auth raw_json structure
**What goes wrong:** For cookie auth, `collector.ts` wraps the payload in `{ usage: <payload>, overage_spend_limit: ..., prepaid_credits: ..., ... }`. `normalizeUsagePayload` is called on `payload` (the inner usage object) on the write side. On the read side, `parseSnapshot` must detect whether `raw_json` has a `usage` key and unwrap it before calling `normalizeUsagePayload`.
**Why it happens:** The cookie-mode raw_json is a compound object, not a bare usage payload.
**How to avoid:** In `parseSnapshot`: `const usagePayload = payload && "usage" in payload ? payload.usage : payload`. This handles both auth modes.
**Warning signs:** All 5h/7d utilization fields parse as null for cookie-auth snapshots.

### Pitfall 2: Demo mode raw_json is `{ demo: true }`
**What goes wrong:** Existing demo snapshots in the DB (from before this migration) have `raw_json = '{"demo":true}'`. `normalizeUsagePayload({ demo: true })` returns empty windows. All utilization values parse as null.
**Why it happens:** The old write path stored the real demo values in typed columns, not in raw_json.
**How to avoid:** After migration, old demo rows will have null for all computed fields — this is expected and the dashboard handles null. New demo rows (from updated `pollDemo`) store structured raw_json. Wipe the demo DB (`demo.db`) on startup of a fresh dev session; `collector-singleton.ts` already deletes and reseeds the demo DB on each startup (line 55–59).
**Warning signs:** Demo dashboard shows all null utilization for historical data.

### Pitfall 3: `migrateExtraUsageMoneyToDollars` must be removed
**What goes wrong:** The existing `migrateExtraUsageMoneyToDollars` function updates `extra_usage_monthly_limit` and `extra_usage_used_credits` columns — columns that no longer exist after the schema migration. If it runs after the schema migration, it either errors (column not found) or silently no-ops depending on SQLite error handling.
**Why it happens:** The MIGRATIONS sequence and migration functions in `db.ts` were designed for the old schema.
**How to avoid:** Remove `migrateExtraUsageMoneyToDollars` entirely in the same change that replaces the schema. Also remove the `MIGRATIONS` constant (the 4 ALTER TABLE ADD COLUMN statements for extra_usage columns). Replace both with `migrateToSimplifiedSchema`.
**Warning signs:** TypeScript error referencing `extra_usage_monthly_limit` column in the migration function.

### Pitfall 4: Index recreation
**What goes wrong:** `DROP TABLE usage_snapshots` drops the indexes that were on that table. The new table `usage_snapshots_new` had no indexes. After renaming to `usage_snapshots`, the indexes must be recreated.
**Why it happens:** SQLite indexes are attached to the table, not the name.
**How to avoid:** The migrator SQL in step 5 explicitly runs `CREATE INDEX IF NOT EXISTS` after the rename. Also update the `SCHEMA` constant to include the indexes so they're also created on fresh installs.
**Warning signs:** Queries using `idx_snapshots_timestamp` or `idx_snapshots_status` are slow or produce SQLite planner warnings.

### Pitfall 5: Test isolation with module-level DB singleton
**What goes wrong:** `db.ts` caches the `db` handle in a module-level variable (`let db: Database.Database | null = null`). When `getDb` is called in tests, it reuses the same handle. If `migrateToSimplifiedSchema` checks `app_meta` but app_meta was created in a prior test run, the migrator may behave unexpectedly.
**Why it happens:** Module singleton + fresh DB per test conflict.
**How to avoid:** `test/db.test.ts` already uses a temp path and cleans up with `after()`. The migrator's idempotency check reads from `app_meta` — a fresh temp DB will have no rows in `app_meta`, so the migrator runs once and sets the key. This is correct behavior.

---

## Standard Stack

### Core (unchanged, all verified in package.json)

| Library | Version | Purpose |
|---------|---------|---------|
| `better-sqlite3` | `^12.8.0` | Synchronous SQLite access |
| `next` | `16.2.2` | App Router + instrumentation hook |
| `typescript` | `^5` | Strict mode |
| `tsx` | `^4.21.0` | Test runner |

No new dependencies are needed for Phase 1. All refactoring uses existing imports.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node.js built-in `node:test` + `tsx` |
| Config file | None — scripts run via `package.json` test script |
| Quick run command | `cd claude-usage-tracker && npx tsx --test test/db.test.ts` |
| Full suite command | `cd claude-usage-tracker && npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DATA-01 | `raw_json` column persists payload verbatim | unit | `npx tsx --test test/db.test.ts` | Yes (update needed) |
| DATA-02 | Schema has exactly 7 columns + 2 indexes | unit | `npx tsx --test test/db.test.ts` | Yes (new test case) |
| DATA-05 | Migrator is idempotent — runs twice, same result | unit | `npx tsx --test test/db.test.ts` | No — Wave 0 gap |
| DATA-06 | `parseSnapshot` extracts fields from raw_json correctly | unit | `npx tsx --test test/queries.test.ts` | No — Wave 0 gap |
| UI-08 | `buildDashboardData` returns correct panels from ParsedSnapshot | unit | `npx tsx --test test/analysis.test.ts` | Yes (update needed) |
| DEPLOY-06 | Directories are deleted | manual | `ls "Claude Message Sender/"` → 404 | N/A |

### Sampling Rate
- **Per task commit:** `cd claude-usage-tracker && npx tsx --test test/db.test.ts test/analysis.test.ts`
- **Per wave merge:** `cd claude-usage-tracker && npm test`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `claude-usage-tracker/test/queries.test.ts` — covers DATA-06 (parseSnapshot: cookie payload, bearer payload, null raw_json, demo raw_json, extra_usage cents-to-dollars conversion)
- [ ] New test case in `test/db.test.ts` for DATA-05 (idempotent migrator: call `getDb` twice on same path, verify `app_meta.schema_version = 'simplified-v1'` exists and schema has 7 columns)
- [ ] New test case in `test/db.test.ts` for DATA-02 (verify `PRAGMA table_info(usage_snapshots)` returns exactly 7 columns after `getDb`)

---

## Runtime State Inventory

Phase 1 is a refactor, not a rename. No string renaming occurs. However, the schema migration modifies existing SQLite data:

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | `data/usage.db` (real) and `data/demo.db` (demo) under `claude-usage-tracker/data/` — confirmed no local data dir exists; local `.env.local` untracked | Migration runs at startup; demo.db is wiped and reseeded on every dev start |
| Live service config | None — no running service on this dev machine | None |
| OS-registered state | Windows Scheduled Task `ClaudeUsageTracker` may exist if `npm run startup:install` was run | No action — task calls `npm run start` which picks up the rebuilt app |
| Secrets/env vars | `claude-usage-tracker/.env.local` (untracked) — delete per D-01 | Delete |
| Build artifacts | `claude-usage-tracker/.next/` (gitignored) — stale after code changes | `npm run build` after refactor |

---

## Environment Availability

| Dependency | Required By | Available | Fallback |
|------------|------------|-----------|----------|
| Node.js | Next.js, test runner | Yes (confirmed by project running) | — |
| `better-sqlite3` (native) | DB layer | Yes (in package.json) | — |
| `tsx` | Test runner | Yes (`^4.21.0` in devDependencies) | — |
| Git | Directory deletion | Yes | Manual `rm -rf` |

No blocking missing dependencies.

---

## Security Domain

ASVS is not the primary concern for a local-only desktop app with no public exposure, but noting for completeness:

| ASVS Category | Applies | Notes |
|---------------|---------|-------|
| V5 Input Validation | Partial | `raw_json` is stored as-is from the API; `safeParseJson` wraps `JSON.parse` in try/catch — no injection surface since it's read from SQLite, not user input |
| V6 Cryptography | No | No cryptographic operations in this phase |

Phase 1 introduces no new security surface.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The `Claude Usage Tracker/claude-usage-tracker/` path referenced in CLAUDE.md does not exist as a directory in the repo — only `claude-usage-tracker/` (lowercase, no space) exists. | Deletion Scope | If a second tree does exist, the deletion scope is wrong — need to `git ls-files "Claude Usage Tracker/"` to confirm. |
| A2 | Cookie-mode raw_json always has a `"usage"` top-level key wrapping the usage payload. | queries.ts Design | If not always present, `parseSnapshot` needs a different unwrap strategy — check `collector.ts` line 302 (confirmed: `{ usage: payload, ... }`). |
| A3 | `better-sqlite3` v12 bundles a SQLite version that supports `ALTER TABLE RENAME TO` (available since SQLite 2.x). | Migration Path | Virtually certain — this is ancient SQL, but noting it. |

**A1 resolution:** Verified via `ls` — no `Claude Usage Tracker/` directory exists. Only `claude-usage-tracker/` (lowercase). CLAUDE.md documentation is stale. A1 risk is LOW.
**A2 resolution:** Verified in `collector.ts` lines 302–316 — cookie auth `rawJson` is always `JSON.stringify({ usage: payload, ... })`. Bearer auth `rawJson` is `JSON.stringify(payload)`. Confirmed.

---

## Open Questions

1. **`buildDashboardData` signature change**
   - What we know: The function currently accepts `SnapshotRow[]` and internally uses typed columns.
   - What's unclear: Whether the planner should change the signature to accept `ParsedSnapshot[]` (cleaner tests) or keep `SnapshotRow[]` and parse internally (unchanged external interface).
   - Recommendation: Change to `ParsedSnapshot[]`. The caller (`dashboard/route.ts`) does: `parseSnapshots(querySnapshots(config))`. Tests become cleaner.

2. **Old demo seeding behavior after migration**
   - What we know: `seedDemoData` in `collector-singleton.ts` deletes and reseeds the demo DB on every startup. After Phase 1, the raw SQL must use the new 7-column schema.
   - What's unclear: Whether the raw SQL `db.prepare()` insert in `collector-singleton.ts` should be replaced by calling the new `insertSnapshot` helper.
   - Recommendation: Replace the raw SQL with calls to `insertSnapshot` for consistency. `insertSnapshot` is not async; the transaction wrapper handles performance.

---

## Sources

### Primary (HIGH confidence)
- `claude-usage-tracker/src/lib/db.ts` — Full schema, SnapshotRow interface, insertSnapshot, querySnapshots — read directly
- `claude-usage-tracker/src/lib/analysis.ts` — All column reads mapped — read directly
- `claude-usage-tracker/src/lib/collector.ts` — All write path call sites — read directly
- `claude-usage-tracker/src/lib/normalize.ts` — normalizeUsagePayload signature and behavior — read directly
- `claude-usage-tracker/src/lib/collector-singleton.ts` — Demo seeder raw SQL — read directly
- `claude-usage-tracker/test/analysis.test.ts` — SnapshotRow fixture factory, all test cases — read directly
- `claude-usage-tracker/test/db.test.ts` — insertSnapshot call pattern, querySnapshots assertions — read directly
- `2026-04-16-tracker-sender-merge-design.md` §5 — Migration SQL, queries.ts design, app_meta keys — read directly
- `.planning/phases/01-foundation-db-refactor/01-CONTEXT.md` — All locked decisions — read directly
- `git ls-files` output — Verified exact tracked file set for deletion scope

### Secondary (MEDIUM confidence)
- SQLite documentation (training knowledge) — CREATE/COPY/DROP/RENAME pattern for column removal is universally documented; `better-sqlite3` v12 confirmed to use synchronous API throughout existing code

---

## Metadata

**Confidence breakdown:**
- Current state audit: HIGH — read every relevant file directly
- Migration path: HIGH — follows existing pattern in same codebase; SQL is straightforward
- queries.ts design: HIGH — all field access paths traced; cookie/bearer payload structure verified in collector.ts
- Write path changes: HIGH — all 4 call sites located and analyzed
- Deletion scope: HIGH — `git ls-files` and `git status` run to confirm actual tracked/untracked state
- Test impact: HIGH — all 9 test files located; analysis.test.ts and db.test.ts fully read

**Research date:** 2026-04-19
**Valid until:** 2026-05-19 (stable codebase, no external dependencies)
