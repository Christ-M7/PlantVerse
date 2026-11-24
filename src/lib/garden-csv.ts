/**
 * PlantVerse — garden CSV export builders («خروجی CSV باغچه»). 
 *
 * Pure domain logic (no DB / DOM imports) shared by the API route and
 * tests: turns garden rows + catalog enrichments into an RFC 4180 CSV
 * document. Output is Excel-friendly: UTF-8 with a leading BOM so both
 * fa headers and plant nicknames survive a double-click open.
 *
 * Data cells keep Latin digits (it is a data file — formulas/sorting stay
 * machine-friendly); header text follows the selected language.
 */

import { toJalali } from "@/lib/jalali";

export type GardenCsvLang = "fa" | "en";

export interface GardenCsvRow {
  nickname: string;
  plantSlug: string;
  nameFa: string;
  nameEn: string;
  health: number;
  statusFa: string;
  statusEn: string;
  nextTaskType: string; // water | fertilize | prune | spray
  nextTaskDays: number;
  createdAt: Date | string;
}

export interface GardenCsvStats {
  total: number;
  avgHealth: number;
}

/* ── text map ───────────────────────────────────────────────────────────── */

const TASK_FA: Record<string, string> = {
  water: "آبیاری",
  fertilize: "کوددهی",
  prune: "هرس",
  spray: "سمپاشی",
};
const TASK_EN: Record<string, string> = {
  water: "watering",
  fertilize: "feeding",
  prune: "pruning",
  spray: "misting",
};

const HEADERS: Record<GardenCsvLang, string[]> = {
  fa: ["نام مستعار", "نام گیاه", "شناسه گیاه", "سلامت (٪)", "وضعیت", "کار بعدی", "روز تا کار بعدی", "تاریخ افزودن (جلالی)"],
  en: ["Nickname", "Plant", "Plant slug", "Health (%)", "Status", "Next task", "Days to next task", "Added on (Jalali)"],
};

/* ── CSV primitives ─────────────────────────────────────────────────────── */

/** RFC 4180 field escaping — quotes only when required. */
export function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Join a row and terminate it with CRLF (RFC 4180 line break). */
function csvLine(fields: string[]): string {
  return fields.map(csvEscape).join(",") + "\r\n";
}

/** Jalali yyyy/m/d of a Date — fa shows Persian digits, en Latin. */
function jalaliCell(d: Date, lang: GardenCsvLang): string {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return "";
  const { jy, jm, jd } = toJalali(d);
  const s = `${jy}/${jm}/${jd}`;
  return lang === "fa" ? s.replace(/[0-9]/g, (c) => "۰۱۲۳۴۵۶۷۸۹"[Number(c)]) : s;
}

/**
 * Build the full CSV document (BOM + header + one row per plant).
 * Deterministic; rows are emitted in the order given (the API passes
 * createdAt-asc garden rows — same order the dashboard uses).
 */
export function buildGardenCsv(
  rows: GardenCsvRow[],
  lang: GardenCsvLang,
  stats?: GardenCsvStats
): string {
  const BOM = "\uFEFF";
  const lines: string[] = [csvLine(HEADERS[lang])];

  for (const r of rows) {
    const nickname = lang === "fa" ? r.nickname || r.nameFa : r.nickname || r.nameEn;
    const plantName = lang === "fa" ? r.nameFa || r.nickname : r.nameEn || r.nickname;
    const status = lang === "fa" ? r.statusFa : r.statusEn;
    const task = (lang === "fa" ? TASK_FA[r.nextTaskType] : TASK_EN[r.nextTaskType]) ?? r.nextTaskType;
    const created = r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt);
    lines.push(
      csvLine([
        nickname,
        plantName,
        r.plantSlug,
        String(r.health),
        status,
        task,
        String(r.nextTaskDays),
        jalaliCell(created, lang),
      ])
    );
  }

  /* summary footer — blank line, then aggregated stats (empty-garden safe) */
  const total = stats?.total ?? rows.length;
  const avg = stats?.avgHealth ?? (rows.length ? Math.round(rows.reduce((s, r) => s + r.health, 0) / rows.length) : 0);
  const fa = lang === "fa";
  const toFa = (s: string) => (fa ? s.replace(/[0-9]/g, (c) => "۰۱۲۳۴۵۶۷۸۹"[Number(c)]) : s);
  lines.push(csvLine([]));
  lines.push(csvLine([fa ? "تعداد گیاهان" : "Total plants", toFa(String(total))]));
  lines.push(csvLine([fa ? "میانگین سلامت (٪)" : "Average health (%)", toFa(String(avg))]));

  return BOM + lines.join("");
}

