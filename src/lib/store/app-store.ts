"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { NotificationMuteGroup } from "@/lib/notifications";
import { QUIET_DEFAULT_END, QUIET_DEFAULT_START, normalizeQuietMinutes } from "@/lib/quiet-hours";

export type View =
  | "home"
  | "encyclopedia"
  | "plant"
  | "scanner"
  | "garden"
  | "reminders"
  | "community"
  | "shop"
  | "magazine"
  | "article"
  | "profile"
  | "greenhouse"
  | "mushrooms";

export interface NavigateParams {
  slug?: string;
  category?: string;
  query?: string;
  tab?: string;
}

interface AppState {
  view: View;
  history: View[];
  slug: string | undefined;
  category: string | undefined;
  query: string | undefined;
  /** monotonically-increasing counter bumped on every navigate — lets a
      mounted view re-arm its deep-link handlers when the SAME params
      arrive again (e.g. re-tapping an order notification) */
  navSeq: number;
  lang: "fa" | "en";
  /** digest dials — notification groups silenced in the bell menu;
      persisted per-browser and honored server-side via ?muted= */
  mutedNotifGroups: NotificationMuteGroup[];
  /** «سکوت شبانه» — while the clock sits inside [quietStart, quietEnd)
      the bell defers its badge until morning (feed stays openable);
      minutes-from-midnight, persisted per-browser, client-enforced */
  quietHoursEnabled: boolean;
  quietStart: number;
  quietEnd: number;
  setQuietHours: (enabled: boolean, start?: number, end?: number) => void;
  chatOpen: boolean;
  toast: string | null;
  /** optional one-click undo handle rendered inside the active toast
      («واگرد») — e.g. restore the auto-snapshot taken before a wipe */
  toastAction: { labelFa: string; labelEn: string; run: () => void } | null;
  navigate: (view: View, params?: NavigateParams) => void;
  /** Pop the most recent entry from the view history (full-screen overlays use this). */
  goBack: (fallback?: View) => void;
  setLang: (lang: "fa" | "en") => void;
  toggleLang: () => void;
  /** flip one digest dial on/off (group muted = its kinds filtered out) */
  toggleNotifGroup: (group: NotificationMuteGroup) => void;
  setChatOpen: (open: boolean) => void;
  /** «؟» cheat-sheet dialog — global; opened by the hotkey or Profile → Settings */
  shortcutsOpen: boolean;
  setShortcutsOpen: (open: boolean) => void;
  showToast: (message: string | null, action?: { labelFa: string; labelEn: string; run: () => void }) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      view: "home",
      history: [],
      slug: undefined,
      category: undefined,
      query: undefined,
      navSeq: 0,
      lang: "fa",
      mutedNotifGroups: [],
      quietHoursEnabled: false,
      quietStart: QUIET_DEFAULT_START,
      quietEnd: QUIET_DEFAULT_END,
      chatOpen: false,
      shortcutsOpen: false,
      toast: null,
      toastAction: null,
      navigate: (view, params) => {
        if (typeof window !== "undefined") {
          window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
        }
        set({
          view,
          slug: params?.slug,
          category: params?.category,
          query: params?.query,
          navSeq: get().navSeq + 1,
          history: [...get().history, get().view].slice(-20),
        });
      },
      goBack: (fallback = "home") => {
        const { history } = get();
        if (history.length === 0) {
          set({ view: fallback, slug: undefined, category: undefined, query: undefined });
          return;
        }
        const prev = history[history.length - 1];
        set({
          view: prev,
          slug: undefined,
          category: undefined,
          query: undefined,
          history: history.slice(0, -1),
        });
        if (typeof window !== "undefined") {
          window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
        }
      },
      setLang: (lang) => {
        set({ lang });
        if (typeof window !== "undefined") {
          document.documentElement.lang = lang;
          document.documentElement.dir = lang === "fa" ? "rtl" : "ltr";
        }
      },
      toggleLang: () => {
        const next = get().lang === "fa" ? "en" : "fa";
        get().setLang(next);
      },
      toggleNotifGroup: (group) => {
        const cur = get().mutedNotifGroups;
        set({
          mutedNotifGroups: cur.includes(group) ? cur.filter((g) => g !== group) : [...cur, group],
        });
      },
      setQuietHours: (enabled, start, end) =>
        set({
          quietHoursEnabled: enabled,
          ...(start !== undefined ? { quietStart: normalizeQuietMinutes(start) } : {}),
          ...(end !== undefined ? { quietEnd: normalizeQuietMinutes(end) } : {}),
        }),
      setChatOpen: (open) => set({ chatOpen: open }),
      setShortcutsOpen: (open) => set({ shortcutsOpen: open }),
      showToast: (message, action) => set({ toast: message, toastAction: message ? (action ?? null) : null }),
    }),
    {
      name: "plantverse-app",
      partialize: (state) =>
        ({
          lang: state.lang,
          mutedNotifGroups: state.mutedNotifGroups,
          quietHoursEnabled: state.quietHoursEnabled,
          quietStart: state.quietStart,
          quietEnd: state.quietEnd,
        }) as unknown as AppState,
    }
  )
);
