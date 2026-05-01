import { computeUsageDelta } from "./usage-window";
import type { ParsedSnapshot } from "./queries";

export interface PeakBlock {
  startHour: number;  // 0–23, user-local hour where the 4-hour block begins
  endHour: number;    // (startHour + 4) % 24
  sumDelta: number;   // sum of hourly deltas across the 4 hours in the block
  midpoint: number;   // (startHour + 2) % 24
}

export interface PeakDetectorResult {
  peakBlock: PeakBlock;
  midpoint: number;   // same as peakBlock.midpoint, hoisted for convenience
}

function getLocalHour(isoTimestamp: string, timezone: string): number {
  const date = new Date(isoTimestamp);
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hour12: false,
    timeZone: timezone,
  }).formatToParts(date);
  const hourPart = parts.find((p) => p.type === "hour");
  const h = parseInt(hourPart?.value ?? "0", 10);
  return h === 24 ? 0 : h; // Intl can return 24 for midnight; normalize to 0
}

function getLocalDateStr(isoTimestamp: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: timezone,
  }).format(new Date(isoTimestamp));
}

function circularDistFromNoon(mid: number): number {
  const d = Math.abs(mid - 12);
  return Math.min(d, 24 - d);
}

export function peakDetector(
  snapshots: ParsedSnapshot[],
  timezone: string = "America/Los_Angeles",
  windowHours: number = 4
): PeakDetectorResult | null {
  // Step 1: Filter to ok snapshots, sort by timestamp ascending
  const okSnapshots = snapshots
    .filter((s) => s.status === "ok")
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  // Step 2: Count distinct calendar days in user-local time
  const distinctDays = new Set(
    okSnapshots.map((s) => getLocalDateStr(s.timestamp, timezone))
  );
  if (distinctDays.size < 3) return null;

  // Step 3: Build hourlyDelta array of length 24
  const hourlyDelta: number[] = new Array(24).fill(0);

  // Step 4: Iterate pairwise, accumulate deltas into local hour buckets
  for (let i = 1; i < okSnapshots.length; i++) {
    const prev = okSnapshots[i - 1];
    const curr = okSnapshots[i];

    const delta = computeUsageDelta(
      prev.five_hour_utilization,
      curr.five_hour_utilization,
      prev.five_hour_resets_at,
      curr.five_hour_resets_at
    );

    if (delta > 0) {
      const localHour = getLocalHour(curr.timestamp, timezone);
      hourlyDelta[localHour] += delta;
    }
  }

  // Step 5: Slide a variable-sized window across all 24 starting positions
  let maxSum = -Infinity;
  let bestStart = 0;

  for (let s = 0; s < 24; s++) {
    let windowSum = 0;
    for (let offset = 0; offset < windowHours; offset++) {
      windowSum += hourlyDelta[(s + offset) % 24];
    }

    if (windowSum > maxSum) {
      maxSum = windowSum;
      bestStart = s;
    } else if (windowSum === maxSum) {
      // Step 7: Tiebreak — midpoint closest to noon (12) wins
      const bestMid = (bestStart + Math.floor(windowHours / 2)) % 24;
      const candMid = (s + Math.floor(windowHours / 2)) % 24;
      const bestDist = circularDistFromNoon(bestMid);
      const candDist = circularDistFromNoon(candMid);

      if (candDist < bestDist) {
        bestStart = s;
      } else if (candDist === bestDist && s < bestStart) {
        // Further tiebreak: earliest startHour wins
        bestStart = s;
      }
    }
  }

  const midpoint = (bestStart + Math.floor(windowHours / 2)) % 24;
  const peakBlock: PeakBlock = {
    startHour: bestStart,
    endHour: (bestStart + windowHours) % 24,
    sumDelta: maxSum,
    midpoint,
  };

  return { peakBlock, midpoint };
}
