/**
 * PlantVerse — shared garden restore machinery (server-side).
 *
 * Extracted from /api/garden/snapshot so the undo route
 * (/api/garden/undo) and the auto-snapshot-before-wipe path reuse the
 * exact same restore semantics: label thresholds identical to
 * POST /api/garden, full-fidelity rows, bounded health series.
 */
import type { PrismaClient } from "@prisma/client";
import { buildGardenSnapshot, validateGardenSnapshot, type GardenSnapshot } from "@/lib/garden-snapshot";

type Db = Pick<PrismaClient, "gardenPlant" | "gardenHealthLog" | "plant" | "snapshot" | "$transaction">;

/* ── label derivation (same thresholds as POST /api/garden) ─────────────── */

export function healthMeta(health: number) {
  if (health >= 85)
    return { statusFa: "عالی", statusEn: "excellent", healthLabelFa: "سلامت عالی", healthLabelEn: "Excellent" };
  if (health >= 70)
    return { statusFa: "خوب", statusEn: "good", healthLabelFa: "سلامت خوب", healthLabelEn: "Good" };
  if (health >= 50)
    return { statusFa: "متوسط", statusEn: "medium", healthLabelFa: "نیاز به توجه", healthLabelEn: "Needs care" };
  return { statusFa: "ضعیف", statusEn: "low", healthLabelFa: "وضعیت بحرانی", healthLabelEn: "Critical" };
}

/** full-fidelity restore of one validated plant + its health series */
export async function restorePlant(dbx: Pick<Db, "gardenPlant" | "gardenHealthLog">, p: GardenSnapshot["plants"][number]): Promise<number> {
  const created = await dbx.gardenPlant.create({
    data: {
      nickname: p.nickname,
      plantSlug: p.plantSlug,
      health: p.health,
      ...healthMeta(p.health),
      nextTaskType: p.nextTaskType,
      nextTaskDays: p.nextTaskDays,
      noteFa: p.noteFa,
      noteEn: p.noteEn,
      createdAt: new Date(p.createdAt),
    },
  });
  if (p.healthLogs.length > 0) {
    /* createMany keeps the restore fast; series bounded by the validator */
    await dbx.gardenHealthLog.createMany({
      data: p.healthLogs.map((l) => ({
        plantId: created.id,
        health: l.health,
        source: l.source,
        recordedAt: new Date(l.recordedAt),
      })),
    });
  }
  return p.healthLogs.length;
}

/**
 * Capture the CURRENT garden into a Snapshot row (the safety-net chain:
 * every destructive step first banks what exists). Never throws — a
 * snapshot failure must not block the destructive action it protects.
 */
export async function captureGardenSnapshot(
  dbx: Db,
  reason: string,
  label: string
): Promise<string | null> {
  try {
    const [plants, logs] = await Promise.all([
      dbx.gardenPlant.findMany({ orderBy: { createdAt: "asc" } }),
      dbx.gardenHealthLog.findMany({ orderBy: { recordedAt: "asc" } }),
    ]);
    const snap = buildGardenSnapshot(plants, logs);
    const row = await dbx.snapshot.create({
      data: {
        kind: "garden",
        reason,
        label: label.slice(0, 60),
        itemCount: snap.plantCount,
        payload: JSON.stringify(snap),
      },
    });
    await pruneSnapshots(dbx, "garden");
    return row.id;
  } catch {
    return null;
  }
}

/**
 * Replace-restore from a DIFFED plant list (unknown catalog slugs must
 * never reach here — the caller passes the diff's toAdd): wipe garden +
 * health series, then rebuild everything valid inside one transaction.
 * Returns restored health-log count.
 */
export async function replaceRestore(
  dbx: Db,
  plants: GardenSnapshot["plants"]
): Promise<number> {
  return dbx.$transaction(async (tx) => {
    await tx.gardenHealthLog.deleteMany({});
    await tx.gardenPlant.deleteMany({});
    let logs = 0;
    for (const p of plants) {
      logs += await restorePlant(tx, p);
    }
    return logs;
  });
}

/** Resolve a stored undo snapshot id → validated garden snapshot. */
export async function loadGardenSnapshot(
  dbx: Db,
  snapshotId: string
): Promise<{ ok: true; snapshot: GardenSnapshot } | { ok: false; code: "not_found" | "corrupt" }> {
  const row = await dbx.snapshot.findUnique({ where: { id: snapshotId } });
  if (!row || row.kind !== "garden") return { ok: false, code: "not_found" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.payload);
  } catch {
    return { ok: false, code: "corrupt" };
  }
  const v = validateGardenSnapshot(parsed);
  return v.ok ? { ok: true, snapshot: v.snapshot } : { ok: false, code: "corrupt" };
}

/** Retention — the safety net stays lean: latest 12 rows per kind. */
const SNAPSHOTS_RETENTION = 12;

export async function pruneSnapshots(dbx: Db, kind: string): Promise<void> {
  try {
    const rows = await dbx.snapshot.findMany({
      where: { kind },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    const stale = rows.slice(SNAPSHOTS_RETENTION).map((r) => r.id);
    if (stale.length > 0) {
      await dbx.snapshot.deleteMany({ where: { id: { in: stale } } });
    }
  } catch {
    /* pruning is best-effort */
  }
}
