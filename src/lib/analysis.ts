import type { SnapshotRow } from "./db";
import type { CollectorState } from "./collector";
import { computeUsageDelta } from "./usage-window";

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
}

export interface DashboardData {
  generatedAt: string;
  health: {
    totalSnapshots: number;
    successCount: number;
    errorCount: number;
    lastSnapshot: SnapshotRow | null;
    lastSuccess: SnapshotRow | null;
    recentErrors: SnapshotRow[];
  };
  current: {
    timestamp: string;
    fiveHour: { utilization: number; resetsAt: string } | null;
    sevenDay: { utilization: number; resetsAt: string } | null;
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
  runtime: CollectorState;
  storage: { path: string; sizeBytes: number; totalSnapshots: number };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function safeParseJson(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/**
 * Compute the usage delta between two snapshots for a given window.
 * Uses resets_at to detect window boundaries:
 * - Same window: delta = current - previous
 * - Window reset: delta = current (it reset to 0, then grew to this)
 * - Null utilization: delta = 0
 */
function computeDelta(
  prev: SnapshotRow,
  curr: SnapshotRow,
  windowKey: "five_hour" | "seven_day"
): number {
  return computeUsageDelta(
    prev[`${windowKey}_utilization`],
    curr[`${windowKey}_utilization`],
    prev[`${windowKey}_resets_at`],
    curr[`${windowKey}_resets_at`]
  );
}

function buildActivity(snapshots: SnapshotRow[]) {
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
    if (newUsage <= 0) continue;

    const ts = new Date(curr.timestamp);
    const dayIndex = ts.getDay();
    const hour = ts.getHours();

    hourlyBars[hour].totalDelta += newUsage;
    hourlyBars[hour].sampleCount++;

    const cell = heatmap[dayIndex * 24 + hour];
    cell.totalDelta += newUsage;
    cell.sampleCount++;
  }

  return {
    hourlyBars: hourlyBars.map((b) => ({ ...b, totalDelta: round2(b.totalDelta) })),
    heatmap: heatmap.map((c) => ({ ...c, totalDelta: round2(c.totalDelta) })),
  };
}

function buildUsageInsights(snapshots: SnapshotRow[]) {
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

    // Check 5H first so a larger 7D change in the same snapshot can overwrite it.
    recordEvent(delta5h, "5H");
    recordEvent(delta7d, "7D");
  }

  const finalizedLargestDelta = largestDelta as {
    delta: number;
    at: string;
    window: "5H" | "7D";
  } | null;

  let roundedLargestDelta: { delta: number; at: string; window: "5H" | "7D" } | null = null;
  if (finalizedLargestDelta) {
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

export function buildDashboardData(
  snapshots: SnapshotRow[],
  storageMeta: { path: string; sizeBytes: number; totalSnapshots: number },
  runtime: CollectorState
): DashboardData {
  const successSnapshots = snapshots.filter((s) => s.status === "ok");
  const errorSnapshots = snapshots.filter((s) => s.status === "error");
  const lastSnapshot = snapshots.at(-1) ?? null;
  const lastSuccess = successSnapshots.at(-1) ?? null;

  let current: DashboardData["current"] = null;
  if (lastSuccess) {
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
      rawJson: safeParseJson(lastSuccess.raw_json),
    };
  }

  const timeline: TimelinePoint[] = successSnapshots.map((s) => ({
    timestamp: s.timestamp,
    fiveHourUtilization: s.five_hour_utilization,
    sevenDayUtilization: s.seven_day_utilization,
  }));

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
    runtime,
    storage: storageMeta,
  };
}
