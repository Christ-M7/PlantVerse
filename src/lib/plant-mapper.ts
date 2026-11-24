import type { Plant } from "@prisma/client";

/** Parse JSON-string columns of a Plant row into rich objects for the API surface. */
export function parsePlant(p: Plant) {
  return {
    ...p,
    seasons: safeJson<string[]>(p.seasons, []),
    commonNamesFa: safeJson<string[]>(p.commonNamesFa, []),
    commonNamesEn: safeJson<string[]>(p.commonNamesEn, []),
    growthStages: safeJson<GrowthStage[]>(p.growthStages, []),
    dailyCare: safeJson<CareGuideItem[]>(p.dailyCareFa, []),
    diseases: safeJson<DiseaseItem[]>(p.diseases, []),
    propagation: safeJson<PropagationItem[]>(p.propagation, []),
  };
}

export interface GrowthStage {
  icon: string; titleFa: string; titleEn: string; durationFa: string; durationEn: string;
}
export interface CareGuideItem {
  icon: string; titleFa: string; titleEn: string; descFa: string; descEn: string;
}
export interface DiseaseItem {
  nameFa: string; nameEn: string; descFa: string; descEn: string;
  severity: "low" | "medium" | "high";
}
export interface PropagationItem {
  nameFa: string; nameEn: string; descFa: string; descEn: string;
  difficulty: "easy" | "medium" | "hard";
}

export function safeJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
