# Architecture

## Data flow

```
Claude API / claude.ai
        │
        ▼
┌───────────────────┐
│    Collector      │  Adaptive polling: 60s idle → 5s burst
│  collector.ts     │  Tier state machine tracks usage deltas
└────────┬──────────┘
         │ every poll
         ▼
┌───────────────────┐
│     SQLite        │  Append-only log of every poll result
│      db.ts        │  Single writer, WAL mode
└────────┬──────────┘
         │ at analysis time
         ▼
┌───────────────────┐
│    Analyzer       │  Sliding 4-hour window over hourly deltas
│  peak-detector.ts │  Returns the busiest block in user-local time
│  analysis.ts      │  Builds dashboard data (timeline, heatmap, insights)
└────────┬──────────┘
         │ daily recompute
         ▼
┌───────────────────┐
│    Scheduler      │  5-slot fire plan anchored to peak midpoint
│  scheduler.ts     │  60s tick loop; persists schedule in app_meta
│  schedule.ts      │
└────────┬──────────┘
         │ at fire time
         ▼
┌───────────────────┐
│     Sender        │  Spawns `claude` CLI with a random question
│    sender.ts      │  Logs result (ok/error/timeout) to send_log
└───────────────────┘
```

The Next.js dashboard (`src/app/`) sits alongside this pipeline, reading from SQLite and the collector singleton via API routes. It does not participate in the send flow.

---

## Key abstractions

| Abstraction | File | What it owns |
|---|---|---|
| `UsageCollector` | `src/lib/collector.ts` | Polling lifecycle, tier transitions, auth selection |
| `computeNextDelay` | `src/lib/collector.ts` | Pure tier state machine (idle/light/active/burst) |
| `computeUsageDelta` | `src/lib/usage-window.ts` | Rolling-window delta math, handles resets |
| `normalizeUsagePayload` | `src/lib/normalize.ts` | Claude API response → typed windows |
| `peakDetector` | `src/lib/peak-detector.ts` | Sliding-window peak block detection, timezone-aware |
| `generateSchedule` | `src/lib/schedule.ts` | 5-slot fire plan from a peak block |
| `buildDashboardData` | `src/lib/analysis.ts` | Full dashboard JSON from raw snapshots |
| `getConfig` | `src/lib/config.ts` | Env-var resolution, auth mode selection |
| `getDb` | `src/lib/db.ts` | SQLite init, schema, CRUD |

---

## Authentication

Two modes, resolved once at startup by `getConfig()`:

- **Cookie mode** (`CLAUDE_SESSION_COOKIE` set): polls `claude.ai/api/organizations/{orgId}/usage`. Gives access to extra-usage spend data.
- **Bearer mode** (`CLAUDE_BEARER_TOKEN` or `~/.claude/.credentials.json`): polls the OAuth usage endpoint. Simpler setup, less data.

Cookie wins when both are present.

---

## Adaptive polling tiers

| Tier | Delay | Trigger |
|---|---|---|
| `idle` | 5 min | 3+ consecutive zero-delta polls |
| `light` | 2 min | Step down from active |
| `active` | 30s | Any positive delta |
| `burst` | 5s | Delta detected at non-burst tier |

Errors use exponential backoff: 1m → 2m → 5m → 10m, independent of tier.

---

## How to extend

**Expose the algorithm as a service:** `GET /api/optimize` returns the current peak block and fire schedule as JSON. Any agent or external process can call this without owning the algorithm. See `src/app/api/optimize/route.ts`.

**Embed in another runtime:** The portable core is ~290 lines across four files with zero framework coupling: `usage-window.ts`, `normalize.ts`, `peak-detector.ts`, `schedule.ts`. Everything else swaps at the I/O boundary. See [INTEGRATION-PROPOSAL.md](./INTEGRATION-PROPOSAL.md) for a full portability map.

**Add a notification channel:** Implement the same interface as `postDiscordNotification` in `src/lib/notifier.ts` and call it from `src/lib/sender.ts` after each send.
