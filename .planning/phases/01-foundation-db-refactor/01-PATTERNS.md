# Phase 1: Foundation & DB Refactor - Pattern Map

**Mapped:** 2026-04-19
**Files analyzed:** 8 (6 modified, 2 created; deletions need no patterns)
**Analogs found:** 8 / 8

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `claude-usage-tracker/src/lib/db.ts` | model/migration | CRUD | itself (existing file being refactored) | exact |
| `claude-usage-tracker/src/lib/queries.ts` | service/transform | transform | `src/lib/normalize.ts` (pure-function transform module) | role-match |
| `claude-usage-tracker/src/lib/collector.ts` | service | request-response | itself (write path simplification) | exact |
| `claude-usage-tracker/src/lib/collector-singleton.ts` | service | CRUD | itself (raw SQL update) | exact |
| `claude-usage-tracker/src/lib/analysis.ts` | service/transform | transform | itself (import swap + parseSnapshots routing) | exact |
| `claude-usage-tracker/test/db.test.ts` | test | CRUD | itself (existing test being updated) | exact |
| `claude-usage-tracker/test/analysis.test.ts` | test | transform | itself (makeSnapshot factory update) | exact |
| `claude-usage-tracker/test/queries.test.ts` | test | transform | `test/analysis.test.ts` (same test framework, same fixture pattern) | role-match |

---

## Pattern Assignments

### `claude-usage-tracker/src/lib/db.ts` (model, CRUD + migration)

**Analog:** itself — full file at lines 1-199.

**Imports pattern** (lines 1-4):
```typescript
import Database from "better-sqlite3";
import fs from "node:fs";
import type { Config } from "./config";
```

**Module-level singleton + WAL pragma** (lines 5-60):
```typescript
let db: Database.Database | null = null;

export function getDb(config: Config): Database.Database {
  if (db) return db;
  fs.mkdirSync(config.dataDir, { recursive: true });
  db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  migrateToSimplifiedSchema(db);  // replace existing migrator calls
  return db;
}
```

