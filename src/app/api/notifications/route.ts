import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  allClearItem,
  buildNotifications,
  isNotificationKind,
  type NotificationAlert,
  type NotificationArticle,
  type NotificationCommunity,
  type NotificationCommunityReply,
  type NotificationEvent,
  type NotificationItem,
  type NotificationKind,
  type NotificationOrder,
  type NotificationPlant,
} from "@/lib/notifications";
import { faDigits } from "@/lib/greenhouse";
import { syncOrderProgression } from "@/server/order-sync";

export const dynamic = "force-dynamic";

/** Same auto-hide rule as the community feed — a hidden post never notifies. */
const COMMUNITY_HIDE_THRESHOLD = 5;
/** Demo profile identity — posts with this authorName are "yours".
    Overridable via ?owner= so tests can scope without touching fixtures. */
const DEFAULT_OWNER = "سارا محمدی";
/** Stable viewer identity (?viewer=) — scopes "my content" to the real
    browser, not to whoever claims the demo display name. */
const VIEWER_MAX = 64;
/** At most 3 post rollups in the feed — most recently active posts lead. */
const COMMUNITY_ROLLUP_CAP = 3;
/** ?muted= armor — token cap + per-token length cap (below). */
const MUTED_TOKEN_CAP = 8;
const MUTED_TOKEN_MAX = 30;

/**
 * GET /api/notifications — the central notification hub feed.
 *
 * Server-side aggregation across five contexts, one request:
 *   1. Garden — overdue & due-tomorrow plant tasks (catalog-enriched names)
 *   2. Garden — health watch (health below the watch floor)
 *   3. Reminders — past-due (done=false, date < today) and today's
 *      unfinished care events
 *   4. Greenhouse — band alerts logged in the last 24h
 *   5. Commerce — order status changes from the last 7 days
 *   6. Community — new comments (last 7 days) on your posts, rolled up
 *      per post, self-authored comments and auto-hidden posts excluded
 *   7. Community replies — new replies (last 7 days) to your comments on
 *      ANY post (viewerKey-scoped; legacy ?owner= scoping keeps working)
 *
 * `?muted=` — comma-separated notification kinds to silence (the digest
 * dials in the bell menu persist per-browser and arrive here). Unknown
 * tokens are ignored; if muting empties the feed, the all-clear card
 * replaces it so the panel never goes blank.
 *
 * The heavy lifting (bilingual copy, ranking, counts) lives in the pure
 * builder src/lib/notifications.ts so tests pin the rules directly.
 */
