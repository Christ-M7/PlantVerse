import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  buildGardenHealthHistory,
  HEALTH_WINDOW_DAYS,
  type HealthWindowDays,
} from "@/lib/health-history";

export const dynamic = "force-dynamic";

/**
 * GET /api/garden/health-history — per-plant health time-series for the
 * garden growth report's trend chart.
 *
 * `?days=7|14|30` — chart window (default 30; anything else → 400
 * `invalid_params`, same contract as the reminders year filter).
 * `?plant=<gardenPlant.id>` — optional single-plant filter (404 when the id
 * isn't in the garden; 400 on empty).
 *
 * Plants without logs get a deterministic seeded backfill materialized on
 * first call, ending exactly at the current real health.
 */
export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;

    const rawDays = sp.get("days") ?? "30";
    if (!HEALTH_WINDOW_DAYS.includes(Number(rawDays) as HealthWindowDays)) {
      return NextResponse.json({ success: false, error: "invalid_params" }, { status: 400 });
    }
    const days = Number(rawDays) as HealthWindowDays;

    const plantId = sp.get("plant");
    if (plantId !== null && plantId.trim() === "") {
      return NextResponse.json({ success: false, error: "invalid_params" }, { status: 400 });
    }

    if (plantId) {
      const exists = await db.gardenPlant.findUnique({ where: { id: plantId }, select: { id: true } });
      if (!exists) {
        return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
      }
    }

    const history = await buildGardenHealthHistory(db, days, plantId ?? undefined);
    return NextResponse.json({ success: true, ...history });
  } catch (err) {
    console.error("[health-history]", err);
    return NextResponse.json({ success: false, error: "server_error" }, { status: 500 });
  }
}
