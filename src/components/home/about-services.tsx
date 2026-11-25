"use client";

/**
 * PlantVerse — Home «خدمات» + «درباره ما» dialogs.
 *
 * Converts the home header's two coming-soon nav stubs into real content:
 *  - ServicesDialog: the six platform services as deep-navigating cards.
 *  - AboutDialog: mission, values, live live-counters (plants / articles /
 *    community posts straight from the APIs) and honest version info.
 *
 * Self-contained content components — no backend changes.
 */

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  BookOpen,
  Bot,
  Leaf,
  MessageCircleHeart,
  ScanLine,
  ShoppingBag,
  Soup,
  Sprout,
  Tractor,
  Waves,
  Flower2,
  Umbrella as MushroomIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAppStore } from "@/lib/store/app-store";
import { useLang } from "@/lib/i18n/use-lang";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/* ─────────────────────────── services dialog ─────────────────────────── */

interface Service {
  view: "scanner" | "garden" | "greenhouse" | "mushrooms" | "shop" | "magazine";
  fa: string;
  en: string;
  descFa: string;
  descEn: string;
  icon: LucideIcon;
  tint: string;
}

const SERVICES: Service[] = [
  {
    view: "scanner",
    fa: "شناسایی با اسکن",
    en: "Scan to identify",
    descFa: "عکس بگیر، گونه را در چند ثانیه بشناس و مستقیم به باغچه بیفزای.",
    descEn: "Snap a photo, identify the species in seconds, add it to your garden.",
    icon: ScanLine,
    tint: "bg-sky-500",
  },
  {
    view: "garden",
    fa: "باغچه هوشمند",
    en: "Smart garden",
    descFa: "برنامه مراقبت، تقویم جلالی، یادآوری تکرارشونده و گزارش رشد.",
    descEn: "Care plans, jalali calendar, repeating reminders and growth reports.",
    icon: Flower2,
    tint: "bg-emerald-500",
  },
  {
    view: "greenhouse",
    fa: "گلخانه متصل",
    en: "Connected greenhouse",
    descFa: "سنسورهای زنده دما و رطوبت، هشدار باند و خلبان خودکار.",
    descEn: "Live temperature & humidity sensors, band alerts and autopilot.",
    icon: Tractor,
    tint: "bg-amber-500",
  },
  {
    view: "mushrooms",
    fa: "پرورش قارچ",
    en: "Mushroom cultivation",
    descFa: "دوره‌های کشت قارچ خوراکی با تایم‌لاین روزبه‌روز و نکات ایمنی.",
    descEn: "Edible-mushroom growing tracks with day-by-day timelines and safety notes.",
    icon: MushroomIcon,
    tint: "bg-purple-500",
  },
  {
    view: "shop",
    fa: "فروشگاه سبز",
    en: "Green shop",
    descFa: "گیاه، بذر و ابزار با پرداخت، کد تخفیف و رهگیری زنده سفارش.",
    descEn: "Plants, seeds and tools with checkout, coupons and live order tracking.",
    icon: ShoppingBag,
    tint: "bg-teal-600",
  },
  {
    view: "magazine",
    fa: "مجله گیاه",
    en: "Plant magazine",
    descFa: "مقاله‌های تخصصی مراقبت با فهرست مطالعه و اشتراک‌گذاری.",
    descEn: "In-depth care stories with a reading list and sharing.",
    icon: BookOpen,
    tint: "bg-orange-500",
  },
];

