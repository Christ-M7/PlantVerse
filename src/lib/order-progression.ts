/**
 * PlantVerse — order status progression («پیشروی خودکار وضعیت سفارش»).
 *
 * Pure domain logic (no DB imports) shared by the read-path sync, the
 * API routes and tests. The tracker (order-tracking.ts) derives the
 * fulfilment timeline and caps it at the RECORDED status; this module
 * derives what the recorded status SHOULD be given elapsed time, so the
 * store stays honest with the clock on every read:
 *
 *   paid      → preparing  at +12h   (greenhouse picking & packing)
 *   preparing → shipped    at +36h   (handed to the courier)
 *   shipped   → delivered  at +96h   (at your door)
 *
 * The offsets are the SAME book the tracker renders — recording and
 * timeline can never disagree. Movement is strictly FORWARD: a status
 * already ahead of the clock (a courier event recorded early, a COD
 * order born as "preparing") is never demoted. Jumps are one-shot: a
 * 3-day-old paid order lands directly on delivered (the timeline only
 * renders the final state). Cancelled and delivered are terminal — no
 * clock moves them, and unknown statuses are left untouched.
 */

import { TRACK_STAGE_OFFSET_H, TRACK_STAGE_ORDER, type TrackStageKey } from "@/lib/order-tracking";

/** statuses the fulfilment clock is allowed to move forward */
export const PROGRESSABLE_STATUSES = ["paid", "preparing", "shipped"] as const;

/** furthest fulfilment stage whose offset has elapsed since placement */
export function elapsedStageKey(createdAt: Date | string, now: Date): TrackStageKey {
  const elapsedH = (now.getTime() - new Date(createdAt).getTime()) / 3_600_000;
  let target: TrackStageKey = "paid";
  for (const key of ["preparing", "shipped", "delivered"] as const) {
    if (elapsedH >= TRACK_STAGE_OFFSET_H[key]) target = key;
  }
  return target;
}

/**
 * The status an order should carry at `now`, or null when no FORWARD
 * move is demanded: already current, terminal (cancelled / delivered),
 * not a known status, or recorded further along than the clock allows
 * (statuses are never demoted).
 */
export function advancedStatus(
  status: string,
  createdAt: Date | string,
  now: Date
): TrackStageKey | null {
  if (!(PROGRESSABLE_STATUSES as readonly string[]).includes(status)) return null;
  const rank = TRACK_STAGE_ORDER.indexOf(status as TrackStageKey);
  const target = elapsedStageKey(createdAt, now);
  /* forward-only: the recorded status is a floor, never a ceiling to repair */
  return TRACK_STAGE_ORDER.indexOf(target) > rank ? target : null;
}
