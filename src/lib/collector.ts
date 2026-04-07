import type { Config } from "./config";
import { explainAuthFailure, getAuthPreflightError } from "./auth-diagnostics";
import { insertSnapshot } from "./db";
import { normalizeUsagePayload } from "./normalize";
import { computeUsageDelta } from "./usage-window";

// --- Tier types and constants ---

export type Tier = "idle" | "light" | "active" | "burst";

export interface TierState {
  currentTier: Tier;
  consecutiveNoChange: number;
  consecutiveFailures?: number;
}

export interface PollResult {
  delta: number;
  success: boolean;
  consecutiveFailures?: number;
}

const TIER_DELAYS: Record<Tier, number> = {
  idle: 5 * 60_000, // 5 min
  light: 2.5 * 60_000, // 2.5 min
  active: 1 * 60_000, // 1 min
  burst: 30_000, // 30 sec
};

const TIER_DOWN: Record<Tier, Tier | null> = {
  idle: null,
  light: "idle",
  active: "light",
  burst: "active",
};

const ERROR_BACKOFF = [60_000, 120_000, 300_000, 600_000]; // 1m, 2m, 5m, 10m

// --- Pure function ---

export function computeNextDelay(
  state: TierState,
  result: PollResult
): TierState & { delayMs: number } {
  // Handle failure
  if (!result.success) {
    const failures = result.consecutiveFailures ?? 1;
    const idx = Math.min(failures - 1, ERROR_BACKOFF.length - 1);
    return {
      currentTier: state.currentTier,
      consecutiveNoChange: state.consecutiveNoChange,
      consecutiveFailures: failures,
      delayMs: ERROR_BACKOFF[idx],
    };
  }

  // Success - reset failures
  const delta = result.delta;
  let tier: Tier = state.currentTier;
  let noChange = state.consecutiveNoChange;

  if (tier === "burst") {
    // Stay in burst while usage is still changing; only cool down on no change.
    if (delta === 0) {
      noChange++;
      if (noChange >= 3) {
        tier = "active";
        noChange = 0;
      }
    } else {
      noChange = 0; // Any positive delta keeps burst active
    }
  } else if (delta > 0) {
    // Any detected usage jumps straight to burst so we capture short spikes.
    noChange = 0;
    tier = "burst";
  } else {
    // No change at non-burst tier
    noChange++;
    if (noChange >= 3) {
      const down = TIER_DOWN[tier];
      if (down) {
        tier = down;
      }
      noChange = 0;
    }
  }

  return {
    currentTier: tier,
    consecutiveNoChange: noChange,
    consecutiveFailures: 0,
    delayMs: TIER_DELAYS[tier],
  };
}

export function computePollingDelta(
  hasBaseline: boolean,
  prevUtil: number | null,
  currUtil: number | null,
  prevResetAt: string | null,
  currResetAt: string | null
): number {
  // Seed the in-memory baseline on first success without treating it as new usage.
  if (!hasBaseline) {
    return 0;
  }

  return computeUsageDelta(prevUtil, currUtil, prevResetAt, currResetAt);
}

// --- CollectorState ---

export interface CollectorState {
  startedAt: string;
  isConfigured: boolean;
  isPolling: boolean;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  endpoint: string;
  authMode: string;
  currentTier: Tier;
  nextPollAt: string | null;
  consecutiveNoChange: number;
}

// --- UsageCollector class ---

export class UsageCollector {
  private config: Config;
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private polling = false;
  private hasFiveHourBaseline = false;
  private lastFiveHourUtil: number | null = null;
  private lastFiveHourResetsAt: string | null = null;
  private tierState: TierState = {
    currentTier: "idle",
    consecutiveNoChange: 0,
    consecutiveFailures: 0,
  };
  private state: CollectorState;

  constructor(config: Config) {
    this.config = config;
    this.state = {
      startedAt: new Date().toISOString(),
      isConfigured: config.hasAuth,
      isPolling: false,
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastError: null,
      consecutiveFailures: 0,
      endpoint: config.endpoint,
      authMode: config.authMode,
      currentTier: "idle",
      nextPollAt: null,
      consecutiveNoChange: 0,
    };
  }

