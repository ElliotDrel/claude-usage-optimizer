import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { querySnapshots, getDbMeta } from "@/lib/db";
import { buildDashboardData } from "@/lib/analysis";
import { getCollector } from "@/lib/collector-singleton";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = getConfig();
  const collector = getCollector();
  const snapshots = querySnapshots(config);
  const meta = getDbMeta(config);
  const data = buildDashboardData(snapshots, meta, collector.getState());
  return NextResponse.json({ ...data, demoMode: config.demoMode });
}
