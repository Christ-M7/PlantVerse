# PlantVerse | جهان‌گیاه

**A bilingual (فارسی RTL / English LTR) full-stack plant platform — encyclopedia, AI scanner, garden care, greenhouse IoT, community, commerce.**

Next.js 16 (App Router) · React 19 · TypeScript 5 · Tailwind CSS 4 · shadcn/ui · Prisma + SQLite · Z.ai SDK (LLM / VLM / ASR / TTS / image generation)

---

## ویژگی‌ها | Features

| ماژول | فارسی | English |
|---|---|---|
| 🌿 **Encyclopedia** | دانشنامه ۲۱ گیاه با جزئیات کامل (۲۸۵+ pin)، فیلترهای هوشمند، جستجوی صوتی ASR، **مقایسه همزمان تا ۳ گیاه** با جدول ویژگی‌ها و نشانگر «متفاوت» | 21-plant encyclopedia with full detail pages, smart filters, ASR voice search, **side-by-side comparison of up to 3 plants** with live difference markers |
| 📷 **AI Scanner** | شناسایی گیاه از عکس (VLM) + سابقه اسکن + افزودن به باغ | Identify plants from photos (VLM) with scan history and one-tap add to garden |
| 🪴 **Garden** | باغ شخصی: ثبت گیاه، رویدادهای مراقبت، لاگ سلامت، تقویم مراقبت، یادآورها | Personal garden: plants, care events, health logs, care calendar, reminders |
| 🧠 **AI Care Advisor** | مشاور مراقبت هوشمند (LLM) با زمینه باغ کاربر | Smart care advisor (LLM) aware of the user's garden context |
| 🏡 **Smart Greenhouse** | داشبورد IoT زنده (دما/رطوبت/نور/خاک)، کنترل‌پنل، قوانین خودکار، نمودارهای سنسور، **کاتالوگ زنده ۸ محصول کشاورزی** | Live IoT dashboard (temp/humidity/light/soil), control panel, automation rules, sensor charts, **live catalog of 8 agricultural crops** |
| 🍄 **Mushroom World** | دنیای قارچ‌ها با پرورش گام‌به‌گام | Mushroom world with step-by-step cultivation |
| 👥 **Community** | انجمن (پست/نظر/گزارش)، **گروه‌های خبره با چت زنده** (آموزش، آفات، Bonsai، قارچ، گلخانه، هیدروپونیک) | Forum (posts/comments/reports), **expert groups with live chat** (learning, pests, bonsai, mushrooms, greenhouse, hydroponics) |
| 🛍 **Shop** | فروشگاه، سبد خرید، کد تخفیف، سفارش‌ها با رهگیری مراحل، **«از خرید به کاشت»**: محصولات گیاهی به راهنمای دانشنامه و افزودن یک‌ضرب به باغ متصل می‌شوند | Shop, cart, coupons, multi-stage order tracking, **purchase-to-planting**: living-goods products link to their encyclopedia care guide and one-tap add-to-garden |
| 📅 **Calendar** | تقویم کشت دوزبانه با اشتراک iCal | Bilingual sowing calendar with iCal subscription |
| 🏆 **Challenges** | چالش‌های هفتگی با پیوستن و پیشرفت | Weekly challenges with join + progress |
| 📊 **Annual Report** | گزارش سالانه باغ (تولید + سفارش‌ها) | Garden annual report (production + orders) |
| ⚡ **Cross-cutting** | مرکز اعلان‌ها، جستجوی سراسری صوتی، فهرست مطالعه اشتراکی، مرکز کمک، پوسته شبانه | Notification center, global voice search, shared reading lists, help center, dark mode |

## معماری | Architecture

```
src/
  app/                    # App Router — / (SPA shell) + ~40 API routes
    api/                  # REST: plants, garden, greenhouse, community,
                          # shop, challenges, calendar, chat, scan,
                          # voice-search, notifications, reports…
  components/             # 12 domain views + dialog family + ui/ (shadcn)
  lib/                    # pure logic units (bilingual advice, relative time,
                          # annual report, plant mapper…) + db client
  data/fixtures.ts        # 21-plant bilingual seed + products + garden
prisma/schema.prisma      # 28 models (SQLite)
scripts/                  # 60 behavior-test suites + seeder
```

## تست | Testing

**۴۹ suite / ۲۴۴۸ assertion — همگی سبز | all green**

- رفتارمحور: هر suite با `bun scripts/test-*.mjs` روی API واقعی (`localhost:3000`)، توابع خالص و PrismaClient تزریق‌شده اجرا می‌شود.
- پین‌های قرارداد: ۳۲۹ پین ساختاری در `test-core-pure-libs.mjs` (17 Part) که تصمیم‌های مهندسی (منطق RTL، خانواده دیالوگ، امنیت API، دسترس‌پذیری) را قفل می‌کنند.
- E2E تصویری: `e2e-shots/` — هر راند در سه پیکربندی fa/en/mobile.

## اجرا | Run

```bash
bun install
bun run db:push        # create SQLite schema
bun scripts/seed.ts    # seed bilingual catalog
bun run dev            # http://localhost:3000
bun scripts/test-greenhouse-crops-api.mjs   # any suite
```

## دیسیپلین‌های کلیدی | Key disciplines

- **Persian-first RTL**: منطق `dir` در سطح view، مرتب‌سازی فارسی (localeCompare) پس از خواندن از SQLite، اعداد فارسی با `num()`.
- **Dialog family**: تمام دیالوگ‌ها از `useDialogFocus` مشترک + `data-autofocus` + Escape محلی + رِندر در portal.
- **Sibling-button rule**: هیچ دکمه‌ای داخل `<button>` تو در تو نمی‌شود (الگوی sibling با `stopPropagation`).
- **Error contracts**: هر API خطاهای فارسی‌گرا با کد (`too_long`, `not_joined`, `invalid_body`…) برمی‌گرداند.
- **DB baseline restore**: هر راند E2E پس از اجرا به baseline برمی‌گردد.

---
*Built with Z.ai · R50 — repository publication in progress*
