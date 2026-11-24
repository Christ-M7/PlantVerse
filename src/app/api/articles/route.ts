import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Hard cap on list size — mirrors the fixed magazine catalog size. */
const MAX_LIMIT = 40;

/** Parse a JSON string[] column that may arrive as a string (DB) or array. */
function asArray(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === "string");
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * GET /api/articles — magazine article list.
 * Query params:
 *   category  exact category match, or "all" / omitted for everything
 *   q         free-text search across fa+en titles & excerpts (case-insensitive)
 *   tag       matches any bilingual tag (case-insensitive)
 *   limit     1..MAX_LIMIT (default MAX_LIMIT)
 *   slugs     comma-separated slug list — returns exactly those rows, in the
 *             requested order (duplicates/whitespace collapsed, unknown slugs
 *             silently dropped). Powers the profile reading list.
 * q/tag filtering runs in-memory: SQLite LIKE has no case folding and the
 * catalog is tiny, so this keeps semantics identical for fa and en.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const category = url.searchParams.get("category") ?? undefined;
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    const tag = (url.searchParams.get("tag") ?? "").trim().toLowerCase();
    const limitRaw = Number(url.searchParams.get("limit") ?? "");
    const limit = Number.isFinite(limitRaw) && limitRaw >= 1
      ? Math.min(Math.floor(limitRaw), MAX_LIMIT)
      : MAX_LIMIT;
    /** Present-but-empty (`slugs=`) means "exactly these zero slugs" → [].
     *  Only an absent param falls back to the normal catalog list. */
    const slugsParam = url.searchParams.get("slugs");
    const slugs = slugsParam === null
      ? null
      : [...new Set(slugsParam.split(",").map((s) => s.trim()).filter(Boolean))].slice(0, MAX_LIMIT);

    /**
     * slugs mode: query the exact rows (slug.in bounds the result, so no
     * take/orderBy) then reorder to mirror the caller's list order — the
     * reading list keeps the user's bookmark chronology.
     */
    let rows: Awaited<ReturnType<typeof db.article.findMany>>;
    if (slugs) {
      const found = await db.article.findMany({
        where: {
          slug: { in: slugs },
          ...(category && category !== "all" ? { category } : {}),
        },
      });
      const bySlug = new Map(found.map((r) => [r.slug, r]));
      rows = slugs.flatMap((s) => {
        const row = bySlug.get(s);
        return row ? [row] : [];
      });
    } else {
      rows = await db.article.findMany({
        where: category && category !== "all" ? { category } : {},
        orderBy: [{ featured: "desc" }, { publishedAt: "desc" }],
        take: MAX_LIMIT,
      });
    }

    const filtered = rows.filter((r) => {
      if (q) {
        const haystack = `${r.titleFa}\n${r.titleEn}\n${r.excerptFa}\n${r.excerptEn}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (tag) {
        const tags = [...asArray(r.tagsFa), ...asArray(r.tagsEn)].map((t) => t.toLowerCase());
        if (!tags.some((t) => t.includes(tag))) return false;
      }
      return true;
    });

    return NextResponse.json({
      success: true,
      articles: filtered.slice(0, limit),
      total: filtered.length,
    });
  } catch {
    return NextResponse.json({ success: false, error: "server_error" }, { status: 500 });
  }
}
