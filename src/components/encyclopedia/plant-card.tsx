"use client";

import { motion } from "framer-motion";
import Image from "next/image";
import { Check, Heart, Plus } from "lucide-react";
import { useAppStore } from "@/lib/store/app-store";
import { useLang } from "@/lib/i18n/use-lang";
import { DIFFICULTY_META, type PlantFixture } from "@/data/fixtures";
import { useState } from "react";

/** Same storage contract as the plant-detail heart (pv-favs) so both
    surfaces agree — the old card heart was ephemeral local state wiped by
    every layout/filter remount. */
function readFav(slug: string): boolean {
  try {
    return (JSON.parse(localStorage.getItem("pv-favs") ?? "[]") as string[]).includes(slug);
  } catch {
    return false;
  }
}

function writeFav(slug: string, next: boolean) {
  try {
    const favs: string[] = JSON.parse(localStorage.getItem("pv-favs") ?? "[]");
    const list = next ? [...new Set([...favs, slug])] : favs.filter((x) => x !== slug);
    localStorage.setItem("pv-favs", JSON.stringify(list));
  } catch { /* private mode */ }
}

export function PlantCard({ plant, index = 0, compareMode = false, compareSelected = false, onToggleCompare }: {
  plant: PlantFixture; index?: number;
  compareMode?: boolean; compareSelected?: boolean; onToggleCompare?: () => void;
}) {
  const navigate = useAppStore((s) => s.navigate);
  const { tx } = useLang();
  const [fav, setFav] = useState(() => readFav(plant.slug));
  const d = DIFFICULTY_META[plant.difficulty];

  const toggleFav = () => {
    const next = !fav;
    setFav(next);
    writeFav(plant.slug, next);
  };

  return (
    /* real <button> heart sits as a SIBLING of the card button — the old
       role="button" span was nested inside the card's own <button>, which is
       invalid ARIA and dropped by some screen readers */
    <div className="relative group">
      <motion.button
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-30px" }}
        transition={{ delay: (index % 6) * 0.05, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        whileHover={{ y: -6 }}
        onClick={() => navigate("plant", { slug: plant.slug })}
        className="block w-full text-start rounded-3xl bg-card border border-border/70 overflow-hidden shadow-sm hover:shadow-xl hover:shadow-forest/10 hover:border-primary/40 transition-all focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={tx(plant.nameFa, plant.nameEn)}
      >
        <div className="relative aspect-[4/3] overflow-hidden bg-muted">
          <Image
            src={plant.image}
            alt={tx(plant.nameFa, plant.nameEn)}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            className="object-cover transition-transform duration-700 group-hover:scale-110"
          />
          <span className="absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-black/25 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
        <div className="p-3.5 sm:p-4 space-y-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-bold text-sm sm:text-[15px] truncate">{tx(plant.nameFa, plant.nameEn)}</p>
              <p className="text-xs text-muted-foreground italic truncate">{plant.scientificName}</p>
            </div>
          </div>
          <span className={`inline-block mt-1 text-[11px] font-bold rounded-full px-2.5 py-0.5 ${d.color}`}>
            {tx(d.fa, d.en)}
          </span>
        </div>
      </motion.button>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); toggleFav(); }}
        aria-pressed={fav}
        aria-label={fav ? tx("حذف از علاقه‌مندی‌ها", "Remove from favorites") : tx("افزودن به علاقه‌مندی‌ها", "Add to favorites")}
        className="absolute top-2.5 end-2.5 z-10 size-8 grid place-items-center rounded-full bg-black/30 backdrop-blur-sm text-white hover:bg-black/50 focus-visible:ring-2 focus-visible:ring-ring transition-colors"
      >
        <Heart className={`size-4.5 transition-all ${fav ? "fill-terracotta text-terracotta scale-110" : ""}`} />
      </button>
      {compareMode && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleCompare?.(); }}
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
          {compareSelected ? <Check className="size-4" aria-hidden /> : <Plus className="size-4" aria-hidden />}
        </button>
      )}
    </div>
  );
}
