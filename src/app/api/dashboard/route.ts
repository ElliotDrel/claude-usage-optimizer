import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { querySnapshots, getDbMeta } from "@/lib/db";
import { buildDashboardData } from "@/lib/analysis";
import { parseSnapshots } from "@/lib/queries";
import { getCollector } from "@/lib/collector-singleton";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = getConfig();
  const collector = getCollector();
  const rawSnapshots = querySnapshots(config);
  const meta = getDbMeta(config);
  const data = buildDashboardData(parseSnapshots(rawSnapshots), meta, collector.getState());
  return NextResponse.json({ ...data, demoMode: config.demoMode });
}
