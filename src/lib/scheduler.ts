/**
 * scheduler.ts
 *
 * Core in-process scheduler module. Wires the algorithm core (peak-detector,
 * schedule) and sender into a durable 60-second tick loop. All state lives in
 * app_meta (SQLite), so the scheduler survives process restarts.
 *
 * Named exports only; no default export (per project conventions).
 */

import type Database from "better-sqlite3";
import { getConfig } from "./config";
import { querySnapshots, getDb } from "./db";
import { send } from "./sender";
import { postDiscordNotification } from "./notifier";
import { peakDetector } from "./peak-detector";
import { generateSchedule } from "./schedule";
import { parseSnapshots } from "./queries";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ScheduledFire {
  timestamp: string; // UTC ISO string
  isAnchor: boolean;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * initializeAppMeta — writes all 10 app_meta keys with defaults on startup.
 * Uses ON CONFLICT(key) DO NOTHING so user-configured values are never
 * overwritten. Per D-04 (CONTEXT.md), this runs before the first tick.
 */
function initializeAppMeta(db: Database.Database): void {
  const defaults: Record<string, string> = {
    schedule_fires: "[]",
    schedule_fires_done: "[]",
    schedule_generated_at: "",
    peak_block: "",
    schedule_override_start_time: "",
    peak_window_hours: "4",
    anchor_offset_minutes: "5",
    default_seed_time: "05:05",
    user_timezone: "America/Los_Angeles",
    paused: "false",
    // CR-03: lock flag reset to "false" on every startup so a previous crash
    // cannot permanently brick scheduling (see recomputeSchedule below).
    schedule_recomputing: "false",
    last_tick_at: "",                      // ISO timestamp, written on every tick
    notification_webhook_url: "",          // Discord webhook URL, opt-in
  };

  for (const [key, value] of Object.entries(defaults)) {
    db.prepare(
      "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING"
    ).run(key, value);
  }

  // CR-03: Always reset the recompute lock on startup — the DO NOTHING above
  // would leave a crash-stuck "true" value in place, permanently blocking
  // future recomputes. Use an explicit UPSERT to force it back to "false".
  db.prepare(
    "INSERT INTO app_meta (key, value) VALUES ('schedule_recomputing', 'false')" +
    " ON CONFLICT(key) DO UPDATE SET value = 'false'"
  ).run();
}

/**
 * readMeta — read a single app_meta key, returning a fallback if absent.
 */
function readMeta(db: Database.Database, key: string, fallback = ""): string {
  const row = db
    .prepare("SELECT value FROM app_meta WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? fallback;
}

/**
 * writeMeta — upsert a single app_meta key.
 */
function writeMeta(db: Database.Database, key: string, value: string): void {
  db.prepare(
    "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, value);
}

/**
 * parseFiresJson — safely parse a JSON string into ScheduledFire[].
 * Wraps JSON.parse in try/catch; defaults to [] on parse failure.
 * Mitigates T-04-01 (corrupt app_meta).
 */
function parseFiresJson(raw: string): ScheduledFire[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      console.error("[scheduler] corrupt schedule_fires, resetting to []");
      return [];
    }
    return parsed as ScheduledFire[];
  } catch {
    console.error("[scheduler] corrupt schedule_fires, resetting to []");
    return [];
  }
}

/**
 * parseDoneJson — safely parse a JSON string into string[].
 * Wraps JSON.parse in try/catch; defaults to [] on parse failure.
 */
function parseDoneJson(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      console.error("[scheduler] corrupt schedule_fires_done, resetting to []");
      return [];
    }
    return parsed as string[];
  } catch {
    console.error("[scheduler] corrupt schedule_fires_done, resetting to []");
    return [];
  }
}

/**
 * shouldRecomputeSchedule — returns true when UTC hour >= 3 AND
 * (lastGeneratedAt is empty OR date(lastGeneratedAt) is before today UTC).
 * Mitigates Pitfall 2 (date boundary crossing).
 */
