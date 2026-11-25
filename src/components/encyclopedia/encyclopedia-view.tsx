"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  Menu, Search, Mic, ImageIcon, Sun, Moon, Heart, ChevronDown, SlidersHorizontal,
  LayoutGrid, List, X, Sprout, Flower2, Soup, Waves, Umbrella as MushroomIcon, Tractor, Leaf,
  RotateCcw, MicOff, Scale, Check, Plus,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useAppStore } from "@/lib/store/app-store";
import { useLang } from "@/lib/i18n/use-lang";
import { PvLogo } from "@/components/layout/pv-logo";
import { PlantCard } from "@/components/encyclopedia/plant-card";
import { PlantCompareDialog } from "@/components/encyclopedia/plant-compare-dialog";
import { VoiceSearch } from "@/components/encyclopedia/voice-search";
import { useDialogFocus } from "@/hooks/use-dialog-focus";
import { PV_PLANTS, DIFFICULTY_META, type PlantCategory, type Difficulty, type PlantFixture } from "@/data/fixtures";

type Filters = {
  category: PlantCategory | "all";
  light: string;
  water: string;
  difficulty: Difficulty | "all";
  season: string;
  q: string;
};

const CATS: { key: PlantCategory | "all"; fa: string; en: string; icon: typeof Leaf }[] = [
  { key: "all", fa: "همه گیاهان", en: "All plants", icon: Leaf },
  { key: "apartment", fa: "گیاهان آپارتمانی", en: "Houseplants", icon: Flower2 },
  { key: "outdoor", fa: "گیاهان فضای باز", en: "Outdoor", icon: Sprout },
  { key: "medicinal", fa: "گیاهان دارویی", en: "Medicinal", icon: Soup },
  { key: "aquatic", fa: "گیاهان آبی", en: "Aquatic", icon: Waves },
  { key: "mushroom", fa: "قارچ‌ها", en: "Mushrooms", icon: MushroomIcon },
  { key: "agricultural", fa: "گیاهان کشاورزی", en: "Agricultural", icon: Tractor },
];

const LIGHTS = [
  { key: "all", fa: "همه", en: "All" },
  { key: "low", fa: "نور کم", en: "Low light" },
  { key: "medium", fa: "نور متوسط", en: "Medium light" },
  { key: "bright_indirect", fa: "نور غیرمستقیم", en: "Bright indirect" },
  { key: "direct", fa: "نور مستقیم", en: "Direct sun" },
];
const WATERS = [
  { key: "all", fa: "همه", en: "All" },
  { key: "low", fa: "کم", en: "Low" },
  { key: "medium", fa: "متوسط", en: "Medium" },
  { key: "high", fa: "زیاد", en: "High" },
];
const DIFFS: { key: Difficulty; fa: string; en: string }[] = [
  { key: "easy", fa: "آسان", en: "Easy" },
  { key: "medium", fa: "متوسط", en: "Medium" },
  { key: "hard", fa: "سخت", en: "Hard" },
];
const SEASONS = [
  { key: "all", fa: "همه", en: "All" },
  { key: "spring", fa: "بهار", en: "Spring" },
  { key: "summer", fa: "تابستان", en: "Summer" },
  { key: "autumn", fa: "پاییز", en: "Autumn" },
  { key: "winter", fa: "زمستان", en: "Winter" },
];

/** comparison mode picks up to this many plants from the active catalog */
const COMPARE_MAX = 3;

