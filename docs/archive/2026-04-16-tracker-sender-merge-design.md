# Tracker + Sender Merge — Design Spec

> Written 2026-04-16. Supersedes the two-subproject model described in `README.md` and the two-systemd-service model in `HOSTING-STRATEGY.md §6.3.6–3.7`.
>
> **Companion updates required:** `HOSTING-STRATEGY.md` will need its Phase 3.6–3.7 (Python venv + `claude-sender.service`) replaced with a single-service deployment. The `Claude Message Sender/` directory will be deleted once the merged sender is proven.

---

## 1. Goal

Produce a single product — one Next.js application, one systemd unit — that:

1. Observes the user's Claude.ai usage (existing tracker behavior).
2. Computes an optimal daily message-send schedule from the observed usage.
3. Executes those sends automatically via the `claude` CLI.

The optimization goal: **during the user's four most-continuous peak-usage hours, ensure one 5-hour window ends at the midpoint of that block and the next begins immediately.** This lets the user drain two full 5-hour budgets across their peak period instead of one.

## 2. Non-goals

- Multi-user support.
- Public exposure of the dashboard. (Tracker remains bound to `127.0.0.1`, accessed via SSH tunnel or Tailscale.)
- Replacing the hosting strategy. The VM, auth model, and backup plan in `HOSTING-STRATEGY.md` all stand — only the two-service layout changes.
- Supporting API-key auth. Sends are always via `CLAUDE_CODE_OAUTH_TOKEN` against the user's subscription.

## 3. Algorithm

### 3.1 Peak detection

Runs nightly at **03:00 UTC** and re-uses *all* historical snapshots (the dataset is small and monotonically growing; full recompute is trivially cheap).

1. Query all snapshots with `status = 'ok'`, ordered by `timestamp`.
2. Parse `raw_json` at read time. For each consecutive pair, compute the 5-hour utilization delta using the existing `computeUsageDelta` helper (moved to run post-parse).
3. Aggregate deltas into 24 hourly buckets keyed by **user-local hour-of-day** (`hourlyTotal[0..23]`). Local, not UTC — the user's peak is a lifestyle pattern, not a UTC pattern. Because the VM runs in UTC, the scheduler reads a configured `user_timezone` (IANA name in `app_meta`, default `America/Los_Angeles`) to convert snapshot timestamps before bucketing. Fire times are computed in user-local time and converted to UTC at tick-comparison time.
4. Slide a 4-hour window across the 24 buckets, **wrapping past midnight** (index `(start + i) % 24`). Pick the contiguous 4-hour block with the largest sum. That is the **peak block**.
5. **Midpoint** = `block_start + 2` hours.

Worked example: peak block is `00:00–04:00` → midpoint is `02:00`.

### 3.2 Schedule generation

1. **Anchor fire time** = `midpoint + :05` (preserves the 5-minute safety buffer the existing sender uses — ensures the 5-hour window actually has elapsed before the reset send).
2. Generate the daily chain by repeatedly adding 5 hours: anchor, anchor+5h, anchor+10h, anchor+15h, anchor+20h. **All five must wrap past 24h**; the current Python implementation drops overflow fires, which this design fixes.
3. Apply the existing 0–5-minute randomization (`randomize_time_str` logic) to every non-anchor fire. The anchor stays exact — it is the whole point.

Worked example (midpoint `02:00`, anchor `02:05`):
- `02:05` (anchor, exact)
- `07:05` ± random 0–5 min earlier
- `12:05` ± random 0–5 min earlier
- `17:05` ± random 0–5 min earlier
- `22:05` ± random 0–5 min earlier

### 3.3 Edge cases and fallbacks

| Condition | Behavior |
|---|---|
| < 3 days of snapshot data | Fall back to user-configured default seed (default `05:05`). Log a dashboard warning. |
| Ties between equally-ranked 4-hour blocks | Deterministic tiebreak: pick the block whose midpoint is closest to 12:00 local. On a further tie, earliest block. |
| Peak block wraps midnight (e.g., `22:00–02:00`) | Sliding window wraps naturally. Midpoint is `24:00` → `00:00` local → anchor `00:05`. |
| User override present in `app_meta.schedule_override_start_time` | Skip peak detection entirely. Treat the override as the anchor and generate the chain from it. |
| Process restarts mid-day | On startup, re-read today's `schedule_fires`. If a fire time was missed by <15 min, fire immediately (catch-up). If missed by ≥15 min, skip — the 5-hour window has already advanced. |

