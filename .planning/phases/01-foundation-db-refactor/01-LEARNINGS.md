---
phase: 1
phase_name: "Foundation & DB Refactor"
project: "Claude Usage Optimizer"
generated: "2026-04-19"
counts:
  decisions: 5
  lessons: 4
  patterns: 7
  surprises: 4
missing_artifacts:
  - "01-UAT.md"
---

# Phase 1 Learnings: Foundation & DB Refactor

## Decisions

### Delete Python sender without preservation
The `Claude Message Sender/` Python files were deleted outright with no archival or logic porting.

**Rationale:** Full greenfield rebuild was authorized; Python sender logic does not carry forward to the Node.js replacement. Preserving it would create dead code confusion.
**Source:** 01-01-SUMMARY.md

---

### auth_mode string literal retained in migrator only — not as a schema column
The old `auth_mode` column value (`"cookie"` / `"bearer"`) is used inside the migrator's PRAGMA introspection to detect whether the database is still on the old schema. It is never written as a column in the new schema.

**Rationale:** The migrator needs a way to detect the pre-migration state without relying on `app_meta` (which may itself be missing). Reading the old column list is the safest detection path. This is migration-only code, not a schema regression.
**Source:** 01-02-SUMMARY.md

---

### DashboardData.health types changed to ParsedSnapshot instead of SnapshotRow
The `health` field in `DashboardData` was updated to carry `ParsedSnapshot` objects rather than raw `SnapshotRow` objects.

**Rationale:** All identity fields needed by dashboard components (`status`, `timestamp`, `endpoint`, `error_message`) exist on `ParsedSnapshot`, so no downstream component changes were required. Using `ParsedSnapshot` maintains a single type flowing through the entire read path.
**Source:** 01-05-SUMMARY.md

---

### computeDelta dynamic key access replaced with explicit conditional
The original `computeDelta` used a dynamic bracket index (`row[key]`) to access utilization fields. This was replaced with explicit `if/else` branching on field name.

**Rationale:** `ParsedSnapshot` does not have an index signature — dynamic key access would require `[key: string]: unknown` which breaks the strict interface. Explicit conditionals are more readable and TypeScript-safe.
**Source:** 01-05-SUMMARY.md

---

### normalizeUsagePayload retained in collector.ts for in-memory delta only
Despite removing all structured columns from the write path, `normalizeUsagePayload` was kept in `collector.ts` for use in `computePollingDelta`.

**Rationale:** The in-memory delta computation (determining polling tier) still needs typed utilization values extracted from the live API response. Only the DB write path changed — the in-memory compute path is unaffected.
**Source:** 01-04-PLAN.md

---

## Lessons

### Worktrees do not inherit node_modules — run npm install before tests
When a git worktree is created, it shares the `.git` directory but has its own working tree. Sub-project `node_modules` directories (e.g., `claude-usage-tracker/node_modules`) are not present until explicitly installed.

**Context:** The 01-02 executor agent encountered a missing `tsx` binary in the worktree and had to run `npm install` inside `claude-usage-tracker/` before tests could pass. This is a Rule 3 auto-fix (unblock and continue).
**Source:** 01-02-SUMMARY.md

---

### Untracked SUMMARY.md files in the main working tree block subsequent worktree merges
When an executor agent writes a SUMMARY.md to a path that also exists as an untracked file in the main working tree, the merge aborts with "untracked working tree files would be overwritten."

**Context:** Merging the 01-02 worktree failed because `.planning/phases/01-foundation-db-refactor/01-02-SUMMARY.md` existed as an untracked file in the main worktree (likely copied out by the GSD harness). The fix is to delete the untracked file before retrying the merge. The authoritative version comes from the worktree's committed history.
**Source:** Orchestrator execution — Wave 1 merge

---

### Boolean field comparisons require === true not === 1 in ParsedSnapshot context
A bug was found in `analysis.ts` where `extra_usage_enabled` was compared with `=== 1` (integer) rather than `=== true` (boolean). This caused the extra usage card to never render.

**Context:** In the old `SnapshotRow` schema, SQLite boolean columns returned as integers (0/1). After switching to `ParsedSnapshot`, the field is explicitly parsed as a JavaScript boolean in `parseSnapshot`. The comparison `=== 1` always evaluates `false` against a boolean, silently suppressing all extra-usage rendering. The 01-05 executor caught and fixed this.
**Source:** 01-05-SUMMARY.md

---

### Parallel worktree agents may land commits directly on main if the branch base matches
During Wave 3 merging, the 01-04 worktree merge reported "Already up to date" — meaning the executor's commits were already reachable from `main` HEAD without a merge commit.

**Context:** This can happen when git resolves the worktree branch as a fast-forward of main, so the commits appear on main directly. The SUMMARY.md and code changes were correctly present; the worktree branch simply pointed to an ancestor already on main. Treat as successful and proceed to cleanup.
**Source:** Orchestrator execution — Wave 3 merge

---

## Patterns

### Idempotent migration via app_meta schema_version marker
Use a `CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT)` table as a key-value store for migration state. Write `schema_version = 'simplified-v1'` after migration completes. At startup, check this key before running migration logic — return immediately if the version is already current.

**When to use:** Any time a SQLite schema migration must be safe to re-run across restarts, deployments, or duplicate process starts. The pattern avoids column-existence checks (fragile) and full re-migrations (slow/destructive).
**Source:** 01-02-SUMMARY.md

---

