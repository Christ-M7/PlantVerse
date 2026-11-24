/**
 * PlantVerse — central notification aggregator («مرکز اعلان‌ها»). 
 *
 * Pure domain logic (no DB imports) shared by the API route and tests:
 * merges every actionable signal in the app — overdue garden tasks,
 * ailing plants, past-due care reminders, greenhouse band alerts and
 * recent order updates — into one ranked, bilingual, deduplicated feed.
 *
 * Ranking: urgent (act today) → upcoming (due soon / due tomorrow) →
 * info (environment & commerce FYI). Each item has a stable `id` the
 * client uses as its "seen" key, and a `meta.view` for deep navigation.
 *
 * Aggregation policy: per-domain rollups (one item per source group,
 * not per row) so the feed stays readable; counts travel alongside.
 *
 * Display names follow the app-wide convention:
 *   fa → user nickname first, then catalog nameFa
 *   en → catalog nameEn first, then user nickname
 */

/* ── types ──────────────────────────────────────────────────────────────── */

export interface NotificationPlant {
  id: string;
  nickname: string;
  nameFa: string;
  nameEn: string;
  health: number;
  nextTaskType: string; // water | fertilize | prune | spray
  nextTaskDays: number;
}

export interface NotificationEvent {
  id: string;
  type: string;
  titleFa: string;
  titleEn: string;
  date: string; // ISO yyyy-mm-dd
  plantNamesFa: string;
  plantNamesEn: string;
}

export interface NotificationAlert {
  id: string;
  messageFa: string;
  messageEn: string;
  createdAt: Date;
}

export interface NotificationOrder {
  id: string;
  code: string;
  status: string; // paid | preparing | shipped | delivered | cancelled
  createdAt: Date;
}

export type NotificationSeverity = "urgent" | "upcoming" | "info";
export const NOTIF_KINDS = [
  "garden-task",
  "health-watch",
  "reminder",
  "environment",
  "order",
  "magazine",
  "community",
  "all-clear",
] as const;

export type NotificationKind = (typeof NOTIF_KINDS)[number];

const NOTIF_KIND_SET: ReadonlySet<string> = new Set(NOTIF_KINDS);

/** Runtime guard for untrusted kind tokens (?muted= parsing). */
export function isNotificationKind(v: string): v is NotificationKind {
  return NOTIF_KIND_SET.has(v);
}

/**
 * Mute groups — the user-facing digest dials. One group switches a whole
 * family of kinds at once; magazine (info) and all-clear are deliberately
 * NOT muteable (they are the feed's content, not noise).
 */
export type NotificationMuteGroup = "garden" | "environment" | "order" | "community";

export interface NotifMuteGroupMeta {
  id: NotificationMuteGroup;
  kinds: readonly NotificationKind[];
  fa: string;
  en: string;
  descFa: string;
  descEn: string;
}

export const NOTIF_MUTE_GROUPS: readonly NotifMuteGroupMeta[] = [
  {
    id: "garden",
    kinds: ["garden-task", "health-watch", "reminder"],
    fa: "باغ و یادآورها",
    en: "Garden & reminders",
    descFa: "کارهای عقب‌افتاده، هوش سلامت و یادآورهای امروز",
    descEn: "Overdue tasks, health watch and today's reminders",
  },
  {
    id: "environment",
    kinds: ["environment"],
    fa: "محیط و گلخانه",
    en: "Environment",
    descFa: "هشدارهای دما، رطوبت و نور گلخانه",
    descEn: "Greenhouse temperature, humidity and light alerts",
  },
  {
    id: "order",
    kinds: ["order"],
    fa: "سفارش‌ها",
    en: "Orders",
    descFa: "تغییر وضعیت مرسوله‌های فروشگاه",
    descEn: "Shop parcel status changes",
  },
  {
    id: "community",
    kinds: ["community"],
    fa: "جامعه",
    en: "Community",
    descFa: "نظرها و پاسخ‌های تازه روی محتوای شما",
    descEn: "New comments and replies on your content",
  },
];

export type NotificationView =
  | "garden"
  | "reminders"
  | "greenhouse"
  | "shop"
  | "profile"
  | "article"
  | "community";

