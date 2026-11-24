/**
 * PlantVerse — garden JSON snapshot («پشتیبان کامل باغ»). 
 *
 * Full-fidelity backup that goes beyond the CSV plant list: health score,
 * bilingual notes, care-task state, original creation timestamp and the
 * entire health time-series per plant — everything needed to rebuild the
 * garden exactly as it was.
 *
 * Pure module (no DB imports) shared by the API route and tests:
 *   buildGardenSnapshot   — assemble a payload from DB-shaped rows
 *   validateGardenSnapshot — shape/size/range armor for untrusted files
 *   diffGardenSnapshot    — merge/replace planning with honest reporting
 *
 * Restore semantics follow the CSV-import precedent: unknown catalog
 * slugs are NEVER written, only reported; duplicates are skipped in
 * merge mode; replace mode is an explicit, confirmed full restore.
 */

/* ── types ──────────────────────────────────────────────────────────────── */

export const GARDEN_SNAPSHOT_VERSION = 1;
/** same capacity the CSV import enforces — one demo garden, not a farm */
export const GARDEN_SNAPSHOT_MAX_PLANTS = 150;
/** health-series tail kept per plant (oldest points drop first) */
export const GARDEN_SNAPSHOT_MAX_LOGS = 200;
/** transport ceiling for the uploaded JSON body */
export const GARDEN_SNAPSHOT_MAX_BYTES = 2_000_000;

export interface SnapshotHealthLog {
  health: number; // 0..100
  source: string; // create | task | manual | backfill | restore
  recordedAt: string; // ISO datetime
}

export interface SnapshotPlant {
  nickname: string;
  plantSlug: string;
  health: number; // 0..100
  nextTaskType: string; // water | fertilize | prune | spray
  nextTaskDays: number;
  noteFa: string;
  noteEn: string;
  createdAt: string; // ISO datetime
  healthLogs: SnapshotHealthLog[];
}

export interface GardenSnapshot {
  version: number; // GARDEN_SNAPSHOT_VERSION
  kind: "plantverse-garden-snapshot";
  exportedAt: string; // ISO datetime
  plantCount: number;
  plants: SnapshotPlant[];
}

/** DB-shaped input for the builder (Prisma rows, grouped logs) */
export interface SnapshotSourceRow {
  id: string;
  nickname: string;
  plantSlug: string;
  health: number;
  nextTaskType: string;
  nextTaskDays: number;
  noteFa: string;
  noteEn: string;
  createdAt: Date;
}

export interface SnapshotSourceLog {
  plantId: string;
  health: number;
  source: string;
  recordedAt: Date;
}

export type SnapshotValidation =
  | { ok: true; snapshot: GardenSnapshot; warnings: string[] }
  | { ok: false; code: "bad_shape" | "bad_version" | "no_plants" | "too_many_plants" | "bad_row" };

export interface SnapshotDiff {
  toAdd: SnapshotPlant[];
  skipped: { slug: string; nickname: string }[];
  unknown: { slug: string; nickname: string }[];
}

/* ── constants ──────────────────────────────────────────────────────────── */

const TASK_TYPES = new Set(["water", "fertilize", "prune", "spray"]);
const LOG_SOURCES = new Set(["create", "task", "manual", "backfill"]);

