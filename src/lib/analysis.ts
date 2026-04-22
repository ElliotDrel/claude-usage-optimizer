import type { CollectorState } from "./collector";
import { computeUsageDelta } from "./usage-window";
import { type ParsedSnapshot } from "./queries";
import type { FireTime } from "./schedule";
import type { SendLogRow } from "./db";
import { getAppMeta, querySendLog } from "./db";
import { getConfig } from "./config";

export interface HourlyBar {
  hour: number;
  totalDelta: number;
  sampleCount: number;
}

export interface HeatmapCell {
  dayIndex: number;
  hour: number;
  totalDelta: number;
  sampleCount: number;
}

export interface TimelinePoint {
  timestamp: string;
  fiveHourUtilization: number | null;
  sevenDayUtilization: number | null;
  extraUsageUsedCredits: number | null;
  extraUsageBalance: number | null;
}

export interface ExtraUsageSnapshot {
  isEnabled: boolean;
  monthlyLimit: number | null;
  usedCredits: number | null;
  balance: number | null;
  utilization: number | null;
}

export interface ExtraUsageEvent {
  amount: number;
  at: string;
}

export interface ExtraUsageInsights {
  currentBalance: number | null;
  totalBudget: number | null;
  totalSpent: number | null;
  topUpCount: number;
  spendEventCount: number;
  totalTopUps: number;
  trackedSpend: number;
  lastTopUpAt: string | null;
  lastSpendAt: string | null;
  largestTopUp: ExtraUsageEvent | null;
  largestSpend: ExtraUsageEvent | null;
}

export interface ScheduleData {
  peakBlock: {
    startHour: number;
    endHour: number;
    midpoint: number;
    sumDelta: number;
  } | null;
  scheduleFires: FireTime[];
  tomorrowFires: FireTime[];
  scheduleGeneratedAt: string | null;
  isPaused: boolean;
  overrideStartTime: string | null;
  peakWindowHours: string | null;
  anchorOffsetMinutes: string | null;
  defaultSeedTime: string | null;
  userTimezone: string | null;
}

export interface SendLogEntry {
  id: number;
  firedAt: string;
  scheduledFor: string | null;
  status: "ok" | "error" | "timeout";
  durationMs: number | null;
  question: string | null;
  responseExcerpt: string | null;
}

export interface DashboardData {
  generatedAt: string;
  health: {
    totalSnapshots: number;
    successCount: number;
    errorCount: number;
    lastSnapshot: ParsedSnapshot | null;
    lastSuccess: ParsedSnapshot | null;
    recentErrors: ParsedSnapshot[];
  };
  current: {
    timestamp: string;
    fiveHour: { utilization: number; resetsAt: string } | null;
    sevenDay: { utilization: number; resetsAt: string } | null;
    extraUsage: ExtraUsageSnapshot | null;
    rawJson: Record<string, unknown> | null;
  } | null;
  timeline: TimelinePoint[];
  activity: {
    hourlyBars: HourlyBar[];
    heatmap: HeatmapCell[];
  };
  usageInsights: {
    lastUsageAt: string | null;
    lastUsageWindow: "5H" | "7D" | null;
    largestDelta: {
      delta: number;
      at: string;
      window: "5H" | "7D";
    } | null;
  };
  extraUsageInsights: ExtraUsageInsights;
  runtime: CollectorState;
  storage: { path: string; sizeBytes: number; totalSnapshots: number };
  scheduleData: ScheduleData;
  sendHistory: SendLogEntry[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function computeBalance(limit: number | null, used: number | null): number | null {
  if (limit == null || used == null) return null;
  return round2(Math.max(0, limit - used));
}

function computeExtraUsageSpendDelta(
  prevUsed: number | null,
  currUsed: number | null
): number {
  if (currUsed == null || prevUsed == null) return 0;
  if (currUsed < prevUsed) {
    return currUsed;
  }
  return Math.max(0, currUsed - prevUsed);
}

function safeParseJson(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function computeDelta(
  prev: ParsedSnapshot,
  curr: ParsedSnapshot,
  windowKey: "five_hour" | "seven_day"
): number {
  const prevUtil = windowKey === "five_hour" ? prev.five_hour_utilization : prev.seven_day_utilization;
  const currUtil = windowKey === "five_hour" ? curr.five_hour_utilization : curr.seven_day_utilization;
  const prevReset = windowKey === "five_hour" ? prev.five_hour_resets_at : prev.seven_day_resets_at;
  const currReset = windowKey === "five_hour" ? curr.five_hour_resets_at : curr.seven_day_resets_at;
  return computeUsageDelta(prevUtil, currUtil, prevReset, currReset);
}

function buildActivity(snapshots: ParsedSnapshot[]) {
  const hourlyBars: HourlyBar[] = Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    totalDelta: 0,
    sampleCount: 0,
  }));

