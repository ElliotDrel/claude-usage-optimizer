# Phase 3: Sender Module - Context

**Gathered:** 2026-04-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Ship `sender.ts` (spawn `claude -p`, 60s timeout, `send_log` writes) and `POST /api/send-now` for manual-fire testing. No scheduler wiring — that is Phase 4. The deliverable is a sender that is manually invokable from the dashboard's "Send now" button or via curl.

</domain>

<decisions>
## Implementation Decisions

### Retry policy
- **D-01:** No retries. Design spec §10 explicitly lists "retry logic on failed sends" as out of scope and overrides the REQUIREMENTS.md SEND-03 wording. A failed send is logged with `status='error'` and the next scheduled slot is honored. No exponential backoff, no re-fire.

### QUESTIONS constant
- **D-02:** Port the 10-item list verbatim from git history (commit `223706a~1`). All questions are 1-sentence-answer prompts on software/coding topics. Store as a module-level `UPPER_SNAKE_CASE` constant in `sender.ts`.

### Test strategy for spawn
- **D-03:** No unit tests for `child_process.spawn` mechanics in Phase 3. `sender.test.ts` tests only the `send_log` write logic (correct columns, correct status, correct duration shape). Spawn behavior is accepted as integration-tested in Phase 8.

### Timeout configurability
- **D-04:** `sender.ts` accepts a `timeoutMs` option (default `60_000`). Tests pass a short value (e.g. `200`) to trigger timeout behavior without waiting 60 seconds. Aligns with the options-bag parameter pattern established in `db.ts` (`opts?: { ... }`).

### Manual-fire distinction
- **D-05:** Manual-fire invocations via `POST /api/send-now` write `scheduled_for=NULL` to `send_log` so they are distinguishable from scheduler-driven fires (per SEND-05). The `is_anchor` column is `0` for manual fires.

### spawn isolation
- **D-06:** `child_process.spawn` runs from an isolated temp directory (per the Python sender pattern) so the claude CLI does not load the project's CLAUDE.md context. Use `os.tmpdir()`.

### Claude's Discretion
- Exact TypeScript interface for the `send_log` row insert helper
- Whether `sender.ts` exports a single `send()` function or also exports the `QUESTIONS` constant separately
- Internal stdout capture approach (stream accumulation vs. buffered)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design spec (primary source of truth)
- `2026-04-16-tracker-sender-merge-design.md` §4.1 — `sender.ts` responsibility description
- `2026-04-16-tracker-sender-merge-design.md` §5.2 — `send_log` table schema (columns, types, index)
- `2026-04-16-tracker-sender-merge-design.md` §7.1 — `test/sender.test.ts` coverage requirements
- `2026-04-16-tracker-sender-merge-design.md` §10 — Out of scope: retry logic explicitly excluded

### Requirements
- `.planning/REQUIREMENTS.md` — SEND-01, SEND-02, SEND-04, SEND-05, SEND-06, DATA-03 (the requirements this phase covers; SEND-03 superseded by design spec §10)

### Existing code to understand before implementing
- `src/lib/db.ts` — `getDb`, `app_meta` table already exists; `send_log` table must be added here
- `src/lib/config.ts` — `getConfig()` shape; sender receives `Config` to reach the DB
- `src/lib/collector.ts` — `ERROR_BACKOFF` pattern and `computeNextDelay` — reference for how the codebase structures backoff (not needed for this phase but useful for understanding conventions)

### QUESTIONS source
- Recovered from git: `git show 223706a~1:"Claude Message Sender/claude_message_send_with_CC_CLI.py"` — 10 items, port verbatim

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/db.ts` (`getDb`, `app_meta` table): `send_log` DDL lands here alongside the existing schema. Follow the `migrateToSimplifiedSchema` idempotent pattern for adding the new table.
- `src/lib/config.ts` (`getConfig`, `Config`): sender receives a `Config` to reach the DB path — same pattern as `insertSnapshot`.
- `src/app/api/dashboard/route.ts`: reference for how to wire a new `POST` route (`src/app/api/send-now/route.ts` follows the same structure).

### Established Patterns
- Named exports only; no default exports in lib files.
- `function` keyword for top-level named functions; `camelCase` verb-first.
- Module-level constants: `UPPER_SNAKE_CASE`.
- Tests in `test/` directory, `node:test` + `node:assert/strict`, relative imports (`../src/lib/sender`).
- Options bag for 4+ params: `opts?: { timeoutMs?: number }` pattern (see `db.ts:querySnapshots`).
- Bracketed log prefix: `[sender]` for `console.log` / `console.error` lines.

### Integration Points
- `src/lib/db.ts`: add `send_log` table DDL + `insertSendLog()` helper here, or in `sender.ts` directly — planner decides.
- `src/app/api/send-now/route.ts` (new): `POST` handler that calls `send()` and returns the resulting `send_log` row as JSON.
- Phase 4 (`scheduler.ts`) will import `send()` and call it with a `scheduledFor` timestamp and `isAnchor` flag.
- Phase 5 (dashboard) will read `send_log` rows for the Send History panel — column names and types become the data contract.

</code_context>

<specifics>
## Specific Ideas

- The 10 QUESTIONS from the Python sender are all 1-sentence-answer coding/software prompts. Port them as-is — no editing.
- Spawn must run from an isolated temp dir (`os.tmpdir()`) so the claude CLI doesn't pick up this repo's CLAUDE.md. This was already done in the Python sender and is intentional.
- Timeout is configurable via `timeoutMs` option specifically to enable fast test coverage without a 60-second wait.

</specifics>

<deferred>
## Deferred Ideas

- Retry logic (SEND-03) — explicitly out of scope per design spec §10; revisit only if failure rate in production warrants it.
- Spawn unit tests (mock child_process) — deferred to Phase 8 integration test suite.

</deferred>

---

*Phase: 03-sender-module*
*Context gathered: 2026-04-20*
