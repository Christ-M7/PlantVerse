"use client";

/**
 * PlantVerse — plant comparison dialog («مقایسه گیاهان»). 
 *
 * Modal overlay in the same mold as the R46 dialog family: receives 2-3
 * resolved plants from the encyclopedia's compare selection and renders a
 * side-by-side attribute table — identity header (image + bilingual name +
 * scientific name + jump to detail) over shared attribute rows (category,
 * difficulty, care level, light, water, humidity, temperature range,
 * toxicity, seasons). Rows where the selected plants differ carry a
 * subtle difference marker so the eye lands on the decision-relevant
 * divergences first.
 *
 * Focus management via useDialogFocus (initial focus → data-autofocus
 * close button, Tab trapped, focus restored on close) — Escape handled
 * locally, same split as the dialog family.
 */

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import Image from "next/image";
import { useDialogFocus } from "@/hooks/use-dialog-focus";
import {
  ChevronLeft,
  Droplets,
  FlaskConical,
  Leaf,
  Ruler,
  Scale,
  Sun,
  Thermometer,
  TriangleAlert,
  X,
} from "lucide-react";
import { useLang } from "@/lib/i18n/use-lang";
import { useAppStore } from "@/lib/store/app-store";
import { CATEGORY_META, DIFFICULTY_META, type PlantFixture } from "@/data/fixtures";
import { cn } from "@/lib/utils";

/* attribute copy — shared vocabulary from fixtures (category/difficulty)
   plus the same low/medium/high maps the encyclopedia filters use */
const LIGHT_FA_EN: Record<string, { fa: string; en: string }> = {
  low: { fa: "نور کم", en: "Low light" },
  medium: { fa: "نور متوسط", en: "Medium light" },
  bright_indirect: { fa: "نور غیرمستقیم", en: "Bright indirect" },
  direct: { fa: "نور مستقیم", en: "Direct sun" },
};
const WATER_FA_EN: Record<string, { fa: string; en: string }> = {
  low: { fa: "کم", en: "Low" },
  medium: { fa: "متوسط", en: "Medium" },
  high: { fa: "زیاد", en: "High" },
};
const HUMIDITY_FA_EN = WATER_FA_EN; // same low/medium/high vocabulary
const TOX_FA_EN: Record<string, { fa: string; en: string; cls: string }> = {
  safe: { fa: "بی‌خطر", en: "Safe", cls: "text-emerald-600 dark:text-emerald-400" },
  mild: { fa: "ملایم", en: "Mild", cls: "text-amber-600 dark:text-amber-400" },
  toxic: { fa: "سمی", en: "Toxic", cls: "text-terracotta" },
};
const SEASON_FA_EN: Record<string, { fa: string; en: string }> = {
  spring: { fa: "بهار", en: "Spring" },
  summer: { fa: "تابستان", en: "Summer" },
  autumn: { fa: "پاییز", en: "Autumn" },
  winter: { fa: "زمستان", en: "Winter" },
};

type RowKey = "category" | "difficulty" | "careLevel" | "light" | "water" | "humidity" | "temp" | "toxicity" | "seasons";

interface CompareRow {
  key: RowKey;
  labelFa: string;
  labelEn: string;
  icon: typeof Leaf;
  /** localized cell text per plant */
  cell: (p: PlantFixture, ctx: Ctx) => string;
  /** optional tailwind class per plant (toxicity coloring) */
  cls?: (p: PlantFixture) => string | undefined;
}

interface Ctx {
  num: (n: number | string) => string;
  tx: (fa: string, en: string) => string;
}

const ROWS: CompareRow[] = [
  {
    key: "category", labelFa: "دسته", labelEn: "Category", icon: Leaf,
    cell: (p, { tx }) => {
      const c = CATEGORY_META[p.category];
      return c ? tx(c.fa, c.en) : p.category;
    },
  },
  {
    key: "difficulty", labelFa: "سطح سختی", labelEn: "Difficulty", icon: Scale,
    cell: (p, { tx }) => tx(DIFFICULTY_META[p.difficulty].fa, DIFFICULTY_META[p.difficulty].en),
    cls: (p) => DIFFICULTY_META[p.difficulty].color,
  },
  {
    key: "careLevel", labelFa: "سطح مراقبت", labelEn: "Care level", icon: FlaskConical,
    cell: (p, { num }) => `${num(p.careLevel)} / ${num(5)}`,
  },
  {
    key: "light", labelFa: "نیاز نوری", labelEn: "Light needs", icon: Sun,
    cell: (p, { tx }) => {
      const l = LIGHT_FA_EN[p.light];
      return l ? tx(l.fa, l.en) : p.light;
    },
  },
  {
    key: "water", labelFa: "آبیاری", labelEn: "Watering", icon: Droplets,
    cell: (p, { tx }) => {
      const w = WATER_FA_EN[p.water];
      return w ? tx(w.fa, w.en) : p.water;
    },
  },
  {
    key: "humidity", labelFa: "رطوبت", labelEn: "Humidity", icon: Droplets,
    cell: (p, { tx }) => {
      const h = HUMIDITY_FA_EN[p.humidity];
      return h ? tx(h.fa, h.en) : p.humidity;
    },
  },
  {
    key: "temp", labelFa: "دمای مناسب", labelEn: "Temperature", icon: Thermometer,
    cell: (p, { num }) => `${num(p.tempMin)}–${num(p.tempMax)}°C`,
  },
  {
    key: "toxicity", labelFa: "سمیت", labelEn: "Toxicity", icon: TriangleAlert,
    cell: (p, { tx }) => {
      const t = TOX_FA_EN[p.toxicity];
      return t ? tx(t.fa, t.en) : p.toxicity;
    },
    cls: (p) => TOX_FA_EN[p.toxicity]?.cls,
  },
  {
    key: "seasons", labelFa: "فصل‌ها", labelEn: "Seasons", icon: Ruler,
    cell: (p, { tx }) => {
      const names = p.seasons
        .map((s) => SEASON_FA_EN[s])
        .filter(Boolean)
        .map((s) => tx(s.fa, s.en));
      return names.length > 0 ? names.join("، ") : "—";
    },
  },
];

