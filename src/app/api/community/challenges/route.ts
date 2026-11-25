import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Community Monthly Challenges («چالش‌های ماهانه»). 
 *
 * A month-scoped engagement surface: three deterministic challenges are
 * seeded idempotently for the current month on first GET (stable `key`
 * = `${year}-${MM}-${slug}` so concurrent callers converge on the same
 * rows). Viewers join, log progress (clamped to [0, goal]) and leave;
 * a leaderboard per challenge ranks participants by progress DESC with
 * updatedAt ASC tie-break (first to reach wins). History is queryable
 * with explicit ?year=&month= (no auto-seed for past/future months).
 */

/* ── deterministic monthly catalogue ─────────────────────────────────────── */

const MONTHLY_CHALLENGES = [
  {
    slug: "watering-streak",
    titleFa: "آبیاری منظم",
    titleEn: "Watering streak",
    descFa: "در این ماه ۲۰ روز به گیاهانت آب بده و روتین آبیاری‌ات را تثبیت کن.",
    descEn: "Water your plants on 20 days this month and lock in the routine.",
    emoji: "💧",
    goal: 20,
    unitFa: "آبیاری",
    unitEn: "waterings",
  },
  {
    slug: "new-leaf-friend",
    titleFa: "گیاه تازه، دوست تازه",
    titleEn: "New leaf friend",
    descFa: "۲ گیاه جدید به باغچه‌ات اضافه کن و از آن‌ها عکس بگیر.",
    descEn: "Add 2 new plants to your garden and photograph them.",
    emoji: "🌿",
    goal: 2,
    unitFa: "گیاه جدید",
    unitEn: "new plants",
  },
  {
    slug: "plant-detective",
    titleFa: "کارآگاه گیاهان",
    titleEn: "Plant detective",
    descFa: "۵ گیاه ناشناس را با اسکنر شناسایی کن و مشخصاتشان را یاد بگیر.",
    descEn: "Identify 5 unknown plants with the scanner and learn their care.",
    emoji: "🔍",
    goal: 5,
    unitFa: "اسکن",
    unitEn: "scans",
  },
] as const;

/** Idempotent seed: upsert by stable key, so GET never duplicates rows.
 *  Sequential (not Promise.all) so createdAt — and therefore catalogue
 *  display order — follows the code-defined sequence deterministically. */
async function ensureMonthChallenges(year: number, month: number) {
  const rows: Awaited<ReturnType<typeof db.challenge.upsert>>[] = [];
  for (const c of MONTHLY_CHALLENGES) {
    const key = `${year}-${String(month).padStart(2, "0")}-${c.slug}`;
    rows.push(
      await db.challenge.upsert({
        where: { key },
        create: {
          key,
          titleFa: c.titleFa,
          titleEn: c.titleEn,
          descFa: c.descFa,
          descEn: c.descEn,
          emoji: c.emoji,
          goal: c.goal,
          unitFa: c.unitFa,
          unitEn: c.unitEn,
          year,
          month,
        },
        update: {}, // catalogue is code-owned — never overwrite live edits
      })
    );
  }
  return rows;
}

const LEADER_LIMIT = 5;

type JoinRow = { name: string; progress: number; viewerKey: string; updatedAt: Date };

/** Leaderboard shaping: rank by progress DESC, earlier update wins ties. */
function shapeLeaders(joins: JoinRow[], viewerKey: string) {
  const sorted = [...joins].sort(
    (a, b) => b.progress - a.progress || a.updatedAt.getTime() - b.updatedAt.getTime()
  );
  return sorted.map((j, i) => ({
    rank: i + 1,
    name: j.name,
    progress: j.progress,
    isMe: viewerKey !== "" && j.viewerKey === viewerKey,
  }));
}

const rankOf = (leaders: { rank: number; isMe: boolean }[]) =>
  leaders.find((l) => l.isMe)?.rank ?? null;

/* ── schemas ─────────────────────────────────────────────────────────────── */

const joinSchema = z.object({
  challengeId: z.string().min(1),
  viewerKey: z.string().min(1).max(64),
  name: z.string().min(1).max(60),
});

const progressSchema = z.object({
  challengeId: z.string().min(1),
  viewerKey: z.string().min(1).max(64),
  /** delta mode (default +1) or absolute progress — at least one required */
  delta: z.number().int().min(-20).max(20).optional(),
  progress: z.number().int().min(0).max(1000).optional(),
});

const leaveSchema = z.object({
  challengeId: z.string().min(1),
  viewerKey: z.string().min(1).max(64),
});

const bad = (msg: string, status: number) =>
  NextResponse.json({ success: false, error: msg }, { status });

