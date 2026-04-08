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
function seededRand() {
  seed = (seed * 1664525 + 1013904223) & 0x7fffffff;
  return seed / 0x7fffffff;
}

function seedDemoData(config: import("./config").Config) {
  // Wipe and regenerate so data always looks "recent"
  try {
    if (fs.existsSync(config.dbPath)) fs.unlinkSync(config.dbPath);
    if (fs.existsSync(config.dbPath + "-wal")) fs.unlinkSync(config.dbPath + "-wal");
    if (fs.existsSync(config.dbPath + "-shm")) fs.unlinkSync(config.dbPath + "-shm");
  } catch { /* first run, nothing to delete */ }

  const db = getDb(config);

  console.log("[demo] Generating 7 days of fake usage data...");
  const now = Date.now();
  const SEVEN_DAYS = 7 * 24 * 60 * 60_000;
  const INTERVAL = 5 * 60_000;
  const total = Math.floor(SEVEN_DAYS / INTERVAL); // 2016 snapshots
  seed = 42; // reset for reproducibility

  const insert = db.prepare(`
    INSERT INTO usage_snapshots
      (timestamp, status, endpoint, auth_mode, response_status,
       five_hour_utilization, five_hour_resets_at,
       seven_day_utilization, seven_day_resets_at,
       raw_json, error_message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertAll = db.transaction(() => {
    for (let i = total; i > 0; i--) {
      const ts = new Date(now - i * INTERVAL);
      const hour = ts.getHours();
      const dayOfWeek = ts.getDay();
      const isWorkHour = hour >= 9 && hour <= 17;
      const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;

      let base: number;
      if (isWeekday && isWorkHour) {
        base = 0.35 + seededRand() * 0.35;
      } else if (isWeekday) {
        base = 0.05 + seededRand() * 0.2;
      } else if (isWorkHour) {
        base = 0.1 + seededRand() * 0.25;
      } else {
        base = 0.02 + seededRand() * 0.1;
      }

      // Occasional spikes during work hours
      if (isWorkHour && isWeekday && seededRand() < 0.1) {
        base = Math.min(base + 0.3 + seededRand() * 0.2, 1);
      }

      const fiveHourUtil = Math.round(base * 1000) / 1000;
      const dayProgress = (7 - i / (total / 7)) / 7;
      const sevenDayUtil =
        Math.round((0.15 + dayProgress * 0.25 + seededRand() * 0.1) * 1000) / 1000;

      insert.run(
        ts.toISOString(),
        "ok",
        "demo",
        "demo",
        200,
        fiveHourUtil,
        new Date(ts.getTime() + (5 - (hour % 5)) * 3600_000).toISOString(),
        sevenDayUtil,
        new Date(ts.getTime() + 3 * 86400_000).toISOString(),
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
