/**
 * PlantVerse — order history report builders («گزارش سفارش‌ها»). 
 *
 * Pure domain logic (no DB / DOM imports) shared by the API route, the
 * client print flow and tests:
 *
 *   1. buildOrderReport     — aggregates raw order rows into a bilingual
 *      report model (status rollup, spend totals, item counts, date range)
 *      with the same status taxonomy as the tracking engine.
 *   2. buildOrderReportHtml — renders the model into a self-contained,
 *      print-ready HTML document (RTL fa / LTR en) the client writes into
 *      a hidden iframe and prints → "Save as PDF".
 *
 * Money formatting mirrors the app-wide rule (Intl en-US grouping, then
 * Persian digits when fa). All customer-provided text is HTML-escaped —
 * the report embeds names, addresses and item names verbatim.
 */

import { toJalali } from "@/lib/jalali";
import { ORDER_STATUS_META } from "@/lib/commerce";

/* ── types ──────────────────────────────────────────────────────────────── */

export interface OrderReportLine {
  nameFa: string;
  nameEn: string;
  price: number;
  qty: number;
}

export interface OrderReportOrder {
  code: string;
  status: string; // paid | preparing | shipped | delivered | cancelled
  createdAt: string; // ISO datetime
  customerName: string;
  province: string;
  city: string;
  address: string;
  paymentMethod: string; // gateway | cod
  couponCode: string;
  subtotal: number;
  shippingCost: number;
  discount: number;
  total: number;
  items: OrderReportLine[];
}

export interface OrderReportStats {
  total: number;
  byStatus: Record<string, number>;
  /** spend of non-cancelled orders */
  totalSpent: number;
  cancelledCount: number;
  /** total item quantity across non-cancelled orders */
  itemCount: number;
  /** average non-cancelled order value (rounded) */
  avgOrder: number;
  /** latest-first range (ISO) — null when there are no orders */
  from: string | null;
  to: string | null;
}

export interface OrderReport {
  stats: OrderReportStats;
  orders: OrderReportOrder[];
  generatedAt: string; // ISO datetime
}

export type ReportLang = "fa" | "en";

/* ── parsing & formatting helpers ───────────────────────────────────────── */

/** Parse the JSON `items` column (may arrive as string or array). */
export function parseReportItems(raw: unknown): OrderReportLine[] {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((it) => {
    const o = (it ?? {}) as Record<string, unknown>;
    const price = typeof o.price === "number" ? o.price : Number(o.price);
    const qty = typeof o.qty === "number" ? o.qty : Number(o.qty);
    if (!Number.isFinite(price) || price <= 0) return [];
    return [
      {
        nameFa: String(o.nameFa ?? "").slice(0, 80),
        nameEn: String(o.nameEn ?? "").slice(0, 80),
        price,
        qty: Number.isFinite(qty) && qty > 0 ? Math.floor(qty) : 1,
      },
    ];
  });
}

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
/** Latin digits → Persian (report text only; codes stay Latin). */
function faNum(v: number | string): string {
  return String(v).replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]);
}

/** Grouped number, Persian digits for fa — mirrors use-lang money(). */
function money(v: number, lang: ReportLang): string {
  const grouped = new Intl.NumberFormat("en-US").format(v);
  return lang === "fa" ? faNum(grouped) : grouped;
}

function htmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ── status meta — single source in @/lib/commerce (was a hand-mirror of
   shop wording; the badge cls column is dropped for print output) ────── */

const REPORT_STATUS_META: Record<string, { fa: string; en: string }> = Object.fromEntries(
  Object.entries(ORDER_STATUS_META).map(([k, v]) => [k, { fa: v.fa, en: v.en }])
) as Record<string, { fa: string; en: string }>; export { REPORT_STATUS_META };

/* ── 1. aggregation ─────────────────────────────────────────────────────── */

interface RawOrderLike {
  code?: unknown;
  status?: unknown;
  createdAt?: unknown;
  customerName?: unknown;
  province?: unknown;
  city?: unknown;
  address?: unknown;
  paymentMethod?: unknown;
  couponCode?: unknown;
  subtotal?: unknown;
  shippingCost?: unknown;
  discount?: unknown;
  total?: unknown;
  items?: unknown;
}

/**
 * Normalize DB rows → report orders (latest first, tolerant of junk rows).
 * Unknown statuses are kept verbatim so the stats table stays truthful.
 */
