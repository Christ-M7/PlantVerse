/**
 * PlantVerse — environment-driven care advisor («مشاور مراقبت هوشمند»). 
 *
 * Pure domain logic (no DB imports) shared by the API route and tests:
 * joins the greenhouse IoT sensor snapshot (indoor proxy for "today's
 * weather") with the garden's plants + their catalog care attributes and
 * upcoming task due dates, and emits a ranked, bilingual, actionable
 * advice list. Complements /api/weather (OUTDOOR Tehran forecast) with
 * garden-personalized INDOOR guidance.
 *
 * Ranking: urgent (overdue work) → warning (stress/soil bands) →
 * tip (routine tuning) → info (all-good celebration). Each rule has a
 * stable `id` the tests pin against.
 *
 * Display names follow the app-wide convention:
 *   fa → user nickname first, then catalog nameFa
 *   en → catalog nameEn first, then user nickname
 */

/* ── types ──────────────────────────────────────────────────────────────── */

export interface AdvisorPlant {
  id: string;
  nickname: string;
  nameFa: string;
  nameEn: string;
  water: string; // low | medium | high
  humidity: string; // low | medium | high
  light: string; // low | medium | bright_indirect | direct
  tempMin: number;
  tempMax: number;
  nextTaskType: string; // water | fertilize | prune | spray
  nextTaskDays: number;
  health: number;
}

export interface AdvisorEnv {
  temp: number;
  hum: number;
  soil: number;
  light: number;
}

export type AdviceSeverity = "urgent" | "warning" | "tip" | "info";
export type AdviceIcon = "temp" | "hum" | "soil" | "task" | "water" | "light" | "leaf";

export interface AdviceItem {
  id: string;
  severity: AdviceSeverity;
  icon: AdviceIcon;
  fa: string;
  en: string;
  /** ids of the affected garden plants (drives the «N گیاه» badge) */
  plantIds: string[];
}

export interface CareAdvice {
  items: AdviceItem[];
  env: AdvisorEnv;
  checkedPlants: number;
}

/* ── thresholds (exported for tests) ────────────────────────────────────── */

export const DRY_AIR_HUM = 45;
export const HUMID_AIR_HUM = 85;
export const DRY_SOIL = 35;
export const SOGGY_SOIL = 65;
export const HOT_WATERING_TEMP = 29;
export const LOW_LIGHT_LUX = 5000;

const SEVERITY_RANK: Record<AdviceSeverity, number> = { urgent: 0, warning: 1, tip: 2, info: 3 };

/* ── bilingual copy fragments ───────────────────────────────────────────── */

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

/** fa → nickname first; en → catalog English name first (app-wide rule). */
function displayName(p: AdvisorPlant, lang: "fa" | "en"): string {
  return lang === "fa" ? p.nickname || p.nameFa : p.nameEn || p.nickname;
}

/** «الف»، «ب» و ۲ گیاه دیگر — shared list formatter for both languages. */
function nameList(plants: AdvisorPlant[], lang: "fa" | "en", faDigits: (n: number) => string): string {
  const names = plants.slice(0, 3).map((p) => (lang === "fa" ? `«${displayName(p, "fa")}»` : `“${displayName(p, "en")}”`));
  const rest = plants.length - names.length;
  if (rest > 0) {
    return lang === "fa"
      ? `${names.join("، ")} و ${faDigits(rest)} گیاه دیگر`
      : `${names.join(", ")} and ${rest} more`;
  }
  return lang === "fa" ? names.join("، ") : names.join(", ");
}

/* ── rule engine ────────────────────────────────────────────────────────── */

