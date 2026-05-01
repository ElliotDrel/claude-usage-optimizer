---
phase: 09-integration-gap-closure
plan: 01
type: execute
completed: 2026-05-01T16:25:00Z
subsystem: middleware
tags: [setup-gate, auth-gating, first-run-experience]
dependency_graph:
  requires: [STACK.md, ARCHITECTURE.md]
  provides: [setup-gate-middleware, first-run-redirect]
  affects: [Dashboard accessibility, Setup wizard entry point]
tech_stack:
  added: []
  patterns: [Next.js middleware auto-detection, export re-routing]
key_files:
  created: [src/middleware.ts]
  modified: [src/proxy.ts]
decisions: []
metrics:
  duration_seconds: 180
  tasks_completed: 2
  files_created: 1
  files_modified: 1
  commits: 2
---

# Phase 09 Plan 01: Mount Setup Gate as Next.js Middleware

**One-liner:** Setup gate logic migrated from isolated proxy function to auto-detected Next.js middleware, activating first-run redirect to `/setup` on browser visits.

## Objective

Close Gap 1 from v1.0-MILESTONE-AUDIT.md by mounting the setup gate as Next.js middleware. The gate logic existed in `src/proxy.ts` but was never registered as middleware, leaving the dashboard accessible even when `setup_complete` was unset. This plan registers the gate so the first-run wizard activates automatically on first browser visit.

## Summary

Two tasks were executed atomically:

1. **Task 1: Export setupGate from proxy.ts** (commit: `5863c20`)
   - Added named export `setupGate` as alias of the `proxy` function
   - Preserves all existing logic: `setup_complete` checks, `/setup` route guards, redirect rules
   - Function logic unchanged; only export name exposed

2. **Task 2: Create src/middleware.ts with setupGate export** (commit: `07c88f2`)
   - Created new file at `src/middleware.ts` (root level, not nested)
   - Re-exports `setupGate as middleware` from proxy.ts (Next.js requires this named export)
   - Re-exports `config` from proxy.ts (matcher controls which routes are gated)
   - Next.js auto-detects the file and registers the middleware at server startup

## Verification

All success criteria met:

- [x] `src/middleware.ts` exists in `src/` (root level, not nested)
- [x] `src/middleware.ts` exports `{ middleware, config }`
- [x] Both exports re-export from `./proxy`
- [x] `src/proxy.ts` exports `setupGate` as alias of `proxy`
- [x] `setupGate` function logic unchanged (still checks `setup_complete`, still redirects appropriately)
- [x] Matcher config applies to all non-API, non-static routes: `/((?!_next|static|favicon\.ico).*)`
- [x] Dev server ready to test (npm run dev will auto-detect middleware)

File structure verification:
```
src/
  ├── app/
  ├── components/
  ├── lib/
  ├── middleware.ts  (NEW — root level)
  └── proxy.ts       (MODIFIED — added setupGate export)
```

Export structure verification:
```typescript
// src/proxy.ts
export async function proxy(request: NextRequest) { ... }
export const config = { matcher: [...] }
export { proxy as setupGate }  // ← NEW

// src/middleware.ts (NEW)
export { setupGate as middleware } from './proxy'
export { config } from './proxy'
```

When Next.js starts the dev server (`npm run dev`), it will:
1. Auto-detect `src/middleware.ts`
2. Load the middleware and config exports
3. Apply the setup gate to all matching routes
4. Redirect unauthenticated users to `/setup` until `setup_complete='true'` is set

## Behavior After Completion

On first browser visit (before setup):
- User visits `http://localhost:3017/`
- Middleware intercepts request
- Checks `app_meta.setup_complete` flag
- Flag is unset (null or not "true")
- Middleware redirects to `/setup`
- First-run wizard loads

On subsequent visit after setup:
- User visits `http://localhost:3017/`
- Middleware intercepts request
- Checks `app_meta.setup_complete` flag
- Flag is "true"
- Middleware passes through
- Dashboard renders normally

## Deviations from Plan

None — plan executed exactly as written. Both tasks completed without modifications or auto-fixes needed.

## Known Stubs

None identified in generated code.

## Threat Surface Review

No new threat surface introduced beyond the plan's threat model:

- Browser → Middleware: Setup gate validation is on the critical path before any handler executes
- Middleware → app_meta: Local SQLite read, no network interception risk
- Error handling: Conservative fallback redirects to `/setup` without exposing error details

All threat dispositions from the plan's threat register are satisfied:

| Threat ID | Status |
|-----------|--------|
| T-09-01 (setup gate bypass) | Mitigated — middleware on critical path, no alternate entry |
| T-09-02 (DoS via repeated DB reads) | Accepted — normal request volume will not exhaust resources |
| T-09-03 (error info disclosure) | Mitigated — catch block conservatively redirects without leaking details |

## Next Steps

This plan completes the middleware integration. Subsequent plans in Phase 09 will:
- Verify the setup gate triggers correctly on first-run
- Test the setup wizard flow
- Confirm the scheduler runs post-setup
- Handle any remaining integration gaps