  getState(): CollectorState {
    return { ...this.state };
  }

  private scheduleNext(delayMs: number) {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
    this.state.nextPollAt = new Date(Date.now() + delayMs).toISOString();
    this.timeout = setTimeout(() => void this.pollOnce(), delayMs);
  }

  reschedule() {
    const delayMs = TIER_DELAYS[this.tierState.currentTier];
    this.scheduleNext(delayMs);
  }

  async pollOnce(): Promise<{ status: string; error?: string }> {
    if (this.config.demoMode) {
      return this.pollDemo();
    }

    if (!this.config.hasAuth) {
      const msg =
        "No auth configured. Set CLAUDE_BEARER_TOKEN or CLAUDE_SESSION_COOKIE.";
      this.state.lastAttemptAt = new Date().toISOString();
      this.state.lastError = msg;
      this.state.consecutiveFailures++;
      insertSnapshot(this.config, {
        timestamp: new Date().toISOString(),
        status: "error",
        endpoint: this.config.endpoint,
        authMode: this.config.authMode,
        responseStatus: 0,
        fiveHourUtilization: null,
        fiveHourResetsAt: null,
        sevenDayUtilization: null,
        sevenDayResetsAt: null,
        rawJson: null,
        errorMessage: msg,
      });
      // No auth: schedule next in 10 minutes
      this.scheduleNext(10 * 60_000);
      return { status: "error", error: msg };
    }

    if (this.polling) return { status: "skipped" };

    this.polling = true;
    this.state.isPolling = true;
    this.state.lastAttemptAt = new Date().toISOString();

    try {
      const preflightError = getAuthPreflightError(this.config);
      if (preflightError) {
        throw new Error(preflightError);
      }

      const headers: Record<string, string> = {
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
        Referer: "https://claude.ai/settings/usage",
        Origin: "https://claude.ai",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Ch-Ua-Platform": '"Windows"',
      };

      if (this.config.authMode === "bearer") {
        headers.Authorization = `Bearer ${this.config.bearerToken}`;
        headers["anthropic-beta"] = "oauth-2025-04-20";
      } else if (this.config.authMode === "cookie") {
        headers.Cookie = this.config.sessionCookie;
      }

      const response = await fetch(this.config.endpoint, { headers });
      const rawBody = await response.text();

      let payload: Record<string, unknown> | null = null;
      try {
        payload = rawBody ? JSON.parse(rawBody) : null;
      } catch {
        payload = null;
      }

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}: ${(
            payload ? JSON.stringify(payload) : rawBody
          ).slice(0, 500)}`
        );
      }

      if (!payload) {
        throw new Error(`HTTP ${response.status} with non-JSON body`);
      }

      const normalized = normalizeUsagePayload(payload);
      const fiveHour = normalized.windows.find((w) => w.key === "five_hour");
      const sevenDay = normalized.windows.find((w) => w.key === "seven_day");

      insertSnapshot(this.config, {
        timestamp: new Date().toISOString(),
        status: "ok",
        endpoint: this.config.endpoint,
        authMode: this.config.authMode,
        responseStatus: response.status,
        fiveHourUtilization: fiveHour?.utilization ?? null,
        fiveHourResetsAt: fiveHour?.resetsAt ?? null,
        sevenDayUtilization: sevenDay?.utilization ?? null,
        sevenDayResetsAt: sevenDay?.resetsAt ?? null,
        rawJson: JSON.stringify(payload),
        errorMessage: null,
      });

      // Compute delta using normalized hour-aligned reset boundaries.
      const currentUtil = fiveHour?.utilization ?? null;
      const currentResetsAt = fiveHour?.resetsAt ?? null;
      const delta = computePollingDelta(
        this.hasFiveHourBaseline,
        this.lastFiveHourUtil,
        currentUtil,
        this.lastFiveHourResetsAt,
        currentResetsAt
      );
      this.hasFiveHourBaseline = true;
      this.lastFiveHourUtil = currentUtil;
      this.lastFiveHourResetsAt = currentResetsAt;

      // Update tier
      this.state.consecutiveFailures = 0;
      const nextTier = computeNextDelay(this.tierState, {
        delta,
        success: true,
      });
      this.tierState = {
        currentTier: nextTier.currentTier,
        consecutiveNoChange: nextTier.consecutiveNoChange,
        consecutiveFailures: 0,
      };
      this.state.currentTier = nextTier.currentTier;
      this.state.consecutiveNoChange = nextTier.consecutiveNoChange;
      this.state.lastSuccessAt = new Date().toISOString();
      this.state.lastError = null;

      this.scheduleNext(nextTier.delayMs);

      return { status: "ok" };
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : String(err);
      const msg = explainAuthFailure(this.config, rawMsg);
      this.state.lastError = msg;
      this.state.consecutiveFailures++;

      insertSnapshot(this.config, {
        timestamp: new Date().toISOString(),
        status: "error",
        endpoint: this.config.endpoint,
        authMode: this.config.authMode,
        responseStatus: 0,
        fiveHourUtilization: null,
        fiveHourResetsAt: null,
        sevenDayUtilization: null,
        sevenDayResetsAt: null,
        rawJson: null,
        errorMessage: msg,
      });

      // Update tier with failure
      const nextTier = computeNextDelay(this.tierState, {
        delta: 0,
        success: false,
        consecutiveFailures: this.state.consecutiveFailures,
      });
      this.tierState = {
        currentTier: nextTier.currentTier,
        consecutiveNoChange: nextTier.consecutiveNoChange,
        consecutiveFailures: nextTier.consecutiveFailures,
      };

      this.scheduleNext(nextTier.delayMs);

      console.warn(`[collector] Poll failed: ${msg}`);
      return { status: "error", error: msg };
    } finally {
      this.polling = false;
      this.state.isPolling = false;
    }
  }

  private async pollDemo(): Promise<{ status: string }> {
    // Generate fake usage data that varies over time
    const now = new Date();
    const hour = now.getHours();
    // Simulate usage that fluctuates: higher during work hours
    const base = hour >= 9 && hour <= 17 ? 0.4 : 0.15;
    const jitter = Math.random() * 0.25;
    const fiveHourUtil = Math.min(base + jitter, 1);
    const sevenDayUtil = Math.min(0.2 + Math.random() * 0.3, 1);

    const fiveHourResets = new Date(
      now.getTime() + (5 - (hour % 5)) * 3600_000
    ).toISOString();
    const sevenDayResets = new Date(
      now.getTime() + 3 * 86400_000
    ).toISOString();

    insertSnapshot(this.config, {
      timestamp: now.toISOString(),
      status: "ok",
      endpoint: "demo",
      authMode: "demo",
      responseStatus: 200,
      fiveHourUtilization: fiveHourUtil,
      fiveHourResetsAt: fiveHourResets,
      sevenDayUtilization: sevenDayUtil,
      sevenDayResetsAt: sevenDayResets,
      rawJson: JSON.stringify({ demo: true }),
      errorMessage: null,
    });

    this.state.lastAttemptAt = now.toISOString();
    this.state.lastSuccessAt = now.toISOString();
    this.state.lastError = null;
    this.state.consecutiveFailures = 0;
    this.state.currentTier = "idle";

    // Poll every 60s in demo mode (just to keep UI refreshing)
    this.scheduleNext(60_000);

    console.log(
      `[collector] Demo poll: 5h=${(fiveHourUtil * 100).toFixed(1)}%, 7d=${(sevenDayUtil * 100).toFixed(1)}%`
    );
    return { status: "ok" };
  }

  start() {
    if (this.timeout) return;
    console.log(
      `[collector] Starting (tier: ${this.tierState.currentTier}, auth: ${this.config.authMode}${this.config.demoMode ? ", DEMO MODE" : ""})`
    );
    void this.pollOnce();
  }

  stop() {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
      this.state.nextPollAt = null;
    }
  }
}