  const heatmap: HeatmapCell[] = [];
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      heatmap.push({ dayIndex: d, hour: h, totalDelta: 0, sampleCount: 0 });
    }
  }

  const okSnapshots = snapshots.filter((s) => s.status === "ok");

  for (let i = 1; i < okSnapshots.length; i++) {
    const prev = okSnapshots[i - 1];
    const curr = okSnapshots[i];

    const newUsage = computeDelta(prev, curr, "five_hour");
    const creditDelta = computeExtraUsageSpendDelta(
      prev.extra_usage_used_credits,
      curr.extra_usage_used_credits
    );
    const totalActivity = newUsage + creditDelta;
    if (totalActivity <= 0) continue;

    const ts = new Date(curr.timestamp);
    const dayIndex = ts.getDay();
    const hour = ts.getHours();

    hourlyBars[hour].totalDelta += totalActivity;
    hourlyBars[hour].sampleCount++;

    const cell = heatmap[dayIndex * 24 + hour];
    cell.totalDelta += totalActivity;
    cell.sampleCount++;
  }

  return {
    hourlyBars: hourlyBars.map((b) => ({ ...b, totalDelta: round2(b.totalDelta) })),
    heatmap: heatmap.map((c) => ({ ...c, totalDelta: round2(c.totalDelta) })),
  };
}

function buildUsageInsights(snapshots: ParsedSnapshot[]) {
  const okSnapshots = snapshots.filter((s) => s.status === "ok");

  let lastUsageAt: string | null = null;
  let lastUsageWindow: "5H" | "7D" | null = null;
  let largestDelta: { delta: number; at: string; window: "5H" | "7D" } | null = null;

  for (let i = 1; i < okSnapshots.length; i++) {
    const prev = okSnapshots[i - 1];
    const curr = okSnapshots[i];

    const delta5h = computeDelta(prev, curr, "five_hour");
    const delta7d = computeDelta(prev, curr, "seven_day");

    const recordEvent = (delta: number, window: "5H" | "7D") => {
      if (delta <= 0) return;

      lastUsageAt = curr.timestamp;
      lastUsageWindow = window;

      if (!largestDelta || delta > largestDelta.delta) {
        largestDelta = {
          delta,
          at: curr.timestamp,
          window,
        };
      }
    };

    recordEvent(delta5h, "5H");
    recordEvent(delta7d, "7D");
  }

  let roundedLargestDelta: {
    delta: number;
    at: string;
    window: "5H" | "7D";
  } | null = null;

  if (largestDelta) {
    const finalizedLargestDelta = largestDelta as {
      delta: number;
      at: string;
      window: "5H" | "7D";
    };
    roundedLargestDelta = {
      delta: round2(finalizedLargestDelta.delta),
      at: finalizedLargestDelta.at,
      window: finalizedLargestDelta.window,
    };
  }

  return {
    lastUsageAt,
    lastUsageWindow,
    largestDelta: roundedLargestDelta,
  };
}

function shiftFireTimesTomorrow(today: FireTime[]): FireTime[] {
  return today.map((ft) => ({
    ...ft,
    hour: (ft.hour + 24) % 24,
  }));
}

function buildExtraUsageInsights(snapshots: ParsedSnapshot[]): ExtraUsageInsights {
  const okSnapshots = snapshots.filter((s) => s.status === "ok");
  const lastSuccess = okSnapshots.at(-1) ?? null;

  let topUpCount = 0;
  let spendEventCount = 0;
  let totalTopUps = 0;
  let trackedSpend = 0;
  let lastTopUpAt: string | null = null;
  let lastSpendAt: string | null = null;
  let largestTopUp: ExtraUsageEvent | null = null;
  let largestSpend: ExtraUsageEvent | null = null;

  for (let i = 1; i < okSnapshots.length; i++) {
    const prev = okSnapshots[i - 1];
    const curr = okSnapshots[i];

    const budgetDelta =
      prev.extra_usage_monthly_limit != null && curr.extra_usage_monthly_limit != null
        ? curr.extra_usage_monthly_limit - prev.extra_usage_monthly_limit
        : 0;
    const spendDelta = computeExtraUsageSpendDelta(
      prev.extra_usage_used_credits,
      curr.extra_usage_used_credits
    );

    if (budgetDelta > 0) {
      const amount = round2(budgetDelta);
      topUpCount++;
      totalTopUps += amount;
      lastTopUpAt = curr.timestamp;
      if (!largestTopUp || amount > largestTopUp.amount) {
        largestTopUp = { amount, at: curr.timestamp };
      }
    }

    if (spendDelta > 0) {
      const amount = round2(spendDelta);
      spendEventCount++;
      trackedSpend += amount;
      lastSpendAt = curr.timestamp;
      if (!largestSpend || amount > largestSpend.amount) {
        largestSpend = { amount, at: curr.timestamp };
      }
    }
  }

  const totalBudget = lastSuccess?.extra_usage_monthly_limit ?? null;
  const totalSpent = lastSuccess?.extra_usage_used_credits ?? null;

  return {
    currentBalance: computeBalance(totalBudget, totalSpent),
    totalBudget,
    totalSpent,
    topUpCount,
    spendEventCount,
    totalTopUps: round2(totalTopUps),
    trackedSpend: round2(trackedSpend),
    lastTopUpAt,
    lastSpendAt,
    largestTopUp,
    largestSpend,
  };
}

