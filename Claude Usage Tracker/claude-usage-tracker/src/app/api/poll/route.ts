import { NextRequest, NextResponse } from "next/server";
import { getCollector } from "@/lib/collector-singleton";

export const dynamic = "force-dynamic";

const COOLDOWN_MS = 30_000;

export async function POST(request: NextRequest) {
  const collector = getCollector();
  const state = collector.getState();

  // Check cooldown unless force flag is set
  const body = await request.json().catch(() => ({}));
  const force = (body as Record<string, unknown>)?.force === true;

  if (!force && state.lastAttemptAt) {
    const elapsed = Date.now() - new Date(state.lastAttemptAt).getTime();
    if (elapsed < COOLDOWN_MS) {
      const retryIn = Math.ceil((COOLDOWN_MS - elapsed) / 1000);
      return NextResponse.json(
        { ok: false, status: "cooldown", retryInSeconds: retryIn },
        { status: 429 }
      );
    }
  }

  const result = await collector.pollOnce();
  return NextResponse.json({ ok: result.status === "ok", ...result });
}
