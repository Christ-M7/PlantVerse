import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Community Expert Groups («گروه‌های تخصصی»). 
 *
 * A topical chat surface: six deterministic groups are seeded idempotently
 * on first GET (stable `key` so concurrent callers converge on the same
 * rows). Viewers join a group, post short messages (1..280 chars, members
 * only) and leave — messages persist after leaving, like real chat history.
 * GET ?key=&thread=1 returns a group's thread: the most recent 30 members
 * and the last 50 messages in chronological order.
 */

/* ── deterministic group catalogue ───────────────────────────────────────── */

const EXPERT_GROUPS = [
  {
    slug: "watering-wisdom",
    titleFa: "آبیاری و تغذیه",
    titleEn: "Watering & feeding",
    descFa: "همه‌چیز درباره آبیاری درست، کوددهی و سلامت خاک — از تقویم تا تشخیص تشنگی گیاه.",
    descEn: "Everything about proper watering, fertilizing and soil health — from schedules to thirst signs.",
    emoji: "💧",
  },
  {
    slug: "pest-patrol",
    titleFa: "آفات و بیماری‌ها",
    titleEn: "Pests & diseases",
    descFa: "تشخیص زودهنگام، درمان‌های خانگی و تجربه‌های مبارزه با کنه، شپشک و قارچ.",
    descEn: "Early diagnosis, home remedies and real battles against mites, scale and fungus.",
    emoji: "🔍",
  },
  {
    slug: "bonsai-studio",
    titleFa: "بونسای و فرم‌دهی",
    titleEn: "Bonsai & shaping",
    descFa: "هرس ساختاری، سیم‌بست، انتخاب ظرف و صبر — هنر کوچک‌کردن بزرگ‌ها.",
    descEn: "Structural pruning, wiring, pot selection and patience — the art of shrinking giants.",
    emoji: "🌳",
  },
  {
    slug: "succulent-lounge",
    titleFa: "ساکولنت‌ها و کاکتوس‌ها",
    titleEn: "Succulents & cacti",
    descFa: "خاک شنی، آبیاری کم، نور زیاد — کلاب دوستداران گیاهان کم‌توقع و کم‌حوصله.",
    descEn: "Sandy soil, little water, lots of light — the club for low-effort, high-charm plants.",
    emoji: "🌵",
  },
  {
    slug: "greenhouse-tech",
    titleFa: "تکنولوژی گلخانه",
    titleEn: "Greenhouse tech",
    descFa: "سنسور، اتوماسیون، رطوبت‌ساز و لوله رشد — گلخانه هوشمند خود را حرفه‌ای‌تر کنید.",
    descEn: "Sensors, automation, humidifiers and grow lights — level up your smart greenhouse.",
    emoji: "🏡",
  },
  {
    slug: "herb-alchemy",
    titleFa: "گیاهان دارویی",
    titleEn: "Medicinal herbs",
    descFa: "کشت، برداشت و دم‌کردن نعناع، بابونه، آلوئه‌ورا و بقیه داروخانه سبز خانه.",
    descEn: "Growing, harvesting and brewing mint, chamomile, aloe and the rest of the green pharmacy.",
    emoji: "🌿",
  },
] as const;

/** Idempotent seed: upsert by stable key, so GET never duplicates rows.
 *  Sequential (not Promise.all) so createdAt — and therefore catalogue
 *  display order — follows the code-defined sequence deterministically. */
async function ensureGroups() {
  const rows: Awaited<ReturnType<typeof db.expertGroup.upsert>>[] = [];
  for (const g of EXPERT_GROUPS) {
    rows.push(
      await db.expertGroup.upsert({
        where: { key: g.slug },
        create: {
          key: g.slug,
          titleFa: g.titleFa,
          titleEn: g.titleEn,
          descFa: g.descFa,
          descEn: g.descEn,
          emoji: g.emoji,
        },
        update: {}, // catalogue is code-owned — never overwrite live edits
      })
    );
  }
  return rows;
}

const MAX_MESSAGE = 280;
const THREAD_MEMBERS = 30;
const THREAD_MESSAGES = 50;

/* ── schemas ─────────────────────────────────────────────────────────────── */

const joinSchema = z.object({
  key: z.string().min(1).max(64),
  viewerKey: z.string().min(1).max(64),
  name: z.string().min(1).max(60),
});

const messageSchema = z.object({
  key: z.string().min(1).max(64),
  viewerKey: z.string().min(1).max(64),
  body: z.string().min(1).max(MAX_MESSAGE),
});

const leaveSchema = z.object({
  key: z.string().min(1).max(64),
  viewerKey: z.string().min(1).max(64),
});

const bad = (msg: string, status: number) =>
  NextResponse.json({ success: false, error: msg }, { status });

