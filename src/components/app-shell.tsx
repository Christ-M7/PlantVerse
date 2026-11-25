"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";
import { DirectionProvider } from "@radix-ui/react-direction";
import { useAppStore } from "@/lib/store/app-store";
import { useLang } from "@/lib/i18n/use-lang";
import { matchShortcut, shouldIgnoreShortcut } from "@/lib/keyboard-map";
import { KeyboardShortcutsDialog } from "@/components/layout/keyboard-shortcuts-dialog";
import { FloatingLeaves } from "@/components/fx/floating-leaves";
import { BottomNav } from "@/components/layout/bottom-nav";
import { ChatWidget } from "@/components/layout/chat-widget";
import { NotificationCenter } from "@/components/layout/notification-center";
import { HomeView } from "@/components/home/home-view";
import { EncyclopediaView } from "@/components/encyclopedia/encyclopedia-view";
import { SharedListImportProbe } from "@/components/share/shared-import-probe";
import { PostLinkProbe } from "@/components/share/post-link-probe";
import { ArticleLinkProbe } from "@/components/share/article-link-probe";
import dynamic from "next/dynamic";

/* Code-split every below-first-paint view: the single-route shell used to
   statically pull all 13 views (plus recharts and socket.io-client) into one
   client bundle. Home (landing) and Encyclopedia (home-search target) stay
   eager so navigation feels instant; the rest load on demand with a tiny
   leaf spinner that fills the AnimatePresence slot. */
function ViewFallback() {
  return (
    <div className="flex-1 flex items-center justify-center py-32" role="status" aria-live="polite">
      <span className="size-9 rounded-full border-[3px] border-primary/25 border-t-primary animate-spin" aria-hidden />
      <span className="sr-only">Loading…</span>
    </div>
  );
}

const MagazineView = dynamic(
  () => import("@/components/community/magazine-view").then((m) => m.MagazineView),
  { ssr: false, loading: () => <ViewFallback /> }
);

const ArticleView = dynamic(
  () => import("@/components/community/article-view").then((m) => m.ArticleView),
  { ssr: false, loading: () => <ViewFallback /> }
);

const PlantDetailView = dynamic(
  () => import("@/components/plant/plant-detail-view").then((m) => m.PlantDetailView),
  { ssr: false, loading: () => <ViewFallback /> }
);
const ScannerView = dynamic(
  () => import("@/components/scanner/scanner-view").then((m) => m.ScannerView),
  { ssr: false, loading: () => <ViewFallback /> }
);
const GardenView = dynamic(
  () => import("@/components/garden/garden-view").then((m) => m.GardenView),
  { ssr: false, loading: () => <ViewFallback /> }
);
const RemindersView = dynamic(
  () => import("@/components/reminders/reminders-view").then((m) => m.RemindersView),
  { ssr: false, loading: () => <ViewFallback /> }
);
const CommunityView = dynamic(
  () => import("@/components/community/community-view").then((m) => m.CommunityView),
  { ssr: false, loading: () => <ViewFallback /> }
);
const ShopView = dynamic(
  () => import("@/components/shop/shop-view").then((m) => m.ShopView),
  { ssr: false, loading: () => <ViewFallback /> }
);
const ProfileView = dynamic(
  () => import("@/components/profile/profile-view").then((m) => m.ProfileView),
  { ssr: false, loading: () => <ViewFallback /> }
);
const GreenhouseView = dynamic(
  () => import("@/components/greenhouse/greenhouse-view").then((m) => m.GreenhouseView),
  { ssr: false, loading: () => <ViewFallback /> }
);
const MushroomView = dynamic(
  () => import("@/components/mushroom/mushroom-view").then((m) => m.MushroomView),
  { ssr: false, loading: () => <ViewFallback /> }
);

const viewMotion = {
  initial: { opacity: 0, y: 24, filter: "blur(6px)" },
  animate: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    /* drop the filter once settled: any non-none filter makes <main> a
       containing block for fixed descendants and a stacking context, which
       traps in-view modals (z-75) under the bottom nav (z-40) */
    transitionEnd: { filter: "none" },
  },
  exit: { opacity: 0, y: -16, filter: "blur(6px)" },
  transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] as const },
};

