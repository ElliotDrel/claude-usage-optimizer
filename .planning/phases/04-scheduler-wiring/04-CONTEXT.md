# Phase 4: Scheduler Wiring - Context

**Gathered:** 2026-04-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Land `scheduler.ts` and register it in `instrumentation.ts` — a 60-second tick loop that fires the sender for matching scheduled slots, recomputes the schedule nightly at 03:00 UTC, catches up on recent missed fires after restart, and honors a global pause toggle. All required `app_meta` keys are written and maintained. No dashboard wiring yet — that is Phase 5.

</domain>

<decisions>
## Implementation Decisions

### Dev-mode gating
- **D-01:** Scheduler auto-starts in production (`NODE_ENV=production`). In development, it requires `ENABLE_SCHEDULER=true` to opt in. Demo mode (`config.demoMode === true`) also suppresses the scheduler regardless of `NODE_ENV`. Logic in `instrumentation.ts`: start scheduler only when `(NODE_ENV=production || ENABLE_SCHEDULER=true) && !config.demoMode`.

### Clock injection for testability
- **D-02:** `scheduler.ts` accepts an optional `nowFn?: () => Date` in its options bag (consistent with the `opts?: { ... }` pattern from `db.ts`). All time comparisons inside the scheduler (catch-up detection, 03:00 recompute check, fire-due detection) use `nowFn()` instead of `new Date()`. Tests freeze time by passing a fixed `() => new Date(...)`. Default is `() => new Date()`.

### Tick error isolation
- **D-03:** Each fire attempt inside the 60s tick is wrapped in its own try/catch. Errors are logged as `[scheduler] send failed for fire at {time}: {error}` and the tick continues to process remaining fires. The interval itself is never cleared by a per-fire error. This matches Phase 3 D-01 (no retry) — the next scheduled slot is the natural "retry". Persistent failure is caught by Phase 6 stall notifications.

### app_meta initialization
- **D-04:** On scheduler startup, a single `initializeAppMeta(db)` call writes all DATA-04 keys with their defaults if not already present (`INSERT OR IGNORE`). This runs before the first tick. Ensures the Phase 5 dashboard can safely read all scheduler keys immediately without blank-value handling.

  Default values for keys not yet set by a recompute:
  - `schedule_fires` → `'[]'`
  - `schedule_fires_done` → `'[]'`
  - `schedule_generated_at` → `''` (empty = never computed)
  - `peak_block` → `''`
  - `schedule_override_start_time` → `''`
  - `peak_window_hours` → `'4'`
  - `anchor_offset_minutes` → `'5'`
  - `default_seed_time` → `'05:05'`
  - `user_timezone` → `'America/Los_Angeles'`
  - `paused` → `'false'`

### Claude's Discretion
- Exact module structure of `scheduler.ts` (one exported `startScheduler(db, opts?)` function, or a class with start/stop)
- Whether `initializeAppMeta` lives in `scheduler.ts` or is extracted to `db.ts`
- Exact catch-up logic: compare the most recent missed fire (from `schedule_fires` not in `schedule_fires_done`) against `nowFn()` — Claude picks the cleanest implementation
- How the 03:00 UTC recompute is detected on each tick (compare `schedule_generated_at` date to today UTC — if it's yesterday or missing, and current UTC hour ≥ 3, recompute)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design spec (primary source of truth)
- `2026-04-16-tracker-sender-merge-design.md` §4 — Scheduler responsibilities: tick loop, nightly recompute, catch-up-on-restart, pause toggle
- `2026-04-16-tracker-sender-merge-design.md` §5.3 — `app_meta` key list with types and default values (DATA-04)
- `2026-04-16-tracker-sender-merge-design.md` §7.2 — `test/scheduler.test.ts` coverage requirements

### Requirements
- `.planning/REQUIREMENTS.md` — SCHED-01, SCHED-10, SCHED-11, SCHED-12, DATA-04 (the 5 requirements this phase covers)

### Prior phase context (integration contracts)
- `.planning/phases/02-algorithm-core-pure-modules/02-CONTEXT.md` — `peakDetector` and `generateSchedule` signatures, `ParsedSnapshot` input type, `defaultSeedTime` fallback ownership
- `.planning/phases/03-sender-module/03-CONTEXT.md` — `send()` function signature, `send_log` schema, `timeoutMs` option pattern

### Existing code to read before implementing
- `claude-usage-tracker/src/instrumentation.ts` — where scheduler registration goes; existing collector start pattern to follow
- `claude-usage-tracker/src/lib/db.ts` — `app_meta` table DDL, idempotent migration pattern (`INSERT OR IGNORE` / `ON CONFLICT DO UPDATE`), `getDb` singleton
- `claude-usage-tracker/src/lib/config.ts` — `getConfig()`, `Config` interface, `demoMode` flag, `NODE_ENV` handling pattern

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/instrumentation.ts` (`register()`): Scheduler registration mirrors the collector start — dynamic import inside `if (process.env.NEXT_RUNTIME === "nodejs")`, same SIGTERM/SIGINT shutdown wiring pattern.
- `src/lib/db.ts` (`getDb`, `app_meta` table): `initializeAppMeta` reads and writes this table. Follow the `db.prepare(...).run()` pattern with `INSERT OR IGNORE` for idempotent default writes.
- `src/lib/config.ts` (`getConfig`, `Config.demoMode`): Gate condition uses `config.demoMode` directly — no new env var needed for demo suppression.
- `src/lib/queries.ts` (`parseSnapshots`): Phase 4 scheduler reads historical `status='ok'` snapshots and calls `parseSnapshots()` before passing to `peakDetector`.
- `src/lib/peak-detector.ts` + `src/lib/schedule.ts`: Pure functions from Phase 2. Scheduler calls them with parsed snapshots + `app_meta` config values.
- `src/lib/sender.ts` (Phase 3): `send(db, opts?)` — scheduler calls this with `scheduledFor` and `isAnchor` for each due fire.

### Established Patterns
- Named exports only; no default exports in lib files.
- `function` keyword for top-level named functions; `camelCase` verb-first naming.
- Options bag for configurable behavior: `opts?: { nowFn?: () => Date }`.
- Bracketed log prefix: `[scheduler]` for all `console.log` / `console.error` lines.
- Tests in `test/` directory, `node:test` + `node:assert/strict`, relative imports.

### Integration Points
- `src/instrumentation.ts`: add `startScheduler(db, opts?)` call after collector start, gated on `(NODE_ENV=production || ENABLE_SCHEDULER=true) && !config.demoMode`.
- Phase 5 (dashboard) reads `app_meta` keys for the Optimal Schedule card, Overrides section, Pause toggle — column names and default values from D-04 are the data contract.
- Shutdown handler: `scheduler.stop()` (or equivalent) must be called alongside `collector.stop()` on SIGTERM/SIGINT.

</code_context>

<specifics>
## Specific Ideas

- User confirmed "auto-on in prod, opt-in in dev" matches their mental model — no surprises when deploying to the VM.
- The injectable `nowFn` is the key testability mechanism — tests freeze time and drive catch-up / recompute logic without wall-clock waits.
- "Write defaults immediately" preference ensures the Phase 5 dashboard never shows blank scheduler state, even before the first 03:00 UTC recompute.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 04-scheduler-wiring*
*Context gathered: 2026-04-20*
