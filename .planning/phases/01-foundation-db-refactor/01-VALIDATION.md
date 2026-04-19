---
phase: 1
slug: foundation-db-refactor
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-19
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js built-in `node:test` + `tsx` |
| **Config file** | none — driven by `package.json` test script |
| **Quick run command** | `cd claude-usage-tracker && npx tsx --test test/db.test.ts test/analysis.test.ts` |
| **Full suite command** | `cd claude-usage-tracker && npm test` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd claude-usage-tracker && npx tsx --test test/db.test.ts test/analysis.test.ts`
- **After every plan wave:** Run `cd claude-usage-tracker && npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 1-del-01 | deletion | 1 | DEPLOY-06 | — | N/A | manual | `ls "Claude Message Sender/" \|\| echo "deleted"` | N/A | ⬜ pending |
| 1-db-01 | db-schema | 1 | DATA-02 | — | N/A | unit | `cd claude-usage-tracker && npx tsx --test test/db.test.ts` | ✅ (update needed) | ⬜ pending |
| 1-db-02 | db-schema | 1 | DATA-05 | — | N/A | unit | `cd claude-usage-tracker && npx tsx --test test/db.test.ts` | ❌ W0 | ⬜ pending |
| 1-db-03 | db-schema | 1 | DATA-01 | — | N/A | unit | `cd claude-usage-tracker && npx tsx --test test/db.test.ts` | ✅ (update needed) | ⬜ pending |
| 1-qry-01 | queries | 2 | DATA-06 | — | N/A | unit | `cd claude-usage-tracker && npx tsx --test test/queries.test.ts` | ❌ W0 | ⬜ pending |
| 1-col-01 | collector | 2 | DATA-01 | — | N/A | unit | `cd claude-usage-tracker && npm test` | ✅ (update needed) | ⬜ pending |
| 1-ana-01 | analysis | 3 | UI-08 | — | N/A | unit | `cd claude-usage-tracker && npx tsx --test test/analysis.test.ts` | ✅ (update needed) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `claude-usage-tracker/test/queries.test.ts` — covers DATA-06: `parseSnapshot` with cookie payload, bearer payload, null raw_json, demo raw_json, extra_usage cents-to-dollars conversion
- [ ] New test case in `claude-usage-tracker/test/db.test.ts` — covers DATA-05: idempotent migrator (call `getDb` twice on same path, verify `app_meta.schema_version = 'simplified-v1'` and schema has exactly 7 columns)
- [ ] New test case in `claude-usage-tracker/test/db.test.ts` — covers DATA-02: `PRAGMA table_info(usage_snapshots)` returns exactly 7 columns after `getDb`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `Claude Message Sender/` directory removed from repo | DEPLOY-06 | Filesystem deletion; not observable via unit test | `ls "Claude Message Sender/"` → "No such file or directory" |
| Dashboard panels render correctly against new read path | UI-08 | Requires running Next.js dev server + browser | `npm run dev` → open localhost:3017 → verify heatmap, hourly bars, usage timeline, extra-usage card all render without errors |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
