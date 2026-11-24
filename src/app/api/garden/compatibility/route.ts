import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { analyzeCompatibility, type CompanionPlant } from "@/lib/companion";

export const dynamic = "force-dynamic";

/**
 * GET /api/garden/compatibility — pairwise care-needs analysis of the
 * plants sharing the garden (light / water / humidity rank distance ≥ 2,
 * temperature range overlap). Pure read: no mutation, no params.
 *
 * Garden rows without a matching catalog plant are skipped silently —
 * compatibility needs the authoritative catalog attributes.
 */
export async function GET() {
  try {
    const garden = await db.gardenPlant.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, plantSlug: true, nickname: true },
    });

    const catalog = await db.plant.findMany({
      select: {
        slug: true,
        nameFa: true,
        nameEn: true,
        light: true,
        water: true,
        humidity: true,
        tempMin: true,
        tempMax: true,
        image: true,
      },
    });
    const bySlug = new Map(catalog.map((p) => [p.slug, p]));

    const plants: CompanionPlant[] = garden.flatMap((g) => {
      const c = bySlug.get(g.plantSlug);
      return c
        ? [
            {
              id: g.id,
              plantSlug: g.plantSlug,
              nickname: g.nickname,
              light: c.light,
              water: c.water,
              humidity: c.humidity,
              tempMin: c.tempMin,
              tempMax: c.tempMax,
              nameFa: c.nameFa,
              nameEn: c.nameEn,
              image: c.image,
            },
          ]
        : [];
    });

    const report = analyzeCompatibility(plants);
    return NextResponse.json({ success: true, ...report });
  } catch (err) {
    console.error("[companion]", err);
    return NextResponse.json({ success: false, error: "server_error" }, { status: 500 });
  }
}
