import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { syncOrderProgression } from "@/server/order-sync";
import { calcShipping, calcDiscount, calcGrandTotal, COUPONS } from "@/lib/commerce";

export const dynamic = "force-dynamic";

/* ── pricing rules live in @/lib/commerce (single source of truth shared
   with the checkout UI — displayed price IS the charged price) ── */

const FA_DIGITS = /[۰-۹]/g;
const faToEnDigits = (s: string) => s.replace(FA_DIGITS, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));

const PHONE_RE = /^09\d{9}$/;
const POSTAL_RE = /^\d{10}$/;

/** Human-friendly unique order code, e.g. PV-8F3K2Q (no confusing chars). */
function generateCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `PV-${code}`;
}

interface IncomingItem {
  nameFa?: unknown;
  nameEn?: unknown;
  price?: unknown;
  qty?: unknown;
  image?: unknown;
}

const asInt = (v: unknown, fallback = 0) => {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
};

const cleanText = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

/* ─────────────────────────── POST /api/orders ─────────────────────────── */

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Record<string, unknown>;

    // ── validate customer fields ──
    const customerName = cleanText(body.customerName, 80);
    const phone = faToEnDigits(cleanText(body.phone, 16)).replace(/[\s-]/g, "");
    const province = cleanText(body.province, 40);
    const city = cleanText(body.city, 40);
    const address = cleanText(body.address, 300);
    const postalCode = faToEnDigits(cleanText(body.postalCode, 12)).replace(/[\s-]/g, "");
    const note = cleanText(body.note, 300);
    const paymentMethod = body.paymentMethod === "cod" ? "cod" : "gateway";
    const couponCode = cleanText(body.couponCode, 16).toUpperCase();

    const errors: Record<string, string> = {};
    if (customerName.length < 3) errors.customerName = "invalid";
    if (!PHONE_RE.test(phone)) errors.phone = "invalid";
    if (province.length < 2) errors.province = "invalid";
    if (city.length < 2) errors.city = "invalid";
    if (address.length < 10) errors.address = "invalid";
    if (postalCode && !POSTAL_RE.test(postalCode)) errors.postalCode = "invalid";
    if (Object.keys(errors).length > 0) {
      return NextResponse.json({ success: false, error: "validation", errors }, { status: 400 });
    }

    // ── validate & normalize items (never trust client totals) ──
    const rawItems = Array.isArray(body.items) ? (body.items as IncomingItem[]) : [];
    const items = rawItems
      .map((it) => ({
        nameFa: cleanText(it.nameFa, 80),
        nameEn: cleanText(it.nameEn, 80),
        price: asInt(it.price),
        qty: Math.min(9, Math.max(1, asInt(it.qty, 1))),
        image: cleanText(it.image, 120),
      }))
      .filter((it) => it.nameEn.length > 0 && it.price > 0);

    if (items.length === 0) {
      return NextResponse.json({ success: false, error: "empty_cart" }, { status: 400 });
    }

    // ── totals (server-side authority, shared formulas with the UI) ──
    const subtotal = items.reduce((s, it) => s + it.price * it.qty, 0);
    const shippingCost = calcShipping(subtotal, paymentMethod);
    const discount = calcDiscount(subtotal, couponCode);
    const total = calcGrandTotal(subtotal, paymentMethod, couponCode);
    const coupon = couponCode in COUPONS ? COUPONS[couponCode] : undefined;

    // ── persist with a unique code (retry on the astronomically rare clash) ──
    type OrderRow = Awaited<ReturnType<typeof db.order.create>>;
    let order: OrderRow | null = null;
    for (let attempt = 0; attempt < 3 && !order; attempt++) {
      try {
        order = await db.order.create({
          data: {
            code: generateCode(),
            customerName,
            phone,
            province,
            city,
            address,
            postalCode,
            note,
            items: JSON.stringify(items),
            subtotal,
            shippingCost,
            discount,
            total,
            paymentMethod,
            couponCode: coupon ? couponCode : "",
            status: paymentMethod === "cod" ? "preparing" : "paid",
          },
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        if (!msg.includes("Unique")) throw e;
      }
    }

    return NextResponse.json({ success: true, order }, { status: 201 });
  } catch {
    return NextResponse.json({ success: false, error: "server_error" }, { status: 500 });
  }
}

/* ─────────────────────────── PATCH /api/orders ────────────────────────── */

/**
 * Cancel an order. Only `paid` / `preparing` orders are cancellable —
 * once shipped the parcel is on its way.
 */
export async function PATCH(req: Request) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const code = cleanText(body.code, 16).toUpperCase();

    if (!/^PV-[A-Z0-9]{6}$/.test(code)) {
      return NextResponse.json({ success: false, error: "invalid_code" }, { status: 400 });
    }

    const order = await db.order.findUnique({ where: { code } });
    if (!order) {
      return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
    }
    if (order.status !== "paid" && order.status !== "preparing") {
      return NextResponse.json(
        { success: false, error: "not_cancellable", status: order.status },
        { status: 409 }
      );
    }

    const updated = await db.order.update({
      where: { code },
      data: { status: "cancelled" },
    });

    return NextResponse.json({ success: true, order: updated });
  } catch {
    return NextResponse.json({ success: false, error: "server_error" }, { status: 500 });
  }
}

/* ─────────────────────────── GET /api/orders ─────────────────────────── */

/** Order history — latest first. The fulfilment clock runs first so the
 * recorded statuses (badges, cancel policy) reflect elapsed time. */
export async function GET() {
  try {
    await syncOrderProgression();
    const orders = await db.order.findMany({
      orderBy: { createdAt: "desc" },
      take: 15,
    });
    return NextResponse.json({ success: true, orders });
  } catch {
    return NextResponse.json({ success: false, error: "server_error" }, { status: 500 });
  }
}
