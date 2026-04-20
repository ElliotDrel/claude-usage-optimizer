# Phase 3: Sender Module - Pattern Map

**Mapped:** 2026-04-20
**Files analyzed:** 5 (new and modified)
**Analogs found:** 4 / 5

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/lib/sender.ts` | service/lib | event-driven (spawn/timeout) | `src/lib/collector.ts` | role-match |
| `src/lib/db.ts` (modify) | service/lib | CRUD | `src/lib/db.ts` (self) | exact |
| `src/app/api/send-now/route.ts` | API route | request-response | `src/app/api/dashboard/route.ts` | exact |
| `test/sender.test.ts` | test | testing | `test/db.test.ts` | role-match |
| `test/db.test.ts` (modify) | test | testing | `test/db.test.ts` (self) | exact |

---

## Pattern Assignments

### `src/lib/sender.ts` (service/lib, event-driven)

**Analog:** `src/lib/collector.ts`

**Role:** Service module that manages async state, handles timeouts, and integrates with the DB. Collector spawns HTTP requests with retry logic; sender spawns CLI processes with timeout and write persistence.

**Imports pattern** (lines 1–6):
```typescript
import type { Config } from "./config";
import { insertSnapshot } from "./db";
import { normalizeUsagePayload } from "./normalize";
import { parseSnapshot } from "./queries";
import { computeUsageDelta } from "./usage-window";
```

For `sender.ts`, use:
```typescript
import type { Config } from "./config";
import { insertSendLog } from "./db";
```

**Named exports** (lines 40–96, 222–387):
```typescript
// Collector exports named async functions and pure utility functions
export function computeNextDelay(...) { ... }
export async function pollOnce(): Promise<{ status: string }> { ... }
export class UsageCollector { ... }
```

Sender should export a named async function:
```typescript
export async function send(
  config: Config,
  opts?: { 
    timeoutMs?: number;
    scheduledFor?: string | null;
    isAnchor?: number;
  }
): Promise<SendLogRow> { ... }
```

**Module-level constants** (lines 24–38):
```typescript
const TIER_DELAYS: Record<Tier, number> = {
  idle: 5 * 60_000,
  light: 2.5 * 60_000,
  active: 1 * 60_000,
  burst: 30_000,
};

const ERROR_BACKOFF = [60_000, 120_000, 300_000, 600_000];
```

For `sender.ts`, define the QUESTIONS constant (from CONTEXT.md D-02, ported from git history):
```typescript
const QUESTIONS = [
  "What is the best method to incorporate with a database in Python? (Answer in 1 sentence.)",
  "What are 3 key principles for writing clean code? (Answer in 1 sentence.)",
  "How should I structure error handling in Python? (Answer in 1 sentence.)",
  "What are best practices for API design? (Answer in 1 sentence.)",
  "How do you implement proper logging? (Answer in 1 sentence.)",
  "What are secure coding practices? (Answer in 1 sentence.)",
  "How should I organize a Python project? (Answer in 1 sentence.)",
  "What are testing best practices? (Answer in 1 sentence.)",
  "How do you optimize database queries? (Answer in 1 sentence.)",
  "What design patterns should I know? (Answer in 1 sentence.)",
];
```

**Error handling and logging** (lines 354–367, 382–383):
```typescript
catch (err) {
  const rawMsg = err instanceof Error ? err.message : String(err);
  const msg = explainAuthFailure(this.config, rawMsg);
  this.state.lastError = msg;
  this.state.consecutiveFailures++;

  insertSnapshot(this.config, {
    timestamp: new Date().toISOString(),
    status: "error",
    endpoint: this.config.endpoint,
    responseStatus: 0,
    rawJson: null,
    errorMessage: msg,
  });
  
  console.warn(`[collector] Poll failed: ${msg}`);
  return { status: "error", error: msg };
}
```

For `sender.ts`, follow the bracketed log prefix pattern with `[sender]`:
```typescript
console.error("[sender]", err instanceof Error ? err.message : String(err));
```

---

### `src/lib/db.ts` (modify — add DDL + helper)

**Analog:** `src/lib/db.ts` (self) — lines 7–28 (schema), 113–137 (insertSnapshot), 103–111 (SnapshotRow interface)

**DDL for send_log table** (add to SCHEMA constant after usage_snapshots index):
```sql
CREATE TABLE IF NOT EXISTS send_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  fired_at        TEXT    NOT NULL,         -- ISO 8601 UTC
  scheduled_for   TEXT,                     -- ISO 8601 UTC or NULL for manual
  is_anchor       INTEGER NOT NULL,         -- 1 or 0
  status          TEXT    NOT NULL,         -- 'ok', 'error', 'timeout'
  duration_ms     INTEGER,
  question        TEXT,
  response_excerpt TEXT,                     -- first ~500 chars
  error_message   TEXT
);

