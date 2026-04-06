import { getConfig } from "./config";
import { getDb } from "./db";
import { UsageCollector } from "./collector";

// Singleton collector instance shared across API routes.
// Next.js may re-import modules; globalThis ensures one instance.

const globalForCollector = globalThis as unknown as {
  _usageCollector?: UsageCollector;
};

export function getCollector(): UsageCollector {
  if (!globalForCollector._usageCollector) {
    const config = getConfig();
    getDb(config); // ensure DB is initialized
    const collector = new UsageCollector(config);
    collector.start();
    globalForCollector._usageCollector = collector;
  }
  return globalForCollector._usageCollector;
}
