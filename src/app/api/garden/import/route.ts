import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { parseGardenCsv } from "@/lib/garden-csv";

export const dynamic = "force-dynamic";

/** Import size ceiling — a garden CSV beyond this is a mistake, not a file. */
const MAX_CSV_CHARS = 400_000;
const MAX_IMPORT_ROWS = 150;

/* ── same creation defaults as POST /api/garden (single source of truth: the garden route) ── */

const TASK_ROTATION = ["water", "fertilize", "prune", "spray"] as const;
const WATER_DAYS: Record<string, number> = { high: 2, medium: 5, low: 9 };

const TASK_TEXT: Record<string, { fa: string; en: string }> = {
  water: { fa: "تا آبیاری بعدی", en: "Next watering in" },
  fertilize: { fa: "تا کوددهی", en: "Next feeding in" },
  prune: { fa: "تا هرس", en: "Next pruning in" },
  spray: { fa: "تا سمپاشی", en: "Next spraying in" },
};

function healthMeta(health: number) {
  if (health >= 85) return { statusFa: "عالی", statusEn: "excellent", healthLabelFa: "سلامت عالی", healthLabelEn: "Excellent" };
  if (health >= 70) return { statusFa: "خوب", statusEn: "good", healthLabelFa: "سلامت خوب", healthLabelEn: "Good" };
  if (health >= 50) return { statusFa: "متوسط", statusEn: "medium", healthLabelFa: "نیاز به توجه", healthLabelEn: "Needs care" };
  return { statusFa: "ضعیف", statusEn: "low", healthLabelFa: "وضعیت بحرانی", healthLabelEn: "Critical" };
}

const bodySchema = z.object({
  csv: z.string().min(1).max(MAX_CSV_CHARS),
  /** false (default) → preview only; true → actually add matched plants */
  commit: z.boolean().optional(),
});

/**
 * POST /api/garden/import — CSV round-trip partner of GET /api/garden/export.
 *
 * Phase 1 (commit:false): parse + validate against the catalog, return a
 * preview with matched / unknown rows and ownership badges. No writes.
 * Phase 2 (commit:true): add every matched plant that isn't already in the
 * garden (same defaults as POST /api/garden), skipping duplicates.
 */
export async function POST(req: Request) {
  try {
    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      const tooBig = parsed.error.issues.some((i) => i.code === "too_big");
      return NextResponse.json(
        { success: false, error: tooBig ? "csv_too_large" : "invalid_body" },
        { status: 400 },
      );
    }
    const { csv, commit } = parsed.data;

    const result = parseGardenCsv(csv);
    if (!result.hasSlugColumn) {
      return NextResponse.json({ success: false, error: "unrecognized_format" }, { status: 400 });
    }
    if (result.plants.length === 0) {
      return NextResponse.json({ success: false, error: "no_plant_rows" }, { status: 400 });
    }
    if (result.totalRows > MAX_IMPORT_ROWS) {
      return NextResponse.json(
        { success: false, error: "too_many_rows", maxRows: MAX_IMPORT_ROWS },
        { status: 400 },
      );
    }

    /* dedupe by slug — first occurrence wins, later repeats are ignored */
    const seen = new Set<string>();
    const wanted = result.plants.filter((p) => {
      if (seen.has(p.slug)) return false;
      seen.add(p.slug);
      return true;
    });

    const slugs = wanted.map((p) => p.slug);
    const [catalog, garden] = await Promise.all([
      db.plant.findMany({
        where: { slug: { in: slugs } },
        select: { slug: true, nameFa: true, nameEn: true, image: true, water: true },
      }),
      db.gardenPlant.findMany({ where: { plantSlug: { in: slugs } }, select: { plantSlug: true } }),
    ]);
    const bySlug = new Map(catalog.map((p) => [p.slug, p]));
    const ownedSlugs = new Set(garden.map((g) => g.plantSlug));

    const matched = wanted
      .filter((p) => bySlug.has(p.slug))
      .map((p) => {
        const c = bySlug.get(p.slug)!;
        return {
          slug: p.slug,
          nickname: p.nickname,
          nameFa: c.nameFa,
          nameEn: c.nameEn,
          image: c.image,
          alreadyInGarden: ownedSlugs.has(p.slug),
        };
      });
    const unknown = wanted
      .filter((p) => !bySlug.has(p.slug))
      .map((p) => ({ slug: p.slug, nickname: p.nickname }));

    if (!commit) {
      return NextResponse.json({
        success: true,
        preview: true,
        detectedLang: result.detectedLang,
        totalRows: result.totalRows,
        matched,
        unknown,
      });
    }

    /* ── commit phase — add the missing plants with POST /api/garden defaults ── */
    let added = 0;
    let skipped = 0;
    for (const m of matched) {
      if (ownedSlugs.has(m.slug)) { skipped++; continue; }
      const c = bySlug.get(m.slug)!;
      const nextTaskType = "water";
      const nextTaskDays = WATER_DAYS[c.water] ?? 5;
      const created = await db.gardenPlant.create({
        data: {
          nickname: m.nickname || c.nameFa,
          plantSlug: m.slug,
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
      await db.gardenHealthLog.create({
        data: { plantId: created.id, health: 90, source: "create" },
      });
      ownedSlugs.add(m.slug);
      added++;
    }

    return NextResponse.json({
      success: true,
      commit: true,
      added,
      skipped,
      unknownCount: unknown.length,
    });
  } catch {
    return NextResponse.json({ success: false, error: "server_error" }, { status: 500 });
  }
}
