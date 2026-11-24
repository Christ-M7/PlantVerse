/**
 * PlantVerse — Care calendar ICS builder («تقویم مراقبت» export)
 *
 * RFC 5545 (iCalendar) text/calendar generator that turns undone care
 * reminders (CareEvent) + auto-planned garden tasks (GardenPlant) into a
 * subscribable/downloadable .ics file users can add to Google Calendar,
 * Apple Calendar or Outlook.
 *
 * Design notes
 *  - No RRULE: the reminders engine already materializes every occurrence of
 *    a recurrence rule as a real row (SERIES_MAX_OCCURRENCES × horizon), so
 *    each undone row exports as its own all-day VEVENT — deleting/ completing
 *    one occurrence in the app refreshes the next download honestly.
 *  - All-day semantics: DTSTART;VALUE=DATE + DTEND next day, no timezone.
 *  - Deterministic output for a given (events, tasks, now): rows are sorted
 *    by (dtstart, uid) and DTSTAMP derives from the injected `now` — the
 *    test-suite asserts byte-stable regenerations.
 *  - RFC 5545 folding: physical lines ≤ 75 OCTETS, continuation prefixed by
 *    one space, breaks at UTF-8 code-point boundaries (never splits a
 *    multi-byte Persian character mid-sequence) and CRLF line endings.
 */

export interface IcsCareEvent {
  id: string;
  type: string;
  titleFa: string;
  titleEn: string;
  plantNamesFa: string;
  plantNamesEn: string;
  /** ISO yyyy-mm-dd (CareEvent.date) */
  date: string;
  repeatDays: number;
  done: boolean;
}

export interface IcsGardenTask {
  plantId: string;
  nickname: string;
  /** water | fertilize | prune | spray */
  taskType: string;
  /** calendar date the task is due (today + nextTaskDays) */
  dueDate: Date;
  health: number;
}

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const faDigits = (value: number | string): string =>
  String(value).replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]);

const TASK_LABEL: Record<string, { fa: string; en: string }> = {
  water: { fa: "آبیاری", en: "Watering" },
  fertilize: { fa: "کوددهی", en: "Fertilizing" },
  prune: { fa: "هرس", en: "Pruning" },
  spray: { fa: "سمپاشی", en: "Spraying" },
};

/* ── RFC 5545 primitives ─────────────────────────────────────────────────── */

/** Escape a TEXT property value (\ ; , and newlines — RFC 5545 §3.3.11). */
export function escapeIcsText(value: string): string {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n/g, "\\n")
    .replace(/\r|\n/g, "\\n");
}

/** UTF-8 octet length of a string (folding budget is bytes, not chars). */
const utf8Octets = (s: string): number => {
  let n = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    n += cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4;
  }
  return n;
};

/**
 * Fold one logical line into physical lines of ≤ `maxOctets` (75) octets,
 * breaking only at code-point boundaries — a 2-byte Persian char always
 * travels whole. Continuation lines open with a single space (§3.1).
 */
export function foldIcsLine(line: string, maxOctets = 75): string {
  if (utf8Octets(line) <= maxOctets) return line;
  const parts: string[] = [];
  let current = "";
  let budget = maxOctets;
  for (const ch of line) {
    const w = utf8Octets(ch);
    if (w > budget) {
      parts.push(current);
      current = " " + ch;
      // the " " prefix already spent 1 octet of the fresh line
      budget = Math.max(0, maxOctets - 1 - w);
    } else {
      current += ch;
      budget -= w;
    }
  }
  if (current) parts.push(current);
  return parts.join("\r\n");
}

/** Serialize content lines: fold each, join with CRLF (§3.1). */
export function icsSerialize(lines: string[]): string {
  return lines.map((l) => foldIcsLine(l)).join("\r\n") + "\r\n";
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** All-day DATE value: yyyyMMdd (RFC 5545 §3.3.4). */
export function toIcsDate(d: Date): string {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
}

/** UTC DTSTAMP: yyyyMMdd'T'HHmmss'Z' (RFC 5545 §3.3.5). */
export function toIcsStamp(d: Date): string {
  return (
    `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}` +
    `T${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}Z`
  );
}

/** Parse ISO yyyy-mm-dd into a LOCAL Date (no UTC shift — mirrors /api/reminders). */
export function fromIsoDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y || 2000, (m || 1) - 1, d || 1);
}

const nextDay = (d: Date): Date => {
  const n = new Date(d);
  n.setDate(n.getDate() + 1);
  return n;
};

/* ── event composition ───────────────────────────────────────────────────── */

interface ComposedEvent {
  uid: string;
  start: Date;
  summary: string;
  description: string;
}

