export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Start the collector when the Next.js server boots
    const { getCollector } = await import("./lib/collector-singleton");
    const collector = getCollector();
    console.log("[instrumentation] Collector started");

    // Auto-open browser
    const port = process.env.PORT || "3017";
    const url = `http://localhost:${port}`;
    const { exec } = await import("node:child_process");
    exec(`start "" "${url}"`);

    const shutdown = () => {
      collector.stop();
      process.exit(0);
    };

    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  }
}
