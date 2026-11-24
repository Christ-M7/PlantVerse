import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * POST /api/reminders/ics/subscribe — mint (or return) the care-calendar
 * subscription token.
 *
 * The app is a single-viewer experience, so the subscription is a global
 * SINGLETON: the first call creates one `PV-CAL-XXXXXXXXXX` token, every
 * later call returns the same row (idempotent — a calendar client only ever
 * needs one stable URL). Lang is NOT baked into the token: it travels as a
 * query param on the feed URL so one subscription serves both languages.
 */

const ALPHABET = "ABCDEFGHJKNPQRSTUVWXYZ23456789"; // share-code family: no I/L/O/0/1

function mintToken(): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let body = "";
  for (const b of bytes) body += ALPHABET[b % ALPHABET.length];
  return `PV-CAL-${body}`;
}

export async function POST() {
  try {
    const existing = await db.calendarSubscription.findFirst();
    if (existing) {
      return NextResponse.json({
        success: true,
        created: false,
        token: existing.token,
        path: `/api/reminders/ics?token=${existing.token}`,
        hits: existing.hits,
        lastHitAt: existing.lastHitAt,
        createdAt: existing.createdAt,
      });
    }

    const sub = await db.calendarSubscription.create({ data: { token: mintToken() } });
    return NextResponse.json(
      {
        success: true,
        created: true,
        token: sub.token,
        path: `/api/reminders/ics?token=${sub.token}`,
        hits: 0,
        lastHitAt: null,
        createdAt: sub.createdAt,
      },
      { status: 201 }
    );
  } catch {
    return NextResponse.json({ success: false, error: "server_error" }, { status: 500 });
  }
}
