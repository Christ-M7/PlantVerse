import { NextResponse } from "next/server";
import { z } from "zod";
import ZAI from "z-ai-web-dev-sdk";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* ── Military-grade input armor ── */
const bodySchema = z.object({
  image: z.string().max(8_000_000).optional(), // base64 data URL
  demo: z.boolean().optional(),
});

/* Simple in-memory rate limiter (per-IP sliding window) */
const hits = new Map<string, number[]>();
function rateLimit(ip: string, max = 12, windowMs = 60_000) {
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length <= max;
}

const IDENTIFY_PROMPT = `You are PlantVerse's expert botanist AI. Identify the plant (or fungus) in the image.
Reply with ONLY a valid JSON object, no markdown, in exactly this shape:
{
  "nameFa": "نام رایج فارسی گیاه",
  "nameEn": "English common name",
  "scientificName": "Latin binomial",
  "confidence": 88,
  "slugHint": "closest match among: monstera-deliciosa, lavender, reishi-mushroom, peace-lily, rosemary, sacred-lotus, tomato, aloe-vera, garden-thyme, calathea-ornata, golden-pothos, snake-plant, sweet-basil, fittonia, camellia — or 'unknown'",
  "care": {
    "waterFa": "مثلا: هر ۷ – ۱۰ روز",
    "waterEn": "e.g. every 7-10 days",
    "lightFa": "مثلا: نور غیرمستقیم روشن",
    "lightEn": "e.g. bright indirect light",
    "tempFa": "مثلا: ۱۸ – ۲۶ درجه",
    "tempEn": "e.g. 18-26°C"
  }
}
confidence is an integer 60-99 representing identification certainty. If the image is not a plant, set confidence below 60 and use best guess anyway.`;

/** POST /api/scan — AI plant identification (VLM) */
export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for") ?? "local";
  if (!rateLimit(ip)) {
    return NextResponse.json({ success: false, error: "rate_limited" }, { status: 429 });
  }

  try {
    const body = bodySchema.safeParse(await req.json().catch(() => ({})));
    if (!body.success) {
      return NextResponse.json({ success: false, error: "invalid_body" }, { status: 400 });
    }

    let identified: ScanResult | null = null;

    if (body.data.image) {
      identified = await visionIdentify(body.data.image);
    } else {
      // Demo scan — deterministic high-quality result
      identified = {
        nameFa: "پوتوس طلایی",
        nameEn: "Golden Pothos",
        scientificName: "Epipremnum aureum",
        confidence: 98,
        slug: "golden-pothos",
        care: {
          waterFa: "هر ۷ – ۱۰ روز", waterEn: "Every 7–10 days",
          lightFa: "نور غیرمستقیم روشن", lightEn: "Bright indirect light",
          tempFa: "۱۸ – ۲۹ درجه", tempEn: "18–29°C",
        },
      };
    }

    if (!identified) {
      return NextResponse.json({ success: false, error: "ai_unavailable" }, { status: 503 });
    }

    // persist history (best effort) — keep small data URLs, drop huge ones
    const persistedImage = body.data.image
      ? (body.data.image.length <= 750_000 ? body.data.image : "")
      : "/images/pothos.jpg";
    await db.scanRecord.create({
      data: {
        nameFa: identified.nameFa,
        nameEn: identified.nameEn,
        scientificName: identified.scientificName,
        confidence: identified.confidence,
        careInfo: JSON.stringify(identified.care),
        image: persistedImage,
      },
    }).catch(() => {});

    return NextResponse.json({ success: true, result: identified });
  } catch {
    return NextResponse.json({ success: false, error: "scan_failed" }, { status: 500 });
  }
}

/** GET /api/scan — recent scan history */
export async function GET() {
  try {
    const scans = await db.scanRecord.findMany({
      orderBy: { createdAt: "desc" },
      take: 12,
      select: { id: true, nameFa: true, nameEn: true, scientificName: true, confidence: true, image: true, createdAt: true },
    });
    return NextResponse.json({ success: true, scans });
  } catch {
    return NextResponse.json({ success: true, scans: [] });
  }
}

/* ── VLM identification with graceful degradation ── */
type VisionBody = Parameters<NonNullable<Awaited<ReturnType<typeof ZAI.create>>["chat"]["completions"]["createVision"]>>[0];

async function visionIdentify(dataUrl: string): Promise<ScanResult | null> {
  try {
    const zai = await ZAI.create();
    const body = {
      messages: [
        {
          role: "user" as const,
          content: [
            { type: "text" as const, text: IDENTIFY_PROMPT },
            { type: "image_url" as const, image_url: { url: dataUrl } },
          ],
        },
      ],
      thinking: { type: "disabled" as const },
    };
    const completion = await zai.chat.completions.createVision(body as unknown as VisionBody);
    const raw: string = completion?.choices?.[0]?.message?.content ?? "";
    const json = extractJson(raw) as ParsedId | null;
    if (!json?.nameFa) return null;
    const c = json.care ?? {};
    return {
      nameFa: String(json.nameFa).slice(0, 60),
      nameEn: String(json.nameEn ?? json.nameFa).slice(0, 60),
      scientificName: String(json.scientificName ?? "").slice(0, 80),
      confidence: clampInt(json.confidence, 55, 99),
      slug: typeof json.slugHint === "string" && json.slugHint !== "unknown" ? json.slugHint : undefined,
      care: {
        waterFa: String(c.waterFa ?? "هفته‌ای یک تا دو بار"),
        waterEn: String(c.waterEn ?? "1-2 times a week"),
        lightFa: String(c.lightFa ?? "نور غیرمستقیم"),
        lightEn: String(c.lightEn ?? "indirect light"),
        tempFa: String(c.tempFa ?? "۱۸ – ۲۶ درجه"),
        tempEn: String(c.tempEn ?? "18–26°C"),
      },
    };
  } catch {
    return null;
  }
}

function extractJson(raw: string): Record<string, unknown> | null {
  const cleaned = raw.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function clampInt(v: unknown, min: number, max: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 90;
  return Math.min(max, Math.max(min, Math.round(n)));
}

interface ScanResult {
  nameFa: string;
  nameEn: string;
  scientificName: string;
  confidence: number;
  slug?: string;
  care: {
    waterFa: string; waterEn: string;
    lightFa: string; lightEn: string;
    tempFa: string; tempEn: string;
  };
}

interface ParsedId {
  nameFa?: string; nameEn?: string; scientificName?: string;
  confidence?: unknown; slugHint?: unknown;
  care?: Partial<Record<"waterFa" | "waterEn" | "lightFa" | "lightEn" | "tempFa" | "tempEn", unknown>>;
}
