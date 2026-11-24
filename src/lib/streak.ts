/**
 * PlantVerse — care-streak engine («پیوستگی مراقبت»).
 *
 * A streak = consecutive calendar days with at least one COMPLETED care
 * event. Used by three consumers so every surface shows the same truth:
 *
 *  - `/api/reports/annual`  → current (global) + best-in-year streak
 *  - `/api/profile`         → replaces the old hardcoded `streakDays: 7`
 *  - `/api/garden`          → same fix (stats card)
 *
 * All math runs on integer "day numbers" derived from `yyyy-mm-dd` strings
 * via UTC-anchored division — timezone-safe (no local/UTC drift) and free of
 * Date mutation pitfalls. The project convention is local-time discipline
 * (see `isoLocalDate` below) — day numbers are only used for *diffing*.
 */

export interface StreakInfo {
  /** Consecutive done-days ending today (or yesterday if today is not done yet). */
  current: number;
  /** Longest consecutive run inside the provided date set. */
  best: number;
  /** Distinct days with ≥1 done event. */
  activeDays: number;
}

/** Serialize a Date as local `yyyy-mm-dd` (same helper as the reminders route — no UTC shift). */
export function isoLocalDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Parse `yyyy-mm-dd` into a stable integer day number (UTC-anchored, diff-only). */
export function dayNumber(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return Number.NaN;
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** Longest run of consecutive integers in a set of day numbers. */
export function longestRun(dayNums: Iterable<number>): number {
  const sorted = [...new Set(dayNums)].filter(Number.isFinite).sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  let prev = Number.NaN;
  for (const n of sorted) {
    run = n === prev + 1 ? run + 1 : 1;
    if (run > best) best = run;
    prev = n;
  }
  return best;
}

/**
 * Compute streak info from a set of done-event dates.
 *
 * Current-streak semantics: anchored at today when today has a done event,
 * otherwise at yesterday (the day is not over yet — an alive streak must not
 * read as broken before midnight). If neither day is done, the streak is 0.
 */
export function computeStreaks(doneDates: Iterable<string>, todayIso: string): StreakInfo {
  const days = new Set<number>();
  for (const iso of doneDates) {
    const n = dayNumber(iso);
    if (Number.isFinite(n)) days.add(n);
  }
  const today = dayNumber(todayIso);

  /* current — walk back from the anchor */
  let current = 0;
  if (days.has(today) || days.has(today - 1)) {
    const anchor = days.has(today) ? today : today - 1;
    let cursor = anchor;
    while (days.has(cursor)) cursor -= 1;
    current = anchor - cursor; // days covered: anchor .. cursor+1
  }

  const best = longestRun(days);
  return { current, best, activeDays: days.size };
}