export function buildCareAdvice(
  env: AdvisorEnv,
  plants: AdvisorPlant[],
  faDigits: (n: number) => string = (n) => String(n)
): CareAdvice {
  const items: AdviceItem[] = [];
  const push = (item: AdviceItem) => items.push(item);

  /* ── urgent: work that should already have happened ── */
  const overdue = plants.filter((p) => p.nextTaskDays <= 0);
  if (overdue.length > 0) {
    push({
      id: "overdue-task",
      severity: "urgent",
      icon: "task",
      fa: `${nameList(overdue, "fa", faDigits)} ${overdue.length === 1 ? "منتظر" : "منتظرِ"} ${TASK_FA[overdue[0].nextTaskType] ?? "مراقبت"} است — امروز به وقتش برس!`,
      en: `${nameList(overdue, "en", faDigits)} ${overdue.length === 1 ? "is" : "are"} waiting for ${TASK_EN[overdue[0].nextTaskType] ?? "care"} — catch up today!`,
      plantIds: overdue.map((p) => p.id),
    });
  }

  /* ── warnings: stress bands & due-soon work ── */
  const dueTomorrow = plants.filter((p) => p.nextTaskDays === 1);
  if (dueTomorrow.length > 0) {
    push({
      id: "due-tomorrow",
      severity: "warning",
      icon: "task",
      fa: `${TASK_FA[dueTomorrow[0].nextTaskType] ?? "مراقبت"} ${nameList(dueTomorrow, "fa", faDigits)} برای فرداست — امروز انجامش بده تا عقب نیفتی.`,
      en: `${TASK_EN[dueTomorrow[0].nextTaskType] ?? "Care"} for ${nameList(dueTomorrow, "en", faDigits)} is due tomorrow — do it today to stay ahead.`,
      plantIds: dueTomorrow.map((p) => p.id),
    });
  }

  const cold = plants.filter((p) => env.temp < p.tempMin);
  if (cold.length > 0) {
    push({
      id: "cold-stress",
      severity: "warning",
      icon: "temp",
      fa: `با ${faDigits(Math.round(env.temp))}°، ${nameList(cold, "fa", faDigits)} سردشان می‌شود — از پنجرهٔ سرد و جریان هوا دورشان کن.`,
      en: `At ${Math.round(env.temp)}°C, ${nameList(cold, "en", faDigits)} ${cold.length === 1 ? "is" : "are"} too cold — move away from chilly windows and drafts.`,
      plantIds: cold.map((p) => p.id),
    });
  }

  const hot = plants.filter((p) => env.temp > p.tempMax);
  if (hot.length > 0) {
    push({
      id: "heat-stress",
      severity: "warning",
      icon: "temp",
      fa: `${nameList(hot, "fa", faDigits)} در این گرما (${faDigits(Math.round(env.temp))}°) استرس می‌گیرند — گلدان‌ها را از آفتاب مستقیم دور کن.`,
      en: `${nameList(hot, "en", faDigits)} ${hot.length === 1 ? "is" : "are"} heat-stressed at ${Math.round(env.temp)}°C — keep them out of direct sun.`,
      plantIds: hot.map((p) => p.id),
    });
  }

  if (env.soil < DRY_SOIL) {
    const thirsty = plants.filter((p) => p.water === "high");
    push({
      id: "dry-soil",
      severity: "warning",
      icon: "soil",
      fa: `خاک گلدان‌ها خشک است (${faDigits(Math.round(env.soil))}٪)${thirsty.length ? ` — ${nameList(thirsty, "fa", faDigits)} تشنه‌ترند` : ""}؛ امروز چک کن.`,
      en: `Pots are drying out (${Math.round(env.soil)}%)${thirsty.length ? ` — ${nameList(thirsty, "en", faDigits)} ${thirsty.length === 1 ? "gets" : "get"} thirsty fastest` : ""}; check today.`,
      plantIds: thirsty.length ? thirsty.map((p) => p.id) : plants.map((p) => p.id),
    });
  }

  if (env.soil > SOGGY_SOIL) {
    push({
      id: "soggy-soil",
      severity: "warning",
      icon: "soil",
      fa: `خاک بیش از حد خیس است (${faDigits(Math.round(env.soil))}٪) — آبیاری را متوقف کن و زهکشی را چک کن.`,
      en: `Soil is soggy (${Math.round(env.soil)}%) — hold off watering and check drainage.`,
      plantIds: plants.map((p) => p.id),
    });
  }

  /* ── tips: routine tuning ── */
  const mistLovers = plants.filter((p) => p.humidity === "high");
  if (env.hum < DRY_AIR_HUM && mistLovers.length > 0) {
    push({
      id: "dry-air",
      severity: "tip",
      icon: "hum",
      fa: `هوای خشک (${faDigits(Math.round(env.hum))}٪) — ${nameList(mistLovers, "fa", faDigits)} رطوبت بالا می‌خواهند؛ غبارپاشی یا بخارساز یادت نره.`,
      en: `Dry air (${Math.round(env.hum)}%) — ${nameList(mistLovers, "en", faDigits)} ${mistLovers.length === 1 ? "loves" : "love"} humidity; mist or group them together.`,
      plantIds: mistLovers.map((p) => p.id),
    });
  }

  const dryLovers = plants.filter((p) => p.humidity === "low");
  if (env.hum > HUMID_AIR_HUM && dryLovers.length > 0) {
    push({
      id: "humid-air",
      severity: "tip",
      icon: "hum",
      fa: `رطوبت هواست بالاست (${faDigits(Math.round(env.hum))}٪) — ${nameList(dryLovers, "fa", faDigits)} آبیاری کمتری می‌خواهند.`,
      en: `Humidity is high (${Math.round(env.hum)}%) — ease up on watering ${nameList(dryLovers, "en", faDigits)}.`,
      plantIds: dryLovers.map((p) => p.id),
    });
  }

  if (env.temp >= HOT_WATERING_TEMP) {
    push({
      id: "hot-watering",
      severity: "tip",
      icon: "water",
      fa: `هوای گرم است (${faDigits(Math.round(env.temp))}°) — صبح زود آبیاری عمیق کن تا آب تبخیر نشود.`,
      en: `Warm day (${Math.round(env.temp)}°C) — deep-water early in the morning to beat evaporation.`,
      plantIds: plants.map((p) => p.id),
    });
  }

  const brightLovers = plants.filter((p) => p.light === "direct" || p.light === "bright_indirect");
  if (env.light < LOW_LIGHT_LUX && brightLovers.length > 0) {
    push({
      id: "low-light",
      severity: "tip",
      icon: "light",
      fa: `نور کم است (${faDigits(Math.round(env.light))} لوکس) — ${nameList(brightLovers, "fa", faDigits)} به پنجرهٔ روشن‌تر نیاز دارند.`,
      en: `Low light (${faDigits(Math.round(env.light))} lux) — ${nameList(brightLovers, "en", faDigits)} ${brightLovers.length === 1 ? "needs" : "need"} a brighter window.`,
      plantIds: brightLovers.map((p) => p.id),
    });
  }

  /* ── all good ── */
  if (items.length === 0) {
    push({
      id: "all-good",
      severity: "info",
      icon: "leaf",
      fa: "همه‌چیز مرتب است! محیط و برنامهٔ مراقبت باغچه‌ات هماهنگ است — به همین روال ادامه بده 🌿",
      en: "All in order! Your garden's environment and care routine are in harmony — keep it up 🌿",
      plantIds: [],
    });
  }

  items.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);

  return { items, env, checkedPlants: plants.length };
}
