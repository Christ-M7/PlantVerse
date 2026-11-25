import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { isoLocalDate, computeStreaks } from "@/lib/streak";
import { buildGardenHealthHistory, HEALTH_WINDOW_DAYS, type HealthWindowDays } from "@/lib/health-history";

export const dynamic = "force-dynamic";

/* ── helpers ─────────────────────────────────────────────────────────────── */

const TASK_ROTATION = ["water", "fertilize", "prune", "spray"] as const;

const TASK_TEXT: Record<string, { fa: string; en: string }> = {
  water: { fa: "تا آبیاری بعدی", en: "Next watering in" },
  fertilize: { fa: "تا کوددهی", en: "Next feeding in" },
  prune: { fa: "تا هرس", en: "Next pruning in" },
  spray: { fa: "تا سمپاشی", en: "Next spraying in" },
};

const WATER_DAYS: Record<string, number> = { high: 2, medium: 5, low: 9 };

function healthMeta(health: number) {
  if (health >= 85) return { statusFa: "عالی", statusEn: "excellent", healthLabelFa: "سلامت عالی", healthLabelEn: "Excellent" };
  if (health >= 70) return { statusFa: "خوب", statusEn: "good", healthLabelFa: "سلامت خوب", healthLabelEn: "Good" };
  if (health >= 50) return { statusFa: "متوسط", statusEn: "medium", healthLabelFa: "نیاز به توجه", healthLabelEn: "Needs care" };
  return { statusFa: "ضعیف", statusEn: "low", healthLabelFa: "وضعیت بحرانی", healthLabelEn: "Critical" };
}

/* ── GET /api/garden — user's garden dashboard data ──────────────────────── */

export async function GET() {
  try {
    const garden = await db.gardenPlant.findMany({ orderBy: { createdAt: "asc" } });
    const slugs = garden.map((g) => g.plantSlug);
    const plants = await db.plant.findMany({
      where: { slug: { in: slugs } },
      select: { slug: true, image: true, nameFa: true, nameEn: true, water: true },
    });
    const bySlug = new Map(plants.map((p) => [p.slug, p]));
    const enriched = garden.map((g) => ({
      ...g,
      image: bySlug.get(g.plantSlug)?.image ?? "",
      plantNameFa: bySlug.get(g.plantSlug)?.nameFa ?? g.nickname,
      plantNameEn: bySlug.get(g.plantSlug)?.nameEn ?? g.nickname,
    }));
    const avgHealth = garden.length
      ? Math.round(garden.reduce((s, g) => s + g.health, 0) / garden.length)
      : 0;
    const tasksToday = garden.filter((g) => g.nextTaskDays <= 1).length;

    /* real streak from the shared engine (was hardcoded 7 — data-correctness fix) */
    const doneRows = await db.careEvent.findMany({ where: { done: true }, select: { date: true } });
    const streak = computeStreaks(
      doneRows.map((r) => r.date),
      isoLocalDate(new Date())
    );

    return NextResponse.json({
      success: true,
      plants: enriched,
      stats: {
        total: garden.length,
        avgHealth,
        streakDays: streak.current,
        tasksToday,
      },
    });
  } catch {
    return NextResponse.json({ success: false, error: "server_error" }, { status: 500 });
  }
}

/* ── POST /api/garden — add a plant to the garden ────────────────────────── */

const addSchema = z.object({
  slug: z.string().min(1).max(80),
  nickname: z.string().max(60).optional(),
});

export async function POST(req: Request) {
  try {
    const parsed = addSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: "invalid_body" }, { status: 400 });
    }
    const { slug, nickname } = parsed.data;

    const plant = await db.plant.findUnique({ where: { slug } });
    if (!plant) {
      return NextResponse.json({ success: false, error: "plant_not_found" }, { status: 404 });
    }

    const exists = await db.gardenPlant.findFirst({ where: { plantSlug: slug } });
    if (exists) {
      return NextResponse.json({ success: false, error: "already_in_garden" }, { status: 409 });
    }

    const nextTaskType = "water";
    const nextTaskDays = WATER_DAYS[plant.water] ?? 5;
    const created = await db.gardenPlant.create({
      data: {
        nickname: nickname?.trim() || plant.nameFa,
        plantSlug: slug,
        health: 90,
        ...healthMeta(90),
        nextTaskType,
        nextTaskFa: TASK_TEXT[nextTaskType].fa,
        nextTaskEn: TASK_TEXT[nextTaskType].en,
        nextTaskDays,
        noteFa: "",
        noteEn: "",
      },
    });

    /* seed the health series with the creation snapshot */
    await db.gardenHealthLog.create({
      data: { plantId: created.id, health: 90, source: "create" },
    });

    return NextResponse.json({
      success: true,
      plant: {
        ...created,
        image: plant.image,
        plantNameFa: plant.nameFa,
        plantNameEn: plant.nameEn,
      },
    });
  } catch {
    return NextResponse.json({ success: false, error: "server_error" }, { status: 500 });
  }
}

/* ── PATCH /api/garden — complete care task / adjust health ──────────────── */

const patchSchema = z.object({
  id: z.string().min(1),
  completeTask: z.boolean().optional(),
  health: z.number().int().min(0).max(100).optional(),
});

export async function PATCH(req: Request) {
  try {
    const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: "invalid_body" }, { status: 400 });
    }
    const { id, completeTask, health } = parsed.data;

    const current = await db.gardenPlant.findUnique({ where: { id } });
    if (!current) {
      return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
    }

    let newHealth = health ?? current.health;
    let nextTaskType = current.nextTaskType;
    let nextTaskDays = current.nextTaskDays;

    if (completeTask) {
      newHealth = Math.min(100, current.health + 4);
      const idx = TASK_ROTATION.indexOf(current.nextTaskType as (typeof TASK_ROTATION)[number]);
      nextTaskType = TASK_ROTATION[(idx + 1) % TASK_ROTATION.length];
      const plant = await db.plant.findUnique({ where: { slug: current.plantSlug }, select: { water: true } });
      nextTaskDays = WATER_DAYS[plant?.water ?? "medium"] ?? 5;
    }

    const updated = await db.gardenPlant.update({
      where: { id },
      data: {
        health: newHealth,
        ...healthMeta(newHealth),
        nextTaskType,
        nextTaskFa: TASK_TEXT[nextTaskType]?.fa ?? TASK_TEXT.water.fa,
        nextTaskEn: TASK_TEXT[nextTaskType]?.en ?? TASK_TEXT.water.en,
        nextTaskDays,
      },
    });

    /* health time-series: every mutation appends one honest row */
    await db.gardenHealthLog.create({
      data: {
        plantId: id,
        health: newHealth,
        source: completeTask ? "task" : "manual",
      },
    });

    return NextResponse.json({ success: true, plant: updated });
  } catch {
    return NextResponse.json({ success: false, error: "server_error" }, { status: 500 });
  }
}

/* ── DELETE /api/garden?id= — remove a plant from the garden ─────────────── */

export async function DELETE(req: Request) {
  try {
    const id = new URL(req.url).searchParams.get("id");
    if (!id) {
      return NextResponse.json({ success: false, error: "missing_id" }, { status: 400 });
    }
    await db.gardenPlant.delete({ where: { id } }).catch(() => null);
    /* health logs have no FK by design — purge them explicitly so the
       time-series table never accumulates rows for removed plants */
    await db.gardenHealthLog.deleteMany({ where: { plantId: id } }).catch(() => null);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false, error: "server_error" }, { status: 500 });
  }
}
