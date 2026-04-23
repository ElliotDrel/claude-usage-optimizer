/**
 * backup.ts
 *
 * In-process GCS backup job. Runs daily at 04:15 UTC. Follows the same
 * registration pattern as src/lib/scheduler.ts.
 *
 * D-01: Backup runs in-process, same pattern as scheduler (no separate systemd timer).
 * D-02: On failure, log and continue (non-fatal).
 */

import { promises as fs } from "node:fs";
import { createReadStream, createWriteStream } from "node:fs";
import zlib from "node:zlib";
import type Database from "better-sqlite3";
import { Storage } from "@google-cloud/storage";
import { backupDatabase } from "./db";
import { getConfig } from "./config";

/**
 * backupToGcs — perform a single GCS backup cycle:
 * 1. Online SQLite backup via backupDatabase()
 * 2. Gzip compression
 * 3. Upload to GCS
 * 4. Cleanup temp files
 *
 * Any step failure logs and continues (D-02, non-fatal).
 */
async function backupToGcs(db: Database.Database): Promise<void> {
  const config = getConfig();
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, "");
  const backupPath = `/tmp/usage-${timestamp}.db`;
  const gzipPath = `${backupPath}.gz`;

  try {
    console.log("[backup] starting database backup");
    await backupDatabase(config, backupPath);

    console.log("[backup] compressing backup");
    const gzipStream = createWriteStream(gzipPath);
    const readStream = createReadStream(backupPath);
    await new Promise<void>((resolve, reject) => {
      readStream
        .pipe(zlib.createGzip())
        .pipe(gzipStream)
        .on("finish", resolve)
        .on("error", reject);
    });

    console.log("[backup] uploading to GCS");
    const bucketName = process.env.GCS_BACKUP_BUCKET;
    if (!bucketName) {
      throw new Error("GCS_BACKUP_BUCKET not configured");
    }

    const storage = new Storage();
    const bucket = storage.bucket(bucketName);
    const objectName = `backups/daily/${timestamp}.db.gz`;
    await bucket.upload(gzipPath, { destination: objectName });

    console.log(`[backup] uploaded to gs://${bucketName}/${objectName}`);

    // Cleanup temp files
    await fs.unlink(backupPath);
    await fs.unlink(gzipPath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[backup] failed: ${msg}`);
    // Do NOT rethrow; do NOT crash the scheduler (D-02)
  }
}

/**
 * scheduleDaily — run a job at a specific UTC time every day.
 *
 * Checks every minute whether the current UTC time matches the target time.
 * If so, fires the job asynchronously (fire-and-forget).
 *
 * @param utcTime — "HH:MM" format (e.g., "04:15")
 * @param job — async function to run
 * @returns interval ID for cleanup
 */
function scheduleDaily(utcTime: string, job: () => Promise<void>): NodeJS.Timeout {
  const [hourStr, minStr] = utcTime.split(":");
  const targetHour = parseInt(hourStr, 10);
  const targetMin = parseInt(minStr, 10);

  const checkAndRun = () => {
    const now = new Date();
    if (now.getUTCHours() === targetHour && now.getUTCMinutes() === targetMin) {
      void job().catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[backup] scheduled job threw: ${msg}`);
      });
    }
  };

  // Check every minute
  return setInterval(checkAndRun, 60_000);
}

/**
 * startBackupJob — register the daily GCS backup job.
 *
 * Returns { stop } for shutdown integration into instrumentation.ts (same pattern as scheduler).
 * Runs at 04:15 UTC daily per D-01.
 *
 * @param db — open better-sqlite3 database handle
 */
export function startBackupJob(db: Database.Database): { stop: () => void } {
  const interval = scheduleDaily("04:15", async () => {
    await backupToGcs(db);
  });

  return { stop: () => clearInterval(interval) };
}