const composeCareEvent = (e: IcsCareEvent, lang: "fa" | "en"): ComposedEvent | null => {
  if (e.done) return null;
  if (!e.id || !/^\d{4}-\d{2}-\d{2}$/.test(String(e.date ?? ""))) return null;
  const start = fromIsoDate(e.date);
  if (Number.isNaN(start.getTime())) return null;
  const title = lang === "fa" ? e.titleFa : e.titleEn;
  const plants = lang === "fa" ? e.plantNamesFa : e.plantNamesEn;
  const cleanTitle = title.trim() || TASK_LABEL[e.type]?.[lang] || (lang === "fa" ? "مراقبت" : "Care");
  const summary = plants.trim() ? `${cleanTitle} — ${plants.trim()}` : cleanTitle;

  let description: string;
  if (e.repeatDays > 0) {
    description =
      lang === "fa"
        ? `تکرار خودکار هر ${faDigits(e.repeatDays)} روز — ساخته‌شده توسط جهان‌گیاه`
        : `Auto-repeats every ${e.repeatDays} days — generated by PlantVerse`;
  } else {
    description = lang === "fa" ? "یادآور مراقبت — جهان‌گیاه 🌿" : "Care reminder — PlantVerse 🌿";
  }

  return {
    uid: `plantverse-care-${e.id}@plantverse.app`,
    start,
    summary,
    description,
  };
};

const composeGardenTask = (t: IcsGardenTask, lang: "fa" | "en"): ComposedEvent | null => {
  if (!(t.dueDate instanceof Date) || Number.isNaN(t.dueDate.getTime())) return null;
  if (!t.plantId) return null;
  const label = TASK_LABEL[t.taskType]?.[lang] ?? (lang === "fa" ? "مراقبت" : "Care");
  const nickname = String(t.nickname ?? "").trim() || (lang === "fa" ? "گیاه من" : "My plant");
  const health = Number.isFinite(t.health)
    ? Math.max(0, Math.min(100, Math.round(t.health)))
    : 90;
  const description =
    lang === "fa"
      ? `سلامت: ${faDigits(health)} از ${faDigits(100)} — برنامه‌ریزی خودکار باغ جهان‌گیاه`
      : `Health: ${health}/100 — auto-planned by PlantVerse garden`;
  return {
    // stable for the same plant + due date → calendar re-imports dedupe
    uid: `plantverse-task-${t.plantId}-${toIcsDate(t.dueDate)}@plantverse.app`,
    start: t.dueDate,
    summary: `${label} — ${nickname}`,
    description,
  };
};

/* ── calendar assembly ───────────────────────────────────────────────────── */

/**
 * Build the full RFC 5545 document. Never throws: bad rows (done events,
 * invalid dates, empty ids) are skipped; empty inputs still produce a valid
 * empty VCALENDAR. `lang` defaults to fa, unknown values fall back to fa.
 */
export function buildCareCalendar(opts: {
  lang?: string;
  now: Date;
  events?: IcsCareEvent[];
  tasks?: IcsGardenTask[];
}): string {
  const lang: "fa" | "en" = opts.lang === "en" ? "en" : "fa";
  const now = opts.now instanceof Date && !Number.isNaN(opts.now.getTime()) ? opts.now : new Date();

  const composed: ComposedEvent[] = [];
  for (const e of Array.isArray(opts.events) ? opts.events : []) {
    const c = composeCareEvent(e, lang);
    if (c) composed.push(c);
  }
  for (const t of Array.isArray(opts.tasks) ? opts.tasks : []) {
    const c = composeGardenTask(t, lang);
    if (c) composed.push(c);
  }
  composed.sort(
    (a, b) =>
      a.start.getTime() - b.start.getTime() || (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0)
  );

  const calName =
    lang === "fa" ? "تقویم مراقبت — جهان‌گیاه" : "PlantVerse — Care calendar";
  const calDesc =
    lang === "fa"
      ? "یادآورهای مراقبت و کارهای باغ گیاهان من"
      : "Care reminders and garden tasks for my plants";

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//PlantVerse//Care Calendar 1.0//FA",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(calName)}`,
    `X-WR-CALDESC:${escapeIcsText(calDesc)}`,
  ];
  const stamp = toIcsStamp(now);
  for (const ev of composed) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${escapeIcsText(ev.uid)}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${toIcsDate(ev.start)}`,
      `DTEND;VALUE=DATE:${toIcsDate(nextDay(ev.start))}`,
      `SUMMARY:${escapeIcsText(ev.summary)}`,
      `DESCRIPTION:${escapeIcsText(ev.description)}`,
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");
  return icsSerialize(lines);
}
