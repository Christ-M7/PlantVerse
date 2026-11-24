import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { buildCareCalendar, type IcsCareEvent, type IcsGardenTask } from "@/lib/care-ics";

export const dynamic = "force-dynamic";

/**
 * GET /api/reminders/ics — download the care calendar (.ics)
 *
 * Two modes:
 *  - `?token=PV-CAL-…` (subscribe feed): a calendar client (Google/Apple/
 *    Outlook) polls a stable URL — the token is validated against
 *    CalendarSubscription, invalid tokens get 403 {invalid_token}, valid
 *    ones get the calendar INLINE (no download attachment) and the hit
 *    counter is bumped best-effort (telemetry must never break a feed).
 *  - no token (one-shot download from the UI): served as an attachment,
 *    exactly as before.
 *
 * Composes two sources into one RFC 5545 document:
 *  1. every UNDONE CareEvent row (recurrence occurrences are already
 *     materialized as real rows by the reminders engine — no RRULE needed);
 *  2. each garden plant's upcoming task, dated today + nextTaskDays.
 *
 * Either source failing degrades to the other (never a 500 with no body) —
 * a calendar download must always yield a valid file.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const lang = url.searchParams.get("lang") === "en" ? "en" : "fa";

  /* ── subscribe mode: validate the token before doing any work ── */
  let subscribed = false;
  const token = (url.searchParams.get("token") ?? "").trim();
  if (token) {
    try {
      const sub = await db.calendarSubscription.findUnique({ where: { token } });
      if (!sub) {
        return NextResponse.json({ success: false, error: "invalid_token" }, { status: 403 });
      }
      subscribed = true;
      // honest usage telemetry — best-effort, never blocks/fails the feed
      try {
        await db.calendarSubscription.update({
          where: { id: sub.id },
          data: { hits: { increment: 1 }, lastHitAt: new Date() },
        });
      } catch {
        /* telemetry is optional */
      }
    } catch {
      return NextResponse.json({ success: false, error: "server_error" }, { status: 500 });
    }
  }

  const now = new Date();

  /* ── source 1: undone care reminders (all dates — past-due backlog included) ── */
  let events: IcsCareEvent[] = [];
  try {
    const rows = await db.careEvent.findMany({
      where: { done: false },
      orderBy: { date: "asc" },
    });
    events = rows.map((r) => ({
      id: r.id,
      type: r.type,
      titleFa: r.titleFa,
      titleEn: r.titleEn,
      plantNamesFa: r.plantNamesFa,
      plantNamesEn: r.plantNamesEn,
      date: r.date,
      repeatDays: r.repeatDays,
      done: r.done,
    }));
  } catch {
    events = []; // degrade: garden tasks still export
  }

  /* ── source 2: garden auto-planned tasks (today + nextTaskDays, 0 = today) ── */
  const tasks: IcsGardenTask[] = [];
  try {
    const garden = await db.gardenPlant.findMany({ orderBy: { createdAt: "asc" } });
    for (const g of garden) {
      const days = Number.isFinite(g.nextTaskDays) ? Math.max(0, Math.round(g.nextTaskDays)) : 0;
      const due = new Date(now);
      due.setDate(due.getDate() + days);
      tasks.push({
        plantId: g.id,
        nickname: g.nickname,
        taskType: g.nextTaskType,
        dueDate: due,
        health: g.health,
      });
    }
  } catch {
    // degrade: reminders still export
  }

  const ics = buildCareCalendar({ lang, now, events, tasks });

  return new NextResponse(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      // subscribe feeds must be inline so calendar clients poll them; the
      // one-shot UI download keeps its attachment filename
      "Content-Disposition": `${subscribed ? "inline" : "attachment"}; filename="plantverse-care-calendar-${lang}.ics"`,
      "Cache-Control": "no-store",
    },
  });
}
