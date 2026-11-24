import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { parsePlant } from "@/lib/plant-mapper";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  category: z.string().max(30).optional(),
  light: z.string().max(30).optional(),
  water: z.string().max(30).optional(),
  difficulty: z.string().max(30).optional(),
  season: z.string().max(30).optional(),
  q: z.string().max(80).optional(),
  sort: z.enum(["relevance", "name", "difficulty", "popular"]).optional(),
});

/** GET /api/plants — filtered catalog */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: "invalid_query" }, { status: 400 });
    }
    const { category, light, water, difficulty, season, q, sort } = parsed.data;

    const where: Record<string, string> = {};
    if (category && category !== "all") where.category = category;
    if (light && light !== "all") where.light = light;
    if (water && water !== "all") where.water = water;
    if (difficulty && difficulty !== "all") where.difficulty = difficulty;

    const plants = await db.plant.findMany({
      where,
      orderBy:
        sort === "name" ? { nameFa: "asc" }
        : sort === "difficulty" ? { careLevel: "asc" }
        : sort === "popular" ? { views: "desc" }
        : { featured: "desc" },
      take: 60,
    });

    let list = plants.map(parsePlant);
    if (season && season !== "all") {
      list = list.filter((p) => p.seasons.includes(season));
    }
    if (q?.trim()) {
      const needle = q.trim().toLowerCase();
      list = list.filter((p) =>
        `${p.nameFa} ${p.nameEn} ${p.scientificName} ${p.commonNamesFa.join(" ")}`
          .toLowerCase()
          .includes(needle)
      );
    }

    /* Persian collation — SQLite's binary ORDER BY sorts by code point,
       which misplaces پ/چ/گ (U+067E+) before ت/ط (U+062A..) — wrong
       dictionary order for fa readers. Re-sort linguistically so the API
       matches the client's localeCompare("fa") display order. */
    if (sort === "name") list.sort((a, b) => a.nameFa.localeCompare(b.nameFa, "fa"));

    return NextResponse.json({ success: true, count: list.length, plants: list });
  } catch {
    return NextResponse.json({ success: false, error: "server_error" }, { status: 500 });
  }
}
