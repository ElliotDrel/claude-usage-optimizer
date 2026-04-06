export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Start the collector when the Next.js server boots
    const { getCollector } = await import("./lib/collector-singleton");
    const collector = getCollector();
    console.log("[instrumentation] Collector started");

    const shutdown = () => {
      collector.stop();
      process.exit(0);
    };

    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  }
}
