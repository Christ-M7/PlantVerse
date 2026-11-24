"use client";

import { useEffect } from "react";
import { useAppStore } from "@/lib/store/app-store";

export type Lang = "fa" | "en";

/** Per-view document titles (fa | en) — synced on lang/view change. */
const TITLES: Record<string, [fa: string, en: string]> = {
  home: ["PlantVerse | جهان‌گیاه — مرجع جهانی گیاهان", "PlantVerse — The World of Plants"],
  encyclopedia: ["دانشنامه گیاهان | جهان‌گیاه", "Plant Encyclopedia | PlantVerse"],
  plant: ["جزئیات گیاه | جهان‌گیاه", "Plant Details | PlantVerse"],
  scanner: ["اسکنر هوشمند گیاه | جهان‌گیاه", "AI Plant Scanner | PlantVerse"],
  garden: ["باغ من | جهان‌گیاه", "My Garden | PlantVerse"],
  reminders: ["یادآوری‌ها | جهان‌گیاه", "Reminders | PlantVerse"],
  community: ["انجمن گیاه‌دوستان | جهان‌گیاه", "Community | PlantVerse"],
  shop: ["فروشگاه | جهان‌گیاه", "Shop | PlantVerse"],
  magazine: ["مجله گیاه | جهان‌گیاه", "Plant Magazine | PlantVerse"],
  article: ["مقاله | جهان‌گیاه", "Article | PlantVerse"],
  profile: ["پروفایل من | جهان‌گیاه", "My Profile | PlantVerse"],
  greenhouse: ["گلخانه هوشمند | جهان‌گیاه", "Smart Greenhouse | PlantVerse"],
  mushrooms: ["جهان قارچ‌ها | جهان‌گیاه", "World of Mushrooms | PlantVerse"],
};

/**
 * Unified bilingual hook — provides language state, direction and helpers.
 * `tx` picks the right string inline: tx("سلام", "Hello")
 * `num` renders Persian digits when lang=fa:  num(96) → ۹۶
 */
export function useLang() {
  const lang = useAppStore((s) => s.lang);
  const setLang = useAppStore((s) => s.setLang);
  const view = useAppStore((s) => s.view);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "fa" ? "rtl" : "ltr";
  }, [lang]);

  useEffect(() => {
    const t = TITLES[view] ?? TITLES.home;
    const apply = () => {
      document.title = lang === "fa" ? t[0] : t[1];
    };
    apply();
    /* React 19 reconciles the server-rendered <title> AFTER mount effects
       run — an en user's first paint would flash the Persian metadata
       title. Re-assert on the next frame and once more after hydration
       settles; both calls are idempotent. */
    const raf = requestAnimationFrame(apply);
    const settle = setTimeout(apply, 150);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(settle);
    };
  }, [lang, view]);

  const tx = (fa: string, en: string) => (lang === "fa" ? fa : en);
  const num = (value: number | string) => {
    const s = String(value);
    if (lang !== "fa") return s;
    return s.replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
  };
  const money = (value: number) => {
    const grouped = new Intl.NumberFormat("en-US").format(value);
    return num(grouped);
  };
  /* percent sign follows the locale — Arabic ٪ reads wrong in en views */
  const pct = (value: number) => `${num(value)}${lang === "fa" ? "٪" : "%"}`;

  return { lang, dir: lang === "fa" ? ("rtl" as const) : ("ltr" as const), isFa: lang === "fa", setLang, tx, num, money, pct };
}
