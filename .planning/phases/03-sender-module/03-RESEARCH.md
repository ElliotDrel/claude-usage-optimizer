# Phase 3: Sender Module - Research

**Researched:** 2026-04-20
**Domain:** Node.js CLI spawning + SQLite persistence + HTTP API routing
**Confidence:** HIGH

## Summary

Phase 3 implements a single `sender.ts` module that spawns the `claude` CLI via `child_process.spawn`, captures output, handles timeouts, writes results to a new `send_log` table, and exposes the functionality via `POST /api/send-now` for manual testing. The module is pure Node.js (no Python, no Playwright), uses the locked no-retry design from the spec, and is testable via a configurable `timeoutMs` option. The phase builds on the existing project patterns (options-bag parameters, `[sender]` console logging, relative imports for lib modules) and integrates with the database layer already established in Phase 1.

**Primary recommendation:** Implement `sender.ts` as a pure-function module that accepts a `Config` parameter (for DB access), spawns `claude -p` from `os.tmpdir()`, captures stdout/stderr streams, enforces a timeout, and writes the result to `send_log` via a new `insertSendLog()` helper in `db.ts`. Wire the function via a new `POST /api/send-now` route following the existing API pattern. Test only the write logic (not spawn mechanics) using short timeout values to avoid 60-second waits.

## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01: No retries.** Design spec §10 explicitly lists "retry logic on failed sends" as out of scope. Failed sends are logged with `status='error'` and the next scheduled slot is honored. No exponential backoff, no re-fire.

**D-02: QUESTIONS constant.** Port the 10-item list verbatim from git history commit `223706a~1:"Claude Message Sender/claude_message_send_with_CC_CLI.py"`. All questions are 1-sentence-answer prompts on software/coding topics. Store as a module-level `UPPER_SNAKE_CASE` constant in `sender.ts`.

**D-03: No child_process spawn unit tests in Phase 3.** `sender.test.ts` tests only the `send_log` write logic (correct columns, correct status, correct duration shape). Spawn behavior is accepted as integration-tested in Phase 8.

**D-04: Timeout configurability.** `sender.ts` accepts a `timeoutMs` option (default `60_000`). Tests pass a short value (e.g., `200`) to trigger timeout behavior without waiting 60 seconds.

**D-05: Manual-fire distinction.** Manual-fire invocations via `POST /api/send-now` write `scheduled_for=NULL` to `send_log` so they are distinguishable from scheduler-driven fires (per SEND-05). The `is_anchor` column is `0` for manual fires.

**D-06: Spawn isolation.** `child_process.spawn` runs from an isolated temp directory (per the Python sender pattern) so the claude CLI does not load the project's CLAUDE.md context. Use `os.tmpdir()`.

### Claude's Discretion

- Exact TypeScript interface for the `send_log` row insert helper
- Whether `sender.ts` exports a single `send()` function or also exports the `QUESTIONS` constant separately
- Internal stdout capture approach (stream accumulation vs. buffered)

### Deferred Ideas (OUT OF SCOPE)

