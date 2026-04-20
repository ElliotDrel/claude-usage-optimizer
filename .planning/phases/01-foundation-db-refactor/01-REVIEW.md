---
phase: 01-foundation-db-refactor
reviewed: 2026-04-19T00:00:00Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - claude-usage-tracker/src/lib/db.ts
  - claude-usage-tracker/src/lib/queries.ts
  - claude-usage-tracker/src/lib/collector.ts
  - claude-usage-tracker/src/lib/collector-singleton.ts
  - claude-usage-tracker/src/lib/analysis.ts
  - claude-usage-tracker/src/app/api/dashboard/route.ts
  - claude-usage-tracker/test/db.test.ts
  - claude-usage-tracker/test/queries.test.ts
  - claude-usage-tracker/test/analysis.test.ts
findings:
  critical: 0
  warning: 5
  info: 4
  total: 9
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-04-19T00:00:00Z
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

## Summary

Reviewed the DB schema, read-side query layer (`queries.ts`), collector, singleton seeder, analysis engine, dashboard route, and all associated tests. The refactor is structurally sound — the simplified schema, WAL mode, migration guard, and `parseSnapshot` abstraction are all clean. No critical issues found.

Five warnings stand out: a SQL injection vector in the `LIMIT` clause construction, a `fs.statSync` call that throws if the DB file does not yet exist, a module-level singleton `db` variable that causes test isolation failures, a non-atomic gap between deleting and re-creating the demo DB in the singleton seeder, and an unsafe non-null assertion in `buildDashboardData`. Four info-level items cover dead code, an empty catch, a semantic ambiguity in `lastUsageWindow`, and a fragile teardown in the test suite.

---

## Warnings

### WR-01: SQL Injection via Unparameterized LIMIT Clause

**File:** `claude-usage-tracker/src/lib/db.ts:161`

**Issue:** The `limit` value is interpolated directly into the SQL string (`LIMIT ${opts.limit}`) rather than bound as a parameter. TypeScript types `opts.limit` as `number`, but this does not prevent a runtime caller — e.g., one reading from a JSON-parsed request — from passing a crafted string. Any non-numeric string that bypasses the type system will be executed verbatim by SQLite.

**Fix:** Pass `limit` as a bound parameter instead of string interpolation:

```ts
const limitClause = opts?.limit ? "LIMIT ?" : "";
const limitParam: (string | number)[] = opts?.limit ? [opts.limit] : [];

return db
  .prepare(
    `SELECT * FROM usage_snapshots ${where} ORDER BY timestamp ASC ${limitClause}`
  )
  .all(...params, ...limitParam) as SnapshotRow[];
```

---

### WR-02: `getDbMeta` Throws Unhandled ENOENT When DB File Does Not Exist

**File:** `claude-usage-tracker/src/lib/db.ts:173`

**Issue:** `fs.statSync(config.dbPath)` is called unconditionally. On a fresh install, `better-sqlite3` creates the file lazily; if the WAL checkpoint has not yet flushed the file to disk, `statSync` throws `ENOENT`. This propagates as an unhandled exception through the dashboard API route to the client.

**Fix:** Wrap `statSync` in a try/catch and default `sizeBytes` to `0`:

```ts
let sizeBytes = 0;
try {
  sizeBytes = fs.statSync(config.dbPath).size;
} catch {
  // DB not yet flushed to disk (WAL mode, first open)
}
return { path: config.dbPath, sizeBytes, totalSnapshots: count };
```

---

### WR-03: Module-Level `db` Singleton Breaks Test Isolation

**File:** `claude-usage-tracker/src/lib/db.ts:5`

**Issue:** `let db: Database.Database | null = null` is a module-level variable. `getDb` ignores `config.dbPath` on every call after the first — it returns the cached instance regardless of which path is passed. If two test suites (or two tests within the same suite) call `getDb` with different `Config` objects, all calls after the first silently operate against the original DB file. The `db.test.ts` column-count test passes only because it is the first (and only) test file opened in isolation.

**Fix:** Key the cache on `dbPath`:

```ts
const dbCache = new Map<string, Database.Database>();

export function getDb(config: Config): Database.Database {
  if (dbCache.has(config.dbPath)) return dbCache.get(config.dbPath)!;
  fs.mkdirSync(config.dataDir, { recursive: true });
  const instance = new Database(config.dbPath);
  instance.pragma("journal_mode = WAL");
  instance.exec(SCHEMA);
  migrateToSimplifiedSchema(instance);
  dbCache.set(config.dbPath, instance);
  return instance;
}

/** For tests only — close and evict a DB from the cache. */
export function closeDb(dbPath: string): void {
  const instance = dbCache.get(dbPath);
  if (instance) { instance.close(); dbCache.delete(dbPath); }
}
```

Update `db.test.ts` `after` hook to call `closeDb(dbPath)` instead of `getDb(config).close()`.