export function toReportOrders(rows: RawOrderLike[]): OrderReportOrder[] {
  return rows
    .map((r) => ({
      code: String(r.code ?? "").slice(0, 16),
      status: String(r.status ?? "").slice(0, 16),
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt ?? ""),
      customerName: String(r.customerName ?? "").slice(0, 80),
      province: String(r.province ?? "").slice(0, 40),
      city: String(r.city ?? "").slice(0, 40),
      address: String(r.address ?? "").slice(0, 300),
      paymentMethod: String(r.paymentMethod ?? "gateway").slice(0, 16),
      couponCode: String(r.couponCode ?? "").slice(0, 16),
      subtotal: Number(r.subtotal) || 0,
      shippingCost: Number(r.shippingCost) || 0,
      discount: Number(r.discount) || 0,
      total: Number(r.total) || 0,
      items: parseReportItems(r.items),
    }))
    .filter((o) => o.code.length > 0)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/**
 * Aggregate orders into report stats.
 * - `totalSpent` / `itemCount` / `avgOrder` exclude cancelled orders
 *   (a cancelled parcel never cost the user anything).
 * - `byStatus` only lists statuses that actually occur (no zero rows).
 */
export function buildOrderReportStats(orders: OrderReportOrder[]): OrderReportStats {
  const byStatus: Record<string, number> = {};
  let totalSpent = 0;
  let itemCount = 0;
  let cancelledCount = 0;
  for (const o of orders) {
    byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
    if (o.status === "cancelled") {
      cancelledCount++;
      continue;
    }
    totalSpent += o.total;
    itemCount += o.items.reduce((s, it) => s + it.qty, 0);
  }
  const active = orders.length - cancelledCount;
  const times = orders.map((o) => o.createdAt).filter((t) => t.length > 0).sort();
  return {
    total: orders.length,
    byStatus,
    totalSpent,
    cancelledCount,
    itemCount,
    avgOrder: active > 0 ? Math.round(totalSpent / active) : 0,
    from: times.length > 0 ? times[0] : null,
    to: times.length > 0 ? times[times.length - 1] : null,
  };
}

/** Full report: normalized orders + stats + generation stamp. */
export function buildOrderReport(rows: RawOrderLike[], now: Date = new Date()): OrderReport {
  const orders = toReportOrders(rows);
  return { stats: buildOrderReportStats(orders), orders, generatedAt: now.toISOString() };
}

/* ── 2. print-ready HTML ────────────────────────────────────────────────── */

/** Date rendering: fa → Jalali via the shared formatter, en → ISO date. */
function renderDate(iso: string, lang: ReportLang): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  if (lang === "fa") {
    const { jy, jm, jd } = toJalali(d);
    return faNum(`${jy}/${String(jm).padStart(2, "0")}/${String(jd).padStart(2, "0")}`);
  }
  return iso.slice(0, 10);
}

const T = {
  fa: {
    title: "گزارش سفارش‌ها",
    brand: "جهان‌گیاه",
    subtitle: "تاریخچه خریدهای سبز شما",
    generated: "تاریخ تهیه",
    orders: "سفارش",
    totalSpent: "مجموع خرید",
    avgOrder: "میانگین سفارش",
    items: "اقلام",
    cancelled: "لغوشده",
    colCode: "کد",
    colDate: "تاریخ",
    colStatus: "وضعیت",
    colItems: "اقلام سفارش",
    colPayment: "پرداخت",
    colTotal: "مبلغ (تومان)",
    cod: "در محل",
    online: "آنلاین",
    grandTotal: "جمع کل خریدهای فعال",
    footer: "این گزارش به‌صورت خودکار توسط جهان‌گیاه تهیه شده است.",
    none: "هنوز سفارشی ثبت نشده است.",
  },
  en: {
    title: "Order Report",
    brand: "PlantVerse",
    subtitle: "Your green purchase history",
    generated: "Generated",
    orders: "Orders",
    totalSpent: "Total spent",
    avgOrder: "Average order",
    items: "Items",
    cancelled: "Cancelled",
    colCode: "Code",
    colDate: "Date",
    colStatus: "Status",
    colItems: "Order items",
    colPayment: "Payment",
    colTotal: "Amount (Toman)",
    cod: "On delivery",
    online: "Online",
    grandTotal: "Grand total (active orders)",
    footer: "This report was generated automatically by PlantVerse.",
    none: "No orders have been placed yet.",
  },
} as const;

/**
 * Render the report as a standalone HTML document for printing.
 * Self-contained: inline CSS only (no web fonts — system stack), A4-ish
 * page margins via @page, dir/lang per language. Deterministic output.
 */
