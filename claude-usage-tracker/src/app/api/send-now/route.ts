import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { send } from "@/lib/sender";

export const dynamic = "force-dynamic";

export async function POST() {
  const config = getConfig();
  try {
    const result = await send(config);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[send-now]", err instanceof Error ? err.message : String(err));
    return NextResponse.json(
      { error: "Failed to send message" },
      { status: 500 }
    );
  }
}
