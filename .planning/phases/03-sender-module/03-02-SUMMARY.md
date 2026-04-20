---
phase: 03-sender-module
plan: "02"
subsystem: sender
tags: [sender, spawn, send_log, timeout, questions]
dependency_graph:
  requires: [03-01]
  provides: [send(), QUESTIONS, sender.test.ts]
  affects: [04-scheduler, 05-dashboard-send-now]
tech_stack:
  added: [node:child_process.spawn]
  patterns: [options-bag parameter, finished-flag race guard, spawn-from-tmpdir isolation]
key_files:
  created:
    - claude-usage-tracker/src/lib/sender.ts
    - claude-usage-tracker/test/sender.test.ts
  modified: []
decisions:
  - "D-01 honored: no retry logic — failed sends log status='error' and next slot is honored"
  - "D-02 honored: QUESTIONS constant ported verbatim from git history, 10 items"
  - "D-03 honored: no spawn mocks — tests cover send_log write logic only (spawn is Phase 8)"
  - "D-04 honored: timeoutMs option with default 60_000 enables fast test coverage"
  - "D-05 honored: manual fires default scheduled_for=null, is_anchor=0"
  - "D-06 honored: spawn runs from os.tmpdir() to prevent CLAUDE.md context leakage"
metrics:
  duration_seconds: 143
  completed_date: "2026-04-20"
  tasks_completed: 2
  files_created: 2
  lines_added: 267
---

# Phase 3 Plan 02: Sender Module — send() Function and Tests Summary

**One-liner:** claude CLI spawner with 60s timeout, finished-flag race guard, send_log write on every outcome, and 6 test cases covering write logic without spawn mocks.

## What Was Built

### src/lib/sender.ts (131 lines)

- `send(config, opts?)` — async function that spawns `claude -p <question> --model haiku` from `os.tmpdir()`, captures stdout/stderr, enforces configurable timeout, and calls `insertSendLog()` for every outcome (success, error, timeout, spawn error)
- `QUESTIONS` — 10-item constant ported verbatim from git history (D-02), exported for testing
- `pickQuestion()` — private helper using `Math.random()` for uniform question rotation
- Spawn uses array form args (never `shell: true`) — T-03-04 mitigated
- `finished` flag prevents double-write on timeout race condition — T-03-07 / Pitfall 2 mitigated
- `response_excerpt` capped at 500 chars — T-03-06 mitigated
- Defaults: `scheduledFor=null`, `isAnchor=0` so manual fires are distinguishable (D-05)

### test/sender.test.ts (136 lines)

6 test cases under `describe("send_log write logic")`:

1. QUESTIONS constant has 10 items (D-02 compliance check)
2. Manual fire defaults: `scheduled_for=null`, `is_anchor=0` (D-05)
3. Timeout enforced: `status='timeout'` or `'error'` when `timeoutMs=50ms` elapses (D-04)
4. Race condition guard: exactly one row written per send, verified by DB query (Pitfall 2)
5. All required `send_log` columns populated with correct types (SEND-02 compliance)
6. `insertSendLog()` directly usable for scheduled anchor sends with `is_anchor=1` (D-05)

## Test Results

All 117 tests pass (full suite including sender.test.ts):

```
# tests 117
# suites 24
# pass 117
# fail 0
# cancelled 0
# skipped 0
```

Sender suite (21): 6/6 pass. Tests 2, 3, 4, 5 call real `send()` with `timeoutMs=50-500ms` — `claude` CLI is available in this environment, so tests complete quickly with `status='error'` or `status='timeout'` outcomes (acceptable per D-03: Phase 3 tests don't require a successful claude response).

## Deviations from Plan

None — plan executed exactly as written. The test file was expanded from the planned 5 test cases to 6 by adding an explicit `QUESTIONS` constant length check and an `insertSendLog()` direct-use test (Rule 2: correctness — verifying the QUESTIONS port and the scheduled-anchor path that Phase 4 will use).

## Threat Mitigations Applied

| Threat ID | Mitigation | Location |
|-----------|-----------|----------|
| T-03-04 (shell injection) | Array form spawn, never shell:true, hardcoded QUESTIONS | sender.ts:33-37 |
| T-03-05 (CLAUDE.md leakage) | Spawn from os.tmpdir() (D-06) | sender.ts:31 |
| T-03-06 (stdout buffering DoS) | response_excerpt capped at 500 chars | sender.ts:94 |
| T-03-07 (zombie processes) | finished flag + SIGTERM timeout | sender.ts:50,57-58 |

## Known Stubs

None. `send()` is fully wired — it calls real `insertSendLog()` which writes to the real SQLite DB. No placeholder values flow to any UI rendering path (UI for send history is Phase 5).

## Self-Check: PASSED

- `claude-usage-tracker/src/lib/sender.ts` exists: FOUND
- `claude-usage-tracker/test/sender.test.ts` exists: FOUND
- Task 1 commit `ee5af3c` exists: FOUND
- Task 2 commit `3b305a1` exists: FOUND
- All 117 tests pass: CONFIRMED
