# Integration Proposal: Quota-Window Optimization for Subscription-Auth Agents

> **Context:** This document is written for engineering teams building autonomous agents on top of Claude Pro/Max subscriptions — products like OpenClaw that run Claude Code programmatically via `@anthropic-ai/claude-agent-sdk` and share the user's quota window.

---

## Executive Summary

Claude Pro/Max gives users a rolling 5-hour usage window. Every autonomous agent running on a user's subscription competes for that same window — with claude.ai chat, Claude Code CLI, and any other Agent SDK process. Heavy agent users burn through windows constantly; idle hours waste quota; busy hours hit rate limits mid-task.

This project solves that. It observes historical usage, detects the user's 4-hour peak block, and fires a daily anchor send at its midpoint — guaranteeing that two consecutive 5-hour windows span the peak. The result is roughly 2× more usable agent-hours per subscription dollar, with zero manual tuning.

The pure-logic core (~290 lines) has no framework dependencies and is designed to be extracted and embedded directly into agent runtimes.

Three integration patterns are described below, ranked by implementation effort.

---

## The Quota Problem for Subscription-Auth Agents

Claude's usage model for Pro/Max subscribers:

- **Rolling 5-hour window.** Quota refills on a rolling basis, not at a fixed clock time. The window resets 5 hours after the *start* of the previous window.
- **Shared across surfaces.** The quota is shared between claude.ai chat, Claude Code CLI, and any process using `@anthropic-ai/claude-agent-sdk` with the same subscription token.
- **Spiky by nature.** Developer workflows are concentrated: a 2-hour deep work session burns what a casual user spreads across a full day.

The result: agents running on subscription auth are subject to the same windowed throttling as interactive users. A long-running agent task launched at the wrong time can hit rate limits before it finishes, or burn the entire window leaving nothing for the user's interactive sessions.

This is not an edge case. It is the default experience for power users running autonomous agents.

---

## The Solution: Anchor-Window Scheduling

The key insight: if you fire a lightweight message at the right time, you can control *when* the 5-hour window resets — and therefore guarantee that two consecutive windows overlap your peak usage period.

### The algorithm (plain English)

1. **Observe.** Poll the Claude usage API every 30 seconds–5 minutes (adaptive tier based on activity). Write utilization snapshots to SQLite.

2. **Detect.** After ≥3 calendar days of data, slide a 4-hour window across the 24-hour hourly delta histogram. The window position with the highest cumulative delta is the "peak block."

3. **Anchor.** Fire a lightweight send at the peak block's midpoint + 5 minutes. This is the anchor send — its sole purpose is to start a fresh 5-hour window exactly when you need one.

4. **Result.** Window A covers [anchor − 5h, anchor]. Window B covers [anchor, anchor + 5h]. Both high-activity periods now have fresh quota available.

### Worked example

User's peak is 14:00–18:00 local. Midpoint = 16:00. Anchor fires at 16:05.

```
Window A:  11:05 ──────────────────────────── 16:05
Window B:                                     16:05 ──────────────────────────── 21:05
Peak:              14:00 ──────────── 18:00
                         ↑
                    Both windows cover the full peak
```

Before optimization: a single window might cover 14:00–19:00, leaving the second half of the next work block (19:00–21:00) with a partial or empty window. After optimization: both the pre-peak warm-up and the post-peak tail are covered by fresh windows.

### What the fire schedule looks like

Five sends per day, spaced 5 hours apart, anchored to the detected midpoint:

```
16:05  ← anchor (isAnchor: true, jitterMinutes: 0)
21:07  ← +5h + random jitter 0–5 min
02:09  ← +10h
07:11  ← +15h
12:08  ← +20h
```

The jitter on non-anchor slots prevents all sends from landing on exact hour boundaries, which would create detectable patterns in usage curves.

---

## Three Integration Patterns

