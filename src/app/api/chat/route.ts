import { NextResponse } from "next/server";
import { z } from "zod";
import ZAI from "z-ai-web-dev-sdk";
import { db } from "@/lib/db";
import { GH_DEVICES, GH_METRICS, faDigits, r2 } from "@/lib/greenhouse";
import { ghRulesPromptLine, ruleFetchArgs } from "@/lib/gh-rules-line";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({
  message: z.string().min(1).max(1200),
  lang: z.enum(["fa", "en"]).default("fa"),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) }))
    .max(10)
    .optional(),
  /** where the user is asking FROM — drives context-aware answers
      («همین گیاهی که باز است…»); slug unlocks real catalog attributes */
  context: z
    .object({
      view: z.string().max(30),
      slug: z.string().max(80).optional(),
    })
    .strict()
    .optional(),
});

const hits = new Map<string, number[]>();
function rateLimit(ip: string, max = 20, windowMs = 60_000) {
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length <= max;
}

const SYSTEM_FA = `تو «گیاه‌شناس هوشمند جهان‌گیاه» هستی — متخصص گیاهان آپارتمانی، دارویی، آبزی، قارچ‌ها و کشاورزی.
قواعد پاسخ:
- مهم‌ترین قانون: پاسخ را فقط و فقط به زبان فارسی بنویس. حتی اگر سوال به زبان دیگری بود، پاسخ فارسی بده. هرگز کلمه یا عبارت چینی، انگلیسی یا زبان دیگر در پاسخ ننویس؛ اسم علمی گیاهان را می‌توانی داخل پرانتز لاتین بیاوری.
- کوتاه، گرم و علمی؛ حداکثر ۵ تا ۶ جمله.
- وقتی لازم است نکات مراقبت را با بولت کوتاه بده (آبیاری، نور، خاک، دما).
- اگر سوال درباره بیماری گیاه بود، اول محتمل‌ترین علت و بعد راه‌حل عملی را بگو.
- ایموجی ملایم گیاهی (🌿💧☀️) مجاز است؛ از پاسخ طولانی و حاشیه‌روی پرهیز کن.
- اگر سوال خارج از حوزه گیاهان بود، مؤدبانه به موضوع گیاهی برگرد.`;

const SYSTEM_EN = `You are PlantVerse's AI botanist — expert in houseplants, medicinal herbs, aquatics, mushrooms and agriculture.
Most important rule: reply ONLY in English, regardless of the language of the question. Never mix other languages into the reply (scientific Latin names in parentheses are fine).
Rules: reply in 5-6 short warm sentences max; give concise care bullets (water, light, soil, temperature) when useful; for sick plants state the most likely cause then a practical fix; light plant emojis allowed (🌿💧☀️); stay on the topic of plants.`;

/* ── context awareness («چت آگاه از زمینه») ────────────────────────────── */

const VIEW_FA: Record<string, string> = {
  home: "خانه",
  encyclopedia: "دانشنامه گیاهان",
  plant: "صفحهٔ یک گیاه",
  scanner: "اسکنر برگ",
  garden: "باغچه من",
  reminders: "یادآورهای مراقبت",
  community: "انجمن گیاه‌دوستان",
  shop: "فروشگاه",
  magazine: "مجلهٔ گیاهی",
  article: "خواندن مقاله",
  profile: "پروفایل و تنظیمات",
  greenhouse: "گلخانه هوشمند",
  mushrooms: "پرورش قارچ",
};
const VIEW_EN: Record<string, string> = {
  home: "home",
  encyclopedia: "the plant encyclopedia",
  plant: "a plant page",
  scanner: "the leaf scanner",
  garden: "My Garden",
  reminders: "care reminders",
  community: "the plant community",
  shop: "the shop",
  magazine: "the plant magazine",
  article: "reading an article",
  profile: "profile & settings",
  greenhouse: "the smart greenhouse",
  mushrooms: "mushroom growing",
};