**Idempotent migration pattern** (lines 62-89 — `migrateExtraUsageMoneyToDollars`; Phase 1 replaces this with `migrateToSimplifiedSchema` following the identical structural pattern):
```typescript
function migrateToSimplifiedSchema(db: Database.Database): void {
  const migrationKey = "schema_version";
  const current = db
    .prepare("SELECT value FROM app_meta WHERE key = ?")
    .get(migrationKey) as { value: string } | undefined;

  if (current?.value === "simplified-v1") {
    return; // Already done
  }

  const transaction = db.transaction(() => {
    db.prepare(`
      CREATE TABLE usage_snapshots_new (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp       TEXT    NOT NULL,
        status          TEXT    NOT NULL,
        endpoint        TEXT,
        response_status INTEGER,
        raw_json        TEXT,
        error_message   TEXT
      )
    `).run();

    db.prepare(`
      INSERT INTO usage_snapshots_new
        (id, timestamp, status, endpoint, response_status, raw_json, error_message)
      SELECT
        id, timestamp, status, endpoint, response_status, raw_json, error_message
      FROM usage_snapshots
    `).run();

    db.prepare("DROP TABLE usage_snapshots").run();
    db.prepare("ALTER TABLE usage_snapshots_new RENAME TO usage_snapshots").run();

    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_snapshots_timestamp ON usage_snapshots(timestamp)
    `).run();
    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_snapshots_status ON usage_snapshots(status)
    `).run();

    db.prepare(`
      INSERT INTO app_meta (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(migrationKey, "simplified-v1");
    db.prepare(`
      INSERT INTO app_meta (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run("migrated_at", new Date().toISOString());
  });

  transaction();
}
```
Key structural note: `db.transaction(() => { ... })()` — wrap all DDL + DML in one transaction. The `ON CONFLICT(key) DO UPDATE SET value = excluded.value` upsert for `app_meta` is the established pattern (lines 82-84 of the existing migrator).

**New `SnapshotRow` interface** — replace lines 91-108 with:
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

**New `insertSnapshot` signature** — replace lines 110-157 with:
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
): void {
  const db = getDb(config);
  db.prepare(`
    INSERT INTO usage_snapshots
      (timestamp, status, endpoint, response_status, raw_json, error_message)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    data.timestamp,
    data.status,
    data.endpoint,
    data.responseStatus,
    data.rawJson,
    data.errorMessage
  );
}
```
Positional `.run(...)` with camelCase TS param names mapped to snake_case SQL columns — matches existing pattern at lines 140-156. `querySnapshots` (lines 159-186) is unchanged except its return type narrows to the new 7-column `SnapshotRow`.

**Also remove:** The `MIGRATIONS` constant (lines 35-40 — four `ALTER TABLE ADD COLUMN` statements for the dropped columns). Replace with an empty `SCHEMA` that already includes indexes.

---

### `claude-usage-tracker/src/lib/queries.ts` (service/transform, transform) — CREATED

**Analog:** `claude-usage-tracker/src/lib/normalize.ts` — pure-function module with named exports only, no default export, 2-space indentation, double-quoted strings.

**Imports** (derived from `normalize.ts` and sibling import conventions in CLAUDE.md):
```typescript
import { normalizeUsagePayload } from "./normalize";
import type { SnapshotRow } from "./db";
```
Library files in `src/lib/` use relative imports to siblings (CLAUDE.md import convention).

**Interface definition pattern** (from `normalize.ts` lines 1-31 — `interface` keyword for object shapes):
```typescript
export interface ParsedSnapshot {
  // Identity columns (passthrough from SnapshotRow)
  id: number;
  timestamp: string;
  status: string;
  endpoint: string | null;
  response_status: number | null;
  error_message: string | null;
  raw_json: string | null;

  // Derived from raw_json via normalizeUsagePayload
  five_hour_utilization: number | null;
  five_hour_resets_at: string | null;
  seven_day_utilization: number | null;
  seven_day_resets_at: string | null;
  extra_usage_enabled: boolean | null;
  extra_usage_monthly_limit: number | null;
  extra_usage_used_credits: number | null;
  extra_usage_utilization: number | null;
}
```

**Private module-local helper** (from `normalize.ts` lines 33-38 — module-local, no export):
```typescript
function safeParseRaw(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
```
Matches `safeParseJson` in `analysis.ts` lines 109-116 — same try/catch-returns-null idiom.

**Core transform function** (named export, `function` keyword — CLAUDE.md top-level function convention):
```typescript
export function parseSnapshot(row: SnapshotRow): ParsedSnapshot {
  const payload = safeParseRaw(row.raw_json);

  // Cookie auth stores: { usage: <payload>, overage_spend_limit: ..., ... }
  // Bearer auth stores the payload directly.
  // Both shapes handled by checking for the "usage" key.
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
`centsToDollars` is an arrow function used as an inline helper — matches CLAUDE.md "arrow functions for callbacks and module-level helpers." Named top-level functions use `function` keyword.

**Why field names match old column names:** `analysis.ts` accesses `~25` references to `five_hour_utilization`, `extra_usage_used_credits`, etc. Using the same names on `ParsedSnapshot` makes `analysis.ts` changes a single import swap with no rename churn.

---

### `claude-usage-tracker/src/lib/collector.ts` (service, request-response) — write path simplification

**Analog:** itself — lines 220-504.

**4 insertSnapshot call sites — all reduce from 15 fields to 6:**

Error path 1 — "no auth" (lines 232-248):
```typescript
// NEW
insertSnapshot(this.config, {
  timestamp: new Date().toISOString(),
  status: "error",
  endpoint: this.config.endpoint,
  responseStatus: 0,
  rawJson: null,
  errorMessage: msg,
});
```

Success path (lines 319-335):
```typescript
// NEW
insertSnapshot(this.config, {
  timestamp: new Date().toISOString(),
  status: "ok",
  endpoint: this.config.endpoint,
  responseStatus,
  rawJson,
  errorMessage: null,
});
```

Error path 2 — catch block (lines 376-392): same shape as Error path 1.

Demo path — `pollDemo()` (lines 474-490):
```typescript
// NEW rawJson field encodes utilization so read path can parse it back
insertSnapshot(this.config, {
  timestamp: now.toISOString(),
  status: "ok",
  endpoint: "demo",
  responseStatus: 200,
  rawJson: JSON.stringify({
    five_hour: { utilization: fiveHourUtil, resets_at: fiveHourResets },
    seven_day: { utilization: sevenDayUtil, resets_at: sevenDayResets },
  }),
  errorMessage: null,
});
```
The `{ utilization, resets_at }` shape matches the `isUsageBucket` duck-type check in `normalize.ts` lines 40-49 — these keys make the demo payload parseable by `normalizeUsagePayload`.

**`normalizeUsagePayload` import stays** (line 4) — used for in-memory delta computation in `computePollingDelta` (line 340), not for DB writes. The key change is that the normalized result no longer feeds `insertSnapshot`.

**Demo read-back from last snapshot** (lines 426-438 — `pollDemo` initializes `demoFiveHour`/`demoSevenDay` from last DB row):
```typescript
// OLD: last.five_hour_utilization and last.seven_day_utilization (typed columns)
// NEW: parse via queries.ts
import { parseSnapshot } from "./queries";
// ...
const parsed = parseSnapshot(last);
this.demoFiveHour = parsed.five_hour_utilization ?? 0;
this.demoSevenDay = parsed.seven_day_utilization ?? 25;
```
The dynamic import `await import("./db")` (line 428) stays for the `querySnapshots` call. Add `parseSnapshot` to that dynamic import or import it statically at the top of the file.

---

### `claude-usage-tracker/src/lib/collector-singleton.ts` (service, CRUD) — demo seeder raw SQL update

**Analog:** itself — full file at lines 1-171.

**Current raw SQL pattern** (lines 70-77 — `db.prepare().run()` inside `db.transaction()`):
```typescript
// CURRENT: 11 columns listed explicitly
const insert = db.prepare(`
  INSERT INTO usage_snapshots
    (timestamp, status, endpoint, auth_mode, response_status,
     five_hour_utilization, five_hour_resets_at,
     seven_day_utilization, seven_day_resets_at,
     raw_json, error_message)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
```

**New approach — replace raw SQL with `insertSnapshot` calls** (recommended for consistency — RESEARCH.md open question 2):
```typescript
// Import already present at line 3: import { getDb, insertSnapshot } from "./db";
// Inside insertAll transaction:
insertSnapshot(config, {
  timestamp: ts.toISOString(),
  status: "ok",
  endpoint: "demo",
  responseStatus: 200,
  rawJson: JSON.stringify({
    five_hour: { utilization: Math.round(fiveHourUtil * 10) / 10, resets_at: fiveHourResets },
    seven_day: { utilization: Math.round(sevenDayUtil * 10) / 10, resets_at: sevenDayResets },
  }),
  errorMessage: null,
});
```
The `insertAll = db.transaction(() => { ... })` loop (lines 92-151) stays. `insertSnapshot` calls inside a `db.transaction()` callback are safe — `better-sqlite3` transactions are synchronous and nestable. The existing `const db = getDb(config)` call (line 61) guarantees the singleton is initialized before the seeder runs.

**globalThis singleton pattern** (lines 9-11) — unchanged:
```typescript
const globalForCollector = globalThis as unknown as {
  _usageCollector?: UsageCollector;
};
```

---

### `claude-usage-tracker/src/lib/analysis.ts` (service/transform, transform) — import swap

**Analog:** itself — lines 1-377.

**Import change** (line 1-3):
```typescript
// ADD to existing imports
import { parseSnapshots, type ParsedSnapshot } from "./queries";
```

**`buildDashboardData` parameter type change** (lines 301-305):
```typescript
// Change SnapshotRow[] to ParsedSnapshot[] for the computation parameter
export function buildDashboardData(
  snapshots: ParsedSnapshot[],   // was: SnapshotRow[]
  storageMeta: { path: string; sizeBytes: number; totalSnapshots: number },
  runtime: CollectorState
): DashboardData {
```
All internal helpers (`buildActivity`, `buildUsageInsights`, `buildExtraUsageInsights`, `computeDelta`) update their parameter types from `SnapshotRow` to `ParsedSnapshot`. Field names are identical, so no access-site changes needed.

**`DashboardData.health` raw row handling** (lines 59-62) — `lastSnapshot`, `lastSuccess`, `recentErrors` remain `SnapshotRow`. Since `buildDashboardData` would now receive `ParsedSnapshot[]`, the caller (`dashboard/route.ts`) passes raw snapshots for health separately. Simplest approach: add a second `rawSnapshots: SnapshotRow[]` parameter used only for the health block, or derive health counts from the parsed slice (all fields needed for health — `status`, `timestamp`, `error_message`, `endpoint`, `response_status` — exist on `ParsedSnapshot` as identity columns).

**`computeDelta` helper** (lines 118-129):
```typescript
function computeDelta(
  prev: ParsedSnapshot,  // was: SnapshotRow
  curr: ParsedSnapshot,  // was: SnapshotRow
  windowKey: "five_hour" | "seven_day"
): number {
  return computeUsageDelta(
    prev[`${windowKey}_utilization`],
    curr[`${windowKey}_utilization`],
    prev[`${windowKey}_resets_at`],
    curr[`${windowKey}_resets_at`]
  );
}
```
Dynamic key access still works because `ParsedSnapshot` has the same snake_case field names. If TypeScript rejects the index signature, cast: `(prev as Record<string, unknown>)[key]`.

---

### `claude-usage-tracker/test/db.test.ts` (test, CRUD) — update

**Analog:** itself — full file at lines 1-162.

**Test framework imports** (lines 1-7) — unchanged:
```typescript
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDb, getDbMeta, insertSnapshot, querySnapshots } from "../src/lib/db";
import type { Config } from "../src/lib/config";
```

**`insert` helper — new 6-field shape** (lines 27-48):
```typescript
function insert(
  overrides: Partial<Parameters<typeof insertSnapshot>[1]> & { timestamp: string }
): void {
  insertSnapshot(config, {
    timestamp: overrides.timestamp,
    status: overrides.status ?? "ok",
    endpoint: overrides.endpoint ?? "test-endpoint",
    responseStatus: overrides.responseStatus ?? 200,
    rawJson: overrides.rawJson ?? null,
    errorMessage: overrides.errorMessage ?? null,
  });
}
```

**Cleanup pattern** (lines 50-60 — copy unchanged):
```typescript
after(() => {
  if (fs.existsSync(dbPath)) {
    getDb(config).close();
  }
  for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    if (fs.existsSync(file)) {
      fs.rmSync(file, { force: true });
    }
  }
});
```

**Assertions to update** (lines 87-93) — remove old column assertions:
```typescript
// REMOVE: assert.equal(rows[0].five_hour_utilization, null);
// REMOVE: assert.equal(rows[0].five_hour_resets_at, null);
// REMOVE: assert.equal(rows[0].seven_day_utilization, null);
// REMOVE: assert.equal(rows[0].seven_day_resets_at, null);
// KEEP:   assert.equal(rows[0].raw_json, null);
// KEEP:   assert.equal(rows[0].error_message, null);
```

**Remove entirely:** The test case at lines 147-161 ("stores extra usage amounts in dollars") — it tests `extraUsageEnabled`/`extraUsageMonthlyLimit` fields that no longer exist on `insertSnapshot`.

**New test cases to add** (DATA-02, DATA-05 from RESEARCH.md):
```typescript
it("schema has exactly 7 columns after getDb", () => {
  const db = getDb(config);
  const cols = db.prepare("PRAGMA table_info(usage_snapshots)").all() as { name: string }[];
  assert.deepEqual(
    cols.map((c) => c.name),
    ["id", "timestamp", "status", "endpoint", "response_status", "raw_json", "error_message"]
  );
});

it("migrator is idempotent — schema_version set to simplified-v1", () => {
  const db = getDb(config); // migrator runs on first call
  getDb(config);            // second call returns cached handle; no re-run
  const row = db.prepare(
    "SELECT value FROM app_meta WHERE key = 'schema_version'"
  ).get() as { value: string };
  assert.equal(row.value, "simplified-v1");
});
```

---

### `claude-usage-tracker/test/analysis.test.ts` (test, transform) — update makeSnapshot factory

**Analog:** itself — lines 1-80 read.

**New import** (add after line 4):
```typescript
import type { ParsedSnapshot } from "../src/lib/queries";
```

**`makeSnapshot` factory update** (lines 24-45):
```typescript
// Change return type from SnapshotRow to ParsedSnapshot
function makeSnapshot(
  overrides: Partial<ParsedSnapshot> & { timestamp: string }
): ParsedSnapshot {
  return {
    id: 1,
    status: "ok",
    endpoint: "test",
    response_status: 200,
    five_hour_utilization: null,
    five_hour_resets_at: null,
    seven_day_utilization: null,
    seven_day_resets_at: null,
    extra_usage_enabled: null,
    extra_usage_monthly_limit: null,
    extra_usage_used_credits: null,
    extra_usage_utilization: null,
    raw_json: null,
    error_message: null,
    ...overrides,
  };
}
```
Field names are identical to the old `SnapshotRow` version — all existing `makeSnapshot({ five_hour_utilization: 25, ... })` call sites continue to work without changes.

Note: `auth_mode` field is dropped (it existed on old `SnapshotRow`, does not exist on `ParsedSnapshot`). Remove it from any `makeSnapshot` calls that specified it.

---

### `claude-usage-tracker/test/queries.test.ts` (test, transform) — CREATED

**Analog:** `test/analysis.test.ts` — same node:test framework, same `describe`/`it` structure, same `assert` import.

**Test file structure** (copy framework from `test/analysis.test.ts` lines 1-6):
```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseSnapshot, parseSnapshots } from "../src/lib/queries";
import type { SnapshotRow } from "../src/lib/db";
```

**7-column `SnapshotRow` fixture factory** (for queries tests only):
```typescript
function makeRawRow(overrides: Partial<SnapshotRow> & { timestamp: string }): SnapshotRow {
  return {
    id: 1,
    timestamp: overrides.timestamp,
    status: "ok",
    endpoint: "test",
    response_status: 200,
    raw_json: null,
    error_message: null,
    ...overrides,
  };
}
```

**Test payload shapes** (derived from `collector.ts` lines 292-316 and RESEARCH.md):
```typescript
// Bearer auth raw_json — payload stored directly
const bearerRaw = JSON.stringify({
  five_hour: { utilization: 55.0, resets_at: "2026-04-19T15:00:00.000Z" },
  seven_day: { utilization: 20.0, resets_at: "2026-04-26T10:00:00.000Z" },
});

// Cookie auth raw_json — usage key wraps the inner usage payload
const cookieRaw = JSON.stringify({
  usage: {
    five_hour: { utilization: 42.5, resets_at: "2026-04-19T15:00:00.000Z" },
    seven_day: { utilization: 30.0, resets_at: "2026-04-26T10:00:00.000Z" },
  },
  overage_spend_limit: null,
});

// Demo raw_json — same shape as bearer (five_hour/seven_day keys at root)
const demoRaw = JSON.stringify({
  five_hour: { utilization: 30.0, resets_at: "2026-04-19T15:00:00.000Z" },
  seven_day: { utilization: 25.0, resets_at: "2026-04-26T10:00:00.000Z" },
});

// Extra usage raw_json (amounts are in cents — parseSnapshot must convert to dollars)
const extraUsageRaw = JSON.stringify({
  five_hour: { utilization: 80.0, resets_at: "2026-04-19T15:00:00.000Z" },
  extra_usage: { is_enabled: true, monthly_limit: 1000, used_credits: 283, utilization: 28.3 },
});
```

**Test cases** (DATA-06 from RESEARCH.md):
```typescript
describe("parseSnapshot", () => {
  it("returns null utilization fields when raw_json is null");
  it("parses bearer auth payload (bare usage object at root)");
  it("parses cookie auth payload (usage key wraps inner object)");
  it("parses demo payload with five_hour and seven_day at root");
  it("converts extra_usage cents to dollars (monthly_limit and used_credits)");
  it("returns null for extra_usage fields when extra_usage key is absent");
  it("handles malformed JSON without throwing — returns null utilization");
});

describe("parseSnapshots", () => {
  it("maps parseSnapshot over an array");
  it("returns empty array for empty input");
});
```

---

## Shared Patterns

### Module structure (all `src/lib/` files)
**Source:** `normalize.ts`, `db.ts`, `usage-window.ts`
**Apply to:** `queries.ts`
- Named exports only — no default export
- `function` keyword for top-level named functions
- `camelCase` verb-first naming (`parseSnapshot`, `parseSnapshots`, `safeParseRaw`)
- Relative imports for sibling lib modules (`import { X } from "./normalize"`)
- 2-space indentation, double-quoted strings, semicolons required

### `app_meta` upsert
**Source:** `db.ts` lines 82-85
**Apply to:** `migrateToSimplifiedSchema` in `db.ts`
```typescript
db.prepare(`
  INSERT INTO app_meta (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`).run(key, value);
```

### Transaction wrapping
**Source:** `db.ts` lines 72-88; `collector-singleton.ts` lines 92-151
**Apply to:** `migrateToSimplifiedSchema` DDL block, demo seeder bulk loop
```typescript
const transaction = db.transaction(() => {
  // all statements here
});
transaction();
```

### JSON parse with null fallback
**Source:** `analysis.ts` lines 109-116 (`safeParseJson`)
**Apply to:** `queries.ts` `safeParseRaw` helper — same pattern, different name
```typescript
function safeParseRaw(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
```

### Error swallowing with annotation
**Source:** `db.ts` lines 52-55
**Apply to:** any intentional catch block (demo DB file delete in `collector-singleton.ts` line 59)
```typescript
} catch {
  // Reason why suppression is intentional.
}
```

### Test temp DB lifecycle
**Source:** `test/db.test.ts` lines 9-60
**Apply to:** `test/queries.test.ts` only if it needs a real DB instance (pure unit tests do not)
```typescript
const dbPath = path.join(os.tmpdir(), `test-usage-${Date.now()}.db`);
after(() => {
  if (fs.existsSync(dbPath)) getDb(config).close();
  for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    if (fs.existsSync(file)) fs.rmSync(file, { force: true });
  }
});
```
`test/queries.test.ts` tests `parseSnapshot` which is a pure function — no DB needed. The fixture factory builds `SnapshotRow` objects directly in memory.

---

## No Analog Found

All files in this phase are either existing files being modified (with themselves as analogs) or new files with clear structural analogs. No "no analog" entries.

---

## Deletions (No Patterns Required)

| File/Directory | Action | Method |
|----------------|--------|--------|
| `Claude Message Sender/claude_message_send_with_browser.py` | delete | `git rm -r "Claude Message Sender/"` |
| `Claude Message Sender/claude_message_send_with_CC_CLI.py` | delete | same batch |
| `Claude Message Sender/requirements.txt` | delete | same batch |
| `Claude Message Sender/test_send_now.py` | delete | same batch |
| `claude-usage-tracker/.env.local` | delete | `rm claude-usage-tracker/.env.local` (untracked file) |

---

## Metadata

**Analog search scope:** `claude-usage-tracker/src/lib/`, `claude-usage-tracker/test/`
**Files read:** `db.ts`, `collector.ts` (lines 1-100, 220-504), `collector-singleton.ts`, `analysis.ts` (lines 1-220, 290-377), `normalize.ts`, `usage-window.ts`, `test/db.test.ts`, `test/analysis.test.ts` (lines 1-80)
**Pattern extraction date:** 2026-04-19
