export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Start the collector when the Next.js server boots
    const { getCollector } = await import("./lib/collector-singleton");
    const { getConfig } = await import("./lib/config");
    const { getDb } = await import("./lib/db");
    const { startScheduler } = await import("./lib/scheduler");
    const collector = getCollector();
    const config = getConfig();
    const db = getDb(config);
    console.log("[instrumentation] Collector started");

    // D-01: Scheduler auto-starts in production; opt-in via ENABLE_SCHEDULER in dev.
    // Demo mode suppresses the scheduler regardless of NODE_ENV.
    const shouldStartScheduler =
      (process.env.NODE_ENV === "production" ||
        process.env.ENABLE_SCHEDULER === "true") &&
      !config.demoMode;

    let schedulerStop = () => {};
    if (shouldStartScheduler) {
      const scheduler = startScheduler(db);
      schedulerStop = scheduler.stop;
      console.log("[instrumentation] Scheduler started");
    }

    if (config.autoOpenBrowser) {
      const { exec } = await import("node:child_process");
      exec(`start "" "${config.appUrl}"`);
    }

    const shutdown = () => {
      collector.stop();
      schedulerStop();
      process.exit(0);
    };

    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  }
}
