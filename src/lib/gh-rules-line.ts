/**
 * PlantVerse — greenhouse automation rules as chat context («قوانین در چت»).
 *
 * The chat bot already knows the LIVE sensor snapshot (R41-c); this lib
 * adds the other half of the greenhouse brain: the ACTIVE automation
 * rules, rendered as one compact bilingual line so the bot can answer
 * "what if" questions («اگر دما بالای ۳۰ رفت چی؟») strictly from the
 * user's real rule list instead of inventing one.
 *
 * Pure logic, no DB imports — the chat route fetches and this formats.
 * Junk rows (unknown metric/device keys, non-numeric thresholds) are
 * skipped honestly, never fabricated.
 */

import {
  GH_DEVICES,
  GH_MET,
  faDigits,
  type GhMetricKey,
  type GhRuleLike,
} from "@/lib/greenhouse";

/** Prompt armor — the DB caps custom rules at 8 (+11 seeded pairs). */
const MAX_RULES = 20;

/** Threshold rendering: integers bare, decimals trimmed (27 / 12.5 / 8000). */
function thresholdText(t: number): string {
  const v = Math.round(t * 100) / 100;
  return Number.isInteger(v) ? String(v) : String(v);
}

/** Grouped thousands for lux-scale values — mirrors the greenhouse ring. */
function metricValueText(metric: GhMetricKey, t: number, lang: "fa" | "en"): string {
  const m = GH_MET[metric];
  if (m?.grouped) {
    const grouped = new Intl.NumberFormat("en-US").format(t);
    return lang === "fa" ? faDigits(grouped) : grouped;
  }
  return lang === "fa" ? faDigits(thresholdText(t)) : thresholdText(t);
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";

/**
 * One rule → «اگر دما بالای ۳۰ شد → تهویه روشن می‌شود» / "temp above 30 →
 * Ventilation ON". Returns null for junk rows (skipped, never invented).
 */
export function formatOneGhRule(rule: unknown, lang: "fa" | "en"): string | null {
  if (!isRecord(rule)) return null;
  const metric = rule.metric;
  const device = rule.device;
  if (typeof metric !== "string" || typeof device !== "string") return null;
  const m = GH_MET[metric as GhMetricKey];
  const d = GH_DEVICES.find((x) => x.key === device);
  if (!m || !d) return null;
  const threshold = Number(rule.threshold);
  if (!Number.isFinite(threshold)) return null;
  const comparator = rule.comparator === "below" ? "below" : "above";
  const turnOn = rule.turnOn !== false;

  const val = metricValueText(m.key, threshold, lang);
  if (lang === "fa") {
    const dir = comparator === "above" ? "بالای" : "زیر";
    const action = turnOn ? "روشن می‌شود" : "خاموش می‌شود";
    return `اگر ${m.fa} ${dir} ${val} ${m.unitFa} شد → ${d.fa} ${action}`;
  }
  const dir = comparator === "above" ? "above" : "below";
  return `${m.en} ${dir} ${val}${m.unitEn === "%" ? "%" : ` ${m.unitEn}`} → ${d.en} ${turnOn ? "ON" : "OFF"}`;
}

/**
 * Full rules line for the system prompt (no trailing grounding sentence —
 * the route appends the instruction). Empty/junk input → the honest
 * "no active rules" phrasing so the bot never fabricates a rule list.
 */
export function formatGhRulesLine(rules: readonly unknown[], lang: "fa" | "en"): string {
  const parts: string[] = [];
  for (const r of rules) {
    if (parts.length >= MAX_RULES) break;
    const s = formatOneGhRule(r, lang);
    if (s) parts.push(s);
  }
  if (parts.length === 0) {
    return lang === "fa" ? "قانون اتوماسیون فعالی ثبت نشده است" : "no automation rules are active";
  }
  return parts.join(lang === "fa" ? "؛ " : "; ");
}

/**
 * The complete prompt block the chat route appends next to the sensor
 * snapshot. `rules` arrive enabled-only, createdAt-asc (the engine's own
 * evaluation order — the bot reasons with the same order it runs in).
 */
export function ghRulesPromptLine(rules: readonly unknown[], lang: "fa" | "en"): string {
  if (lang === "fa") {
    return `\nقوانین اتوماسیون فعال گلخانه (به ترتیب ارزیابی): ${formatGhRulesLine(rules, "fa")}. اگر کاربر دربارهٔ قوانین یا سناریوهای «اگر … شد چی؟» پرسید، فقط بر اساس همین فهرست جواب بده و قانون جدید از خودت نساز.`;
  }
  return `\nActive greenhouse automation rules (in evaluation order): ${formatGhRulesLine(rules, "en")}. If the user asks about the rules or "what if …" scenarios, answer strictly from this list — do not invent rules.`;
}

/** Enabled-only + engine order — the single fetch contract for the route. */
export function ruleFetchArgs() {
  return {
    where: { enabled: true },
    orderBy: { createdAt: "asc" as const },
  };
}

/** Re-export for tests that want the shared type without deep imports. */
export type { GhRuleLike };