export function buildOrderReportHtml(report: OrderReport, lang: ReportLang): string {
  const t = T[lang];
  const rtl = lang === "fa";
  const esc = htmlEscape;
  const st = report.stats;

  const statCards = [
    { label: t.orders, value: money(st.total, lang) },
    { label: t.totalSpent, value: `${money(st.totalSpent, lang)}` },
    { label: t.avgOrder, value: `${money(st.avgOrder, lang)}` },
    { label: t.items, value: money(st.itemCount, lang) },
  ]
    .map(
      (c) =>
        `<div class="card"><p class="card-label">${esc(c.label)}</p><p class="card-value">${esc(c.value)}</p></div>`
    )
    .join("");

  const statusChips = Object.entries(st.byStatus)
    .sort((a, b) => b[1] - a[1])
    .map(([s, n]) => {
      const meta = REPORT_STATUS_META[s] ?? { fa: s, en: s };
      return `<span class="chip">${esc(rtl ? meta.fa : meta.en)}: ${esc(money(n, lang))}</span>`;
    })
    .join("");

  const rows = report.orders
    .map((o) => {
      const meta = REPORT_STATUS_META[o.status] ?? { fa: o.status, en: o.status };
      const itemsText = o.items
        .map((it) => `${esc(rtl ? it.nameFa || it.nameEn : it.nameEn || it.nameFa)} ×${esc(money(it.qty, lang))}`)
        .join(rtl ? "، " : ", ");
      const payment = o.paymentMethod === "cod" ? t.cod : t.online;
      return `<tr>
  <td class="mono">${esc(o.code)}</td>
  <td>${esc(renderDate(o.createdAt, lang))}</td>
  <td>${esc(rtl ? meta.fa : meta.en)}</td>
  <td class="items-cell">${itemsText || "—"}</td>
  <td>${esc(payment)}</td>
  <td class="num">${esc(money(o.total, lang))}</td>
</tr>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="${lang}" dir="${rtl ? "rtl" : "ltr"}">
<head>
<meta charset="utf-8">
<title>${esc(t.title)} · ${esc(t.brand)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: Vazirmatn, "Segoe UI", Tahoma, Arial, sans-serif;
    color: #1c2b23; font-size: 12px; line-height: 1.7;
    background: #fff; padding: 4px;
  }
  .brand-row { display: flex; align-items: center; gap: 10px; border-bottom: 3px solid #2f6b4f; padding-bottom: 10px; }
  .leaf {
    width: 34px; height: 34px; border-radius: 10px; background: #2f6b4f;
    display: flex; align-items: center; justify-content: center;
    color: #fff; font-size: 18px; flex: 0 0 auto;
  }
  h1 { font-size: 19px; }
  .sub { color: #5b6f63; font-size: 11px; }
  .meta-line { margin-top: 8px; color: #5b6f63; font-size: 10.5px; display: flex; gap: 14px; flex-wrap: wrap; }
  .cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 14px 0 10px; }
  .card { border: 1px solid #dbe7df; border-radius: 10px; padding: 8px 10px; background: #f4faf6; }
  .card-label { color: #5b6f63; font-size: 10px; }
  .card-value { font-size: 15px; font-weight: 800; margin-top: 2px; }
  .chips { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }
  .chip { border: 1px solid #dbe7df; background: #f4faf6; border-radius: 999px; padding: 2px 10px; font-size: 10.5px; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #dbe7df; padding: 6px 8px; text-align: ${rtl ? "right" : "left"}; vertical-align: top; }
  th { background: #2f6b4f; color: #fff; font-size: 10.5px; font-weight: 800; white-space: nowrap; }
  tr:nth-child(even) td { background: #f7fbf8; }
  .mono { font-family: ui-monospace, Menlo, Consolas, monospace; font-weight: 700; white-space: nowrap; }
  .items-cell { font-size: 10.5px; color: #3c5246; }
  .num { font-weight: 800; white-space: nowrap; }
  .total-row td { background: #eef6f1 !important; font-weight: 800; }
  .empty { padding: 26px; text-align: center; color: #5b6f63; border: 1px dashed #dbe7df; border-radius: 12px; margin-top: 14px; }
  .footer { margin-top: 16px; padding-top: 8px; border-top: 1px solid #dbe7df; color: #7a8c81; font-size: 9.5px; text-align: center; }
  @media print { .card, .chip, th { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
  <div class="brand-row">
    <span class="leaf">🌿</span>
    <div>
      <h1>${esc(t.title)}</h1>
      <p class="sub">${esc(t.brand)} — ${esc(t.subtitle)}</p>
    </div>
  </div>
  <p class="meta-line">
    <span>${esc(t.generated)}: ${esc(renderDate(report.generatedAt, lang))}</span>
    ${st.from ? `<span>${esc(rtl ? "بازه" : "Range")}: ${esc(renderDate(st.from, lang))} → ${esc(renderDate(st.to ?? st.from, lang))}</span>` : ""}
  </p>
  ${report.orders.length === 0 ? `<div class="empty">${esc(t.none)}</div>` : `
  <div class="cards">${statCards}</div>
  <div class="chips">${statusChips}</div>
  <table>
    <thead>
      <tr>
        <th>${esc(t.colCode)}</th>
        <th>${esc(t.colDate)}</th>
        <th>${esc(t.colStatus)}</th>
        <th>${esc(t.colItems)}</th>
        <th>${esc(t.colPayment)}</th>
        <th>${esc(t.colTotal)}</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
      <tr class="total-row">
        <td colspan="5">${esc(t.grandTotal)}</td>
        <td class="num">${esc(money(st.totalSpent, lang))}</td>
      </tr>
    </tbody>
  </table>`}
  <p class="footer">${esc(t.footer)} · ${esc(t.brand)} 🌿</p>
</body>
</html>`;
}
