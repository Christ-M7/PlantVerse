/**
 * PlantVerse — order fulfilment tracker («رهگیری زندهٔ سفارش»).
 *
 * Pure domain logic (no DB imports) shared by the tracking API route,
 * the shop UI and tests: derives a deterministic four-stage timeline
 * (placed → preparing → shipped → delivered) from the order's creation
 * instant and current status, plus delivery ETA and progress percent.
 *
 * Timestamps are a fixed-offset simulation anchored at createdAt —
 * documented, stable, and identical for every caller; the backend is
 * the single source of truth so client and tests never re-derive them.
 *
 *   paid      +0h    (the order exists → payment recorded)
 *   preparing +12h   (greenhouse picking & packing)
 *   shipped   +36h   (handed to the courier)
 *   delivered +96h   (at your door)
 *
 * Cancelled orders freeze at the paid stage and carry no ETA.
 */

/* ── types ──────────────────────────────────────────────────────────────── */

export type TrackStageKey = "paid" | "preparing" | "shipped" | "delivered";

export interface TrackStage {
  key: TrackStageKey;
  fa: string;
  en: string;
  /** deterministic stage instant (ISO) — null for stages never reached */
  at: string | null;
  reached: boolean;
  current: boolean;
}

export interface OrderTracking {
  status: string; // paid | preparing | shipped | delivered | cancelled
  cancelled: boolean;
  stages: TrackStage[];
  /** index of the current stage — -1 only for cancelled */
  stageIndex: number;
  /** 0..100 journey completion (cancelled freezes at 25) */
  progress: number;
  /** delivery estimate — null once delivered or cancelled */
  eta: {
    at: string;
    hoursFromNow: number;
    fa: string;
    en: string;
  } | null;
}

export interface TrackingOrder {
  code: string;
  status: string;
  createdAt: Date | string;
}

/* ── stage book (exported for tests + UI icons) ─────────────────────────── */

export const TRACK_STAGE_OFFSET_H: Record<TrackStageKey, number> = {
  paid: 0,
  preparing: 12,
  shipped: 36,
  delivered: 96,
};

export const TRACK_STAGE_LABELS: Record<TrackStageKey, { fa: string; en: string }> = {
  paid: { fa: "ثبت و پرداخت", en: "Placed & paid" },
  preparing: { fa: "آماده‌سازی بسته", en: "Preparing" },
  shipped: { fa: "تحویل به پست", en: "Shipped" },
  delivered: { fa: "تحویل به شما", en: "Delivered" },
};

const STAGE_ORDER: TrackStageKey[] = ["paid", "preparing", "shipped", "delivered"];

/** exported so the progression engine can compare stage ranks */
export const TRACK_STAGE_ORDER: TrackStageKey[] = STAGE_ORDER;

/** Persian copy for the ETA chip, worded by remaining hours. */
function etaCopy(hours: number, faDigits: (n: number) => string): { fa: string; en: string } {
  if (hours <= 1) return { fa: "پیش‌بینی تحویل: امروز", en: "Estimated delivery: today" };
  if (hours < 24) return { fa: `پیش‌بینی تحویل: ${faDigits(Math.max(1, Math.round(hours)))} ساعت دیگر`, en: `Estimated delivery: in ${Math.max(1, Math.round(hours))}h` };
  const days = Math.round(hours / 24);
  return { fa: `پیش‌بینی تحویل: ${faDigits(days)} روز دیگر`, en: `Estimated delivery: in ${days} day${days === 1 ? "" : "s"}` };
}

/* ── engine ─────────────────────────────────────────────────────────────── */

export function buildOrderTracking(
  order: TrackingOrder,
  now: Date = new Date(),
  faDigits: (n: number) => string = (n) => String(n)
): OrderTracking {
  const created = new Date(order.createdAt).getTime();
  const elapsedH = (now.getTime() - created) / 3_600_000;
  const cancelled = order.status === "cancelled";

  /* current stage: furthest stage whose offset has elapsed, capped by the
     recorded status (status is authoritative — the simulation never runs
     ahead of what the store actually recorded) */
  const statusIdx = STAGE_ORDER.indexOf(order.status as TrackStageKey);
  const timeIdx = STAGE_ORDER.reduce(
    (acc, key, i) => (elapsedH >= TRACK_STAGE_OFFSET_H[key] ? i : acc),
    0
  );
  const stageIndex = cancelled ? -1 : statusIdx < 0 ? 0 : Math.min(statusIdx, timeIdx);

  const stages: TrackStage[] = STAGE_ORDER.map((key, i) => ({
    key,
    fa: TRACK_STAGE_LABELS[key].fa,
    en: TRACK_STAGE_LABELS[key].en,
    at: (cancelled ? i === 0 : i <= stageIndex) ? new Date(created + TRACK_STAGE_OFFSET_H[key] * 3_600_000).toISOString() : null,
    reached: cancelled ? i === 0 : i <= stageIndex,
    current: i === stageIndex,
  }));

  /* thirds of the 3-hop journey, floored for stable 0/33/66/100 steps;
     cancelled freezes at a distinct 25 ("placed but going nowhere") */
  const progress = cancelled ? 25 : Math.floor((stageIndex / (STAGE_ORDER.length - 1)) * 100);

  /* ETA: the delivered stage's deterministic instant, worded against now */
  const deliveredAt = created + TRACK_STAGE_OFFSET_H.delivered * 3_600_000;
  const eta =
    cancelled || stageIndex >= STAGE_ORDER.length - 1
      ? null
      : (() => {
          const hoursFromNow = Math.max(0, (deliveredAt - now.getTime()) / 3_600_000);
          const copy = etaCopy(hoursFromNow, faDigits);
          return {
            at: new Date(deliveredAt).toISOString(),
            hoursFromNow: Math.round(hoursFromNow),
            fa: copy.fa,
            en: copy.en,
          };
        })();

  return { status: order.status, cancelled, stages, stageIndex, progress, eta };
}
