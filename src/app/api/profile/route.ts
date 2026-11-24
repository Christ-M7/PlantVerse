import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isoLocalDate, computeStreaks } from "@/lib/streak";

export const dynamic = "force-dynamic";

/**
 * GET /api/profile — aggregated gamification profile.
 * XP engine: plants×30 + scans×25 + posts×15 + doneEvents×10 + avgHealth bonus.
 */
export async function GET() {
  try {
    const [garden, scans, posts, doneRows] = await Promise.all([
      db.gardenPlant.findMany({ select: { health: true } }),
      db.scanRecord.count(),
      db.communityPost.count(),
      db.careEvent.findMany({ where: { done: true }, select: { date: true } }),
    ]);
    const doneEvents = doneRows.length;

    /* real streak from the shared engine (was hardcoded 7 — data-correctness fix) */
    const streak = computeStreaks(
      doneRows.map((r) => r.date),
      isoLocalDate(new Date())
    );

    const plantsCount = garden.length;
    const avgHealth = plantsCount
      ? Math.round(garden.reduce((s, g) => s + g.health, 0) / plantsCount)
      : 0;

    const xp =
      plantsCount * 30 + scans * 25 + posts * 15 + doneEvents * 10 + Math.round(avgHealth / 2);
    const level = Math.max(1, Math.floor(Math.sqrt(xp) / 3.5) + 1);
    const levelFloor = Math.round(Math.pow((level - 1) * 3.5, 2));
    const levelCeil = Math.round(Math.pow(level * 3.5, 2));
    const xpProgress = Math.min(
      99,
      Math.max(1, Math.round(((xp - levelFloor) / Math.max(1, levelCeil - levelFloor)) * 100))
    );

    const earned: Record<string, boolean> = {
      "first-sprout": plantsCount >= 1,
      "green-thumb": plantsCount >= 5,
      "healer": avgHealth >= 85 && plantsCount >= 3,
      "ai-explorer": scans >= 1,
      "scan-master": scans >= 5,
      "community-voice": posts >= 1,
      "streak-keeper": doneEvents >= 3,
      "calendar-keeper": doneEvents >= 10,
    };

    const badges = [
      { key: "first-sprout", icon: "sprout", fa: "نخستین جوانه", en: "First Sprout", descFa: "اولین گیاهت را به باغ اضافه کن", descEn: "Add your first plant to the garden" },
      { key: "green-thumb", icon: "leaf", fa: "دست سبز", en: "Green Thumb", descFa: "۵ گیاه در باغ داشته باش", descEn: "Grow 5 plants in your garden" },
      { key: "healer", icon: "heart", fa: "شفادهنده", en: "Healer", descFa: "سلامت میانگین باغ را بالای ۸۵٪ نگه دار", descEn: "Keep garden health above 85%" },
      { key: "ai-explorer", icon: "scan", fa: "کاوشگر هوش مصنوعی", en: "AI Explorer", descFa: "اولین اسکن گیاه را انجام بده", descEn: "Run your first AI plant scan" },
      { key: "scan-master", icon: "sparkles", fa: "استاد اسکن", en: "Scan Master", descFa: "۵ گیاه را با هوش مصنوعی شناسایی کن", descEn: "Identify 5 plants with AI" },
      { key: "community-voice", icon: "megaphone", fa: "صدای جامعه", en: "Community Voice", descFa: "اولین پستت را منتشر کن", descEn: "Publish your first community post" },
      { key: "streak-keeper", icon: "flame", fa: "نگهبان پیوستگی", en: "Streak Keeper", descFa: "۳ وظیفه مراقبت را انجام بده", descEn: "Complete 3 care tasks" },
      { key: "calendar-keeper", icon: "calendar", fa: "نگهبان تقویم", en: "Calendar Keeper", descFa: "۱۰ یادآوری مراقبت را تکمیل کن", descEn: "Complete 10 care reminders" },
    ].map((b) => ({ ...b, earned: earned[b.key] ?? false }));

    return NextResponse.json({
      success: true,
      profile: {
        name: { fa: "سارا محمدی", en: "Sara Mohammadi" },
        email: "sara.m@plantverse.ir",
        joinedFa: "بهار ۱۴۰۳",
        joinedEn: "Spring 2024",
        avatar: "/images/avatar-w1.jpg",
        plantsCount,
        avgHealth,
        scansCount: scans,
        postsCount: posts,
        doneEventsCount: doneEvents,
        streakDays: streak.current,
        xp,
        level,
        xpProgress,
        xpToNext: Math.max(0, levelCeil - xp),
        badges,
      },
    });
  } catch {
    return NextResponse.json({ success: false, error: "server_error" }, { status: 500 });
  }
}
