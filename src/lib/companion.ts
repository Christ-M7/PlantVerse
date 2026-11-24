/**
 * PlantVerse — companion compatibility analysis («آزمون سازگاری هم‌جواری»). 
 *
 * Pure domain logic (no DB imports) shared by the API route and tests:
 * pairwise comparison of catalog care attributes for plants sharing the
 * same garden. A "conflict" means two plants have care needs so far apart
 * that keeping them in one spot forces a wrong watering/light/humidity
 * routine for one of them.
 *
 * Ordering scales:  low < medium < bright_indirect < direct  (light)
 *                   low < medium < high                      (water/humidity)
 * Conflict threshold: rank distance ≥ 2 (the extremes disagree — e.g. a
 * snake-plant next to a fern). Distance 1 is a tolerable difference.
 * Temperature: hard conflict only when the comfort ranges don't overlap.
 */

/* ── types ──────────────────────────────────────────────────────────────── */

export interface CompanionPlant {
  id: string;
  plantSlug: string;
  nickname: string;
  light: string; // low | medium | bright_indirect | direct
  water: string; // low | medium | high
  humidity: string; // low | medium | high
  tempMin: number;
  tempMax: number;
  nameFa: string;
  nameEn: string;
  image?: string; // catalog image (UI avatars; optional to keep pure tests light)
}

export type ConflictKind = "light" | "water" | "humidity" | "temperature";
export type ConflictSeverity = "hard" | "soft";

export interface ConflictReason {
  kind: ConflictKind;
  severity: ConflictSeverity;
  /** bilingual one-line explanation, e.g. «نور: …» */
  fa: string;
  en: string;
  /** bilingual actionable suggestion for this specific kind */
  adviceFa: string;
  adviceEn: string;
}

export interface CompanionPair {
  aId: string;
  bId: string;
  aSlug: string;
  bSlug: string;
  aNickname: string;
  bNickname: string;
  /** catalog display names — the UI resolves them with the same
      isFa ? nickname || nameFa : nameEn || nickname rule as /api/garden */
  aNameFa: string;
  aNameEn: string;
  bNameFa: string;
  bNameEn: string;
  aImage: string;
  bImage: string;
  reasons: ConflictReason[];
  severity: ConflictSeverity;
}

export interface CompanionReport {
  score: number; // 0..100
  checked: number; // plants compared
  pairs: CompanionPair[];
}

/* ── scales ─────────────────────────────────────────────────────────────── */

export const LIGHT_RANK: Record<string, number> = { low: 0, medium: 1, bright_indirect: 2, direct: 3 };
export const WATER_RANK: Record<string, number> = { low: 0, medium: 1, high: 2 };

/** Bilingual value labels used inside conflict messages. */
const LIGHT_LABEL: Record<string, { fa: string; en: string }> = {
  low: { fa: "کم‌نور", en: "low light" },
  medium: { fa: "نور متوسط", en: "medium light" },
  bright_indirect: { fa: "نور غیرمستقیم و روشن", en: "bright indirect light" },
  direct: { fa: "آفتاب مستقیم", en: "direct sun" },
};
const WATER_LABEL: Record<string, { fa: string; en: string }> = {
  low: { fa: "آبیاری کم", en: "little water" },
  medium: { fa: "آبیاری متوسط", en: "moderate water" },
  high: { fa: "آبیاری زیاد", en: "lots of water" },
};
const HUMIDITY_LABEL: Record<string, { fa: string; en: string }> = {
  low: { fa: "رطوبت کم", en: "dry air" },
  medium: { fa: "رطوبت متوسط", en: "moderate humidity" },
  high: { fa: "رطوبت بالا", en: "high humidity" },
};

/* ── pairwise checks ────────────────────────────────────────────────────── */

/** Rank distance ≥ 2 → the two ends genuinely disagree on the same routine. */
const SOFT_DISTANCE = 2;

