"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowLeft,
  Dna,
  FlaskConical,
  HeartPulse,
  Microscope,
  Moon,
  Pill,
  Recycle,
  Salad,
  ShieldCheck,
  Sparkles,
  Sprout,
  Timer,
  Wheat,
  type LucideIcon,
} from "lucide-react";
import { useAppStore } from "@/lib/store/app-store";
import { useLang } from "@/lib/i18n/use-lang";
import { PlantCard } from "@/components/encyclopedia/plant-card";
import { StaggerGroup, staggerItem } from "@/components/fx/progress-ring";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  PV_CATALOG_COUNTS,
  PV_PLANTS,
  type CareGuideItem,
  type Difficulty,
  type DiseaseItem,
  type GrowthStage,
  type LightNeed,
  type PlantCategory,
  type PlantFixture,
  type PropagationItem,
  type Toxicity,
  type WaterNeed,
} from "@/data/fixtures";

/* ─────────────────────────── API row → PlantFixture ─────────────────────────── */

/** Raw /api/plants row — JSON columns may arrive as strings (DB) or already parsed (API). */
interface PlantRow {
  slug: string;
  nameFa: string;
  nameEn: string;
  scientificName: string;
  commonNamesFa: unknown;
  commonNamesEn: unknown;
  familyFa: string;
  familyEn: string;
  category: string;
  difficulty: string;
  light: string;
  water: string;
  humidity: string;
  tempMin: number;
  tempMax: number;
  careLevel: number;
  toxicity: string;
  toxicityNoteFa: string;
  toxicityNoteEn: string;
  seasons: unknown;
  region: string;
  growthStages: unknown;
  descFa: string;
  descEn: string;
  image: string;
  lightDescFa: string;
  lightDescEn: string;
  waterDescFa: string;
  waterDescEn: string;
  humidityDescFa: string;
  humidityDescEn: string;
  dailyCareFa?: unknown;
  dailyCare?: unknown;
  diseases: unknown;
  propagation: unknown;
  historyFa: string;
  historyEn: string;
  funFactFa: string;
  funFactEn: string;
  views?: number;
  favorites?: number;
  featured?: boolean;
}

/** Parse a JSON column that may be a string or an already-parsed array. */
function asArray<T>(raw: unknown, fallback: T[]): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as T[]) : fallback;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function toFixture(row: PlantRow): PlantFixture {
  return {
    slug: row.slug,
    nameFa: row.nameFa,
    nameEn: row.nameEn,
    scientificName: row.scientificName,
    commonNamesFa: asArray<string>(row.commonNamesFa, []),
    commonNamesEn: asArray<string>(row.commonNamesEn, []),
    familyFa: row.familyFa,
    familyEn: row.familyEn,
    category: row.category as PlantCategory,
    difficulty: row.difficulty as Difficulty,
    light: row.light as LightNeed,
    water: row.water as WaterNeed,
    humidity: row.humidity as PlantFixture["humidity"],
    tempMin: row.tempMin,
    tempMax: row.tempMax,
    careLevel: row.careLevel,
    toxicity: row.toxicity as Toxicity,
    toxicityNoteFa: row.toxicityNoteFa,
    toxicityNoteEn: row.toxicityNoteEn,
    seasons: asArray<string>(row.seasons, []),
    region: row.region,
    growthStages: asArray<GrowthStage>(row.growthStages, []),
    descFa: row.descFa,
    descEn: row.descEn,
    image: row.image,
    lightDescFa: row.lightDescFa,
    lightDescEn: row.lightDescEn,
    waterDescFa: row.waterDescFa,
    waterDescEn: row.waterDescEn,
    humidityDescFa: row.humidityDescFa,
    humidityDescEn: row.humidityDescEn,
    dailyCare: asArray<CareGuideItem>(row.dailyCareFa ?? row.dailyCare, []),
    diseases: asArray<DiseaseItem>(row.diseases, []),
    propagation: asArray<PropagationItem>(row.propagation, []),
    historyFa: row.historyFa,
    historyEn: row.historyEn,
    funFactFa: row.funFactFa,
    funFactEn: row.funFactEn,
    views: row.views ?? 0,
    favorites: row.favorites ?? 0,
    featured: Boolean(row.featured),
  };
}

