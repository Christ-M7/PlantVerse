/**
 * PlantVerse — bilingual relative-time helper (server-safe).
 *
 * Pure string math, no React, no Prisma — used by API routes to compute
 * authoritative "time ago" labels from createdAt timestamps, and available
 * to client components that need the same wording.
 */

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

const faDigits = (value: number | string): string =>
  String(value).replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]);

/** Break an age (ms) into calendar-ish buckets. */
function ageBucket(date: Date | string, now: number): number {
  return Math.max(0, Math.floor((now - new Date(date).getTime()) / 60_000)); // minutes
}

/** Persian relative time — «۳ ساعت پیش». Buckets: min → hour → day → week → month → year. */
export function relativeTimeFa(date: Date | string, now: number = Date.now()): string {
  const min = ageBucket(date, now);
  if (min < 1) return "همین حالا";
  if (min < 60) return `${faDigits(min)} دقیقه پیش`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${faDigits(h)} ساعت پیش`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${faDigits(d)} روز پیش`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${faDigits(w)} هفته پیش`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${faDigits(mo)} ماه پیش`;
  return `${faDigits(Math.floor(d / 365))} سال پیش`;
}

/** English relative time — "3h ago". Same buckets as the Persian twin. */
export function relativeTimeEn(date: Date | string, now: number = Date.now()): string {
  const min = ageBucket(date, now);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}
