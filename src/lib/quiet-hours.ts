/**
 * PlantVerse — night quiet hours («سکوت شبانه»).
 *
 * A per-browser digest schedule: while the clock is inside the chosen
 * window, the notification bell defers its badge until the window ends
 * — the feed itself stays openable (nothing is hidden, only the pushy
 * red number sleeps). Pure logic shared by the notification center and
 * the tests; the window lives in the persisted zustand store.
 *
 * Window semantics: [start, end) in minutes-from-midnight.
 *   start <  end → same-day window (e.g. 13:00 → 18:00)
 *   start >  end → wraps midnight (e.g. 22:00 → 07:30)
 *   start === end→ degenerate → never quiet (a "zero-length" window)
 */

export const QUIET_DEFAULT_START = 22 * 60; // 22:00
export const QUIET_DEFAULT_END = 7 * 60 + 30; // 07:30

/** Picker grid — every 30-minute mark on the clock face (00:00 … 23:30). */
export const HALF_HOUR_STEPS: readonly number[] = Array.from({ length: 48 }, (_, i) => i * 30);

/** Clamp to the clock face and round to the picker's 30-min grid. */
export function normalizeQuietMinutes(min: number): number {
  if (!Number.isFinite(min)) return QUIET_DEFAULT_START;
  const rounded = Math.round(min / 30) * 30;
  return ((rounded % 1440) + 1440) % 1440;
}

/** Is `now` inside the [start, end) quiet window? Wrap-around aware.
    Non-finite window bounds → never quiet (defensive, no crash). */
export function isWithinQuietHours(now: Date, startMin: number, endMin: number): boolean {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return false;
  if (!Number.isFinite(startMin) || !Number.isFinite(endMin)) return false;
  const s = normalizeQuietMinutes(startMin);
  const e = normalizeQuietMinutes(endMin);
  if (s === e) return false; // zero-length window → never quiet
  const m = now.getHours() * 60 + now.getMinutes();
  return s < e ? m >= s && m < e : m >= s || m < e;
}

/** «۲۲:۳۰» / "22:30" — Persian digits for fa, zero-padded Latin for en. */
export function formatClock(min: number, lang: "fa" | "en"): string {
  const m = normalizeQuietMinutes(min);
  const hh = String(Math.floor(m / 60)).padStart(2, "0");
  const mm = String(m % 60).padStart(2, "0");
  const latin = `${hh}:${mm}`;
  return lang === "fa" ? latin.replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]) : latin;
}

/** «۲۲:۰۰ تا ۰۷:۳۰» / "22:00 → 07:30" — the window as one line. */
export function describeQuietWindow(startMin: number, endMin: number, lang: "fa" | "en"): string {
  return lang === "fa"
    ? `${formatClock(startMin, "fa")} تا ${formatClock(endMin, "fa")}`
    : `${formatClock(startMin, "en")} → ${formatClock(endMin, "en")}`;
}

/** Minutes the bell still sleeps from `now` (0 when outside the window). */
export function quietMinutesRemaining(now: Date, startMin: number, endMin: number): number {
  if (!isWithinQuietHours(now, startMin, endMin)) return 0;
  const e = normalizeQuietMinutes(endMin);
  const m = now.getHours() * 60 + now.getMinutes();
  return e > m ? e - m : 1440 - m + e;
}
