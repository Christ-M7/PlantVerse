import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { advanceOrderRow } from "@/server/order-sync";
import { buildOrderTracking } from "@/lib/order-tracking";
import { faDigits } from "@/lib/greenhouse";

export const dynamic = "force-dynamic";

const CODE_RE = /^PV-[A-Z0-9]{6}$/;

/**
 * GET /api/orders/tracking?code=PV-XXXXXX — live fulfilment timeline for
 * one order. The heavy lifting (deterministic stage instants, ETA, progress)
 * lives in the pure builder src/lib/order-tracking.ts so tests pin the
 * math directly; the recorded status is first advanced to what elapsed
 * time demands (advanceOrderRow) so the store and the clock agree.
 *
 * Contract: invalid code → 400 invalid_code · unknown code → 404 not_found
 * (retry-safe) · otherwise 200 { success, order, tracking }.
 */
export async function GET(req: Request) {
  try {
    const code = (new URL(req.url).searchParams.get("code") ?? "").trim().toUpperCase();
    if (!CODE_RE.test(code)) {
      return NextResponse.json({ success: false, error: "invalid_code" }, { status: 400 });
    }

    const order = await db.order.findUnique({
      where: { code },
      select: {
        code: true,
        status: true,
        createdAt: true,
        city: true,
        total: true,
      },
    });
    if (!order) {
      return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
    }

    /* the recorded status catches up with elapsed fulfilment time
       (one targeted write only when the clock demands it) */
    const status = await advanceOrderRow(order);
    const tracking = buildOrderTracking({ code: order.code, status, createdAt: order.createdAt }, new Date(), faDigits);
    return NextResponse.json({ success: true, order: { ...order, status }, tracking });
  } catch (err) {
    console.error("[order-tracking]", err);
    return NextResponse.json({ success: false, error: "server_error" }, { status: 500 });
  }
}
