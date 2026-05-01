/**
 * agent-sdk-anchor-send.ts
 *
 * Demonstrates how an OpenClaw-style agent (or any product running on a
 * Claude Pro/Max subscription) can integrate with the Claude Usage Optimizer
 * to fire anchor sends at the detected optimal time.
 *
 * This file replaces the existing `src/lib/sender.ts` pattern (which spawns
 * the `claude` CLI as a subprocess) with the `@anthropic-ai/claude-agent-sdk`
 * programmatic API — the integration point for products that already use the
 * Agent SDK internally.
 *
 * ---
 * USAGE
 *   npx tsx examples/agent-sdk-anchor-send.ts
 *   npx tsx examples/agent-sdk-anchor-send.ts --dry-run   # print plan, no send
 *   npx tsx examples/agent-sdk-anchor-send.ts --now       # fire immediately
 *
 * PREREQUISITES
 *   npm install @anthropic-ai/claude-agent-sdk   # not bundled in prod deps
 *   Set one of:
 *     CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat-...     # for Pro/Max subscription auth
 *     ANTHROPIC_API_KEY=sk-ant-...               # for API-key auth
 *
 * IMPORTANT — quota windows apply to subscription auth only.
 * The optimizer's anchor-timing strategy only has effect if you're on a
 * Claude Pro/Max subscription and authenticating via CLAUDE_CODE_OAUTH_TOKEN.
 * API-key users (pay-per-token) are not subject to the 5-hour quota window.
 *
 * INTEGRATION NOTES
 *   - For sidecar integration: run this script alongside your agent; it reads
 *     the optimizer's /api/optimize endpoint to get the current anchor time.
 *   - For native integration: pull the pure-function core (peak-detector.ts,
 *     schedule.ts) directly into your agent's runtime and call generateSchedule()
 *     without the HTTP round-trip.
 *   - See INTEGRATION-PROPOSAL.md for the three integration patterns ranked by
 *     effort and their trade-offs.
 */

import { query } from "@anthropic-ai/claude-agent-sdk";

// ── Configuration ─────────────────────────────────────────────────────────────

const OPTIMIZER_BASE_URL = process.env.OPTIMIZER_URL ?? "http://localhost:3017";
const DRY_RUN = process.argv.includes("--dry-run");
const FIRE_NOW = process.argv.includes("--now");

// The anchor send prompt. Keep it lightweight — the goal is to touch the quota
// window, not to do real work. One-sentence answers cost almost no tokens.
const ANCHOR_PROMPT =
  "What are 3 key principles for writing clean code? Answer in exactly one sentence.";

// ── Optimizer API ─────────────────────────────────────────────────────────────

interface OptimizeResponse {
  peakBlock: { startHour: number; endHour: number; sumDelta: number; midpoint: number } | null;
  anchorTimeLocal: string; // "HH:MM" in user's local timezone
  anchorTimeUtc: string;   // ISO 8601 next occurrence in UTC
  fireSchedule: Array<{ hour: number; minute: number; isAnchor: boolean; jitterMinutes: number }>;
  timezone: string;
  computedAt: string;
}

async function fetchOptimalAnchorTime(): Promise<OptimizeResponse> {
  const url = `${OPTIMIZER_BASE_URL}/api/optimize`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`GET ${url} returned ${response.status}: ${await response.text()}`);
  }
  return response.json() as Promise<OptimizeResponse>;
}

// ── Anchor send via Agent SDK ─────────────────────────────────────────────────

async function fireAnchorSend(scheduledFor: string): Promise<string | null> {
  console.log(`[anchor-send] Firing at ${new Date().toISOString()} (scheduled: ${scheduledFor})`);
  console.log(`[anchor-send] Prompt: "${ANCHOR_PROMPT}"`);

  let responseText: string | null = null;

  // The Agent SDK streams messages as an async iterable. Each iteration may
  // yield system messages, assistant turns, tool calls, or a final result.
  // For a simple anchor send we only care about the final result message.
  //
  // Auth: the SDK reads CLAUDE_CODE_OAUTH_TOKEN (subscription) or
  // ANTHROPIC_API_KEY (API key) automatically from the environment.
  for await (const message of query({
    prompt: ANCHOR_PROMPT,
    options: {
      maxTurns: 1,    // anchor sends don't need multi-turn tool use
      model: "claude-haiku-4-5-20251001", // smallest model — minimal quota cost
    },
  })) {
    if (message.type === "result") {
      // The result message carries the final assistant response
      const content = (message as unknown as { result?: string }).result;
      if (content) {
        responseText = content.slice(0, 500); // cap at 500 chars for logging
        console.log(`[anchor-send] Response: ${responseText}`);
      }
    }
  }

  return responseText;
}

// ── Wait until anchor time ────────────────────────────────────────────────────

function msUntil(isoTimestamp: string): number {
  return new Date(isoTimestamp).getTime() - Date.now();
}

async function waitUntil(isoTimestamp: string): Promise<void> {
  const ms = msUntil(isoTimestamp);
  if (ms <= 0) return;
  const minutes = Math.round(ms / 60_000);
  console.log(`[anchor-send] Waiting ${minutes} min until anchor time (${isoTimestamp})`);
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("[anchor-send] Fetching optimal anchor time from optimizer...");
  const plan = await fetchOptimalAnchorTime();

  const anchorUtc = plan.anchorTimeUtc;
  const minsUntilAnchor = Math.round(msUntil(anchorUtc) / 60_000);

  console.log(`[anchor-send] Optimizer report:`);
  console.log(`  Timezone:       ${plan.timezone}`);
  console.log(`  Anchor (local): ${plan.anchorTimeLocal}`);
  console.log(`  Anchor (UTC):   ${anchorUtc}`);
  console.log(`  Minutes until:  ${minsUntilAnchor}`);
  if (plan.peakBlock) {
    console.log(`  Peak block:     ${plan.peakBlock.startHour}:00–${plan.peakBlock.endHour}:00 local`);
  } else {
    console.log(`  Peak block:     (not yet detected — need ≥3 days of data)`);
  }

  if (DRY_RUN) {
    console.log("[anchor-send] --dry-run: exiting without sending.");
    return;
  }

  if (!FIRE_NOW) {
    await waitUntil(anchorUtc);
  }

  const response = await fireAnchorSend(anchorUtc);

  // In a full integration, log to your product's persistence layer here.
  // The optimizer's own send_log is available via insertSendLog() from
  // src/lib/db.ts if you're running this in the same process as the optimizer.
  console.log(`[anchor-send] Done. Response captured: ${response ? "yes" : "no"}`);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[anchor-send] Fatal: ${msg}`);
  process.exit(1);
});