export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  severity: NotificationSeverity;
  icon: "task" | "water" | "heart" | "bell" | "thermometer" | "truck" | "leaf" | "book" | "message";
  fa: string;
  en: string;
  /** ISO datetime used for ordering inside a severity band */
  at: string;
  /** view for deep navigation; `code` carries the order tracking handle,
      `slug` the magazine article handle */
  meta: { view: NotificationView; code?: string; slug?: string };
}

export interface NotificationArticle {
  id: string;
  slug: string;
  titleFa: string;
  titleEn: string;
  publishedAt: string; // ISO datetime
}

/**
 * Recent community activity on one of YOUR posts (same author name as the
 * demo profile). One entry per post (comment rollup), newest comment leads.
 * Likes are intentionally NOT tracked here — the demo like toggle is a
 * global boolean with no per-actor attribution, so a "someone liked your
 * post" card would be fiction; comments are timestamped and authored.
 */
export interface NotificationCommunity {
  postId: string;
  postTitle: string;
  /** comments in the lookback window (self-authored excluded upstream) */
  count: number;
  latestActor: string;
  /** trimmed preview of the newest comment (≤ 60 chars, API-side) */
  latestSnippet?: string;
  latestAt: string; // ISO datetime
  /** stable id anchor — the newest comment drives the dedupe/seen key */
  latestCommentId: string;
}

/**
 * New REPLIES to one of YOUR comments, rolled up per post. This is what
 * viewerKey unlocks — replies reach the real commenter (this browser),
 * regardless of who owns the post the thread lives on.
 */
export interface NotificationCommunityReply {
  postId: string;
  postTitle: string;
  /** replies in the lookback window (self-authored excluded upstream) */
  count: number;
  latestActor: string;
  /** trimmed preview of the newest reply (≤ 60 chars, API-side) */
  latestSnippet?: string;
  latestAt: string; // ISO datetime
  /** stable id anchor — the newest reply drives the dedupe/seen key */
  latestReplyId: string;
}

export interface NotificationsInput {
  now: Date;
  todayIso: string; // yyyy-mm-dd (local)
  plants: NotificationPlant[];
  overdueEvents: NotificationEvent[];
  todayEvents: NotificationEvent[];
  alerts: NotificationAlert[];
  orders: NotificationOrder[];
  /** latest magazine story — surfaces as a tappable info card deep-linking
      into the article reader; omitted → no magazine item (tests stay clean) */
  article?: NotificationArticle;
  /** comment rollups on your posts, newest first, already capped upstream;
      omitted/empty → no community items (tests stay clean) */
  community?: NotificationCommunity[];
  /** reply rollups on your comments (any post), newest first, already
      capped upstream; omitted/empty → no reply items (tests stay clean) */
  communityReplies?: NotificationCommunityReply[];
  /** authoritative totals when the row fetch is capped (API take: 20) —
      the copy must not undercount just because the feed samples rows */
  overdueEventCount?: number;
  todayEventCount?: number;
}

export interface NotificationsResult {
  items: NotificationItem[];
  /** severity rollup — drives the bell badge without re-scanning items */
  counts: { urgent: number; upcoming: number; info: number };
}

/* ── all-clear item (single source of truth) ────────────────────────────── */

/**
 * The calm-feed card. Emitted by the builder when nothing needs
 * attention AND by the API route when muting empties the feed, so a
 * fully-muted bell never shows a blank panel.
 */
export function allClearItem(now: Date): NotificationItem {
  return {
    id: "all-clear",
    kind: "all-clear",
    severity: "info",
    icon: "leaf",
    fa: "هیچ کار عقب‌افتاده‌ای نیست — باغچه‌ات آرام و مرتب است 🌿",
    en: "Nothing overdue — your garden is calm and tidy 🌿",
    at: now.toISOString(),
    meta: { view: "garden" },
  };
}

/* ── ranking ────────────────────────────────────────────────────────────── */

const SEVERITY_RANK: Record<NotificationSeverity, number> = { urgent: 0, upcoming: 1, info: 2 };

/* ── copy fragments ─────────────────────────────────────────────────────── */

