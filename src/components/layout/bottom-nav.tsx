"use client";

import { motion } from "framer-motion";
import { Home, Leaf, Camera, Bell, Users, ShoppingBag } from "lucide-react";
import { useAppStore, type View } from "@/lib/store/app-store";
import { useLang } from "@/lib/i18n/use-lang";

const items: { view: View; icon: typeof Home; fa: string; en: string }[] = [
  { view: "home", icon: Home, fa: "خانه", en: "Home" },
  { view: "garden", icon: Leaf, fa: "گیاهان من", en: "My Garden" },
  { view: "scanner", icon: Camera, fa: "اسکن گیاه", en: "Scan" },
  { view: "reminders", icon: Bell, fa: "یادآوری‌ها", en: "Reminders" },
  { view: "community", icon: Users, fa: "انجمن", en: "Community" },
  { view: "shop", icon: ShoppingBag, fa: "فروشگاه", en: "Shop" },
];

export function BottomNav() {
  const view = useAppStore((s) => s.view);
  const navigate = useAppStore((s) => s.navigate);
  const { tx } = useLang();

  return (
    <motion.nav
      initial={{ y: 90, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay: 0.35, type: "spring", stiffness: 120, damping: 18 }}
      aria-label={tx("ناوبری اصلی", "Primary")}
      className="fixed bottom-4 inset-x-0 z-40 flex justify-center px-3 sm:px-6"
    >
      <div className="pv-glass w-full max-w-3xl rounded-[2rem] border border-border/60 bg-card/80 shadow-2xl shadow-forest/20 dark:shadow-black/40 px-3 py-2.5 grid grid-cols-6 gap-1">
        {items.map(({ view: v, icon: Icon, fa, en }) => {
          const active = view === v || (v === "garden" && view === "profile") || (v === "home" && (view === "magazine" || view === "greenhouse" || view === "mushrooms"));
          return (
            <button
              key={v}
              onClick={() => navigate(v)}
              aria-current={active ? "page" : undefined}
              className={`relative flex flex-col items-center justify-center gap-1 rounded-2xl py-2 text-[11px] font-medium transition-colors min-h-11 ${
                active ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {active && (
                <motion.span
                  layoutId="pv-bottomnav-pill"
                  className="absolute inset-0 rounded-2xl bg-primary shadow-lg shadow-primary/30"
                  transition={{ type: "spring", stiffness: 300, damping: 26 }}
                />
              )}
              <Icon className="relative z-10 size-5" strokeWidth={active ? 2.2 : 1.8} />
              <span className="relative z-10 whitespace-nowrap">{tx(fa, en)}</span>
            </button>
          );
        })}
      </div>
    </motion.nav>
  );
}
