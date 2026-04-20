# Phase 3: Sender Module - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-20
**Phase:** 03-sender-module
**Areas discussed:** Retry policy, QUESTIONS content, Spawn test strategy, Timeout testing

---

## Retry: In or Out?

| Option | Description | Selected |
|--------|-------------|----------|
| Requirements win (SEND-03) | Implement exponential backoff bounded to the 5-hour window | |
| Design spec wins (§10) | No retries; log failure and honor next slot | ✓ |

**User's choice:** Design spec §10 wins — no retries.
**Notes:** REQUIREMENTS.md SEND-03 and design spec §10 are in direct conflict. User ruled that the design spec takes precedence. This also eliminates the need to decide how sender.ts knows the window boundary (a Phase 3 / Phase 4 sequencing problem that retries would have introduced).

---

## QUESTIONS Content

| Option | Description | Selected |
|--------|-------------|----------|
| User pastes them | User provides the list manually | |
| Recover from git history | Pull from deleted Python sender commit | ✓ |
| Placeholder questions | Claude's discretion, exact content doesn't matter | |

**User's choice:** Recover from git history.
**Notes:** Found in `git show 223706a~1:"Claude Message Sender/claude_message_send_with_CC_CLI.py"`. 10 items, all 1-sentence-answer coding/software prompts. Port verbatim.

---

## Spawn Test Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Dependency injection | Accept `spawnFn` param; tests pass a mock | |
| Module mock | Use `node:test` mock API to intercept `child_process` | |
| No spawn tests | Only test `send_log` write logic; spawn covered in Phase 8 | ✓ |

**User's choice:** No spawn unit tests in Phase 3.
**Notes:** Tests will cover that `send_log` rows are written correctly (columns, status values, duration shape). Spawn behavior deferred to Phase 8 integration testing.

---

## Timeout Testing

| Option | Description | Selected |
|--------|-------------|----------|
| Configurable timeoutMs | Accept `timeoutMs` option; tests pass short value | ✓ |
| Real slow process | Spawn a hanging script; set timeout to 500ms in tests | |
| Claude's discretion | Whichever approach makes tests cleanest | |

**User's choice:** Configurable `timeoutMs` option (default 60_000).
**Notes:** Aligns with the project's existing options-bag pattern (`db.ts:querySnapshots`). Tests pass e.g. `timeoutMs: 200` to trigger timeout behavior without waiting.

---

## Claude's Discretion

- Exact TypeScript interface for `send_log` row insert helper
- Whether `sender.ts` exports `QUESTIONS` separately or keeps it module-internal
- Internal stdout capture approach

## Deferred Ideas

- Retry logic (SEND-03) — design spec §10 out-of-scopes it
- Spawn unit tests — deferred to Phase 8