function attrConflict(
  kind: ConflictKind,
  rankMap: Record<string, number>,
  label: Record<string, { fa: string; en: string }>,
  a: CompanionPlant,
  b: CompanionPlant
): ConflictReason | null {
  const ra = rankMap[a[kind]];
  const rb = rankMap[b[kind]];
  if (ra === undefined || rb === undefined) return null; // unknown value → stay silent
  const gap = Math.abs(ra - rb);
  if (gap < SOFT_DISTANCE) return null;
  const maxGap = Math.max(...Object.values(rankMap));
  /* gap == scale max → the two ends genuinely can't share a routine
     (water low vs high, or shade vs direct sun) → hard;
     an intermediate gap on a wider scale (light) stays soft */
  const severity: ConflictSeverity = gap >= maxGap ? "hard" : "soft";
  const high = ra > rb ? a : b;
  const low = ra > rb ? b : a;
  return {
    kind,
    severity,
    fa: `${kind === "light" ? "نور" : kind === "water" ? "آب" : "رطوبت"}: «${high.nickname}» ${label[high[kind]].fa} می‌خواهد، «${low.nickname}» ${label[low[kind]].fa}`,
    en: `${kind === "light" ? "Light" : kind === "water" ? "Water" : "Humidity"}: “${high.nickname}” needs ${label[high[kind]].en}, “${low.nickname}” needs ${label[low[kind]].en}`,
    adviceFa:
      kind === "light"
        ? "گلدان‌ها را با فاصله از هم بچینید: یکی نزدیک پنجرهٔ روشن، دیگری در نیمه‌سایه."
        : kind === "water"
          ? "آبیاری این دو را جداگانه برنامه‌ریزی کنید؛ هر دو را هم‌زمان خیس نکنید."
          : "یکی را نزدیک دستگاه بخارساز یا سرویس بهداشتی بگذارید و دیگری را دورتر.",
    adviceEn:
      kind === "light"
        ? "Space them apart: one near a bright window, the other in partial shade."
        : kind === "water"
          ? "Water them on separate schedules — don't soak both at once."
          : "Keep one near a humidifier or bathroom, the other further away.",
  };
}

function tempConflict(a: CompanionPlant, b: CompanionPlant): ConflictReason | null {
  const overlapMin = Math.max(a.tempMin, b.tempMin);
  const overlapMax = Math.min(a.tempMax, b.tempMax);
  if (overlapMin <= overlapMax) return null; // ranges overlap → fine
  return {
    kind: "temperature",
    severity: "hard",
    fa: `دما: بازهٔ آسایش «${a.nickname}» ${a.tempMin}–${a.tempMax}° با «${b.nickname}» ${b.tempMin}–${b.tempMax}° اشتراکی ندارد`,
    en: `Temperature: “${a.nickname}” needs ${a.tempMin}–${a.tempMax}°C, “${b.nickname}” needs ${b.tempMin}–${b.tempMax}°C — no overlap`,
    adviceFa: "این دو در یک اقلیم خوش نمی‌گذرند — اتاق‌های جداگانه بهترین راه است.",
    adviceEn: "These two won't thrive in the same climate — separate rooms work best.",
  };
}

/** All conflicts between exactly two plants (empty = compatible pair). */
export function pairReasons(a: CompanionPlant, b: CompanionPlant): ConflictReason[] {
  return [
    attrConflict("light", LIGHT_RANK, LIGHT_LABEL, a, b),
    attrConflict("water", WATER_RANK, WATER_LABEL, a, b),
    attrConflict("humidity", WATER_RANK, HUMIDITY_LABEL, a, b),
    tempConflict(a, b),
  ].filter((r): r is ConflictReason => r !== null);
}

/* ── whole-garden analysis ──────────────────────────────────────────────── */

/** Score penalties per conflicting pair (max severity wins). */
const PENALTY: Record<ConflictSeverity, number> = { hard: 14, soft: 6 };

/**
 * Pairwise analysis across the whole garden + a 0..100 harmony score.
 * With fewer than two plants there is nothing to conflict — score 100.
 */
export function analyzeCompatibility(plants: CompanionPlant[]): CompanionReport {
  const pairs: CompanionPair[] = [];
  for (let i = 0; i < plants.length; i++) {
    for (let k = i + 1; k < plants.length; k++) {
      const a = plants[i];
      const b = plants[k];
      const reasons = pairReasons(a, b);
      if (reasons.length === 0) continue;
      const severity: ConflictSeverity = reasons.some((r) => r.severity === "hard") ? "hard" : "soft";
      pairs.push({
        aId: a.id,
        bId: b.id,
        aSlug: a.plantSlug,
        bSlug: b.plantSlug,
        aNickname: a.nickname,
        bNickname: b.nickname,
        aNameFa: a.nameFa || a.nickname,
        aNameEn: a.nameEn || a.nickname,
        bNameFa: b.nameFa || b.nickname,
        bNameEn: b.nameEn || b.nickname,
        aImage: a.image ?? "",
        bImage: b.image ?? "",
        reasons,
        severity,
      });
    }
  }
  const raw = pairs.reduce((s, p) => s - PENALTY[p.severity], 100);
  return {
    score: Math.max(0, raw),
    checked: plants.length,
    pairs,
  };
}
