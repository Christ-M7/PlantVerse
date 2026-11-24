/**
 * PlantVerse — garden month-in-review report builders («گزارش باغ»). 
 *
 * Pure domain logic (no DB / DOM imports) shared by the API route, the
 * client print flow and tests — the garden sibling of order-report.ts:
 *
 *   1. buildGardenReport     — joins the health-history aggregation
 *      (per-plant 30-day delta + done-care counts) with the live garden
 *      rows (notes, next task) and the upcoming care events into one
 *      bilingual report model.
 *   2. buildGardenReportHtml — renders the model into a self-contained,
 *      print-ready HTML document (RTL fa / LTR en) the client writes into
 *      a hidden iframe and prints → "Save as PDF" (no dependency).
 *
 * Status labels derive from the SAME health thresholds the garden CSV
 * export uses (≥85 excellent / ≥70 good / ≥50 medium / else low) so the
 * report can never disagree with the rest of the app. All user-provided
 * text (nicknames, notes, event titles) is HTML-escaped.
 */

import { toJalali } from "@/lib/jalali";
import type { GardenHealthHistory } from "@/lib/health-history";

/* ── types ──────────────────────────────────────────────────────────────── */

export interface GardenReportPlant {
  /** GardenPlant.id — joins the report back to the live garden rows */
  id: string;
  nickname: string;
  nameFa: string;
  nameEn: string;
  /** current health 0..100 */
  health: number;
  statusFa: string;
  statusEn: string;
  nextTaskType: string; // water | fertilize | prune | spray | …
  nextTaskFa: string;
  nextTaskEn: string;
  nextTaskDays: number;
  /** 30-day health delta (last − first within the lived window) */
  delta: number;
  /** ISO yyyy-mm-dd (local) the plant joined the garden */
  createdIso: string;
  noteFa: string;
  noteEn: string;
}

export interface GardenReportStats {
  totalPlants: number;
  avgHealth: number;
  /** only statuses that actually occur (no zero rows) */
  byStatus: Record<string, number>;
  trendingUp: number;
  trendingDown: number;
  trendingFlat: number;
  /** done care events across the window */
  completedTasks: number;
  /** distinct days with at least one done event */
  careActiveDays: number;
  /** not-done events dated today or later */
  upcomingTasks: number;
  best: { nameFa: string; nameEn: string; health: number } | null;
  weakest: { nameFa: string; nameEn: string; health: number } | null;
}

export interface GardenReportEvent {
  date: string; // ISO yyyy-mm-dd
  type: string;
  titleFa: string;
  titleEn: string;
  plantNamesFa: string;
  plantNamesEn: string;
}

export interface GardenReport {
  stats: GardenReportStats;
  plants: GardenReportPlant[];
  /** soonest not-done events, date ascending, capped upstream */
  upcoming: GardenReportEvent[];
  windowDays: number;
  generatedAt: string; // ISO datetime
}

export type ReportLang = "fa" | "en";

/* ── raw shapes the API feeds in (junk-tolerant) ────────────────────────── */

export interface GardenRowLike {
  id?: unknown;
  nickname?: unknown;
  plantSlug?: unknown;
  health?: unknown;
  nextTaskType?: unknown;
  nextTaskFa?: unknown;
  nextTaskEn?: unknown;
  nextTaskDays?: unknown;
  noteFa?: unknown;
  noteEn?: unknown;
  createdAt?: unknown;
}

export interface GardenEventLike {
  date?: unknown;
  type?: unknown;
  titleFa?: unknown;
  titleEn?: unknown;
  plantNamesFa?: unknown;
  plantNamesEn?: unknown;
  done?: unknown;
}

/* ── formatting helpers (mirror order-report.ts) ────────────────────────── */

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
function faNum(v: number | string): string {
  return String(v).replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]);
}
function num2(v: number, lang: ReportLang): string {
  return lang === "fa" ? faNum(v) : String(v);
}
function htmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Status meta from health — SAME thresholds as /api/garden/export. */
export function healthStatusMeta(health: number): { fa: string; en: string; key: string } {
  if (!Number.isFinite(health)) return { fa: "نامشخص", en: "unknown", key: "unknown" };
  if (health >= 85) return { fa: "عالی", en: "excellent", key: "excellent" };
  if (health >= 70) return { fa: "خوب", en: "good", key: "good" };
  if (health >= 50) return { fa: "متوسط", en: "medium", key: "medium" };
  return { fa: "ضعیف", en: "low", key: "low" };
}

