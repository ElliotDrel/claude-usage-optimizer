import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { querySnapshots, getAppMeta } from "@/lib/db";
import { parseSnapshots } from "@/lib/queries";
import { peakDetector } from "@/lib/peak-detector";
import { generateSchedule } from "@/lib/schedule";
import type { FireTime } from "@/lib/schedule";

export const dynamic = "force-dynamic";

/**
 * Converts a user-local fire time to a UTC ISO string for the next occurrence
 * of that time (today if not yet passed, tomorrow if already past).
 * DST-aware via Intl.DateTimeFormat probing — same approach as scheduler.ts.
 */
function fireTimeToNextUtcIso(
  firetime: { hour: number; minute: number },
  timezone: string
): string {
  const pad = (n: number) => String(n).padStart(2, "0");

  let safeTimezone = timezone;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    safeTimezone = "America/Los_Angeles";
  }

  const now = new Date();

  const localDateParts = new Intl.DateTimeFormat("en-US", {
    timeZone: safeTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const localYear = localDateParts.find((p) => p.type === "year")?.value ?? "";
  const localMonth = localDateParts.find((p) => p.type === "month")?.value ?? "";
  const localDay = localDateParts.find((p) => p.type === "day")?.value ?? "";
  const localHour = parseInt(localDateParts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const localMinute = parseInt(localDateParts.find((p) => p.type === "minute")?.value ?? "0", 10);

  // Probe the target local time as UTC, then correct for the timezone offset
  const localIso = `${localYear}-${localMonth}-${localDay}T${pad(firetime.hour)}:${pad(firetime.minute)}:00`;
  const probeUtc = new Date(`${localIso}Z`);

  const probeLocalParts = new Intl.DateTimeFormat("en-US", {
    timeZone: safeTimezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(probeUtc);

  const probeHour = parseInt(probeLocalParts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const probeMinute = parseInt(probeLocalParts.find((p) => p.type === "minute")?.value ?? "0", 10);
  const normalizedProbeHour = probeHour === 24 ? 0 : probeHour;

  const offsetMs =
    (firetime.hour * 60 + firetime.minute - (normalizedProbeHour * 60 + probeMinute)) * 60_000;

  let resultUtc = new Date(probeUtc.getTime() - offsetMs);

  // If the anchor is already past for today in local time, advance to tomorrow
  const nowLocalMinutes = (localHour === 24 ? 0 : localHour) * 60 + localMinute;
  const anchorLocalMinutes = firetime.hour * 60 + firetime.minute;
  if (anchorLocalMinutes <= nowLocalMinutes) {
    resultUtc = new Date(resultUtc.getTime() + 24 * 60 * 60_000);
  }

  return resultUtc.toISOString();
}

/**
 * GET /api/optimize
 *
 * Returns the current peak-detection result and recommended anchor-send schedule.
 * Reads from the live database — no side effects. Safe to call at any frequency.
 *
 * Response shape:
 * {
 *   peakBlock:       { startHour, endHour, sumDelta, midpoint } | null,
 *   anchorTimeLocal: "HH:MM",
 *   anchorTimeUtc:   ISO string (next occurrence),
 *   fireSchedule:    FireTime[],   // 5 slots spaced 5h apart
 *   timezone:        string,       // IANA timezone used for detection
 *   computedAt:      ISO string
 * }
 *
 * peakBlock is null when fewer than 3 calendar days of data exist.
 * In that case, anchorTimeLocal falls back to defaultSeedTime (default 05:05).
 */
export async function GET() {
  const config = getConfig();
  const rows = querySnapshots(config);
  const snapshots = parseSnapshots(rows);
  const meta = getAppMeta(config);

  const timezone = meta.get("user_timezone") ?? "America/Los_Angeles";
  const windowHours = (() => {
    const raw = parseInt(meta.get("peak_window_hours") ?? "4", 10);
    return Number.isFinite(raw) && raw > 0 ? raw : 4;
  })();
  const anchorOffsetMinutes = (() => {
    const raw = parseInt(meta.get("anchor_offset_minutes") ?? "5", 10);
    return Number.isFinite(raw) ? raw : 5;
  })();
  const defaultSeedTime = meta.get("default_seed_time") ?? undefined;
  const overrideStartTime = meta.get("schedule_override_start_time") ?? null;

  const detected = peakDetector(snapshots, timezone, windowHours);

  const fireSchedule: FireTime[] = generateSchedule(detected?.peakBlock ?? null, {
    anchorOffsetMinutes,
    defaultSeedTime,
    overrideStartTime,
  });

  const anchor = fireSchedule[0];
  const pad = (n: number) => String(n).padStart(2, "0");
  const anchorTimeLocal = `${pad(anchor.hour)}:${pad(anchor.minute)}`;
  const anchorTimeUtc = fireTimeToNextUtcIso(anchor, timezone);

  return NextResponse.json({
    peakBlock: detected?.peakBlock ?? null,
    anchorTimeLocal,
    anchorTimeUtc,
    fireSchedule,
    timezone,
    computedAt: new Date().toISOString(),
  });
}