/* ── GET — list challenges (auto-seeds the current month) ─────────────────── */

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const viewer = url.searchParams.get("viewer") ?? "";
    const now = new Date();
    let year = now.getFullYear();
    let month = now.getMonth() + 1;
    const qy = url.searchParams.get("year");
    const qm = url.searchParams.get("month");
    if (qy && qm) {
      const y = Number(qy);
      const m = Number(qm);
      if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12 || y < 2020 || y > 2100) {
        return bad("invalid_month", 400);
      }
      year = y;
      month = m;
    }

    // only the live month self-seeds — past/future queries are read-only
    if (year === now.getFullYear() && month === now.getMonth() + 1) {
      await ensureMonthChallenges(year, month);
    }
    const challenges = await db.challenge.findMany({
      where: { year, month },
      orderBy: { createdAt: "asc" },
      include: { joins: { orderBy: [{ progress: "desc" }, { updatedAt: "asc" }] } },
    });

    return NextResponse.json({
      success: true,
      year,
      month,
      challenges: challenges.map((c) => {
        const ranked = shapeLeaders(c.joins, viewer);
        const leaders = ranked.slice(0, LEADER_LIMIT);
        const mine = viewer ? (c.joins.find((j) => j.viewerKey === viewer) ?? null) : null;
        return {
          id: c.id,
          key: c.key,
          titleFa: c.titleFa,
          titleEn: c.titleEn,
          descFa: c.descFa,
          descEn: c.descEn,
          emoji: c.emoji,
          goal: c.goal,
          unitFa: c.unitFa,
          unitEn: c.unitEn,
          participants: c.joins.length,
          me: mine
          ? { progress: mine.progress, rank: ranked.find((l) => l.isMe)?.rank ?? null }
          : null,
          leaders,
        };
      }),
    });
  } catch (err) {
    console.error("[challenges:GET]", err);
    return bad("server_error", 500);
  }
}

/* ── POST — join a challenge (idempotent) ────────────────────────────────── */

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const parsed = joinSchema.safeParse(body);
    if (!parsed.success) return bad("invalid_body", 400);
    const { challengeId, viewerKey, name } = parsed.data;

    const challenge = await db.challenge.findUnique({ where: { id: challengeId } });
    if (!challenge) return bad("challenge_not_found", 404);

    const before = await db.challengeJoin.findUnique({
      where: { challengeId_viewerKey: { challengeId, viewerKey } },
    });
    // re-join keeps existing progress — joining twice is never destructive
    const join = await db.challengeJoin.upsert({
      where: { challengeId_viewerKey: { challengeId, viewerKey } },
      create: { challengeId, viewerKey, name },
      update: {},
    });
    const participants = await db.challengeJoin.count({ where: { challengeId } });

    return NextResponse.json({
      success: true,
      alreadyJoined: before !== null,
      joined: { progress: join.progress, name: join.name },
      participants,
    });
  } catch (err) {
    console.error("[challenges:POST]", err);
    return bad("server_error", 500);
  }
}

/* ── PATCH — log progress (delta or absolute, clamped to goal) ───────────── */

export async function PATCH(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const parsed = progressSchema.safeParse(body);
    if (!parsed.success) return bad("invalid_body", 400);
    const { challengeId, viewerKey } = parsed.data;
    if (parsed.data.delta === undefined && parsed.data.progress === undefined) {
      return bad("missing_progress", 400);
    }

    const challenge = await db.challenge.findUnique({ where: { id: challengeId } });
    if (!challenge) return bad("challenge_not_found", 404);

    const existing = await db.challengeJoin.findUnique({
      where: { challengeId_viewerKey: { challengeId, viewerKey } },
    });
    if (!existing) return bad("not_joined", 404);

    const target =
      parsed.data.progress !== undefined
        ? parsed.data.progress
        : existing.progress + (parsed.data.delta ?? 1);
    const progress = Math.max(0, Math.min(challenge.goal, target));

    const join = await db.challengeJoin.update({
      where: { challengeId_viewerKey: { challengeId, viewerKey } },
      data: { progress },
    });

    const all = await db.challengeJoin.findMany({ where: { challengeId } });
    const leaders = shapeLeaders(all, viewerKey);
    return NextResponse.json({
      success: true,
      progress: join.progress,
      goal: challenge.goal,
      completed: join.progress >= challenge.goal,
      rank: leaders.find((l) => l.isMe)?.rank ?? null,
      participants: all.length,
      leaders: leaders.slice(0, LEADER_LIMIT),
    });
  } catch (err) {
    console.error("[challenges:PATCH]", err);
    return bad("server_error", 500);
  }
}

/* ── DELETE — leave a challenge ──────────────────────────────────────────── */

export async function DELETE(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const parsed = leaveSchema.safeParse(body);
    if (!parsed.success) return bad("invalid_body", 400);
    const { challengeId, viewerKey } = parsed.data;

    const challenge = await db.challenge.findUnique({ where: { id: challengeId } });
    if (!challenge) return bad("challenge_not_found", 404);

    const existing = await db.challengeJoin.findUnique({
      where: { challengeId_viewerKey: { challengeId, viewerKey } },
    });
    if (!existing) return bad("not_joined", 404);

    await db.challengeJoin.delete({
      where: { challengeId_viewerKey: { challengeId, viewerKey } },
    });
    const participants = await db.challengeJoin.count({ where: { challengeId } });
    return NextResponse.json({ success: true, participants });
  } catch (err) {
    console.error("[challenges:DELETE]", err);
    return bad("server_error", 500);
  }
}
