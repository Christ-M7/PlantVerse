import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { parsePlant } from "@/lib/plant-mapper";

export const dynamic = "force-dynamic";

/** GET /api/plants/[slug] — live plant detail (increments view counter, best effort) */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const row = await db.plant.findUnique({ where: { slug } });
    if (!row) {
      return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
    }
    db.plant
      .update({ where: { slug }, data: { views: { increment: 1 } } })
      .catch(() => {});
    const views = row.views + 1;
    const plant = parsePlant({ ...row, views });
    return NextResponse.json({ success: true, source: "live", plant });
  } catch {
    return NextResponse.json({ success: false, error: "server_error" }, { status: 500 });
  }
}

/** PATCH /api/plants/[slug] — favorite toggle: { favorited: boolean } */
export async function PATCH(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const body = (await req.json().catch(() => ({}))) as { favorited?: boolean };
    const on = body.favorited === true;
    const row = await db.plant.findUnique({ where: { slug }, select: { favorites: true } });
    if (!row) {
      return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
    }
    const next = Math.max(0, row.favorites + (on ? 1 : -1));
    const updated = await db.plant.update({
      where: { slug },
      data: { favorites: next },
      select: { favorites: true },
    });
    return NextResponse.json({ success: true, favorites: updated.favorites });
  } catch {
    return NextResponse.json({ success: false, error: "server_error" }, { status: 500 });
  }
}