const LEVEL_FA: Record<string, string> = { low: "کم", medium: "متوسط", high: "زیاد" };
const LEVEL_EN: Record<string, string> = { low: "low", medium: "medium", high: "high" };
const LIGHT_FA: Record<string, string> = { low: "نور کم", medium: "نور متوسط", bright_indirect: "نور غیرمستقیم روشن", direct: "آفتاب مستقیم" };
const LIGHT_EN: Record<string, string> = { low: "low light", medium: "medium light", bright_indirect: "bright indirect light", direct: "direct sun" };

/**
 * Live greenhouse sensor snapshot («چت آگاه از گلخانه»). Latest reading per
 * metric + on-devices + autopilot — the same values the greenhouse view
 * renders, so "is my greenhouse okay?" answers with REAL numbers. Falls
 * back to each metric's base like the greenhouse route (same policy).
 * R42-c adds the ACTIVE automation rules (engine evaluation order) so
 * "what if" questions are answered from the user's real rule list.
 */
async function buildGreenhouseLine(lang: "fa" | "en"): Promise<string> {
  const parts: string[] = [];
  for (const m of GH_METRICS) {
    const row = await db.ghReading.findFirst({
      where: { metric: m.key },
      orderBy: { recordedAt: "desc" },
      select: { value: true },
    });
    const v = r2(row?.value ?? m.base);
    const band = lang === "fa" ? `محدودهٔ امن ${faDigits(m.min)}–${faDigits(m.max)} ${m.unitFa}` : `safe band ${m.min}–${m.max} ${m.unitEn}`;
    const val = lang === "fa" ? `${faDigits(v)} ${m.unitFa}` : `${v} ${m.unitEn}`;
    parts.push(lang === "fa" ? `${m.fa} ${val} (${band})` : `${m.en} ${val} (${band})`);
  }
  const [deviceRows, state, rules] = await Promise.all([
    db.ghDevice.findMany({ select: { id: true, isOn: true } }),
    db.ghState.findUnique({ where: { id: "singleton" }, select: { autopilot: true } }),
    db.ghRule.findMany({ ...ruleFetchArgs(), select: { metric: true, comparator: true, threshold: true, device: true, turnOn: true, enabled: true } }),
  ]);
  const onDevices = GH_DEVICES.filter((d) => deviceRows.find((r) => r.id === d.key)?.isOn === true);
  const autopilot = state?.autopilot ?? true;
  const devicesLine =
    onDevices.length === 0
      ? lang === "fa"
        ? "هیچ دستگاهی روشن نیست"
        : "no devices are on"
      : lang === "fa"
        ? `روشن: ${onDevices.map((d) => d.fa).join("، ")}`
        : `on: ${onDevices.map((d) => d.en).join(", ")}`;
  const autoLine = lang === "fa" ? (autopilot ? "اتولوت فعال است" : "اتولوت خاموش است") : autopilot ? "autopilot is on" : "autopilot is off";
  const rulesLine = ghRulesPromptLine(rules, lang);
  return lang === "fa"
    ? `\nزمینهٔ زندهٔ گلخانه: سنسورها — ${parts.join("، ")}. ${devicesLine}؛ ${autoLine}.${rulesLine} اگر سؤال دربارهٔ وضعیت گلخانه بود، فقط بر همین اعداد استوار جواب بده و از حدس خودداری کن.`
    : `\nLive greenhouse context: sensors — ${parts.join(", ")}. ${devicesLine}; ${autoLine}.${rulesLine} If the question is about the greenhouse state, answer strictly from these numbers — do not guess.`;
}

/**
 * Build the context line appended to the system prompt. With a resolvable
 * slug it injects the REAL catalog care attributes (fetched from DB) so
 * "this plant I have open" questions get grounded answers; the greenhouse
 * view injects the LIVE sensor snapshot instead; anything unresolvable
 * degrades to the bare view name — never fabricates.
 */
