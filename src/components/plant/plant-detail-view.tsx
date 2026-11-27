"use client";

import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowRight, Search, Heart, ShoppingBag, Sun, Moon, Menu, X, Expand, RotateCcw, Thermometer,
  Droplets, SunDim, Wind, Sprout, Leaf, ShieldCheck, CalendarDays, Scissors, BookOpen,
  MessageCircle, Bell, Sparkles, Cat, Rabbit, AlertTriangle, Lightbulb, Eye, Loader2, TreePine,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useAppStore } from "@/lib/store/app-store";
import { useLang } from "@/lib/i18n/use-lang";
import { PV_PLANTS, CATEGORY_META, DIFFICULTY_META, type PlantFixture } from "@/data/fixtures";
import { useDialogFocus } from "@/hooks/use-dialog-focus";

type TabKey = "care" | "diseases" | "propagation" | "history" | "reviews";

const STAGE_ICONS: Record<string, typeof Sprout> = {
  sprout: Sprout, leaf: Leaf, window: Expand, flower: Sparkles, tree: Leaf,
  droplets: Droplets, grain: Sprout, flask: Leaf, mushroom: Leaf, tomato: Leaf,
};

/** Favorite state persisted locally (anonymous device) — safe lazy read. */
function readFav(slug?: string): boolean {
  if (!slug) return false;
  try {
    return (JSON.parse(localStorage.getItem("pv-favs") ?? "[]") as string[]).includes(slug);
  } catch {
    return false;
  }
}