export function ServicesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useAppStore((s) => s.navigate);
  const setChatOpen = useAppStore((s) => s.setChatOpen);
  const { tx } = useLang();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-lg gap-0 overflow-hidden rounded-3xl p-0 sm:max-w-xl">
        <DialogHeader className="border-b border-border/60 bg-gradient-to-r from-sage-soft/60 to-transparent px-5 pb-4 pt-5 text-start">
          <DialogTitle className="flex items-center gap-2 text-base font-extrabold">
            <span className="grid size-9 place-items-center rounded-xl bg-primary/15">
              <Leaf className="size-4.5 text-primary" aria-hidden />
            </span>
            {tx("خدمات جهان‌گیاه", "PlantVerse services")}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {tx("همه‌چیزِ یک بونسای دیجیتال — روی هر خدمت بزن تا همان‌جا بروی.", "Everything of a digital bonsai — tap any service to jump in.")}
          </DialogDescription>
        </DialogHeader>

        <div className="pv-scroll max-h-[62vh] overflow-y-auto px-5 py-4">
          <div className="grid gap-2.5 sm:grid-cols-2">
            {SERVICES.map((s, i) => (
              <motion.button
                key={s.view}
                type="button"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.05, 0.3) }}
                whileHover={{ y: -3 }}
                onClick={() => {
                  onOpenChange(false);
                  navigate(s.view);
                }}
                className="flex items-start gap-3 rounded-2xl border border-border/60 bg-card p-3.5 text-start transition-colors hover:border-primary/30 hover:bg-sage-soft/40 dark:hover:bg-secondary"
              >
                <span className={`grid size-10 shrink-0 place-items-center rounded-xl text-white ${s.tint}`}>
                  <s.icon className="size-5" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-extrabold">{tx(s.fa, s.en)}</span>
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">{tx(s.descFa, s.descEn)}</span>
                </span>
              </motion.button>
            ))}
          </div>

          {/* assistant service (opens the chat widget instead of a view) */}
          <motion.button
            type="button"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            onClick={() => {
              onOpenChange(false);
              setChatOpen(true);
            }}
            className="mt-2.5 flex w-full items-center gap-3 rounded-2xl border-2 border-dashed border-primary/30 bg-primary/5 p-3.5 text-start transition-colors hover:bg-primary/10"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
              <Bot className="size-5" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-extrabold">{tx("دستیار هوشمند گیاه‌پزشک", "AI plant-doctor assistant")}</span>
              <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
                {tx("۲۴ ساعته آنلاین: تشخیص مشکل، نسخه مراقبت و پاسخ به هر سؤال سبز.", "Online 24/7: diagnose problems, write care prescriptions, answer any green question.")}
              </span>
            </span>
          </motion.button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─────────────────────────── about dialog ────────────────────────────── */

interface LiveCounts {
  plants: number | null;
  articles: number | null;
  posts: number | null;
}

const VALUE_CHIPS: { fa: string; en: string; icon: LucideIcon }[] = [
  { fa: "دانش بومی، معتبر جهانی", en: "Local knowledge, global rigor", icon: BookOpen },
  { fa: "دوستدار محیط زیست", en: "Planet-first", icon: Sprout },
  { fa: "آب، نسل فردا", en: "Water is tomorrow's heir", icon: Waves },
  { fa: "از خاک تا سفره", en: "From soil to table", icon: Soup },
];