export function PlantCompareDialog({
  open,
  plants,
  onClose,
}: {
  open: boolean;
  plants: PlantFixture[];
  onClose: () => void;
}) {
  const { tx, num } = useLang();
  const navigate = useAppStore((s) => s.navigate);
  const dialogRef = useRef<HTMLElement>(null);
  useDialogFocus(open, dialogRef);
  const ctx: Ctx = { num, tx };

  /* Escape closes the dialog (focus housekeeping lives in useDialogFocus) */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (plants.length < 2) return null;

  /** a row "differs" when the selected plants don't agree on it — the
      marker directs attention to decision-relevant divergences */
  const differs = (key: RowKey) => {
    const row = ROWS.find((r) => r.key === key);
    if (!row) return false;
    const values = plants.map((p) => row.cell(p, ctx));
    return new Set(values).size > 1;
  };

  return (
    createPortal(
      <AnimatePresence>
        {open && (
          <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[70] bg-black/55 backdrop-blur-[2px]"
            aria-hidden
          />
          <motion.section
            initial={{ opacity: 0, y: 60, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 40, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 260, damping: 28 }}
            role="dialog"
            aria-modal="true"
            aria-label={tx("مقایسه گیاهان", "Plant comparison")}
            ref={dialogRef}
            tabIndex={-1}
            className="fixed inset-x-3 top-[4vh] z-[75] mx-auto flex max-h-[88vh] max-w-3xl flex-col overflow-hidden rounded-3xl border border-border/60 bg-card shadow-2xl shadow-forest/20 sm:inset-x-6"
          >
            {/* header */}
            <header className="flex items-center gap-3 border-b border-border/50 px-5 py-4">
              <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-forest-deep shadow-md shadow-forest/25 dark:bg-primary">
                <Scale className="size-5 text-primary-foreground" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-black leading-tight">{tx("مقایسه گیاهان", "Plant comparison")}</h2>
                <p className="text-[11px] text-muted-foreground">
                  {num(plants.length)} {tx("گیاه در مقایسه", "plants compared")}
                </p>
              </div>
              <button onClick={onClose} aria-label={tx("بستن", "Close")} data-autofocus className="grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted">
                <X className="size-5" />
              </button>
            </header>

            <div className="pv-scroll flex-1 overflow-auto">
              <table className="w-full min-w-[560px] border-collapse text-sm">
                <caption className="sr-only">
                  {tx("جدول مقایسه ویژگی‌های گیاهان انتخاب‌شده", "Attribute table for the selected plants")}
                </caption>
                {/* identity header row */}
                <thead>
                  <tr>
                    <th scope="col" className="sticky start-0 z-10 w-[130px] bg-card border-b border-border/50 p-3 text-start align-bottom">
                      <span className="text-[11px] font-black uppercase tracking-wide text-muted-foreground">
                        {tx("ویژگی", "Attribute")}
                      </span>
                    </th>
                    {plants.map((p) => (
                      <th key={p.slug} scope="col" className="border-b border-border/50 p-3 text-start align-bottom min-w-[170px]">
                        <div className="flex items-center gap-3">
                          <span className="relative size-14 shrink-0 overflow-hidden rounded-2xl bg-muted">
                            <Image src={p.image} alt={tx(p.nameFa, p.nameEn)} fill sizes="56px" className="object-cover" />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-black">{tx(p.nameFa, p.nameEn)}</span>
                            <span className="block truncate text-[11px] italic text-muted-foreground">{p.scientificName}</span>
                            <button
                              type="button"
                              onClick={() => { onClose(); navigate("plant", { slug: p.slug }); }}
                              className="mt-1 flex items-center gap-0.5 text-[11px] font-bold text-primary hover:underline"
                            >
                              {tx("مشاهده", "View")}
                              <ChevronLeft className="size-3 rtl:rotate-180" aria-hidden />
                            </button>
                          </span>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                {/* attribute rows */}
                <tbody>
                  {ROWS.map((row) => {
                    const Icon = row.icon;
                    const diff = differs(row.key);
                    return (
                      <tr key={row.key} className={cn(diff && "bg-sage-soft/40 dark:bg-secondary/30")}>
                        <th scope="row" className="sticky start-0 z-10 bg-card p-3 text-start align-middle">
                          <span className="flex items-center gap-2 text-[13px] font-bold">
                            <Icon className="size-4 shrink-0 text-primary" aria-hidden />
                            {tx(row.labelFa, row.labelEn)}
                          </span>
                          {diff && (
                            <span className="mt-0.5 block text-[10px] font-medium text-primary">
                              {tx("متفاوت", "differs")}
                            </span>
                          )}
                        </th>
                        {plants.map((p) => (
                          <td key={p.slug} className="border-s border-border/40 p-3 align-middle">
                            <span className={cn("text-[13px] font-medium", row.cls?.(p) && "inline-block rounded-full px-2 py-0.5", row.cls?.(p))}>
                              {row.cell(p, ctx)}
                            </span>
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </motion.section>
          </>
        )}
      </AnimatePresence>,
      document.body
    )
  );
}
