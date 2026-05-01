# TODO

## Up next

### Local npm package

Right now the tool is built for cloud deployment with cookie-based monitoring. The goal is a simple `npm install` package that works entirely locally — no server, no cookie, no cloud setup.

- Hook into the same data the Claude Code statusline reads (stdin JSON payload on every prompt, which includes `rate_limits.five_hour.used_percentage` and `rate_limits.seven_day.used_percentage`)
- Save to a local SQLite database
- Run peak detection and schedule generation locally
- Handle anchor sends locally via the Claude Code CLI
- Zero external dependencies beyond Node.js and the Claude Code CLI already being installed

This would make the tool usable for anyone who can run `npm install`, without needing a GCP VM or manual cookie extraction.

### Delta-only snapshot storage

Currently every poll writes the full raw JSON payload to the database. With frequent polling this adds up fast — the DB grows quickly and most of the data is redundant.

Switch to storing only delta increases, as granular as possible:

- On each poll, compute the utilization delta vs. the previous snapshot
- If delta is zero, skip the write entirely
- Store only the timestamp, delta value, and window reset time
- Keep the raw JSON for the most recent snapshot only (for debugging)

This reduces storage significantly and makes the peak detection query simpler and faster.

---

## Future ideas

### Response header piggyback

Every `/v1/messages` response from `api.anthropic.com` already includes utilization data as headers (`anthropic-ratelimit-unified-5h-utilization`, etc.). Reading these on each response gives per-message tracking with zero extra API calls. Useful for any integration that sits inside the Claude Code or Agent SDK request path.

### Explicit Anthropic + user peak hour scheduling

The optimizer already avoids Anthropic's peak hours implicitly through delta tracking — higher multipliers register as larger deltas, so those hours naturally score lower in peak detection. The next step is making this explicit: incorporate Anthropic's publicly documented peak hours as a hard constraint alongside the user's detected peak block, so the scheduler places tasks in windows confirmed off-peak for both. This would give users visibility into when and why tasks are being scheduled.

### ChatGPT / Codex support

Implement the same quota-window optimization for ChatGPT Plus/Pro and Codex users. Both have analogous usage limits that reset on a rolling basis. The peak detection and scheduling logic is model-agnostic — the main work is mapping their rate limit API responses or response headers to the same delta-tracking interface the Claude collector uses.

### Agent workflow scheduling

More ambitious: the agent monitors current utilization in real time and, based on time of day and the user's peak hours, delays high-cost tasks (multi-turn research, large tool call chains) until immediately after the next anchor send when quota is freshest. Low-cost tasks run in the meantime. User-overrideable for anything urgent. When a user offloads a task to a background agent, a few hours' delay rarely matters to them — but to their quota, it can make a significant difference.