const TASK_FA: Record<string, string> = {
  water: "آبیاری",
  fertilize: "کوددهی",
  prune: "هرس",
  spray: "سمپاشی",
};
const TASK_EN: Record<string, string> = {
  water: "watering",
  fertilize: "feeding",
  prune: "pruning",
  spray: "misting",
};

const ORDER_STATUS_FA: Record<string, string> = {
  paid: "ثبت شد",
  preparing: "در حال آماده‌سازی است",
  shipped: "به مسیر ارسال افتاد",
  delivered: "تحویل داده شد",
};
const ORDER_STATUS_EN: Record<string, string> = {
  paid: "was placed",
  preparing: "is being prepared",
  shipped: "is on its way",
  delivered: "was delivered",
};

/** fa → nickname first; en → catalog English name first (app-wide rule). */
function displayName(p: NotificationPlant, lang: "fa" | "en"): string {
  return lang === "fa" ? p.nickname || p.nameFa : p.nameEn || p.nickname;
}

/** «الف»، «ب» و ۲ گیاه دیگر — shared list formatter for both languages. */
function nameList(plants: NotificationPlant[], lang: "fa" | "en", faDigits: (n: number) => string): string {
  const names = plants
    .slice(0, 3)
    .map((p) => (lang === "fa" ? `«${displayName(p, "fa")}»` : `“${displayName(p, "en")}”`));
  const rest = plants.length - names.length;
  if (rest > 0) {
    return lang === "fa"
      ? `${names.join("، ")} و ${faDigits(rest)} گیاه دیگر`
      : `${names.join(", ")} and ${rest} more`;
  }
  return lang === "fa" ? names.join("، ") : names.join(", ");
}

/** Health-watch floor: at or below this the plant enters the urgent feed. */
export const HEALTH_WATCH_FLOOR = 60;

/* ── rule engine ────────────────────────────────────────────────────────── */

