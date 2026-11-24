/**
 * PlantVerse — single source of truth for commerce pricing rules.
 *
 * The checkout constants (free-shipping threshold, flat shipping, COD
 * surcharge, coupons) previously lived as two hand-mirrored copies — one in
 * `src/components/shop/shop-view.tsx` (what the buyer sees) and one in
 * `src/app/api/orders/route.ts` (what the server charges). TS cannot catch
 * cross-file constant drift, and R46 already caught one drift bug of this
 * exact class (health-band colors 90/75 vs the canonical 85/70/50). Both
 * sides now import from this module, so the displayed price IS the charged
 * price by construction.
 *
 * The shipping and discount formulas live here too, as pure functions, so
 * the UI preview and the server total cannot diverge in arithmetic either.
 */

/* ───────────────────────── pricing constants (Toman) ───────────────────── */

export const FREE_SHIPPING_THRESHOLD = 2_000_000;
export const FLAT_SHIPPING = 89_000;
export const COD_FEE = 25_000; // cash-on-delivery surcharge

export interface Coupon {
  percent: number;
  max: number;
  fa: string;
  en: string;
}

/** Coupons — bilingual shop, uppercase codes. */
export const COUPONS: Record<string, Coupon> = {
  GREEN15: { percent: 15, max: 500_000, fa: "۱۵٪ تخفیف گیاه‌دوستان", en: "15% plant-lover discount" },
  SEEDLING10: { percent: 10, max: 300_000, fa: "۱۰٪ تخفیف نهال", en: "10% sapling discount" },
};

/**
 * Bilingual order-status wording + badge classes — one copy for the shop
 * orders list, the profile orders card, and the printable report. These
 * were three hand-mirrored copies that had to stay word-identical; they
 * now cannot drift.
 */
export const ORDER_STATUS_META: Record<string, { fa: string; en: string; cls: string }> = {
  paid: { fa: "پرداخت‌شده", en: "Paid", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  preparing: { fa: "در حال آماده‌سازی", en: "Preparing", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  shipped: { fa: "ارسال‌شده", en: "Shipped", cls: "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300" },
  delivered: { fa: "تحویل‌شده", en: "Delivered", cls: "bg-emerald-600/15 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200" },
  cancelled: { fa: "لغوشده", en: "Cancelled", cls: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
};

/* ─────────────────────────── pure pricing formulas ─────────────────────── */

/**
 * Shipping cost for a cart. The free-shipping threshold waives the FLAT
 * rate only — the COD surcharge is a handling cost and still applies on
 * large orders (the server's authority rule; the old hand-mirrored UI copy
 * waived it too, disagreeing with what the server actually charged).
 */
export function calcShipping(cartTotal: number, payment: string): number {
  if (cartTotal === 0) return 0;
  const flat = cartTotal >= FREE_SHIPPING_THRESHOLD ? 0 : FLAT_SHIPPING;
  return payment === "cod" ? flat + COD_FEE : flat;
}

/** Coupon discount, capped — identical rounding on both sides of the wire. */
export function calcDiscount(cartTotal: number, couponCode: string): number {
  const coupon = COUPONS[couponCode];
  if (!coupon) return 0;
  return Math.min(coupon.max, Math.round((cartTotal * coupon.percent) / 100));
}

/** Final charge: never negative even if a coupon over-covers a tiny cart. */
export function calcGrandTotal(cartTotal: number, payment: string, couponCode: string): number {
  return Math.max(0, cartTotal + calcShipping(cartTotal, payment) - calcDiscount(cartTotal, couponCode));
}