/** key → label map (print table & chips); unknown stays honest. */
const STATUS_KEY_META: Record<string, { fa: string; en: string }> = {
  excellent: { fa: "عالی", en: "Excellent" },
  good: { fa: "خوب", en: "Good" },
  medium: { fa: "متوسط", en: "Medium" },
  low: { fa: "ضعیف", en: "Low" },
  unknown: { fa: "نامشخص", en: "—" },
};

const str = (v: unknown, cap: number): string => String(v ?? "").slice(0, cap);
const intOf = (v: unknown, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : fallback;
};

/* ── 1. aggregation ─────────────────────────────────────────────────────── */

export interface GardenReportInput {
  history: GardenHealthHistory;
  rows: GardenRowLike[];
  /** not-done events dated today or later, already sorted date-asc upstream */
  upcoming: GardenEventLike[];
}

/**
 * Join history + live rows + upcoming events into the report model.
 * History is the trend source of truth (it already merges backfilled and
 * real logs); rows contribute notes/task text; unknown junk rows are
 * dropped by the history join (rows without a history entry carry no
 * trend data and would be fiction).
 */
export function buildGardenReport(input: GardenReportInput, now: Date = new Date()): GardenReport {
  const rowById = new Map(
    input.rows
      .filter((r): r is GardenRowLike => !!r && typeof r === "object" && typeof (r as GardenRowLike).id === "string" && ((r as GardenRowLike).id as string).length > 0)
      .map((r) => [r.id as string, r])
  );

  const plants: GardenReportPlant[] = input.history.plants.map((h) => {
    const r = rowById.get(h.id);
    const health = Math.max(0, Math.min(100, intOf(h.current, 0)));
    const meta = healthStatusMeta(health);
    const taskType = str(r?.nextTaskType, 16) || "water";
    const days = intOf(r?.nextTaskDays, 0);
    return {
      id: h.id,
      nickname: str(h.nickname, 60),
      nameFa: str(h.nameFa, 60) || h.nickname,
      nameEn: str(h.nameEn, 60) || h.nickname,
      health,
      statusFa: meta.fa,
      statusEn: meta.key,
      nextTaskType: taskType,
      nextTaskFa: str(r?.nextTaskFa, 60),
      nextTaskEn: str(r?.nextTaskEn, 60),
      nextTaskDays: days,
      delta: intOf(h.delta, 0),
      createdIso: str(h.createdIso, 10),
      noteFa: str(r?.noteFa, 200),
      noteEn: str(r?.noteEn, 200),
    };
  });

  const byStatus: Record<string, number> = {};
  let healthSum = 0;
  let up = 0;
  let down = 0;
  let flat = 0;
  let best: GardenReportStats["best"] = null;
  let weakest: GardenReportStats["weakest"] = null;
  for (const p of plants) {
    const meta = healthStatusMeta(p.health);
    const key = meta.key;
    byStatus[key] = (byStatus[key] ?? 0) + 1;
    healthSum += p.health;
    if (p.delta > 0) up++;
    else if (p.delta < 0) down++;
    else flat++;
    /* ties keep the earliest-planted (history is createdAt-asc; strict
       comparisons never replace the first-found extreme) */
    if (!best || p.health > best.health) best = { nameFa: p.nameFa, nameEn: p.nameEn, health: p.health };
    if (!weakest || p.health < weakest.health) weakest = { nameFa: p.nameFa, nameEn: p.nameEn, health: p.health };
  }

  const completedTasks = input.history.careCounts.reduce((s, c) => s + Math.max(0, c.count), 0);
  const upcoming = input.upcoming
    .filter((e) => e.done !== true)
    .map((e) => ({
      date: str(e.date, 10),
      type: str(e.type, 16),
      titleFa: str(e.titleFa, 80),
      titleEn: str(e.titleEn, 80),
      plantNamesFa: str(e.plantNamesFa, 120),
      plantNamesEn: str(e.plantNamesEn, 120),
    }));

  return {
    stats: {
      totalPlants: plants.length,
      avgHealth: plants.length ? Math.round(healthSum / plants.length) : 0,
      byStatus,
      trendingUp: up,
      trendingDown: down,
      trendingFlat: flat,
      completedTasks,
      careActiveDays: input.history.careCounts.filter((c) => c.count > 0).length,
      upcomingTasks: upcoming.length,
      best: plants.length ? best : null,
      weakest: plants.length ? weakest : null,
    },
    plants,
    upcoming,
    windowDays: input.history.days,
    generatedAt: now.toISOString(),
  };
}