function shouldRecomputeSchedule(nowFn: () => Date, lastGeneratedAt: string): boolean {
  const now = nowFn();
  const utcHour = now.getUTCHours();

  // Too early — wait until 03:00 UTC
  if (utcHour < 3) {
    return false;
  }

  // Never generated — recompute now
  if (!lastGeneratedAt) {
    return true;
  }

  // Compare calendar dates in UTC (ISO YYYY-MM-DD prefix comparison)
  const nowDateUtc = now.toISOString().split("T")[0];
  const generatedDateUtc = new Date(lastGeneratedAt).toISOString().split("T")[0];

  return nowDateUtc > generatedDateUtc;
}

/**
 * fireTimeToUtcIso — converts a FireTime (user-local hour/minute) to a UTC
 * ISO timestamp for today's UTC date.
 *
 * Approach: Build the local date string for today using the user's timezone
 * (via Intl.DateTimeFormat). Then construct a Date by trying the ISO string
 * as if UTC; measure the Intl-reported local time for that date; compute the
 * offset difference; subtract to get UTC. DST-aware via Intl.
 *
 * Mitigates T-04-03 (invalid timezone string): wrapped in try/catch with
 * fallback to America/Los_Angeles.
 */
function fireTimeToUtcIso(
  firetime: { hour: number; minute: number },
  timezone: string,
  nowFn: () => Date
): string {
  // Pad helper
  const pad = (n: number) => String(n).padStart(2, "0");

  // Safe timezone with fallback (T-04-03)
  let safeTimezone = timezone;
  try {
    // Validate by constructing; throws if invalid IANA name
    Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    console.error(
      `[scheduler] invalid timezone '${timezone}', falling back to America/Los_Angeles`
    );
    safeTimezone = "America/Los_Angeles";
  }

  // Get today's date string in the user's local timezone (YYYY-MM-DD)
  const now = nowFn();
  const localDateParts = new Intl.DateTimeFormat("en-US", {
    timeZone: safeTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const localYear = localDateParts.find((p) => p.type === "year")?.value ?? "";
  const localMonth = localDateParts.find((p) => p.type === "month")?.value ?? "";
  const localDay = localDateParts.find((p) => p.type === "day")?.value ?? "";

  // WR-04: Explicit guard — if any part is missing, the resulting ISO string
  // would be malformed (e.g. "--T12:00:00Z"). Throw so the caller can log and
  // fall back gracefully rather than silently writing a corrupt timestamp.
  if (!localYear || !localMonth || !localDay) {
    throw new Error(
      `[scheduler] fireTimeToUtcIso: formatToParts returned incomplete date parts for timezone '${safeTimezone}'`
    );
  }

  // Construct a "local" ISO string and then find the UTC equivalent by
  // probing: create a Date from the string as if it were UTC, check what
  // Intl reports for local hour/minute at that UTC moment, and adjust.
  const localIso = `${localYear}-${localMonth}-${localDay}T${pad(firetime.hour)}:${pad(firetime.minute)}:00`;

  // Probe: interpret as UTC first
  const probeUtc = new Date(`${localIso}Z`);

  // What does Intl say the local hour is at that UTC moment?
  const probeLocalParts = new Intl.DateTimeFormat("en-US", {
    timeZone: safeTimezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(probeUtc);

  const probeLocalHour = parseInt(
    probeLocalParts.find((p) => p.type === "hour")?.value ?? "0",
    10
  );
  const probeLocalMinute = parseInt(
    probeLocalParts.find((p) => p.type === "minute")?.value ?? "0",
    10
  );

  // Normalize Intl's midnight representation (24 -> 0)
  const normalizedProbeHour = probeLocalHour === 24 ? 0 : probeLocalHour;

  // Difference in minutes between desired local time and what Intl reports
  const desiredMinutes = firetime.hour * 60 + firetime.minute;
  const probeMinutes = normalizedProbeHour * 60 + probeLocalMinute;
  const offsetMs = (desiredMinutes - probeMinutes) * 60 * 1000;

  // Adjust the UTC probe by the offset to get the correct UTC timestamp
  const resultUtc = new Date(probeUtc.getTime() - offsetMs);
  return resultUtc.toISOString();
}

/**
 * catchUpOnStartup — reads today's schedule_fires and fires any that were
 * missed by less than 15 minutes. Older misses are skipped. Runs once at
 * startup before the tick interval begins. Per SCHED-10.
 */
async function catchUpOnStartup(
  db: Database.Database,
  config: ReturnType<typeof getConfig>,
  nowFn: () => Date,
  sendTimeoutMs?: number
): Promise<void> {
  const now = nowFn();
  const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000);

  const fires = parseFiresJson(readMeta(db, "schedule_fires"));
  const firesDone = parseDoneJson(readMeta(db, "schedule_fires_done"));

  for (const fire of fires) {
    const fireDate = new Date(fire.timestamp);
    const isMissed = fireDate <= now && !firesDone.includes(fire.timestamp);
    const isRecent = fireDate > fifteenMinutesAgo;

    if (isMissed && isRecent) {
      try {
        const result = await send(config, {
          scheduledFor: fire.timestamp,
          isAnchor: fire.isAnchor ? 1 : 0,
          ...(sendTimeoutMs !== undefined ? { timeoutMs: sendTimeoutMs } : {}),
        });
        firesDone.push(fire.timestamp);
        // Persist immediately after each successful fire (Pitfall 4)
        writeMeta(db, "schedule_fires_done", JSON.stringify(firesDone));
        console.log(
          `[scheduler] catch-up fired at ${fire.timestamp} with status ${result.status}`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `[scheduler] send failed for fire at ${fire.timestamp}: ${msg}`
        );
        // D-03: errors are logged and the loop continues
      }
    }
  }
}

/**
 * runTick — the core 60-second tick. Three steps:
 * 1. Pause check — if paused='true', skip everything.
 * 2. Recompute check — if it's past 03:00 UTC and today's schedule hasn't
 *    been generated yet, read snapshots, detect peak, generate schedule,
 *    convert to UTC ISO timestamps, write to app_meta.
 * 3. Fire execution — for each fire not yet done whose timestamp <= now,
 *    call send() in try/catch; log result; persist updated done list.
 */
async function runTick(
  db: Database.Database,
  config: ReturnType<typeof getConfig>,
  nowFn: () => Date,
  sendTimeoutMs?: number
): Promise<void> {
  // Unconditionally write timestamp on every tick (stall detection depends on this)
  writeMeta(db, "last_tick_at", nowFn().toISOString());

  // --- Step 1: Pause check ---
  const paused = readMeta(db, "paused", "false");
  if (paused === "true") {
    console.log("[scheduler] paused — skipping tick");
    return;
  }

  const now = nowFn();

  // Check if more than 5 minutes since last tick (stall detection per D-06)
  const lastTickAtStr = readMeta(db, "last_tick_at");
  if (lastTickAtStr && lastTickAtStr !== now.toISOString()) {
    const lastTick = new Date(lastTickAtStr);
    const elapsedSeconds = (now.getTime() - lastTick.getTime()) / 1000;
    if (elapsedSeconds > 300) { // 5 minutes = 300 seconds
      console.error(`[scheduler] STALL DETECTED: ${elapsedSeconds}s since last tick`);
      void postDiscordNotification(
        "Scheduler Stall",
        `No scheduler tick recorded for ${Math.floor(elapsedSeconds)}s (threshold: 300s)`,
        now
      );
    }
  }

  // --- Step 2: Recompute check ---
  const lastGeneratedAt = readMeta(db, "schedule_generated_at", "");
  if (shouldRecomputeSchedule(nowFn, lastGeneratedAt)) {
    console.log("[scheduler] recomputing schedule for today");

    try {
      // Read timezone and schedule options from app_meta
      const timezone = readMeta(db, "user_timezone", "America/Los_Angeles");
      const anchorOffsetMinutes = parseInt(
        readMeta(db, "anchor_offset_minutes", "5"),
        10
      );
      const defaultSeedTime = readMeta(db, "default_seed_time", "05:05");
      const overrideStartTime = readMeta(db, "schedule_override_start_time", "") || null;

      // Read all ok snapshots and parse
      const rows = querySnapshots(config, { status: "ok" });
      const parsed = parseSnapshots(rows);

      // Detect peak
      const peakResult = peakDetector(parsed, timezone);
      const peakBlock = peakResult?.peakBlock ?? null;

      // Generate schedule
      const fires = generateSchedule(peakBlock, {
        anchorOffsetMinutes,
        defaultSeedTime,
        overrideStartTime,
      });

      // Convert FireTime[] to UTC ISO timestamps for today.
      // Apply jitter: jitterMinutes (0-5) is added to the slot minute and may
      // carry over into the hour (e.g. 59min + 3jitter = hour+1, 2min).
      const scheduledFires: ScheduledFire[] = fires.map((ft) => {
        const totalMinutes = ft.hour * 60 + ft.minute + ft.jitterMinutes;
        const jitteredHour = Math.floor(totalMinutes / 60) % 24;
        const jitteredMinute = totalMinutes % 60;
        return {
          timestamp: fireTimeToUtcIso({ hour: jitteredHour, minute: jitteredMinute }, timezone, nowFn),
          isAnchor: ft.isAnchor,
        };
      });

      // Write all 4 app_meta keys atomically (individual prepared statements)
      writeMeta(db, "schedule_fires", JSON.stringify(scheduledFires));
      writeMeta(db, "peak_block", peakBlock ? JSON.stringify(peakBlock) : "");
      writeMeta(db, "schedule_generated_at", now.toISOString());
      writeMeta(db, "schedule_fires_done", "[]"); // Reset done list for new day

      console.log(
        `[scheduler] schedule generated: ${scheduledFires.length} fires, ` +
        `peak block: ${peakBlock ? `${peakBlock.startHour}–${peakBlock.endHour}` : "none (seed fallback)"}`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[scheduler] schedule recompute failed: ${msg}`);
      // Non-fatal — tick continues with existing (possibly stale) schedule
    }
  }

  // --- Step 3: Fire execution ---
  const fires = parseFiresJson(readMeta(db, "schedule_fires"));
  const firesDone = parseDoneJson(readMeta(db, "schedule_fires_done"));

  for (const fire of fires) {
    const fireDate = new Date(fire.timestamp);
    const isDue = fireDate <= now && !firesDone.includes(fire.timestamp);

    if (isDue) {
      try {
        const result = await send(config, {
          scheduledFor: fire.timestamp,
          isAnchor: fire.isAnchor ? 1 : 0,
          ...(sendTimeoutMs !== undefined ? { timeoutMs: sendTimeoutMs } : {}),
        });
        firesDone.push(fire.timestamp);
        // Persist after each fire (Pitfall 4: persist or it will fire again)
        writeMeta(db, "schedule_fires_done", JSON.stringify(firesDone));
        console.log(
          `[scheduler] fire at ${fire.timestamp} completed with status ${result.status}`
        );
      } catch (err) {
        // D-03: per-fire error isolated; tick continues
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[scheduler] send failed for fire at ${fire.timestamp}: ${msg}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * tickOnce — run a single tick immediately with the given clock.
 *
 * Exported for testing: allows tests to drive one tick synchronously
 * without waiting for the 60-second interval. Calls runTick internally.
 *
 * @param db — open better-sqlite3 database handle
 * @param nowFn — optional clock injection; defaults to () => new Date()
 */
export async function tickOnce(
  db: Database.Database,
  nowFn?: () => Date,
  sendTimeoutMs?: number
): Promise<void> {
  const config = getConfig();
  const clockFn = nowFn ?? (() => new Date());
  await runTick(db, config, clockFn, sendTimeoutMs);
}

/**
 * startScheduler — start the in-process 60-second tick loop.
 *
 * 1. Calls initializeAppMeta(db) — writes all 10 app_meta defaults (D-04)
 * 2. Resolves config via getConfig() internally
 * 3. Runs catchUpOnStartup async before the first tick (SCHED-10)
 * 4. Sets up setInterval(60_000) — returns { stop } for SIGTERM shutdown
 *
 * All time comparisons use nowFn() from opts, never new Date() directly (D-02).
 *
 * @param db — open better-sqlite3 database handle (caller owns lifecycle)
 * @param opts — optional: { nowFn, sendTimeoutMs } for test injection
 */
export function startScheduler(
  db: Database.Database,
  opts?: { nowFn?: () => Date; sendTimeoutMs?: number }
): { stop: () => void } {
  // D-04: Initialize all app_meta defaults before the first tick
  initializeAppMeta(db);

  const config = getConfig();
  // D-02: Clock injection; default is () => new Date()
  const nowFn = opts?.nowFn ?? (() => new Date());
  const sendTimeoutMs = opts?.sendTimeoutMs;

  // Run catch-up on startup asynchronously (SCHED-10)
  // Fire-and-forget — errors are logged inside catchUpOnStartup
  void catchUpOnStartup(db, config, nowFn, sendTimeoutMs);

  // T-04-04: Wrap runTick in a top-level try/catch inside the setInterval
  // callback so that any unhandled error from runTick itself does not
  // silently crash the interval.
  const interval = setInterval(() => {
    void runTick(db, config, nowFn, sendTimeoutMs).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[scheduler] tick threw unexpectedly: ${msg}`);
    });
  }, 60_000);

  return {
    stop: () => clearInterval(interval),
  };
}

/**
 * recomputeSchedule — force recomputation of the schedule based on current
 * app_meta settings and available snapshots.
 *
 * Called by the PATCH /api/app-meta endpoint after overrides are written
 * to immediately return the new schedule_fires to the client.
 *
 * @param config — configuration object
 * @param nowFn — optional clock injection for testing
 */
export function recomputeSchedule(
  config: ReturnType<typeof getConfig>,
  nowFn?: () => Date
): void {
  const db = getDb(config);
  const clockFn = nowFn ?? (() => new Date());
  const now = clockFn();

  // CR-03: Guard against overlapping recompute calls. Node.js is
  // single-threaded so true interleaving cannot occur, but two rapid PATCH
  // requests can queue back-to-back synchronous calls whose intermediate
  // writes could be observed inconsistently. The flag also survives process
  // restarts (initializeAppMeta resets it to "false" on startup).
  const isRecomputing = readMeta(db, "schedule_recomputing", "false");
  if (isRecomputing === "true") {
    throw new Error("Schedule recomputation already in progress");
  }
  writeMeta(db, "schedule_recomputing", "true");

  try {
    // Read timezone and schedule options from app_meta
    const timezone = readMeta(db, "user_timezone", "America/Los_Angeles");
    const anchorOffsetMinutes = parseInt(
      readMeta(db, "anchor_offset_minutes", "5"),
      10
    );
    const defaultSeedTime = readMeta(db, "default_seed_time", "05:05");
    const overrideStartTime = readMeta(db, "schedule_override_start_time", "") || null;

    // Read all ok snapshots and parse
    const rows = querySnapshots(config, { status: "ok" });
    const parsed = parseSnapshots(rows);

    // Detect peak
    const peakResult = peakDetector(parsed, timezone);
    const peakBlock = peakResult?.peakBlock ?? null;

    // Generate schedule
    const fires = generateSchedule(peakBlock, {
      anchorOffsetMinutes,
      defaultSeedTime,
      overrideStartTime,
    });

    // Convert FireTime[] to UTC ISO timestamps for today.
    const scheduledFires: ScheduledFire[] = fires.map((ft) => {
      const totalMinutes = ft.hour * 60 + ft.minute + ft.jitterMinutes;
      const jitteredHour = Math.floor(totalMinutes / 60) % 24;
      const jitteredMinute = totalMinutes % 60;
      return {
        timestamp: fireTimeToUtcIso({ hour: jitteredHour, minute: jitteredMinute }, timezone, clockFn),
        isAnchor: ft.isAnchor,
      };
    });

    // Write all 4 app_meta keys atomically (individual prepared statements)
    writeMeta(db, "schedule_fires", JSON.stringify(scheduledFires));
    writeMeta(db, "peak_block", peakBlock ? JSON.stringify(peakBlock) : "");
    writeMeta(db, "schedule_generated_at", now.toISOString());
    writeMeta(db, "schedule_fires_done", "[]"); // Reset done list for new day

    console.log(
      `[scheduler] schedule recomputed: ${scheduledFires.length} fires, ` +
      `peak block: ${peakBlock ? `${peakBlock.startHour}–${peakBlock.endHour}` : "none (seed fallback)"}`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[scheduler] schedule recompute failed: ${msg}`);
    throw err; // Propagate to caller
  } finally {
    // Always reset the lock so future recomputes are not blocked (CR-03).
    writeMeta(db, "schedule_recomputing", "false");
  }
}
