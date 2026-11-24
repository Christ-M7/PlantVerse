import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  GARDEN_SNAPSHOT_MAX_BYTES,
  buildGardenSnapshot,
  diffGardenSnapshot,
  validateGardenSnapshot,
} from "@/lib/garden-snapshot";
import { captureGardenSnapshot, replaceRestore, restorePlant } from "@/server/garden-restore";

export const dynamic = "force-dynamic";

/* ── GET /api/garden/snapshot — download the full-fidelity JSON backup ──── */

export async function GET() {
  try {
    const [plants, logs] = await Promise.all([
      db.gardenPlant.findMany({ orderBy: { createdAt: "asc" } }),
      db.gardenHealthLog.findMany({ orderBy: { recordedAt: "asc" } }),
    ]);
    const snapshot = buildGardenSnapshot(plants, logs);
    const stamp = snapshot.exportedAt.slice(0, 10);

    return new NextResponse(JSON.stringify(snapshot, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="plantverse-garden-snapshot-${stamp}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ success: false, error: "server_error" }, { status: 500 });
  }
}

/* ── POST /api/garden/snapshot — preview or restore from a backup file ──── */

/**
 * Body: { snapshot: unknown, mode: "merge" | "replace", commit: boolean }
 *   commit=false → validate + diff only (no writes)
 *   commit=true  → merge: add plants missing from the garden (duplicates skip)
 *                  replace: wipe garden + health series, restore everything valid
 * Unknown catalog slugs are never written — they are reported back so the
 * user knows exactly what a restore will and will not bring home.
 */
export async function POST(req: Request) {
  try {
    const rawText = await req.text();
    if (rawText.length > GARDEN_SNAPSHOT_MAX_BYTES) {
      return NextResponse.json({ success: false, error: "snapshot_too_large" }, { status: 413 });
    }
    let body: Record<string, unknown> | null = null;
    try {
      body = JSON.parse(rawText) as Record<string, unknown>;
    } catch {
      body = null;
    }
    if (typeof body !== "object" || body === null) {
      return NextResponse.json({ success: false, error: "invalid_body" }, { status: 400 });
    }

    const mode = body.mode === "replace" ? "replace" : "merge";
    const commit = body.commit === true;

    const parsed = validateGardenSnapshot(body.snapshot);
    if (!parsed.ok) {
      return NextResponse.json({ success: false, error: parsed.code }, { status: 400 });
    }
    const { snapshot, warnings } = parsed;

    const healthLogCount = snapshot.plants.reduce((s, p) => s + p.healthLogs.length, 0);

    /* plan — merge diffs against the live garden, replace against a
       wiped garden (everything valid is restorable after the reset) */
    const catalogRows = await db.plant.findMany({ select: { slug: true } });
    const catalog = new Set(catalogRows.map((r) => r.slug));
    const existing =
      mode === "merge"
        ? (await db.gardenPlant.findMany({ select: { plantSlug: true } })).map((g) => g.plantSlug)
        : [];
    const plan = diffGardenSnapshot(snapshot, existing, catalog);

    if (!commit) {
      return NextResponse.json({
        success: true,
        preview: {
          exportedAt: snapshot.exportedAt,
          plantCount: snapshot.plants.length,
          healthLogCount,
          addable: plan.toAdd.length,
          toAdd: plan.toAdd.map((p) => ({
            slug: p.plantSlug,
            nickname: p.nickname,
            health: p.health,
            nextTaskType: p.nextTaskType,
            nextTaskDays: p.nextTaskDays,
            healthLogs: p.healthLogs.length,
          })),
          skipped: plan.skipped,
          unknown: plan.unknown,
          warnings,
        },
      });
    }

    if (mode === "replace") {
      /* safety net first — the CURRENT garden is banked so one click can
         bring it back (best-effort: a failed capture never blocks) */
      const undoSnapshotId = await captureGardenSnapshot(db, "replace_restore", "پیش از جایگزینی کامل باغ");
      const restoredLogs = await replaceRestore(db, plan.toAdd);
      return NextResponse.json({
        success: true,
        mode,
        added: plan.toAdd.length,
        healthLogsRestored: restoredLogs,
        undoSnapshotId,
        skipped: plan.skipped,
        unknown: plan.unknown,
        warnings,
      });
    }

    /* merge — add the missing plants one by one; a duplicate racing in
       between is skipped rather than failing the whole restore */
    let added = 0;
    let logsRestored = 0;
    const skippedLive: { slug: string; nickname: string }[] = [];
    for (const p of plan.toAdd) {
      const exists = await db.gardenPlant.findFirst({ where: { plantSlug: p.plantSlug }, select: { id: true } });
      if (exists) {
        skippedLive.push({ slug: p.plantSlug, nickname: p.nickname });
        continue;
      }
      added += 1;
      logsRestored += await restorePlant(db, p);
    }
    return NextResponse.json({
      success: true,
      mode,
      added,
      healthLogsRestored: logsRestored,
      skipped: [...plan.skipped, ...skippedLive],
      unknown: plan.unknown,
      warnings,
    });
  } catch {
    return NextResponse.json({ success: false, error: "server_error" }, { status: 500 });
  }
}