async function buildContextLine(context: { view: string; slug?: string } | undefined, lang: "fa" | "en"): Promise<string> {
  if (!context) return "";
  /* greenhouse first — sensors, not the bare view label */
  if (context.view === "greenhouse") {
    try {
      return await buildGreenhouseLine(lang);
    } catch {
      /* sensor fetch failed → degrade to the bare view name below */
    }
  }
  const viewLabel = (lang === "fa" ? VIEW_FA[context.view] : VIEW_EN[context.view]) ?? "";
  const slug = context.slug?.trim().slice(0, 80);
  if (!slug) {
    if (!viewLabel) return "";
    return lang === "fa"
      ? `\nزمینه: کاربر اکنون در «${viewLabel}» است. اگر سؤالش به همین صفحه مربوط بود، پاسخ را با همین زمینه تنظ کن.`
      : `\nContext: the user is currently on ${viewLabel}. If their question relates to it, tailor the answer to that.`;
  }
  const plant = await db.plant.findUnique({
    where: { slug },
    select: { nameFa: true, nameEn: true, scientificName: true, water: true, humidity: true, light: true, tempMin: true, tempMax: true },
  });
  if (!plant) {
    return viewLabel
      ? lang === "fa"
        ? `\nزمینه: کاربر اکنون در «${viewLabel}» است.`
        : `\nContext: the user is currently on ${viewLabel}.`
      : "";
  }
  return lang === "fa"
    ? `\nزمینه: کاربر اکنون در «${VIEW_FA[context.view] ?? viewLabel}» است و گیاه «${plant.nameFa}» (${plant.scientificName}) را باز کرده. مشخصات معتبر این گیاه: آبیاری ${LEVEL_FA[plant.water] ?? plant.water}، رطوبت ${LEVEL_FA[plant.humidity] ?? plant.humidity}، ${LIGHT_FA[plant.light] ?? plant.light}، دمای مناسب ${plant.tempMin} تا ${plant.tempMax} درجهٔ سانتی‌گراد. اگر سؤال درباره همین گیاه بود، پاسخ را دقیقاً بر همین مشخصات استوار کن و از حدس زدن خودداری کن.`
    : `\nContext: the user is currently on ${VIEW_EN[context.view] ?? viewLabel} viewing “${plant.nameEn}” (${plant.scientificName}). Verified care profile: ${LEVEL_EN[plant.water] ?? plant.water} water, ${LEVEL_EN[plant.humidity] ?? plant.humidity} humidity, ${LIGHT_EN[plant.light] ?? plant.light}, ${plant.tempMin}-${plant.tempMax}°C. If the question is about this plant, ground the answer strictly in these attributes — do not guess.`;
}

/** POST /api/chat — bilingual plant chatbot (LLM) */
export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for") ?? "local";
  if (!rateLimit(ip)) {
    return NextResponse.json(
      {
        success: false,
        error: "درخواست‌ها زیاد است! چند لحظه صبر کن و دوباره بپرس 🌱",
      },
      { status: 429 }
    );
  }

  let lang: "fa" | "en" = "fa";
  try {
    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success || !parsed.data.message.trim()) {
      return NextResponse.json({ success: false, error: "invalid_body" }, { status: 400 });
    }
    const { message, history } = parsed.data;
    lang = parsed.data.lang;

    /* context line (DB-enriched when the slug resolves) joins the system prompt */
    const contextLine = await buildContextLine(parsed.data.context, lang);
    const system = (lang === "fa" ? SYSTEM_FA : SYSTEM_EN) + contextLine;

    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        { role: "assistant", content: system },
        ...(history ?? []).slice(-6).map((h) => ({ role: h.role, content: h.content })),
        { role: "user", content: message },
      ],
      thinking: { type: "disabled" },
    });

    const response = completion.choices[0]?.message?.content?.trim();
    if (!response) throw new Error("empty");

    // persist (best effort)
    const session = "anon";
    db.chatMessage.createMany({
      data: [
        { session, role: "user", content: message.slice(0, 2000) },
        { session, role: "assistant", content: response.slice(0, 4000) },
      ],
    }).catch(() => {});

    return NextResponse.json({ success: true, response });
  } catch {
    return NextResponse.json(
      {
        success: false,
        error:
          lang === "fa"
            ? "گیاه‌شناس کمی خسته شده! چند لحظه بعد دوباره بپرس 🌱"
            : "The botanist is resting! Ask again in a moment 🌱",
      },
      { status: 503 }
    );
  }
}
