/**
 * PlantVerse — Smart-greenhouse IoT domain (shared server/client). 
 *
 * Pure constants + math + rule engine. No React, no Prisma, no "use client" —
 * both the API routes (authoritative simulation) and the UI components import
 * this file so the physics can never drift apart.
 */

export type GhMetricKey = "temp" | "hum" | "light" | "soil";
export type GhDeviceKey = "heater" | "fan" | "mister" | "growlight" | "irrigation";
export type GhComparator = "above" | "below";
export type GhLogKind = "rule" | "device" | "autopilot" | "alert";

/* ─────────────────────────── metrics ─────────────────────────── */

export interface GhMetricDef {
  key: GhMetricKey;
  fa: string;
  en: string;
  /** Seasonal baseline the value drifts toward. */
  base: number;
  /** Safe band (autopilot target). */
  min: number;
  max: number;
  /** Ring/axis display range. */
  ringMin: number;
  ringMax: number;
  /** Absolute validation bounds for rule thresholds. */
  absMin: number;
  absMax: number;
  /** Random-walk noise amplitude per tick. */
  noise: number;
  unitFa: string;
  unitEn: string;
  /** Thousands-grouped formatting (light). */
  grouped?: boolean;
}

export const GH_METRICS: GhMetricDef[] = [
  { key: "temp", fa: "دما", en: "Temperature", base: 24, min: 18, max: 30, ringMin: 12, ringMax: 36, absMin: -10, absMax: 50, noise: 2, unitFa: "سانتی‌گراد", unitEn: "°C" },
  { key: "hum", fa: "رطوبت هوا", en: "Air humidity", base: 65, min: 50, max: 80, ringMin: 30, ringMax: 95, absMin: 0, absMax: 100, noise: 2, unitFa: "درصد", unitEn: "%" },
  { key: "light", fa: "نور", en: "Light", base: 12400, min: 8000, max: 16000, ringMin: 4000, ringMax: 20000, absMin: 0, absMax: 50000, noise: 600, unitFa: "لوکس", unitEn: "lux", grouped: true },
  { key: "soil", fa: "رطوبت خاک", en: "Soil moisture", base: 48, min: 35, max: 60, ringMin: 20, ringMax: 75, absMin: 0, absMax: 100, noise: 1.5, unitFa: "درصد", unitEn: "%" },
];

export const GH_MET = Object.fromEntries(GH_METRICS.map((m) => [m.key, m])) as Record<GhMetricKey, GhMetricDef>;

export const isGhMetric = (v: unknown): v is GhMetricKey =>
  typeof v === "string" && GH_METRICS.some((m) => m.key === v);

/* ─────────────────────────── devices ─────────────────────────── */

export interface GhDeviceDef {
  key: GhDeviceKey;
  fa: string;
  en: string;
  descFa: string;
  descEn: string;
  /** Per-tick effect on each metric (added after natural drift). */
  effect: Partial<Record<GhMetricKey, number>>;
}

export const GH_DEVICES: GhDeviceDef[] = [
  { key: "heater", fa: "گرمکن", en: "Heater", descFa: "افزایش تدریجی دما", descEn: "Slowly raises temperature", effect: { temp: 1.1 } },
  { key: "fan", fa: "تهویه", en: "Ventilation", descFa: "خنک‌سازی و کاهش رطوبت", descEn: "Cools & dries the air", effect: { temp: -0.9, hum: -1.6 } },
  { key: "mister", fa: "مه‌پاش", en: "Misting", descFa: "افزایش رطوبت هوا", descEn: "Raises air humidity", effect: { hum: 2.2 } },
  { key: "growlight", fa: "چراغ رشد", en: "Grow light", descFa: "افزایش شدت نور", descEn: "Boosts light intensity", effect: { light: 900 } },
  { key: "irrigation", fa: "پمپ آبیاری", en: "Irrigation pump", descFa: "افزایش رطوبت خاک", descEn: "Raises soil moisture", effect: { soil: 2.4 } },
];