## 4. Architecture

```
claude-tracker (Next.js, single systemd unit)
├── Collector           (existing)   adaptive polling → writes raw_json
├── DB                  (refactored) SQLite, simplified schema
├── Scheduler           (NEW)        in-process tick loop:
│                                    fires sends + nightly recompute
├── Peak detector       (NEW)        pure fn: snapshots → peak block + midpoint
├── Schedule generator  (NEW)        pure fn: midpoint + overrides → fire times
├── Sender              (NEW)        child_process spawn `claude -p`
├── Query layer         (NEW)        json_extract-based read helpers
└── Dashboard           (extended)   heatmap, peak card, schedule, overrides
```

### 4.1 New modules

| File | Responsibility |
|---|---|
| `src/lib/peak-detector.ts` | Pure function. `(snapshots: SnapshotRow[]) => { peakBlock: {startHour, sumDelta}, midpoint: number } \| null`. Returns `null` when data is insufficient. |
| `src/lib/schedule.ts` | Pure function. `(midpoint: number, opts: ScheduleOptions) => FireTime[]`. Applies `:05` offset, generates 5-fire chain, applies jitter to non-anchor fires. |
| `src/lib/sender.ts` | Spawns `claude -p "<question>" --model haiku` via `child_process.spawn`. Captures stdout/stderr + exit code. Writes a row to `send_log`. |
| `src/lib/scheduler.ts` | In-process tick loop (`setInterval` every 60 s). On each tick: check today's fire times; if one matches ± tolerance, invoke sender. At 03:00 UTC daily: recompute peak + schedule, persist to `app_meta`. |
| `src/lib/queries.ts` | All read-side helpers that parse `raw_json` + call `normalizeUsagePayload`. Replaces column-level reads in `analysis.ts` and dashboard route. |

### 4.2 Scheduler tick — chosen approach

**In-process `setInterval(60_000)`** inside `instrumentation.ts` (same pattern the collector singleton already uses). One tick loop, one responsibility boundary, no new OS-level scheduling surface. Catch-up-on-startup logic covers restarts.

*Rejected:* one-shot systemd timers per fire time. Would split scheduling logic across the app and systemd, require regenerating timer units when the schedule changes, and complicate migration. Single-process is simpler and adequate for a 1-user system.

### 4.3 Data flow

1. **Continuous:** Collector writes snapshots → `usage_snapshots`.
2. **03:00 UTC nightly:** Scheduler reads all snapshots → peak-detector → schedule-generator → writes `app_meta.schedule_fires`, `app_meta.peak_block`, `app_meta.schedule_generated_at`.
3. **Per-minute tick:** Scheduler reads `app_meta.schedule_fires` (each as a UTC ISO timestamp for today). With a 60 s tick, a fire executes on the first tick at or after its scheduled instant. Each tick invokes sender for any fire whose timestamp is ≤ `now` and not yet in `schedule_fires_done`. If a fire is more than 15 min late (process was down), skip it — the 5-hour window has already advanced.
4. **Per send:** Sender spawns `claude -p`, waits (max 60 s timeout), writes result to `send_log`, marks fire time as done in `app_meta.schedule_fires_done` (a JSON array reset at 03:00 UTC).
5. **Dashboard read:** Reads `usage_snapshots` + `send_log` + `app_meta`, renders panels.

## 5. Database

### 5.1 Reuse hosting-doc simplification

Per `HOSTING-STRATEGY.md §5.2`, `usage_snapshots` becomes:

```sql
CREATE TABLE usage_snapshots (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp       TEXT    NOT NULL,
  status          TEXT    NOT NULL,
  endpoint        TEXT,
  response_status INTEGER,
  raw_json        TEXT,
  error_message   TEXT
);
CREATE INDEX idx_snapshots_timestamp ON usage_snapshots(timestamp);
CREATE INDEX idx_snapshots_status    ON usage_snapshots(status);
```

### 5.2 New tables

Sends live in a separate table, not as rows in `usage_snapshots`. Different write cadence, different read patterns, and semantically different — a snapshot is an observation, a send is an action.

