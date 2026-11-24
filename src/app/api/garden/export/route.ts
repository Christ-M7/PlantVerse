import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { buildGardenCsv } from "@/lib/garden-csv";

export const dynamic = "force-dynamic";

/**
 * GET /api/garden/export?lang=fa|en — download the garden as CSV.
 *
 * RFC 4180 document with a UTF-8 BOM (Excel opens Persian headers
 * correctly on double-click), one row per plant + a stats footer.
 * Same catalog-enrichment policy as GET /api/garden (unknown slugs fall
 * back to the nickname so no row is ever silently dropped in an export).
 */
export async function GET(req: Request) {
  try {
    const lang = new URL(req.url).searchParams.get("lang") === "en" ? "en" : "fa";

    const garden = await db.gardenPlant.findMany({ orderBy: { createdAt: "asc" } });
    const slugs = garden.map((g) => g.plantSlug);
    const plants = await db.plant.findMany({
      where: { slug: { in: slugs } },
      select: { slug: true, nameFa: true, nameEn: true },
    });
    const bySlug = new Map(plants.map((p) => [p.slug, p]));

    const rows = garden.map((g) => {
      const c = bySlug.get(g.plantSlug);
      return {
        nickname: g.nickname,
        plantSlug: g.plantSlug,
        nameFa: c?.nameFa ?? g.nickname,
        nameEn: c?.nameEn ?? g.nickname,
        health: g.health,
        statusFa:
          g.health >= 85 ? "عالی" : g.health >= 70 ? "خوب" : g.health >= 50 ? "متوسط" : "ضعیف",
        statusEn:
          g.health >= 85 ? "excellent" : g.health >= 70 ? "good" : g.health >= 50 ? "medium" : "low",
        nextTaskType: g.nextTaskType,
        nextTaskDays: g.nextTaskDays,
        createdAt: g.createdAt,
      };
    });

    const avgHealth = garden.length
      ? Math.round(garden.reduce((s, g) => s + g.health, 0) / garden.length)
      : 0;
    const csv = buildGardenCsv(rows, lang, { total: garden.length, avgHealth });

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="plantverse-garden-${lang}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ success: false, error: "server_error" }, { status: 500 });
  }
}
