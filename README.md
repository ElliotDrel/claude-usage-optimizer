# Claude Usage Optimizer

Umbrella repo for tools that optimize Claude Code usage against the 5-hour rolling window.

Two subprojects live here side-by-side. They are independent today; the long-term plan is to merge them so the tracker can auto-trigger the sender to shift window start times.

## Subprojects

### `Claude Message Sender/`
Python scripts that send a message to Claude to intentionally start (or shift) a 5-hour usage window.

- `claude_message_send_with_browser.py` — browser-driven send
- `claude_message_send_with_CC_CLI.py` — sends via the Claude Code CLI
- `test_send_now.py` — manual trigger for testing
- `requirements.txt` — Python deps

### `Claude Usage Tracker/claude-usage-tracker/`
Next.js dashboard that tracks Claude.ai usage per-cookie with adaptive polling.

- Next.js + TypeScript dashboard
- Local SQLite usage data under `data/` (gitignored)
- See the subproject's own docs / `package.json` for run instructions

## Roadmap

Merge the two so the tracker detects window boundaries and the sender adjusts them automatically.
