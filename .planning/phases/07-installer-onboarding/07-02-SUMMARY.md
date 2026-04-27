---
phase: 07-installer-onboarding
plan: "02"
subsystem: onboarding
tags: [setup, wizard, proxy, middleware, sqlite, sudo, security]
dependency_graph:
  requires: [07-01]
  provides: [setup-wizard-ui, setup-api, proxy-gate]
  affects: [all-routes, dashboard-access]
tech_stack:
  added: []
  patterns: [next-proxy, execFileNoThrow, app-meta-kv, staging-file-pattern]
key_files:
  created:
    - src/utils/execFileNoThrow.ts
    - src/proxy.ts
    - src/app/setup/page.tsx
    - src/app/api/setup/route.ts
  modified: []
decisions:
  - "Use proxy.ts (Next.js 16 convention) instead of middleware.ts — middleware runs in Edge Runtime which cannot access Node.js APIs"
  - "Export 'proxy' function from proxy.ts per Next.js 16 naming requirement"
  - "D-09 enforced in proxy: /setup redirects to / when setup_complete='true' (missing from plan example code — added as Rule 2 security mitigation)"
  - "Staging file created with mode 0o640 (not world-readable), deleted on any failure path"
  - "execFileNoThrow uses array args for sudo invocation — no shell injection risk (T-07-01)"
metrics:
  duration: "~15 min"
  completed: "2026-04-27"
  tasks_completed: 4
  files_created: 4
---

# Phase 7 Plan 02: Onboarding Wizard Summary

**One-liner:** Browser-based first-run setup wizard with proxy gate, form UI, and safe sudo invocation to write credentials to /etc/.

## What Was Built

Four files implement end-to-end first-run onboarding for non-technical users:

1. **`src/utils/execFileNoThrow.ts`** — Safe subprocess utility using `execFile` (promisified) with array args. Never throws; returns `{ status, stdout, stderr }`. 30s default timeout. Used exclusively for sudo helper invocation.

2. **`src/proxy.ts`** — Next.js 16 proxy that runs before every route render. Checks `app_meta.setup_complete` from SQLite. If not `'true'`, redirects to `/setup`. If already set up and user visits `/setup`, redirects to `/`. Falls back to `/setup` redirect if DB is unavailable on first boot.

3. **`src/app/setup/page.tsx`** — Client-side React wizard (single-page scrollable, not multi-step). Collects OAuth token, usage auth mode (cookie/bearer toggle with dynamic placeholder), usage auth value, timezone (IANA, defaults to America/Los_Angeles), and optional GCS bucket. Disables submit while loading. Displays errors in red banner. Redirects to `/` after 1s delay on success.

4. **`src/app/api/setup/route.ts`** — POST endpoint. Validates OAuth token and usage auth presence. Builds env file content from form data (secrets never passed as CLI args). Writes `.env-staging` with mode `0o640`. Invokes `sudo /opt/claude-usage-optimizer/scripts/write-env.sh` via `execFileNoThrow` (array args, 10s timeout, neutral `/tmp` cwd). Cleans up staging file on any failure. Marks `setup_complete='true'` in app_meta on success.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Renamed middleware.ts to proxy.ts and export to `proxy`**
- **Found during:** Task 1 verification (`npm run build`)
- **Issue:** Next.js 16 deprecated the `middleware.ts` filename. That file runs in Edge Runtime which cannot use Node.js APIs (fs, path, process.cwd, better-sqlite3). Build failed with a Node.js API in Edge Runtime error. The plan's `<action>` used `proxy` function name but specified `src/middleware.ts` — inconsistent. The RESEARCH.md correctly documented `proxy.ts`.
- **Fix:** Removed `src/middleware.ts`, created `src/proxy.ts` with `export async function proxy(...)`. Next.js 16 picks this up automatically. Build now succeeds cleanly.
- **Files modified:** Removed `src/middleware.ts`, created `src/proxy.ts`
- **Commits:** af66af6 (initial middleware.ts), 2be8a92 (rename to proxy.ts)

**2. [Rule 2 - Missing Security] Added D-09 redirect for /setup when setup is complete**
- **Found during:** Plan review (advisor) and threat register
- **Issue:** Plan's example proxy code skipped all `/setup` paths unconditionally — meaning `/setup` would remain accessible after setup completion, violating D-09 and threat T-07-06 (`mitigate` disposition).
- **Fix:** Implemented branched logic: if pathname is `/setup` AND `setup_complete === 'true'`, redirect to `/`. If pathname is `/setup` AND not complete, allow through. This enforces D-09 correctly.
- **Files modified:** `src/proxy.ts`
- **Commit:** 2be8a92

### Pre-existing Lint Warnings (out of scope)

The following lint errors existed before this plan and were not introduced here:
- `src/app/page.tsx`: react-hooks/set-state-in-effect
- `src/components/ScheduleOverridesPanel.tsx`: react-hooks/rules-of-hooks
- `src/components/TimezoneWarningBanner.tsx`: react-hooks/set-state-in-effect
- `src/lib/notifier.ts`: no-explicit-any
- Various unused variable warnings

These are out of scope per deviation rule scope boundary.

## Known Stubs

None. All fields wire to the POST body and are stored to disk. No hardcoded empty values reach the UI.

## Threat Surface Scan

All threats addressed per the plan's threat register:

| Threat ID | Status |
|-----------|--------|
| T-07-01 Shell injection | Mitigated — execFileNoThrow with array args, no shell interpolation |
| T-07-02 Staging file disclosure | Mitigated — mode 0o640, deleted on failure |
| T-07-03 Privilege escalation scope | Mitigated — no args to helper, fixed path only |
| T-07-04 Staging file left on failure | Mitigated — try/catch cleanup in both error paths |
| T-07-05 Secrets in logs/responses | Mitigated — generic error messages, no token values logged |
| T-07-06 /setup accessible post-setup | Mitigated — proxy redirects /setup to / when setup_complete='true' |

No new threat surfaces introduced beyond what was planned.

## Self-Check: PASSED

Files exist:
- src/utils/execFileNoThrow.ts: FOUND
- src/proxy.ts: FOUND
- src/app/setup/page.tsx: FOUND
- src/app/api/setup/route.ts: FOUND

Commits exist:
- 16385f0 (execFileNoThrow): FOUND
- af66af6 (middleware initial): FOUND
- d7a08bc (setup page): FOUND
- beb4447 (setup API): FOUND
- 2be8a92 (proxy rename fix): FOUND

Build: PASSED (npm run build — 0 errors, 2 pre-existing NFT warnings)
Lint on new files: 0 errors (pre-existing errors in other files, out of scope)
