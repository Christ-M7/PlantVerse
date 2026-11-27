"use client";

/**
 * PlantVerse — NotificationCenter («مرکز اعلان‌ها»). 
 *
 * A floating bell FAB mirrored against the chat launcher (chat sits at
 * the "end" corner, notifications at the "start" corner) aggregating
 * every actionable signal in the app through GET /api/notifications.
 *
 * - Badge counts unseen urgent + upcoming items ("seen" set persisted in
 *   localStorage under plantverse-notifs-seen, capped; the all-clear
 *   info item never counts toward the badge).
 * - Feed refreshes on mount, every 60 s, and on open.
 * - Tapping an item deep-navigates to its view (garden / reminders /
 *   greenhouse / profile-orders) and marks it seen.
 */

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlarmClock,
  ArrowLeft,
  Bell,
  BellRing,
  BookOpen,
  CalendarClock,
  CheckCheck,
  Droplets,
  HeartPulse,
  Leaf,
  MessagesSquare,
  Moon,
  RefreshCw,
  SlidersHorizontal,
  Thermometer,
  Truck,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAppStore } from "@/lib/store/app-store";
import { useLang } from "@/lib/i18n/use-lang";
import { useViewerKey } from "@/lib/viewer-key";
import { NOTIF_MUTE_GROUPS, type NotificationItem } from "@/lib/notifications";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HALF_HOUR_STEPS, describeQuietWindow, formatClock, isWithinQuietHours } from "@/lib/quiet-hours";
import {
  activeWindowEnd,
  captureDigestIds,
  digestSnapshotKey,
  isDismissalCurrent,
  isSnapshotStale,
  parseDigestSnapshot,
  resolveQuietDigest,
  type DigestDismissal,
  type DigestSnapshot,
} from "@/lib/notif-digest";
import { relativeTimeFa, relativeTimeEn } from "@/lib/relative-time";

const SEEN_KEY = "plantverse-notifs-seen";
const SEEN_CAP = 200;
const DIGEST_KEY = "plantverse-notifs-digest";

const NOTIF_ICON: Record<NotificationItem["icon"], LucideIcon> = {
  task: AlarmClock,
  water: Droplets,
  heart: HeartPulse,
  bell: CalendarClock,
  thermometer: Thermometer,
  truck: Truck,
  leaf: Leaf,
  book: BookOpen,
  message: MessagesSquare,
};

/** tone per severity — terracotta urgent, gold upcoming, sage info */
const SEVERITY_TONE: Record<NotificationItem["severity"], { chip: string; ring: string; dot: string }> = {
  urgent: {
    chip: "bg-terracotta/10 text-terracotta",
    ring: "border-terracotta/30 bg-terracotta/5",
    dot: "bg-terracotta",
  },
  upcoming: {
    chip: "bg-gold/10 text-gold",
    ring: "border-gold/30 bg-gold/5",
    dot: "bg-gold",
  },
  info: {
    chip: "bg-primary/10 text-primary",
    ring: "border-primary/20 bg-primary/5",
    dot: "bg-primary",
  },
};

function readSeen(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = JSON.parse(window.localStorage.getItem(SEEN_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeSeen(ids: string[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(ids.slice(-SEEN_CAP)));
  } catch {
    /* storage full / disabled — badge simply stays */
  }
}

function readDigest(): DigestSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    return parseDigestSnapshot(window.localStorage.getItem(DIGEST_KEY));
  } catch {
    return null;
  }
}

function writeDigest(snap: DigestSnapshot | null) {
  if (typeof window === "undefined") return;
  try {
    if (snap) window.localStorage.setItem(DIGEST_KEY, JSON.stringify(snap));
    else window.localStorage.removeItem(DIGEST_KEY);
  } catch {
    /* storage full / disabled — the card simply won't survive reloads */
  }
}

