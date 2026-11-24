import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { SHARE_CODE_ALPHABET, SHARE_CODE_LENGTH, normalizeShareCode } from "@/lib/share-code";

export const dynamic = "force-dynamic";

/** Cap mirrors /api/articles?slugs= — a shared list never exceeds MAX_LIMIT. */
const MAX_SLUGS = 40;

/** Random code from the unambiguous alphabet (collision retries on insert). */
const newCode = () =>
  [...randomBytes(SHARE_CODE_LENGTH)]
    .map((b) => SHARE_CODE_ALPHABET[b % SHARE_CODE_ALPHABET.length])
    .join("");

/* ── POST /api/reading-list/share — snapshot a reading list under a code ── */

const shareSchema = z.object({
  slugs: z.array(z.string().max(120)).max(200).optional(),
});

export async function POST(req: Request) {
  try {
    const parsed = shareSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: "invalid_body" }, { status: 400 });
    }

    /** trim → drop empties → dedupe → cap, keeping the owner's insertion order */
    const requested = [
      ...new Set(
        (parsed.data.slugs ?? [])
          .map((s) => s.trim())
          .filter(Boolean)
      ),
    ].slice(0, MAX_SLUGS);

    if (requested.length === 0) {
      return NextResponse.json({ success: false, error: "no_valid_slugs" }, { status: 400 });
    }

    /** only slugs that actually exist in the catalog are shareable */
    const found = await db.article.findMany({
      where: { slug: { in: requested } },
      select: { slug: true },
    });
    const valid = new Set(found.map((r) => r.slug));
    const slugs = requested.filter((s) => valid.has(s));
    if (slugs.length === 0) {
      return NextResponse.json({ success: false, error: "no_valid_slugs" }, { status: 400 });
    }
    const dropped = requested.length - slugs.length;

    /** collision-safe insert (alphabet has no I/L/O, codes are uppercase) */
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const row = await db.sharedList.create({
          data: { code: newCode(), slugs: JSON.stringify(slugs) },
        });
        return NextResponse.json(
          { success: true, code: row.code, count: slugs.length, dropped },
          { status: 201 }
        );
      } catch (err) {
        const isUniqueClash =
          typeof err === "object" && err !== null && "code" in err && err.code === "P2002";
        if (!isUniqueClash || attempt === 2) throw err;
      }
    }
    return NextResponse.json({ success: false, error: "server_error" }, { status: 500 });
  } catch {
    return NextResponse.json({ success: false, error: "server_error" }, { status: 500 });
  }
}

/* ── GET /api/reading-list/share?code=XXXX — preview a shared list ─────── */

export async function GET(req: Request) {
  try {
    const raw = new URL(req.url).searchParams.get("code") ?? "";
    const code = normalizeShareCode(raw);
    if (!code) {
      return NextResponse.json({ success: false, error: "invalid_code" }, { status: 400 });
    }

    /* kind-aware lookup — a garden share code must not resolve here (and
       vice versa), otherwise the wrong importer would silently accept it. */
    const row = await db.sharedList.findFirst({ where: { code, kind: "reading" } });
    if (!row) {
      return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
    }

    let stored: string[] = [];
    try {
      const parsed: unknown = JSON.parse(row.slugs);
      if (Array.isArray(parsed)) {
        stored = parsed.filter((v): v is string => typeof v === "string");
      }
    } catch {
      /* corrupt row → treated as an empty list below */
    }

    /** hydrate titles for the import preview, reordered to the stored order */
    const found = await db.article.findMany({
      where: { slug: { in: stored } },
      select: { slug: true, titleFa: true, titleEn: true, category: true, image: true, readMinutes: true },
    });
    const bySlug = new Map(found.map((a) => [a.slug, a]));
    const articles = stored.flatMap((s) => {
      const a = bySlug.get(s);
      return a ? [a] : [];
    });

    /** every preview open counts as one view of the shared link */
    await db.sharedList.update({ where: { code }, data: { views: { increment: 1 } } });

    return NextResponse.json({
      success: true,
      code: row.code,
      count: stored.length,
      views: row.views + 1,
      articles,
    });
  } catch {
    return NextResponse.json({ success: false, error: "server_error" }, { status: 500 });
  }
}