/* ─────────────────────────── static data ─────────────────────────── */

const FALLBACK_SPECIES: PlantFixture[] = PV_PLANTS.filter((p) => p.category === "mushroom");

interface StepDef {
  icon: LucideIcon;
  fa: string;
  en: string;
  descFa: string;
  descEn: string;
}

const STEPS: StepDef[] = [
  {
    icon: FlaskConical,
    fa: "بستر",
    en: "Substrate",
    descFa: "خاک‌اره، کاه یا تفاله‌ی قهوه را پاستوریزه و مرطوب کنید — غذای قارچ همین است.",
    descEn: "Pasteurize and moisten sawdust, straw or coffee grounds — this is the mushroom's food.",
  },
  {
    icon: Dna,
    fa: "اسپان‌زنی",
    en: "Spawning",
    descFa: "میسلیوم سفید را در بستر پخش کنید و در تاریکی و گرمای ملایم نگه دارید.",
    descEn: "Mix the white mycelium through the substrate and keep it dark and gently warm.",
  },
  {
    icon: Sprout,
    fa: "میوه‌دهی",
    en: "Fruiting",
    descFa: "رطوبت ۸۰٪، هوای تازه و نور غیرمستقیم؛ غنچه‌های کوچک بیدار می‌شوند.",
    descEn: "80% humidity, fresh air and indirect light — tiny pins begin to wake.",
  },
  {
    icon: Wheat,
    fa: "برداشت",
    en: "Harvest",
    descFa: "وقتی لبه‌ی کلاهک صاف شد بچینید؛ هر بستر تا چند موج می‌دهد.",
    descEn: "Pick when the cap edge flattens — each substrate gives several flushes.",
  },
];

interface BenefitDef {
  icon: LucideIcon;
  fa: string;
  en: string;
  subFa: string;
  subEn: string;
}

const BENEFITS: BenefitDef[] = [
  { icon: ShieldCheck, fa: "ایمنی‌بخشی", en: "Immunity boost", subFa: "بتاگلوکان فعال", subEn: "Active beta-glucans" },
  { icon: HeartPulse, fa: "ضدالتهاب", en: "Anti-inflammatory", subFa: "تریتپنوئیدهای طبیعی", subEn: "Natural triterpenoids" },
  { icon: Sparkles, fa: "آنتی‌اکسیدان", en: "Antioxidant", subFa: "مهار رادیکال آزاد", subEn: "Free-radical scavenging" },
  { icon: Moon, fa: "آرام‌بخش", en: "Calming", subFa: "خواب عمیق‌تر", subEn: "Deeper sleep" },
];

interface CardRow {
  icon: LucideIcon;
  fa: string;
  en: string;
}

/* ─────────────────────────── local pieces ─────────────────────────── */

