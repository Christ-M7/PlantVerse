/**
 * PlantVerse — quiet-hours overnight digest («خلاصهٔ شب گذشته»). 
 *
 * While night quiet hours defer the bell's badge, the items that sit
 * unseen during the window deserve a morning briefing instead of being
 * silently absorbed. This lib is the pure brain behind that card:
 *
 *   1. captureDigestIds  — while the window is ACTIVE, the unseen,
 *      non-all-clear ids are the "waited through the night" set.
 *   2. resolveQuietDigest — joins a persisted snapshot with the live
 *      feed: items still present AND still unseen become the digest,
 *      ranked so "one tap to the most urgent" has a deterministic top.
 *
 * The snapshot persists in localStorage (key plantverse-notifs-digest)
 * so a morning reload still shows the briefing; it expires DIGEST_GRACE
 * minutes after the window ends — a digest from two nights ago is noise,
 * not news. Pure logic, no DOM / React imports — shared by the bell and
 * the test suite.
 */

import type { NotificationItem, NotificationSeverity } from "@/lib/notifications";

/* ── snapshot shape (localStorage payload) ─────────────────────────────── */

export const DIGEST_SEEN_CAP = 200;
/** Minutes after window end during which the morning briefing still shows. */
export const DIGEST_GRACE_MINUTES = 120;

export interface DigestSnapshot {
  /** ISO datetime of the captured window's end */
  windowEnd: string;
  /** item ids that were unseen while the window was active */
  ids: string[];
  /** ISO datetime the capture was (last) refreshed */
  savedAt: string;
}

/** Severity rank — urgent first, mirrors the feed's own ordering policy. */
const SEVERITY_RANK: Record<NotificationSeverity, number> = { urgent: 0, upcoming: 1, info: 2 };

/**
 * Defensive parse of the localStorage payload — junk never crashes the
 * bell: wrong shape → null; non-string ids dropped; capped; dates must
 * parse. Returns null when nothing usable remains.
 */
export function parseDigestSnapshot(raw: unknown): DigestSnapshot | null {
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (raw === null || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const windowEnd = typeof o.windowEnd === "string" ? o.windowEnd : "";
  const savedAt = typeof o.savedAt === "string" ? o.savedAt : "";
  if (!windowEnd || Number.isNaN(new Date(windowEnd).getTime())) return null;
  if (!savedAt || Number.isNaN(new Date(savedAt).getTime())) return null;
  const ids = Array.isArray(o.ids)
    ? o.ids.filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, DIGEST_SEEN_CAP)
    : [];
  if (ids.length === 0) return null;
  return { windowEnd, ids, savedAt };
}

/* ── 1. capture (window active) ─────────────────────────────────────────── */

/**
 * The digest-worthy ids right now: unseen, not the all-clear note.
 * `items` arrive feed-ordered; order is preserved (the caller stores them
 * as a set — duplicates would be harmless, but there are none).
 */
export function captureDigestIds(items: NotificationItem[], seenIds: readonly string[]): string[] {
  const seen = new Set(seenIds);
  return items
    .filter((i) => i.kind !== "all-clear" && !seen.has(i.id))
    .map((i) => i.id)
    .slice(0, DIGEST_SEEN_CAP);
}

/** Same payload, stable stringify — the capture effect writes only on change. */
export function digestSnapshotKey(windowEnd: Date, ids: readonly string[], savedAt: Date): string {
  return JSON.stringify({ windowEnd: windowEnd.toISOString(), ids, savedAt: savedAt.toISOString() });
}

/**
 * Wall-clock end of the window that is active AT `now` (caller guarantees
 * isWithinQuietHours already said yes). Wrap-aware: a 22:00 → 07:30 window
 * entered at 23:00 ends tomorrow 07:30; an end of 00:00 means next
 * midnight. Assumes endMin already normalized to [0, 1440).
 */
export function activeWindowEnd(now: Date, endMin: number): Date {
  const e = Math.max(0, Math.min(1440, Math.round(endMin)));
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endToday = new Date(dayStart.getTime() + e * 60_000);
  if (endToday.getTime() > now.getTime()) return endToday;
  return new Date(dayStart.getTime() + (e + 1440) * 60_000);
}

