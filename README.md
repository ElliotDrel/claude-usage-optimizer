# Claude Usage Optimizer

## The problem

Claude Pro/Max gives you a rolling 5-hour usage window shared across claude.ai, Claude Code, and any agent running on your subscription. If you use Claude heavily throughout the day — especially with Claude Code or autonomous agents — you burn through that window fast. When it runs out mid-session, you're throttled until it resets, regardless of how much of the day is left.

The window doesn't reset on a fixed schedule. It resets 5 hours after it last opened. That means *when* the window opens matters as much as how much quota you have.

## How this fixes it

This tool watches your actual usage, finds the 4-hour block when you're most active, and fires a lightweight daily send at its midpoint. That send opens a fresh window exactly at your peak — so two consecutive 5-hour windows overlap your most active period instead of one.

The result is roughly twice the usable quota during your peak hours, with no manual configuration. The schedule updates nightly as your usage patterns change.

→ Architecture overview: [ARCHITECTURE.md](./ARCHITECTURE.md)

---

## Prerequisites

- Node.js 20+
- A Claude **Pro or Max** subscription
- `claude` CLI installed and authenticated (`claude --version` should work)

---

## Local setup (2 min)

```bash
git clone https://github.com/your-username/claude-usage-optimizer.git
cd claude-usage-optimizer
npm ci
npm run dev
```

Open [http://localhost:3017](http://localhost:3017). The app runs in **demo mode** by default — no credentials needed to explore the dashboard.

---

## Connect real data

Copy the example env file:

```bash
cp .env.example .env.local
```

Then pick **one** auth method and fill it in:

### Option A — Session cookie (recommended)

1. Open [claude.ai](https://claude.ai) in Chrome/Firefox
2. Open DevTools → Network tab → reload the page
3. Click any request to `claude.ai` → Headers → find the `Cookie:` request header
4. Copy the entire value and paste it into `.env.local`:

```
CLAUDE_SESSION_COOKIE=<paste full cookie string here>
```

This gives you richer data (usage breakdown, extra credits, payment info) because it can hit the organization API endpoints.

### Option B — OAuth bearer token

If you use the Claude Code CLI, your token is already on disk:

```bash
cat ~/.claude/.credentials.json
```

Copy the `token` value into `.env.local`:

```
CLAUDE_BEARER_TOKEN=<token value>
```

Or leave `CLAUDE_BEARER_TOKEN` blank — the app will auto-read `~/.claude/.credentials.json` if present.

### Start with real data

```bash
npm run dev
```

The dashboard will show live usage within the first polling interval (up to 5 minutes in idle tier).

---

## Enable anchor sends

The scheduler fires a daily `claude` CLI send at your detected anchor time. To enable it, add your OAuth token:

```bash
# Get your token from the Claude Code CLI
claude setup-token
```

Add to `.env.local`:

```
CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat-...
```

The sender uses the same token the Claude Code CLI uses — not an API key. This must be a Pro/Max subscription token.

---

## Verify it's working

After a day of usage data, the dashboard will show:

- **Peak block** — detected 4-hour window of highest activity
- **Anchor time** — the midpoint send time (local + UTC)
- **Fire schedule** — 5 daily sends spaced 5 hours apart
- **Send history** — log of past sends with status and response excerpts

The schedule regenerates nightly. It requires ≥3 calendar days of data before the peak detector has enough signal.

---

## Production deploy (GCP free tier)

Runs as a single systemd service on a GCP e2-micro VM. Free forever.

Full step-by-step guide (≈30 min, no deep CLI knowledge needed):  
→ [docs/HOSTING-STRATEGY.md](docs/HOSTING-STRATEGY.md)

---

## Repo layout

```
src/
  app/          Next.js App Router — dashboard UI and API routes
  lib/          Core logic — collector, analyzer, scheduler, sender, DB
  utils/        Shared utilities
test/           Automated tests (Node built-in runner)
docs/           Deployment guide, dev loop, research notes
scripts/        VM installer
examples/       Agent SDK integration example
```

---

## Development commands

```bash
npm run dev      # dev server with demo mode on (localhost:3017)
npm test         # run test suite
npm run lint     # ESLint
npm run build    # production build check
```

---

## License

MIT — see [LICENSE](./LICENSE).