export const isGhDevice = (v: unknown): v is GhDeviceKey =>
  typeof v === "string" && GH_DEVICES.some((d) => d.key === v);

/* ─────────────────────────── timing ─────────────────────────── */

/** Tick cadence (ms) — the server simulation tick. */
export const GH_TICK_MS = 2500;
/** Fallback poll cadence (ms) when the socket stream is down — the old code
    polled at tick cadence (24 req/min while a user idles); 10 s is plenty
    for a view that is normally stream-fed. */
export const GH_FALLBACK_POLL_MS = 10000;
/** Readings kept per metric — kept in sync with the 15-minute time-based prune. */
export const GH_MAX_READINGS = 90;
/** History points returned in a snapshot (chart + sparklines). */
export const GH_HISTORY_POINTS = 48;
/** Seed history length on a fresh database. */
export const GH_BACKFILL_POINTS = 40;
/** Max user-created automation rules. */
export const GH_MAX_RULES = 8;

/* ─────────────────────────── sensor physics ─────────────────────────── */

/**
 * One simulation step for a metric: gentle pull toward the seasonal baseline,
 * random walk noise, then running-device effects, clamped slightly outside
 * the safe band so autopilot always has something to react to.
 */
export function nextSensorValue(
  metric: GhMetricDef,
  prev: number,
  devicesOn: ReadonlySet<string>
): number {
  const pull = (metric.base - prev) * 0.06;
  let v = prev + (Math.random() * 2 - 1) * metric.noise + pull;
  for (const d of GH_DEVICES) {
    if (devicesOn.has(d.key)) v += d.effect[metric.key] ?? 0;
  }
  return Math.min(metric.max + 4, Math.max(metric.min - 4, v));
}

/* ─────────────────────────── rule engine ─────────────────────────── */

export interface GhRuleLike {
  id: string;
  metric: string;
  comparator: string;
  threshold: number;
  device: string;
  turnOn: boolean;
  enabled: boolean;
}

export interface GhRuleFiring {
  rule: GhRuleLike;
  device: GhDeviceKey;
  turnOn: boolean;
}

/**
 * Evaluate rules in array order (createdAt asc); the LAST matching rule for a
 * device wins. Returns the desired next on/off set for every device plus the
 * rules that actually changed a device's state (for logging).
 */
export function runRules(
  rules: readonly GhRuleLike[],
  sensors: Readonly<Record<string, number>>,
  current: Readonly<Record<string, boolean>>
): { next: Record<GhDeviceKey, boolean>; firings: GhRuleFiring[] } {
  const next = { ...current } as Record<GhDeviceKey, boolean>;
  const decided = new Map<GhDeviceKey, GhRuleFiring>();

  for (const rule of rules) {
    if (!rule.enabled || !isGhDevice(rule.device) || !isGhMetric(rule.metric)) continue;
    const v = sensors[rule.metric];
    if (typeof v !== "number") continue;
    const hit = rule.comparator === "above" ? v > rule.threshold : v < rule.threshold;
    if (!hit) continue;
    const turnOn = Boolean(rule.turnOn);
    decided.set(rule.device, { rule, device: rule.device, turnOn });
    next[rule.device] = turnOn;
  }

  const firings = [...decided.values()].filter((f) => current[f.device] !== f.turnOn);
  return { next, firings };
}

/* ─────────────────────────── default rules ─────────────────────────── */

/**
 * Hysteresis pairs seeded on a fresh database: relax rules are listed FIRST so
 * that (being evaluated earlier) an "on" rule that matches at the same time as
 * its "off" relax rule — e.g. cold-but-humid air — always wins.
 */
export interface GhDefaultRule {
  metric: GhMetricKey;
  comparator: GhComparator;
  threshold: number;
  device: GhDeviceKey;
  turnOn: boolean;
}

