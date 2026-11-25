import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { toJalali, jalaliToDate, jalaliMonthLength } from "@/lib/jalali";

export const dynamic = "force-dynamic";

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Parse an ISO yyyy-mm-dd string into a local Date (avoids UTC shift). */
const fromIso = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
};

/* ── recurrence engine shared by POST (series materialization) and PATCH ── */

/**
 * Recurring series are materialized up-front so the whole calendar horizon is
 * browsable without completing anything first. Two caps keep rows bounded:
 * SERIES_MAX_OCCURRENCES rows total and SERIES_HORIZON_DAYS days ahead.
 * (weekly → 16 rows ≈ 16 weeks; monthly → 4 rows ≈ 4 months)
 */
const SERIES_MAX_OCCURRENCES = 16;
const SERIES_HORIZON_DAYS = 120;

/**
 * Next occurrence of a rule anchored at `from`.
 * Day-based rules (1..29) add N days; the monthly rule (30) advances one
 * jalali month keeping the day-of-month (clamped to the month length).
 */
const nextOccurrenceDate = (from: Date, repeatDays: number): Date => {
  if (repeatDays === 30) {
    const j = toJalali(from);
    const nm = j.jm === 12 ? 1 : j.jm + 1;
    const ny = j.jm === 12 ? j.jy + 1 : j.jy;
    return jalaliToDate(ny, nm, Math.min(j.jd, jalaliMonthLength(ny, nm)));
  }
  const d = new Date(from);
  d.setDate(d.getDate() + repeatDays);
  return d;
};

/* ── GET /api/reminders — care events for one jalali month (?jy=&jm=) or a whole year (?year=jy) ── */

/**
 * Two windows, one endpoint:
 *  - `?jy=&jm=` → that month's events (calendar UI navigation)
 *  - `?year=jy` → every event inside the jalali year (annual heatmap view);
 *    window = 1 Farvardin .. last day of Esfand (29 or 30, leap-aware)
 *
 * Both return jy (+jm for the month window) echoes so the client can discard
 * stale responses after fast switching.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const now = new Date();
    const todayJ = toJalali(now);

    /* ── year mode ── */
    const yearRaw = url.searchParams.get("year");
    if (yearRaw !== null) {
      const jy = Number(yearRaw);
      if (!Number.isInteger(jy) || jy < 1300 || jy > 1600) {
        return NextResponse.json({ success: false, error: "invalid_params" }, { status: 400 });
      }
      const start = jalaliToDate(jy, 1, 1);
      const end = jalaliToDate(jy, 12, jalaliMonthLength(jy, 12));
      const events = await db.careEvent.findMany({
        where: { date: { gte: iso(start), lte: iso(end) } },
        orderBy: { date: "asc" },
      });
      return NextResponse.json({ success: true, today: iso(now), jy, events });
    }

    /* ── month mode (default) ── */
    const jyRaw = url.searchParams.get("jy");
    const jmRaw = url.searchParams.get("jm");
    let jy = todayJ.jy;
    let jm = todayJ.jm;
    if (jyRaw !== null || jmRaw !== null) {
      jy = Number(jyRaw);
      jm = Number(jmRaw);
      if (!Number.isInteger(jy) || !Number.isInteger(jm) || jy < 1300 || jy > 1600 || jm < 1 || jm > 12) {
        return NextResponse.json({ success: false, error: "invalid_params" }, { status: 400 });
      }
    }

    const monthLen = jalaliMonthLength(jy, jm);
    const start = jalaliToDate(jy, jm, 1);
    const end = jalaliToDate(jy, jm, monthLen);

    const events = await db.careEvent.findMany({
      where: { date: { gte: iso(start), lte: iso(end) } },
      orderBy: { date: "asc" },
    });
    return NextResponse.json({ success: true, today: iso(now), jy, jm, events });
  } catch {
    return NextResponse.json({ success: false, error: "server_error" }, { status: 500 });
  }
}

/* ── POST /api/reminders — create a care reminder (+ materialize its series) ─ */

const TASK_LABEL: Record<string, { fa: string; en: string }> = {
  water: { fa: "آبیاری", en: "Watering" },
  fertilize: { fa: "کوددهی", en: "Fertilizing" },
  prune: { fa: "هرس", en: "Pruning" },
  spray: { fa: "سمپاشی", en: "Spraying" },
};

const createSchema = z.object({
  type: z.enum(["water", "fertilize", "prune", "spray"]),
  jy: z.number().int().min(1300).max(1600).optional(), // jalali year (default: current)
  jm: z.number().int().min(1).max(12).optional(), // jalali month (default: current)
  jd: z.number().int().min(1).max(31).optional(), // jalali day-of-month
  plantNamesFa: z.string().max(120).optional(),
  plantNamesEn: z.string().max(120).optional(),
  repeatDays: z.number().int().min(0).max(30).optional(), // 0 = one-time; N = repeats every N days (30 = monthly)
});

