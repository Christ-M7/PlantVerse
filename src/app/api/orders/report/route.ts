import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { syncOrderProgression } from "@/server/order-sync";
import { buildOrderReport } from "@/lib/order-report";

export const dynamic = "force-dynamic";

/**
 * GET /api/orders/report — full order-history report (up to 100 orders).
 *
 * Unlike GET /api/orders (take: 15, powers the profile/shop cards) this
 * endpoint feeds the printable PDF report: the fulfilment clock runs
 * first, then every order is normalized through the pure builder so the
 * client only renders/prints what the server already aggregated.
 */
export async function GET() {
  try {
    const now = new Date();
    await syncOrderProgression(now);
    const orders = await db.order.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const report = buildOrderReport(orders, now);
    return NextResponse.json({ success: true, report });
  } catch {
    return NextResponse.json({ success: false, error: "server_error" }, { status: 500 });
  }
}
