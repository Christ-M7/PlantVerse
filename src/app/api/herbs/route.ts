import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Medicinal herb garden («باغ گیاهان دارویی»). 
 *
 * Read-only knowledge surface over Plant rows whose `category` is
 * "medicinal". Curated profiles live in the code catalogue below and are
 * seeded idempotently (sequential upserts by `plantSlug`) on GET — content
 * is version-controlled, storage stays queryable. Rows are enriched with
 * the live Plant basics and the single-viewer garden membership so the
 * dialog can render «افزودن به باغچه» vs «در باغچه است» honestly.
 *
 * Search (?q=) spans bilingual names, taglines, uses and the scientific
 * name; ?slug= returns one profile (404 for unknown/ungrown slugs).
 * Mutations deliberately live elsewhere: adding an herb to the garden
 * reuses POST /api/garden — one authority per mutation.
 */

/* ── curated catalogue (safety-reviewed, bilingual) ──────────────────────── */

interface Preparation {
  titleFa: string;
  titleEn: string;
  bodyFa: string;
  bodyEn: string;
}

const HERB_CATALOGUE: {
  plantSlug: string;
  emoji: string;
  taglineFa: string;
  taglineEn: string;
  usesFa: string[];
  usesEn: string[];
  activesFa: string[];
  activesEn: string[];
  preparations: Preparation[];
  cautionsFa: string[];
  cautionsEn: string[];
  teaSafe: boolean;
}[] = [
  {
    plantSlug: "garden-thyme",
    emoji: "🌱",
    taglineFa: "دمنوش کلاسیک سرفه و گلودرد — آنتی‌باکتریال طبیعی",
    taglineEn: "The classic cold-season tea — nature's antibacterial",
    usesFa: [
      "تسکین سرفه و گلودرد",
      "خلط‌آوری ملایم در سرماخوردگی",
      "حمایت از گوارش پس از غذای سنگین",
      "ضدباکتری و ضدقارچ طبیعی",
    ],
    usesEn: [
      "Soothes coughs and sore throats",
      "Gentle expectorant during colds",
      "Eases digestion after heavy meals",
      "Natural antibacterial and antifungal",
    ],
    activesFa: ["تیمول", "کارواکرول", "روغن‌های اسانسی", "فلاونوئیدها"],
    activesEn: ["Thymol", "Carvacrol", "Essential oils", "Flavonoids"],
    preparations: [
      {
        titleFa: "دم‌نوش آویشن",
        titleEn: "Thyme infusion",
        bodyFa: "یک قاشق غذاخوری آویشن خشک را در یک فنجان آب جوش ۱۰ دقیقه دم کنید، با عسل شیرین کنید.",
        bodyEn: "Steep 1 tablespoon of dried thyme in a cup of boiling water for 10 minutes; sweeten with honey.",
      },
      {
        titleFa: "غرغره برای گلودرد",
        titleEn: "Sore-throat gargle",
        bodyFa: "دم‌نوش ولرم آویشن را با کمی نمک غرغره کنید — روزی دو تا سه بار.",
        bodyEn: "Gargle with lukewarm thyme infusion and a pinch of salt, two to three times a day.",
      },
      {
        titleFa: "بخور آویشن",
        titleEn: "Thyme steam inhalation",
        bodyFa: "دو قاشق آویشن را در کاسه آب داغ بریزید و بخار آن را با حوله روی سر استنشاق کنید.",
        bodyEn: "Add two tablespoons of thyme to a bowl of hot water and inhale the steam with a towel over your head.",
      },
    ],
    cautionsFa: [
      "روغن اسانسی خالص آویشن هرگز نباید خوراکی مصرف شود",
      "مصرف دارویی طولانی‌مدت فقط با نظر پزشک",
      "در بارداری مقدار غذایی مانَند است؛ بیش از آن مصرف نکنید",
    ],
    cautionsEn: [
      "Pure thyme essential oil must never be ingested",
      "Long-term medicinal use only under medical supervision",
      "Culinary amounts are safe in pregnancy; do not exceed them",
    ],
    teaSafe: true,
  },
  {
    plantSlug: "rosemary",
    emoji: "🌿",
    taglineFa: "گیاه تمرکز و حافظه — آنتی‌اکسیدان آشپزخانه",
    taglineEn: "The focus and memory herb — kitchen antioxidant",
    usesFa: [
      "تقویت تمرکز و هوشیاری با رایحه‌درمانی",
      "دم‌نوش ملایم برای نشاط",
      "آنتی‌اکسیدان و نگهدارنده طبیعی غذا",
      "آبکش مو برای پوست سر و درخشش مو",
    ],
    usesEn: [
      "Aromatherapy for focus and alertness",
      "A gentle pick-me-up infusion",
      "Antioxidant and natural food preservative",
      "Hair rinse for scalp health and shine",
    ],
    activesFa: ["اسید رزمارینیک", "کارنوزیک اسید", "سینئول", "کامفر"],
    activesEn: ["Rosmarinic acid", "Carnosic acid", "Cineole", "Camphor"],
    preparations: [
      {
        titleFa: "دم‌نوش رزماری",
        titleEn: "Rosemary tea",
        bodyFa: "یک قاشق چای‌خوری برگ تازه یا خشک را ۵ دقیقه دم کنید — صبح‌ها برای شروع متمرکز.",
        bodyEn: "Steep 1 teaspoon of fresh or dried leaves for 5 minutes — mornings, for a focused start.",
      },
      {
        titleFa: "رایحه‌درمانی",
        titleEn: "Aroma boost",
        bodyFa: "چند شاخه را بین انگشتان له کنید و نفس عمیق بکشید یا یک شاخه روی میز کار بگذارید.",
        bodyEn: "Crush a sprig between your fingers and inhale deeply, or keep one on your desk.",
      },
      {
        titleFa: "آبکش مو",
        titleEn: "Hair rinse",
        bodyFa: "دو شاخه رزماری را در دو لیوان آب بجوشانید، صاف کنید و پس از شامپو روی مو بریزید.",
        bodyEn: "Simmer two sprigs in two cups of water, strain, and pour over hair after shampooing.",
      },
    ],
    cautionsFa: [
      "مصرف خوراکی روغن اسانسی خالص رزماری خطرناک است",
      "در فشار خون بالا و صرع مقدار زیاد دم‌نوش توصیه نمی‌شود",
      "حساسیت به تیره نعناییان می‌تواند به رزماری هم تسری یابد",
    ],
    cautionsEn: [
      "Ingesting pure rosemary essential oil is dangerous",
      "Large medicinal amounts are not advised with hypertension or epilepsy",
      "Mint-family allergies can extend to rosemary",
    ],
    teaSafe: true,
  },
  {
    plantSlug: "aloe-vera",
    emoji: "🌵",
    taglineFa: "داروخانه سبز پوست — التیام سوختگی و آفتاب",
    taglineEn: "The skin's green pharmacy — burn and sunburn relief",
    usesFa: [
      "التیام سوختگی‌های سطحی و آفتاب‌سوختگی",
      "مرطوب‌کننده و آرام‌کننده پوست",
      "ژل موضعی برای خراش‌های کوچک",
      "ماسک صورت و مو (خارجی)",
    ],
    usesEn: [
      "Relief for minor burns and sunburn",
      "Skin moisturizing and soothing",
      "Topical gel for small scrapes",
      "Face and hair masks (external use)",
    ],
    activesFa: ["پلی‌ساکاریدها", "گلوکومانان", "ویتامین E", "آنزیم‌های گیاهی"],
    activesEn: ["Polysaccharides", "Glucomannan", "Vitamin E", "Plant enzymes"],
    preparations: [
      {
        titleFa: "ژل موضعی سوختگی",
        titleEn: "Burn gel",
        bodyFa: "برگ را عمودی برش بزنید، ژل شفاف را با قاشق جمع کنید و روی پوست تمیز بمالید.",
        bodyEn: "Slice a leaf lengthwise, scoop the clear gel, and apply to clean skin.",
      },
      {
        titleFa: "ماسک آرام‌بخش",
        titleEn: "Soothing mask",
        bodyFa: "ژل آلوئه را با چند قطره عسل مخلوط و ۱۰ دقیقه روی صورت نگه دارید، سپس بشویید.",
        bodyEn: "Mix aloe gel with a few drops of honey, leave on the face for 10 minutes, then rinse.",
      },
    ],
    cautionsFa: [
      "لاتکس زیر پوست آلوئه (آلوئین) ملین قوی است — مصرف خوراکی طولانی‌مدت خطرناک است",
      "برای زنان باردار و شیرده مصرف خوراکی توصیه نمی‌شود",
      "پیش از مصرف خوراکی حتماً با پزشک مشورت کنید",
      "پیش از استفاده موضعی، تست کوچک حساسیت روی ساعد انجام دهید",
    ],
    cautionsEn: [
      "Aloe latex under the skin (aloin) is a strong laxative — prolonged oral use is risky",
      "Not recommended for oral use during pregnancy or breastfeeding",
      "Always consult a physician before ingesting",
      "Patch-test on the forearm before topical use",
    ],
    teaSafe: false,
  },
] as const;