export function AboutDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { tx, num } = useLang();
  const navigate = useAppStore((s) => s.navigate);
  const setChatOpen = useAppStore((s) => s.setChatOpen);
  const [counts, setCounts] = useState<LiveCounts>({ plants: null, articles: null, posts: null });

  /* live counters fire only while open; failures keep the dashes */
  useEffect(() => {
    if (!open) return;
    let alive = true;
    (async () => {
      const grab = async (url: string, pick: (d: Record<string, unknown>) => number | undefined) => {
        try {
          const r = await fetch(url, { cache: "no-store" });
          const d = (await r.json().catch(() => null)) as Record<string, unknown> | null;
          if (!r.ok || !d) return null;
          const v = pick(d);
          return typeof v === "number" ? v : null;
        } catch {
          return null;
        }
      };
      const [plants, articles, posts] = await Promise.all([
        grab("/api/plants", (d) => (typeof d.count === "number" ? d.count : Array.isArray(d.plants) ? d.plants.length : undefined)),
        grab("/api/articles", (d) => (typeof d.total === "number" ? d.total : Array.isArray(d.articles) ? d.articles.length : undefined)),
        grab("/api/community", (d) => (typeof d.total === "number" ? d.total : Array.isArray(d.posts) ? d.posts.length : undefined)),
      ]);
      if (alive) setCounts({ plants, articles, posts });
    })();
    return () => {
      alive = false;
    };
  }, [open]);

  const stats: { v: number | null; fa: string; en: string }[] = [
    { v: counts.plants, fa: "گونه در دانشنامه", en: "species cataloged" },
    { v: counts.articles, fa: "مقاله تخصصی", en: "care articles" },
    { v: counts.posts, fa: "گفت‌وگوی انجمن", en: "community posts" },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-lg gap-0 overflow-hidden rounded-3xl p-0 sm:max-w-xl">
        <DialogHeader className="border-b border-border/60 bg-gradient-to-r from-sage-soft/60 to-transparent px-5 pb-4 pt-5 text-start">
          <DialogTitle className="flex items-center gap-2 text-base font-extrabold">
            <span className="grid size-9 place-items-center rounded-xl bg-primary/15">
              <Leaf className="size-4.5 text-primary" aria-hidden />
            </span>
            {tx("درباره جهان‌گیاه", "About PlantVerse")}
          </DialogTitle>
          <DialogDescription className="text-xs">{tx("جهان‌گیاه — پلتفرم فارسی‌زبان دوستداران گیاه", "PlantVerse — the Persian-speaking plant lover's platform")}</DialogDescription>
        </DialogHeader>

        <div className="pv-scroll max-h-[62vh] space-y-4 overflow-y-auto px-5 py-4">
          <motion.p
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-xs leading-6 text-foreground/90"
          >
            {tx(
              "ما باور داریم هر خانه، حتی با یک گلدان کوچک، می‌تواند یک جهان باشد. «جهان‌گیاه» از دلِ هزار سؤال بی‌پاسخِ دوستداران گیاه ساخته شد: چرا برگ‌ها زرد شد؟ کی آبیاری کنم؟ این قارچ دوست یا دشمن است؟ امروز، دانشنامه زنده، باغچه هوشمند، گلخانه متصل، فروشگاه سبز و مجله‌ای تخصصی در یک تجربه فارسی‌محور کنار هم نشسته‌اند — تا مراقبت از گیاه از یک نگرانی، به یک لذت روزمره تبدیل شود.",
              "We believe every home — even with one small pot — can be a world. «PlantVerse» grew from thousands of unanswered questions: why are the leaves yellowing? when should I water? is this fungus friend or foe? Today a living encyclopedia, a smart garden, a connected greenhouse, a green shop and a dedicated magazine sit side by side in one Persian-first experience — turning plant care from worry into a daily joy."
            )}
          </motion.p>

          {/* live stats */}
          <div className="grid grid-cols-3 gap-2" data-testid="about-stats">
            {stats.map((s) => (
              <div key={s.en} className="rounded-2xl border border-border/60 bg-card p-3 text-center">
                <p className="text-xl font-black text-primary" aria-label={s.v == null ? "—" : String(s.v)}>
                  {s.v == null ? "—" : num(s.v)}
                </p>
                <p className="mt-0.5 text-[10px] leading-tight text-muted-foreground">{tx(s.fa, s.en)}</p>
              </div>
            ))}
          </div>

          {/* values */}
          <div>
            <p className="mb-1.5 text-[11px] font-black uppercase tracking-wide text-muted-foreground">
              {tx("ارزش‌های ما", "Our values")}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {VALUE_CHIPS.map((c) => (
                <span key={c.en} className="flex items-center gap-1.5 rounded-full border border-border/60 bg-sage-soft/50 px-3 py-1.5 text-[11px] font-bold dark:bg-secondary/60">
                  <c.icon className="size-3.5 text-primary" aria-hidden />
                  {tx(c.fa, c.en)}
                </span>
              ))}
            </div>
          </div>

          {/* CTA row */}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
                navigate("encyclopedia");
              }}
              className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-[11px] font-bold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <BookOpen className="size-3.5" aria-hidden />
              {tx("گشت در دانشنامه", "Browse the encyclopedia")}
            </button>
            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
                setChatOpen(true);
              }}
              className="flex items-center gap-1.5 rounded-full border border-border bg-background/70 px-4 py-2 text-[11px] font-bold transition-colors hover:bg-sage-soft/60 dark:bg-secondary"
            >
              <MessageCircleHeart className="size-3.5 text-primary" aria-hidden />
              {tx("حرف سبزت را با ما در میان بگذار", "Tell us your green story")}
            </button>
          </div>

          <p className="border-t border-border/60 pt-3 text-center text-[10px] text-muted-foreground">
            {tx("نسخه ۱٫۰ — ساخته‌شده با 🌿 برای زبان فارسی", "Version 1.0 — built with 🌿 for the Persian language")}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
