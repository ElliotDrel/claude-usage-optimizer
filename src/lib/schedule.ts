import type { PeakBlock } from "./peak-detector";

export interface FireTime {
  hour: number; // 0–23 user-local
  minute: number; // 0–59
  isAnchor: boolean;
  jitterMinutes: number; // always 0 for anchor; 0–5 (integer) for non-anchors
}

export interface ScheduleOptions {
  anchorOffsetMinutes?: number; // default: 5
  defaultSeedTime?: string; // default: "05:05"  format "HH:MM"
  overrideStartTime?: string | null; // format "HH:MM"; if non-null/non-empty, short-circuits peak detection
}

function parseHHMM(s: string): { hour: number; minute: number } {
  const [h, m] = s.split(":").map(Number);
  return { hour: h ?? 0, minute: m ?? 0 };
}

export function generateSchedule(
  peakBlock: PeakBlock | null,
  options: ScheduleOptions = {}
): FireTime[] {
  // Step 1: Resolve the anchor
  let anchorHour: number;
  let anchorMinute: number;

  if (options.overrideStartTime != null && options.overrideStartTime !== "") {
    // a. Override short-circuits everything — use as-is
    const parsed = parseHHMM(options.overrideStartTime);
    anchorHour = parsed.hour;
    anchorMinute = parsed.minute;
  } else if (peakBlock != null) {
    // b. Peak block supplied — use midpoint + offset
    anchorHour = peakBlock.midpoint % 24;
    anchorMinute = options.anchorOffsetMinutes ?? 5;
  } else {
    // c. Null peak, no override — fall back to default seed time
    const seedTime = options.defaultSeedTime ?? "05:05";
    const parsed = parseHHMM(seedTime);
    anchorHour = parsed.hour;
    anchorMinute = parsed.minute;
  }

  // Step 2: Build chain of 5 slots spaced 5 hours apart
  const fires: FireTime[] = [];
  for (let n = 0; n < 5; n++) {
    const totalMinutes = anchorHour * 60 + anchorMinute + n * 5 * 60;
    const slotHour = Math.floor(totalMinutes / 60) % 24;
    const slotMinute = totalMinutes % 60;
    const isAnchor = n === 0;
    // 0–5 inclusive: Math.random() in [0,1) * 6 = [0,6), floor = [0,5]
    const jitterMinutes = isAnchor ? 0 : Math.floor(Math.random() * 6);

    fires.push({ hour: slotHour, minute: slotMinute, isAnchor, jitterMinutes });
  }

  return fires;
}