export function buildNotifications(
  input: NotificationsInput,
  faDigits: (n: number) => string = (n) => String(n)
): NotificationsResult {
  const { now, todayIso, plants, overdueEvents, todayEvents, alerts, orders } = input;
  const items: NotificationItem[] = [];
  const atOf = (d: Date) => d.toISOString();
  const dayAt = (dateIso: string) => `${dateIso}T12:00:00.000Z`;

  /* ── urgent: overdue garden tasks ── */
  const overdue = plants.filter((p) => p.nextTaskDays <= 0);
  if (overdue.length > 0) {
    const taskFa = TASK_FA[overdue[0].nextTaskType] ?? "مراقبت";
    const taskEn = TASK_EN[overdue[0].nextTaskType] ?? "care";
    items.push({
      id: "garden-overdue",
      kind: "garden-task",
      severity: "urgent",
      icon: "task",
      fa: `${overdue.length === 1 ? `${TASK_FA[overdue[0].nextTaskType] ?? "مراقبت"} ${nameList(overdue, "fa", faDigits)}` : `${faDigits(overdue.length)} کار عقب‌افتاده در باغچه`} — برای ${taskFa} وقت گذشته!`,
      en: `${nameList(overdue, "en", faDigits)} ${overdue.length === 1 ? `is waiting for ${taskEn}` : `are waiting for ${taskEn}`} — overdue!`,
      at: dayAt(todayIso),
      /* deep-link target: the garden task board renders these rows —
         garden view scrolls to & ring-flashes it (same channel as post deep-links) */
      meta: { view: "garden", slug: "task-board" },
    });
  }

  /* ── urgent: health watch — ailing plants ── */
  const ailing = plants.filter((p) => p.health < HEALTH_WATCH_FLOOR);
  if (ailing.length > 0) {
    const worst = [...ailing].sort((a, b) => a.health - b.health)[0];
    items.push({
      id: "health-watch",
      kind: "health-watch",
      severity: "urgent",
      icon: "heart",
      fa: `سلامت ${nameList(ailing, "fa", faDigits)} پایین است — ${displayName(worst, "fa")} به ${faDigits(worst.health)}٪ رسیده؛ امروز رسیدگی کن.`,
      en: `${nameList(ailing, "en", faDigits)} ${ailing.length === 1 ? "is" : "are"} struggling — ${displayName(worst, "en")} is down to ${worst.health}%; give them attention today.`,
      at: dayAt(todayIso),
      /* ailing plants live on the plant-health cards, not the board */
      meta: { view: "garden", slug: "plants" },
    });
  }

  /* ── urgent: past-due care reminders ── */
  if (overdueEvents.length > 0) {
    const overdueTotal = Math.max(input.overdueEventCount ?? 0, overdueEvents.length);
    const typesFa = [...new Set(overdueEvents.map((e) => TASK_FA[e.type] ?? "مراقبت"))].join(" و ");
    const typesEn = [...new Set(overdueEvents.map((e) => TASK_EN[e.type] ?? "care"))].join(" and ");
    items.push({
      id: "reminders-overdue",
      kind: "reminder",
      severity: "urgent",
      icon: "bell",
      fa: `${faDigits(overdueTotal)} یادآوری عقب‌افتاده داری (${typesFa}) — از تقویم یادآوری‌ها جبران کن.`,
      en: `${overdueTotal} past-due reminder${overdueTotal === 1 ? "" : "s"} (${typesEn}) — catch up from the reminder calendar.`,
      at: dayAt(overdueEvents[overdueEvents.length - 1].date),
      meta: { view: "reminders" },
    });
  }

  /* ── upcoming: garden tasks due tomorrow ── */
  const dueSoon = plants.filter((p) => p.nextTaskDays === 1);
  if (dueSoon.length > 0) {
    items.push({
      id: "garden-due-soon",
      kind: "garden-task",
      severity: "upcoming",
      icon: "water",
      fa: `${TASK_FA[dueSoon[0].nextTaskType] ?? "مراقبت"} ${nameList(dueSoon, "fa", faDigits)} برای فرداست — امروز انجامش بده.`,
      en: `${TASK_EN[dueSoon[0].nextTaskType] ?? "Care"} for ${nameList(dueSoon, "en", faDigits)} is due tomorrow — do it today.`,
      at: dayAt(todayIso),
      /* due-tomorrow rows sit on the board too (gold band) */
      meta: { view: "garden", slug: "task-board" },
    });
  }

  /* ── upcoming: today's care reminders ── */
  if (todayEvents.length > 0) {
    const first = todayEvents[0];
    const todayTotal = Math.max(input.todayEventCount ?? 0, todayEvents.length);
    items.push({
      id: "reminders-today",
      kind: "reminder",
      severity: "upcoming",
      icon: "bell",
      fa: `امروز ${faDigits(todayTotal)} یادآوری داری — «${first.titleFa || TASK_FA[first.type] || "مراقبت"}» و…`,
      en: `You have ${todayTotal} reminder${todayTotal === 1 ? "" : "s"} today — “${first.titleEn || TASK_EN[first.type] || "Care"}” and more`,
      at: dayAt(todayIso),
      meta: { view: "reminders" },
    });
  }

  /* ── info: greenhouse band alerts (last 24h, latest leads) ── */
  if (alerts.length > 0) {
    const latest = alerts[0];
    items.push({
      id: `gh-alert:${latest.id}`,
      kind: "environment",
      severity: "info",
      icon: "thermometer",
      fa: latest.messageFa + (alerts.length > 1 ? ` (+${faDigits(alerts.length - 1)} هشدار محیطی دیگر)` : ""),
      en: latest.messageEn + (alerts.length > 1 ? ` (+${alerts.length - 1} more environment alert${alerts.length - 1 === 1 ? "" : "s"})` : ""),
      at: atOf(latest.createdAt),
      meta: { view: "greenhouse" },
    });
  }

  /* ── info: recent order updates (last 7 days) ── */
  if (orders.length > 0) {
    const latest = orders[0];
    const stFa = ORDER_STATUS_FA[latest.status] ?? "به‌روزرسانی شد";
    const stEn = ORDER_STATUS_EN[latest.status] ?? "was updated";
    items.push({
      id: `order:${latest.code}:${latest.status}`,
      kind: "order",
      severity: "info",
      icon: "truck",
      fa: `سفارش ${latest.code} ${stFa} ✅`,
      en: `Order ${latest.code} ${stEn} ✅`,
      at: atOf(latest.createdAt),
      /* orders live in the shop's order sheet — deep-link straight into
         the live tracking view for this code */
      meta: { view: "shop", code: latest.code },
    });
  }

  /* ── info: latest magazine story (deep-links into the article reader) ── */
  if (input.article) {
    const a = input.article;
    const titleFa = a.titleFa || a.titleEn || "مقاله تازه";
    const titleEn = a.titleEn || a.titleFa || "Fresh story";
    items.push({
      id: "magazine-latest",
      kind: "magazine",
      severity: "info",
      icon: "book",
      fa: `تازه‌های مجله: «${titleFa}» — یک فنجان چای سبز و چند دقیقه مطالعه 🍃`,
      en: `From the magazine: “${titleEn}” — a cup of green tea and a few good minutes 🍃`,
      at: a.publishedAt || atOf(now),
      meta: { view: "article", slug: a.slug },
    });
  }

  /* ── info: new comments on your community posts (rollup per post) ── */
  for (const c of input.community ?? []) {
    const titleFa = c.postTitle || "پست شما";
    const titleEn = c.postTitle || "your post";
    const n = Math.max(1, c.count);
    const fa =
      n === 1
        ? `پست «${titleFa}» یک نظر تازه گرفت${c.latestActor ? ` — «${c.latestActor}»${c.latestSnippet ? `: «${c.latestSnippet}»` : ""}` : ""}`
        : `پست «${titleFa}» ${faDigits(n)} نظر تازه گرفت${c.latestActor ? ` — آخرین از «${c.latestActor}»` : ""}`;
    const en =
      n === 1
        ? `“${titleEn}” has a new comment${c.latestActor ? ` — ${c.latestActor}${c.latestSnippet ? `: “${c.latestSnippet}”` : ""}` : ""}`
        : `“${titleEn}” picked up ${n} new comment${n === 1 ? "" : "s"}${c.latestActor ? ` — latest from ${c.latestActor}` : ""}`;
    items.push({
      id: `community:${c.postId}:${c.latestCommentId}`,
      kind: "community",
      severity: "info",
      icon: "message",
      fa,
      en,
      at: c.latestAt || atOf(now),
      /* the postId rides the slug slot — community feed already scrolls
         to & ring-flashes a deep-linked post via its query slot */
      meta: { view: "community", slug: c.postId },
    });
  }

  /* ── info: new replies to your comments (rollup per post, viewerKey-scoped) ── */
  for (const c of input.communityReplies ?? []) {
    const titleFa = c.postTitle || "پست شما";
    const titleEn = c.postTitle || "your post";
    const n = Math.max(1, c.count);
    const fa =
      n === 1
        ? `به نظر شما در پست «${titleFa}» پاسخی داده شد${c.latestActor ? ` — «${c.latestActor}»${c.latestSnippet ? `: «${c.latestSnippet}»` : ""}` : ""}`
        : `پست «${titleFa}» ${faDigits(n)} پاسخ تازه به نظرهای شما گرفت${c.latestActor ? ` — آخرین از «${c.latestActor}»` : ""}`;
    const en =
      n === 1
        ? `New reply to your comment on “${titleEn}”${c.latestActor ? ` — ${c.latestActor}${c.latestSnippet ? `: “${c.latestSnippet}”` : ""}` : ""}`
        : `“${titleEn}” picked up ${n} new replies to your comments${c.latestActor ? ` — latest from ${c.latestActor}` : ""}`;
    items.push({
      id: `community-reply:${c.postId}:${c.latestReplyId}`,
      kind: "community",
      severity: "info",
      icon: "message",
      fa,
      en,
      at: c.latestAt || atOf(now),
      /* same deep-link channel as comment rollups — the post card */
      meta: { view: "community", slug: c.postId },
    });
  }

  /* ── all clear ── */
  if (items.length === 0) {
    items.push(allClearItem(now));
  }

  items.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || (a.at < b.at ? 1 : -1));

  const counts = {
    urgent: items.filter((i) => i.severity === "urgent").length,
    upcoming: items.filter((i) => i.severity === "upcoming").length,
    info: items.filter((i) => i.severity === "info").length,
  };

  return { items, counts };
}
