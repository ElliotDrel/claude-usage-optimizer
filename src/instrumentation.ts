export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Start the collector when the Next.js server boots
    const { getCollector } = await import("./lib/collector-singleton");
    const collector = getCollector();
    console.log("[instrumentation] Collector started");

    // Auto-open browser (port must match -p flag in package.json)
    const { exec } = await import("node:child_process");
    exec('start "" "http://localhost:3017"');

    const shutdown = () => {
      collector.stop();
      process.exit(0);
    };

    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  }
}