/* ── 2. print-ready HTML ────────────────────────────────────────────────── */

function renderDate(iso: string, lang: ReportLang): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(d.getTime())) return "—";
  if (lang === "fa") {
    const { jy, jm, jd } = toJalali(d);
    return faNum(`${jy}/${String(jm).padStart(2, "0")}/${String(jd).padStart(2, "0")}`);
  }
  return iso.slice(0, 10);
}

const TASK_FA: Record<string, string> = { water: "آبیاری", fertilize: "کوددهی", prune: "هرس", spray: "سمپاشی" };
const TASK_EN: Record<string, string> = { water: "Watering", fertilize: "Feeding", prune: "Pruning", spray: "Misting" };

const T = {
  fa: {
    title: "گزارش باغ",
    brand: "جهان‌گیاه",
    subtitle: "مرور ماهانهٔ باغچهٔ سبز شما",
    generated: "تاریخ تهیه",
    window: "بازهٔ بررسی",
    plants: "گیاه",
    avgHealth: "میانگین سلامت",
    completed: "مراقبت انجام‌شده",
    upcoming: "کار پیش‌رو",
    colPlant: "گیاه",
    colStatus: "وضعیت",
    colHealth: "سلامت",
    colTrend: "روند",
    colTask: "کار بعدی",
    colPlanted: "کاشت",
    days: "روز",
    overdue: "عقب‌افتاده",
    dueIn: "تا",
    colDate: "تاریخ",
    colEvent: "یادآور",
    colFor: "برای",
    upcomingTitle: "کارهای پیش‌رو",
    bestLine: "درخشان‌ترین",
    weakestLine: "نیازمند توجه",
    footer: "این گزارش به‌صورت خودکار توسط جهان‌گیاه تهیه شده است.",
    none: "باغچه خالی است — اولین گیاهت را اضافه کن!",
    noUpcoming: "برنامهٔ پیش‌روی ثبت‌شده‌ای نیست.",
  },
  en: {
    title: "Garden Report",
    brand: "PlantVerse",
    subtitle: "Your garden's month in review",
    generated: "Generated",
    window: "Review window",
    plants: "Plants",
    avgHealth: "Average health",
    completed: "Care completed",
    upcoming: "Upcoming tasks",
    colPlant: "Plant",
    colStatus: "Status",
    colHealth: "Health",
    colTrend: "Trend",
    colTask: "Next task",
    colPlanted: "Planted",
    days: "days",
    overdue: "overdue",
    dueIn: "in",
    colDate: "Date",
    colEvent: "Reminder",
    colFor: "For",
    upcomingTitle: "Upcoming care",
    bestLine: "Thriving",
    weakestLine: "Needs attention",
    footer: "This report was generated automatically by PlantVerse.",
    none: "Your garden is empty — add your first plant!",
    noUpcoming: "No scheduled care ahead.",
  },
} as const;

/** Trend cell: ↑ +4 / ↓ −3 / — (0). fa digits when fa. */
function trendCell(delta: number, lang: ReportLang): { text: string; cls: string } {
  if (delta > 0) return { text: `↑ ${num2(delta, lang)}`, cls: "up" };
  if (delta < 0) return { text: `↓ ${num2(Math.abs(delta), lang)}`, cls: "down" };
  return { text: "—", cls: "flat" };
}

/**
 * Render the report as a standalone HTML document for printing.
 * Self-contained: inline CSS only (system stack), A4 page via @page,
 * dir/lang per language, deterministic output.
 */