function SectionHeader({
  icon: Icon,
  titleFa,
  titleEn,
  subFa,
  subEn,
  children,
}: {
  icon: LucideIcon;
  titleFa: string;
  titleEn: string;
  subFa: string;
  subEn: string;
  children?: ReactNode;
}) {
  const { tx } = useLang();
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div className="flex items-center gap-2.5">
        <span className="grid size-10 place-items-center rounded-2xl bg-sage-soft text-forest-deep dark:bg-secondary/40 dark:text-primary">
          <Icon className="size-5" aria-hidden />
        </span>
        <div>
          <h2 className="text-lg font-extrabold sm:text-xl">{tx(titleFa, titleEn)}</h2>
          <p className="text-xs text-muted-foreground">{tx(subFa, subEn)}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function TabCard({
  image,
  titleFa,
  titleEn,
  subFa,
  subEn,
  rows,
}: {
  image: string;
  titleFa: string;
  titleEn: string;
  subFa: string;
  subEn: string;
  rows: CardRow[];
}) {
  const { tx } = useLang();
  return (
    <article className="flex flex-col overflow-hidden rounded-2xl border border-border/60 bg-sage-soft/40 dark:bg-secondary/30">
      <div className="relative h-40 sm:h-44">
        <Image src={image} alt={tx(titleFa, titleEn)} fill sizes="(max-width: 768px) 100vw, 50vw" className="object-cover" />
      </div>
      <div className="flex flex-1 flex-col p-4">
        <h3 className="font-extrabold">{tx(titleFa, titleEn)}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{tx(subFa, subEn)}</p>
        <ul className="mt-3 space-y-2.5">
          {rows.map((r) => (
            <li key={r.en} className="flex items-start gap-2.5 text-xs leading-relaxed">
              <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-xl bg-card text-forest-deep shadow-sm dark:text-primary">
                <r.icon className="size-3.5" aria-hidden />
              </span>
              <span>{tx(r.fa, r.en)}</span>
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}

function NutritionCard() {
  const { tx, num } = useLang();
  const stats = [
    { fa: "پروتئین", en: "Protein", value: num("3.3"), unitFa: "گرم", unitEn: "g" },
    { fa: "فیبر", en: "Fiber", value: num("2.3"), unitFa: "گرم", unitEn: "g" },
    { fa: "کالری", en: "Calories", value: num(33), unitFa: "کیلوکالری", unitEn: "kcal" },
    { fa: "ویتامین D", en: "Vitamin D", value: tx("غنی", "Rich"), unitFa: "با نور", unitEn: "with light" },
  ];
  return (
    <article className="flex flex-col rounded-2xl border border-border/60 bg-sage-soft/40 p-4 dark:bg-secondary/30">
      <div className="flex items-center gap-2.5">
        <span className="grid size-9 place-items-center rounded-xl bg-card text-forest-deep shadow-sm dark:text-primary">
          <Salad className="size-4.5" aria-hidden />
        </span>
        <div>
          <h3 className="font-extrabold">{tx("انبان پروتئین گیاهی", "A pantry of plant protein")}</h3>
          <p className="text-xs text-muted-foreground">{tx("ارزش غذایی در ۱۰۰ گرم قارچ صدفی", "Nutrition per 100 g of oyster mushroom")}</p>
        </div>
      </div>
      <div className="mt-4 grid flex-1 grid-cols-2 gap-2.5">
        {stats.map((s) => (
          <div key={s.en} className="rounded-xl bg-card p-3 shadow-sm">
            <p className="text-[11px] font-semibold text-muted-foreground">{tx(s.fa, s.en)}</p>
            <p className="mt-0.5 text-lg font-extrabold text-forest-deep dark:text-primary">
              {s.value} <span className="text-[10px] font-medium text-muted-foreground">{tx(s.unitFa, s.unitEn)}</span>
            </p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        {tx(
          "سوپرفود کم‌کالری؛ جایگزین هوشمند گوشت در قیمه، سوپ و پیتزای خانگی.",
          "A low-calorie superfood — a smart meat substitute in stews, soups and homemade pizza."
        )}
      </p>
    </article>
  );
}

/* ─────────────────────────── view ─────────────────────────── */

export function MushroomView() {
  const { tx, num } = useLang();
  const navigate = useAppStore((s) => s.navigate);
  const showToast = useAppStore((s) => s.showToast);

  const [species, setSpecies] = useState<PlantFixture[] | null>(null);
  const speciesRef = useRef<HTMLElement | null>(null);

  // Species grid — /api/plants?category=mushroom, fixture fallback on any failure
  useEffect(() => {
    let alive = true;
    fetch("/api/plants?category=mushroom")
      .then((r) => r.json())
      .then((d: { success?: boolean; plants?: PlantRow[] }) => {
        if (!alive) return;
        if (d?.success && Array.isArray(d.plants) && d.plants.length > 0) {
          setSpecies(d.plants.map(toFixture));
        } else {
          setSpecies(FALLBACK_SPECIES);
        }
      })
      .catch(() => {
        if (alive) setSpecies(FALLBACK_SPECIES);
      });
    return () => {
      alive = false;
    };
  }, []);

  const scrollToSpecies = () => speciesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="min-h-screen bg-background pb-28">
      {/* ── sticky glass header ── */}
      <header className="sticky top-3 z-30 mx-auto max-w-6xl px-3 sm:px-6">
        <div className="pv-glass flex items-center gap-3 rounded-full border border-border/60 bg-card/70 py-2 shadow-lg shadow-forest/10 pe-2 ps-2 dark:shadow-black/30 sm:ps-3">
          <button
            onClick={() => navigate("home")}
            aria-label={tx("بازگشت به خانه", "Back to home")}
            className="grid size-10 shrink-0 place-items-center rounded-full bg-sage-soft text-forest-deep transition-transform hover:scale-105 active:scale-95 dark:bg-secondary/40 dark:text-primary"
          >
            <ArrowLeft className="size-5 rtl:rotate-180" aria-hidden />
          </button>
          <div className="min-w-0 flex-1 text-start">
            <h1 className="truncate text-sm font-extrabold sm:text-base">{tx("جهان قارچ‌ها", "World of Mushrooms")}</h1>
            <p className="truncate text-[11px] text-muted-foreground">{tx("از خوراکی تا دارویی", "From edible to medicinal")}</p>
          </div>
          <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-2xl bg-forest-deep text-lg shadow-md">
            🍄
          </span>
        </div>
      </header>

      {/* ── 1) forest hero ── */}
      <section className="pv-grain relative -mt-16 overflow-hidden rounded-b-[3rem] bg-forest-deep pt-16 text-primary-foreground">
        <div aria-hidden className="absolute inset-0">
          <div className="absolute -end-24 -top-24 size-72 rounded-full bg-leaf/20 blur-3xl" />
          <div className="absolute -bottom-28 -start-20 size-80 rounded-full bg-gold/10 blur-3xl" />
        </div>
        <span aria-hidden className="pv-float absolute end-[8%] top-20 select-none text-6xl opacity-30">🍄</span>
        <span aria-hidden className="pv-float absolute start-[12%] top-32 select-none text-4xl opacity-20" style={{ animationDelay: "0.7s" }}>
          🍄
        </span>
        <span aria-hidden className="pv-float absolute bottom-10 start-[46%] select-none text-5xl opacity-25" style={{ animationDelay: "1.4s" }}>
          🍄
        </span>

        <div className="relative mx-auto max-w-6xl px-4 pb-16 pt-10 sm:px-6 sm:pb-20 sm:pt-14">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary-foreground/20 bg-primary-foreground/10 px-3 py-1 text-[11px] font-bold">
            <Sparkles className="size-3.5" aria-hidden />
            {tx("پادشاهی فانگوس 🍄", "The fungal kingdom 🍄")}
          </span>
          <h2 className="mt-4 max-w-xl text-2xl font-extrabold leading-snug sm:text-4xl sm:leading-snug">
            {tx("قارچ‌های خوراکی و دارویی", "Edible & medicinal mushrooms")}
          </h2>
          <p className="mt-3 max-w-lg text-sm leading-relaxed text-primary-foreground/70 sm:text-base">
            {tx(
              "زیر سایه‌ی جنگل، پادشاهی‌ای بی‌برگ و بی‌بذر می‌روید؛ پر از راز، پر از نیرو.",
              "Beneath the forest shade grows a kingdom without leaf or seed — full of secrets, full of power."
            )}
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              onClick={() => {
                navigate("shop");
                showToast(tx("کیت‌های کشت قارچ در فروشگاه آماده‌اند 🍄", "Mushroom growing kits await in the shop 🍄"));
              }}
              className="rounded-full bg-gold px-5 py-2.5 text-sm font-extrabold text-forest-deep shadow-lg shadow-black/25 transition-transform hover:scale-[1.03] active:scale-95"
            >
              {tx("کیت‌های کشت", "Growing kits")}
            </button>
            <button
              onClick={scrollToSpecies}
              className="rounded-full border border-primary-foreground/25 bg-primary-foreground/10 px-5 py-2.5 text-sm font-bold transition-colors hover:bg-primary-foreground/20"
            >
              {tx("دانشنامه قارچ‌ها", "Species library")}
            </button>
          </div>
          <div className="mt-8 flex flex-wrap gap-2 text-[11px] font-bold">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary-foreground/15 bg-primary-foreground/10 px-3 py-1.5">
              <Microscope className="size-3.5" aria-hidden />
              {num(PV_CATALOG_COUNTS.mushroom)} {tx("گونه ثبت‌شده", "cataloged species")}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary-foreground/15 bg-primary-foreground/10 px-3 py-1.5">
              <Sprout className="size-3.5" aria-hidden />
              {num(4)} {tx("گام تا برداشت", "steps to harvest")}
            </span>
          </div>
        </div>
      </section>

      <div className="relative z-10 mx-auto max-w-6xl space-y-10 px-3 sm:px-6 sm:space-y-12">
        {/* ── 2) edible vs medicinal tabs ── */}
        <section aria-label={tx("دو جهان قارچ", "Two worlds of fungi")} className="-mt-8">
          <div className="rounded-3xl border border-border/60 bg-card p-4 shadow-xl shadow-forest/10 dark:shadow-black/30 sm:p-6">
            <Tabs defaultValue="edible">
              <TabsList className="grid h-11 w-full grid-cols-2 rounded-2xl bg-sage-soft p-1 dark:bg-secondary/40">
                <TabsTrigger
                  value="edible"
                  className="rounded-xl text-xs font-bold data-[state=active]:bg-card dark:data-[state=active]:bg-card sm:text-sm"
                >
                  🍽️ {tx("خوراکی", "Edible")}
                </TabsTrigger>
                <TabsTrigger
                  value="medicinal"
                  className="rounded-xl text-xs font-bold data-[state=active]:bg-card dark:data-[state=active]:bg-card sm:text-sm"
                >
                  💊 {tx("دارویی", "Medicinal")}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="edible" className="mt-4 grid gap-4 md:grid-cols-2">
                <TabCard
                  image="/images/oyster-mushroom.jpg"
                  titleFa="قارچ صدفی؛ ستاره‌ی کشت خانگی"
                  titleEn="Oyster mushroom; the star of home growing"
                  subFa="سریع‌ترین قارچ برای شروع؛ حتی روی پنجره‌ی آشپزخانه."
                  subEn="The fastest mushroom to start — even on a kitchen windowsill."
                  rows={[
                    {
                      icon: FlaskConical,
                      fa: "روی خاک‌اره، کاه و حتی تفاله‌ی قهوه می‌روید.",
                      en: "Grows on sawdust, straw and even coffee grounds.",
                    },
                    {
                      icon: Timer,
                      fa: "از اسپان تا برداشت، فقط ۳ تا ۴ هفته.",
                      en: "From spawn to harvest in just 3–4 weeks.",
                    },
                    {
                      icon: Recycle,
                      fa: "کشت ارگانیک روی ضایعات کشاورزی؛ دوستدار محیط زیست.",
                      en: "Organic growing on farm waste; eco-friendly by design.",
                    },
                  ]}
                />
                <NutritionCard />
              </TabsContent>

              <TabsContent value="medicinal" className="mt-4 grid gap-4 md:grid-cols-2">
                <TabCard
                  image="/images/reishi.jpg"
                  titleFa="گنودرما (ریشی)؛ قارچ طول عمر"
                  titleEn="Reishi; the mushroom of longevity"
                  subFa="«قارچ جاودانگی» در پزشکی سنتی شرق، هزاران سال قدمت دارد."
                  subEn="The 'mushroom of immortality' in Eastern traditional medicine for millennia."
                  rows={[
                    {
                      icon: Dna,
                      fa: "آداپتوژن طبیعی برای تعادل بدن در برابر استرس.",
                      en: "A natural adaptogen that helps the body balance stress.",
                    },
                    {
                      icon: ShieldCheck,
                      fa: "تقویت پاسخ ایمنی با پلی‌ساکاریدهای بتاگلوکان.",
                      en: "Supports immune response with beta-glucan polysaccharides.",
                    },
                    {
                      icon: HeartPulse,
                      fa: "حمایت از آرامش، تمرکز و کیفیت خواب.",
                      en: "Supports calm, focus and sleep quality.",
                    },
                  ]}
                />
                <article className="flex flex-col rounded-2xl border border-border/60 bg-sage-soft/40 p-4 dark:bg-secondary/30">
                  <div className="flex items-center gap-2.5">
                    <span className="grid size-9 place-items-center rounded-xl bg-card text-forest-deep shadow-sm dark:text-primary">
                      <Pill className="size-4.5" aria-hidden />
                    </span>
                    <div>
                      <h3 className="font-extrabold">{tx("مصرف هوشمندانه", "Smart usage")}</h3>
                      <p className="text-xs text-muted-foreground">{tx("چگونه از خواص گنودرما بهره ببریم", "How to get the most from reishi")}</p>
                    </div>
                  </div>
                  <ul className="mt-4 flex-1 space-y-2.5">
                    {[
                      {
                        icon: Timer,
                        fa: "دم‌نوش یا عصاره؛ ۱ تا ۲ بار در روز، ترجیحاً عصرها.",
                        en: "Tea or extract; once or twice daily, preferably evenings.",
                      },
                      {
                        icon: Sprout,
                        fa: "۳ تا ۶ هفته مصرف منظم برای اثر پایدار.",
                        en: "3–6 weeks of regular use for lasting effects.",
                      },
                      {
                        icon: Microscope,
                        fa: "عصاره‌ی استاندارد و آزموده‌شده انتخاب کنید.",
                        en: "Choose standardized, lab-tested extracts.",
                      },
                    ].map((r) => (
                      <li key={r.en} className="flex items-start gap-2.5 text-xs leading-relaxed">
                        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-xl bg-card text-forest-deep shadow-sm dark:text-primary">
                          <r.icon className="size-3.5" aria-hidden />
                        </span>
                        <span>{tx(r.fa, r.en)}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 rounded-xl bg-card p-3 text-[11px] leading-relaxed text-muted-foreground">
                    {tx(
                      "⚠️ در بارداری، شیردهی یا مصرف داروهای رقیق‌کننده خون، حتماً با پزشک مشورت کنید.",
                      "⚠️ During pregnancy, breastfeeding or blood-thinner medication, consult your physician first."
                    )}
                  </p>
                </article>
              </TabsContent>
            </Tabs>
          </div>
        </section>

        {/* ── 3) cultivation timeline ── */}
        <section aria-labelledby="mh-steps" className="space-y-4">
          <SectionHeader
            icon={Sprout}
            titleFa="مسیر کشت در ۴ گام"
            titleEn="Cultivation in 4 steps"
            subFa="از بستر مرطوب تا سفره‌ی خانه"
            subEn="From moist substrate to the family table"
          />
          <StaggerGroup className="flex flex-col lg:flex-row lg:items-stretch">
            {STEPS.map((s, i) => (
              <Fragment key={s.en}>
                <motion.div variants={staggerItem} className="flex-1 rounded-3xl border border-border/60 bg-card p-4 shadow-sm">
                  <div className="flex items-center gap-2.5">
                    <span className="relative grid size-11 shrink-0 place-items-center rounded-2xl bg-sage-soft text-forest-deep dark:bg-secondary/40 dark:text-primary">
                      <s.icon className="size-5" aria-hidden />
                      <span className="absolute -start-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-forest-deep text-[10px] font-extrabold text-primary-foreground dark:bg-primary dark:text-primary-foreground">
                        {num(i + 1)}
                      </span>
                    </span>
                    <p className="font-extrabold">{tx(s.fa, s.en)}</p>
                  </div>
                  <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">{tx(s.descFa, s.descEn)}</p>
                </motion.div>
                {i < STEPS.length - 1 && (
                  <div aria-hidden className="flex items-center justify-center lg:w-10">
                    <span className="h-5 border-s-2 border-dashed border-primary/30 lg:h-0.5 lg:w-full lg:border-s-0 lg:border-t-2" />
                  </div>
                )}
              </Fragment>
            ))}
          </StaggerGroup>
        </section>

        {/* ── 4) species grid ── */}
        <section ref={speciesRef} aria-labelledby="mh-species" className="scroll-mt-24 space-y-4">
          <SectionHeader
            icon={Microscope}
            titleFa="گونه‌های قارچی"
            titleEn="Mushroom species"
            subFa="از دانشنامه‌ی زنده‌ی پلنت‌ورس"
            subEn="From the living PlantVerse encyclopedia"
          >
            <div className="flex items-center gap-2">
              {species && (
                <span className="rounded-full bg-sage-soft px-2.5 py-1 text-[11px] font-bold text-forest-deep dark:bg-secondary/40 dark:text-primary">
                  {num(species.length)} {tx("گونه", "species")}
                </span>
              )}
              <button
                onClick={() => navigate("encyclopedia", { category: "mushroom" })}
                className="rounded-full border border-border px-3.5 py-1.5 text-xs font-bold transition-colors hover:bg-sage-soft/60 dark:hover:bg-secondary/40"
              >
                {tx("مشاهده همه", "View all")}
              </button>
            </div>
          </SectionHeader>

          {species === null ? (
            <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="rounded-3xl border border-border/60 bg-card p-3.5">
                  <Skeleton className="aspect-[4/3] w-full rounded-2xl" />
                  <Skeleton className="mt-3 h-4 w-3/4 rounded-full" />
                  <Skeleton className="mt-2 h-3 w-1/2 rounded-full" />
                </div>
              ))}
            </div>
          ) : species.length === 0 ? (
            <p className="rounded-3xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              {tx("به‌زودی گونه‌های بیشتری اضافه می‌شود 🍄", "More species coming soon 🍄")}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
              {species.map((p, i) => (
                <PlantCard key={p.slug} plant={p} index={i} />
              ))}
            </div>
          )}
        </section>

        {/* ── 5) safety warning ── */}
        <section className="mx-auto">
          <div
            role="alert"
            className="flex items-start gap-3 rounded-3xl border border-amber-500/40 bg-amber-500/10 p-4 sm:p-5"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="size-5" aria-hidden />
            </span>
            <div>
              <p className="font-extrabold text-amber-800 dark:text-amber-300">
                {tx("هرگز قارچ‌های وحشی را نخورید!", "Never eat wild mushrooms!")}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-amber-800/80 dark:text-amber-200/80">
                {tx(
                  "مصرف قارچ‌های ناشناخته بدون تأیید کارشناس می‌تواند کشنده باشد؛ گونه‌های سمی شباهت شگفت‌انگیزی به گونه‌های خوراکی دارند. فقط از منابع معتبر و کیت‌های آزموده خرید کنید.",
                  "Eating unknown mushrooms without expert verification can be deadly — toxic species mimic edible ones with uncanny accuracy. Buy only from trusted sources and tested kits."
                )}
              </p>
            </div>
          </div>
        </section>

        {/* ── 6) medicinal benefits mini-grid ── */}
        <section aria-labelledby="mh-benefits" className="space-y-4">
          <SectionHeader
            icon={HeartPulse}
            titleFa="خواص دارویی قارچ‌ها"
            titleEn="Medicinal benefits"
            subFa="چهار ستون سلامتی از دل خاک"
            subEn="Four pillars of health from the soil"
          />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
            {BENEFITS.map((b, i) => (
              <motion.div
                key={b.en}
                initial={{ opacity: 0, y: 18 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-40px" }}
                transition={{ delay: i * 0.07, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                className="flex flex-col items-center gap-1.5 rounded-3xl border border-border/60 bg-card p-4 text-center shadow-sm"
              >
                <span className="grid size-11 place-items-center rounded-2xl bg-sage-soft text-forest-deep dark:bg-secondary/40 dark:text-primary">
                  <b.icon className="size-5" aria-hidden />
                </span>
                <p className="text-sm font-extrabold">{tx(b.fa, b.en)}</p>
                <p className="text-[11px] text-muted-foreground">{tx(b.subFa, b.subEn)}</p>
              </motion.div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