export const GH_DEFAULT_RULES: GhDefaultRule[] = [
  { metric: "temp", comparator: "below", threshold: 27, device: "fan", turnOn: false }, // relax
  { metric: "temp", comparator: "above", threshold: 30, device: "fan", turnOn: true },
  { metric: "hum", comparator: "above", threshold: 80, device: "fan", turnOn: true },
  { metric: "temp", comparator: "above", threshold: 21, device: "heater", turnOn: false }, // relax
  { metric: "temp", comparator: "below", threshold: 18, device: "heater", turnOn: true },
  { metric: "hum", comparator: "above", threshold: 56, device: "mister", turnOn: false }, // relax
  { metric: "hum", comparator: "below", threshold: 50, device: "mister", turnOn: true },
  { metric: "light", comparator: "above", threshold: 10000, device: "growlight", turnOn: false }, // relax
  { metric: "light", comparator: "below", threshold: 8000, device: "growlight", turnOn: true },
  { metric: "soil", comparator: "above", threshold: 42, device: "irrigation", turnOn: false }, // relax
  { metric: "soil", comparator: "below", threshold: 35, device: "irrigation", turnOn: true },
];

/* ─────────────────────────── band alerts ─────────────────────────── */

/** Human copy for band alerts, per metric + direction (server logs these). */
export const GH_ALERT_COPY: Record<GhMetricKey, { highFa: string; highEn: string; lowFa: string; lowEn: string }> = {
  temp: {
    highFa: "دما بالای محدوده ایمن است — تهویه را روشن کنید",
    highEn: "Temperature above the safe band — turn on ventilation",
    lowFa: "دما پایین‌تر از حد مجاز است — گرمکن را روشن کنید",
    lowEn: "Temperature below the safe band — turn on the heater",
  },
  hum: {
    highFa: "رطوبت هوا بیش از حد است — تهویه لازم است",
    highEn: "Air humidity too high — ventilation needed",
    lowFa: "رطوبت هوا کم است — مه‌پاش را روشن کنید",
    lowEn: "Air humidity low — turn on misting",
  },
  light: {
    highFa: "نور بیش از حد قوی است — سایه‌اندازی توصیه می‌شود",
    highEn: "Light intensity too strong — consider shading",
    lowFa: "نور کافی نیست — چراغ رشد را روشن کنید",
    lowEn: "Not enough light — turn on the grow light",
  },
  soil: {
    highFa: "رطوبت خاک بیش از اندازه است — آبیاری متوقف شود",
    highEn: "Soil moisture too high — pause irrigation",
    lowFa: "خاک تشنه است — پمپ آبیاری را روشن کنید",
    lowEn: "Soil is thirsty — turn on the irrigation pump",
  },
};

/* ─────────────────────────── formatting helpers ─────────────────────────── */

/** Latin → Persian digits (server-side copy needs this for log messages). */
export const faDigits = (value: number | string): string =>
  String(value).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);

/** Round to 2 decimals — keeps stored readings tidy. */
export const r2 = (v: number): number => Math.round(v * 100) / 100;

/* ─────────────────────────── API payload types ─────────────────────────── */

export interface GhDeviceState {
  key: GhDeviceKey;
  isOn: boolean;
  source: string; // manual | autopilot | rule
}

export interface GhRuleDto {
  id: string;
  metric: GhMetricKey;
  comparator: GhComparator;
  threshold: number;
  device: GhDeviceKey;
  turnOn: boolean;
  enabled: boolean;
  builtin: boolean; // seeded hysteresis pair (excluded from the custom-rules cap)
  createdAt: string; // ISO
}

export interface GhLogDto {
  id: string;
  kind: GhLogKind;
  device: string;
  messageFa: string;
  messageEn: string;
  meta: { metric?: string; dir?: string };
  createdAt: string; // ISO
}

export interface GhPoint {
  t: string; // ISO
  v: number;
}

/** Full authoritative snapshot returned by GET /api/greenhouse (and every POST). */
export interface GhSnapshot {
  autopilot: boolean;
  devices: GhDeviceState[];
  latest: Record<GhMetricKey, number>;
  history: Record<GhMetricKey, GhPoint[]>;
  rules: GhRuleDto[];
  logs: GhLogDto[];
  /** Epoch ms of the newest reading — the client renders "just now / Ns ago". */
  sampledAt: string; // ISO
}
