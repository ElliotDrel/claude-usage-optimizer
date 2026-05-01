# Integration Proposal: Quota-Window Optimization for Subscription-Auth Agents

---

## Summary

**The problem**
- Users who run autonomous agents alongside their daily Anthropic product usage share the same quota window across both
- The combined load means rate limits hit more frequently, interrupting both interactive sessions and in-progress agent tasks

**What this optimizer does**
- Detects each user's 4-hour peak block from usage history
- Fires a lightweight anchor send at the peak midpoint, guaranteeing two consecutive 5-hour windows cover that peak
- Already accounts for Anthropic's peak-hour multiplier through delta tracking — no explicit config needed
- Users who trust their quota is being managed delegate more tasks to the agent, increasing adoption naturally

**Integration options**
1. **Response header piggyback (recommended)** — a few lines in the existing Agent SDK message handler; no new auth, no infrastructure, no user-facing changes
2. **Full implementation** — dashboard, customizable schedule, 24/7 session cookie tracking; requires a persistent per-user backend

---

## How it works

The peak detector slides a 4-hour window across a histogram of hourly utilization deltas built from usage history. The window position with the highest cumulative delta becomes the peak block. The anchor send fires at that block's midpoint, resetting the quota window at the exact moment it's needed most. Because the optimizer tracks deltas rather than raw utilization, Anthropic's peak-hour multiplier is baked in automatically: higher multipliers register as larger deltas, so those hours naturally score lower and get scheduled around without any explicit configuration.

The secondary payoff: users who trust their quota is being actively managed delegate more to the agent. Tasks they'd otherwise run manually to conserve their window become automatable, which increases agent utilization on top of the quota gains.

---

## Integration options

### Option 1 — Response header piggyback (recommended)

**Effort:** hours. **Risk:** none. **Requires:** nothing new from the user.

Every `/v1/messages` response already includes the utilization data the optimizer needs:

```
anthropic-ratelimit-unified-5h-utilization:   0.42
anthropic-ratelimit-unified-5h-reset:         1746392400
anthropic-ratelimit-unified-7d-utilization:   0.18
```

Read those headers on each response and forward the values to the optimizer. If utilization didn't change, skip the write. That's the full integration — the optimizer handles peak detection, schedule generation, and anchor sends from there.

**Caveat:** headers are only present during active agent requests. During idle periods the optimizer falls back to its Bearer token poll, capped at once per hour to avoid the [known 1-hour rate limit lockout](https://github.com/anthropics/claude-code/issues/31637).

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

### Option 2 — Full implementation

**Effort:** more. **Requires:** a persistent per-user backend.

This is the complete version: a dedicated backend per user that polls the Claude.ai session cookie every ~5 minutes, giving the peak detector a full 24/7 usage picture rather than just agent-active periods. Users get a dashboard to view their usage history, see their detected peak block, and customize the time their anchor sends fire.

**What this adds over Option 1:**
- Continuous tracking via session cookie covers the user's full day, not just agent sessions
- Dashboard gives users visibility into their quota usage and schedule
- Customizable send times let users override the detected anchor if they want manual control

**The cost:** each user needs a persistent backend with storage. This means provisioning infrastructure per user, managing session cookie refresh (cookies expire periodically and require manual re-entry), and handling health checks at scale. It's a meaningful increase in operational complexity.

### My recommendation

Start with Option 1. It requires no infrastructure changes, no new credentials from the user, and no disruption to existing workflows. The response headers capture enough signal to run peak detection well for any user actively using the agent.

Come back to Option 2 when users are asking for visibility into their usage or want manual control over their schedule. That's the signal the operational overhead is worth it.


---

## Future Optimization A: Smart schedule shifting

The next step is making this explicit: by incorporating the user's detected peak block, the scheduler can place agent tasks in windows that are confirmed off-peak for both user and Anthropic peak hours. This turns a side effect of delta tracking into a deliberate, inspectable constraint.

---

## Future Optimization B: Day-to-day usage pattern optimization

This one is more ambitious. The agent monitors the user's current utilization percentage in real time and, based on the time of day and the user's detected peak hours, delays high-cost tasks until immediately after the next anchor send when quota is freshest. Rather than running a multi-turn research task at 80% utilization mid-peak, the agent queues it for the next fresh window and uses the remaining quota for low-cost work in the meantime.

The user can override this at any time if something is urgent. But in practice, when a user offloads a task to an agent — especially one running in the background — a delay of a few hours rarely matters to them. To their quota, it can make a significant difference.
