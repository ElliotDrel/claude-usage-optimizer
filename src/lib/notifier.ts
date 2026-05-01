/**
 * notifier.ts
 *
 * Discord webhook notification sender. Posts to a webhook URL stored in app_meta.
 * Gracefully handles missing URL and webhook unreachability without crashing.
 *
 * D-04: Discord webhook only (ntfy.sh deferred to v2).
 * D-07: Webhook URL is opt-in; if absent or empty, silently skip.
 */

import { getConfig } from "./config";
import { getDb } from "./db";

/**
 * postDiscordNotification — POST a minimal Discord embed to the configured webhook.
 *
 * Returns immediately if webhook URL is not configured (opt-in, D-07).
 * If POST fails, logs the error and continues (non-fatal, D-02).
 *
 * @param title — embed title (e.g., "Send Failure", "Scheduler Stall")
 * @param description — embed description (what happened, why)
 * @param timestamp — optional timestamp; defaults to now
 */
export async function postDiscordNotification(
  title: string,
  description: string,
  timestamp?: Date
): Promise<void> {
  const db = getDb(getConfig());
  const row = db
    .prepare("SELECT value FROM app_meta WHERE key = ?")
    .get("notification_webhook_url") as { value: string } | undefined;

  if (!row?.value) {
    console.log("[notifier] webhook URL not configured, skipping notification");
    return;
  }

  const webhookUrl = row.value;
  const now = timestamp ?? new Date();

  const payload = {
    embeds: [
      {
        title,
        description,
        timestamp: now.toISOString(),
        color: 0xff0000, // Red for failures
      },
    ],
  };

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.warn(
        `[notifier] webhook POST failed: ${response.status} ${response.statusText}`
      );
      // Do NOT rethrow — log and continue
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[notifier] webhook error: ${msg}`);
    // Do NOT rethrow — log and continue (non-fatal, D-02)
  }
}