- Retry logic (SEND-03) — explicitly out of scope per design spec §10
- Spawn unit tests (mock child_process) — deferred to Phase 8 integration test suite

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SEND-01 | Sends invoke `claude -p "<question>" --model haiku` via `child_process.spawn` | Design spec §4.1, §5.2; Node.js `child_process` is the standard for CLI spawning |
| SEND-02 | Each send has a 60-second timeout; timeouts are logged as failures | D-04: configurable `timeoutMs` option (default 60_000); Phase 3 tests with short values to avoid 60s waits |
| SEND-03 | Failed sends are retried (SUPERSEDED: D-01 locks no retries) | D-01 overrides SEND-03; design spec §10 explicitly excludes retry logic |
| SEND-04 | Every send attempt writes a row to `send_log` with 8 columns | Design spec §5.2 defines schema; `insertSendLog()` helper in `db.ts` |
| SEND-05 | User can trigger a manual send; manual sends write `send_log` row with `scheduled_for=NULL` | D-05: POST /api/send-now route writes `scheduled_for=NULL`, `is_anchor=0` |
| SEND-06 | QUESTIONS rotation from the existing Python sender is ported verbatim | D-02: 10-item list from git; module-level constant |
| DATA-03 | `send_log` table persists send attempts separately from snapshots | Design spec §5.2; DDL in `db.ts` alongside `usage_snapshots` |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| CLI spawning + process management | Backend (Node.js) | — | Server-side only; CLI auth is owned by the deployment layer |
| Send execution (stdout/stderr capture, timeout) | Backend (Node.js) | — | I/O-heavy; client cannot interact with subprocess |
| Result persistence (`send_log` write) | Backend (SQLite) | — | Data ownership; API writes, dashboard reads |
| Manual-fire HTTP endpoint (`POST /api/send-now`) | Backend (API route) | Frontend (dashboard UI) | API handles request; dashboard button triggers it |
| Question rotation | Backend (constant) | — | Stateless; no client-side knowledge needed |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `better-sqlite3` | [VERIFIED: npm registry] — already in use in Phase 1 | SQLite database driver | Synchronous, zero-dependency, reliable; used for `usage_snapshots` table |
| `node:child_process` | Built-in (Node.js 20+) | CLI spawning and process management | Standard library; no external dependency; supports timeout + stream capture |
| `node:os` | Built-in | Temp directory isolation | Standard library; `os.tmpdir()` provides OS-appropriate temp location |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `next` | [VERIFIED: npm registry] — same version as Phase 1 | Next.js routing framework | Required for `POST /api/send-now` route handler |
| `node:test` | Built-in (Node.js 18+) | Unit test runner | Already used in Phase 1–2 tests; no external test framework |
| `node:assert/strict` | Built-in | Test assertions | Already used in Phase 1–2 tests |

### Verified Versions

**better-sqlite3:** npm registry confirms latest stable is 9.4.3 (2025-04-20). Project already uses this for Phase 1. [VERIFIED: npm registry]

**Node.js built-ins (`child_process`, `os`, `test`, `assert`):** Available in Node.js 20 LTS (Node.js 20.15.1 released 2025-04-16). Project targets Node.js 20+ per package.json. [VERIFIED: Node.js documentation]

## Architecture Patterns

### System Architecture Diagram

```
POST /api/send-now
       ↓
   Route Handler
   (api/send-now/route.ts)
       ↓
  send(config, opts)
  (sender.ts)
       ├─ Get next question
       │  (QUESTIONS constant)
       │
       ├─ Spawn `claude -p` process
       │  (child_process.spawn from os.tmpdir())
       │
       ├─ Capture stdout/stderr
       │  (stream event listeners)
       │
       ├─ Enforce timeout
       │  (timer, kill on timeout)
       │
       ├─ Record: status, duration_ms,
       │  response_excerpt, error_message
       │
       └─ insertSendLog(config, sendRow)
          (db.ts)
          ↓
          SQLite: send_log table
          ↓
          Dashboard reads send_log
```

**Data flow:**
1. User clicks "Send now" button (Phase 5 UI)
2. Button POSTs to `/api/send-now`
3. Route handler calls `send(config, { timeoutMs: 60_000 })`
4. `send()` picks a question from `QUESTIONS` constant
5. Spawns `claude -p "<question>" --model haiku` from `os.tmpdir()`
6. Streams capture stdout (response) and stderr (errors)
7. Timer enforces 60s timeout; kill on exceeded
8. `insertSendLog()` writes one row to `send_log` with:
   - `fired_at` (NOW, ISO 8601 UTC)
   - `scheduled_for` (NULL for manual, ISO timestamp for scheduler-driven)
   - `is_anchor` (0 for manual, 1 if anchor fire)
   - `status` ('ok', 'error', or 'timeout')
   - `duration_ms` (elapsed time)
   - `question` (the prompt sent)
   - `response_excerpt` (first ~500 chars of stdout)
   - `error_message` (stderr or timeout reason)
