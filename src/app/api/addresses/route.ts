import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/* ─────────────────────────── business rules ─────────────────────────── */

const MAX_ADDRESSES = 10; // a generous but bounded address book

/* Persian ۰-۹ AND Arabic-Indic ٠-٩ both normalize to Latin — some
   keyboards/layouts emit the U+0660 range which used to fail /^09\d{9}$/ */
const FA_DIGITS = /[۰-۹٠-٩]/g;
const faToEnDigits = (s: string) =>
  s.replace(FA_DIGITS, (d) => String("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩".indexOf(d) % 10));

const PHONE_RE = /^09\d{9}$/;
const POSTAL_RE = /^\d{10}$/;

const cleanText = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

interface AddressPayload {
  label: string;
  customerName: string;
  phone: string;
  province: string;
  city: string;
  address: string;
  postalCode: string;
  note: string;
}

/** Normalize + validate an incoming address payload. Returns fields + error map. */
function parseAddress(body: Record<string, unknown>): {
  data: AddressPayload;
  errors: Record<string, string>;
} {
  const data: AddressPayload = {
    label: cleanText(body.label, 30),
    customerName: cleanText(body.customerName, 80),
    phone: faToEnDigits(cleanText(body.phone, 16)).replace(/[\s-]/g, ""),
    province: cleanText(body.province, 40),
    city: cleanText(body.city, 40),
    address: cleanText(body.address, 300),
    postalCode: faToEnDigits(cleanText(body.postalCode, 12)).replace(/[\s-]/g, ""),
    note: cleanText(body.note, 300),
  };

  const errors: Record<string, string> = {};
  if (data.customerName.length < 3) errors.customerName = "invalid";
  if (!PHONE_RE.test(data.phone)) errors.phone = "invalid";
  if (data.province.length < 2) errors.province = "invalid";
  if (data.city.length < 2) errors.city = "invalid";
  if (data.address.length < 10) errors.address = "invalid";
  if (data.postalCode && !POSTAL_RE.test(data.postalCode)) errors.postalCode = "invalid";

  return { data, errors };
}

/* ─────────────────────────── GET /api/addresses ─────────────────────────── */

/** All saved addresses — the default one first, then most recently updated. */
export async function GET() {
  try {
    const addresses = await db.address.findMany({
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
    });
    return NextResponse.json({ success: true, addresses });
  } catch {
    return NextResponse.json({ success: false, error: "server_error" }, { status: 500 });
  }
}

/* ─────────────────────────── POST /api/addresses ─────────────────────────── */

/**
 * Save a new address. Exactly one row is the default: the first ever address
 * is forced to default; an explicit `isDefault: true` demotes all others.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const { data, errors } = parseAddress(body);
    if (Object.keys(errors).length > 0) {
      return NextResponse.json({ success: false, error: "validation", errors }, { status: 400 });
    }

    const count = await db.address.count();
    if (count >= MAX_ADDRESSES) {
      return NextResponse.json(
        { success: false, error: "limit_reached", limit: MAX_ADDRESSES },
        { status: 409 }
      );
    }

    const wantsDefault = body.isDefault === true || count === 0;

    const address = await db.$transaction(async (tx) => {
      if (wantsDefault) {
        await tx.address.updateMany({ data: { isDefault: false } });
      }
      return tx.address.create({
        data: { ...data, isDefault: wantsDefault },
      });
    });

    return NextResponse.json({ success: true, address }, { status: 201 });
  } catch {
    return NextResponse.json({ success: false, error: "server_error" }, { status: 500 });
  }
}

/* ─────────────────────────── PATCH /api/addresses ─────────────────────────── */

/**
 * Update an existing address by `id`. All fields are optional — only the
 * provided ones change. Setting `isDefault: true` demotes every other row.
 */
export async function PATCH(req: Request) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const id = cleanText(body.id, 40);
    if (!id) {
      return NextResponse.json({ success: false, error: "missing_id" }, { status: 400 });
    }

    const existing = await db.address.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
    }

    // Partial update: only fields present in the payload are considered.
    const merged: Record<string, unknown> = {
      label: body.label !== undefined ? cleanText(body.label, 30) : existing.label,
      customerName:
        body.customerName !== undefined ? cleanText(body.customerName, 80) : existing.customerName,
      phone:
        body.phone !== undefined
          ? faToEnDigits(cleanText(body.phone, 16)).replace(/[\s-]/g, "")
          : existing.phone,
      province: body.province !== undefined ? cleanText(body.province, 40) : existing.province,
      city: body.city !== undefined ? cleanText(body.city, 40) : existing.city,
      address: body.address !== undefined ? cleanText(body.address, 300) : existing.address,
      postalCode:
        body.postalCode !== undefined
          ? faToEnDigits(cleanText(body.postalCode, 12)).replace(/[\s-]/g, "")
          : existing.postalCode,
      note: body.note !== undefined ? cleanText(body.note, 300) : existing.note,
    };

    const errors: Record<string, string> = {};
    if (String(merged.customerName).length < 3) errors.customerName = "invalid";
    if (!PHONE_RE.test(String(merged.phone))) errors.phone = "invalid";
    if (String(merged.province).length < 2) errors.province = "invalid";
    if (String(merged.city).length < 2) errors.city = "invalid";
    if (String(merged.address).length < 10) errors.address = "invalid";
    if (merged.postalCode && !POSTAL_RE.test(String(merged.postalCode))) errors.postalCode = "invalid";
    if (Object.keys(errors).length > 0) {
      return NextResponse.json({ success: false, error: "validation", errors }, { status: 400 });
    }

    const wantsDefault = body.isDefault === true;

    const address = await db.$transaction(async (tx) => {
      if (wantsDefault) {
        await tx.address.updateMany({
          where: { id: { not: id } },
          data: { isDefault: false },
        });
      }
      return tx.address.update({
        where: { id },
        data: { ...merged, isDefault: wantsDefault ? true : existing.isDefault },
      });
    });

    return NextResponse.json({ success: true, address });
  } catch {
    return NextResponse.json({ success: false, error: "server_error" }, { status: 500 });
  }
}

/* ─────────────────────────── DELETE /api/addresses ─────────────────────────── */

/**
 * Delete by id (JSON body or ?id= query). If the deleted row was the default,
 * the most recently updated remaining address is promoted so the book always
 * has a default while it is non-empty.
 */
export async function DELETE(req: Request) {
  try {
    let id = "";
    const url = new URL(req.url);
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      id = cleanText(body.id, 40);
    }
    if (!id) id = cleanText(url.searchParams.get("id"), 40);

    if (!id) {
      return NextResponse.json({ success: false, error: "missing_id" }, { status: 400 });
    }

    const existing = await db.address.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
    }

    await db.address.delete({ where: { id } });

    // Keep exactly one default in a non-empty book.
    if (existing.isDefault) {
      const next = await db.address.findFirst({ orderBy: { updatedAt: "desc" } });
      if (next) {
        await db.address.update({ where: { id: next.id }, data: { isDefault: true } });
      }
    }

    return NextResponse.json({ success: true, id });
  } catch {
    return NextResponse.json({ success: false, error: "server_error" }, { status: 500 });
  }
}
