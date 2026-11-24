import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { diffGardenSnapshot } from "@/lib/garden-snapshot";
import {
  captureGardenSnapshot,
  loadGardenSnapshot,
  pruneSnapshots,
  replaceRestore,
} from "@/server/garden-restore";

export const dynamic = "force-dynamic";

const SNAPSHOT_KIND = "garden";
/** undo list is a safety-net picker, not an archive browser */
const LIST_CAP = 8;

/**
 * GET /api/garden/undo — list the recent automatic garden snapshots
 * («پشتیبان‌های خودکار») for the one-click undo dialog. Metadata only —
 * payloads never leave the server here.
 */
export async function GET() {
  try {
    const rows = await db.snapshot.findMany({
      where: { kind: SNAPSHOT_KIND },
      orderBy: { createdAt: "desc" },
      take: LIST_CAP,
      select: { id: true, reason: true, label: true, itemCount: true, createdAt: true },
    });
    return NextResponse.json({
      success: true,
      snapshots: rows.map((r) => ({
        id: r.id,
        reason: r.reason,
        label: r.label,
        plantCount: r.itemCount,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error("[garden-undo:GET]", err);
    return NextResponse.json({ success: false, error: "server_error" }, { status: 500 });
  }
}

const undoSchema = z.object({
  snapshotId: z.string().min(1).max(64),
});

/**
 * POST /api/garden/undo — one-click restore of a stored garden snapshot
 * (replace semantics: the CURRENT garden is wiped and the snapshot's
 * garden comes back, health series included). Safety-net chain: before
 * the wipe the current garden is banked itself (reason "pre_undo"), so
 * an undo never destroys data — it can always be undone again.
 */
export async function POST(req: Request) {
  try {
    const parsed = undoSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: "invalid_body" }, { status: 400 });
    }
    const loaded = await loadGardenSnapshot(db, parsed.data.snapshotId);
    if (!loaded.ok) {
      return NextResponse.json(
        { success: false, error: loaded.code },
        { status: loaded.code === "not_found" ? 404 : 422 }
      );
    }

    /* bank the present before rewinding the clock */
    const safetyId = await captureGardenSnapshot(db, "pre_undo", "پیش از واگرد");

    /* diff against the CURRENT catalog — a snapshot may reference slugs
       that left the catalog since it was taken; unknown never restores */
    const catalogRows = await db.plant.findMany({ select: { slug: true } });
    const plan = diffGardenSnapshot(loaded.snapshot, [], new Set(catalogRows.map((r) => r.slug)));
    const healthLogsRestored = await replaceRestore(db, plan.toAdd);
    await pruneSnapshots(db, SNAPSHOT_KIND);

    return NextResponse.json({
      success: true,
      restoredPlants: plan.toAdd.length,
      healthLogsRestored,
      unknown: plan.unknown,
      safetySnapshotId: safetyId,
      exportedAt: loaded.snapshot.exportedAt,
    });
  } catch (err) {
    console.error("[garden-undo:POST]", err);
    return NextResponse.json({ success: false, error: "server_error" }, { status: 500 });
  }
}
