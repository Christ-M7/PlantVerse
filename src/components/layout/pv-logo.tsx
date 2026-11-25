"use client";

import { motion } from "framer-motion";
import { Leaf } from "lucide-react";
import { useAppStore } from "@/lib/store/app-store";
import { useLang } from "@/lib/i18n/use-lang";

/** PlantVerse logo mark — leaf inside dark-green rounded square */
export function PvLogo({ size = 44, withText = true, light = false }: { size?: number; withText?: boolean; light?: boolean }) {
  const { tx } = useLang();
  const navigate = useAppStore((s) => s.navigate);
  return (
    <button
      onClick={() => navigate("home")}
      className="flex items-center gap-3 group outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-2xl"
      aria-label={tx("صفحه اصلی جهان‌گیاه", "PlantVerse home")}
    >
      <motion.span
        whileHover={{ rotate: -8, scale: 1.06 }}
        transition={{ type: "spring", stiffness: 300, damping: 15 }}
        className={`inline-flex items-center justify-center rounded-2xl shadow-md shadow-forest/30 ${light ? "bg-primary" : "bg-forest-deep dark:bg-primary"}`}
        style={{ width: size, height: size }}
      >
        <Leaf className="text-primary-foreground" style={{ width: size * 0.52, height: size * 0.52 }} strokeWidth={2.2} />
      </motion.span>
      {withText && (
        <span className="flex flex-col items-start leading-none gap-1">
          <span className={`font-extrabold tracking-tight ${light ? "text-primary-foreground" : "text-foreground"} text-xl`}>
            Plant<span className="text-primary">Verse</span>
          </span>
          <span className={`text-[11px] font-medium ${light ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
            • {tx("جهان گیاه", "The World of Plants")} •
          </span>
        </span>
      )}
    </button>
  );
}