export function AppShell() {
  const view = useAppStore((s) => s.view);
  const slug = useAppStore((s) => s.slug);
  const category = useAppStore((s) => s.category);
  const query = useAppStore((s) => s.query);
  const lang = useAppStore((s) => s.lang);
  const toast = useAppStore((s) => s.toast);
  const toastAction = useAppStore((s) => s.toastAction);
  const showToast = useAppStore((s) => s.showToast);
  const navigate = useAppStore((s) => s.navigate);
  const setShortcutsOpen = useAppStore((s) => s.setShortcutsOpen);
  const { tx } = useLang();

  // keep document dir in sync on first hydration
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "fa" ? "rtl" : "ltr";
  }, [lang]);

  // auto-dismiss toast — undoable actions get a longer window so the
  // one-click undo is actually reachable (a 2.6 s undo is a trap)
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => showToast(null), toastAction ? 8000 : 2600);
    return () => clearTimeout(t);
  }, [toast, toastAction, showToast]);

  /* Focus-mode single-key navigation («کلیدهای میان‌بر») — one physical key
     jumps straight to a view; «؟» opens the cheat-sheet. Suppressed while
     typing (pure guard), while any modal owns the keyboard (Radix renders
     role="dialog"), and for every modifier combo — browser/OS shortcuts win. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const target = e.target;
      if (
        target instanceof HTMLElement &&
        (target.closest('[role="dialog"]') !== null || target.closest('[role="alertdialog"]') !== null)
      ) {
        return;
      }
      if (shouldIgnoreShortcut(target, e)) return;
      const def = matchShortcut(e.key);
      if (!def) return;
      e.preventDefault();
      if (def.view) navigate(def.view);
      else setShortcutsOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, setShortcutsOpen]);

  return (
    <DirectionProvider dir={lang === "fa" ? "rtl" : "ltr"}>
    <div className="min-h-screen flex flex-col bg-background text-foreground overflow-x-clip">
      {/* skip-link — first focusable element on every view (a11y) */}
      <a
        href="#pv-main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:start-3 focus:z-[120] focus:rounded-full focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:text-primary-foreground focus:shadow-lg"
      >
        {tx("پرش به محتوای اصلی", "Skip to main content")}
      </a>
      <AnimatePresence mode="wait">
        <motion.main key={view + (slug ?? "") + (category ?? "")} {...viewMotion} id="pv-main" tabIndex={-1} className="flex-1 flex flex-col relative z-10 outline-none">
          {view === "home" && <HomeView />}
          {view === "encyclopedia" && <EncyclopediaView initialCategory={category} initialQuery={query} />}
          {view === "plant" && <PlantDetailView slug={slug} />}
          {view === "scanner" && <ScannerView />}
          {view === "garden" && <GardenView />}
          {view === "reminders" && <RemindersView />}
          {view === "community" && <CommunityView />}
          {view === "shop" && <ShopView deepOrderCode={slug} />}
          {view === "magazine" && <MagazineView />}
          {view === "article" && <ArticleView key={slug ?? ""} slug={slug} />}
          {view === "profile" && <ProfileView />}
          {view === "greenhouse" && <GreenhouseView />}
          {view === "mushrooms" && <MushroomView />}
        </motion.main>
      </AnimatePresence>

      {view !== "scanner" && <BottomNav />}

      {/* Ambient nature particles — hidden on scanner which has its own FX */}
      {view !== "scanner" && <FloatingLeaves count={6} />}

      <ChatWidget />

      {/* Central notification hub — floating bell, start corner */}
      <NotificationCenter />

      {/* «؟» cheat-sheet — keyboard shortcuts guide (hotkey or Profile → Settings) */}
      <KeyboardShortcutsDialog />

      {/* ?shared=CODE importer — works from any view */}
      <SharedListImportProbe />

      {/* ?post=ID deep link — community feed highlight */}
      <PostLinkProbe />

      {/* ?article=SLUG deep link — article share button target */}
      <ArticleLinkProbe />

      {/* Elegant toast — with an optional one-click undo action */}
      {/* Screen-reader mirror of the toast — the animated pill is pointer/
          visual-only, this persistent live region announces the message */}
      <span role="status" aria-live="polite" className="sr-only">
        {toast ?? ""}
      </span>

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 30, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="fixed bottom-24 inset-x-0 z-[90] flex justify-center px-4 pointer-events-none"
          >
            <div className="pointer-events-auto rounded-full bg-forest-deep dark:bg-primary text-primary-foreground dark:text-primary-foreground ps-5 pe-2.5 py-2.5 text-sm shadow-xl shadow-black/20 flex items-center gap-3">
              <span className="flex items-center gap-2">
                <svg viewBox="0 0 24 24" className="size-4" fill="currentColor"><path d="M12 2C7 5 3 9 4 15c.6 3.4 3 6 8 7 5-1 7.4-3.6 8-7 1-6-3-10-8-13z" /></svg>
                {toast}
              </span>
              {toastAction && (
                <button
                  type="button"
                  data-testid="toast-action"
                  onClick={() => {
                    showToast(null);
                    toastAction.run();
                  }}
                  className="rounded-full bg-primary-foreground/15 px-3 py-1.5 text-xs font-black underline-offset-2 transition-colors hover:bg-primary-foreground/25 hover:underline"
                >
                  {tx(toastAction.labelFa, toastAction.labelEn)}
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <span className="sr-only">{tx("پلتفرم جامع گیاهان جهان‌گیاه", "PlantVerse plant platform")}</span>
    </div>
    </DirectionProvider>
  );
}
