# Quick Task 260406-ga0: Build Claude.ai Usage Tracker - Context

**Gathered:** 2026-04-06
**Status:** Ready for planning

<domain>
## Task Boundary

Build a Claude.ai usage tracker that polls the authenticated usage API endpoint, stores snapshots in a local database, and presents the data in a local dashboard with graphs for identifying peak usage windows.

</domain>

<decisions>
## Implementation Decisions

### Data Collection Approach
- Call `https://claude.ai/api/organizations/{orgId}/usage` directly using session cookies
- No page scraping or browser automation

### Polling Strategy
- Fixed 5-minute interval for v1
- Log warning + skip on auth failure, retry on next interval
- Future: adaptive polling (increase frequency during active usage, decrease during idle)

### Data Storage
- SQLite database, single file
- Keep all data forever (storage is negligible at ~1KB/poll)

### Dashboard Tech
- Next.js + Recharts
- Runs locally via `npm run dev`
- Interactive charts for peak usage analysis

### Scope
- Web usage API only for v1 (no Claude Code OTEL integration)
- Collector + local dashboard with graphs

</decisions>

<specifics>
## Specific Ideas

- The usage API returns: 5-hour utilization %, 7-day utilization %, reset timestamps
- Auth via session cookies (`lastActiveOrg` cookie for org ID)
- User wants to identify peak usage windows and adjust subscription limits accordingly
- SSE `message_limit` events during conversations provide more precise (unrounded) utilization — noted for future enhancement

</specifics>
