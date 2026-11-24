import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { toJalali, jalaliToDate, jalaliMonthLength } from "@/lib/jalali";
import { isoLocalDate, computeStreaks } from "@/lib/streak";
import { aggregateYearEvents } from "@/lib/annual-report";

export const dynamic = "force-dynamic";

/**
 * GET /api/reports/annual?year=jy — server-side annual activity report.
 *
 * Window discipline mirrors the reminders year mode: 1 Farvardin .. last day
 * of Esfand (29 or 30, leap-aware). Aggregation itself lives in
 * `@/lib/annual-report` so the offline client fallback computes identical
 * numbers from fixtures.
 *
 * Streak semantics:
 *  - `streak.current` is GLOBAL (walks the full done history, so a streak
 *    crossing the year boundary stays truthful);
 *  - `streak.best` is the longest done-run INSIDE the viewed year.
 *
 * `year` is optional — defaults to the current jalali year; invalid values
 * return 400 `invalid_params` (same contract as the reminders year mode).
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const now = new Date();
    const todayJ = toJalali(now);

    let jy = todayJ.jy;
    const yearRaw = url.searchParams.get("year");
    if (yearRaw !== null) {
      const n = Number(yearRaw);
      if (!Number.isInteger(n) || n < 1300 || n > 1600) {
        return NextResponse.json({ success: false, error: "invalid_params" }, { status: 400 });
      }
      jy = n;
    }

    const start = jalaliToDate(jy, 1, 1);
    const end = jalaliToDate(jy, 12, jalaliMonthLength(jy, 12));

    const [events, doneRows] = await Promise.all([
      db.careEvent.findMany({
        where: { date: { gte: isoLocalDate(start), lte: isoLocalDate(end) } },
        orderBy: { date: "asc" },
      }),
      db.careEvent.findMany({ where: { done: true }, select: { date: true } }),
    ]);

    const streak = computeStreaks(
      doneRows.map((r) => r.date),
      isoLocalDate(now)
    );
    const agg = aggregateYearEvents(events, jy);

    return NextResponse.json({
      success: true,
      today: isoLocalDate(now),
      jy,
      streak: { current: streak.current, best: agg.bestStreakInYear },
      ...agg,
    });
  } catch {
    return NextResponse.json({ success: false, error: "server_error" }, { status: 500 });
  }
}
