import { NextResponse, type NextRequest } from "next/server";
import { getConfig } from "@/lib/config";
import { querySnapshots } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const config = getConfig();
  const params = request.nextUrl.searchParams;

  const snapshots = querySnapshots(config, {
    since: params.get("since") ?? undefined,
    until: params.get("until") ?? undefined,
    status: params.get("status") ?? undefined,
    limit: params.has("limit") ? parseInt(params.get("limit")!, 10) : undefined,
  });

  return NextResponse.json(snapshots);
}