/* ═══════════════════════════════════════════════════════════════════════
   CSV import parsing — round-trip partner of buildGardenCsv.
   Accepts: (1) this app's own export (fa or en headers, BOM, stats footer),
   (2) headerless `slug,nickname` two-column files.
   ═══════════════════════════════════════════════════════════════════════ */

export interface GardenCsvPlant {
  nickname: string;
  slug: string;
}

export interface ParsedGardenCsv {
  /** rows that actually became plant entries (footer/garbage excluded) */
  plants: GardenCsvPlant[];
  totalRows: number;
  /** recognized fa/en header with a slug column, or headerless slug mode */
  hasSlugColumn: boolean;
  detectedLang: GardenCsvLang | null;
}

/** RFC 4180 row parser — quotes, escaped quotes, CRLF/LF, trailing newline. */
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  const pushField = () => { row.push(field); field = ""; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      pushField();
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      pushRow();
    } else {
      field += c;
    }
  }
  // flush the final unterminated row (skip when the text ended on a newline)
  if (field !== "" || row.length > 0) pushRow();
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/** Header vocabulary — fa + en (incl. the app's own export) + bare aliases. */
const HEADER_SLUG_ALIASES = ["plant slug", "slug", "شناسه گیاه"] as const;
const HEADER_NICK_ALIASES = ["nickname", "نام مستعار"] as const;

/** Loose header matcher — trims, lowercases latin, strips % etc. */
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const slugHeaderCell = (cell: string) => HEADER_SLUG_ALIASES.includes(norm(cell) as (typeof HEADER_SLUG_ALIASES)[number]);
const nickHeaderCell = (cell: string) => HEADER_NICK_ALIASES.includes(norm(cell) as (typeof HEADER_NICK_ALIASES)[number]);

/** Latin-dash slug shape — used to detect headerless files. */
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{1,78}$/;

/**
 * Parse a garden CSV into importable (slug, nickname) pairs.
 * Never throws — malformed input is reported through the flags so the API
 * can answer with precise, user-facing error codes.
 */
export function parseGardenCsv(rawText: string): ParsedGardenCsv {
  const text = rawText.replace(/^\uFEFF/, "");
  if (!text.trim()) {
    return { plants: [], totalRows: 0, hasSlugColumn: false, detectedLang: null };
  }

  const rows = parseCsvRows(text);
  if (rows.length === 0) {
    return { plants: [], totalRows: 0, hasSlugColumn: false, detectedLang: null };
  }

  /* header detection — the app's own export carries fa/en headers */
  const first = rows[0];
  let slugIdx = -1;
  let nickIdx = -1;
  let detectedLang: GardenCsvLang | null = null;

  for (let i = 0; i < first.length; i++) {
    if (slugHeaderCell(first[i])) {
      slugIdx = i;
      detectedLang = first[i].includes("شناسه") ? "fa" : "en";
    }
    if (nickHeaderCell(first[i])) nickIdx = i;
  }

  let dataRows: string[][];
  if (slugIdx >= 0) {
    dataRows = rows.slice(1);
  } else if (first.length >= 1 && SLUG_RE.test(first[0].trim())) {
    /* headerless mode: col0 = slug, col1 = nickname */
    slugIdx = 0;
    nickIdx = 1;
    dataRows = rows;
    detectedLang = null;
  } else {
    return { plants: [], totalRows: rows.length, hasSlugColumn: false, detectedLang: null };
  }

  const plants: GardenCsvPlant[] = [];
  for (const r of dataRows) {
    const slug = (r[slugIdx] ?? "").trim();
    if (!slug) continue; // stats-footer rows («تعداد گیاهان») carry no slug
    if (!SLUG_RE.test(slug)) continue; // garbage guard — slugs are latin-dash
    const nickname = (nickIdx >= 0 ? (r[nickIdx] ?? "") : "").trim().slice(0, 60);
    plants.push({ slug, nickname });
  }

  /** rows that actually became plant entries (footer/garbage excluded) */
  return { plants, totalRows: plants.length, hasSlugColumn: true, detectedLang };
}
