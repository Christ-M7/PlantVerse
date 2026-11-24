import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/shop — product catalog */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const category = url.searchParams.get("category") ?? undefined;
    const where = category && category !== "all" ? { category } : {};
    const products = await db.product.findMany({ where, orderBy: { reviews: "desc" }, take: 40 });
    return NextResponse.json({ success: true, products });
  } catch {
    return NextResponse.json({ success: false, error: "server_error" }, { status: 500 });
  }
}
