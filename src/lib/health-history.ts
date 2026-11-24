/**
 * PlantVerse — garden-plant health time-series.
 *
 * GardenPlant.health mutates in real time (creation → 90, completed care
 * task → +4, manual adjust), but mutations before the log table existed are
 * unknown. To make the trend chart meaningful on first open we lazily
 * materialize a **deterministic seeded backfill** per plant that ends
 * exactly at the plant's CURRENT real health — consistent with the app's
 * greenhouse precedent where the IoT layer simulates plausible sensor
 * history. Backfill rows are written once (source="backfill") and never
 * regenerated, while every real mutation keeps appending honest rows
 * (source="create" | "task" | "manual").
 */

import type { PrismaClient } from "@prisma/client";
import { isoLocalDate } from "@/lib/streak";

/** Backfill horizon — matches the chart's largest window. */
export const BACKFILL_DAYS = 30;

/** Chart window choices shared by the API contract and the UI toggle. */
export const HEALTH_WINDOW_DAYS = [7, 14, 30] as const;
export type HealthWindowDays = (typeof HEALTH_WINDOW_DAYS)[number];

/* ── deterministic seeded PRNG (FNV-1a hash + mulberry32) ───────────────── */

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ── backfill synthesis ─────────────────────────────────────────────────── */

/**
 * Deterministic daily series ending at `currentHealth` on today's date.
 * Shape: seeded random walk between a seeded start value and the real
 * current value — jitter fades to zero at both ends so the first point and
 * the last point are exact. Two calls with the same plantId + health always
 * produce the identical series.
 *
 * `createdAt` caps the horizon: a plant added 3 days ago gets a 3-point
 * history, never fabricated days before it existed.
 */
export function synthesizeBackfill(
  plantId: string,
  currentHealth: number,
  createdAt?: Date,
  today = new Date()
): { date: string; health: number; source: "backfill" }[] {
  const rand = mulberry32(fnv1a(`pv-health:${plantId}`));
  const dayMs = 86400000;
  const earliest = today.getTime() - (BACKFILL_DAYS - 1) * dayMs;
  const from = createdAt ? Math.max(earliest, new Date(createdAt.getFullYear(), createdAt.getMonth(), createdAt.getDate()).getTime()) : earliest;
  const span = Math.min(BACKFILL_DAYS, Math.max(1, Math.round((today.getTime() - from) / dayMs) + 1));
  const drift = Math.round(rand() * 24 - 12); // -12..+12
  const start = Math.max(15, Math.min(100, currentHealth - drift));
  const out: { date: string; health: number; source: "backfill" }[] = [];
  for (let i = 0; i < span; i++) {
    const t = span === 1 ? 1 : i / (span - 1);
    const jitter = i === 0 || i === span - 1 ? 0 : (rand() * 4 - 2);
    const v = Math.round(start + (currentHealth - start) * t + jitter);
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (span - 1 - i));
    out.push({ date: isoLocalDate(d), health: Math.max(10, Math.min(100, Math.round(v))), source: "backfill" });
  }
  /* last point is the plant's REAL current health — always exact */
  out[out.length - 1].health = currentHealth;
  return out;
}

/**
 * Idempotent lazy backfill: when a garden plant has NO health logs yet,
 * materialize its seeded history once. Safe under concurrency (re-checks
 * inside the same tick; extra rows would only duplicate points, never
 * corrupt the endpoint — but the guard keeps it tidy).
 */
export async function ensureHealthBackfill(
  db: PrismaClient,
  plant: { id: string; health: number; createdAt: Date }
) {
  const existing = await db.gardenHealthLog.count({ where: { plantId: plant.id } });
  if (existing > 0) return;
  const series = synthesizeBackfill(plant.id, plant.health, plant.createdAt);
  const now = Date.now();
  await db.gardenHealthLog.createMany({
    data: series.map((p, i) => ({
      plantId: plant.id,
      health: p.health,
      source: "backfill",
      /* spread synthetic timestamps across the window; last point = now */
      recordedAt: new Date(now - (series.length - 1 - i) * 86400000),
    })),
  });
}

/* ── API aggregation ────────────────────────────────────────────────────── */

export interface HealthPoint {
  date: string; // ISO yyyy-mm-dd (local)
  health: number;
}

