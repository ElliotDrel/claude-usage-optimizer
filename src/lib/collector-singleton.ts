import { getConfig } from "./config";
import { getDb, insertSnapshot, querySnapshots } from "./db";
import { UsageCollector } from "./collector";

// Singleton collector instance shared across API routes.
// Next.js may re-import modules; globalThis ensures one instance.

const globalForCollector = globalThis as unknown as {
  _usageCollector?: UsageCollector;
};

function seedDemoData(config: import("./config").Config) {
  const existing = querySnapshots(config, { limit: 1 });
  if (existing.length > 0) return; // already seeded

  console.log("[demo] Seeding 24h of historical data...");
  const now = Date.now();
  // Generate a snapshot every 5 minutes for the past 24 hours
  for (let i = 288; i > 0; i--) {
    const ts = new Date(now - i * 5 * 60_000);
    const hour = ts.getHours();
    const base = hour >= 9 && hour <= 17 ? 0.4 : 0.15;
    const jitter = Math.random() * 0.25;
    const fiveHourUtil = Math.min(base + jitter, 1);
    const sevenDayUtil = Math.min(0.2 + Math.random() * 0.3, 1);

    insertSnapshot(config, {
      timestamp: ts.toISOString(),
      status: "ok",
      endpoint: "demo",
      authMode: "demo",
      responseStatus: 200,
      fiveHourUtilization: fiveHourUtil,
      fiveHourResetsAt: new Date(
        ts.getTime() + (5 - (hour % 5)) * 3600_000
      ).toISOString(),
      sevenDayUtilization: sevenDayUtil,
      sevenDayResetsAt: new Date(
        ts.getTime() + 3 * 86400_000
      ).toISOString(),
      rawJson: JSON.stringify({ demo: true }),
      errorMessage: null,
    });
  }
  console.log("[demo] Seeded 288 snapshots (24h @ 5min intervals)");
}

export function getCollector(): UsageCollector {
  if (!globalForCollector._usageCollector) {
    const config = getConfig();
    getDb(config); // ensure DB is initialized
    if (config.demoMode) {
      seedDemoData(config);
    }
    const collector = new UsageCollector(config);
    collector.start();
    globalForCollector._usageCollector = collector;
  }
  return globalForCollector._usageCollector;
}
