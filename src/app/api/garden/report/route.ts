import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { buildGardenHealthHistory } from "@/lib/health-history";
import { buildGardenReport } from "@/lib/garden-report";
import { isoLocalDate } from "@/lib/streak";

export const dynamic = "force-dynamic";

/**
 * GET /api/garden/report — month-in-review report for the printable
 * garden PDF («گزارش باغ»). 
 *
 * Riding the same pipeline as GET /api/orders/report: the server
 * aggregates (health history incl. the lazy backfill, done-care counts,
 * upcoming events), then the pure builder normalizes — the client only
 * renders/prints what the server already computed.
 *
 * Trend window: 30 days (the health chart's largest window).
 */
export async function GET() {
  try {
    const now = new Date();
    const todayIso = isoLocalDate(now);

    /* history first — it lazily materializes the seeded backfill, so the
       trend column is never empty for real plants */
    const history = await buildGardenHealthHistory(db, 30);

    const [rows, upcoming] = await Promise.all([
      db.gardenPlant.findMany({ orderBy: { createdAt: "asc" } }),
      db.careEvent.findMany({
        where: { done: false, date: { gte: todayIso } },
        orderBy: { date: "asc" },
        take: 50,
      }),
    ]);

    const report = buildGardenReport({ history, rows, upcoming }, now);
    return NextResponse.json({ success: true, report });
  } catch (err) {
    console.error("[garden-report]", err);
    return NextResponse.json({ success: false, error: "server_error" }, { status: 500 });
  }
}
