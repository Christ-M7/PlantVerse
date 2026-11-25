import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { relativeTimeEn, relativeTimeFa } from "@/lib/relative-time";
import { PV_EXPERTS, PV_TRENDING } from "@/data/fixtures";
import { pruneSnapshots } from "@/server/garden-restore";

export const dynamic = "force-dynamic";

/** A post auto-hides from the public feed at this many distinct reports. */
export const COMMUNITY_HIDE_THRESHOLD = 5;

const postSchema = z.object({
  title: z.string().max(120).default(""), // empty = no headline (short posts)
  content: z.string().min(2).max(2000),
  category: z.enum(["general", "question", "achievement"]).default("general"),
  authorName: z.string().max(60).default("سارا محمدی"),
  /** stable viewer identity (localStorage) — "" = legacy/anon client */
  authorKey: z.string().max(64).default(""),
});

/**
 * timeAgo must never be a frozen label — it is recomputed from createdAt on
 * every read so posts age naturally. Stored timeAgo columns remain only as a
 * legacy fallback for rows without a timestamp.
 */
const withLiveTimeAgo = <T extends { createdAt: Date; timeAgoFa: string; timeAgoEn: string }>(
  row: T
): T => ({
  ...row,
  timeAgoFa: row.createdAt ? relativeTimeFa(row.createdAt) : row.timeAgoFa,
  timeAgoEn: row.createdAt ? relativeTimeEn(row.createdAt) : row.timeAgoEn,
});

/** Post ids hidden by community reports (distinct reporters ≥ threshold). */
async function hiddenPostIds(): Promise<string[]> {
  const grouped = await db.postReport.groupBy({
    by: ["postId"],
    _count: { postId: true },
    having: { postId: { _count: { gte: COMMUNITY_HIDE_THRESHOLD } } },
  });
  return grouped.map((g) => g.postId);
}

/** GET /api/community — feed + experts + trending; ?postId= → comment thread */
export async function GET(req: Request) {
  try {
    const postId = new URL(req.url).searchParams.get("postId");
    if (postId) {
      const comments = await db.comment.findMany({
        where: { postId },
        orderBy: { createdAt: "asc" },
        take: 50,
        select: {
          id: true,
          authorName: true,
          authorKey: true,
          parentId: true,
          content: true,
          createdAt: true,
        },
      });
      return NextResponse.json({ success: true, comments });
    }
    const [posts, hidden] = await Promise.all([
      db.communityPost.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
      hiddenPostIds(),
    ]);
    return NextResponse.json({
      success: true,
      posts: posts.filter((p) => !hidden.includes(p.id)).map(withLiveTimeAgo),
      experts: PV_EXPERTS,
      trending: PV_TRENDING,
    });
  } catch (err) {
    console.error("[community:GET]", err);
    return NextResponse.json({ success: false, error: "server_error" }, { status: 500 });
  }
}