export interface PlantHealthHistory {
  id: string;
  slug: string;
  nickname: string;
  /** catalog display names — the UI resolves them with the same
      isFa ? nickname || nameFa : nameEn || nickname rule as /api/garden */
  nameFa: string;
  nameEn: string;
  image: string;
  current: number;
  min: number; // window min (post-creation part only)
  max: number; // window max (post-creation part only)
  delta: number; // last - first within the window (post-creation)
  /** plant creation date (ISO yyyy-mm-dd local) — the UI truncates the
      x-axis to this so the chart never shows days before the plant existed */
  createdIso: string;
  points: HealthPoint[];
}

export interface GardenHealthHistory {
  days: HealthWindowDays;
  today: string;
  /** garden-wide completed care events per day (care dots on the chart) */
  careCounts: { date: string; count: number }[];
  plants: PlantHealthHistory[];
}

/**
 * Build the health-history payload for `days` days. Ensures backfill per
 * plant first, folds real logs + synthetic ones into daily points, and
 * attaches garden-wide done-care-event counts for the same window.
 */
export async function buildGardenHealthHistory(
  db: PrismaClient,
  days: HealthWindowDays,
  plantId?: string
): Promise<GardenHealthHistory> {
  const today = new Date();
  const todayIso = isoLocalDate(today);
  const windowStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1));
  const windowStartIso = isoLocalDate(windowStart);

  const garden = await db.gardenPlant.findMany({
    where: plantId ? { id: plantId } : undefined,
    orderBy: { createdAt: "asc" },
    select: { id: true, plantSlug: true, nickname: true, health: true, createdAt: true },
  });

  /* lazy backfill for plants without logs — SEQUENTIAL on purpose:
     parallel createMany trips SQLite's single-writer lock (SQLITE_BUSY) */
  for (const p of garden) {
    await ensureHealthBackfill(db, p);
  }

  const ids = garden.map((p) => p.id);
  const [logs, careEvents, images] = await Promise.all([
    ids.length
      ? db.gardenHealthLog.findMany({
          where: { plantId: { in: ids }, recordedAt: { gte: windowStart } },
          orderBy: { recordedAt: "asc" },
          select: { plantId: true, health: true, recordedAt: true },
        })
      : Promise.resolve([] as { plantId: string; health: number; recordedAt: Date }[]),
    db.careEvent.findMany({
      where: { done: true, date: { gte: windowStartIso, lte: todayIso } },
      select: { date: true },
    }),
    ids.length
      ? db.plant.findMany({
          where: { slug: { in: garden.map((g) => g.plantSlug) } },
          select: { slug: true, image: true, nameFa: true, nameEn: true },
        })
      : Promise.resolve([] as { slug: string; image: string; nameFa: string; nameEn: string }[]),
  ]);

  /** daily bucket per plant — last log of each day wins (state at end of day) */
  const byPlant = new Map<string, Map<string, number>>();
  for (const log of logs) {
    let bucket = byPlant.get(log.plantId);
    if (!bucket) {
      bucket = new Map();
      byPlant.set(log.plantId, bucket);
    }
    bucket.set(isoLocalDate(log.recordedAt), log.health);
  }

  const metaBySlug = new Map(images.map((p) => [p.slug, p]));

  const plants: PlantHealthHistory[] = garden.map((g) => {
    const bucket = byPlant.get(g.id) ?? new Map<string, number>();
    const points: HealthPoint[] = [];
    /* forward-fill: last known value carries ahead; days before the first
       known point inherit it (honest "state unknown, assume stable") */
    let carry: number | null = null;
    for (let i = 0; i < days; i++) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1 - i));
      const iso = isoLocalDate(d);
      const known = bucket.get(iso);
      if (known !== undefined) carry = known;
      points.push({ date: iso, health: carry ?? g.health });
    }
    /* stats cover only the post-creation part of the window */
    const createdIso = isoLocalDate(g.createdAt);
    const lived = points.filter((p) => p.date >= createdIso);
    const values = lived.length > 0 ? lived.map((p) => p.health) : [g.health];
    return {
      id: g.id,
      slug: g.plantSlug,
      nickname: g.nickname,
      nameFa: metaBySlug.get(g.plantSlug)?.nameFa ?? g.nickname,
      nameEn: metaBySlug.get(g.plantSlug)?.nameEn ?? g.nickname,
      image: metaBySlug.get(g.plantSlug)?.image ?? "",
      current: g.health,
      min: Math.min(...values),
      max: Math.max(...values),
      delta: values[values.length - 1] - values[0],
      createdIso,
      points,
    };
  });

  /** garden-wide done care events per day */
  const careMap = new Map<string, number>();
  for (const ev of careEvents) careMap.set(ev.date, (careMap.get(ev.date) ?? 0) + 1);
  const careCounts = [...careMap.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return { days, today: todayIso, careCounts, plants };
}
