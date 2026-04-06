import { NextResponse } from "next/server";
import { getCollector } from "@/lib/collector-singleton";

export const dynamic = "force-dynamic";

export async function POST() {
  const collector = getCollector();
  const result = await collector.pollOnce();
  return NextResponse.json({ ok: result.status === "ok", ...result });
}
