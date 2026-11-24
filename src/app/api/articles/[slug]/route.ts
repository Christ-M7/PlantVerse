import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Related cards shown under the article body. */
const RELATED_COUNT = 3;

/**
 * GET /api/articles/[slug] — single article + view counter increment.
 * Also returns `related`: same-category articles first (featured/views order),
 * backfilled with the latest other articles when the category is thin.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const article = await db.article.update({
      where: { slug },
      data: { views: { increment: 1 } },
    });

    const sameCat = await db.article.findMany({
      where: { category: article.category, slug: { not: article.slug } },
      orderBy: [{ featured: "desc" }, { views: "desc" }],
      take: RELATED_COUNT,
    });

    let related = sameCat;
    if (related.length < RELATED_COUNT) {
      const fill = await db.article.findMany({
        where: { slug: { notIn: [article.slug, ...related.map((r) => r.slug)] } },
        orderBy: { publishedAt: "desc" },
        take: RELATED_COUNT - related.length,
      });
      related = [...related, ...fill];
    }

    return NextResponse.json({ success: true, article, related });
  } catch {
    return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
  }
}