### CREATE/COPY/DROP/RENAME for non-destructive column removal in SQLite
SQLite does not support `DROP COLUMN` in older versions. The safe pattern for removing columns: `CREATE TABLE new_schema`, `INSERT INTO new_schema SELECT ... FROM old_table`, `DROP TABLE old_table`, `ALTER TABLE new_schema RENAME TO old_table`. Wrap in a transaction for atomicity.

**When to use:** Any SQLite schema migration that removes or renames columns. Works on all SQLite versions, including the bundled version in better-sqlite3.
**Source:** 01-02-SUMMARY.md

---

### Read-side parsing layer: raw_json → typed interface via pure functions
Store raw API response as a verbatim JSON string. On read, parse into a typed interface via a pure function (`parseSnapshot`). The pure function handles shape variants, null safety, and unit conversion (cents → dollars). Downstream consumers receive only the typed interface — they never touch raw JSON.

**When to use:** When API response shapes vary (cookie-auth vs bearer-auth), or when the schema must survive future API changes without re-migration. Pure parsing functions are trivially testable in isolation with fixture strings.
**Source:** 01-03-SUMMARY.md

---

### Cookie-auth vs bearer-auth detection via 'usage' key presence
Cookie-auth responses wrap the usage payload under a top-level `usage` key. Bearer-auth responses have the usage object at the root. Detection: `if ('usage' in parsed) { payload = parsed.usage } else { payload = parsed }`.

**When to use:** Any code that parses Claude API usage responses when the auth mode is not known at parse time (e.g., when loading from the database where auth mode is no longer stored as a column).
**Source:** 01-03-SUMMARY.md

---

### Demo utilization encoded as structured raw_json for parseSnapshot compatibility
When writing demo/synthetic snapshots to the database, encode utilization as a JSON object that `normalizeUsagePayload` and `parseSnapshot` can parse: `{ five_hour: { utilization: N, resets_at: ISO }, seven_day: { utilization: N, resets_at: ISO } }`. This shape passes the `isUsageBucket` check (has both `utilization` and `resets_at` keys).

**When to use:** Any demo seeder or synthetic data generator that needs the standard read path to return meaningful values without hitting a real API.
**Source:** 01-04-SUMMARY.md, 01-04-PLAN.md

---

### insertSnapshot calls are safe inside better-sqlite3 db.transaction() wrappers
better-sqlite3 transactions are synchronous and re-entrant when called from within another transaction. `insertSnapshot` can be called inside a `db.transaction(() => { ... })` callback without deadlock.

**When to use:** Any bulk-insert scenario (demo seeder, batch ingestion) where you want atomicity across multiple `insertSnapshot` calls.
**Source:** 01-04-SUMMARY.md

---

### TDD RED→GREEN for pure parsing modules yields high test confidence
Write failing test cases first (RED commit), then implement the parser (GREEN commit). For `queries.ts`, this produced 10 test cases covering: null raw_json, bearer-auth, cookie-auth, demo shape, cents-to-dollars, no-extra-usage flag, malformed JSON, boolean field, empty array, and 2-row array. Each case is a fixture string — no mocking required.

**When to use:** Any pure function that transforms external data (API payloads, stored JSON) into typed domain objects. The fixture-string approach is faster to write than integration tests and eliminates false confidence from mocked parsers.
**Source:** 01-03-SUMMARY.md

---

## Surprises

### extra_usage_enabled boolean bug would have silently suppressed the extra-usage card forever
The comparison `extra_usage_enabled === 1` in `analysis.ts` always evaluates `false` when the field is a JavaScript boolean (as returned by `parseSnapshot`). The extra-usage card would never have rendered in production after the migration, with no error thrown.

**Impact:** Silent regression caught by the 01-05 executor during implementation. If missed, it would have surfaced only when a user with extra usage enabled noticed the card was blank — potentially weeks after deployment.
**Source:** 01-05-SUMMARY.md

---

### Worktrees require npm install — tsx binary missing causes test failures
The `tsx` binary used by `npm test` is inside `claude-usage-tracker/node_modules/.bin/`. This directory is not present in a fresh git worktree because `node_modules` is gitignored. Tests fail immediately with "tsx is not recognized."

**Impact:** Low — the agent auto-resolved by running `npm install`. But it adds ~30s overhead per worktree agent that needs to run the test suite. Could be mitigated by a pre-populate step or by using `npx tsx` instead of the local binary.
**Source:** 01-02-SUMMARY.md

---

### Untracked SUMMARY.md in main working tree silently exists alongside committed one
After the 01-01 merge, the main working tree had an untracked `01-02-SUMMARY.md` that was not committed to the branch (likely the GSD harness staged it). This blocked the 01-02 merge with a non-obvious error message.

**Impact:** One extra step required: delete the untracked file before retrying the merge. Not blocking, but surprising. Suggests the GSD harness may write SUMMARY.md files to the main working tree during agent execution even when the agent is in a worktree.
**Source:** Orchestrator execution — Wave 1 merge

---

### Wave 3 01-04 worktree merge was "Already up to date" — commits appeared on main directly
The 01-04 executor's commits were already reachable from main HEAD when the orchestrator attempted the merge, producing "Already up to date" with no merge commit created.

**Impact:** Zero — all code changes and SUMMARY.md were present and correct. The worktree cleanup (remove + branch delete) still succeeded. This behavior is a git fast-forward resolution and is safe, but unexpected in a parallel worktree execution context where a merge commit was expected.
**Source:** Orchestrator execution — Wave 3 merge