/* ── GET — list groups (auto-seeds) or one group's thread ─────────────────── */

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const viewer = url.searchParams.get("viewer") ?? "";
    await ensureGroups();

    // thread mode: ?key=<groupKey>&thread=1 → members + recent messages
    const key = url.searchParams.get("key");
    if (url.searchParams.get("thread") === "1") {
      if (!key) return bad("missing_key", 400);
      const group = await db.expertGroup.findUnique({ where: { key } });
      if (!group) return bad("group_not_found", 404);

      const [members, messages] = await Promise.all([
        db.groupMember.findMany({
          where: { groupId: group.id },
          orderBy: { joinedAt: "asc" },
          take: THREAD_MEMBERS,
        }),
        db.groupMessage.findMany({
          where: { groupId: group.id },
          orderBy: { createdAt: "desc" },
          take: THREAD_MESSAGES,
        }),
      ]);

      return NextResponse.json({
        success: true,
        group: {
          key: group.key,
          titleFa: group.titleFa,
          titleEn: group.titleEn,
          descFa: group.descFa,
          descEn: group.descEn,
          emoji: group.emoji,
          memberCount: members.length,
          joined: viewer ? members.some((m) => m.viewerKey === viewer) : false,
          members: members.map((m) => ({
            name: m.name,
            joinedAt: m.joinedAt.toISOString(),
            isMe: viewer !== "" && m.viewerKey === viewer,
          })),
          // stored newest-first, served oldest-first — chat order
          messages: messages
            .slice()
            .reverse()
            .map((m) => ({
              id: m.id,
              name: m.name,
              body: m.body,
              createdAt: m.createdAt.toISOString(),
              isMe: viewer !== "" && m.viewerKey === viewer,
            })),
        },
      });
    }

    // list mode: catalogue order + per-viewer membership flags
    const groups = await db.expertGroup.findMany({
      orderBy: { createdAt: "asc" },
      include: {
        _count: { select: { members: true, messages: true } },
        members: viewer ? { where: { viewerKey: viewer } } : false,
        messages: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
      },
    });

    return NextResponse.json({
      success: true,
      groups: groups.map((g) => ({
        key: g.key,
        titleFa: g.titleFa,
        titleEn: g.titleEn,
        descFa: g.descFa,
        descEn: g.descEn,
        emoji: g.emoji,
        memberCount: g._count.members,
        messageCount: g._count.messages,
        joined: Array.isArray(g.members) ? g.members.length > 0 : false,
        lastMessageAt: g.messages[0]?.createdAt.toISOString() ?? null,
      })),
    });
  } catch (err) {
    console.error("[groups:GET]", err);
    return bad("server_error", 500);
  }
}

/* ── POST — join a group (idempotent) ────────────────────────────────────── */

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const parsed = joinSchema.safeParse(body);
    if (!parsed.success) return bad("invalid_body", 400);
    const { key, viewerKey, name } = parsed.data;

    const group = await db.expertGroup.findUnique({ where: { key } });
    if (!group) return bad("group_not_found", 404);

    const before = await db.groupMember.findUnique({
      where: { groupId_viewerKey: { groupId: group.id, viewerKey } },
    });
    // re-join keeps membership history — joining twice is never destructive
    await db.groupMember.upsert({
      where: { groupId_viewerKey: { groupId: group.id, viewerKey } },
      create: { groupId: group.id, viewerKey, name },
      update: {},
    });
    const memberCount = await db.groupMember.count({ where: { groupId: group.id } });

    return NextResponse.json({
      success: true,
      alreadyJoined: before !== null,
      joined: { name },
      memberCount,
    });
  } catch (err) {
    console.error("[groups:POST]", err);
    return bad("server_error", 500);
  }
}

/* ── PATCH — post a message (members only, 1..280 chars) ─────────────────── */

export async function PATCH(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    // zod's safeParse result carries no .data on failure — the too_long
    // distinction must inspect the raw payload before schema validation
    if (body && typeof body.body === "string" && body.body.length > MAX_MESSAGE) {
      return bad("too_long", 400);
    }
    const parsed = messageSchema.safeParse(body);
    if (!parsed.success) return bad("invalid_body", 400);
    const { key, viewerKey } = parsed.data;
    const text = parsed.data.body.trim();
    if (!text) return bad("too_short", 400);

    const group = await db.expertGroup.findUnique({ where: { key } });
    if (!group) return bad("group_not_found", 404);

    const membership = await db.groupMember.findUnique({
      where: { groupId_viewerKey: { groupId: group.id, viewerKey } },
    });
    if (!membership) return bad("not_joined", 404);

    const message = await db.groupMessage.create({
      data: { groupId: group.id, viewerKey, name: membership.name, body: text },
    });
    const messageCount = await db.groupMessage.count({ where: { groupId: group.id } });

    return NextResponse.json({
      success: true,
      message: {
        id: message.id,
        name: message.name,
        body: message.body,
        createdAt: message.createdAt.toISOString(),
        isMe: true,
      },
      messageCount,
    });
  } catch (err) {
    console.error("[groups:PATCH]", err);
    return bad("server_error", 500);
  }
}

/* ── DELETE — leave a group (messages persist — real chat semantics) ─────── */

export async function DELETE(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const parsed = leaveSchema.safeParse(body);
    if (!parsed.success) return bad("invalid_body", 400);
    const { key, viewerKey } = parsed.data;

    const group = await db.expertGroup.findUnique({ where: { key } });
    if (!group) return bad("group_not_found", 404);

    const membership = await db.groupMember.findUnique({
      where: { groupId_viewerKey: { groupId: group.id, viewerKey } },
    });
    if (!membership) return bad("not_joined", 404);

    await db.groupMember.delete({
      where: { groupId_viewerKey: { groupId: group.id, viewerKey } },
    });
    const memberCount = await db.groupMember.count({ where: { groupId: group.id } });
    return NextResponse.json({ success: true, memberCount });
  } catch (err) {
    console.error("[groups:DELETE]", err);
    return bad("server_error", 500);
  }
}
