import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { plantLinkForProduct, type PlantLinkTarget } from "@/lib/product-plant-link";

export const dynamic = "force-dynamic";

/**
 * GET /api/shop/[id] — one product + related products from the same category.
 * Powers the shop quick-view dialog.
 *
 * R49-4 («از خرید به کاشت»): both the product and each related row carry
 * an additive `plantLink` field — the deterministic encyclopedia-plant
 * counterpart resolved by src/lib/product-plant-link.ts (scientific-name
 * authority first, curated alias second, null when no honest match).
 * The response shape of success/product/related is unchanged; `plantLink`
 * is additive so existing consumers and contract pins stay valid.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;

    const product = await db.product.findUnique({ where: { id } });
    if (!product) {
      return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
    }

    const related = await db.product.findMany({
      where: { category: product.category, id: { not: product.id } },
      orderBy: { reviews: "desc" },
      take: 4,
    });

    /* authoritative encyclopedia rows — minimal projection for matching */
    const plantSeeds = await db.plant.findMany({
      select: { slug: true, nameFa: true, nameEn: true, scientificName: true },
    });

    const withLink = (row: typeof product) => ({
      ...row,
      plantLink: plantLinkForProduct(row, plantSeeds) as PlantLinkTarget | null,
    });

    return NextResponse.json({
      success: true,
      product: withLink(product),
      related: related.map(withLink),
    });
  } catch {
    return NextResponse.json({ success: false, error: "server_error" }, { status: 500 });
  }
}