export function PlantDetailView({ slug }: { slug?: string }) {
  const navigate = useAppStore((s) => s.navigate);
  const showToast = useAppStore((s) => s.showToast);
  const { theme, setTheme } = useTheme();
  const { tx, num } = useLang();
  const [tab, setTab] = useState<TabKey>("care");
  const [fav, setFav] = useState(() => readFav(slug));
  const [viewer360, setViewer360] = useState(false);
  const viewerRef = useRef<HTMLDivElement>(null);
  useDialogFocus(viewer360, viewerRef);
  const [liveStats, setLiveStats] = useState<{ views: number; favorites: number } | null>(null);
  const [prevSlug, setPrevSlug] = useState(slug);
  const [adding, setAdding] = useState(false);
  if (slug !== prevSlug) {
    // adjust-state-during-render pattern (react.dev) — re-sync per plant without effect cascades
    setPrevSlug(slug);
    setFav(readFav(slug));
    setLiveStats(null);
  }

  /* unknown deep-link slug shows an honest not-found — the old code silently
     rendered Calathea Ornata for ANY dead slug */
  const plant = useMemo(() => PV_PLANTS.find((p) => p.slug === slug) ?? null, [slug]);

  // live view counter + favorites from /api/plants/[slug]
  useEffect(() => {
    if (!slug) return;
    let alive = true;
    fetch(`/api/plants/${slug}`)
      .then((r) => r.json())
      .then((d: { success?: boolean; plant?: { views?: number; favorites?: number } }) => {
        if (alive && d?.success && d.plant && typeof d.plant.views === "number") {
          setLiveStats({ views: d.plant.views, favorites: typeof d.plant.favorites === "number" ? d.plant.favorites : 0 });
        }
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [slug]);

  /* Escape closes the 360° viewer */
  useEffect(() => {
    if (!viewer360) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setViewer360(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [viewer360]);

  if (!plant) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 py-24 px-6 text-center">
        <span className="size-16 rounded-full bg-muted grid place-items-center">
          <Leaf className="size-7 text-muted-foreground" />
        </span>
        <h1 className="text-xl font-extrabold">{tx("این گیاه در دانشنامه نیست", "This plant isn't in the encyclopedia")}</h1>
        <p className="text-sm text-muted-foreground max-w-sm">
          {tx("ممکن است پیوند منقضی شده باشد — از میان ۵۰ گونه دانشنامه جستجو کنید.", "The link may be outdated — search among the 50 catalog species instead.")}
        </p>
        <button
          onClick={() => navigate("encyclopedia")}
          className="h-11 px-6 rounded-full bg-primary text-primary-foreground font-bold text-sm hover:opacity-90 transition-opacity"
        >
          {tx("رفتن به دانشنامه", "Open encyclopedia")}
        </button>
      </div>
    );
  }

  const views = liveStats?.views ?? plant.views;
  const favorites = liveStats?.favorites ?? plant.favorites;

  const toggleFav = () => {
    if (!slug) return;
    const next = !fav;
    const prevCount = liveStats?.favorites ?? plant.favorites;
    setFav(next);
    setLiveStats((s) => ({ views: s?.views ?? plant.views, favorites: Math.max(0, (s?.favorites ?? plant.favorites) + (next ? 1 : -1)) }));
    try {
      const favs: string[] = JSON.parse(localStorage.getItem("pv-favs") ?? "[]");
      const list = next ? [...new Set([...favs, slug])] : favs.filter((x) => x !== slug);
      localStorage.setItem("pv-favs", JSON.stringify(list));
    } catch { /* private mode */ }
    fetch(`/api/plants/${slug}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ favorited: next }),
    })
      .then((r) => r.json())
      .then((d: { success?: boolean; favorites?: number }) => {
        if (d?.success && typeof d.favorites === "number") {
          setLiveStats((s) => ({ views: s?.views ?? plant.views, favorites: d.favorites as number }));
        } else {
          throw new Error("patch_failed");
        }
      })
      .catch(() => {
        /* rollback the optimistic count — the chip used to stay off-by-one
           until the next visit after a failed PATCH */
        setLiveStats((s) => ({ views: s?.views ?? plant.views, favorites: prevCount }));
      });
    showToast(next ? tx("به علاقه‌مندی‌ها اضافه شد 💚", "Added to favorites 💚") : tx("از علاقه‌مندی‌ها حذف شد", "Removed from favorites"));
  };

  /* ── real garden add (POST /api/garden) — this CTA used to only toast a
     success message without touching the API (dishonest UI, caught by the
     R45 E2E pass). Mirrors garden-view's addPlant contract: 409 → already,
     ok → added, anything else → failure toast. ── */
  const addToGarden = async () => {
    if (!slug || adding) return;
    setAdding(true);
    try {
      const res = await fetch("/api/garden", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      if (res.status === 409) {
        showToast(tx("این گیاه از قبل در باغ شماست 🪴", "Already in your garden 🪴"));
        return;
      }
      const data = (res.ok ? await res.json().catch(() => null) : null) as { success?: boolean } | null;
      if (!res.ok || !data?.success) throw new Error("add_failed");
      showToast(tx("به باغ شما اضافه شد 🌿", "Added to your garden 🌿"));
    } catch {
      showToast(tx("افزودن گیاه ناموفق بود — دوباره تلاش کن 🥀", "Couldn't add the plant — try again 🥀"));
    } finally {
      setAdding(false);
    }
  };

  const cat = CATEGORY_META[plant.category];
  const diff = DIFFICULTY_META[plant.difficulty];
  const lightLabel: Record<string, [string, string]> = {
    low: ["نور کم", "Low light"], medium: ["نور متوسط", "Medium light"],
    bright_indirect: ["نور غیرمستقیم روشن", "Bright indirect light"], direct: ["آفتاب کامل", "Full sun"],
  };

  const tabs: { key: TabKey; fa: string; en: string; icon: typeof Leaf }[] = [
    { key: "care", fa: "مراقبت روزانه", en: "Daily care", icon: CalendarDays },
    { key: "diseases", fa: "بیماری‌ها", en: "Diseases", icon: ShieldCheck },
    { key: "propagation", fa: "تکثیر", en: "Propagation", icon: Scissors },
    { key: "history", fa: "تاریخچه", en: "History", icon: BookOpen },
    { key: "reviews", fa: "نظرات کاربران", en: "Reviews", icon: MessageCircle },
  ];

  return (
    <div className="flex-1 flex flex-col">
      {/* ── Header ── */}
      <header className="sticky top-0 z-30 pv-glass bg-background/85 border-b border-border/50">
        <div className="mx-auto max-w-7xl px-3 sm:px-6 h-16 flex items-center gap-2">
          <button onClick={() => navigate("encyclopedia")} aria-label={tx("بازگشت", "Back")} className="size-10 rounded-full bg-card border border-border grid place-items-center hover:border-primary/50 transition-colors">
            <ArrowRight className="size-5 rtl:rotate-0 ltr:rotate-180" />
          </button>
          <div className="flex-1 flex justify-center items-center gap-2">
            <Leaf className="size-4.5 text-primary" />
            <h1 className="font-extrabold text-lg">{tx("جزئیات گیاه", "Plant Details")}</h1>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => navigate("encyclopedia")} aria-label={tx("جستجو", "Search")} className="size-10 rounded-full hover:bg-muted grid place-items-center text-muted-foreground hidden sm:grid">
              <Search className="size-4.5" />
            </button>
            <button onClick={toggleFav} aria-label={tx("علاقه‌مندی", "Favorite")} aria-pressed={fav} className="size-10 rounded-full hover:bg-muted grid place-items-center">
              <Heart className={`size-4.5 ${fav ? "fill-terracotta text-terracotta" : "text-muted-foreground"}`} />
            </button>
            <button onClick={() => navigate("shop")} aria-label={tx("سبد خرید", "Cart")} className="size-10 rounded-full hover:bg-muted grid place-items-center text-muted-foreground relative hidden sm:grid">
              <ShoppingBag className="size-4.5" />
              <span className="absolute top-1 end-1 size-2 rounded-full bg-emerald-500" />
            </button>
            <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label={tx("حالت شبانه", "Theme")} className="size-10 rounded-full hover:bg-muted grid place-items-center text-muted-foreground">
              <Sun className="size-4.5 dark:hidden" />
              <Moon className="size-4.5 hidden dark:block" />
            </button>
            <button onClick={() => navigate("home")} aria-label={tx("منو", "Menu")} className="size-10 rounded-full hover:bg-muted grid place-items-center text-muted-foreground">
              <Menu className="size-5" />
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl w-full px-3 sm:px-6 py-4 grid lg:grid-cols-2 gap-5 flex-1">
        {/* ── Photo / 360 ── */}
        <motion.section
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6 }}
          className="relative rounded-[2rem] overflow-hidden border border-border/60 shadow-lg shadow-forest/10 min-h-[380px] lg:min-h-[560px]"
          aria-label={tx("تصویر گیاه", "Plant photo")}
        >
          <Image src={plant.image} alt={tx(plant.nameFa, plant.nameEn)} fill priority sizes="(max-width:1024px) 100vw, 50vw" className="object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent" />

          <button
            onClick={() => setViewer360(true)}
            aria-label={tx("نمای ۳۶۰ درجه", "360° view")}
            className="absolute top-4 end-4 size-11 rounded-full bg-card/85 pv-glass border border-border/60 grid place-items-center text-foreground hover:scale-105 transition-transform"
          >
            <Expand className="size-5" />
          </button>

          <motion.button
            onClick={() => setViewer360(true)}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.96 }}
            className="absolute bottom-6 start-1/2 -translate-x-1/2 rtl:translate-x-1/2 flex items-center gap-2 bg-card/90 pv-glass rounded-full ps-3 pe-4 py-2.5 shadow-xl border border-border/60"
          >
            <span className="size-10 rounded-full bg-sage-soft dark:bg-secondary grid place-items-center">
              <RotateCcw className="size-5 text-forest dark:text-primary" />
            </span>
            <span className="text-start">
              <span className="block text-[10px] text-muted-foreground">{tx("مشاهده", "View")}</span>
              <span className="block text-sm font-extrabold">{tx("۳۶۰ درجه", "360°")}</span>
            </span>
          </motion.button>

          <div className="absolute bottom-6 end-4 flex items-center gap-2">
            <span className="flex items-center gap-2 bg-card/90 pv-glass rounded-full px-3.5 py-2 border border-border/60 text-xs font-bold" aria-label={tx("آمار بازدید", "View stats")}>
              <Eye className="size-3.5 text-muted-foreground" />
              {num(views)}
              <span className="w-px h-3.5 bg-border" aria-hidden />
              <Heart className={`size-3.5 ${fav ? "fill-terracotta text-terracotta" : "text-muted-foreground"}`} />
              {num(favorites)}
            </span>
            <span className="flex items-center gap-2 bg-card/90 pv-glass rounded-full px-4 py-2 border border-border/60">
              <Sparkles className="size-4 text-gold" />
              <span className="text-xs font-bold">{tx("مشاهده در واقعیت افزوده", "View in AR")}</span>
            </span>
          </div>
        </motion.section>

        {/* ── Info panel ── */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="space-y-4"
          aria-label={tx("مشخصات", "Details")}
        >
          <div className="rounded-[1.75rem] bg-card border border-border/60 p-5 sm:p-6 space-y-4 shadow-sm">
            <div className="flex items-start justify-between">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold rounded-full border border-primary/30 bg-sage-soft/60 dark:bg-secondary px-3 py-1.5 text-forest dark:text-primary">
                <Leaf className="size-3.5" />
                {tx(cat.fa, cat.en)}
              </span>
              <button onClick={toggleFav} aria-label={tx("علاقه‌مندی", "Favorite")} aria-pressed={fav}>
                <Heart className={`size-5 ${fav ? "fill-terracotta text-terracotta" : "text-muted-foreground"}`} />
              </button>
            </div>

            <div>
              <h2 className="text-3xl font-extrabold">{tx(plant.nameFa, plant.nameEn)}</h2>
              <p className="text-muted-foreground italic flex items-center gap-2 mt-1">
                {plant.scientificName}
                <Leaf className="size-3.5 text-primary/70" />
              </p>
              <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                <b className="text-foreground">{tx("نام‌های رایج", "Common names")}:</b>{" "}
                {tx(plant.commonNamesFa.join("، "), plant.commonNamesEn.join(", "))}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-muted/60 dark:bg-secondary/40 p-3.5">
                <p className="text-xs font-bold text-muted-foreground flex items-center gap-1.5 mb-2">
                  <Leaf className="size-3.5" />{tx("سطح مراقبت", "Care level")}
                </p>
                <div className="flex items-center gap-2">
                  <span className="flex gap-1">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <span key={i} className={`size-2.5 rounded-full ${i < plant.careLevel ? "bg-primary" : "bg-border"}`} />
                    ))}
                  </span>
                  <span className="text-sm font-bold">{tx(diff.fa, diff.en)}</span>
                </div>
              </div>
              <div className="rounded-2xl bg-muted/60 dark:bg-secondary/40 p-3.5">
                <p className="text-xs font-bold text-muted-foreground flex items-center gap-1.5 mb-1">
                  <Thermometer className="size-3.5" />{tx("دمای ایده‌آل", "Ideal temp")}
                </p>
                <p className="text-sm font-extrabold">{num(plant.tempMin)} – {num(plant.tempMax)} °C</p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {[
                { icon: SunDim, t: tx("نور", "Light"), d: tx(plant.lightDescFa, plant.lightDescEn) },
                { icon: Droplets, t: tx("آبیاری", "Water"), d: tx(plant.waterDescFa, plant.waterDescEn) },
                { icon: Wind, t: tx("رطوبت", "Humidity"), d: tx(plant.humidityDescFa, plant.humidityDescEn) },
                { icon: Thermometer, t: tx("دما", "Temp"), d: `${num(plant.tempMin)}–${num(plant.tempMax)}°C` },
              ].map((f) => (
                <div key={f.t} className="rounded-2xl border border-border/70 bg-background/60 p-3 text-center">
                  <f.icon className="size-5 mx-auto text-primary mb-1.5" />
                  <p className="text-xs font-bold">{f.t}</p>
                  <p className="text-[10px] text-muted-foreground mt-1 leading-relaxed line-clamp-3">{f.d}</p>
                </div>
              ))}
            </div>

            {/* Growth timeline */}
            <div className="rounded-2xl border border-border/70 bg-background/60 p-4">
              <p className="text-sm font-bold flex items-center gap-2 mb-4">
                <CalendarDays className="size-4 text-primary" />
                {tx("رشد و نمو", "Growth & Development")}
              </p>
              <ol className="relative flex justify-between gap-1">
                <span className="absolute top-3 inset-x-4 h-0.5 bg-border" aria-hidden />
                {plant.growthStages.map((s, i) => {
                  const Icon = STAGE_ICONS[s.icon] ?? Sprout;
                  return (
                    <motion.li
                      key={s.titleFa}
                      initial={{ opacity: 0, y: 12 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: i * 0.12 }}
                      className="relative z-10 flex flex-col items-center text-center gap-1.5 flex-1"
                    >
                      <span className="size-7 rounded-full bg-primary text-primary-foreground grid place-items-center shadow-md shadow-primary/30">
                        <Icon className="size-3.5" />
                      </span>
                      <p className="text-[11px] font-bold leading-tight">{tx(s.titleFa, s.titleEn)}</p>
                      <p className="text-[10px] text-muted-foreground">{tx(s.durationFa, s.durationEn)}</p>
                    </motion.li>
                  );
                })}
              </ol>
            </div>

            {/* Toxicity */}
            <div className="rounded-2xl border border-border/70 bg-background/60 p-4 flex items-center gap-3">
              <span className={`size-10 rounded-full grid place-items-center shrink-0 ${plant.toxicity === "safe" ? "bg-emerald-100 dark:bg-emerald-900/40" : "bg-amber-100 dark:bg-amber-900/40"}`}>
                {plant.toxicity === "safe"
                  ? <ShieldCheck className="size-5 text-emerald-600" />
                  : <AlertTriangle className="size-5 text-amber-600" />}
              </span>
              <div className="flex-1">
                <p className="text-sm font-bold flex items-center gap-1.5">
                  {tx("سمیت", "Toxicity")}
                </p>
                <p className="text-[11px] text-muted-foreground leading-relaxed mt-0.5">{tx(plant.toxicityNoteFa, plant.toxicityNoteEn)}</p>
              </div>
              <div className="hidden sm:flex items-center gap-1 text-muted-foreground/70">
                <Cat className="size-6" />
                <Rabbit className="size-6" />
              </div>
            </div>
          </div>
        </motion.section>
      </div>

      {/* ── Tabs ── */}
      <div className="mx-auto max-w-7xl w-full px-3 sm:px-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <button
            onClick={toggleFav}
            aria-pressed={fav}
            className="flex items-center gap-2 text-sm font-bold text-muted-foreground hover:text-foreground"
          >
            <Heart className={`size-4.5 ${fav ? "fill-terracotta text-terracotta" : ""}`} />
            {fav ? tx("در دلخواه‌ها ثبت شد — برای حذف کلیک کنید", "Saved to favorites — click to remove") : tx("این گیاه را به دلخواه‌ها افزودم", "I added this to favorites")}
          </button>
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar max-w-full" role="tablist" aria-label={tx("بخش‌های گیاه", "Plant sections")}>
            {tabs.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={`relative flex items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-2.5 text-xs font-bold transition-colors ${
                  tab === t.key ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground border border-border bg-card"
                }`}
              >
                {tab === t.key && (
                  <motion.span layoutId="plant-tab-pill" className="absolute inset-0 rounded-full bg-primary shadow-md shadow-primary/30" transition={{ type: "spring", stiffness: 320, damping: 28 }} />
                )}
                <t.icon className="relative z-10 size-3.5" />
                <span className="relative z-10">{tx(t.fa, t.en)}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
            className="mt-4 rounded-3xl bg-card border border-border/60 p-5 sm:p-6 shadow-sm min-h-[180px]"
          >
            {tab === "care" && (
              <div className="grid sm:grid-cols-2 gap-3">
                {plant.dailyCare.map((c) => (
                  <div key={c.titleFa} className="flex gap-3 rounded-2xl bg-muted/50 dark:bg-secondary/30 p-4">
                    <span className="size-10 rounded-xl bg-primary/10 grid place-items-center shrink-0">
                      <CareIcon name={c.icon} />
                    </span>
                    <div>
                      <p className="font-bold text-sm">{tx(c.titleFa, c.titleEn)}</p>
                      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{tx(c.descFa, c.descEn)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {tab === "diseases" && (
              <div className="space-y-3">
                {plant.diseases.map((d) => (
                  <div key={d.nameFa} className="flex items-start gap-3 rounded-2xl bg-muted/50 dark:bg-secondary/30 p-4">
                    <span
                      className={`size-2.5 rounded-full mt-1.5 shrink-0 ${d.severity === "high" ? "bg-red-500" : d.severity === "medium" ? "bg-amber-500" : "bg-emerald-500"}`}
                      role="img"
                      aria-label={d.severity === "high" ? tx("شدت: جدی", "Severity: high") : d.severity === "medium" ? tx("شدت: متوسط", "Severity: medium") : tx("شدت: خفیف", "Severity: low")}
                    />
                    <div>
                      <p className="font-bold text-sm">{tx(d.nameFa, d.nameEn)}</p>
                      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{tx(d.descFa, d.descEn)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {tab === "propagation" && (
              <div className="grid sm:grid-cols-2 gap-3">
                {plant.propagation.map((p) => (
                  <div key={p.nameFa} className="rounded-2xl bg-muted/50 dark:bg-secondary/30 p-4 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <p className="font-bold text-sm">{tx(p.nameFa, p.nameEn)}</p>
                      <span className="text-[10px] font-bold rounded-full bg-sage-soft dark:bg-secondary px-2 py-0.5">
                        {tx(DIFFICULTY_META[p.difficulty].fa, DIFFICULTY_META[p.difficulty].en)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{tx(p.descFa, p.descEn)}</p>
                  </div>
                ))}
              </div>
            )}
            {tab === "history" && (
              <div className="space-y-4 max-w-3xl">
                <p className="text-sm leading-8 text-muted-foreground">{tx(plant.historyFa, plant.historyEn)}</p>
                <div className="flex items-start gap-3 rounded-2xl border border-gold/40 bg-gold/10 p-4">
                  <Lightbulb className="size-5 text-gold shrink-0 mt-0.5" />
                  <p className="text-sm leading-relaxed">{tx(plant.funFactFa, plant.funFactEn)}</p>
                </div>
                <p className="text-xs text-muted-foreground">{tx("منطقه جغرافیایی", "Native region")}: {plant.region}</p>
              </div>
            )}
            {tab === "reviews" && (
              <div className="space-y-3">
                {(plant.reviews ?? []).map((r, i) => (
                  <div key={i} className="rounded-2xl bg-muted/50 dark:bg-secondary/30 p-4 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <p className="font-bold text-sm">{r.author}</p>
                      <span className="text-[11px] text-muted-foreground">{tx(r.timeFa, r.timeEn)}</span>
                    </div>
                    <div className="flex gap-0.5">
                      {Array.from({ length: 5 }).map((_, j) => (
                        <span key={j} className={`text-xs ${j < r.rating ? "text-gold" : "text-border"}`}>★</span>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{tx(r.textFa, r.textEn)}</p>
                  </div>
                ))}
                {(plant.reviews ?? []).length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    {tx("هنوز نظری ثبت نشده — اولین نفر باشید! 🌱", "No reviews yet — be the first! 🌱")}
                  </p>
                )}
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* ── CTAs ── */}
        <div className="py-6 flex flex-col sm:flex-row items-center justify-center gap-4">
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => void addToGarden()}
            disabled={adding}
            className="pv-breathe w-full sm:w-auto min-w-[260px] h-14 rounded-full bg-primary text-primary-foreground font-extrabold text-base flex items-center justify-center gap-2.5 shadow-xl shadow-primary/40 disabled:opacity-70 disabled:cursor-wait"
          >
            {adding ? <Loader2 className="size-5 animate-spin" /> : <Sprout className="size-5" />}
            {tx("افزودن به باغ من", "Add to My Garden")}
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => navigate("reminders")}
            className="w-full sm:w-auto min-w-[240px] h-14 rounded-full bg-gold/25 dark:bg-gold/15 border border-gold/60 text-foreground dark:text-gold font-extrabold text-base flex items-center justify-center gap-2.5 shadow-md"
          >
            <Bell className="size-5" />
            {tx("یادآور مراقبت", "Care Reminder")}
          </motion.button>
        </div>

        <p className="pb-28 sm:pb-32 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
          <Leaf className="size-3.5 text-primary/70" />
          {tx("گیاه شاد، باغ زنده", "Happy plant, living garden")}
          <Leaf className="size-3.5 text-primary/70 rtl:-scale-x-100" />
        </p>
      </div>

      {/* ── 360 Viewer Modal ── */}
      {/* portal to <body>: inside <main>'s stacking context this z-[80]
          overlay would paint below the bottom nav (z-40) / chat FAB (z-60) */}
      {createPortal(
        <AnimatePresence>
          {viewer360 && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-[80] bg-black/70 pv-glass grid place-items-center p-4"
              onClick={() => setViewer360(false)}
              role="dialog"
              aria-modal
              aria-label={tx("نمای ۳۶۰ درجه گیاه", "Plant 360° view")}
              ref={viewerRef}
              tabIndex={-1}
            >
            <motion.div
              initial={{ scale: 0.9, y: 30 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.92, y: 20 }}
              className="relative w-full max-w-lg aspect-square rounded-[2rem] overflow-hidden shadow-2xl [perspective:1200px]"
              onClick={(e) => e.stopPropagation()}
            >
              <motion.img
                src={plant.image}
                alt={tx(plant.nameFa, plant.nameEn)}
                className="absolute inset-0 w-full h-full object-cover"
                animate={{ rotateY: [0, 360] }}
                transition={{ repeat: Infinity, duration: 9, ease: "linear" }}
                style={{ transformStyle: "preserve-3d" }}
                drag="x"
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={0.08}
              />
              <button onClick={() => setViewer360(false)} className="absolute top-4 end-4 size-10 rounded-full bg-black/50 text-white grid place-items-center" aria-label={tx("بستن", "Close")} data-autofocus>
                <X className="size-5" />
              </button>
              <p className="absolute bottom-4 inset-x-0 text-center text-white/90 text-xs font-bold flex items-center justify-center gap-2">
                <RotateCcw className="size-4" />
                {tx("برای چرخش، تصویر را بکشید", "Drag to rotate")}
              </p>
            </motion.div>
          </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}

function CareIcon({ name }: { name: string }) {
  const map: Record<string, typeof Leaf> = {
    droplets: Droplets, sun: SunDim, scissors: Scissors, leaf: Leaf,
    thermometer: Thermometer, wind: Wind, flower: Sparkles, tree: TreePine,
  };
  const Icon = map[name] ?? Leaf;
  return <Icon className="size-5 text-primary" />;
}