export async function GET(req: Request) {
  try {
    const now = new Date();
    /* the fulfilment clock runs before aggregation so order copy
       ("placed" → "on its way" → "delivered") reflects elapsed time */
    await syncOrderProgression(now);
    const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const owner = (() => {
      const raw = new URL(req.url).searchParams.get("owner")?.trim();
      return raw ? raw.slice(0, 60) : DEFAULT_OWNER;
    })();
    const viewer = (() => {
      const raw = new URL(req.url).searchParams.get("viewer")?.trim();
      return raw ? raw.slice(0, VIEWER_MAX) : "";
    })();
    /* digest dials — untrusted tokens are length-capped and validated
       against the known kind set; invalid ones are silently dropped */
    const mutedKinds = new Set<NotificationKind>(
      (new URL(req.url).searchParams.get("muted") ?? "")
        .split(",")
        .map((t) => t.trim().slice(0, MUTED_TOKEN_MAX))
        .filter((t) => isNotificationKind(t))
        .slice(0, MUTED_TOKEN_CAP)
    );
    /* "my posts" — viewer key first; legacy rows (authorKey "") authored
       under the demo persona stay owned by the viewer branch so pre-R39
       content keeps notifying exactly as before */
    const myPostsWhere = viewer
      ? { OR: [{ authorKey: viewer }, { authorKey: "", authorName: DEFAULT_OWNER }] }
      : { authorName: owner };
    /* "not self" — exclude both the keyed identity and the legacy name so
       a viewer-keyed comment carrying the demo name never self-notifies */
    const notSelfWhere = viewer
      ? { AND: [{ authorName: { not: owner } }, { authorKey: { not: viewer } }] }
      : { authorName: { not: owner } };

    const [garden, overdueEvents, todayEvents, alertRows, orderRows, latestArticle, overdueCount, todayCount, hiddenGroups, myCommentRows, myCommentIds] = await Promise.all([
      db.gardenPlant.findMany({
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          nickname: true,
          plantSlug: true,
          health: true,
          nextTaskType: true,
          nextTaskDays: true,
        },
      }),
      db.careEvent.findMany({
        where: { done: false, date: { lt: todayIso } },
        orderBy: [{ date: "asc" }, { createdAt: "asc" }],
        take: 20,
      }),
      db.careEvent.findMany({
        where: { done: false, date: todayIso },
        orderBy: [{ date: "asc" }, { createdAt: "asc" }],
        take: 20,
      }),
      db.ghLog.findMany({
        where: { kind: "alert", createdAt: { gte: dayAgo } },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
      db.order.findMany({
        where: { createdAt: { gte: weekAgo }, status: { in: ["paid", "preparing", "shipped"] } },
        orderBy: { createdAt: "desc" },
        take: 3,
      }),
      /* the latest magazine story — a tappable info card deep-linking into
         the article reader (featured first, then newest) */
      db.article.findMany({
        orderBy: [{ featured: "desc" }, { publishedAt: "desc" }],
        take: 1,
        select: { id: true, slug: true, titleFa: true, titleEn: true, publishedAt: true },
      }),
      /* authoritative totals — the row fetch above is capped at 20, the
         copy must still report the true number of past-due reminders */
      db.careEvent.count({ where: { done: false, date: { lt: todayIso } } }),
      db.careEvent.count({ where: { done: false, date: todayIso } }),
      /* community auto-hide set — a post buried by reports must not notify */
      db.postReport.groupBy({
        by: ["postId"],
        _count: { postId: true },
        having: { postId: { _count: { gte: COMMUNITY_HIDE_THRESHOLD } } },
      }),
      /* newest comments (≤ 7d) on YOUR posts by OTHERS — the raw rows
         are rolled up per post below; self-authored never notify */
      db.comment.findMany({
        where: {
          createdAt: { gte: weekAgo },
          ...notSelfWhere,
          post: myPostsWhere,
        },
        orderBy: { createdAt: "desc" },
        take: 60,
        select: {
          id: true,
          postId: true,
          authorName: true,
          content: true,
          createdAt: true,
          post: { select: { title: true } },
        },
      }),
      /* ids of YOUR comments (any age, any post) — the reply-thread anchor.
         Keyed identity first, legacy name fallback for pre-R39 comments. */
      db.comment.findMany({
        where: viewer ? { authorKey: viewer } : { authorName: owner },
        orderBy: { createdAt: "desc" },
        take: 200,
        select: { id: true },
      }),
    ]);

    /* reply threads need YOUR comment ids first — a second, dependent query
       after the parallel block (skipped entirely with no comments) */
    const replyRows = myCommentIds.length
      ? await db.comment.findMany({
          where: {
            createdAt: { gte: weekAgo },
            ...notSelfWhere,
            parentId: { in: myCommentIds.map((c) => c.id) },
          },
          orderBy: { createdAt: "desc" },
          take: 60,
          select: {
            id: true,
            postId: true,
            authorName: true,
            content: true,
            createdAt: true,
            post: { select: { title: true } },
          },
        })
      : [];

    /* hidden post ids resolved after the parallel block (having-clause
       groupBy result → plain id list) */
    const hiddenIds = hiddenGroups.map((g) => g.postId);

    /* rollup per post — rows arrive newest-first so the first comment seen
       for a post carries the latest actor/snippet/at, and Map insertion
       order yields newest-active posts first */
    const rollups = new Map<string, NotificationCommunity>();
    for (const c of myCommentRows) {
      if (hiddenIds.includes(c.postId)) continue;
      const existing = rollups.get(c.postId);
      if (existing) {
        existing.count += 1;
        continue;
      }
      rollups.set(c.postId, {
        postId: c.postId,
        postTitle: c.post.title,
        count: 1,
        latestActor: c.authorName,
        latestSnippet: c.content.trim().slice(0, 60),
        latestAt: c.createdAt.toISOString(),
        latestCommentId: c.id,
      });
    }
    const community: NotificationCommunity[] = [...rollups.values()].slice(0, COMMUNITY_ROLLUP_CAP);

    /* reply rollup — same shape/policy as the comment rollup but keyed to
       replies of your comments (any post, hidden posts excluded) */
    const replyRollups = new Map<string, NotificationCommunityReply>();
    for (const c of replyRows) {
      if (hiddenIds.includes(c.postId)) continue;
      const existing = replyRollups.get(c.postId);
      if (existing) {
        existing.count += 1;
        continue;
      }
      replyRollups.set(c.postId, {
        postId: c.postId,
        postTitle: c.post.title,
        count: 1,
        latestActor: c.authorName,
        latestSnippet: c.content.trim().slice(0, 60),
        latestAt: c.createdAt.toISOString(),
        latestReplyId: c.id,
      });
    }
    const communityReplies: NotificationCommunityReply[] = [...replyRollups.values()].slice(0, COMMUNITY_ROLLUP_CAP);

    /* enrich garden rows with catalog bilingual names (same policy as
       care-advice: rows without a catalog match are skipped silently) */
    const slugs = [...new Set(garden.map((g) => g.plantSlug))];
    const catalog = slugs.length
      ? await db.plant.findMany({
          where: { slug: { in: slugs } },
          select: { slug: true, nameFa: true, nameEn: true },
        })
      : [];
    const bySlug = new Map(catalog.map((p) => [p.slug, p]));

    const plants: NotificationPlant[] = garden.flatMap((g) => {
      const c = bySlug.get(g.plantSlug);
      return c
        ? [
            {
              id: g.id,
              nickname: g.nickname,
              nameFa: c.nameFa,
              nameEn: c.nameEn,
              health: g.health,
              nextTaskType: g.nextTaskType,
              nextTaskDays: g.nextTaskDays,
            },
          ]
        : [];
    });

    const eventsToItems = (rows: typeof overdueEvents): NotificationEvent[] =>
      rows.map((e) => ({
        id: e.id,
        type: e.type,
        titleFa: e.titleFa,
        titleEn: e.titleEn,
        date: e.date,
        plantNamesFa: e.plantNamesFa,
        plantNamesEn: e.plantNamesEn,
      }));

    const alerts: NotificationAlert[] = alertRows.map((a) => ({
      id: a.id,
      messageFa: a.messageFa,
      messageEn: a.messageEn,
      createdAt: a.createdAt,
    }));

    const orders: NotificationOrder[] = orderRows.map((o) => ({
      id: o.id,
      code: o.code,
      status: o.status,
      createdAt: o.createdAt,
    }));

    const article: NotificationArticle | undefined = latestArticle[0]
      ? {
          id: latestArticle[0].id,
          slug: latestArticle[0].slug,
          titleFa: latestArticle[0].titleFa,
          titleEn: latestArticle[0].titleEn,
          publishedAt: latestArticle[0].publishedAt.toISOString(),
        }
      : undefined;

    const result = buildNotifications(
      {
        now,
        todayIso,
        plants,
        overdueEvents: eventsToItems(overdueEvents),
        todayEvents: eventsToItems(todayEvents),
        alerts,
        orders,
        article,
        community,
        communityReplies,
        overdueEventCount: overdueCount,
        todayEventCount: todayCount,
      },
      faDigits
    );

    /* digest dials — silence the muted kinds AFTER aggregation (the
       rollup caps stay honest) and recompute the severity counts so the
       badge never counts a silenced card; a fully-muted feed earns the
       all-clear card instead of a blank panel */
    let items: NotificationItem[] = result.items;
    let counts = result.counts;
    if (mutedKinds.size > 0) {
      items = result.items.filter((i) => !mutedKinds.has(i.kind));
      if (items.length === 0) {
        items = [allClearItem(now)];
      }
      counts = {
        urgent: items.filter((i) => i.severity === "urgent").length,
        upcoming: items.filter((i) => i.severity === "upcoming").length,
        info: items.filter((i) => i.severity === "info").length,
      };
    }

    return NextResponse.json({ success: true, today: todayIso, items, counts });
  } catch (err) {
    console.error("[notifications]", err);
    return NextResponse.json({ success: false, error: "server_error" }, { status: 500 });
  }
}
