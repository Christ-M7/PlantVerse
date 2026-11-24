import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { SHARE_CODE_ALPHABET, SHARE_CODE_LENGTH, normalizeShareCode } from "@/lib/share-code";

export const dynamic = "force-dynamic";

/**
 * Garden list sharing — generalizes the reading-list share mechanism to the
 * user's garden snapshot (mirrors the proven reading-list share route).
 *
 * POST   — snapshot the CURRENT garden's catalog plantSlugs under a fresh
 *          8-char code (the garden lives server-side, so no body is needed;
 *          an empty/invalid garden answers 400 `empty_garden`). Snapshot
 *          semantics: later garden edits do NOT rewrite the shared list.
 * GET    — `?code=XXXX` previews the snapshot: hydrates catalog plants in
 *          stored order, increments the views counter, and answers
 *          404 `not_found` for unknown codes AND for reading-list codes
 *          (kind isolation — each code resolves only in its own importer).
 */

const MAX_SLUGS = 40; // same cap as /api/reading-list/share and /api/articles?slugs=

/** Random code from the unambiguous alphabet (collision retries on insert). */
const newCode = () =>
  [...randomBytes(SHARE_CODE_LENGTH)]
    .map((b) => SHARE_CODE_ALPHABET[b % SHARE_CODE_ALPHABET.length])
    .join("");

export async function POST() {
  try {
    /* snapshot in garden insertion order (createdAt asc mirrors the UI) */
    const garden = await db.gardenPlant.findMany({
      orderBy: { createdAt: "asc" },
      select: { plantSlug: true },
    });
    const requested = [...new Set(garden.map((g) => g.plantSlug.trim()).filter(Boolean))].slice(0, MAX_SLUGS);

    if (requested.length === 0) {
      return NextResponse.json({ success: false, error: "empty_garden" }, { status: 400 });
    }

    /* only catalog-backed slugs are shareable; orphans are dropped and reported */
    const found = await db.plant.findMany({
      where: { slug: { in: requested } },
      select: { slug: true },
    });
    const valid = new Set(found.map((r) => r.slug));
    const slugs = requested.filter((s) => valid.has(s));
    if (slugs.length === 0) {
      return NextResponse.json({ success: false, error: "empty_garden" }, { status: 400 });
    }
    const dropped = requested.length - slugs.length;

    /* collision-safe insert (alphabet has no I/L/O, codes are uppercase) */
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const row = await db.sharedList.create({
          data: { code: newCode(), kind: "garden", slugs: JSON.stringify(slugs) },
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

export async function GET(req: Request) {
  try {
    const raw = new URL(req.url).searchParams.get("code") ?? "";
    const code = normalizeShareCode(raw);
    if (!code) {
      return NextResponse.json({ success: false, error: "invalid_code" }, { status: 400 });
    }

    /* kind-aware lookup — reading-list codes answer 404 here too */
    const row = await db.sharedList.findFirst({ where: { code, kind: "garden" } });
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

    /** hydrate catalog plants for the import preview, reordered to stored order */
    const found = await db.plant.findMany({
      where: { slug: { in: stored } },
      select: { slug: true, nameFa: true, nameEn: true, image: true, category: true, difficulty: true },
    });
    const bySlug = new Map(found.map((p) => [p.slug, p]));
    const plants = stored.flatMap((s) => {
      const p = bySlug.get(s);
      return p ? [p] : [];
    });

    /** every preview open counts as one view of the shared link */
    await db.sharedList.update({ where: { code }, data: { views: { increment: 1 } } });

    return NextResponse.json({
      success: true,
      code: row.code,
      count: stored.length,
      views: row.views + 1,
      plants,
    });
  } catch {
    return NextResponse.json({ success: false, error: "server_error" }, { status: 500 });
  }
}