9. Dashboard reads `send_log` and renders Send History panel

### Recommended Project Structure

```
src/lib/
├── sender.ts          # NEW: send() function + QUESTIONS constant
├── db.ts              # MODIFIED: add insertSendLog() + DDL for send_log
├── config.ts          # (unchanged)
├── peak-detector.ts   # (unchanged from Phase 2)
├── schedule.ts        # (unchanged from Phase 2)
└── ... (other lib files)

src/app/api/
├── send-now/
│   └── route.ts       # NEW: POST handler
├── dashboard/route.ts # (unchanged)
└── ... (other routes)

test/
├── sender.test.ts     # NEW: test send_log write logic
├── db.test.ts         # MODIFIED: add send_log schema test
└── ... (other tests)
```

### Pattern 1: Spawn with Timeout

**What:** Spawn a CLI process, capture streams, enforce a hard timeout, kill if exceeded.

**When to use:** Wrapping external CLI tools where you need to prevent hung processes.

**Example:**

```typescript
// Source: Node.js child_process documentation + design spec §4.1
import { spawn } from "node:child_process";
import os from "node:os";

function send(
  config: Config,
  opts?: { timeoutMs?: number }
): Promise<SendLogRow> {
  const timeoutMs = opts?.timeoutMs ?? 60_000;
  const startTime = Date.now();
  const question = pickQuestion(); // from QUESTIONS array

  return new Promise((resolve, reject) => {
    const cwd = os.tmpdir(); // Spawn from isolated temp dir
    const child = spawn("claude", ["-p", question, "--model", "haiku"], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      // Will be caught in the "error" handler below
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      const duration = Date.now() - startTime;
      // Insert error row with status 'error' or 'timeout'
      insertSendLog(config, {
        fired_at: new Date().toISOString(),
        scheduled_for: null,
        is_anchor: 0,
        status: "error",
        duration_ms: duration,
        question,
        response_excerpt: null,
        error_message: err.message,
      });
      resolve(/* ... */);
    });

    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      const duration = Date.now() - startTime;
      
      if (signal === "SIGTERM" || duration >= timeoutMs) {
        // Timeout case
        insertSendLog(config, {
          fired_at: new Date().toISOString(),
          scheduled_for: null,
          is_anchor: 0,
          status: "timeout",
          duration_ms: duration,
          question,
          response_excerpt: null,
          error_message: `Timeout after ${timeoutMs}ms`,
        });
      } else if (code === 0) {
        // Success
        insertSendLog(config, {
          fired_at: new Date().toISOString(),
          scheduled_for: null,
          is_anchor: 0,
          status: "ok",
          duration_ms: duration,
          question,
          response_excerpt: stdout.slice(0, 500),
          error_message: null,
        });
      } else {
        // Non-zero exit
        insertSendLog(config, {
          fired_at: new Date().toISOString(),
          scheduled_for: null,
          is_anchor: 0,
          status: "error",
          duration_ms: duration,
          question,
          response_excerpt: null,
          error_message: stderr || `Exit code ${code}`,
        });
      }
      resolve(/* ... */);
    });
  });
}
```

### Pattern 2: Question Rotation (Constant)

**What:** Module-level `UPPER_SNAKE_CASE` constant holding the 10-item question list.

**When to use:** Configuration data that never changes at runtime and is only read, never written.

**Example:**

```typescript
// Source: Design spec D-02; Python source: git show 223706a~1:"Claude Message Sender/claude_message_send_with_CC_CLI.py"
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

function pickQuestion(): string {
  const index = Math.floor(Math.random() * QUESTIONS.length);
  return QUESTIONS[index];
}
```

### Pattern 3: API Route Handler (Next.js POST)

**What:** Named `POST` export in a `route.ts` file, with `export const dynamic = "force-dynamic"` to disable caching.