export function EncyclopediaView({ initialCategory, initialQuery }: { initialCategory?: string; initialQuery?: string }) {
  const navigate = useAppStore((s) => s.navigate);
  const showToast = useAppStore((s) => s.showToast);
  const { theme, setTheme } = useTheme();
  const { tx, num } = useLang();
  /* validate deep-linked category (a malformed ?category used to brick the
     catalog into a permanent empty state) */
  const safeCategory = CATS.some((c) => c.key === initialCategory) ? (initialCategory as PlantCategory) : "all";
  const seedQuery = initialQuery?.trim() ?? "";
  const [filters, setFilters] = useState<Filters>({
    category: safeCategory,
    light: "all",
    water: "all",
    difficulty: "all",
    season: "all",
    q: seedQuery,
  });
  const [applied, setApplied] = useState<Filters>(filters);
  const [sort, setSort] = useState<"relevance" | "name" | "difficulty">("relevance");
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const filtersDrawerRef = useRef<HTMLElement>(null);
  useDialogFocus(sidebarOpen, filtersDrawerRef);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [serverPlants, setServerPlants] = useState<PlantFixture[] | null>(null);

  /** active catalog — fixtures render instantly, API hydrates over them */
  const catalog = serverPlants ?? PV_PLANTS;

  /* ── comparison mode («مقایسه گیاهان») — pick 2-3 plants, compare side by side ── */
  const [compareMode, setCompareMode] = useState(false);
  /** selection order is preserved — the dialog columns follow pick order */
  const [compareSlugs, setCompareSlugs] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);

  const toggleCompareMode = () => {
    const next = !compareMode;
    setCompareMode(next);
    if (!next) {
      setCompareSlugs([]);
      setCompareOpen(false);
    }
  };

  const toggleCompare = (slug: string) => {
    if (compareSlugs.includes(slug)) {
      setCompareSlugs((prev) => prev.filter((s) => s !== slug));
      return;
    }
    if (compareSlugs.length >= COMPARE_MAX) {
      showToast(tx("حداکثر ۳ گیاه همزمان قابل مقایسه است 🌿", "Compare up to 3 plants at a time 🌿"));
      return;
    }
    setCompareSlugs((prev) => [...prev, slug]);
  };

  /** resolve the selection against the live catalog in pick order */
  const comparePlants = useMemo(() => {
    const byslug = new Map(catalog.map((p) => [p.slug, p]));
    return compareSlugs.map((s) => byslug.get(s)).filter((p): p is PlantFixture => Boolean(p));
  }, [compareSlugs, catalog]);

  // hydrate from the live catalog API (fixtures render instantly as fallback)
  useEffect(() => {
    let alive = true;
    fetch("/api/plants")
      .then((r) => r.json())
      .then((d: { success?: boolean; plants?: PlantFixture[] }) => {
        if (alive && d?.success && Array.isArray(d.plants) && d.plants.length > 0) {
          setServerPlants(d.plants.map((p) => ({ ...p, reviews: p.reviews ?? [] })));
        }
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const results = useMemo(() => {
    let list = (serverPlants ?? PV_PLANTS).filter((p) => {
      if (applied.category !== "all" && p.category !== applied.category) return false;
      if (applied.light !== "all" && p.light !== applied.light) return false;
      if (applied.water !== "all" && p.water !== applied.water) return false;
      if (applied.difficulty !== "all" && p.difficulty !== applied.difficulty) return false;
      if (applied.season !== "all" && !p.seasons.includes(applied.season)) return false;
      if (applied.q.trim()) {
        const q = applied.q.trim().toLowerCase();
        const hay = `${p.nameFa} ${p.nameEn} ${p.scientificName} ${p.commonNamesFa.join(" ")}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    if (sort === "name") list = [...list].sort((a, b) => a.nameFa.localeCompare(b.nameFa, "fa"));
    if (sort === "difficulty") list = [...list].sort((a, b) => a.careLevel - b.careLevel);
    return list;
  }, [applied, sort, serverPlants]);

  /* debounce: applying the draft q on every keystroke re-filters and
     re-animates up to 60 motion cards; settle 250 ms first */
  useEffect(() => {
    const t = setTimeout(() => setApplied((prev) => (prev.q === filters.q ? prev : { ...prev, q: filters.q })), 250);
    return () => clearTimeout(t);
  }, [filters.q]);

  /* Escape closes the mobile filter drawer (custom overlay — no Radix here) */
  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSidebarOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sidebarOpen]);

  const dirty = JSON.stringify(filters) !== JSON.stringify(applied);
  const apply = () => setApplied(filters);
  /** sidebar filter chips apply instantly (draft + applied stay in sync) */
  const updateFilters = (patch: Partial<Filters>) => {
    setFilters((prev) => {
      const next = { ...prev, ...patch };
      setApplied(next);
      return next;
    });
  };
  const reset = () => {
    const cleared: Filters = { category: "all", light: "all", water: "all", difficulty: "all", season: "all", q: "" };
    setFilters(cleared);
    setApplied(cleared);
  };

  /* real per-category counts from the active catalog — the old fixture
     PV_CATALOG_COUNTS promised «Houseplants · 342» next to a 15-plant DB,
     making every filter look broken */
  const counts = useMemo(() => {
    const map = { all: catalog.length } as Record<PlantCategory | "all", number>;
    for (const p of catalog) map[p.category] = (map[p.category] ?? 0) + 1;
    return map;
  }, [catalog]);
  const catCount = (key: PlantCategory | "all") => counts[key] ?? 0;

  const FiltersPanel = (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="font-extrabold text-[15px] flex items-center gap-2">
          <SlidersHorizontal className="size-4.5 text-primary" />
          {tx("فیلترهای هوشمند", "Smart Filters")}
        </h2>
        <button onClick={reset} className="text-xs text-primary hover:underline font-medium">
          {tx("پاک کردن همه", "Clear all")}
        </button>
      </div>

      {/* نوع گیاه */}
      <section className="space-y-1.5">
        <p className="text-xs font-bold text-muted-foreground flex items-center gap-1.5"><Leaf className="size-3.5" />{tx("نوع گیاه", "Plant type")}</p>
        {CATS.map((c) => {
          const Icon = c.icon;
          const active = filters.category === c.key;
          return (
            <button
              key={c.key}
              onClick={() => updateFilters({ category: c.key })}
              className={`w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] font-medium transition-colors ${
                active ? "bg-sage-soft dark:bg-secondary text-forest dark:text-primary ring-1 ring-primary/30" : "hover:bg-muted/70"
              }`}
            >
              <Icon className="size-4 shrink-0 text-primary" />
              <span className="flex-1 text-start">{tx(c.fa, c.en)}</span>
              <span className="text-[11px] text-muted-foreground bg-background border border-border rounded-full px-2 py-0.5">
                {num(catCount(c.key))}
              </span>
            </button>
          );
        })}
      </section>

      {/* نیاز نوری */}
      <section className="space-y-1.5">
        <p className="text-xs font-bold text-muted-foreground flex items-center gap-1.5"><Sun className="size-3.5" />{tx("نیاز نوری", "Light needs")}</p>
        {LIGHTS.map((l) => (
          <button
            key={l.key}
            onClick={() => updateFilters({ light: l.key })}
            className={`w-full flex items-center gap-2.5 rounded-xl px-3 py-1.5 text-[13px] transition-colors ${
              filters.light === l.key ? "bg-sage-soft dark:bg-secondary font-bold" : "hover:bg-muted/70"
            }`}
          >
            <span className={`size-1.5 rounded-full ${filters.light === l.key ? "bg-primary" : "bg-muted-foreground/40"}`} />
            {tx(l.fa, l.en)}
          </button>
        ))}
      </section>

      {/* آبیاری */}
      <section className="space-y-1.5">
        <p className="text-xs font-bold text-muted-foreground flex items-center gap-1.5"><Leaf className="size-3.5" />{tx("آبیاری", "Watering")}</p>
        {WATERS.map((w) => (
          <button
            key={w.key}
            onClick={() => updateFilters({ water: w.key })}
            className={`w-full flex items-center gap-2.5 rounded-xl px-3 py-1.5 text-[13px] transition-colors ${
              filters.water === w.key ? "bg-sage-soft dark:bg-secondary font-bold" : "hover:bg-muted/70"
            }`}
          >
            <span className={`size-1.5 rounded-full ${filters.water === w.key ? "bg-sky-500" : "bg-muted-foreground/40"}`} />
            {tx(w.fa, w.en)}
          </button>
        ))}
      </section>

      {/* سطح سختی */}
      <section className="space-y-1.5">
        <p className="text-xs font-bold text-muted-foreground flex items-center gap-1.5"><Leaf className="size-3.5" />{tx("سطح سختی", "Difficulty")}</p>
        {DIFFS.map((d, i) => (
          <button
            key={d.key}
            onClick={() => updateFilters({ difficulty: filters.difficulty === d.key ? "all" : d.key })}
            className={`w-full flex items-center justify-between gap-2 rounded-xl px-3 py-1.5 text-[13px] transition-colors ${
              filters.difficulty === d.key ? "bg-sage-soft dark:bg-secondary font-bold" : "hover:bg-muted/70"
            }`}
          >
            {tx(d.fa, d.en)}
            <span className="flex gap-1">
              {Array.from({ length: 3 }).map((_, j) => (
                <span
                  key={j}
                  className={`h-1.5 w-7 rounded-full ${
                    filters.difficulty === d.key
                      ? ["bg-emerald-400", "bg-amber-400", "bg-red-400"][i]
                      : "bg-border"
                  }`}
                />
              ))}
            </span>
          </button>
        ))}
      </section>

      {/* فصل */}
      <section className="space-y-1.5">
        <p className="text-xs font-bold text-muted-foreground flex items-center gap-1.5"><Leaf className="size-3.5" />{tx("فصل", "Season")}</p>
        {SEASONS.map((s) => (
          <button
            key={s.key}
            onClick={() => updateFilters({ season: s.key })}
            className={`w-full flex items-center gap-2.5 rounded-xl px-3 py-1.5 text-[13px] transition-colors ${
              filters.season === s.key ? "bg-sage-soft dark:bg-secondary font-bold" : "hover:bg-muted/70"
            }`}
          >
            <span className={`size-1.5 rounded-full ${filters.season === s.key ? "bg-gold" : "bg-muted-foreground/40"}`} />
            {tx(s.fa, s.en)}
          </button>
        ))}
      </section>

      <motion.button
        whileTap={{ scale: 0.97 }}
        onClick={apply}
        className="w-full h-11 rounded-2xl bg-primary text-primary-foreground font-bold text-sm shadow-lg shadow-primary/25 flex items-center justify-center gap-2"
      >
        <SlidersHorizontal className="size-4" />
        {tx("اعمال فیلترها", "Apply filters")}
        {dirty && <span className="size-2 rounded-full bg-gold animate-pulse" />}
      </motion.button>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col">
      {/* ── Header ── */}
      <header className="sticky top-0 z-30 pv-glass bg-background/85 border-b border-border/50">
        <div className="mx-auto max-w-7xl px-3 sm:px-6 py-3 flex items-center gap-3">
          <button onClick={() => setSidebarOpen(true)} aria-label={tx("فیلترها", "Filters")} aria-expanded={sidebarOpen} aria-controls="catalog-filters" className="xl:hidden size-10 grid place-items-center rounded-full hover:bg-muted">
            <Menu className="size-5" />
          </button>
          <div className="hidden sm:block">
            <button onClick={() => navigate("home")} className="flex items-center gap-2.5 text-start group">
              <span className="size-11 rounded-2xl bg-forest-deep dark:bg-primary grid place-items-center shadow-md shadow-forest/30 group-hover:rotate-6 transition-transform">
                <Leaf className="size-5 text-primary-foreground" />
              </span>
              <span>
                <span className="block font-extrabold text-lg leading-tight">{tx("دانشنامه گیاهان", "Plant Encyclopedia")}</span>
                <span className="block text-[11px] text-muted-foreground">{tx("راهنمای جامع دنیای گیاهان", "The complete guide to the plant world")}</span>
              </span>
            </button>
          </div>

          <form
            onSubmit={(e) => { e.preventDefault(); apply(); }}
            role="search"
            className="flex-1 max-w-xl mx-auto flex items-center gap-2 bg-card border border-border rounded-full px-4 h-11 shadow-sm focus-within:ring-2 focus-within:ring-ring/40"
          >
            <Search className="size-4.5 text-muted-foreground shrink-0" />
            <input
              value={filters.q}
              onChange={(e) => setFilters((prev) => ({ ...prev, q: e.target.value }))}
              placeholder={tx("جستجوی گیاه، ویژگی یا کاربرد…", "Search plants, traits or uses…")}
              aria-label={tx("جستجو", "Search")}
              className="flex-1 bg-transparent outline-none text-sm min-w-0"
            />
            <button type="button"
              onClick={() => setVoiceOpen(true)}
              aria-label={tx("جستجوی صوتی", "Voice search")}
              data-testid="voice-open"
              className="size-8 rounded-full bg-sage-soft dark:bg-secondary grid place-items-center text-forest dark:text-primary"
            >
              <Mic className="size-4" />
            </button>
          </form>

          <div className="flex items-center gap-1.5">
            <button
              onClick={toggleCompareMode}
              aria-pressed={compareMode}
              aria-label={tx("حالت مقایسه گیاهان", "Plant compare mode")}
              title={tx("مقایسه گیاهان", "Compare plants")}
              className={cnCompare(compareMode)}
            >
              <Scale className="size-4.5" />
            </button>
            <button
              onClick={() => navigate("scanner")}
              aria-label={tx("جستجوی با عکس — اسکنر گیاه", "Search by photo — plant scanner")}
              title={tx("اسکنر گیاه", "Plant scanner")}
              className="size-10 rounded-full hover:bg-muted grid place-items-center text-muted-foreground"
            >
              <ImageIcon className="size-4.5" />
            </button>
            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label={tx("حالت شبانه", "Theme")}
              className="size-10 rounded-full hover:bg-muted grid place-items-center text-muted-foreground"
            >
              <Sun className="size-4.5 dark:hidden" />
              <Moon className="size-4.5 hidden dark:block" />
            </button>
            <button onClick={() => navigate("garden")} aria-label={tx("علاقه‌مندی‌ها", "Favorites")} className="size-10 rounded-full hover:bg-muted grid place-items-center text-muted-foreground hidden sm:grid">
              <Heart className="size-4.5" />
            </button>
            <button onClick={() => navigate("profile")} className="size-9 rounded-full bg-sage-soft dark:bg-secondary grid place-items-center overflow-hidden" aria-label={tx("پروفایل", "Profile")}>
              <Image src="/images/avatar-w1.jpg" alt={tx("آواتار کاربر", "User avatar")} width={36} height={36} className="size-9 object-cover rounded-full" />
            </button>
          </div>
        </div>
      </header>

      {/* hint chips (mockup tooltip style) */}
      <div className="mx-auto max-w-7xl w-full px-3 sm:px-6 pt-2 hidden sm:flex gap-2 text-[11px] text-muted-foreground justify-end">
        <span className="rounded-full border border-border bg-card px-3 py-1">{tx("جستجوی صوتی با هوش مصنوعی", "AI voice search")}</span>
        <span className="rounded-full border border-border bg-card px-3 py-1">{tx("انتخاب تصویر گیاه", "Pick plant photo")}</span>
      </div>

      <div className="mx-auto max-w-7xl w-full px-3 sm:px-6 py-4 flex-1 grid xl:grid-cols-[280px_1fr] gap-6">
        {/* ── Sidebar (desktop) ── */}
        <aside className="hidden xl:block">
          <div className="sticky top-24 rounded-3xl border border-border/70 bg-card p-5 shadow-sm max-h-[calc(100vh-7rem)] overflow-y-auto pv-scroll">
            {FiltersPanel}
          </div>
        </aside>

        {/* ── Results ── */}
        <section aria-label={tx("نتایج", "Results")} className="min-w-0">
          <div className="flex flex-wrap items-center gap-3 justify-between mb-4">
            <p className="text-sm text-muted-foreground">
              {tx("نمایش", "Showing")} <b className="text-foreground">{num(results.length)}</b> {tx("گیاه", results.length === 1 ? "plant" : "plants")}
              {applied.category !== "all" && ` · ${tx(CATS.find((c) => c.key === applied.category)?.fa ?? "", CATS.find((c) => c.key === applied.category)?.en ?? "")}`}
            </p>
            <div className="flex items-center gap-2">
              <div className="relative">
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as typeof sort)}
                  aria-label={tx("مرتب‌سازی", "Sort")}
                  className="appearance-none h-9 rounded-xl border border-border bg-card ps-3 pe-8 text-xs font-medium cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <option value="relevance">{tx("مرتب‌سازی: پیشنهادی", "Sort: relevance")}</option>
                  <option value="name">{tx("مرتب‌سازی: نام", "Sort: name")}</option>
                  <option value="difficulty">{tx("مرتب‌سازی: سختی", "Sort: difficulty")}</option>
                </select>
                <ChevronDown className="size-3.5 absolute end-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              </div>
              <div className="flex rounded-xl border border-border overflow-hidden">
                <button
                  onClick={() => setLayout("grid")}
                  aria-label={tx("نمای شبکه‌ای", "Grid view")}
                  className={`size-9 grid place-items-center ${layout === "grid" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground"}`}
                >
                  <LayoutGrid className="size-4" />
                </button>
                <button
                  onClick={() => setLayout("list")}
                  aria-label={tx("نمای فهرستی", "List view")}
                  className={`size-9 grid place-items-center ${layout === "list" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground"}`}
                >
                  <List className="size-4" />
                </button>
              </div>
            </div>
          </div>

          <AnimatePresence mode="popLayout">
            {results.length === 0 ? (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-20 text-center space-y-3">
                <div className="size-16 mx-auto rounded-full bg-muted grid place-items-center">
                  <MicOff className="size-7 text-muted-foreground" />
                </div>
                <p className="font-bold">{tx("گیاهی یافت نشد", "No plants found")}</p>
                <p className="text-sm text-muted-foreground">{tx("فیلترها را تغییر دهید یا عبارت دیگری جستجو کنید.", "Try different filters or keywords.")}</p>
                <button onClick={reset} className="text-primary text-sm font-bold hover:underline">
                  {tx("پاک کردن فیلترها", "Clear filters")}
                </button>
              </motion.div>
            ) : (
              <motion.div
                key={layout + results.length}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className={
                  layout === "grid"
                    ? "grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4"
                    : "flex flex-col gap-3"
                }
              >
                {results.map((p, i) => (
                  layout === "grid"
                    ? <PlantCard key={p.slug} plant={p} index={i} compareMode={compareMode} compareSelected={compareSlugs.includes(p.slug)} onToggleCompare={() => toggleCompare(p.slug)} />
                    : <ListRow key={p.slug} plant={p} index={i} compareMode={compareMode} compareSelected={compareSlugs.includes(p.slug)} onToggleCompare={() => toggleCompare(p.slug)} />
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          {results.length > 0 && (
            <div className="py-10 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
              <Leaf className="size-4 text-primary/70" />
              {tx("همه گیاهان نمایش داده شد", "All plants shown")}
            </div>
          )}
        </section>
      </div>

      {/* Mobile filter drawer */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setSidebarOpen(false)}
              className="fixed inset-0 z-40 bg-black/40 xl:hidden"
            />
            <motion.aside
              id="catalog-filters"
              role="dialog"
              aria-modal="true"
              aria-label={tx("فیلترها", "Filters")}
              ref={filtersDrawerRef}
              tabIndex={-1}
              initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="fixed z-50 inset-y-0 end-0 w-[300px] max-w-[85vw] bg-background border-s border-border p-5 overflow-y-auto pv-scroll xl:hidden"
            >
              <button onClick={() => setSidebarOpen(false)} className="absolute top-4 end-4 size-9 grid place-items-center rounded-full hover:bg-muted" aria-label={tx("بستن", "Close")} data-autofocus>
                <X className="size-5" />
              </button>
              <div className="pt-10">{FiltersPanel}</div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* ── voice search (ASR) ── */}
      <VoiceSearch
        open={voiceOpen}
        onOpenChange={setVoiceOpen}
        onApply={(text) => {
          const next = { ...filters, q: text };
          setFilters(next);
          setApplied(next);
          setVoiceOpen(false);
        }}
      />

      {/* ── floating compare bar — selection tray + launch CTA ── */}
      <AnimatePresence>
        {compareMode && comparePlants.length > 0 && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 30 }}
            role="status"
            aria-live="polite"
            aria-label={tx("گیاهان انتخاب‌شده برای مقایسه", "Plants selected for comparison")}
            className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border/70 bg-card/95 py-2 ps-3 pe-2 shadow-xl shadow-forest/15 backdrop-blur sm:gap-3"
          >
            <div className="flex -space-x-2 rtl:space-x-reverse">
              {comparePlants.map((p) => (
                <span key={p.slug} className="relative size-9 shrink-0 overflow-hidden rounded-full ring-2 ring-background">
                  <Image src={p.image} alt={tx(p.nameFa, p.nameEn)} fill sizes="36px" className="object-cover" />
                </span>
              ))}
            </div>
            <span className="hidden text-xs font-bold sm:block">
              {num(comparePlants.length)} {tx("گیاه انتخاب شد", "plants selected")}
            </span>
            <button
              type="button"
              onClick={() => setCompareOpen(true)}
              disabled={comparePlants.length < 2}
              className="flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-xs font-black text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Scale className="size-3.5" aria-hidden />
              {comparePlants.length < 2 ? tx("حداقل ۲ گیاه", "Pick at least 2") : tx("مقایسه کن", "Compare")}
            </button>
            <button
              type="button"
              onClick={() => setCompareSlugs([])}
              aria-label={tx("پاک کردن انتخاب مقایسه", "Clear comparison selection")}
              className="grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted"
            >
              <X className="size-4" aria-hidden />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── comparison dialog («مقایسه گیاهان») ── */}
      <PlantCompareDialog open={compareOpen} plants={comparePlants} onClose={() => setCompareOpen(false)} />
    </div>
  );
}

function ListRow({ plant, index, compareMode, compareSelected, onToggleCompare }: {
  plant: PlantFixture; index: number;
  compareMode: boolean; compareSelected: boolean; onToggleCompare: () => void;
}) {
  const navigate = useAppStore((s) => s.navigate);
  const { tx } = useLang();
  const d = DIFFICULTY_META[plant.difficulty];
  return (
    /* relative wrapper — the compare toggle is a real sibling <button>,
       never nested inside the row's own <button> (invalid ARIA) */
    <div className="relative">
      <motion.button
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: index * 0.03 }}
        onClick={() => navigate("plant", { slug: plant.slug })}
        className="group flex w-full items-center gap-4 rounded-3xl bg-card border border-border/70 p-3 text-start hover:shadow-lg hover:border-primary/40 transition-all"
      >
        <span className="relative size-20 rounded-2xl overflow-hidden shrink-0">
          <Image src={plant.image} alt={tx(plant.nameFa, plant.nameEn)} fill sizes="80px" className="object-cover group-hover:scale-110 transition-transform duration-500" />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block font-bold text-sm">{tx(plant.nameFa, plant.nameEn)}</span>
          <span className="block text-xs text-muted-foreground italic">{plant.scientificName}</span>
          <span className="block text-[11px] text-muted-foreground mt-1 line-clamp-1">{tx(plant.descFa, plant.descEn)}</span>
        </span>
        <span className={`shrink-0 text-[11px] font-bold rounded-full px-2.5 py-1 ${d.color}`}>{tx(d.fa, d.en)}</span>
        <RotateCcw className="hidden" />
      </motion.button>
      {compareMode && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleCompare(); }}
          aria-pressed={compareSelected}
          aria-label={compareSelected
            ? tx(`حذف ${plant.nameFa} از مقایسه`, `Remove ${plant.nameEn} from comparison`)
            : tx(`افزودن ${plant.nameFa} به مقایسه`, `Add ${plant.nameEn} to comparison`)}
          className={`absolute top-2.5 start-2.5 z-10 size-8 grid place-items-center rounded-full backdrop-blur-sm focus-visible:ring-2 focus-visible:ring-ring transition-colors ${
            compareSelected
              ? "bg-primary text-primary-foreground shadow-md shadow-primary/40"
              : "bg-black/30 text-white hover:bg-black/50"
          }`}
        >
          {compareSelected ? <Check className="size-3.5" aria-hidden /> : <Plus className="size-3.5" aria-hidden />}
        </button>
      )}
    </div>
  );
}

/** shared pill styling for the compare toggles (header + card/list rows) */
function cnCompare(active: boolean) {
  return `size-10 grid place-items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
    active
      ? "bg-primary text-primary-foreground shadow-md shadow-primary/30"
      : "hover:bg-muted text-muted-foreground"
  }`;
}
