import type { Config } from "./config";
import { insertSnapshot } from "./db";
import { normalizeUsagePayload } from "./normalize";

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
  pollIntervalMs: number;
}

export class UsageCollector {
  private config: Config;
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling = false;
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
      pollIntervalMs: config.pollIntervalMs,
    };
  }

  getState(): CollectorState {
    return { ...this.state };
  }

  async pollOnce(): Promise<{ status: string; error?: string }> {
    if (!this.config.hasAuth) {
      const msg = "No auth configured. Set CLAUDE_BEARER_TOKEN or CLAUDE_SESSION_COOKIE.";
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
      return { status: "error", error: msg };
    }

    if (this.polling) return { status: "skipped" };

    this.polling = true;
    this.state.isPolling = true;
    this.state.lastAttemptAt = new Date().toISOString();

    try {
      const headers: Record<string, string> = {
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
        "Referer": "https://claude.ai/settings/usage",
        "Origin": "https://claude.ai",
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
          `HTTP ${response.status}: ${(payload ? JSON.stringify(payload) : rawBody).slice(0, 500)}`
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

      this.state.lastSuccessAt = new Date().toISOString();
      this.state.lastError = null;
      this.state.consecutiveFailures = 0;
      return { status: "ok" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
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

      console.warn(`[collector] Poll failed: ${msg}`);
      return { status: "error", error: msg };
    } finally {
      this.polling = false;
      this.state.isPolling = false;
    }
  }

  start() {
    if (this.timer) return;
    console.log(
      `[collector] Starting (interval: ${this.config.pollIntervalMs}ms, auth: ${this.config.authMode})`
    );
    void this.pollOnce();
    this.timer = setInterval(() => void this.pollOnce(), this.config.pollIntervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
