"use client";

import { motion } from "framer-motion";
import Image from "next/image";
import { useState } from "react";
import {
  Search, Camera, Sparkles, Globe, UserRound, Menu, X, Sun, Moon, ArrowLeft, Leaf,
  Flower2, Sprout, Soup, Waves, Umbrella as MushroomIcon, Tractor,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useAppStore } from "@/lib/store/app-store";
import { useLang } from "@/lib/i18n/use-lang";
import { PvLogo } from "@/components/layout/pv-logo";
import { AboutDialog, ServicesDialog } from "@/components/home/about-services";
import { PV_HOME_CATEGORIES, type PlantCategory } from "@/data/fixtures";

const CAT_ICONS: Record<string, typeof Leaf> = {
  pot: Flower2, sprout: Sprout, bowl: Soup, lotus: Waves, mushroom: MushroomIcon, tractor: Tractor,
};

const NAV = [
  { key: "home", fa: "خانه", en: "Home", view: "home" as const },
  { key: "plants", fa: "گیاهان", en: "Plants", view: "encyclopedia" as const },
  { key: "cats", fa: "دسته‌بندی‌ها", en: "Categories", view: "encyclopedia" as const },
  { key: "journal", fa: "مجله گیاه", en: "Journal", view: "magazine" as const },
  { key: "services", fa: "خدمات", en: "Services", view: null },
  { key: "about", fa: "درباره ما", en: "About", view: null },
];

