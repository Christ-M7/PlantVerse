/**
 * PlantVerse — annual report aggregation («گزارش سالانه»).
 *
 * Pure, dependency-light aggregation over one jalali year of CareEvent rows.
 * Shared by BOTH sides so numbers can never diverge:
 *
 *  - server: `/api/reports/annual` aggregates DB rows;
 *  - client: the profile report pins PV_EVENTS fixtures onto the viewed year
 *    on network failure and runs the exact same function.
 *
 * Jalali bucketing uses @/lib/jalali (local-time discipline, yyyy-mm-dd
 * string dates per project convention).
 */

import { toJalali } from "@/lib/jalali";
import { longestRun } from "@/lib/streak";

/** Canonical care-task types (matches the reminders API zod enum order). */
export const ANNUAL_TYPES = ["water", "fertilize", "prune", "spray"] as const;
export type AnnualType = (typeof ANNUAL_TYPES)[number];

export interface YearEvent {
  id?: string;
  type: string;
  titleFa: string;
  titleEn: string;
  plantNamesFa: string;
  plantNamesEn: string;
  date: string; // ISO yyyy-mm-dd
  done: boolean;
}

export interface MonthBucket {
  jm: number; // 1..12
  total: number;
  done: number;
  pending: number;
}

export interface TypeBucket {
  type: AnnualType;
  total: number;
  done: number;
  pending: number;
}

export interface TopPlant {
  fa: string;
  en: string;
  count: number;
}

export interface AnnualAgg {
  total: number;
  done: number;
  pending: number;
  completionPct: number;
  byMonth: MonthBucket[];
  byType: TypeBucket[];
  topPlants: TopPlant[];
  /** Busiest month (jm 1..12) — 0 when the year is empty; earliest month wins ties. */
  busiest: number;
  /** Quietest non-empty month (jm 1..12) — 0 when the year is empty. */
  quietest: number;
  /** Distinct days with ≥1 done event inside the year. */
  activeDays: number;
  /** Longest consecutive done-run inside the year. */
  bestStreakInYear: number;
}

/** Section labels that must never rank as plants (see reminders POST defaults). */
const PLACEHOLDERS = new Set(["گیاهان من", "my plants"]);

const EMPTY_MONTHS: MonthBucket[] = Array.from({ length: 12 }, (_, i) => ({
  jm: i + 1,
  total: 0,
  done: 0,
  pending: 0,
}));

/** Aggregate a year window of events into the report shape. */
export function aggregateYearEvents(events: YearEvent[], jy: number): AnnualAgg {
  const byMonth: MonthBucket[] = EMPTY_MONTHS.map((m) => ({ ...m }));
  const typeMap = new Map<AnnualType, TypeBucket>(
    ANNUAL_TYPES.map((t) => [t, { type: t, total: 0, done: 0, pending: 0 }])
  );
  const plantCounts = new Map<string, TopPlant>();
  const doneDayNums: number[] = [];

  let total = 0;
  let done = 0;

  for (const e of events) {
    const [gy, gm, gd] = e.date.split("-").map(Number);
    if (!gy || !gm || !gd) continue;
    const j = toJalali(new Date(gy, gm - 1, gd));
    if (j.jy !== jy) continue; // defensive — the query window already filters

    total += 1;
    const bucket = byMonth[j.jm - 1];
    bucket.total += 1;
    if (e.done) {
      done += 1;
      bucket.done += 1;
      const dayNum = Math.floor(Date.UTC(gy, gm - 1, gd) / 86_400_000);
      doneDayNums.push(dayNum);
    } else {
      bucket.pending += 1;
    }

    const tb = typeMap.get(e.type as AnnualType);
    if (tb) {
      tb.total += 1;
      if (e.done) tb.done += 1;
      else tb.pending += 1;
    }

    /* plants — zip fa/en parts by index so a group keeps both locales;
       group key is the fa part (canonical), placeholder labels excluded. */
    const faParts = e.plantNamesFa.split(/[،,]/).map((s) => s.trim());
    const enParts = e.plantNamesEn.split(/[،,]/).map((s) => s.trim());
    const parts = Math.max(faParts.length, enParts.length);
    for (let i = 0; i < parts; i++) {
      const fa = faParts[i] ?? "";
      const en = enParts[i] ?? "";
      if (!fa && !en) continue;
      if (PLACEHOLDERS.has(fa) || PLACEHOLDERS.has(en.toLowerCase())) continue;
      const key = (fa || en).toLowerCase();
      const existing = plantCounts.get(key);
      if (existing) {
        existing.count += 1;
        if (!existing.en && en) existing.en = en;
        if (!existing.fa && fa) existing.fa = fa;
      } else {
        plantCounts.set(key, { fa: fa || en, en: en || fa, count: 1 });
      }
    }
  }

  const pending = total - done;
  const topPlants = [...plantCounts.values()].sort((a, b) => b.count - a.count).slice(0, 6);

  let busiest = -1;
  let quietest = -1;
  for (let i = 0; i < 12; i++) {
    if (byMonth[i].total > 0 && (busiest === -1 || byMonth[i].total > byMonth[busiest].total)) busiest = i;
    if (byMonth[i].total > 0 && (quietest === -1 || byMonth[i].total < byMonth[quietest].total)) quietest = i;
  }

  return {
    total,
    done,
    pending,
    completionPct: total ? Math.round((done / total) * 100) : 0,
    byMonth,
    byType: [...typeMap.values()].sort((a, b) => b.total - a.total),
    topPlants,
    busiest: busiest + 1, // jm (1..12) or 0 when empty
    quietest: quietest + 1,
    activeDays: new Set(doneDayNums).size,
    bestStreakInYear: longestRun(doneDayNums),
  };
}
