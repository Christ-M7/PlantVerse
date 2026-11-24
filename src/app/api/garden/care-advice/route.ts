import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { GH_METRICS, faDigits } from "@/lib/greenhouse";
import { buildCareAdvice, type AdvisorPlant } from "@/lib/care-advice";

export const dynamic = "force-dynamic";

/**
 * GET /api/garden/care-advice — the garden's personalized INDOOR care
 * advisor. Joins the latest greenhouse sensor snapshot (temp/hum/soil/
 * light — the app's environment proxy) with the garden plants' catalog
 * care attributes and upcoming task due dates, then runs the pure rule
 * engine in src/lib/care-advice.ts.
 *
 * Sensors without any recorded row fall back to the metric's seasonal
 * baseline, so the endpoint is always meaningful on a fresh database.
 */
export async function GET() {
  try {
    const [readings, garden] = await Promise.all([
      Promise.all(
        GH_METRICS.map(async (m) => {
          const row = await db.ghReading.findFirst({
            where: { metric: m.key },
            orderBy: { recordedAt: "desc" },
            select: { value: true },
          });
          return [m.key, row?.value ?? m.base] as const;
        })
      ),
      db.gardenPlant.findMany({
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          nickname: true,
          plantSlug: true,
          health: true,
          nextTaskType: true,
          nextTaskDays: true,
        },
      }),
    ]);

    const env = Object.fromEntries(readings) as Record<string, number>;

    const slugs = garden.map((g) => g.plantSlug);
    const catalog = slugs.length
      ? await db.plant.findMany({
          where: { slug: { in: slugs } },
          select: {
            slug: true,
            nameFa: true,
            nameEn: true,
            water: true,
            humidity: true,
            light: true,
            tempMin: true,
            tempMax: true,
          },
        })
      : [];
    const bySlug = new Map(catalog.map((p) => [p.slug, p]));

    /* garden rows without a catalog match are skipped — the advisor needs
       the authoritative care attributes (same policy as compatibility) */
    const plants: AdvisorPlant[] = garden.flatMap((g) => {
      const c = bySlug.get(g.plantSlug);
      return c
        ? [
            {
              id: g.id,
              nickname: g.nickname,
              nameFa: c.nameFa,
              nameEn: c.nameEn,
              water: c.water,
              humidity: c.humidity,
              light: c.light,
              tempMin: c.tempMin,
              tempMax: c.tempMax,
              nextTaskType: g.nextTaskType,
              nextTaskDays: g.nextTaskDays,
              health: g.health,
            },
          ]
        : [];
    });

    const advice = buildCareAdvice(
      {
        temp: env.temp ?? 24,
        hum: env.hum ?? 65,
        soil: env.soil ?? 48,
        light: env.light ?? 12400,
      },
      plants,
      faDigits
    );

    return NextResponse.json({ success: true, ...advice });
  } catch (err) {
    console.error("[care-advice]", err);
    return NextResponse.json({ success: false, error: "server_error" }, { status: 500 });
  }
}
