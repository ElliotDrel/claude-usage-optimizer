# Quick Task 260406-ga0: Build Claude.ai Usage Tracker - Research

**Researched:** 2026-04-06
**Domain:** Claude.ai usage API polling + local dashboard
**Confidence:** MEDIUM

## Summary

The Claude.ai usage endpoint is an undocumented internal API at `https://claude.ai/api/organizations/{orgId}/usage`. Multiple open-source browser extensions (oov/claude-usage-monitor, she-llac/claude-counter) call this endpoint using session cookies with `credentials: 'include'`. The response contains usage buckets (`five_hour`, `seven_day`, plus model-specific buckets) each with a `utilization` number (0-100 scale) and `resets_at` ISO 8601 timestamp.

For the collector, a simple Node.js script with `setInterval` is the right approach -- no need for cron or a scheduler library for a single 5-minute polling loop. SQLite via `better-sqlite3` is the storage layer. Next.js + Recharts handles the dashboard.

**Primary recommendation:** Keep the collector as a standalone Node.js script (not bundled into Next.js) so it can run independently as a background process.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Call `https://claude.ai/api/organizations/{orgId}/usage` directly using session cookies
- No page scraping or browser automation
- Fixed 5-minute polling interval for v1
- Log warning + skip on auth failure, retry on next interval
- SQLite database, single file, keep all data forever
- Next.js + Recharts, runs locally via `npm run dev`
- Web usage API only for v1 (no Claude Code OTEL integration)

### Claude's Discretion
- Project structure (monorepo layout)
- SQLite schema design
- Chart types and dashboard layout
- Collector implementation details (process management)

### Deferred Ideas
- Adaptive polling (increase during active, decrease during idle)
- SSE `message_limit` events for unrounded utilization
- Claude Code OTEL integration
</user_constraints>

## Claude.ai Usage API

### Endpoint
```
GET https://claude.ai/api/organizations/{organizationId}/usage
```
[VERIFIED: github.com/oov/claude-usage-monitor source code]

### Authentication
- Uses browser session cookies -- the request must include the `sessionKey` cookie [ASSUMED]
- The `lastActiveOrg` cookie contains the organization ID needed for the URL [VERIFIED: she-llac/claude-counter README]
- No explicit headers required beyond standard browser cookies [VERIFIED: oov/claude-usage-monitor uses `credentials: 'include'` with no custom headers]

**For a Node.js collector (not a browser extension):** The user must manually copy the session cookie value from their browser. Cookie name is likely `sessionKey` (the main auth cookie for claude.ai). Sessions appear to last days/weeks but will eventually expire, requiring re-copy. [ASSUMED]

### Response Schema
```typescript
// [VERIFIED: oov/claude-usage-monitor source code]
interface UsageResponse {
  five_hour: UsageBucket;
  seven_day: UsageBucket;
  seven_day_opus?: UsageBucket;       // Model-specific bucket
  seven_day_oauth_apps?: UsageBucket; // OAuth apps bucket
}

interface UsageBucket {
  utilization: number;   // 0-100 scale (percentage)
  resets_at: string;     // ISO 8601 timestamp, e.g. "2026-04-06T18:30:00Z"
}
```

**Key detail:** The `utilization` value from this endpoint is rounded. The SSE `message_limit` events during conversations provide exact unrounded fractions -- but that's deferred for v1. [VERIFIED: she-llac/claude-counter docs mention "SSE provides exact, unrounded utilization fractions"]

**Additional buckets may exist** depending on plan tier (Pro vs Max). The schema should handle unknown keys gracefully. [ASSUMED]

## Standard Stack

| Library | Version | Purpose |
|---------|---------|---------|
| next | 16.2.2 | Dashboard framework | [VERIFIED: npm registry]
| recharts | 3.8.1 | Charts for usage visualization | [VERIFIED: npm registry]
| better-sqlite3 | 12.8.0 | SQLite driver (sync, fast) | [VERIFIED: npm registry]
| node-cron | 4.2.1 | Optional: cron scheduling | [VERIFIED: npm registry]

**Recommendation:** Skip `node-cron` -- a simple `setInterval(fn, 5 * 60 * 1000)` is sufficient for v1. Node-cron adds complexity for no benefit when you have a single fixed-interval task. [ASSUMED]

## Architecture

### Project Structure
```
claude-usage-tracker/
  src/
    collector/
      index.ts          # Polling loop entry point
      api.ts            # Claude API client
      db.ts             # SQLite read/write
    app/                # Next.js app directory
      page.tsx          # Dashboard home
      api/
        usage/route.ts  # API route: query SQLite for chart data
      components/
        UsageChart.tsx   # Recharts area chart
        PeakHours.tsx    # Peak hours heatmap/analysis
  data/
    usage.db            # SQLite database (gitignored)
  .env.local            # Session cookie + org ID (gitignored)
```

### SQLite Schema
```sql
CREATE TABLE usage_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),  -- ISO 8601 UTC
  five_hour_utilization REAL,
  five_hour_resets_at TEXT,
  seven_day_utilization REAL,
  seven_day_resets_at TEXT,
  raw_json TEXT  -- Store full response for future-proofing
);

-- Index for time-range queries (dashboard will query by date ranges)
CREATE INDEX idx_snapshots_timestamp ON usage_snapshots(timestamp);
```