/* ── 2. resolve (window ended → morning briefing) ───────────────────────── */

export interface QuietDigest {
  /** items still present + still unseen, feed order preserved */
  items: NotificationItem[];
  count: number;
  bySeverity: { urgent: number; upcoming: number; info: number };
  /** highest severity, newest first — the "one tap" jump target */
  top: NotificationItem | null;
  /** true while the window is still active (live briefing), false = morning replay */
  live: boolean;
  /** window end of the snapshot (ISO) — the card can show it */
  windowEnd: string;
}

/**
 * Build the digest card model from a snapshot + the live feed.
 *
 * Rules:
 *  - grace: `now` must be within windowEnd + DIGEST_GRACE_MINUTES, else
 *    the snapshot is stale news → null.
 *  - membership: only items still IN the feed AND still unseen count —
 *    resolved situations and items the user already handled disappear
 *    honestly.
 *  - empty result → null (nothing to brief).
 *  - `top` = lowest severity rank; ties break by newest `at`.
 */
export function resolveQuietDigest(
  snapshot: DigestSnapshot,
  items: readonly NotificationItem[],
  seenIds: readonly string[],
  now: Date = new Date()
): QuietDigest | null {
  const end = new Date(snapshot.windowEnd);
  if (Number.isNaN(end.getTime())) return null;
  const graceMs = DIGEST_GRACE_MINUTES * 60_000;
  if (now.getTime() > end.getTime() + graceMs) return null;

  const seen = new Set(seenIds);
  const idSet = new Set(snapshot.ids);
  const digestItems = items.filter((i) => i.kind !== "all-clear" && idSet.has(i.id) && !seen.has(i.id));
  if (digestItems.length === 0) return null;

  const bySeverity = { urgent: 0, upcoming: 0, info: 0 };
  for (const i of digestItems) bySeverity[i.severity]++;

  const top =
    digestItems.reduce<NotificationItem | null>((best, cur) => {
      if (!best) return cur;
      const rBest = SEVERITY_RANK[best.severity];
      const rCur = SEVERITY_RANK[cur.severity];
      if (rCur !== rBest) return rCur < rBest ? cur : best;
      return cur.at > best.at ? cur : best;
    }, null) ?? digestItems[0];

  return {
    items: digestItems,
    count: digestItems.length,
    bySeverity,
    top,
    live: now.getTime() <= end.getTime(),
    windowEnd: snapshot.windowEnd,
  };
}

/**
 * Should the persisted snapshot be dropped? True when grace expired or it
 * parses to nothing — keeps localStorage from carrying stale nights.
 */
export function isSnapshotStale(snapshot: DigestSnapshot | null, now: Date = new Date()): boolean {
  if (!snapshot) return true;
  const end = new Date(snapshot.windowEnd);
  if (Number.isNaN(end.getTime())) return true;
  const t = now instanceof Date && !Number.isNaN(now.getTime()) ? now.getTime() : Date.now();
  return t > end.getTime() + DIGEST_GRACE_MINUTES * 60_000;
}

/* ── 3. dismissal (manual X on the live card) ───────────────────────────── */

export interface DigestDismissal {
  windowEnd: string;
  /** ids joined with \n — the set the user dismissed */
  idsKey: string;
}

/**
 * Is a manual dismissal still current for this capture? Current = same
 * window AND no NEW unseen id beyond what the user dismissed (shrinking
 * sets stay hidden; fresh news re-raises the card). Lives in a ref, not
 * persisted — a reload re-briefs, which is the honest live-card behavior.
 */
export function isDismissalCurrent(
  dismissed: DigestDismissal | null,
  windowEnd: string,
  ids: readonly string[]
): boolean {
  if (!dismissed) return false;
  if (dismissed.windowEnd !== windowEnd) return false;
  const seen = new Set(dismissed.idsKey.split("\n"));
  return ids.every((id) => seen.has(id));
}