export function buildDashboardData(
  snapshots: ParsedSnapshot[],
  storageMeta: { path: string; sizeBytes: number; totalSnapshots: number },
  runtime: CollectorState
): DashboardData {
  const successSnapshots = snapshots.filter((s) => s.status === "ok");
  const errorSnapshots = snapshots.filter((s) => s.status === "error");
  const lastSnapshot = snapshots.at(-1) ?? null;
  const lastSuccess = successSnapshots.at(-1) ?? null;

  let current: DashboardData["current"] = null;
  if (lastSuccess) {
    const monthlyLimit = lastSuccess.extra_usage_monthly_limit;
    const usedCredits = lastSuccess.extra_usage_used_credits;

    current = {
      timestamp: lastSuccess.timestamp,
      fiveHour:
        lastSuccess.five_hour_utilization != null
          ? {
              utilization: lastSuccess.five_hour_utilization,
              resetsAt: lastSuccess.five_hour_resets_at!,
            }
          : null,
      sevenDay:
        lastSuccess.seven_day_utilization != null
          ? {
              utilization: lastSuccess.seven_day_utilization,
              resetsAt: lastSuccess.seven_day_resets_at!,
            }
          : null,
      extraUsage:
        lastSuccess.extra_usage_enabled != null
          ? {
              isEnabled: lastSuccess.extra_usage_enabled === true,
              monthlyLimit,
              usedCredits,
              balance: computeBalance(monthlyLimit, usedCredits),
              utilization: lastSuccess.extra_usage_utilization,
            }
          : null,
      rawJson: safeParseJson(lastSuccess.raw_json),
    };
  }

  const timeline: TimelinePoint[] = successSnapshots.map((s) => {
    const monthlyLimit = s.extra_usage_monthly_limit;
    const usedCredits = s.extra_usage_used_credits;

    return {
      timestamp: s.timestamp,
      fiveHourUtilization: s.five_hour_utilization,
      sevenDayUtilization: s.seven_day_utilization,
      extraUsageUsedCredits: usedCredits,
      extraUsageBalance: computeBalance(monthlyLimit, usedCredits),
    };
  });

  // Build schedule data from app_meta
  const config = getConfig();
  const meta = getAppMeta(config);
  const peakBlockJson = meta.get("peak_block");
  const peakBlock = peakBlockJson
    ? (() => {
        try {
          return JSON.parse(peakBlockJson) as {
            startHour: number;
            endHour: number;
            midpoint: number;
            sumDelta: number;
          } | null;
        } catch {
          return null;
        }
      })()
    : null;

  const scheduleFires = (() => {
    const scheduleFiresJson = meta.get("schedule_fires");
    if (!scheduleFiresJson) return [];
    try {
      return JSON.parse(scheduleFiresJson) as FireTime[];
    } catch {
      return [];
    }
  })();

  const tomorrowFires = shiftFireTimesTomorrow(scheduleFires);

  const scheduleGeneratedAt = meta.get("schedule_generated_at") || null;
  const isPaused = meta.get("paused") === "true";

  // Extract override fields from app_meta
  const overrideStartTime = meta.get("schedule_override_start_time") ?? null;
  const peakWindowHours = meta.get("peak_window_hours") ?? null;
  const anchorOffsetMinutes = meta.get("anchor_offset_minutes") ?? null;
  const defaultSeedTime = meta.get("default_seed_time") ?? null;
  const userTimezone = meta.get("user_timezone") ?? null;

  // Build send history from send_log
  const sendLogRows = querySendLog(config, { limit: 20, orderDesc: true });
  const sendHistory = sendLogRows
    .reverse() // reverse to get oldest first for frontend
    .map(
      (row): SendLogEntry => ({
        id: row.id,
        firedAt: row.fired_at,
        scheduledFor: row.scheduled_for,
        status: (row.status === "ok" ? "ok" : row.status === "error" ? "error" : "timeout") as
          | "ok"
          | "error"
          | "timeout",
        durationMs: row.duration_ms,
        question: row.question,
        responseExcerpt: row.response_excerpt,
      })
    );

  return {
    generatedAt: new Date().toISOString(),
    health: {
      totalSnapshots: snapshots.length,
      successCount: successSnapshots.length,
      errorCount: errorSnapshots.length,
      lastSnapshot,
      lastSuccess,
      recentErrors: errorSnapshots.slice(-10).reverse(),
    },
    current,
    timeline,
    activity: buildActivity(snapshots),
    usageInsights: buildUsageInsights(snapshots),
    extraUsageInsights: buildExtraUsageInsights(snapshots),
    runtime,
    storage: storageMeta,
    scheduleData: {
      peakBlock,
      scheduleFires,
      tomorrowFires,
      scheduleGeneratedAt,
      isPaused,
      overrideStartTime,
      peakWindowHours,
      anchorOffsetMinutes,
      defaultSeedTime,
      userTimezone,
    },
    sendHistory,
  };
}