**Key decisions:**
- Store `raw_json` alongside parsed fields -- if the API adds buckets later, data is preserved [ASSUMED best practice]
- `REAL` for utilization (SQLite has no decimal type, REAL is 8-byte IEEE float) [VERIFIED: SQLite docs]
- Timestamp as TEXT in ISO 8601 -- SQLite's datetime functions work with this format [VERIFIED: SQLite docs]
- At 5-min intervals: ~288 rows/day, ~105K rows/year, ~10MB/year -- storage is negligible [ASSUMED calculation]

### Dashboard API Routes
```typescript
// src/app/api/usage/route.ts
// Query params: ?range=24h|7d|30d|all&bucket=five_hour|seven_day
// Returns: { snapshots: Array<{ timestamp, utilization }> }
```

### Recharts Patterns
- **AreaChart** for utilization over time (filled area shows usage intensity) [ASSUMED best practice]
- **BarChart** grouped by hour-of-day for peak hour analysis [ASSUMED]
- Use `ResponsiveContainer` for auto-sizing [VERIFIED: Recharts standard pattern]
- `XAxis` with `tickFormatter` for date formatting, `YAxis` domain `[0, 100]` for percentage [ASSUMED]

## Don't Hand-Roll

| Problem | Use Instead |
|---------|-------------|
| SQLite bindings | `better-sqlite3` (sync API, no callback hell) |
| Date formatting in charts | `date-fns` format functions |
| Chart rendering | Recharts (don't build SVG charts manually) |

## Common Pitfalls

### 1. Session Cookie Expiration
**What goes wrong:** Collector silently fails when cookie expires, gaps in data.
**How to avoid:** Log clearly on 401/403 responses. Store last successful poll timestamp. Dashboard should show data gaps visually. Consider a health indicator on the dashboard showing collector status.

### 2. SQLite Locked Database
**What goes wrong:** Collector writes while dashboard reads, causing SQLITE_BUSY.
**How to avoid:** Use WAL mode (`PRAGMA journal_mode=WAL`). This allows concurrent reads during writes. Set it once when opening the database. [VERIFIED: SQLite WAL mode documentation]

### 3. Timezone Confusion
**What goes wrong:** Mixing local and UTC timestamps makes peak-hour analysis wrong.
**How to avoid:** Store everything in UTC. Convert to local time only in the dashboard UI layer. The API's `resets_at` is already UTC ISO 8601.

### 4. Next.js API Routes and better-sqlite3
**What goes wrong:** Next.js API routes may have issues with native modules (better-sqlite3 is a native addon).
**How to avoid:** Add `better-sqlite3` to `serverComponentsExternalPackages` in `next.config.js`. Use `--turbopack` flag carefully -- native modules may need the webpack bundler. [ASSUMED -- common Next.js + native module issue]

```javascript
// next.config.js
module.exports = {
  serverExternalPackages: ['better-sqlite3'],
};
```

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Session cookie name is `sessionKey` | Authentication | Collector won't auth -- easy to fix by inspecting browser DevTools |
| A2 | Sessions last days/weeks before expiring | Authentication | May need more frequent cookie refresh |
| A3 | Additional API buckets may exist beyond the 4 known ones | Response Schema | Missing data -- mitigated by storing raw_json |
| A4 | setInterval sufficient vs node-cron | Stack | Low risk -- trivially swappable |
| A5 | better-sqlite3 works with Next.js 16 via serverExternalPackages | Pitfalls | Could block dashboard -- fallback to separate API server |

## Open Questions

1. **Exact cookie name for authentication**
   - What we know: Browser extensions use `credentials: 'include'` which sends all cookies
   - What's unclear: Which specific cookie(s) a standalone Node.js collector needs
   - Recommendation: User inspects DevTools Network tab on claude.ai, copies the full `Cookie` header value for the collector config. Store as `CLAUDE_SESSION_COOKIE` env var.

2. **Response schema completeness**
   - What we know: `five_hour`, `seven_day`, `seven_day_opus`, `seven_day_oauth_apps` buckets
   - What's unclear: Whether Max plans have different/additional buckets
   - Recommendation: Store `raw_json` and parse known fields. Log unknown keys.

## Sources

### Primary (HIGH confidence)
- [oov/claude-usage-monitor](https://github.com/oov/claude-usage-monitor) - monitor.js source code, verified API URL and response structure
- [she-llac/claude-counter](https://github.com/she-llac/claude-counter) - README documents `lastActiveOrg` cookie usage and SSE details
- npm registry - verified package versions via `npm view`

### Secondary (MEDIUM confidence)
- [dependentsign/ClaudeUsageWidget](https://github.com/dependentsign/ClaudeUsageWidget) - macOS widget confirming same API structure
- [rjwalters/claude-monitor](https://github.com/rjwalters/claude-monitor) - confirms OAuth/cookie-based auth pattern

### Tertiary (LOW confidence)
- SQLite schema design and Next.js integration patterns based on training knowledge [ASSUMED]
