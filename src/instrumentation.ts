export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Start the collector when the Next.js server boots
    const { getCollector } = await import("./lib/collector-singleton");
    const { getConfig } = await import("./lib/config");
    const collector = getCollector();
    const config = getConfig();
    console.log("[instrumentation] Collector started");

    if (config.autoOpenBrowser) {
      const { exec } = await import("node:child_process");
      exec(`start "" "${config.appUrl}"`);
    }

    const shutdown = () => {
      collector.stop();
      process.exit(0);
    };

    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  }
}