export function NotificationCenter() {
  const view = useAppStore((s) => s.view);
  const navigate = useAppStore((s) => s.navigate);
  const mutedNotifGroups = useAppStore((s) => s.mutedNotifGroups);
  const toggleNotifGroup = useAppStore((s) => s.toggleNotifGroup);
  const quietHoursEnabled = useAppStore((s) => s.quietHoursEnabled);
  const quietStart = useAppStore((s) => s.quietStart);
  const quietEnd = useAppStore((s) => s.quietEnd);
  const setQuietHours = useAppStore((s) => s.setQuietHours);
  const { tx, num, isFa, lang } = useLang();

  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [seen, setSeen] = useState<string[]>([]);
  const [now, setNow] = useState(() => Date.now());
  /* «خلاصهٔ شب گذشته» — the persisted capture of what waited through the
     quiet window; null during SSR / before hydration (house pattern) */
  const [digestSnap, setDigestSnap] = useState<DigestSnapshot | null>(null);
  /* viewer identity — scopes community signals to THIS browser ("" during
     SSR/first render, so the URL simply falls back to the legacy default) */
  const viewerKey = useViewerKey();

  /* digest dials → the ?muted= kind list (group off = its kinds silenced).
     MUST be memoized: a fresh array every render would rebuild fetchFeed,
     re-run the mount effect and start an endless fetch loop. */
  const mutedKinds = useMemo(
    () => NOTIF_MUTE_GROUPS.filter((g) => mutedNotifGroups.includes(g.id)).flatMap((g) => g.kinds),
    [mutedNotifGroups]
  );

  const fetchFeed = useCallback(
    (silent = false) => {
      if (!silent) {
        setLoading(true);
        setError(false);
      }
      const params = new URLSearchParams();
      if (viewerKey) params.set("viewer", viewerKey);
      if (mutedKinds.length) params.set("muted", mutedKinds.join(","));
      fetch(`/api/notifications${params.size ? `?${params}` : ""}`, { cache: "no-store" })
        .then((r) => r.json())
        .then(
          (d: { success?: boolean; items?: NotificationItem[] } | null) => {
            if (d?.success && Array.isArray(d.items)) {
              setItems(d.items);
              setError(false);
            } else {
              setError(true);
            }
          }
        )
        .catch(() => setError(true))
        .finally(() => setLoading(false));
    },
    [viewerKey, mutedKinds]
  );

  /* seen set + digest snapshot + first feed after hydration (deferred —
     house pattern), then a 60 s poll and a ticking clock for relative
     labels; re-runs once the viewer key lands so community items scope to
     the real browser identity, not the legacy default */
  useEffect(() => {
    const t = setTimeout(() => {
      setSeen(readSeen());
      setDigestSnap(readDigest());
      fetchFeed(true);
    }, 0);
    const poll = setInterval(() => fetchFeed(true), 60_000);
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      clearTimeout(t);
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [fetchFeed]);

  /* fresh fetch whenever the panel opens */
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) fetchFeed(true);
  };

  /* Escape closes the notification panel */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const unseenIds = items.filter((i) => !(i.severity === "info" && i.kind === "all-clear") && !seen.includes(i.id));
  const badgeCount = unseenIds.filter((i) => i.severity !== "info").length;
  const dotCount = unseenIds.length;

  /* «سکوت شبانه» — while enabled AND inside the window the bell sleeps:
     no badge, no dot; the feed stays fully openable (defer, not hide).
     Evaluated off the ticking 30 s clock so it flips on its own. */
  const quietActive = quietHoursEnabled && isWithinQuietHours(new Date(now), quietStart, quietEnd);
  const effBadgeCount = quietActive ? 0 : badgeCount;
  const effDotCount = quietActive ? 0 : dotCount;

  /* «خلاصهٔ شب گذشته» — join the persisted capture with the live feed:
     items still present AND still unseen become the briefing (lib-ruled). */
  const digest = useMemo(
    () => (digestSnap ? resolveQuietDigest(digestSnap, items, seen, new Date(now)) : null),
    [digestSnap, items, seen, now]
  );

  const clearDigest = useCallback(() => {
    setDigestSnap(null);
    writeDigest(null);
  }, []);

  /* manual X — hides the live card until NEW news arrives (fresh unseen id
     re-raises); ref, not persisted — a reload re-briefs by design */
  const dismissedRef = useRef<DigestDismissal | null>(null);
  const dismissDigest = useCallback(() => {
    if (digestSnap) dismissedRef.current = { windowEnd: digestSnap.windowEnd, idsKey: digestSnap.ids.join("\n") };
    setDigestSnap(null);
    writeDigest(null);
  }, [digestSnap]);

  /* capture while the window is ACTIVE (the unseen set = who waited through
     the night); expiry/tidy-up otherwise: feature off, grace passed, or
     fully handled → drop the snapshot. Writes only on real change (the
     savedAt bump would otherwise re-trigger this effect forever); the
     setState itself is deferred to a macrotask (house pattern — no
     cascading sync renders inside the effect). */
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const commit = (fn: () => void) => {
      t = setTimeout(fn, 0);
    };
    if (!quietHoursEnabled) {
      if (digestSnap) commit(clearDigest);
    } else if (quietActive) {
      const ids = captureDigestIds(items, seen);
      if (ids.length > 0) {
        const end = activeWindowEnd(new Date(now), quietEnd);
        const changed =
          !digestSnap || digestSnap.windowEnd !== end.toISOString() || digestSnap.ids.join("\n") !== ids.join("\n");
        if (changed && !isDismissalCurrent(dismissedRef.current, end.toISOString(), ids)) {
          const snap: DigestSnapshot = { windowEnd: end.toISOString(), ids, savedAt: new Date().toISOString() };
          commit(() => {
            setDigestSnap(snap);
            writeDigest(snap);
          });
        }
      }
    } else if (
      digestSnap &&
      (isSnapshotStale(digestSnap, new Date(now)) || !resolveQuietDigest(digestSnap, items, seen, new Date(now)))
    ) {
      /* grace expired, or every captured item was handled/vanished */
      commit(clearDigest);
    }
    return () => {
      if (t) clearTimeout(t);
    };
  }, [items, seen, now, quietActive, quietHoursEnabled, quietEnd, digestSnap, clearDigest]);

  const markSeen = (id: string) => {
    setSeen((prev) => {
      if (prev.includes(id)) return prev;
      const next = [...prev, id].slice(-SEEN_CAP);
      writeSeen(next);
      return next;
    });
  };

  const markAllSeen = () => {
    const ids = items.map((i) => i.id);
    setSeen((prev) => {
      const next = [...new Set([...prev, ...ids])].slice(-SEEN_CAP);
      writeSeen(next);
      return next;
    });
  };

  const openItem = (item: NotificationItem) => {
    markSeen(item.id);
    setOpen(false);
    /* deep-link handle: magazine cards carry the article slug, order
       cards the tracking code, community cards the postId */
    const handle = item.meta.slug ?? item.meta.code;
    if (item.meta.view === "community" && handle) {
      /* the community feed consumes its deep-link from the QUERY slot
         (same channel the ?post=ID probe uses) — scroll + ring flash */
      navigate("community", { query: handle });
      return;
    }
    navigate(item.meta.view, handle ? { slug: handle } : undefined);
  };

  if (view === "scanner") return null;

  return (
    <>
      {/* Floating bell launcher — start corner, mirroring the chat FAB */}
      <motion.button
        onClick={toggle}
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.94 }}
        aria-label={tx("مرکز اعلان‌ها", "Notification center")}
        aria-expanded={open}
        className="fixed bottom-24 sm:bottom-28 z-[60] start-5 size-14 rounded-full bg-card text-foreground border border-border/70 shadow-2xl shadow-forest/25 dark:shadow-black/50 pv-glass grid place-items-center"
      >
        <AnimatePresence mode="wait">
          {open ? (
            <motion.span key="x" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }}>
              <X className="size-5.5" />
            </motion.span>
          ) : (
            <motion.span key="bell" initial={{ rotate: 90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: -90, opacity: 0 }}>
              {badgeCount > 0 ? <BellRing className="size-5.5 text-primary" strokeWidth={2.1} /> : <Bell className="size-5.5 text-foreground/80" strokeWidth={1.9} />}
            </motion.span>
          )}
        </AnimatePresence>
        {!open && effDotCount > 0 && (
          <span
            aria-hidden
            className={`absolute -top-0.5 -end-0.5 min-w-5 h-5 px-1 rounded-full grid place-items-center text-[10px] font-black text-primary-foreground shadow-md ${
              effBadgeCount > 0 ? "bg-terracotta" : "bg-primary/70"
            }`}
          >
            {num(effBadgeCount > 0 ? effBadgeCount : effDotCount)}
          </span>
        )}
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.94 }}
            transition={{ type: "spring", stiffness: 260, damping: 24 }}
            role="dialog"
            aria-modal="true"
            aria-label={tx("مرکز اعلان‌ها", "Notification center")}
            className="fixed z-[60] bottom-40 sm:bottom-44 start-4 w-[calc(100vw-2rem)] max-w-sm rounded-3xl border border-border/70 bg-card/95 pv-glass shadow-2xl shadow-forest/25 dark:shadow-black/60 overflow-hidden flex flex-col"
            style={{ height: "min(480px, 58vh)" }}
          >
            {/* header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border/60 bg-gradient-to-r from-sage-soft/60 to-transparent">
              <span className="size-10 rounded-2xl bg-primary/15 grid place-items-center shrink-0">
                <Bell className="size-5 text-primary" />
              </span>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm">{tx("مرکز اعلان‌ها", "Notifications")}</p>
                <p className="text-[11px] text-muted-foreground truncate">
                  {quietActive && badgeCount > 0
                    ? tx(
                        `سکوت شبانه فعال — ${describeQuietWindow(quietStart, quietEnd, "fa")} 🌙`,
                        `Quiet hours on — ${describeQuietWindow(quietStart, quietEnd, "en")} 🌙`
                      )
                    : effBadgeCount > 0
                      ? tx(`${num(effBadgeCount)} مورد فوری`, `${num(effBadgeCount)} need attention`)
                      : tx("همه‌چیز بررسی شده", "You're all caught up")}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => setSettingsOpen((v) => !v)}
                  aria-label={tx("تنظیمات اعلان‌ها", "Notification settings")}
                  aria-pressed={settingsOpen}
                  title={tx("تنظیمات اعلان‌ها", "Notification settings")}
                  data-testid="notif-settings-open"
                  className={`size-8 rounded-full grid place-items-center transition-colors ${
                    settingsOpen
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-sage-soft/70 dark:hover:bg-secondary"
                  }`}
                >
                  <SlidersHorizontal className="size-4" />
                </button>
                <button
                  onClick={() => fetchFeed()}
                  disabled={loading}
                  aria-label={tx("به‌روزرسانی", "Refresh")}
                  className="size-8 rounded-full grid place-items-center text-muted-foreground hover:text-foreground hover:bg-sage-soft/70 dark:hover:bg-secondary transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
                </button>
                <button
                  onClick={markAllSeen}
                  disabled={items.length === 0}
                  aria-label={tx("خواندن همه", "Mark all read")}
                  title={tx("خواندن همه", "Mark all read")}
                  className="size-8 rounded-full grid place-items-center text-muted-foreground hover:text-foreground hover:bg-sage-soft/70 dark:hover:bg-secondary transition-colors disabled:opacity-50"
                >
                  <CheckCheck className="size-4" />
                </button>
              </div>
            </div>

            {/* settings view — swaps in over the feed inside the same panel */}
            {settingsOpen ? (
              <div
                className="pv-scroll flex-1 overflow-y-auto px-3 py-3 space-y-2"
                role="group"
                aria-label={tx("تنظیمات اعلان‌ها", "Notification settings")}
                data-testid="notif-settings"
              >
                <button
                  onClick={() => setSettingsOpen(false)}
                  className="flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-bold text-muted-foreground transition-colors hover:text-foreground"
                >
                  <ArrowLeft className="size-3.5 rtl:rotate-180" aria-hidden />
                  {tx("بازگشت به اعلان‌ها", "Back to notifications")}
                </button>
                <p className="px-1 pb-1 text-[11px] leading-relaxed text-muted-foreground">
                  {tx(
                    "هر دسته را خاموش کنی تا کارت‌هایش دیگر در فهرست نیایند.",
                    "Turn a category off and its cards stop appearing in the feed."
                  )}
                </p>
                {/* «سکوت شبانه» — badge sleeps inside the window, feed stays openable */}
                <div
                  data-testid="quiet-hours-card"
                  className="rounded-2xl border border-border/60 bg-background/60 p-3"
                >
                  <div className="flex items-center gap-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                      <Moon className="size-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-bold">{tx("سکوت شبانه", "Night quiet hours")}</span>
                      <span className="mt-0.5 block text-[10px] leading-relaxed text-muted-foreground">
                        {tx(
                          "در بازه انتخابی، نشان فوری خواب است — فهرست همچنان باز می‌شود.",
                          "Inside the window the badge sleeps — the feed still opens."
                        )}
                      </span>
                    </span>
                    <Switch
                      checked={quietHoursEnabled}
                      onCheckedChange={(v) => setQuietHours(v)}
                      aria-label={tx("سکوت شبانه", "Night quiet hours")}
                      data-testid="quiet-toggle"
                    />
                  </div>
                  {quietHoursEnabled && (
                    <div className="mt-3 flex items-center gap-2" data-testid="quiet-window-row">
                      <span className="text-[10px] font-bold text-muted-foreground shrink-0">{tx("از", "From")}</span>
                      <Select
                        value={String(quietStart)}
                        onValueChange={(v) => setQuietHours(true, Number(v), quietEnd)}
                      >
                        <SelectTrigger
                          size="sm"
                          aria-label={tx("شروع سکوت", "Quiet start")}
                          data-testid="quiet-start"
                          className="h-8 flex-1 text-xs"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="max-h-56">
                          {HALF_HOUR_STEPS.map((m) => (
                            <SelectItem key={m} value={String(m)} className="text-xs">
                              {formatClock(m, lang)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <span className="text-[10px] font-bold text-muted-foreground shrink-0">{tx("تا", "To")}</span>
                      <Select
                        value={String(quietEnd)}
                        onValueChange={(v) => setQuietHours(true, quietStart, Number(v))}
                      >
                        <SelectTrigger
                          size="sm"
                          aria-label={tx("پایان سکوت", "Quiet end")}
                          data-testid="quiet-end"
                          className="h-8 flex-1 text-xs"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="max-h-56">
                          {HALF_HOUR_STEPS.map((m) => (
                            <SelectItem key={m} value={String(m)} className="text-xs">
                              {formatClock(m, lang)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {quietHoursEnabled && quietStart === quietEnd && (
                    <p className="mt-2 text-[10px] font-bold text-terracotta" data-testid="quiet-degenerate-note">
                      {tx(
                        "شروع و پایان یکسان است — عملاً غیرفعال.",
                        "Same start and end — effectively off."
                      )}
                    </p>
                  )}
                </div>
                {NOTIF_MUTE_GROUPS.map((g) => {
                  const isMuted = mutedNotifGroups.includes(g.id);
                  return (
                    <div
                      key={g.id}
                      data-testid={`notif-group-${g.id}`}
                      className="flex items-center gap-3 rounded-2xl border border-border/60 bg-background/60 p-3"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-bold">{tx(g.fa, g.en)}</span>
                        <span className="mt-0.5 block text-[10px] leading-relaxed text-muted-foreground">
                          {tx(g.descFa, g.descEn)}
                        </span>
                      </span>
                      <Switch
                        checked={!isMuted}
                        onCheckedChange={() => toggleNotifGroup(g.id)}
                        aria-label={tx(g.fa, g.en)}
                        data-testid={`notif-toggle-${g.id}`}
                      />
                    </div>
                  );
                })}
                <p className="px-1 pt-1 text-[10px] leading-relaxed text-muted-foreground/80">
                  {tx(
                    "کارت مجله و یادآور «همه‌چیز مرتب» همیشه فعال می‌مانند.",
                    "The magazine card and the all-clear note always stay on."
                  )}
                </p>
              </div>
            ) : (
            <div className="pv-scroll flex-1 overflow-y-auto px-3 py-3 space-y-2" role="list" aria-busy={loading}>
              {loading && items.length === 0 && (
                <div className="flex flex-col items-center gap-2 py-10 text-xs text-muted-foreground">
                  <Leaf className="size-8 text-primary/50 pv-float" aria-hidden />
                  {tx("در حال جمع‌آوری اعلان‌ها…", "Gathering notifications…")}
                </div>
              )}

              {!loading && error && items.length === 0 && (
                <div className="flex flex-col items-center gap-3 py-10 text-center">
                  <Leaf className="size-8 text-muted-foreground/50" aria-hidden />
                  <p className="text-xs font-bold">{tx("دریافت اعلان‌ها ناموفق بود", "Couldn't load notifications")}</p>
                  <button
                    onClick={() => fetchFeed()}
                    className="rounded-full border border-border bg-background/70 px-4 py-1.5 text-xs font-bold hover:bg-sage-soft/60 dark:hover:bg-secondary transition-colors"
                  >
                    {tx("تلاش دوباره", "Try again")}
                  </button>
                </div>
              )}

              {!error && digest && (
                <div
                  data-testid="quiet-digest"
                  role="group"
                  aria-label={tx("خلاصهٔ شب گذشته", "Overnight digest")}
                  className="relative rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-sage-soft/40 to-transparent p-3"
                >
                  <div className="flex items-start gap-3">
                    <span className="size-9 shrink-0 rounded-xl grid place-items-center bg-primary/15 text-primary">
                      <Moon className="size-4.5" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold">{tx("خلاصهٔ شب گذشته", "Overnight digest")}</p>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground" data-testid="digest-summary">
                        {digest.count === 1
                          ? tx(
                              digest.live ? "یک اعلان در سکوت شبانه منتظر توست" : "شب گذشته یک اعلان منتظر ماند",
                              digest.live ? "One notification is waiting out quiet hours" : "Overnight, one notification waited for you"
                            )
                          : tx(
                              digest.live
                                ? `${num(digest.count)} اعلان در سکوت شبانه منتظر توست`
                                : `شب گذشته ${num(digest.count)} اعلان منتظر ماند`,
                              digest.live
                                ? `${digest.count} notifications are waiting out quiet hours`
                                : `Overnight, ${digest.count} notifications waited for you`
                            )}
                        {digest.bySeverity.urgent > 0 && (
                          <span className="ms-1 font-bold text-terracotta">
                            · {tx(`${num(digest.bySeverity.urgent)} فوری`, `${digest.bySeverity.urgent} urgent`)}
                          </span>
                        )}
                        {digest.bySeverity.upcoming > 0 && (
                          <span className="ms-1 font-bold text-gold">
                            · {tx(`${num(digest.bySeverity.upcoming)} به‌زودی`, `${digest.bySeverity.upcoming} soon`)}
                          </span>
                        )}
                      </p>
                      {digest.top && (
                        <button
                          data-testid="digest-top"
                          onClick={() => digest.top && openItem(digest.top)}
                          className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-[11px] font-bold text-primary-foreground shadow-sm transition-transform hover:scale-[1.03] active:scale-95"
                        >
                          {tx("مهم‌ترین اعلان", "Open the most urgent")}
                          <ArrowLeft className="size-3.5 rtl:rotate-180" aria-hidden />
                        </button>
                      )}
                    </div>
                    <button
                      onClick={dismissDigest}
                      aria-label={tx("بستن خلاصه", "Dismiss digest")}
                      data-testid="digest-dismiss"
                      className="size-6 shrink-0 rounded-full grid place-items-center text-muted-foreground hover:text-foreground hover:bg-background/60 transition-colors"
                    >
                      <X className="size-3.5" aria-hidden />
                    </button>
                  </div>
                </div>
              )}

              {!error &&
                items.map((item, i) => {
                  const Icon = NOTIF_ICON[item.icon] ?? Bell;
                  const tone = SEVERITY_TONE[item.severity];
                  const isUnseen = !seen.includes(item.id);
                  const isClear = item.kind === "all-clear";
                  const time = isFa ? relativeTimeFa(item.at, now) : relativeTimeEn(item.at, now);
                  return (
                    <motion.button
                      key={item.id}
                      role="listitem"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(i * 0.04, 0.3) }}
                      onClick={() => (isClear ? undefined : openItem(item))}
                      aria-label={tx(item.fa, item.en)}
                      className={`relative w-full text-start flex gap-3 rounded-2xl border p-3 transition-colors ${
                        isClear
                          ? "border-primary/15 bg-sage-soft/50 dark:bg-secondary/40 cursor-default"
                          : `${tone.ring} hover:shadow-sm cursor-pointer`
                      }`}
                    >
                      <span className={`size-9 shrink-0 rounded-xl grid place-items-center ${isClear ? "bg-primary/10 text-primary" : tone.chip}`}>
                        <Icon className="size-4.5" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          {!isClear && <span className={`size-1.5 rounded-full shrink-0 ${tone.dot} ${isUnseen ? "" : "opacity-30"}`} aria-hidden />}
                          <span className="text-[10px] font-black tracking-wide text-muted-foreground">
                            {item.severity === "urgent"
                              ? tx("فوری", "URGENT")
                              : item.severity === "upcoming"
                                ? tx("به‌زودی", "SOON")
                                : tx("اطلاع", "INFO")}
                          </span>
                          <span className="ms-auto text-[10px] text-muted-foreground/80 shrink-0">{time}</span>
                        </span>
                        <span className="mt-1 block text-xs leading-relaxed text-foreground/90">{tx(item.fa, item.en)}</span>
                      </span>
                    </motion.button>
                  );
                })}
            </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <span className="sr-only" aria-live="polite">
        {effBadgeCount > 0
          ? lang === "fa"
            ? `${effBadgeCount} اعلان فوری`
            : `${effBadgeCount} urgent notifications`
          : ""}
      </span>
    </>
  );
}