/** Seed only slugs that exist as medicinal plants — the catalog is the truth. */
async function ensureHerbProfiles() {
  const plants = await db.plant.findMany({
    where: { category: "medicinal" },
    select: { slug: true },
  });
  const known = new Set(plants.map((p) => p.slug));
  const catalogue = HERB_CATALOGUE.filter((h) => known.has(h.plantSlug));
  const rows: Awaited<ReturnType<typeof db.herbProfile.upsert>>[] = [];
  for (const h of catalogue) {
    rows.push(
      await db.herbProfile.upsert({
        where: { plantSlug: h.plantSlug },
        create: {
          plantSlug: h.plantSlug,
          emoji: h.emoji,
          taglineFa: h.taglineFa,
          taglineEn: h.taglineEn,
          usesFa: JSON.stringify(h.usesFa),
          usesEn: JSON.stringify(h.usesEn),
          activesFa: JSON.stringify(h.activesFa),
          activesEn: JSON.stringify(h.activesEn),
          preparations: JSON.stringify(h.preparations),
          cautionsFa: JSON.stringify(h.cautionsFa),
          cautionsEn: JSON.stringify(h.cautionsEn),
          teaSafe: h.teaSafe,
        },
        update: {}, // catalogue is code-owned — never clobber live rows
      })
    );
  }
  return rows;
}

