# Claude Usage Optimizer

**Get ~2x more usable hours from your Claude Pro/Max subscription.**

Claude's quota resets on a rolling 5-hour window. This tool watches your actual usage, finds the 4-hour block when you're most active, and fires an anchor send at its midpoint — so two consecutive 5-hour windows span your peak. The result: more agent-hours available exactly when you need them, at no extra cost.

Built for Claude Code power users and OpenClaw-style agents running on subscription auth.

---

## The problem

Claude Pro/Max gives you a 5-hour rolling usage window shared across claude.ai, Claude Code, and any agent using `@anthropic-ai/claude-agent-sdk`. Heavy users and autonomous agents burn through windows constantly. Idle hours waste quota; busy hours hit limits.

## The solution

```
Detect your 4-hour peak block
         ↓
Anchor a send at its midpoint
         ↓
Two consecutive 5-hour windows now span your peak
         ↓
~2x more usable hours, same subscription
```

**How the math works:** If your peak runs 14:00–18:00, the anchor fires at 16:05. Window A covers 11:05–16:05, Window B covers 16:05–21:05. Both high-usage periods are covered by fresh windows.

---

## Architecture

```
┌─────────────┐   polls every   ┌──────────┐   analyzed by   ┌──────────────┐
│  Collector  │ ──60s–5min──▶  │  SQLite  │ ──────────────▶ │   Analyzer   │
│ (adaptive)  │                 │  (disk)  │                  │  (peak algo) │
└─────────────┘                 └──────────┘                  └──────┬───────┘
                                                                      │
                                                               ┌──────▼───────┐
                                                               │  Scheduler   │
                                                               │ (5-slot plan)│
                                                               └──────┬───────┘
                                                                      │
                                                               ┌──────▼───────┐
                                                               │    Sender    │
                                                               │ (claude CLI) │
                                                               └──────────────┘
```

The collector adapts its polling rate to your activity: slow when idle, fast during active sessions. The peak detector uses a sliding 4-hour window over your historical hourly deltas to find the optimal anchor time. The scheduler fires 5 sends per day spaced 5 hours apart, anchored to that midpoint.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full module breakdown.

---

## Quick start

```bash
npm ci
npm run dev
```

Open [http://localhost:3017](http://localhost:3017). The app runs in demo mode by default — no Claude credentials needed to explore the UI.

To use real data, copy `.env.example` to `.env.local` and add your auth:

```bash
cp .env.example .env.local
# Edit .env.local — see comments inside for which fields you need
npm run dev
```

---

## Production deploy (GCP free tier)

One systemd service on a GCP e2-micro VM. Free forever.

→ See [docs/HOSTING-STRATEGY.md](docs/HOSTING-STRATEGY.md) for the full step-by-step guide (~30 min, no deep CLI knowledge required).

---

## Built for embedding into agent products

The peak-detection algorithm is exposed as a standalone REST endpoint:

```bash
GET /api/optimize
```

```json
{
  "peakBlock": { "startHour": 14, "endHour": 18, "sumDelta": 0.83, "midpoint": 16 },
  "anchorTimeLocal": "16:05",
  "anchorTimeUtc": "2026-05-01T20:05:00.000Z",
  "fireSchedule": [{ "hour": 16, "minute": 5, "isAnchor": true }, ...],
  "timezone": "America/New_York",
  "computedAt": "2026-05-01T15:23:00.000Z"
}
```

Any agent that runs on a Claude subscription can call this endpoint and fire its own anchor send — no UI required. The pure-function core (`peak-detector.ts`, `schedule.ts`, `usage-window.ts`, `normalize.ts`) is designed to be extracted and embedded directly into agent runtimes.

→ See [INTEGRATION-PROPOSAL.md](./INTEGRATION-PROPOSAL.md) for how this drops into OpenClaw-style agent products, with three integration patterns ranked by effort.

→ See [examples/agent-sdk-anchor-send.ts](./examples/agent-sdk-anchor-send.ts) for a working `@anthropic-ai/claude-agent-sdk` implementation.

---

## Repo layout

```
src/
  app/          Next.js routes and dashboard UI
  lib/          Core logic (collector, analyzer, scheduler, sender)
  utils/        Shared utilities
test/           Automated test suite (Node built-in test runner)
docs/           Deployment guide, hosting strategy, research notes
scripts/        VM installer and operational helpers
examples/       Agent SDK integration example
```

---

## Tests

```bash
npm test       # run test suite
npm run lint   # ESLint
npm run build  # production build check
```

---

## License

MIT — see [LICENSE](./LICENSE).