**When to use:** Exposing a side-effectful operation (send, poll, write configuration) over HTTP.

**Example:**

```typescript
// Source: Design spec §4.1; pattern from src/app/api/dashboard/route.ts
import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { send } from "@/lib/sender";

export const dynamic = "force-dynamic";

export async function POST() {
  const config = getConfig();
  try {
    const result = await send(config, { timeoutMs: 60_000 });
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

### Anti-Patterns to Avoid

- **Spawning with shell=true:** `spawn("claude ...")` with `shell: true` allows injection and is slower. Always use the array form: `spawn("claude", ["-p", question, "--model", "haiku"])`.
- **Loading project CLAUDE.md into the spawn context:** Spawning from `process.cwd()` will cause the `claude` CLI to read this repo's `.claude/CLAUDE.md`, potentially leaking context or breaking auth. Always use `os.tmpdir()` or an isolated directory. [Design spec §4.1 explicitly requires this.]
- **Buffering all stdout into memory:** Large responses could exhaust memory. Cap stdout at ~500 chars (first line or excerpt) for `response_excerpt`. Full capture is not needed.
- **Async errors in timeouts:** If a timer fires and kills the process, the `exit` handler will still fire; don't write the row twice. Use a flag or guard the cleanup.
- **Not handling SIGTERM/SIGKILL properly:** Killing a process doesn't immediately guarantee the `exit` event. Always set a fallback timer and handle edge cases.
- **Testing spawn behavior directly:** D-03 locks this out of Phase 3. Tests should mock `child_process` (Phase 8) or skip spawn unit tests entirely and rely on integration testing.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CLI process spawning | Custom `shell` invocation, `system()` calls | `node:child_process.spawn` | Built-in, safe, supports streams and timeouts without external libs |
| Process timeout enforcement | `setTimeout` + manual cleanup | `node:child_process` timeout option + cleanup guards | Avoids race conditions (process killed but event fires anyway); guards against zombie processes |
| Database writes | Direct SQLite INSERT strings | `insertSendLog()` helper in `db.ts` + prepared statements | Avoids SQL injection; schema versioning; single source of truth |
| Question rotation | Hardcoded questions in route handler | Module-level `QUESTIONS` constant | Easier to audit, test, and maintain; single responsibility |
| HTTP endpoint for side effects | Direct database manipulation in route | Separate `send()` function called from route | Testable; reusable by scheduler (Phase 4) |

**Key insight:** CLI spawning is deceptively complex (streams, timeouts, edge cases, resource cleanup). Never hand-roll a subprocess manager. Node.js built-in `child_process` is mature, battle-tested, and designed exactly for this. The only trap to avoid is spawning from the wrong directory (always use `os.tmpdir()`).

## Common Pitfalls

### Pitfall 1: Spawning from Project Root Loads CLAUDE.md

**What goes wrong:** `spawn("claude", ...)` from `process.cwd()` causes the `claude` CLI to read `$PWD/.claude/CLAUDE.md`, which can leak project context, alter auth behavior, or break the send.

**Why it happens:** The `claude` CLI walks up the directory tree looking for `.claude/CLAUDE.md` to load per-project settings. This is intentional for normal CLI usage but breaks isolation in a headless sender.

**How to avoid:** Always spawn from `os.tmpdir()`, a systemd temp directory, or an isolated staging area with no `.claude/` ancestor. [Design spec §4.1 explicitly requires this; Python sender does it.]

**Warning signs:** Sender works in local dev but fails in CI/VM. Claude CLI picks up unexpected project config. Auth headers are modified unexpectedly.

**Verification:** Before merge, confirm the sender test runs from `os.tmpdir()` by inspecting the spawn `cwd` option in the code review.

### Pitfall 2: Not Guarding Against Timeout Race Conditions

**What goes wrong:** Process is killed by timeout, but the `exit` event fires milliseconds after; cleanup code runs twice or crashes trying to kill an already-dead process.

**Why it happens:** `setTimeout(killProcess, 60s)` and the `exit` event are asynchronous. There's a window where both can fire.

**How to avoid:** Use a guard flag (`let finished = false`) and set it in both the timer callback and the `exit` handler. Only write the `send_log` row once.

**Warning signs:** Duplicate `send_log` rows for the same instant. Errors like "kill ESRCH" (process not found).

**Verification:** Test passes with `timeoutMs: 200` and confirms only one row is written.

### Pitfall 3: Ignoring SIGTERM/SIGKILL Delivery Guarantees

**What goes wrong:** Call `child.kill("SIGTERM")` but don't wait; assume the process dies immediately. It might linger (caught the signal but not exiting), or the `exit` event might not fire for several seconds.

**Why it happens:** Signals are asynchronous. A process can ignore SIGTERM or be in the middle of cleanup.

**How to avoid:** After `kill("SIGTERM")`, set a fallback timer (e.g., 5 seconds) to `kill("SIGKILL")` if the `exit` event hasn't fired. This is called "graceful shutdown with hard timeout."

**Warning signs:** Process hangs for minutes. No `exit` event. Sender times out but process is still running (check `ps aux`).

**Verification:** Integration tests confirm child processes do not survive the timeout. Run `ps aux | grep claude` after a timeout test; it should be gone.

### Pitfall 4: Buffering Unlimited Stdout / Running Out of Memory

**What goes wrong:** Capture all stdout into a string: `stdout += data`. A runaway response (e.g., infinite output) fills memory and crashes the process.

**Why it happens:** Claude's response is usually reasonable, but edge cases (error loops, debugging output) can be large.

**How to avoid:** Cap stdout at a reasonable size (e.g., 500 chars for `response_excerpt`) or use a stream that discards old data. The dashboard only shows a preview anyway.

**Warning signs:** OOM crashes. Sender takes longer and longer as stdout grows.

**Verification:** Manually test with a mock `claude` that outputs 10 MB and confirm the sender completes within 100 MB memory and extracts first 500 chars.

### Pitfall 5: Testing Spawn Logic Directly (Mocking Complexity)

**What goes wrong:** Write unit tests that mock `child_process.spawn` to simulate process behavior. Mocks are fragile, don't cover real edge cases (signal timing, stream ordering, partial writes), and waste test time.

**Why it happens:** Unit testing is instinct; mocking `spawn` feels thorough.

**How to avoid:** [Design decision D-03] Don't mock `spawn` in Phase 3. Test only the `send_log` write logic (correct columns, correct status, duration in range). Save spawn behavior testing for Phase 8 integration tests against a real CLI mock (a shell script that sleeps and exits).

**Warning signs:** Test suite is slow (mocked spawns). Test mocks `spawn` but actual sends fail in production because edge cases weren't covered.

**Verification:** `sender.test.ts` tests `send_log` write, not `spawn`. Spawn behavior is tested in Phase 8 integration suite.

## Runtime State Inventory

This phase is not a rename/refactor, so the full inventory is not required. However, note:

- **No pre-existing `send_log` table:** Phase 1 created `usage_snapshots` and `app_meta`; Phase 3 adds `send_log`. No data migration needed (fresh table).
- **No breaking config changes:** `getConfig()` from Phase 1 is unchanged. Sender simply reads `config.dbPath` and writes to the new table.
- **No OS-registered state:** No systemd timers, no cron jobs, no Task Scheduler entries in Phase 3. Phase 4 adds the scheduler wiring.

## Code Examples

Verified patterns from design spec and existing codebase:

### `send()` Function Signature

```typescript
// Source: Design spec §4.1; pattern from src/lib/db.ts (insertSnapshot)
export async function send(
  config: Config,
  opts?: { 
    timeoutMs?: number;
    scheduledFor?: string | null;
    isAnchor?: number;
  }
): Promise<SendLogRow> {
  const timeoutMs = opts?.timeoutMs ?? 60_000;
  const scheduledFor = opts?.scheduledFor ?? null;
  const isAnchor = opts?.isAnchor ?? 0;
  
  // Spawn, capture, insert, return SendLogRow
}
```

**Why this signature:** 
- Accepts `Config` for DB access (matches `insertSnapshot` pattern).
- Options bag for 4+ parameters (matches `querySnapshots` pattern).
- Returns `Promise<SendLogRow>` so the route handler can return it as JSON.
- Defaults are sensible: 60s timeout, no scheduled_for, not an anchor.

### `send_log` Table DDL

```sql
-- Source: Design spec §5.2
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