export function HomeView() {
  const navigate = useAppStore((s) => s.navigate);
  const setChatOpen = useAppStore((s) => s.setChatOpen);
  const lang = useAppStore((s) => s.lang);
  const toggleLang = useAppStore((s) => s.toggleLang);
  const { tx, num } = useLang();
  const { theme, setTheme } = useTheme();
  const [query, setQuery] = useState("");
  const [servicesOpen, setServicesOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const goCategory = (c: PlantCategory) => navigate("encyclopedia", { category: c });

  return (
    <div className="flex-1 flex flex-col">
      {/* ─────────── Header ─────────── */}
      <header className="sticky top-0 z-30 pv-glass bg-background/80 border-b border-border/50">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 h-16 sm:h-[72px] flex items-center gap-4">
          <PvLogo />
          <nav aria-label={tx("ناوبری اصلی", "Main navigation")} className="hidden lg:flex items-center gap-1 mx-auto">
            {NAV.map((n) => {
              const active = n.key === "home";
              const onClick = () => {
                if (n.view) navigate(n.view);
                else if (n.key === "services") setServicesOpen(true);
                else if (n.key === "about") setAboutOpen(true);
              };
              return (
                <button
                  key={n.key}
                  onClick={onClick}
                  className={`relative px-4 py-2 text-sm font-medium rounded-full transition-colors ${
                    active ? "text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                  }`}
                >
                  {tx(n.fa, n.en)}
                  {active && (
                    <motion.span
                      layoutId="home-nav-underline"
                      className="absolute bottom-0 inset-x-5 h-0.5 rounded-full bg-terracotta"
                    />
                  )}
                </button>
              );
            })}
          </nav>
          <div className="flex items-center gap-2 ms-auto lg:ms-0">
            <button
              onClick={() => navigate("encyclopedia")}
              aria-label={tx("جستجو", "Search")}
              className="size-10 rounded-full border border-border bg-card grid place-items-center text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
            >
              <Search className="size-4.5" />
            </button>
            <button
              onClick={() => navigate("garden")}
              aria-label={tx("پروفایل", "Profile")}
              className="size-10 rounded-full border border-border bg-card grid place-items-center text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
            >
              <UserRound className="size-4.5" />
            </button>
            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label={tx("حالت شبانه", "Toggle theme")}
              className="size-10 rounded-full border border-border bg-card grid place-items-center text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
            >
              <Sun className="size-4.5 dark:hidden" />
              <Moon className="size-4.5 hidden dark:block" />
            </button>
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={toggleLang}
              className="h-10 px-3.5 rounded-full border border-border bg-card flex items-center gap-2 text-sm font-bold hover:border-primary/50 transition-colors"
              aria-label={tx("تغییر زبان", "Switch language")}
            >
              {lang === "fa" ? "EN" : "FA"}
              <Globe className="size-4 text-muted-foreground" />
            </motion.button>
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label={tx("منو", "Menu")}
              aria-expanded={menuOpen}
              aria-controls="mobile-nav"
              className="lg:hidden size-10 rounded-full border border-border bg-card grid place-items-center text-muted-foreground"
            >
              {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>
          </div>
        </div>
        {/* Mobile menu */}
        {menuOpen && (
          <motion.nav id="mobile-nav" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} className="lg:hidden overflow-hidden border-t border-border/50 bg-background/95">
            <div className="px-4 py-3 grid grid-cols-2 gap-2">
              {NAV.map((n) => (
                <button
                  key={n.key}
                  onClick={() => {
                    setMenuOpen(false);
                    if (n.view) navigate(n.view);
                    else if (n.key === "services") setServicesOpen(true);
                    else if (n.key === "about") setAboutOpen(true);
                  }}
                  className="rounded-2xl bg-muted/60 hover:bg-sage-soft dark:hover:bg-secondary px-4 py-3 text-sm font-medium text-start"
                >
                  {tx(n.fa, n.en)}
                </button>
              ))}
            </div>
          </motion.nav>
        )}
      </header>

      {/* ─────────── Cinematic Hero ─────────── */}
      <section className="relative flex-1" aria-label={tx("معرفی جهان‌گیاه", "PlantVerse intro")}>
        <div className="relative mx-auto max-w-7xl px-3 sm:px-6 pt-4">
          <motion.div
            initial={{ opacity: 0, scale: 1.02 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1.1, ease: "easeOut" }}
            className="relative rounded-[2rem] sm:rounded-[2.5rem] overflow-hidden min-h-[520px] sm:min-h-[560px] pv-grain"
          >
            <Image
              src="/images/hero-nature.jpg"
              alt={tx("برگ‌های سبز در نور طبیعی", "Lush green leaves in natural light")}
              fill priority
              sizes="100vw"
              className="object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-background via-background/55 to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-l from-background/70 via-transparent to-transparent" />

            {/* Hero content */}
            <div className="relative z-10 flex flex-col justify-end h-full p-6 sm:p-10 lg:p-14 gap-5 max-w-2xl">
              <motion.h1
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25, duration: 0.8 }}
                className="text-4xl sm:text-5xl lg:text-[3.4rem] font-extrabold leading-[1.25] text-foreground drop-shadow-sm"
              >
                {tx("با طبیعت،", "With nature,")}
                <br />
                {tx("خانه‌ای ", "build a ")}
                <span className="text-terracotta">{tx("سالم‌تر", "healthier")}</span>
                {tx(" بسازیم", " home")}
              </motion.h1>
              <motion.p
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4, duration: 0.8 }}
                className="text-muted-foreground text-base sm:text-lg font-medium"
              >
                {tx("شناسایی، مراقبت و کشت گیاهان با علم و عشق.", "Identify, care for and grow plants with science and love.")}
              </motion.p>

              {/* Search + AI pill */}
              <motion.form
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.55, duration: 0.8 }}
                onSubmit={(e) => { e.preventDefault(); navigate("encyclopedia", { query: query.trim() }); }}
                className="flex items-center gap-2 bg-card/90 pv-glass rounded-full p-1.5 ps-3 shadow-xl shadow-forest/15 dark:shadow-black/40 max-w-xl focus-within:ring-2 focus-within:ring-ring/40"
                role="search"
              >
                <Camera className="size-5 text-muted-foreground shrink-0 rtl:order-2" aria-hidden />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={tx("اسکن یا جستجوی گیاه…", "Scan or search a plant…")}
                  aria-label={tx("جستجوی گیاه", "Plant search")}
                  className="flex-1 bg-transparent outline-none text-sm min-w-0 placeholder:text-muted-foreground/80"
                />
                <motion.button
                  type="submit"
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.96 }}
                  className="shrink-0 h-11 px-5 rounded-full bg-forest-deep dark:bg-primary text-primary-foreground text-sm font-bold flex items-center gap-2 shadow-lg shadow-forest/30"
                >
                  <Sparkles className="size-4" />
                  {tx("هوش مصنوعی", "AI Search")}
                </motion.button>
              </motion.form>
            </div>

            {/* Floating AI assistant card */}
            <motion.button
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.8, duration: 0.8 }}
              onClick={() => setChatOpen(true)}
              whileHover={{ y: -4 }}
              className="hidden md:flex absolute z-10 top-1/2 -translate-y-1/2 end-8 xl:end-14 flex-col gap-2 bg-card/85 pv-glass rounded-3xl p-5 w-60 text-start shadow-2xl shadow-forest/20 dark:shadow-black/50 border border-border/60 group"
            >
              <div className="flex items-center gap-3">
                <span className="size-11 rounded-2xl bg-sage-soft dark:bg-secondary grid place-items-center">
                  <Leaf className="size-5 text-primary" />
                </span>
                <div>
                  <p className="font-bold text-sm">{tx("گیاه‌شناس هوشمند", "AI Botanist")}</p>
                  <p className="text-[10px] tracking-widest text-muted-foreground font-bold">AI POWERED</p>
                </div>
              </div>
              <div className="flex items-center gap-2 pt-1 border-t border-border/50 mt-1">
                <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">
                  {tx("در حال یادگیری طبیعت…", "Learning from nature…")}
                </span>
              </div>
            </motion.button>
          </motion.div>
        </div>

        {/* ─────────── Categories ─────────── */}
        <div className="mx-auto max-w-7xl px-3 sm:px-6 pb-28 sm:pb-32 pt-8">
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="flex items-center justify-center gap-3 mb-6"
          >
            <span className="h-px flex-1 max-w-24 bg-gradient-to-l from-transparent to-border" />
            <p className="text-sm font-bold text-muted-foreground flex items-center gap-2">
              <Leaf className="size-4 text-primary" />
              {tx("دسته‌بندی‌های گیاهی", "Plant Categories")}
              <Leaf className="size-4 text-primary rtl:-scale-x-100" />
            </p>
            <span className="h-px flex-1 max-w-24 bg-gradient-to-r from-transparent to-border" />
          </motion.div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
            {PV_HOME_CATEGORIES.map((c, i) => {
              const Icon = CAT_ICONS[c.icon];
              return (
                <motion.button
                  key={c.key}
                  initial={{ opacity: 0, y: 26 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-40px" }}
                  transition={{ delay: i * 0.07, duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
                  whileHover={{ y: -6 }}
                  onClick={() => goCategory(c.key)}
                  className="group relative rounded-3xl bg-card border border-border/70 p-4 sm:p-5 flex flex-col items-center text-center gap-3 shadow-sm hover:shadow-xl hover:shadow-forest/10 hover:border-primary/40 transition-all"
                >
                  <span className="size-14 sm:size-16 rounded-full bg-sage-soft/70 dark:bg-secondary grid place-items-center transition-transform group-hover:scale-110">
                    <Icon className="size-6 sm:size-7 text-forest dark:text-primary" strokeWidth={1.7} />
                  </span>
                  <div className="space-y-1">
                    <p className="font-bold text-sm sm:text-base">{tx(c.titleFa, c.titleEn)}</p>
                    <p className="text-[11px] sm:text-xs text-muted-foreground leading-relaxed">{tx(c.subFa, c.subEn)}</p>
                  </div>
                  <ArrowLeft className="size-4 text-terracotta opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all rtl:rotate-180" aria-hidden />
                </motion.button>
              );
            })}
          </div>

          {/* Special worlds — dedicated hubs */}
          <div className="mt-10 grid sm:grid-cols-2 gap-3 sm:gap-4">
            {[
              {
                view: "greenhouse" as const,
                fa: "گلخانه هوشمند", en: "Smart Greenhouse",
                subFa: "کشاورزی دقیق، تلهمتری زنده و راهنمای کشت محصولات", subEn: "Precision farming, live telemetry & crop guides",
                img: "/images/tomato.jpg",
                tint: "from-primary/25 via-sage-soft/30",
                emoji: "🌾",
              },
              {
                view: "mushrooms" as const,
                fa: "جهان قارچ‌ها", en: "World of Mushrooms",
                subFa: "قارچ‌های خوراکی و دارویی، کیت‌های کشت و مسیر برداشت", subEn: "Edible & medicinal fungi, grow kits & harvest path",
                img: "/images/oyster-mushroom.jpg",
                tint: "from-forest-deep/40 via-sage-soft/20",
                emoji: "🍄",
              },
            ].map((w, i) => (
              <motion.button
                key={w.view}
                initial={{ opacity: 0, y: 26 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-40px" }}
                transition={{ delay: i * 0.1, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                whileHover={{ y: -6 }}
                onClick={() => navigate(w.view)}
                className="group relative overflow-hidden rounded-[1.75rem] border border-border/70 text-start shadow-sm hover:shadow-xl hover:shadow-forest/10 hover:border-primary/40 transition-all min-h-36 sm:min-h-44"
                aria-label={tx(w.fa, w.en)}
              >
                <Image src={w.img} alt="" fill sizes="(max-width: 640px) 100vw, 50vw" className="object-cover transition-transform duration-700 group-hover:scale-110" />
                <div className={`absolute inset-0 bg-gradient-to-l ${w.tint} to-background/90`} />
                <div className="relative z-10 h-full flex flex-col justify-center gap-1.5 p-5 sm:p-6">
                  <span className="text-2xl">{w.emoji}</span>
                  <p className="font-extrabold text-base sm:text-lg">{tx(w.fa, w.en)}</p>
                  <p className="text-xs sm:text-[13px] text-muted-foreground leading-relaxed max-w-[26ch] sm:max-w-none">{tx(w.subFa, w.subEn)}</p>
                  <span className="mt-1 inline-flex items-center gap-1.5 text-xs font-bold text-primary">
                    {tx("ورود به جهان", "Enter world")}
                    <ArrowLeft className="size-3.5 rtl:rotate-180 transition-transform group-hover:-translate-x-0.5" aria-hidden />
                  </span>
                </div>
              </motion.button>
            ))}
          </div>

          {/* Stats strip */}
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            className="mt-10 flex flex-wrap items-center justify-center gap-x-10 gap-y-3 text-center"
          >
            {[
              { n: 1286, fa: "گیاه شناسنامه‌دار", en: "Documented plants" },
              { n: 98, fa: "دقت اسکن هوشمند", en: "Scan accuracy %" },
              { n: 42, fa: "کشور جهان‌گیاه", en: "Countries" },
              { n: 24, fa: "پشتیبانی ساعتی", en: "Hour support" },
            ].map((s) => (
              <div key={s.n} className="flex items-baseline gap-1.5">
                <span className="text-2xl font-extrabold text-primary">{num(s.n)}</span>
                <span className="text-xs text-muted-foreground">{tx(s.fa, s.en)}</span>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ── services / about dialogs (header nav) ── */}
      <ServicesDialog open={servicesOpen} onOpenChange={setServicesOpen} />
      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />
    </div>
  );
}