| Pattern | Implementation effort | Risk | Value |
|---|---|---|---|
| **A. Sidecar service** | Days | Lowest | Optimizer runs alongside the agent, exposes `/api/optimize`, agent calls it before scheduling tasks |
| **B. Skill / plugin** | 1–2 weeks | Medium | Wrap optimizer as an agent skill; agent installs it at setup, calls it on demand |
| **C. Native module** | 3–4 weeks | Highest | Embed scheduler + collector directly into the agent runtime; share persistence layer |

### Pattern A: Sidecar Service (recommended starting point)

The optimizer runs as a separate process (systemd service, Docker container, or background Node process) alongside the agent. The agent calls `/api/optimize` before scheduling long-running tasks to find out when the next fresh window opens.

**Integration surface:** One HTTP GET endpoint.

```bash
GET http://localhost:3017/api/optimize
```

```json
{
  "peakBlock": { "startHour": 14, "endHour": 18, "sumDelta": 0.83, "midpoint": 16 },
  "anchorTimeLocal": "16:05",
  "anchorTimeUtc": "2026-05-01T20:05:00.000Z",
  "fireSchedule": [
    { "hour": 16, "minute": 5, "isAnchor": true, "jitterMinutes": 0 },
    { "hour": 21, "minute": 7, "isAnchor": false, "jitterMinutes": 2 }
  ],
  "timezone": "America/New_York",
  "computedAt": "2026-05-01T15:23:00.000Z"
}
```

The agent uses `anchorTimeUtc` to delay task starts, or uses `fireSchedule` to align its own work bursts with fresh windows.

**What the agent needs to do:**
- Before starting a long task, fetch `/api/optimize`
- If `msUntil(anchorTimeUtc) < taskEstimatedDurationMs`, wait until `anchorTimeUtc`
- Otherwise proceed — enough window remains

**What stays unchanged:** The optimizer handles its own collection, detection, and anchor sends. Zero changes to the agent's core logic.

See [`examples/agent-sdk-anchor-send.ts`](./examples/agent-sdk-anchor-send.ts) for a working `@anthropic-ai/claude-agent-sdk` implementation of the anchor send pattern.

### Pattern B: Skill / Plugin

Package the optimizer's scheduler as an installable agent skill. The agent installs it once at setup (reads auth, discovers timezone, starts polling). At runtime, the skill exposes two tools:

- `get_anchor_time()` → returns the next anchor time in UTC
- `fire_anchor_send()` → fires the lightweight send (consumed by the skill, not the user)

**What needs to be adapted:**
- Replace the Next.js API layer with the skill's tool interface
- Adapt `insertSnapshot` / `getAppMeta` to use the agent's config/storage primitives
- Replace the Discord webhook notifier with the agent's notification channel

**What ports unchanged:** The four pure-logic modules (see "Portability Map" below).

### Pattern C: Native Module

