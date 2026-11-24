import { NextResponse } from "next/server";
import { z } from "zod";
import ZAI from "z-ai-web-dev-sdk";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* ── Input armor ── */
const bodySchema = z.object({
  /** base64 data URL of a short voice recording (MediaRecorder output) */
  audio: z.string().max(12_000_000).optional(),
  /** deterministic demo transcription — used when no microphone is available */
  demo: z.boolean().optional(),
});

/* Simple in-memory rate limiter (per-IP sliding window, same pattern as /api/scan) */
const hits = new Map<string, number[]>();
function rateLimit(ip: string, max = 30, windowMs = 60_000) {
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length <= max;
}

/** Extract the raw base64 payload from a `data:audio/...;base64,` URL.
 *  Payloads smaller than 24 bytes can never be real audio — rejected. */
function audioBase64(dataUrl: string): string | null {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return null;
  const header = dataUrl.slice(0, comma);
  if (!header.startsWith("data:")) return null;
  if (!/^data:(audio|application\/octet-stream)/i.test(header)) return null;
  const b64 = dataUrl.slice(comma + 1).trim();
  return b64.length >= 32 ? b64 : null;
}

/**
 * POST /api/voice-search — transcribe a short voice query (ASR).
 * Returns `{ success, text }`; the encyclopedia applies the text to its
 * client-side search. A `demo` flag yields a deterministic transcript so the
 * full flow stays testable on microphone-less devices.
 */
export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for") ?? "local";
  if (!rateLimit(ip)) {
    return NextResponse.json({ success: false, error: "rate_limited" }, { status: 429 });
  }

  const body = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ success: false, error: "invalid_body" }, { status: 400 });
  }

  if (body.data.demo) {
    return NextResponse.json({ success: true, text: "سانسوریا" });
  }

  if (!body.data.audio) {
    return NextResponse.json({ success: false, error: "missing_audio" }, { status: 400 });
  }

  const b64 = audioBase64(body.data.audio);
  if (!b64) {
    return NextResponse.json({ success: false, error: "invalid_audio" }, { status: 400 });
  }

  try {
    const zai = await ZAI.create();
    const res = await zai.audio.asr.create({ file_base64: b64 });
    const text = String(res?.text ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
    if (!text) {
      return NextResponse.json({ success: false, error: "empty_transcription" }, { status: 422 });
    }
    return NextResponse.json({ success: true, text });
  } catch (err) {
    /* classify service rejections so the client can show a targeted fix
       (30 s window overflow vs. recorder format the service can't read)
       instead of a generic "try again" — both classes are caller-fixable */
    const msg = String((err as { message?: string })?.message ?? "");
    if (/时长|length|duration|limit/i.test(msg)) {
      return NextResponse.json({ success: false, error: "too_long" }, { status: 422 });
    }
    if (/format|convert|unsupported/i.test(msg)) {
      return NextResponse.json({ success: false, error: "unsupported_format" }, { status: 422 });
    }
    return NextResponse.json({ success: false, error: "asr_unavailable" }, { status: 503 });
  }
}
