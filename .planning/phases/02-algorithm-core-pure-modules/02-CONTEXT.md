# Phase 2: Algorithm Core (Pure Modules) - Context

**Gathered:** 2026-04-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Ship `peak-detector.ts` and `schedule.ts` as pure, fully-tested TypeScript functions that — given snapshots and options — return a deterministic peak block and a 5-fire daily chain. No runtime wiring, no DB reads, no scheduler integration. Phase 4 handles all of that.

</domain>

<decisions>
## Implementation Decisions

### Input type
- **D-01:** `peak-detector.ts` accepts `ParsedSnapshot[]` — the canonical read-side type landed in Phase 1 (`src/lib/queries.ts`). Callers parse raw rows via `parseSnapshots()` before handing off. `peak-detector.ts` never touches `SnapshotRow` or SQLite directly.

### Jitter testability
- **D-02:** Tests verify non-anchor jitter via range assertions only. Each non-anchor fire must fall within `[slot, slot + 5min]`; the anchor must be exact. No injectable randomizer or seeded RNG — `Math.random()` stays the implementation; tests assert the output range.

### Fallback ownership
- **D-03:** `peak-detector.ts` returns `null` when fewer than 3 days of `status='ok'` snapshots exist. `schedule.ts` accepts a `defaultSeedTime: string` option (e.g. `"05:05"`) and uses it as the anchor when `peakBlock` is null/not supplied. The Phase 4 scheduler passes the `app_meta.default_seed_time` value through — Phase 2 modules stay pure.

### Delta computation
- **D-04:** `peak-detector.ts` reimplements hourly delta bucketing independently from `buildActivity` in `analysis.ts`. No shared helper extracted. The two modules remain fully decoupled and independently testable. Duplication is intentional — the peak-detector's bucketing is purpose-built for the timezone-aware, 4-hour-window algorithm, not the dashboard's day/hour heatmap.

### Claude's Discretion
- Exact TypeScript interface names for `PeakBlock`, `PeakDetectorResult`, `ScheduleOptions`, `FireTime` — name them sensibly
- Whether `schedule.ts` exports a single function or also exports helper types
- Internal implementation of the 4-hour sliding window (index math for wrapping)
- Timezone conversion approach for timestamp → user-local hour (use `Intl.DateTimeFormat` or a simple UTC offset from the IANA tz string)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design spec (primary source of truth)
- `2026-04-16-tracker-sender-merge-design.md` §3 — Full peak detection algorithm: hourly bucketing, 4-hour sliding window, midnight wrap, tiebreak rules, worked example
- `2026-04-16-tracker-sender-merge-design.md` §3 — Schedule generation: anchor = midpoint + :05, 5-fire chain, 5h spacing, jitter rules, overflow wrap fix
- `2026-04-16-tracker-sender-merge-design.md` §3 table — Edge case handling (ties, midnight wrap, insufficient data, override short-circuit)
- `2026-04-16-tracker-sender-merge-design.md` §7 — Test coverage requirements for `peak-detector.test.ts` and `schedule.test.ts`

### Requirements
- `.planning/REQUIREMENTS.md` — SCHED-02 through SCHED-09 (the 8 requirements this phase covers)

### Existing code to understand before implementing
- `claude-usage-tracker/src/lib/queries.ts` — `ParsedSnapshot` interface (the input type for peak-detector)
- `claude-usage-tracker/src/lib/analysis.ts` — `buildActivity` function shows existing hourly delta logic; understand it before reimplementing independently in peak-detector
- `claude-usage-tracker/src/lib/usage-window.ts` — `computeUsageDelta` pure function; peak-detector should use this for delta computation between consecutive snapshots

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/queries.ts` (`ParsedSnapshot`, `parseSnapshots`): The input type for peak-detector. Callers already have this from Phase 1.
- `src/lib/usage-window.ts` (`computeUsageDelta`): Pure function that computes the delta between two snapshots for a given window key. Peak-detector should call this rather than re-derive the delta logic from scratch.
- `src/lib/analysis.ts` (`buildActivity`): Reference implementation of hourly bucketing — read it to understand the pattern, but do not import from it.

### Established Patterns
- Named exports only; no default exports in lib files.
- `function` keyword for top-level named functions; `camelCase` verb-first naming.
- Tests in `test/` directory, named `<module>.test.ts`, using `node:test` + `node:assert/strict`.
- Test imports use relative paths (`../src/lib/peak-detector`) not the `@/*` alias.
- No external test framework — Node built-in runner only.

### Integration Points
- Phase 4 (`scheduler.ts`) will import `peakDetector` and `generateSchedule` and call them with parsed snapshots + `app_meta` config values.
- Phase 5 (dashboard) will display `peak_block` and fire times — the return types of these modules become the dashboard data shape; name them readably.
- No wiring in this phase — new modules are imported nowhere except their own test files.

</code_context>

<specifics>
## Specific Ideas

- User confirmed they don't need to weigh in on TypeScript type choices — implementation details are Claude's call.
- Jitter verification approach: range assertions only. Keep tests simple.
- `defaultSeedTime` format: `"HH:MM"` string matching the `app_meta` storage format (e.g. `"05:05"`).

</specifics>

<deferred>
## Deferred Ideas

- Extracting shared hourly-bucketing helper between `analysis.ts` and `peak-detector.ts` — explicitly decided against; revisit only if a third consumer emerges.
- Injectable randomizer for jitter — not needed given range-assertion testing strategy.
- Day-of-week-specific peak detection (V2-SCHED-01) — out of scope per requirements.

</deferred>

---

*Phase: 02-algorithm-core-pure-modules*
*Context gathered: 2026-04-20*
