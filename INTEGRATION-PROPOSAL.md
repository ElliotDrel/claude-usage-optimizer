# Integration Proposal: Quota-Window Optimization for Subscription-Auth Agents

---

## What this does

Anchoring a lightweight daily send at the midpoint of the user's detected 4-hour peak block guarantees two consecutive 5-hour quota windows span that peak, doubling usable agent-hours per subscription dollar.

There's a second effect worth naming: users who know their quota is being managed are willing to delegate more tasks to the agent. Work they'd previously done manually (to avoid burning their window) becomes automatable. Better quota utilization increases agent adoption.

**Future optimizations:** [Smart schedule shifting](#future-optimization-a-smart-schedule-shifting) · [Agent workflow scheduling](#future-optimization-b-agent-workflow-scheduling)

---

## Integration options

### Option 1 — Response header piggyback (recommended)

**Effort:** hours. **Risk:** none. **Requires:** nothing new from the user.

Every `/v1/messages` response from `api.anthropic.com` already includes rate limit headers:

```
anthropic-ratelimit-unified-5h-utilization:   0.42
anthropic-ratelimit-unified-5h-reset:         1746392400
anthropic-ratelimit-unified-7d-utilization:   0.18
```

The agent already makes these calls. The only change is reading those headers on each response and forwarding the utilization values to the optimizer. If utilization didn't change since the last write, skip it.

This gives per-message usage tracking with no extra API calls, no new auth, and no change to user behavior.

**Caveat:** headers are only present when the agent is making requests. During idle periods the optimizer falls back to its existing Bearer token poll, capped at once per hour to avoid the [known 1-hour rate limit lockout](https://github.com/anthropics/claude-code/issues/31637).

**Implementation sketch:**

```typescript
// After each /v1/messages response:
const util5h = parseFloat(response.headers.get("anthropic-ratelimit-unified-5h-utilization") ?? "0");
const reset5h = response.headers.get("anthropic-ratelimit-unified-5h-reset");

if (util5h !== lastKnownUtilization) {
  await fetch("http://localhost:3017/api/snapshot", {
    method: "POST",
    body: JSON.stringify({ five_hour_utilization: util5h * 100, resets_at: reset5h }),
  });
  lastKnownUtilization = util5h;
}
```

---

### Options 2 and 3 — Per-user sidecar or native embedding

Full optimizer instances per user (Docker sidecar, systemd service, or embedded module) give users a dashboard and tighter scheduling control. The complexity of managing per-user server processes is real, and most users won't ask for it unless they're already hitting limits and want to understand why. Option 1 covers the majority of the value. Options 2 and 3 are worth revisiting if demand appears.

---

## Future Optimization A: Smart schedule shifting

Anthropic's peak hours are publicly documented and apply a multiplier to rate limit consumption — the same workload that costs 30% of a window at 3am may cost 60% at 2pm. The user's peak block is already detected by the optimizer. A smarter scheduler combines both inputs: it places scheduled agent tasks in windows that are off-peak for both the user and Anthropic, ensuring automated work doesn't compete with interactive sessions or inflate its own quota cost. The goal is that the user's peak hours are reserved for the user, and agent tasks run when quota is cheapest.

---

## Future Optimization B: Agent workflow scheduling

If the agent tracks utilization state and estimates the quota cost of planned tasks, it can reorder its work queue to match. High-cost tasks (multi-turn research, large tool call chains) run immediately after an anchor send when quota is freshest. Low-cost tasks (status summaries, single-turn lookups) run in late-window or off-peak slots. Time-sensitive tasks always run immediately regardless of window state.

The optimizer's `/api/optimize` response already exposes the full fire schedule and next anchor time. The agent needs to decide, before starting a task, whether to proceed or queue it for a better window. This is where the optimizer graduates from a standalone tool to a scheduling primitive inside the agent runtime.
