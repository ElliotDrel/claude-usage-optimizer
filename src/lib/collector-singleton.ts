import fs from "node:fs";
import { getConfig } from "./config";
import { getDb, insertSnapshot } from "./db";
import { UsageCollector } from "./collector";

// Singleton collector instance shared across API routes.
// Next.js may re-import modules; globalThis ensures one instance.

const globalForCollector = globalThis as unknown as {
  _usageCollector?: UsageCollector;
};

// Seeded RNG for reproducible demo data
let seed = 42;
function rand() {
  seed = (seed * 1664525 + 1013904223) & 0x7fffffff;
  return seed / 0x7fffffff;
}

// Pre-generate work sessions for a given day.
// Each session has a start hour, duration in hours, and intensity (how fast usage climbs).
function generateSessions(dayOfWeek: number): { startHour: number; durationH: number; intensity: number }[] {
  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
  const sessions: { startHour: number; durationH: number; intensity: number }[] = [];

  if (isWeekday) {
    // 2-4 work sessions on weekdays
    const count = 2 + Math.floor(rand() * 3); // 2-4
    const possibleStarts = [8, 9, 10, 11, 13, 14, 15, 16, 19, 20];
    for (let s = 0; s < count; s++) {
      const idx = Math.floor(rand() * possibleStarts.length);
      const start = possibleStarts.splice(idx, 1)[0];
      sessions.push({
        startHour: start,
        durationH: 0.5 + rand() * 2, // 30min to 2.5h
        intensity: 0.04 + rand() * 0.08, // 4-12% per 5min tick
      });
    }
  } else {
    // 0-2 light sessions on weekends
    const count = Math.floor(rand() * 3); // 0-2
    for (let s = 0; s < count; s++) {
      sessions.push({
        startHour: 10 + Math.floor(rand() * 8), // 10-17
        durationH: 0.25 + rand() * 1, // 15min to 1.25h
        intensity: 0.02 + rand() * 0.05, // lighter
      });
    }
  }
  return sessions;
}

function seedDemoData(config: import("./config").Config) {
  // Wipe and regenerate so data always looks "recent"
  try {
    if (fs.existsSync(config.dbPath)) fs.unlinkSync(config.dbPath);
    if (fs.existsSync(config.dbPath + "-wal")) fs.unlinkSync(config.dbPath + "-wal");
    if (fs.existsSync(config.dbPath + "-shm")) fs.unlinkSync(config.dbPath + "-shm");
  } catch { /* first run, nothing to delete */ }

  const db = getDb(config);

  console.log("[demo] Generating 7 days of realistic usage data...");
  const now = Date.now();
  const SEVEN_DAYS = 7 * 24 * 60 * 60_000;
  const INTERVAL = 5 * 60_000;
  const total = Math.floor(SEVEN_DAYS / INTERVAL);
  seed = 42;

  const insert = db.prepare(`
    INSERT INTO usage_snapshots
      (timestamp, status, endpoint, auth_mode, response_status,
       five_hour_utilization, five_hour_resets_at,
       seven_day_utilization, seven_day_resets_at,
       raw_json, error_message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Pre-generate sessions for each of the 7 days
  const startTs = now - SEVEN_DAYS;
  const startDate = new Date(startTs);
  const daySessions: { startHour: number; durationH: number; intensity: number }[][] = [];
  for (let d = 0; d < 8; d++) {
    const dayDate = new Date(startTs + d * 86400_000);
    daySessions.push(generateSessions(dayDate.getDay()));
  }

  // State that carries across snapshots (0-100 scale to match real API)
  let fiveHourUtil = 0;
  let sevenDayUtil = 12 + rand() * 8; // start week at 12-20%
  let lastResetHour = -1;

  const insertAll = db.transaction(() => {
    for (let i = total; i > 0; i--) {
      const ts = new Date(now - i * INTERVAL);
      const hour = ts.getHours();
      const minute = ts.getMinutes();
      const hourFrac = hour + minute / 60;

      // 5-hour window resets: utilization drops back near zero
      const resetBucket = Math.floor(hour / 5);
      if (resetBucket !== lastResetHour) {
        lastResetHour = resetBucket;
        fiveHourUtil = rand() * 3; // near zero after reset
      }

      // Check if any session is active right now
      const dayIndex = Math.floor((ts.getTime() - startTs) / 86400_000);
      const sessions = daySessions[Math.min(dayIndex, daySessions.length - 1)];
      let inSession = false;
      for (const s of sessions) {
        if (hourFrac >= s.startHour && hourFrac < s.startHour + s.durationH) {
          // Active session: usage climbs (intensity is 4-12 per tick)
          fiveHourUtil = Math.min(fiveHourUtil + s.intensity * 100 * (0.7 + rand() * 0.6), 100);
          sevenDayUtil = Math.min(sevenDayUtil + s.intensity * 0.5 * (0.5 + rand()), 100);
          inSession = true;
          break;
        }
      }

      // Between sessions: usage stays flat with tiny drift
      if (!inSession) {
        fiveHourUtil = Math.max(0, fiveHourUtil + (rand() - 0.52) * 0.5);
      }

      // 7-day has a slow natural decay overnight
      if (hour >= 0 && hour < 7 && !inSession) {
        sevenDayUtil = Math.max(5, sevenDayUtil - 0.1 * rand());
      }

      const fiveHourResets = new Date(
        ts.getTime() + ((5 - (hour % 5)) * 3600_000 - minute * 60_000)
      ).toISOString();
      const sevenDayResets = new Date(
        ts.getTime() + 3 * 86400_000
      ).toISOString();

      insert.run(
        ts.toISOString(),
        "ok",
        "demo",
        "demo",
        200,
        Math.round(fiveHourUtil * 10) / 10,
        fiveHourResets,
        Math.round(sevenDayUtil * 10) / 10,
        sevenDayResets,
        JSON.stringify({ demo: true }),
        null
      );
    }
  });

  insertAll();
  console.log(`[demo] Seeded ${total} snapshots (7 days @ 5min intervals)`);
}

export function getCollector(): UsageCollector {
  if (!globalForCollector._usageCollector) {
    const config = getConfig();
    if (config.demoMode) {
      seedDemoData(config);
    } else {
      getDb(config);
    }
    const collector = new UsageCollector(config);
    collector.start();
    globalForCollector._usageCollector = collector;
  }
  return globalForCollector._usageCollector;
}