Embed the scheduler, collector, and peak detector directly into the agent runtime. Share the SQLite database (or swap in the agent's existing persistence layer). The optimizer becomes a first-class subsystem, not a sidecar.

**What needs to be adapted or rewritten:** Nearly everything except the four pure-logic modules. The payoff is tighter integration: the agent can query peak-detection results directly as native function calls, and usage data collection can share the agent's auth session without a separate cookie.

**Recommended only if:** The agent already has a scheduling primitive (cron, workflow engine, or an in-process timer), a persistence layer, and a desire to expose quota-awareness to users through native UI.

---

## Portability Map

A file-by-file breakdown of what moves as-is, what needs shims, and what should be rewritten for the target runtime.

### Port as-is (~290 lines, pure functions, no framework dependencies)

These modules have no side effects, no I/O, and no coupling to Next.js, SQLite, or the Claude API. They can be copied verbatim into any TypeScript or JavaScript runtime.

| File | Lines | Role |
|---|---|---|
| `src/lib/usage-window.ts` | 34 | Delta computation across reset boundaries |
| `src/lib/normalize.ts` | 85 | Normalize raw API payloads to canonical window format |
| `src/lib/peak-detector.ts` | 118 | Sliding-window peak detection over hourly delta histogram |
| `src/lib/schedule.ts` | 61 | Generate 5-slot fire schedule anchored to peak midpoint |

### Port with shim (~600 lines, swap I/O adapters)

These modules have the right logic but depend on project-specific I/O (SQLite queries, env-based config, Discord webhooks). The business logic is worth keeping; the adapters need to be swapped for the target's equivalents.

| File | Keep | Swap |
|---|---|---|
| `src/lib/collector.ts` | `computeNextDelay`, `computePollingDelta`, tier state machine | HTTP client (uses native `fetch`; likely fine), SQLite writes → target's persistence |
| `src/lib/scheduler.ts` | `shouldRecomputeSchedule`, `fireTimeToUtcIso`, `recomputeSchedule` | `app_meta` reads/writes → target's config layer; in-process timer → target's scheduler |
| `src/lib/analysis.ts` | Aggregation logic (`buildActivity`, `buildUsageInsights`, `buildExtraUsageInsights`) | Dashboard-assembly tail (Next.js-specific); `getAppMeta` → config adapter |
| `src/lib/config.ts` | Auth resolution logic (bearer/cookie detection) | Env-file reads → target's credential store |
| `src/lib/auth-diagnostics.ts` | Error classification (HTTP 401/403 → actionable message) | No changes needed — pure logic |

### Reference only, rewrite for target

| File | Why not port |
|---|---|
| `src/lib/db.ts` | Schema is portable; `better-sqlite3` query layer is not. Rewrite queries against target's ORM/DB client. |
| `src/lib/sender.ts` | Spawns `claude` CLI as a subprocess. Replace with Agent SDK call (see `examples/agent-sdk-anchor-send.ts`). |
| `src/lib/notifier.ts` | Discord webhook — replace with target's notification channel. |
| `src/lib/backup.ts` | GCS backup — replace with target's backup strategy or drop entirely. |
| `src/app/**`, `src/components/**` | Next.js dashboard — not relevant for agent embedding. |
| `src/lib/collector-singleton.ts` | Next.js process model specific — rewrite for target's singleton pattern. |

---

## Open Questions for Scoping

Before writing a real integration spec, these need answers:

1. **Auth model.** Does the agent currently share the user's Claude Code OAuth token (`CLAUDE_CODE_OAUTH_TOKEN`), or does it manage its own API key? Quota optimization only applies to subscription-auth scenarios.

2. **Persistence.** Does the agent have an existing storage layer (SQLite, Postgres, Redis, in-memory)? The optimizer's schema is simple (two tables, ~10 columns each) and maps easily to any relational store.

3. **Existing quota awareness.** Does the agent currently track or surface usage data to users? If so, there may be a natural merge point with the collector.

4. **Scheduling primitive.** Does the agent have an existing job scheduler (cron, workflow engine, in-process timer)? The optimizer's scheduler is ~150 lines and can be replaced with a wrapper around whatever the agent already uses.

5. **Multi-user vs. single-user.** Is this deployed per-user (each user runs their own instance) or shared-tenant (one deployment serves multiple users)? Peak detection is per-user; a shared deployment needs a user-keyed namespace in the persistence layer.

6. **Desired user surface.** Should quota optimization be invisible infrastructure, or should users be able to see and configure their anchor time? The optimizer has a full dashboard; a lightweight alternative is a single config panel in the agent's existing settings UI.

---

## Why This Project

The algorithm is shipped, tested, and running in production against a real Claude Pro/Max subscription. The four pure-logic modules have an automated test suite with 128 tests. The `/api/optimize` endpoint exposes the recommendation over HTTP, and `examples/agent-sdk-anchor-send.ts` demonstrates the exact Agent SDK integration pattern.

The work required to embed this into an OpenClaw-style agent is bounded and well-defined. Patterns A and B can be delivered without touching the agent's core. Pattern C requires more coordination but produces the tightest UX.