```sql
CREATE TABLE send_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  fired_at        TEXT    NOT NULL,         -- ISO 8601 UTC, actual fire instant
  scheduled_for   TEXT    NOT NULL,         -- ISO 8601 UTC, the slot this fire corresponds to
  is_anchor       INTEGER NOT NULL,         -- 1 if this was the peak-anchor fire
  status          TEXT    NOT NULL,         -- 'ok' | 'error' | 'timeout'
  duration_ms     INTEGER,
  question        TEXT,                     -- the question sent
  response_excerpt TEXT,                    -- first ~500 chars of CLI stdout
  error_message   TEXT
);
CREATE INDEX idx_send_log_fired_at ON send_log(fired_at);

CREATE TABLE app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

### 5.3 `app_meta` keys

| Key | Value shape | Purpose |
|---|---|---|
| `schedule_fires` | JSON `string[]` of today's fire times as UTC ISO timestamps | Today's plan |
| `schedule_fires_done` | JSON `string[]` of fire timestamps already executed today | Dedup on tick; reset at 03:00 UTC |
| `schedule_generated_at` | ISO timestamp | When the current schedule was computed |
| `peak_block` | JSON `{ startHour, sumDelta, midpoint }` (local hours) | Dashboard display + debug |
| `schedule_override_start_time` | `"HH:MM"` (user-local) or empty | User-set anchor override. When present, peak detection is skipped. |
| `peak_window_hours` | integer, default 4 | User-tunable block length (3–6). |
| `anchor_offset_minutes` | integer, default 5 | User-tunable safety buffer. |
| `default_seed_time` | `"HH:MM"` (user-local), default `"05:05"` | Fallback when data is thin. |
| `user_timezone` | IANA name, default `"America/Los_Angeles"` | Timezone used to bucket snapshots and interpret local fire times. |

### 5.4 Read-path refactor

Everything currently in `src/lib/analysis.ts` that reads typed columns (`five_hour_utilization`, etc.) moves to `src/lib/queries.ts` and reads them via `JSON.parse(row.raw_json)` + the existing `normalizeUsagePayload`. The delta/window logic in `src/lib/usage-window.ts` stays pure and untouched — it already takes values as arguments.

`normalize.ts` stays as a pure function and is now called on the read side instead of the write side.

### 5.5 Migration

One-shot migrator at startup. Runs inside a single transaction before any query; idempotent via the `app_meta` marker.

1. If `app_meta.schema_version = 'simplified-v1'` already exists, skip.
2. Otherwise, create the new simplified `usage_snapshots` table as `usage_snapshots_new` alongside the old one.
3. Copy `(id, timestamp, status, endpoint, response_status, raw_json, error_message)` from the old table into `usage_snapshots_new`.
4. `DROP TABLE usage_snapshots;` then `ALTER TABLE usage_snapshots_new RENAME TO usage_snapshots;`.
5. Recreate the indexes from §5.1.
6. Create `send_log` and `app_meta` tables if they do not exist.
7. Write `app_meta.schema_version = 'simplified-v1'` and `app_meta.migrated_at = <iso>`.

No re-fetch from claude.ai. The existing `raw_json` column is the source of truth for the migration; rows with `raw_json = NULL` are preserved as-is, and the read path treats them as snapshots with no parseable fields.

## 6. Dashboard additions

Three new panels land on the existing dashboard page (`src/app/page.tsx`).

### 6.1 Optimal Schedule card

Always visible, near the top.

Contents:
- **Detected peak block** — e.g., *"Peak: 00:00–04:00 (midpoint 02:00) — based on 47 days of snapshots."*
- **Today's fire times** — 5 rows with scheduled time, status (pending / fired / failed), and — for the anchor — a label like *"← anchor: covers 02:00 midpoint"*.
- **Next fire countdown** — live ticker, *"Next send: 02:05 (in 3h 42m)"*.
- **Manual fire button** — *"Send now"* for testing. Inserts a row in `send_log` with `scheduled_for = NULL`.

### 6.2 Overrides section

Collapsed by default; expands on click. Shows the `app_meta` keys from §5.3 as form inputs:

- Manual `start_time` override (text, `HH:MM`).
- Peak window length (integer 3–6, default 4).
- Anchor offset minutes (integer 0–15, default 5).
- Default seed time for the bootstrap case (text, `HH:MM`, default `05:05`).

Saving any field writes through to `app_meta` and triggers an immediate recompute.

### 6.3 Send history panel

Table of the last 20 rows from `send_log`: fired_at, status, duration, first line of response. Helps diagnose CLI failures (wrong PATH, missing OAuth token, timeout, etc.).

## 7. Testing

### 7.1 Unit tests (`test/` directory, `tsx --test`)

| File | Coverage |
|---|---|
| `test/peak-detector.test.ts` | Synthetic snapshot sequences: known peak position (flat then spike), ties (identical-sum blocks → deterministic pick), midnight wrap (peak at 22–02), insufficient data (→ `null`). |
| `test/schedule.test.ts` | Given a midpoint, all five fire times present; 5-hour spacing; anchor exact; jitter applied to non-anchors only; 24-hour wrap behavior; override short-circuits peak. |
| `test/sender.test.ts` | Mocked `child_process`: success path writes `send_log` ok; stderr non-zero writes error; >60s stalls are timed out and logged. |
| `test/scheduler.test.ts` | Fake-clock tick tests: fire fires within ±30s window; dedup via `schedule_fires_done`; catch-up on restart for <15min gaps; 03:00 UTC triggers recompute. |

### 7.2 Manual verification

1. Run `npm run dev` against a local DB seeded with ≥7 days of synthetic snapshots.
2. Confirm dashboard renders the peak card, schedule, and history panels.
3. Pin an override to fire in 2 minutes; confirm the send runs and `send_log` gets a row.
4. Let it run overnight; next morning confirm 03:00 UTC recompute landed a new `schedule_generated_at`.

### 7.3 VM verification

After deploy, follow `HOSTING-STRATEGY.md §6.5 Phase 5` with adjustments:
- Only `claude-tracker.service` should exist; `claude-sender.service` must be absent.
- `journalctl -u claude-tracker -f` shows scheduler ticks and fire events.
- `sqlite3 data/usage.db "SELECT * FROM send_log ORDER BY id DESC LIMIT 5;"` shows real fires.

## 8. Migration plan (repo-level)

Sequence:

1. **DB refactor.** Add simplified schema + migrator; move normalize to the read side; update `analysis.ts` / dashboard route to go through `queries.ts`. Ship + verify dashboard still renders correctly. No behavior change yet.
2. **Pure modules.** Land `peak-detector.ts` and `schedule.ts` with full unit tests. Not wired to anything yet.
3. **Sender.** Land `sender.ts` with a `POST /api/send-now` route that invokes it. Manually testable from the dashboard's *"Send now"* button.
4. **Scheduler wiring.** Land `scheduler.ts`, register it in `instrumentation.ts`. Initially gated behind an `ENABLE_SCHEDULER=true` env var so dev runs don't fire sends.
5. **Dashboard panels.** Ship the three new panels. Override form writes `app_meta`.
6. **Deprecate Python sender.** Delete `Claude Message Sender/` directory. Update `README.md`.
7. **Hosting doc update.** Rewrite `HOSTING-STRATEGY.md §6.3.6–3.7` as "single Node service" deployment.

Each step is a commit; each commit leaves the system working.

## 9. Open decisions (revisable — not blockers)

- **Peak window length.** Fixed at 4 hours per the user's stated formula. Exposed as an override (3–6). No plan to auto-tune.
- **Data recency weighting.** Current design: un-weighted full history; user expects convergence as data accumulates. If a lifestyle shift makes the settled peak stale, user can set a date-range exclusion (not in v1 scope; revisit later).
- **Question rotation.** The existing `QUESTIONS` list in the deprecated Python sender is ~10 items; port it verbatim into `sender.ts` as a constant. Revisit if the list becomes visible / feels stale.
- **Model for sends.** Haiku, per current behavior. No reason to change.

## 10. Out of scope for v1

- Day-of-week-specific schedules (one global schedule for all days).
- Lifestyle-change detection / date-range exclusion from peak calc.
- Retry logic on failed sends (a failure is logged and the next slot is honored; no re-fire).
- Notifications on failure (can add `ntfy.sh` / Discord webhook later per `HOSTING-STRATEGY.md §8`).
- Per-question customization beyond the existing rotation.