export async function POST(req: Request) {
  try {
    const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: "invalid_body" }, { status: 400 });
    }
    const { type, plantNamesFa, plantNamesEn } = parsed.data;
    const repeatDays = parsed.data.repeatDays ?? 0;

    const todayJ = toJalali(new Date());
    const jy = parsed.data.jy ?? todayJ.jy;
    const jm = parsed.data.jm ?? todayJ.jm;
    const monthLen = jalaliMonthLength(jy, jm);
    // default day = today's jalali day-of-month (never the Gregorian one)
    const jd = Math.min(parsed.data.jd ?? todayJ.jd, monthLen);

    const date = jalaliToDate(jy, jm, jd);
    const label = TASK_LABEL[type];

    /**
     * One recurrence rule → one seriesId shared by every occurrence row.
     * One-time reminders keep the legacy "" (no series semantics).
     */
    const seriesId = repeatDays > 0 ? randomUUID() : "";
    const base = {
      type,
      titleFa: label.fa,
      titleEn: label.en,
      plantNamesFa: plantNamesFa?.trim() || "گیاهان من",
      plantNamesEn: plantNamesEn?.trim() || "My plants",
      done: false,
      repeatDays,
      seriesId,
    };

    const anchor = await db.careEvent.create({
      data: { ...base, date: iso(date), dayOffset: jd },
    });
    const series = [anchor];

    /**
     * Horizon materialization — walk the rule forward from the anchor and
     * persist every occurrence inside the caps. Each occurrence is a real row
     * so toggling done / deleting per occurrence keeps working, and PATCH's
     * self-extension only kicks in past the last materialized one.
     */
    if (repeatDays > 0) {
      const horizonEnd = new Date(date);
      horizonEnd.setDate(horizonEnd.getDate() + SERIES_HORIZON_DAYS);
      let cursor = date;
      while (series.length < SERIES_MAX_OCCURRENCES) {
        cursor = nextOccurrenceDate(cursor, repeatDays);
        if (cursor > horizonEnd) break;
        const j = toJalali(cursor);
        series.push(
          await db.careEvent.create({
            data: { ...base, date: iso(cursor), dayOffset: j.jd },
          })
        );
      }
    }

    return NextResponse.json({ success: true, event: anchor, series }, { status: 201 });
  } catch {
    return NextResponse.json({ success: false, error: "server_error" }, { status: 500 });
  }
}

/* ── PATCH /api/reminders — mark done / undone (+ self-extending series) ─── */

const patchSchema = z.object({
  id: z.string().min(1),
  done: z.boolean(),
});

export async function PATCH(req: Request) {
  try {
    const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: "invalid_body" }, { status: 400 });
    }
    const { id, done } = parsed.data;
    const existing = await db.careEvent.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
    }

    const event = await db.careEvent.update({ where: { id }, data: { done } });

    /**
     * Recurrence engine — completing a repeating event extends its series past
     * the materialized horizon. The dedup guard is series-aware (matches on
     * seriesId for new rows, legacy signature for pre-series rows) so the next
     * occurrence is only created when nothing of the same series already sits
     * on that date — un-do → re-done toggles never pile up duplicates.
     */
    let next: Awaited<ReturnType<typeof db.careEvent.create>> | null = null;
    if (!existing.done && done && existing.repeatDays > 0) {
      const nextDate = nextOccurrenceDate(fromIso(existing.date), existing.repeatDays);
      const nextIso = iso(nextDate);

      const duplicate = await db.careEvent.findFirst({
        where: {
          type: existing.type,
          titleFa: existing.titleFa,
          plantNamesFa: existing.plantNamesFa,
          date: nextIso,
          ...(existing.seriesId ? { seriesId: existing.seriesId } : {}),
        },
      });

      if (!duplicate) {
        const { jd: nextJd } = toJalali(nextDate);
        next = await db.careEvent.create({
          data: {
            type: existing.type,
            titleFa: existing.titleFa,
            titleEn: existing.titleEn,
            plantNamesFa: existing.plantNamesFa,
            plantNamesEn: existing.plantNamesEn,
            date: nextIso,
            dayOffset: nextJd,
            done: false,
            repeatDays: existing.repeatDays,
            seriesId: existing.seriesId,
          },
        });
      }
    }

    return NextResponse.json({ success: true, event, next });
  } catch {
    return NextResponse.json({ success: false, error: "server_error" }, { status: 500 });
  }
}

/* ── DELETE /api/reminders — remove one occurrence or a whole series ─────── */

const deleteSchema = z.object({
  id: z.string().min(1),
  scope: z.enum(["one", "series"]).optional(),
});

export async function DELETE(req: Request) {
  try {
    let rawId = "";
    let scope: string | undefined;
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      rawId = String(body.id ?? "").trim();
      scope = typeof body.scope === "string" ? body.scope : undefined;
    }
    if (!rawId) {
      const sp = new URL(req.url).searchParams;
      rawId = String(sp.get("id") ?? "").trim();
      if (!scope) scope = sp.get("scope") ?? undefined;
    }
    if (!rawId) {
      return NextResponse.json({ success: false, error: "missing_id" }, { status: 400 });
    }
    const id = rawId.slice(0, 40);

    const existing = await db.careEvent.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
    }

    if (scope === "series" && existing.seriesId) {
      // whole recurrence rule — every occurrence, any month
      const removed = await db.careEvent.deleteMany({ where: { seriesId: existing.seriesId } });
      return NextResponse.json({ success: true, id, scope, removed: removed.count });
    }

    await db.careEvent.delete({ where: { id } });
    return NextResponse.json({ success: true, id, removed: 1 });
  } catch {
    return NextResponse.json({ success: false, error: "server_error" }, { status: 500 });
  }
}
