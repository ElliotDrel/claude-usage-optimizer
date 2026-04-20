---
phase: 3
slug: sender-module
status: ready
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-20
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js built-in `node:test` + `node:assert/strict` |
| **Config file** | None — test runner is built-in |
| **Quick run command** | `npm test -- test/sender.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~2 seconds (quick), ~30 seconds (full suite) |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- test/sender.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green + manual curl test of `POST /api/send-now`
- **Max feedback latency:** 2 seconds (quick), 30 seconds (full)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 3-01-01 | 01 | 1 | DATA-03 | — | N/A | Unit | `npm test -- test/db.test.ts` | ✅ extend Phase 1 | ⬜ pending |
| 3-01-02 | 01 | 1 | SEND-04 | — | No shell injection (array args) | Unit | `npm test -- test/sender.test.ts --grep "write"` | ❌ W0 | ⬜ pending |
| 3-01-03 | 01 | 1 | SEND-02 | — | Timeout kill + logged | Unit | `npm test -- test/sender.test.ts --grep "timeout"` | ❌ W0 | ⬜ pending |
| 3-01-04 | 01 | 1 | SEND-05 | — | Manual fires: scheduled_for=NULL | Unit | `npm test -- test/sender.test.ts --grep "manual"` | ❌ W0 | ⬜ pending |
| 3-01-05 | 01 | 1 | SEND-06 | — | N/A | Manual | Manual review (10 items from git) | ✅ Phase 3 | ⬜ pending |
| 3-02-01 | 02 | 2 | SEND-01 | T-spawn | spawn uses array args, not shell:true | Integration (Phase 8) | — | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/sender.test.ts` — stubs covering SEND-02 (timeout), SEND-04 (send_log write), SEND-05 (manual fire distinction)
- [ ] `test/db.test.ts` — extend with `send_log` table existence + column + index checks (DATA-03)
- [ ] Framework already available — Node.js 20+ `node:test` is built-in; no install needed

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `POST /api/send-now` returns send_log row | SEND-01, SEND-05 | Requires live `claude` CLI in PATH | `curl -X POST http://localhost:3017/api/send-now` and verify JSON response + DB row |
| QUESTIONS list matches 10 items from git verbatim | SEND-06 | Source comparison | Run `git show 223706a~1:"Claude Message Sender/claude_message_send_with_CC_CLI.py"` and compare to `QUESTIONS` constant in sender.ts |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