/** POST /api/community — publish a post, add a comment, or report abuse */
export async function POST(req: Request) {
  try {
    const raw = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    if (raw?.type === "comment") {
      const parsed = commentSchema.safeParse(raw);
      if (!parsed.success) {
        return NextResponse.json({ success: false, error: "invalid_body" }, { status: 400 });
      }
      const { postId, content, authorName, authorKey, parentId } = parsed.data;
      const exists = await db.communityPost.findUnique({ where: { id: postId }, select: { id: true } });
      if (!exists) {
        return NextResponse.json({ success: false, error: "post_not_found" }, { status: 404 });
      }
      /* reply integrity — the parent must exist on the SAME post; a stale
         or cross-post parentId degrades to a top-level comment (never 500) */
      let safeParentId = "";
      if (parentId) {
        const parent = await db.comment.findFirst({
          where: { id: parentId, postId },
          select: { id: true },
        });
        safeParentId = parent?.id ?? "";
      }
      const [comment] = await db.$transaction([
        db.comment.create({
          data: { postId, content: content.trim(), authorName, authorKey, parentId: safeParentId, authorAvatar: "/images/avatar-w1.jpg" },
        }),
        db.communityPost.update({ where: { id: postId }, data: { comments: { increment: 1 } } }),
      ]);
      return NextResponse.json({ success: true, comment }, { status: 201 });
    }

    if (raw?.type === "undo_delete") {
      const parsed = undoDeleteSchema.safeParse(raw);
      if (!parsed.success) {
        return NextResponse.json({ success: false, error: "invalid_body" }, { status: 400 });
      }
      const { snapshotId, authorName, viewerKey } = parsed.data;
      const snap = await db.snapshot.findUnique({ where: { id: snapshotId } });
      if (!snap || snap.kind !== "post") {
        return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
      }
      let payload: { post?: Record<string, unknown>; comments?: Record<string, unknown>[] } | null = null;
      try {
        payload = JSON.parse(snap.payload) as { post?: Record<string, unknown>; comments?: Record<string, unknown>[] };
      } catch {
        payload = null;
      }
      const p = payload?.post;
      if (!p || typeof p !== "object") {
        return NextResponse.json({ success: false, error: "corrupt_snapshot" }, { status: 422 });
      }
      /* the undo belongs to whoever deleted it — same two-track guard as
         the delete itself (key first, legacy name fallback) */
      const storedKey = typeof p.authorKey === "string" ? p.authorKey : "";
      const storedName = typeof p.authorName === "string" ? p.authorName : "";
      const keyMatch = Boolean(viewerKey && storedKey && viewerKey === storedKey);
      const nameMatch = Boolean(authorName && storedName && authorName === storedName);
      if (!keyMatch && !nameMatch) {
        return NextResponse.json({ success: false, error: "forbidden" }, { status: 403 });
      }
      const comments = Array.isArray(payload?.comments) ? payload!.comments : [];
      const restored = await db.$transaction(async (tx) => {
        const post = await tx.communityPost.create({
          data: {
            authorName: storedName || "سارا محمدی",
            authorKey: storedKey,
            authorRole: typeof p.authorRole === "string" ? p.authorRole : "عضو جامعه",
            authorAvatar: typeof p.authorAvatar === "string" ? p.authorAvatar : "/images/avatar-w1.jpg",
            verified: p.verified === true,
            title: typeof p.title === "string" ? p.title.slice(0, 120) : "",
            content: typeof p.content === "string" ? p.content.slice(0, 2000) : "",
            image: typeof p.image === "string" ? p.image : "",
            category: ["general", "question", "achievement"].includes(String(p.category)) ? String(p.category) : "general",
            likes: typeof p.likes === "number" ? Math.max(0, Math.round(p.likes)) : 0,
            comments: comments.length,
            shares: typeof p.shares === "number" ? Math.max(0, Math.round(p.shares)) : 0,
            liked: false,
            bookmarked: false,
            timeAgoFa: "همین حالا",
            timeAgoEn: "just now",
            createdAt: typeof p.createdAt === "string" && !Number.isNaN(new Date(p.createdAt).getTime()) ? new Date(p.createdAt) : new Date(),
          },
        });
        if (comments.length > 0) {
          await tx.comment.createMany({
            data: comments.slice(0, 200).map((c) => ({
              postId: post.id,
              authorName: typeof c.authorName === "string" ? c.authorName.slice(0, 60) : "ناشناس",
              authorKey: typeof c.authorKey === "string" ? c.authorKey.slice(0, 64) : "",
              parentId: "", // threads flatten on restore — content is intact
              content: typeof c.content === "string" ? c.content.slice(0, 600) : "",
              authorAvatar: typeof c.authorAvatar === "string" ? c.authorAvatar : "",
              createdAt: typeof c.createdAt === "string" && !Number.isNaN(new Date(c.createdAt).getTime()) ? new Date(c.createdAt) : new Date(),
            })),
          });
        }
        return post;
      });
      await db.snapshot.delete({ where: { id: snapshotId } }); // one-shot undo
      return NextResponse.json({ success: true, post: withLiveTimeAgo(restored) }, { status: 201 });
    }

    if (raw?.type === "report") {
      const parsed = reportSchema.safeParse(raw);
      if (!parsed.success) {
        return NextResponse.json({ success: false, error: "invalid_body" }, { status: 400 });
      }
      const { postId, reason, note } = parsed.data;
      const exists = await db.communityPost.findUnique({ where: { id: postId }, select: { id: true } });
      if (!exists) {
        return NextResponse.json({ success: false, error: "post_not_found" }, { status: 404 });
      }
      const reporterKey = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
      let duplicate = false;
      try {
        await db.postReport.create({ data: { postId, reporterKey, reason, note: note.trim().slice(0, 300) } });
      } catch {
        // unique (postId, reporterKey) violated — same reporter already flagged this post
        duplicate = true;
      }
      const reports = await db.postReport.count({ where: { postId } });
      return NextResponse.json({
        success: true,
        duplicate,
        reports,
        hidden: reports >= COMMUNITY_HIDE_THRESHOLD,
      });
    }

    const parsed = postSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: "invalid_body" }, { status: 400 });
    }
    const { title, content, category, authorName, authorKey } = parsed.data;
    const post = await db.communityPost.create({
      data: {
        title: title.trim(),
        content: content.trim(),
        category,
        authorName,
        authorKey,
        authorRole: "عضو جامعه",
        authorAvatar: "/images/avatar-w1.jpg",
        timeAgoFa: "همین حالا",
        timeAgoEn: "just now",
      },
    });
    return NextResponse.json({ success: true, post: withLiveTimeAgo(post) }, { status: 201 });
  } catch {
    return NextResponse.json({ success: false, error: "server_error" }, { status: 500 });
  }
}

