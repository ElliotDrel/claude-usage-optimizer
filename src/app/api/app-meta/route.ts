import { NextResponse, NextRequest } from "next/server";
import { getConfig } from "@/lib/config";
import { setAppMeta, getAppMeta } from "@/lib/db";
import { recomputeSchedule } from "@/lib/scheduler";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/app-meta
 *
 * Writes a single key-value pair to app_meta and immediately triggers schedule recompute.
 * Returns the newly computed schedule_fires so the client sees the update immediately.
 *
 * Request body: { key: string, value: string }
 * Response: { success: true, key: string, value: string, scheduleFires: FireTime[] | null }
 *
 * Supported keys (per REQUIREMENTS.md DATA-04):
 * - schedule_override_start_time (format "HH:MM")
 * - peak_window_hours (integer 3–6)
 * - anchor_offset_minutes (integer 0–15)
 * - default_seed_time (format "HH:MM")
 * - user_timezone (IANA name or UTC offset)
 * - paused ("true" or "false" string)
 */
export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as { key?: string; value?: string };
    if (!body.key || body.value === undefined) {
      return NextResponse.json(
        { error: "Missing key or value in request body" },
        { status: 400 }
      );
    }

    const config = getConfig();

    // 1. Write the override to app_meta
    setAppMeta(config, body.key, body.value);

    // 2. Immediately recompute the schedule based on new state
    recomputeSchedule(config);

    // 3. Return the schedule_fires to the client
    const meta = getAppMeta(config);
    const newScheduleFires = meta.get("schedule_fires");

    return NextResponse.json({
      success: true,
      key: body.key,
      value: body.value,
      scheduleFires: newScheduleFires ? JSON.parse(newScheduleFires) : null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[app-meta]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
