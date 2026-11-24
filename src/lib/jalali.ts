/**
 * PlantVerse — Jalali (Solar Hijri) calendar domain utilities.
 * Pure functions, no dependencies. Standard Khayyam-based algorithm.
 */

const BREAKS = [
  -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192,
  2262, 2324, 2394, 2456, 3178,
];

const div = (a: number, b: number) => ~~(a / b);
const mod = (a: number, b: number) => a - ~~(a / b) * b;

function jalCal(jy: number) {
  const bl = BREAKS.length;
  const gy = jy + 621;
  let leapJ = -14;
  let jp = BREAKS[0];
  let jm = 0;
  let jump = 0;
  if (jy < jp || jy >= BREAKS[bl - 1]) throw new Error("Invalid Jalali year " + jy);
  for (let i = 1; i < bl; i += 1) {
    jm = BREAKS[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}

function g2d(gy: number, gm: number, gd: number) {
  let d =
    div((gy + div(gm - 8, 6) + 100100) * 1461, 4) +
    div(153 * mod(gm + 9, 12) + 2, 5) +
    gd -
    34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

function d2g(jdn: number) {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

function d2j(jdn: number): { jy: number; jm: number; jd: number } {
  const gy = d2g(jdn).gy;
  let jy = gy - 621;
  const r = jalCal(jy);
  const jdn1f = g2d(gy, 3, r.march);
  let k = jdn - jdn1f;
  if (k >= 0) {
    if (k <= 185) {
      return { jy, jm: 1 + div(k, 31), jd: mod(k, 31) + 1 };
    }
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }
  return { jy, jm: 7 + div(k, 30), jd: mod(k, 30) + 1 };
}

function j2d(jy: number, jm: number, jd: number) {
  const r = jalCal(jy);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}

export function isLeapJalaliYear(jy: number) {
  return jalCal(jy).leap === 0;
}

export function toJalali(date: Date) {
  return d2j(g2d(date.getFullYear(), date.getMonth() + 1, date.getDate()));
}

export function jalaliToDate(jy: number, jm: number, jd: number): Date {
  const g = d2g(j2d(jy, jm, jd));
  return new Date(g.gy, g.gm - 1, g.gd);
}

export function jalaliMonthLength(jy: number, jm: number) {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return isLeapJalaliYear(jy) ? 30 : 29;
}

export const JALALI_MONTHS = [
  "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
  "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
];

export const JALALI_MONTHS_EN = [
  "Farvardin", "Ordibehesht", "Khordad", "Tir", "Mordad", "Shahrivar",
  "Mehr", "Aban", "Azar", "Dey", "Bahman", "Esfand",
];

/** Persian weekday names starting Saturday */
export const JALALI_WEEKDAYS = ["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه"];
export const JALALI_WEEKDAYS_SHORT = ["ش", "ی", "د", "س", "چ", "پ", "ج"];
export const JALALI_WEEKDAYS_EN = ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"];

/** Jalali weekday index 0=شنبه…6=جمعه */
export function jalaliWeekday(date: Date) {
  const jsDay = date.getDay(); // 0=Sun … 6=Sat
  return (jsDay + 1) % 7;
}

export interface JalaliCell {
  jd: number;
  date: Date;
  weekday: number; // 0=شنبه
  isToday: boolean;
}

/** Full month grid: leading nulls for alignment + one cell per day */
export function jalaliMonthGrid(jy: number, jm: number, today = new Date()): (JalaliCell | null)[] {
  const len = jalaliMonthLength(jy, jm);
  const first = jalaliToDate(jy, jm, 1);
  const firstWeekday = jalaliWeekday(first);
  const t = toJalali(today);
  const cells: (JalaliCell | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= len; d++) {
    const date = jalaliToDate(jy, jm, d);
    cells.push({
      jd: d,
      date,
      weekday: jalaliWeekday(date),
      isToday: t.jy === jy && t.jm === jm && t.jd === d,
    });
  }
  return cells;
}

/** e.g. «۱۵ خرداد ۱۴۰۴» */
export function formatJalali(date: Date, opts?: { withYear?: boolean; fa: boolean }) {
  const { jy, jm, jd } = toJalali(date);
  const fa = opts?.fa ?? true;
  const toFa = (s: string) =>
    fa ? s.replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]) : s;
  const month = fa ? JALALI_MONTHS[jm - 1] : JALALI_MONTHS_EN[jm - 1];
  const y = opts?.withYear === false ? "" : ` ${toFa(String(jy))}`;
  return `${toFa(String(jd))} ${month}${y}`;
}
