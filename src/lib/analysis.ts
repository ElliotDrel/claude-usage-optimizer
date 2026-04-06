import type { SnapshotRow } from "./db";
import type { CollectorState } from "./collector";

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
  runtime: CollectorState;
  storage: { path: string; sizeBytes: number; totalSnapshots: number };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Estimate actual new usage per interval by compensating for sliding window dropoff.
 *
 * The 5-hour utilization is a rolling window:
 *   U_now = U_prev - dropoff + new_usage
 *
 * So: new_usage = (U_now - U_prev) + dropoff
 *
 * We estimate dropoff by looking at what the utilization was ~5 hours ago
 * vs ~5h + one poll interval ago. The delta between those two snapshots
 * approximates what just fell off the trailing edge of the window.
 *
 * If we don't have data from 5h ago yet, we fall back to positive-delta only.
 */
const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;

function findClosestSnapshot(
  snapshots: SnapshotRow[],
  targetTime: number,
  toleranceMs: number
): SnapshotRow | null {
  let best: SnapshotRow | null = null;
  let bestDiff = Infinity;
  for (const s of snapshots) {
    const diff = Math.abs(new Date(s.timestamp).getTime() - targetTime);
    if (diff < bestDiff && diff <= toleranceMs) {
      best = s;
      bestDiff = diff;
    }
  }
  return best;
}

function estimateNewUsage(
  prev: SnapshotRow,
  curr: SnapshotRow,
  allOk: SnapshotRow[]
): number {
  const rawDelta = curr.five_hour_utilization! - prev.five_hour_utilization!;

  const currTime = new Date(curr.timestamp).getTime();
  const prevTime = new Date(prev.timestamp).getTime();
  const pollGap = currTime - prevTime;

  // Find snapshots from ~5 hours ago to estimate what dropped off
  const tolerance = Math.max(pollGap * 1.5, 10 * 60 * 1000); // generous tolerance
  const snap5hAgo = findClosestSnapshot(allOk, currTime - FIVE_HOURS_MS, tolerance);
  const snap5hPrevAgo = findClosestSnapshot(allOk, prevTime - FIVE_HOURS_MS, tolerance);

  if (
    snap5hAgo && snap5hPrevAgo &&
    snap5hAgo.five_hour_utilization != null &&
    snap5hPrevAgo.five_hour_utilization != null &&
    snap5hAgo.id !== snap5hPrevAgo.id
  ) {
    // Dropoff ≈ usage that existed at (now - 5h) minus usage at (prev - 5h)
    // This is what slid off the trailing edge between prev and curr polls
    const dropoff = Math.max(
      0,
      snap5hPrevAgo.five_hour_utilization - snap5hAgo.five_hour_utilization
    );
    return Math.max(0, rawDelta + dropoff);
  }

  // Fallback: no 5h-old data yet, use positive delta only
  return Math.max(0, rawDelta);
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

    if (prev.five_hour_utilization == null || curr.five_hour_utilization == null)
      continue;

    const newUsage = estimateNewUsage(prev, curr, okSnapshots);
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
      rawJson: lastSuccess.raw_json ? JSON.parse(lastSuccess.raw_json) : null,
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
    runtime,
    storage: storageMeta,
  };
}