const clampInt = (v: unknown, fallback: number, min: number, max: number): number => {
  const n = typeof v === "number" ? Math.round(v) : Number.NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

const clampText = (v: unknown, fallback: string, max: number): string =>
  typeof v === "string" ? v.trim().slice(0, max) : fallback;

const isIsoDate = (v: unknown): v is string =>
  typeof v === "string" && v.length >= 10 && !Number.isNaN(new Date(v).getTime());

/* ── builder ────────────────────────────────────────────────────────────── */

/**
 * Assemble the snapshot payload from DB rows. Health logs land oldest-first
 * with the newest tail kept (the series only ever grows; restore keeps the
 * shape of the chart while bounding the file).
 */
export function buildGardenSnapshot(
  plants: SnapshotSourceRow[],
  logs: SnapshotSourceLog[],
  exportedAt: Date = new Date()
): GardenSnapshot {
  const byPlant = new Map<string, SnapshotHealthLog[]>();
  for (const log of logs) {
    const list = byPlant.get(log.plantId) ?? [];
    list.push({
      health: clampInt(log.health, 0, 0, 100),
      source: LOG_SOURCES.has(log.source) ? log.source : "restore",
      recordedAt: log.recordedAt.toISOString(),
    });
    byPlant.set(log.plantId, list);
  }

  const sortedPlants = [...plants].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  return {
    version: GARDEN_SNAPSHOT_VERSION,
    kind: "plantverse-garden-snapshot",
    exportedAt: exportedAt.toISOString(),
    plantCount: sortedPlants.length,
    plants: sortedPlants.map((p) => {
      const series = (byPlant.get(p.id) ?? []).sort(
        (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime()
      );
      return {
        nickname: p.nickname,
        plantSlug: p.plantSlug,
        health: clampInt(p.health, 90, 0, 100),
        nextTaskType: TASK_TYPES.has(p.nextTaskType) ? p.nextTaskType : "water",
        nextTaskDays: clampInt(p.nextTaskDays, 5, 0, 3650),
        noteFa: p.noteFa ?? "",
        noteEn: p.noteEn ?? "",
        createdAt: p.createdAt.toISOString(),
        healthLogs: series.slice(-GARDEN_SNAPSHOT_MAX_LOGS),
      };
    }),
  };
}

/* ── validation ─────────────────────────────────────────────────────────── */

/**
 * Armor for untrusted restore files. Never throws — every problem becomes
 * a code (or a per-row warning and a dropped row when the rest is sound).
 */
export function validateGardenSnapshot(raw: unknown): SnapshotValidation {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, code: "bad_shape" };
  }
  const shape = raw as Record<string, unknown>;
  if (shape.kind !== "plantverse-garden-snapshot") {
    return { ok: false, code: "bad_shape" };
  }
  if (shape.version !== GARDEN_SNAPSHOT_VERSION) {
    return { ok: false, code: "bad_version" };
  }
  if (!Array.isArray(shape.plants)) {
    return { ok: false, code: "bad_shape" };
  }
  if (shape.plants.length === 0) {
    return { ok: false, code: "no_plants" };
  }
  if (shape.plants.length > GARDEN_SNAPSHOT_MAX_PLANTS) {
    return { ok: false, code: "too_many_plants" };
  }

  const warnings: string[] = [];
  const plants: SnapshotPlant[] = [];
  shape.plants.forEach((row, i) => {
    if (typeof row !== "object" || row === null || Array.isArray(row)) {
      warnings.push(`row ${i + 1}: dropped (not an object)`);
      return;
    }
    const r = row as Record<string, unknown>;
    const slug = typeof r.plantSlug === "string" ? r.plantSlug.trim().slice(0, 80) : "";
    if (!slug) {
      warnings.push(`row ${i + 1}: dropped (missing plantSlug)`);
      return;
    }
    const rawLogs = Array.isArray(r.healthLogs) ? r.healthLogs : [];
    const healthLogs: SnapshotHealthLog[] = [];
    rawLogs.forEach((entry) => {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return;
      const e = entry as Record<string, unknown>;
      const health = clampInt(e.health, -1, -1, 100);
      if (health < 0 || !isIsoDate(e.recordedAt)) return;
      const source = typeof e.source === "string" && e.source.trim() ? e.source.trim().slice(0, 20) : "restore";
      healthLogs.push({ health, source, recordedAt: e.recordedAt });
    });
    healthLogs.sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());

    plants.push({
      plantSlug: slug,
      nickname: clampText(r.nickname, slug, 80) || slug,
      health: clampInt(r.health, 90, 0, 100),
      nextTaskType: TASK_TYPES.has(r.nextTaskType as string) ? (r.nextTaskType as string) : "water",
      nextTaskDays: clampInt(r.nextTaskDays, 5, 0, 3650),
      noteFa: clampText(r.noteFa, "", 500),
      noteEn: clampText(r.noteEn, "", 500),
      createdAt: isIsoDate(r.createdAt) ? r.createdAt : new Date().toISOString(),
      healthLogs: healthLogs.slice(-GARDEN_SNAPSHOT_MAX_LOGS),
    });
  });

  if (plants.length === 0) {
    return { ok: false, code: "no_plants" };
  }
  return {
    ok: true,
    snapshot: {
      version: GARDEN_SNAPSHOT_VERSION,
      kind: "plantverse-garden-snapshot",
      exportedAt: isIsoDate(shape.exportedAt) ? shape.exportedAt : new Date().toISOString(),
      plantCount: plants.length,
      plants,
    },
    warnings,
  };
}

/* ── diff / plan ────────────────────────────────────────────────────────── */

/**
 * Restore planning. `existingSlugs` is the current garden in merge mode and
 * an EMPTY array in replace mode (everything valid is restorable after the
 * wipe). Unknown catalog slugs never reach `toAdd` — they are reported.
 */
export function diffGardenSnapshot(
  snapshot: GardenSnapshot,
  existingSlugs: string[],
  knownCatalogSlugs: Set<string>
): SnapshotDiff {
  const existing = new Set(existingSlugs);
  const toAdd: SnapshotPlant[] = [];
  const skipped: { slug: string; nickname: string }[] = [];
  const unknown: { slug: string; nickname: string }[] = [];

  for (const p of snapshot.plants) {
    if (!knownCatalogSlugs.has(p.plantSlug)) {
      unknown.push({ slug: p.plantSlug, nickname: p.nickname });
      continue;
    }
    if (existing.has(p.plantSlug)) {
      skipped.push({ slug: p.plantSlug, nickname: p.nickname });
      continue;
    }
    toAdd.push(p);
  }
  return { toAdd, skipped, unknown };
}