const commentSchema = z.object({
  type: z.literal("comment"),
  postId: z.string().min(1),
  content: z.string().min(1).max(600),
  authorName: z.string().max(60).default("سارا محمدی"),
  /** stable viewer identity — "" = legacy/anon client */
  authorKey: z.string().max(64).default(""),
  /** reply target id — validated server-side, degrades to top-level */
  parentId: z.string().max(64).default(""),
});

const reportSchema = z.object({
  type: z.literal("report"),
  postId: z.string().min(1),
  reason: z.enum(["spam", "inappropriate", "misleading", "other"]),
  note: z.string().max(300).default(""),
});

const undoDeleteSchema = z.object({
  type: z.literal("undo_delete"),
  snapshotId: z.string().min(1).max(64),
  authorName: z.string().min(1).max(60).optional(),
  viewerKey: z.string().min(1).max(64).optional(),
});

/* ── PATCH /api/community — like / bookmark / share ──────────────────────── */

const patchSchema = z.object({
  id: z.string().min(1),
  action: z.enum(["like", "bookmark", "share"]),
});

export async function PATCH(req: Request) {
  try {
    const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: "invalid_body" }, { status: 400 });
    }
    const { id, action } = parsed.data;
    const current = await db.communityPost.findUnique({ where: { id } });
    if (!current) {
      return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
    }

    // atomic ±1 — a read-modify-write here would double-apply on concurrent likes
    const data =
      action === "like"
        ? { liked: !current.liked, likes: { increment: current.liked ? -1 : 1 } }
        : action === "share"
          ? { shares: { increment: 1 } }
          : { bookmarked: !current.bookmarked };

    const post = await db.communityPost.update({ where: { id }, data });
    return NextResponse.json({ success: true, post: withLiveTimeAgo(post) });
  } catch {
    return NextResponse.json({ success: false, error: "server_error" }, { status: 500 });
  }
}

/* ── DELETE /api/community — delete your own post ────────────────────────── */

const deleteSchema = z
  .object({
    postId: z.string().min(1),
    authorName: z.string().min(1).max(60).optional(),
    viewerKey: z.string().min(1).max(64).optional(),
  })
  .refine((d) => Boolean(d.authorName || d.viewerKey), {
    message: "author_name_or_viewer_key_required",
  });

export async function DELETE(req: Request) {
  try {
    const parsed = deleteSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: "invalid_body" }, { status: 400 });
    }
    const { postId, authorName, viewerKey } = parsed.data;
    const post = await db.communityPost.findUnique({ where: { id: postId } });
    if (!post) {
      return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
    }
    // demo-level ownership guard — viewer key first (real identity), legacy
    // display-name fallback for rows authored before authorKey existed
    const keyMatch = Boolean(viewerKey && post.authorKey && viewerKey === post.authorKey);
    const nameMatch = Boolean(authorName && post.authorName === authorName);
    if (!keyMatch && !nameMatch) {
      return NextResponse.json({ success: false, error: "forbidden" }, { status: 403 });
    }
    /* capture BEFORE the delete — comments cascade away with the post */
    const comments = await db.comment.findMany({
      where: { postId },
      orderBy: { createdAt: "asc" },
      take: 200,
    });

    await db.$transaction([
      db.postReport.deleteMany({ where: { postId } }),
      db.communityPost.delete({ where: { id: postId } }), // comments cascade via FK
    ]);

    /* safety net — bank the deleted post + comments so one click brings
       it back (best-effort: a failed capture never blocks the delete) */
    let undoSnapshotId: string | null = null;
    try {
      const row = await db.snapshot.create({
        data: {
          kind: "post",
          reason: "post_delete",
          label: post.title.slice(0, 60) || post.content.slice(0, 60),
          itemCount: comments.length,
          payload: JSON.stringify({
            post: {
              authorName: post.authorName,
              authorKey: post.authorKey,
              authorRole: post.authorRole,
              authorAvatar: post.authorAvatar,
              verified: post.verified,
              title: post.title,
              content: post.content,
              image: post.image,
              category: post.category,
              likes: post.likes,
              shares: post.shares,
              createdAt: post.createdAt.toISOString(),
            },
            comments: comments.map((c) => ({
              authorName: c.authorName,
              authorKey: c.authorKey,
              authorAvatar: c.authorAvatar,
              content: c.content,
              createdAt: c.createdAt.toISOString(),
            })),
          }),
        },
      });
      undoSnapshotId = row.id;
      await pruneSnapshots(db, "post");
    } catch {
      /* the delete already succeeded — undo is a bonus, not a blocker */
    }

    return NextResponse.json({ success: true, undoSnapshotId });
  } catch {
    return NextResponse.json({ success: false, error: "server_error" }, { status: 500 });
  }
}