/** Safe JSON parse — a corrupted row degrades to empty lists, never a 500. */
const parseJson = <T,>(raw: string, fallback: T): T => {
  try {
    const v = JSON.parse(raw);
    return v ?? fallback;
  } catch {
    return fallback;
  }
};

/* ── GET — list (auto-seeds) or one profile (?slug=) ─────────────────────── */

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const slug = url.searchParams.get("slug");
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();

    await ensureHerbProfiles();

    if (slug) {
      const row = await db.herbProfile.findUnique({ where: { plantSlug: slug } });
      if (!row) {
        return NextResponse.json({ success: false, error: "herb_not_found" }, { status: 404 });
      }
      const plant = await db.plant.findUnique({ where: { slug: row.plantSlug } });
      if (!plant) {
        return NextResponse.json({ success: false, error: "herb_not_found" }, { status: 404 });
      }
      const inGarden = (await db.gardenPlant.findFirst({
        where: { plantSlug: row.plantSlug },
        select: { id: true },
      })) !== null;
      return NextResponse.json({
        success: true,
        herb: shapeHerb(row, plant, inGarden),
      });
    }

    const [rows, plants, garden] = await Promise.all([
      db.herbProfile.findMany({ orderBy: { plantSlug: "asc" } }),
      db.plant.findMany({
        where: { category: "medicinal" },
        select: { slug: true, nameFa: true, nameEn: true, scientificName: true, image: true, toxicity: true },
      }),
      db.gardenPlant.findMany({ select: { plantSlug: true } }),
    ]);
    const bySlug = new Map(plants.map((p) => [p.slug, p]));
    const gardenSet = new Set(garden.map((g) => g.plantSlug));

    let herbs = rows
      .filter((r) => bySlug.has(r.plantSlug))
      .map((r) => shapeHerb(r, bySlug.get(r.plantSlug)!, gardenSet.has(r.plantSlug)));

    if (q) {
      const match = (s: string | undefined) => (s ?? "").toLowerCase().includes(q);
      herbs = herbs.filter((h) =>
        [h.nameFa, h.nameEn, h.scientificName, h.taglineFa, h.taglineEn, ...h.usesFa, ...h.usesEn].some(match)
      );
    }

    return NextResponse.json({ success: true, count: herbs.length, herbs });
  } catch (err) {
    console.error("[herbs:GET]", err);
    return NextResponse.json({ success: false, error: "server_error" }, { status: 500 });
  }
}

type ProfileRow = {
  plantSlug: string;
  emoji: string;
  taglineFa: string;
  taglineEn: string;
  usesFa: string;
  usesEn: string;
  activesFa: string;
  activesEn: string;
  preparations: string;
  cautionsFa: string;
  cautionsEn: string;
  teaSafe: boolean;
};

type PlantBasics = { nameFa: string; nameEn: string; scientificName: string; image: string; toxicity: string };

function shapeHerb(row: ProfileRow, plant: PlantBasics, inGarden: boolean) {
  return {
    plantSlug: row.plantSlug,
    emoji: row.emoji,
    taglineFa: row.taglineFa,
    taglineEn: row.taglineEn,
    nameFa: plant.nameFa,
    nameEn: plant.nameEn,
    scientificName: plant.scientificName,
    image: plant.image,
    toxicity: plant.toxicity,
    usesFa: parseJson<string[]>(row.usesFa, []),
    usesEn: parseJson<string[]>(row.usesEn, []),
    activesFa: parseJson<string[]>(row.activesFa, []),
    activesEn: parseJson<string[]>(row.activesEn, []),
    preparations: parseJson<Preparation[]>(row.preparations, []),
    cautionsFa: parseJson<string[]>(row.cautionsFa, []),
    cautionsEn: parseJson<string[]>(row.cautionsEn, []),
    teaSafe: row.teaSafe,
    inGarden,
  };
}