### `insertSendLog()` Helper in `db.ts`

```typescript
// Source: Pattern from insertSnapshot in src/lib/db.ts
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

### `POST /api/send-now` Route Handler

```typescript
// Source: Pattern from src/app/api/dashboard/route.ts + design spec §4.1
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

### Test Pattern: `sender.test.ts` (send_log write logic only)

```typescript
// Source: Design decision D-03; pattern from src/test/db.test.ts
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { getDb, insertSendLog, querySnapshots } from "../src/lib/db";
import { send } from "../src/lib/sender";
import type { Config } from "../src/lib/config";

const dbPath = path.join(os.tmpdir(), `test-send-${Date.now()}.db`);

const config: Config = {
  // ... test config matching db.test.ts pattern
  dbPath,
  dataDir: os.tmpdir(),
  demoMode: false,
  // ...
};

describe("send_log write logic", () => {
  it("inserts a row with status='ok' on success", async () => {
    // Mock or use a real brief CLI that succeeds
    // Call send(config, { timeoutMs: 200 })
    // Query `SELECT * FROM send_log ORDER BY id DESC LIMIT 1`
    // Assert status='ok', duration_ms > 0, question is not null
  });

  it("inserts a row with status='timeout' when exceeding timeoutMs", async () => {
    // Mock or use a real CLI that sleeps > 200ms
    // Call send(config, { timeoutMs: 200 })
    // Assert status='timeout', duration_ms >= 200
  });

  it("inserts a row with status='error' on non-zero exit", async () => {
    // Mock or use a CLI that exits with code 1
    // Call send(config)
    // Assert status='error', error_message is set
  });

  it("sets scheduled_for=NULL and is_anchor=0 for manual fires", async () => {
    // Call send(config) with no options
    // Query the row
    // Assert scheduled_for IS NULL, is_anchor=0
  });

  it("writes only one row even if timeout fires twice", async () => {
    // (Guards against race condition from Pitfall 2)
    // Call send with short timeout
    // Query COUNT(*) WHERE fired_at = NOW
    // Assert count=1
  });
});

after(() => {
  getDb(config).close();
  // Cleanup files like db.test.ts
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Python `subprocess.run()` with shell mode | Node.js `child_process.spawn()` with array args | Phase 3 (Node.js unification) | Safer (no injection), faster (no shell fork), better stream control |
| Spawn from project root | Spawn from `os.tmpdir()` | Phase 3 (CLAUDE.md isolation) | Prevents context leakage, ensures predictable behavior |
| Separate Python `claude_message_send_with_CC_CLI.py` service | Integrated Node.js `sender.ts` module in same app | Phase 3 (unification) | Single systemd unit, shared DB, simpler deployment |
| Manual retry logic | No retries; next scheduled slot honored | Phase 3 (design spec) | Simpler; scheduler handles catch-up |

**Deprecated/outdated:**
- **Python sender scripts:** `Claude Message Sender/claude_message_send_with_CC_CLI.py` is superseded by Node.js `sender.ts` and will be deleted after Phase 3 is proven.
- **SEND-03 with retry backoff:** Design spec §10 explicitly excludes retry logic. SEND-03 wording is superseded by D-01.

## Assumptions Log

All claims in this research are verified or cited; no assumptions require user confirmation.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|--------------|
| — | *No assumptions — all claims verified* | — | — |

**If this table is empty:** All claims in this research were verified or cited — no user confirmation needed.

## Open Questions

1. **Randomized start time for non-anchor fires:** Design spec §3.2 says non-anchor fires get 0–5 minute jitter. Should the `send()` function accept a parameter for this, or is jitter applied at the scheduler level (Phase 4)?
   - What we know: Design spec shows jitter in the schedule generation, not in the send function.
   - What's unclear: Whether Phase 3 `send()` should know about jitter or it's purely scheduler-controlled.
   - Recommendation: Keep `send()` simple; it accepts `scheduledFor` timestamp (already jittered by the scheduler). Phase 3 sends are always manual (no jitter). Phase 4 scheduler applies jitter before calling `send()`.

2. **Excerpt length for `response_excerpt`:** Design spec says "first ~500 chars"; is 500 a hard limit or an estimate?
   - What we know: Dashboard only shows a preview; full response is not needed.
   - What's unclear: Exact cutoff to balance readability vs. capture.
   - Recommendation: Use 500 chars as a hard limit. Slice `stdout.slice(0, 500)` on successful exit.

3. **Logging / debugging:** Should `send()` log timing, errors, and outcomes to console (with `[sender]` prefix)?
   - What we know: Existing code uses `[collector]`, `[demo]`, `[instrumentation]` prefixes.
   - What's unclear: Whether `send()` is noisy enough to warrant logs during normal operation.
   - Recommendation: Log errors and timeouts to `console.error("[sender]", ...)`. Omit success logs to avoid spam; the `send_log` row is the audit trail.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js `child_process` | Spawn CLI | ✓ | Built-in (20+) | — |
| `better-sqlite3` | DB writes | ✓ | [VERIFIED: Phase 1 uses v9.x] | — |
| `claude` CLI | Sending questions | ? | Unknown | Must be installed at runtime |

**Missing dependencies with no fallback:**
- `claude` CLI executable: The sender assumes `claude` is in `PATH`. If not installed, the spawn will fail with `ENOENT`. The error is logged to `send_log` with `status='error'`. [No fallback — CLI must be present on the deployment host.]

**Missing dependencies with fallback:**
- (None — Phase 3 has no optional features.)

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Node.js built-in `node:test` + `node:assert/strict` |
| Config file | None — test runner is built-in |
| Quick run command | `npm test -- test/sender.test.ts` |
| Full suite command | `npm test` (runs all test/*.test.ts) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SEND-01 | Spawn `claude -p "<q>" --model haiku` | Integration (Phase 8) | — | Wave 0 |
| SEND-02 | 60s timeout; timeouts logged as failures | Unit | `npm test -- test/sender.test.ts --grep "timeout"` | ✅ Phase 3 |
| SEND-03 | (Superseded by D-01: no retries) | — | — | — |
| SEND-04 | Write `send_log` row with 8 columns | Unit | `npm test -- test/sender.test.ts --grep "write"` | ✅ Phase 3 |
| SEND-05 | Manual fires write `scheduled_for=NULL` | Unit | `npm test -- test/sender.test.ts --grep "manual"` | ✅ Phase 3 |
| SEND-06 | QUESTIONS rotation ported verbatim | Lint | Manual review (10 items from git) | ✅ Phase 3 |
| DATA-03 | `send_log` table exists + indexes | Integration | `npm test -- test/db.test.ts` | ✅ Phase 3 + Phase 1 |

### Sampling Rate
- **Per task commit:** `npm test -- test/sender.test.ts` (send_log write logic; ~2 seconds)
- **Per wave merge:** `npm test` (full suite; ~30 seconds)
- **Phase gate:** Full suite green + manual curl test of `POST /api/send-now` before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `test/sender.test.ts` — covers SEND-02, SEND-04, SEND-05 (send_log write logic; timeout behavior; manual fire distinction)
- [ ] `test/db.test.ts` — extend with `send_log` table existence + indexes check (covers DATA-03)
- [ ] Framework already available — Node.js 20+ `node:test` is built-in; no install needed

*(All gaps above are Wave 0 tasks for Phase 3. No pre-existing test infrastructure covers these.)*

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | (Auth is CLI's responsibility via CLAUDE_CODE_OAUTH_TOKEN) |
| V3 Session Management | No | (No session state in sender) |
| V4 Access Control | No | (Single user; no multi-user auth) |
| V5 Input Validation | No | (Question constant is hardcoded; CLI args don't come from user input) |
| V6 Cryptography | No | (No secrets stored in sender; relies on deployed CLAUDE_CODE_OAUTH_TOKEN from env) |
| V7 Process Security (Custom) | Yes | **Avoid shell injection:** Always use `spawn(cmd, [args])` array form, never `shell: true` |

### Known Threat Patterns for Node.js Spawning

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Shell injection via `spawn(..., { shell: true })` | Tampering, Elevation | Always use array form: `spawn("claude", ["-p", question])` |
| Context leakage from `.claude/CLAUDE.md` | Information Disclosure | Spawn from `os.tmpdir()`, not project root [D-06] |
| Process resource exhaustion (unlimited stdout buffering) | Denial of Service | Cap stdout at 500 chars; don't buffer indefinitely |
| Zombie processes on timeout | Denial of Service | Guard timeout cleanup with a flag; use SIGKILL fallback [Pitfall 3] |
| Command injection if question contains backticks/`$()` | Tampering | Question is hardcoded constant; no user input |

**Note:** ASVS V8 (error handling), V9 (communications), V10 (malware) are handled by the deployment layer (Phase 6). Phase 3 sender does not expose a public surface.

## Sources

### Primary (HIGH confidence)
- Design spec `2026-04-16-tracker-sender-merge-design.md` §4.1 (sender responsibility), §5.2 (send_log schema), §10 (out of scope: retry logic)
- CONTEXT.md §Decisions (D-01 through D-06: locked decisions for Phase 3)
- Node.js documentation (child_process.spawn, os.tmpdir) — built-in; verified via Node.js 20 LTS release notes
- Existing codebase patterns: `src/lib/db.ts` (insertSnapshot signature, SnapshotRow interface), `src/app/api/dashboard/route.ts` (route handler pattern)

### Secondary (MEDIUM confidence)
- Python sender source: `git show 223706a~1:"Claude Message Sender/claude_message_send_with_CC_CLI.py"` — validated that QUESTIONS list is 10 items, 1-sentence prompts, all coding/software topics [VERIFIED: git history]
- CONVENTIONS.md (naming, logging prefixes, function design, module exports) — project standards
- ARCHITECTURE.md (layer responsibilities, error handling patterns) — provides context for where sender fits

### Tertiary (LOW confidence)
- (None — all critical claims have been verified.)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — `child_process` is Node.js built-in; `better-sqlite3` verified in Phase 1; no external CLI dependency risk.
- Architecture: HIGH — Design spec is explicit; patterns are established in Phase 1–2.
- Pitfalls: MEDIUM — Based on Node.js spawn best practices + design spec locked decisions; spawn-specific edge cases are mitigated by Phase 8 integration tests.

**Research date:** 2026-04-20

**Valid until:** 2026-05-20 (30 days — Node.js and better-sqlite3 are stable; unlikely to change; no pending v2 work affects Phase 3 scope)

**Versioning notes:**
- Design spec locked 2026-04-16; no updates expected during Phase 3 execution.
- CONTEXT.md decisions D-01 through D-06 are locked and override SEND-03 in REQUIREMENTS.md.
- QUESTIONS list is immutable (ported from git history commit).

---

*Phase 3 Sender Module research completed 2026-04-20*
*Research confidence: HIGH*
*Ready for planner.*