CREATE INDEX IF NOT EXISTS idx_send_log_fired_at
  ON send_log(fired_at);
```

**Interface definition** (copy pattern from SnapshotRow, lines 103–111):
```typescript
export interface SendLogRow {
  id: number;
  fired_at: string;
  scheduled_for: string | null;
  is_anchor: number;
  status: string;
  duration_ms: number | null;
  question: string | null;
  response_excerpt: string | null;
  error_message: string | null;
}
```

**insertSendLog() helper** (copy pattern from insertSnapshot, lines 113–137):
```typescript
export function insertSendLog(
  config: Config,
  data: Omit<SendLogRow, "id">
): SendLogRow {
  const db = getDb(config);
  const stmt = db.prepare(`
    INSERT INTO send_log
      (fired_at, scheduled_for, is_anchor, status, duration_ms, question, response_excerpt, error_message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  const result = stmt.run(
    data.fired_at,
    data.scheduled_for,
    data.is_anchor,
    data.status,
    data.duration_ms,
    data.question,
    data.response_excerpt,
    data.error_message
  );
  
  return {
    id: result.lastInsertRowid as number,
    ...data,
  };
}
```

**Migration pattern** (copy idempotent approach from migrateToSimplifiedSchema, lines 30–89):
- Add `send_log` table in the SCHEMA constant upfront (no migration needed since it's a new table in a new phase)
- Or use the transaction pattern if adding to an existing schema in a later phase

---

### `src/app/api/send-now/route.ts` (API route, request-response)

**Analog:** `src/app/api/dashboard/route.ts` (lines 1–17)

**File structure and exports** (lines 1–17):
```typescript
import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { querySnapshots, getDbMeta } from "@/lib/db";
import { buildDashboardData } from "@/lib/analysis";
import { parseSnapshots } from "@/lib/queries";
import { getCollector } from "@/lib/collector-singleton";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = getConfig();
  const collector = getCollector();
  const rawSnapshots = querySnapshots(config);
  const meta = getDbMeta(config);
  const data = buildDashboardData(parseSnapshots(rawSnapshots), meta, collector.getState());
  return NextResponse.json({ ...data, demoMode: config.demoMode });
}
```

For `send-now/route.ts`, use a POST handler (instead of GET):
```typescript
import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { send } from "@/lib/sender";

export const dynamic = "force-dynamic";

export async function POST() {
  const config = getConfig();
  try {
    const result = await send(config);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[send-now]", err instanceof Error ? err.message : String(err));
    return NextResponse.json(
      { error: "Failed to send message" },
      { status: 500 }
    );
  }
}
```

**Key patterns:**
- Import `getConfig()` and the service function (`send()`)
- Export `const dynamic = "force-dynamic"` to disable caching
- Name the handler `export async function POST()`
- Wrap in try/catch and return `NextResponse.json()`
- Log errors with bracketed prefix (e.g., `[send-now]`)
- Return 500 on error, 200 (default) on success with data

---

### `test/sender.test.ts` (test, testing)

**Analog:** `test/db.test.ts` (lines 1–145)

**Test framework and imports** (lines 1–7):
```typescript
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDb, getDbMeta, insertSnapshot, querySnapshots } from "../src/lib/db";
import type { Config } from "../src/lib/config";
```

For `sender.test.ts`:
```typescript
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { getDb, insertSendLog } from "../src/lib/db";
import { send } from "../src/lib/sender";
import type { Config } from "../src/lib/config";
```

**Test config setup** (lines 9–25):
```typescript
const dbPath = path.join(os.tmpdir(), `test-usage-${Date.now()}.db`);

const config: Config = {
  host: "localhost",
  port: 3017,
  appUrl: "http://localhost:3017",
  autoOpenBrowser: false,
  dataDir: os.tmpdir(),
  dbPath,
  orgId: "",
  endpoint: "https://api.anthropic.com/api/oauth/usage",
  bearerToken: "",
  sessionCookie: "",
  authMode: "none",
  hasAuth: false,
  demoMode: false,
};
```

**Cleanup pattern** (lines 41–51):
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

**Test structure** (lines 53–145):
```typescript
describe("send_log write logic", () => {
  it("inserts a row with status='ok' on success", async () => {
    // Call send(config, { timeoutMs: short_value })
    // Query send_log table
    // Assert row has correct columns, status='ok', duration_ms > 0, question is not null
  });

  it("inserts a row with status='timeout' when exceeding timeoutMs", async () => {
    // Call send with short timeout
    // Assert status='timeout', duration_ms >= timeoutMs
  });

  it("inserts a row with status='error' on non-zero exit", async () => {
    // Call send with a mock/real CLI that fails
    // Assert status='error', error_message is set
  });

  it("sets scheduled_for=NULL and is_anchor=0 for manual fires", async () => {
    // Call send(config) with no options (or explicit null/0)
    // Query the row
    // Assert scheduled_for IS NULL, is_anchor=0
  });

  it("writes only one row even if timeout fires twice", async () => {
    // Guard against race condition from Pitfall 2 in RESEARCH.md
    // Call send with short timeout
    // Query COUNT(*) WHERE fired_at ~= NOW
    // Assert count=1
  });
});
```

**Key patterns:**
- Use `node:test` + `node:assert/strict` (built-in, no external dependencies)
- Create temp DB in `os.tmpdir()` with unique filename
- Use `after()` hook to clean up DB files (including `-wal` and `-shm`)
- Test only `send_log` write logic, not spawn mechanics (per D-03)
- Use short `timeoutMs` values (e.g., 200ms) to avoid 60-second waits
- Assert row contents directly via `getDb().prepare(...).all()`

---

### `test/db.test.ts` (modify — add send_log schema test)

**Analog:** `test/db.test.ts` (lines 128–145)

**Existing schema test pattern** (lines 128–135):
```typescript
it("schema has exactly 7 columns after getDb", () => {
  const db = getDb(config);
  const cols = db.prepare("PRAGMA table_info(usage_snapshots)").all() as { name: string }[];
  assert.deepEqual(
    cols.map((c) => c.name),
    ["id", "timestamp", "status", "endpoint", "response_status", "raw_json", "error_message"]
  );
});
```

Add a new test for `send_log` table:
```typescript
it("send_log table exists with correct columns and indexes", () => {
  const db = getDb(config);
  
  // Check table exists
  const tableInfo = db.prepare(
    "PRAGMA table_info(send_log)"
  ).all() as { name: string }[];
  
  assert.deepEqual(
    tableInfo.map((c) => c.name),
    [
      "id", 
      "fired_at", 
      "scheduled_for", 
      "is_anchor", 
      "status", 
      "duration_ms", 
      "question", 
      "response_excerpt", 
      "error_message"
    ]
  );
  
  // Check index exists
  const indexes = db.prepare(
    "PRAGMA index_list(send_log)"
  ).all() as { name: string }[];
  
  assert.ok(
    indexes.some((idx) => idx.name === "idx_send_log_fired_at"),
    "Index idx_send_log_fired_at should exist"
  );
});
```

---

## Shared Patterns

### Named Exports and Function Design

**Source:** `src/lib/db.ts` (lines 91–166), `src/lib/collector.ts` (lines 42–96)

**Apply to:** All lib/ modules

All lib modules in the codebase use:
- `export function` keyword (not `export const`; not default exports)
- `camelCase` verb-first naming (`insertSnapshot`, `querySnapshots`, `send`)
- Options bag parameter for 4+ arguments: `opts?: { key?: value }` pattern

**Example:**
```typescript
export async function send(
  config: Config,
  opts?: {
    timeoutMs?: number;
    scheduledFor?: string | null;
    isAnchor?: number;
  }
): Promise<SendLogRow> { ... }
```

### Config Parameter Pattern

**Source:** `src/lib/db.ts` (lines 91–101, 113–137), `src/lib/collector.ts` (lines 186–202)

**Apply to:** All service/lib functions that need DB access

Service functions receive `Config` as the first parameter to access `config.dbPath` and `config.dataDir`. The function calls `getDb(config)` internally.

```typescript
export function insertSnapshot(config: Config, data: { ... }): void {
  const db = getDb(config);
  // ... use db
}

export async function send(config: Config, opts?: { ... }): Promise<SendLogRow> {
  const db = getDb(config);
  // ... use db
}
```

### Bracketed Console Logging

**Source:** `src/lib/collector.ts` (lines 382, 469, 477–478)

**Apply to:** All service modules that log

Log with a bracketed prefix for easy filtering:

```typescript
console.warn(`[collector] Poll failed: ${msg}`);
console.log(`[collector] Demo poll: 5h=${fiveHourUtil.toFixed(1)}%`);
console.log(`[collector] Starting (tier: ${this.tierState.currentTier}...)`);
```

For sender:
```typescript
console.error("[sender]", err instanceof Error ? err.message : String(err));
console.log("[sender]", `Sending question: "${question}"`);
```

### Async/Await with Try/Catch

**Source:** `src/lib/collector.ts` (lines 222–388)

**Apply to:** All async functions that interact with external systems

Always wrap external calls in try/catch:

```typescript
async function send(config: Config, opts?: { ... }): Promise<SendLogRow> {
  const timeoutMs = opts?.timeoutMs ?? 60_000;
  const startTime = Date.now();
  
  try {
    // Spawn process, capture output
    const result = await spawnProcess(...);
    
    // Insert success row
    insertSendLog(config, {
      fired_at: new Date().toISOString(),
      status: "ok",
      duration_ms: Date.now() - startTime,
      ...
    });
    
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[sender]", msg);
    
    // Insert error row
    insertSendLog(config, {
      fired_at: new Date().toISOString(),
      status: "error",
      error_message: msg,
      duration_ms: Date.now() - startTime,
      ...
    });
    
    return result;
  }
}
```

### Database Write Pattern (Prepared Statements)

**Source:** `src/lib/db.ts` (lines 125–137)

**Apply to:** All insertXxx() helpers

Always use prepared statements with parameter binding (no string interpolation):

```typescript
export function insertSendLog(
  config: Config,
  data: Omit<SendLogRow, "id">
): SendLogRow {
  const db = getDb(config);
  const stmt = db.prepare(`
    INSERT INTO send_log
      (fired_at, scheduled_for, is_anchor, status, duration_ms, question, response_excerpt, error_message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  const result = stmt.run(
    data.fired_at,
    data.scheduled_for,
    data.is_anchor,
    data.status,
    data.duration_ms,
    data.question,
    data.response_excerpt,
    data.error_message
  );
  
  return {
    id: result.lastInsertRowid as number,
    ...data,
  };
}
```

---

## No Analog Found

No files in this phase lack analogs. All patterns are covered by existing codebase conventions.

---

## Metadata

**Analog search scope:** `src/lib/`, `src/app/api/`, `test/`

**Files scanned:** 12 lib modules, 3 API routes, 15 test files

**Pattern extraction date:** 2026-04-20

**Key patterns identified:**
1. Service modules export named async functions; options bag for 4+ params
2. Database writes use prepared statements with insertXxx() helpers
3. All async operations wrapped in try/catch with error logging
4. Config passed as first parameter for DB access
5. Bracketed console logging with module prefix (e.g., `[sender]`)
6. API routes: `export const dynamic = "force-dynamic"` + try/catch + NextResponse.json()
7. Tests use `node:test` + `node:assert/strict`; cleanup DB files in `after()` hook

---

*Phase 3 pattern mapping completed 2026-04-20*