---

### WR-04: Non-Atomic Demo DB Teardown Creates a Race Window

**File:** `claude-usage-tracker/src/lib/collector-singleton.ts:56-61`

**Issue:** `seedDemoData` calls `fs.unlinkSync` to delete the DB files, then immediately calls `getDb` to recreate them. Any concurrent request (e.g., a second Next.js API call during hot-reload) that arrives between the delete and the recreate will receive a `SQLITE_CANTOPEN` or operate on a stale cached `db` handle that points to a deleted file.

**Fix:** Rather than deleting the file, clear the data transactionally inside the open DB, which is atomic:

```ts
function seedDemoData(config: Config) {
  const db = getDb(config);
  db.transaction(() => {
    db.prepare("DELETE FROM usage_snapshots").run();
    db.prepare("DELETE FROM app_meta").run();
    // re-stamp schema_version so migrator stays satisfied
    db.prepare(
      "INSERT INTO app_meta (key, value) VALUES ('schema_version', 'simplified-v1') ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ).run();
  })();
  // ... insertAll as before
}
```

---

### WR-05: Non-Null Assertion on `resets_at` Without Paired Null Guard

**File:** `claude-usage-tracker/src/lib/analysis.ts:322,328`

**Issue:** Inside the `five_hour_utilization != null` branch, `lastSuccess.five_hour_resets_at!` uses a TypeScript non-null assertion. `ParsedSnapshot` permits `five_hour_utilization` to be non-null while `five_hour_resets_at` is null (the normalizer does not guarantee co-presence). If that state is reached, `current.fiveHour.resetsAt` will be `undefined` at runtime despite being typed as `string`, silently breaking any downstream consumer that reads it. Line 328 has the same issue for `seven_day_resets_at`.

**Fix:** Add an explicit null check for `resets_at` before constructing the object:

```ts
fiveHour:
  lastSuccess.five_hour_utilization != null && lastSuccess.five_hour_resets_at != null
    ? { utilization: lastSuccess.five_hour_utilization, resetsAt: lastSuccess.five_hour_resets_at }
    : null,
sevenDay:
  lastSuccess.seven_day_utilization != null && lastSuccess.seven_day_resets_at != null
    ? { utilization: lastSuccess.seven_day_utilization, resetsAt: lastSuccess.seven_day_resets_at }
    : null,
```

---

## Info

### IN-01: Dead Code — `centsToDollars` in `collector.ts` Is Unused

**File:** `claude-usage-tracker/src/lib/collector.ts:113-116`

**Issue:** A module-level `centsToDollars` function is defined but never called. The conversion now happens inside `parseSnapshot` in `queries.ts` (an identical arrow function on line 48). The version in `collector.ts` is dead code.

**Fix:** Delete lines 113-116 from `collector.ts`. If the function is needed elsewhere, export it from `queries.ts`.

---

### IN-02: Empty Catch in Demo Polling Silently Swallows DB Errors

**File:** `claude-usage-tracker/src/lib/collector.ts:410`

**Issue:** The dynamic `import("./db")` block in `pollDemo` is wrapped in a try/catch with an empty body (`/* fall through */`). A module resolution failure or DB crash here produces no log output and causes `demoFiveHour` to silently default to `30`, making demo-mode startup failures invisible.

**Fix:**
```ts
} catch (err) {
  console.warn("[collector] Demo: failed to read last snapshot:", err);
}
```

---

### IN-03: `lastUsageWindow` Has Silent Last-Write-Wins Behavior

**File:** `claude-usage-tracker/src/lib/analysis.ts:205-206`

**Issue:** `recordEvent` is called for `delta5h` first, then `delta7d`. If both windows have positive deltas in the same interval, `lastUsageAt` and `lastUsageWindow` will reflect the 7D window (the second call overwrites the first). This means the dashboard can report "last usage: 7D window" when the 5H window was also active in the same tick — a misleading signal for the scheduler.

**Fix:** Prefer 5H when both are positive (it is the operationally critical window):
```ts
if (delta5h > 0) recordEvent(delta5h, "5H");
else if (delta7d > 0) recordEvent(delta7d, "7D");
```

---

### IN-04: `db.test.ts` Teardown Opens a New DB Connection Just to Close It

**File:** `claude-usage-tracker/test/db.test.ts:42-44`

**Issue:** The `after` hook guards with `fs.existsSync(dbPath)` but then calls `getDb(config).close()`. If the module-level `db` singleton was already closed or never opened (e.g., all tests skipped), `getDb` opens a new connection only to immediately close it. With WR-03's fix (`closeDb` export), this becomes:

```ts
after(() => {
  closeDb(dbPath);
  for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    if (fs.existsSync(f)) fs.rmSync(f, { force: true });
  }
});
```

---

_Reviewed: 2026-04-19T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