export function buildGardenReportHtml(report: GardenReport, lang: ReportLang): string {
  const t = T[lang];
  const rtl = lang === "fa";
  const esc = htmlEscape;
  const st = report.stats;
  const plantName = (p: { nickname: string; nameFa: string; nameEn: string }) =>
    esc(rtl ? p.nickname || p.nameFa : p.nameEn || p.nickname);

  const statCards = [
    { label: t.plants, value: num2(st.totalPlants, lang) },
    { label: t.avgHealth, value: `${num2(st.avgHealth, lang)}٪`.replace("٪", lang === "fa" ? "٪" : "%") },
    { label: t.completed, value: num2(st.completedTasks, lang) },
    { label: t.upcoming, value: num2(st.upcomingTasks, lang) },
  ]
    .map((c) => `<div class="card"><p class="card-label">${esc(c.label)}</p><p class="card-value">${esc(c.value)}</p></div>`)
    .join("");

  const statusChips = Object.entries(st.byStatus)
    .sort((a, b) => b[1] - a[1])
    .map(([key, n]) => {
      const meta = STATUS_KEY_META[key] ?? { fa: key, en: key };
      return `<span class="chip">${esc(rtl ? meta.fa : meta.en)}: ${esc(num2(n, lang))}</span>`;
    })
    .join("");

  const trendChips = [
    st.trendingUp > 0 ? `<span class="chip up">↑ ${esc(num2(st.trendingUp, lang))}</span>` : "",
    st.trendingDown > 0 ? `<span class="chip down">↓ ${esc(num2(st.trendingDown, lang))}</span>` : "",
    st.trendingFlat > 0 ? `<span class="chip">— ${esc(num2(st.trendingFlat, lang))}</span>` : "",
  ]
    .filter(Boolean)
    .join("");

  const daysLabel = (d: number) =>
    d < 0
      ? `${esc(num2(Math.abs(d), lang))} ${esc(t.days)} ${esc(t.overdue)}`
      : d === 0
        ? rtl ? "امروز" : "today"
        : `${esc(t.dueIn)} ${esc(num2(d, lang))} ${esc(t.days)}`;

  const rows = report.plants
    .map((p) => {
      const meta = healthStatusMeta(p.health);
      const status = esc(rtl ? meta.fa : (STATUS_KEY_META[meta.key]?.en ?? meta.key));
      const trend = trendCell(p.delta, lang);
      const taskText = rtl
        ? `${esc(p.nextTaskFa || TASK_FA[p.nextTaskType] || "مراقبت")} · ${daysLabel(p.nextTaskDays)}`
        : `${esc(p.nextTaskEn || TASK_EN[p.nextTaskType] || "Care")} · ${daysLabel(p.nextTaskDays)}`;
      return `<tr>
  <td>${plantName(p)}${(rtl ? p.noteFa : p.noteEn) ? `<span class="note">${esc(rtl ? p.noteFa : p.noteEn)}</span>` : ""}</td>
  <td>${status}</td>
  <td class="num">${esc(num2(p.health, lang))}</td>
  <td class="trend ${trend.cls}">${esc(trend.text)}</td>
  <td class="task-cell">${taskText}</td>
  <td>${esc(renderDate(p.createdIso, lang))}</td>
</tr>`;
    })
    .join("\n");

  const upcomingRows = report.upcoming
    .slice(0, 8)
    .map((e) => {
      const task = rtl ? TASK_FA[e.type] ?? "مراقبت" : TASK_EN[e.type] ?? "Care";
      const title = rtl ? e.titleFa || task : e.titleEn || task;
      const forWhom = rtl ? e.plantNamesFa : e.plantNamesEn;
      return `<tr>
  <td class="mono">${esc(renderDate(e.date, lang))}</td>
  <td>${esc(title)}<span class="note">${esc(task)}</span></td>
  <td>${esc(forWhom || "—")}</td>
</tr>`;
    })
    .join("\n");

  const windowFrom = new Date(report.generatedAt);
  windowFrom.setDate(windowFrom.getDate() - (report.windowDays - 1));
  const windowFromIso = `${windowFrom.getFullYear()}-${String(windowFrom.getMonth() + 1).padStart(2, "0")}-${String(windowFrom.getDate()).padStart(2, "0")}`;

  return `<!DOCTYPE html>
<html lang="${lang}" dir="${rtl ? "rtl" : "ltr"}">
<head>
<meta charset="utf-8">
<title>${esc(t.title)} · ${esc(t.brand)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: Vazirmatn, "Segoe UI", Tahoma, Arial, sans-serif;
    color: #1c2b23; font-size: 12px; line-height: 1.7;
    background: #fff; padding: 4px;
  }
  .brand-row { display: flex; align-items: center; gap: 10px; border-bottom: 3px solid #2f6b4f; padding-bottom: 10px; }
  .leaf { width: 34px; height: 34px; border-radius: 10px; background: #2f6b4f; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 18px; flex: 0 0 auto; }
  h1 { font-size: 19px; }
  .sub { color: #5b6f63; font-size: 11px; }
  .meta-line { margin-top: 8px; color: #5b6f63; font-size: 10.5px; display: flex; gap: 14px; flex-wrap: wrap; }
  .cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 14px 0 10px; }
  .card { border: 1px solid #dbe7df; border-radius: 10px; padding: 8px 10px; background: #f4faf6; }
  .card-label { color: #5b6f63; font-size: 10px; }
  .card-value { font-size: 15px; font-weight: 800; margin-top: 2px; }
  .chips { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }
  .chip { border: 1px solid #dbe7df; background: #f4faf6; border-radius: 999px; padding: 2px 10px; font-size: 10.5px; font-weight: 700; }
  .chip.up { border-color: #bfe3cc; background: #eaf7ee; color: #256b43; }
  .chip.down { border-color: #f0cfc4; background: #fdf1ec; color: #a4502f; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #dbe7df; padding: 6px 8px; text-align: ${rtl ? "right" : "left"}; vertical-align: top; }
  th { background: #2f6b4f; color: #fff; font-size: 10.5px; font-weight: 800; white-space: nowrap; }
  tr:nth-child(even) td { background: #f7fbf8; }
  .mono { font-family: ui-monospace, Menlo, Consolas, monospace; font-weight: 700; white-space: nowrap; }
  .num { font-weight: 800; white-space: nowrap; }
  .trend.up { color: #256b43; font-weight: 800; white-space: nowrap; }
  .trend.down { color: #a4502f; font-weight: 800; white-space: nowrap; }
  .trend.flat { color: #7a8c81; white-space: nowrap; }
  .task-cell { font-size: 10.5px; color: #3c5246; }
  .note { display: block; font-size: 9.5px; color: #7a8c81; }
  .best-line { margin: 10px 0 2px; font-size: 10.5px; color: #3c5246; display: flex; gap: 16px; flex-wrap: wrap; }
  .best-line b { color: #1c2b23; }
  h2 { font-size: 13px; margin: 16px 0 8px; color: #2f6b4f; }
  .empty { padding: 26px; text-align: center; color: #5b6f63; border: 1px dashed #dbe7df; border-radius: 12px; margin-top: 14px; }
  .footer { margin-top: 16px; padding-top: 8px; border-top: 1px solid #dbe7df; color: #7a8c81; font-size: 9.5px; text-align: center; }
  @media print { .card, .chip, th { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
  <div class="brand-row">
    <span class="leaf">🌿</span>
    <div>
      <h1>${esc(t.title)}</h1>
      <p class="sub">${esc(t.brand)} — ${esc(t.subtitle)}</p>
    </div>
  </div>
  <p class="meta-line">
    <span>${esc(t.generated)}: ${esc(renderDate(report.generatedAt, lang))}</span>
    <span>${esc(t.window)}: ${esc(renderDate(windowFromIso, lang))} → ${esc(renderDate(report.generatedAt, lang))}</span>
  </p>
  ${report.plants.length === 0 ? `<div class="empty">${esc(t.none)}</div>` : `
  <div class="cards">${statCards}</div>
  <div class="chips">${statusChips}${trendChips}</div>
  <table>
    <thead>
      <tr>
        <th>${esc(t.colPlant)}</th>
        <th>${esc(t.colStatus)}</th>
        <th>${esc(t.colHealth)}</th>
        <th>${esc(t.colTrend)}</th>
        <th>${esc(t.colTask)}</th>
        <th>${esc(t.colPlanted)}</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  ${st.best || st.weakest ? `<p class="best-line">${st.best ? `<span>${esc(t.bestLine)}: <b>${esc(rtl ? st.best.nameFa : st.best.nameEn)}</b> (${esc(num2(st.best.health, lang))})</span>` : ""}${st.weakest ? `<span>${esc(t.weakestLine)}: <b>${esc(rtl ? st.weakest.nameFa : st.weakest.nameEn)}</b> (${esc(num2(st.weakest.health, lang))})</span>` : ""}</p>` : ""}
  ${upcomingRows ? `<h2>${esc(t.upcomingTitle)}</h2>
  <table>
    <thead>
      <tr><th>${esc(t.colDate)}</th><th>${esc(t.colEvent)}</th><th>${esc(t.colFor)}</th></tr>
    </thead>
    <tbody>${upcomingRows}</tbody>
  </table>` : `<p class="meta-line">${esc(t.noUpcoming)}</p>`}`}
  <p class="footer">${esc(t.footer)} · ${esc(t.brand)} 🌿</p>
</body>
</html>`;
}
