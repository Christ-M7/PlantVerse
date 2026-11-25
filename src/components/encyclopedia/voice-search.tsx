"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Mic, MicOff, RotateCcw, Search, Sparkles, Square } from "lucide-react";
import { useLang } from "@/lib/i18n/use-lang";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/* ────────────────────────── states ────────────────────────── */

type VoiceState = "idle" | "recording" | "processing" | "done" | "error";

const MAX_SECONDS = 15;

/**
 * VoiceSearch — microphone capture → /api/voice-search (ASR) → transcript.
 * Falls back to an honest, clearly-labeled demo transcript when no microphone
 * is available (headless browsers, denied permission, unsupported devices).
 */
export function VoiceSearch({
  open,
  onOpenChange,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (text: string) => void;
}) {
  const { tx, isFa, num } = useLang();
  const [state, setState] = useState<VoiceState>("idle");
  const [seconds, setSeconds] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [errorKey, setErrorKey] = useState<"denied" | "nommic" | "failed" | "empty" | "unsupported" | "too_long">("failed");

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const aliveRef = useRef(false);
  /** recording start timestamp — drives the hidden-tab-proof length cap */
  const startedAtRef = useRef(0);

  /* ── helpers ── */

  const clearTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const releaseStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
  };

  /* mic + timer release whenever the dialog closes (ref work belongs in effects) */
  useEffect(() => {
    if (open) return;
    clearTimer();
    releaseStream();
  }, [open]);

  /* stop mic + timers on unmount */
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      clearTimer();
      releaseStream();
    };
  }, []);

  const transcribe = useCallback(
    async (payload: { audio?: string; demo?: boolean }) => {
      if (!aliveRef.current) return;
      setState("processing");
      try {
        const res = await fetch("/api/voice-search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = (await res.json().catch(() => ({}))) as { success?: boolean; text?: string; error?: string };
        if (!aliveRef.current) return;
        if (res.ok && data.success && data.text) {
          setTranscript(data.text);
          setState("done");
        } else {
          setErrorKey(
            data.error === "empty_transcription" ? "empty"
            : data.error === "too_long" ? "too_long"
            : data.error === "unsupported_format" ? "unsupported"
            : "failed"
          );
          setState("error");
        }
      } catch {
        if (!aliveRef.current) return;
        setErrorKey("failed");
        setState("error");
      }
    },
    [],
  );

  const stopAndSend = useCallback(() => {
    clearTimer();
    const recorder = recorderRef.current;
    if (!recorder) {
      releaseStream();
      return;
    }
    /* onstop fires after stop() — send the assembled blob to ASR */
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
      releaseStream();
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === "string" && aliveRef.current) {
          transcribe({ audio: reader.result });
        }
      };
      reader.onerror = () => {
        if (aliveRef.current) {
          setErrorKey("failed");
          setState("error");
        }
      };
      reader.readAsDataURL(blob);
    };
    try {
      recorder.stop();
    } catch {
      releaseStream();
      setErrorKey("failed");
      setState("error");
    }
  }, [transcribe]);

  const startRecording = useCallback(async () => {
    setErrorKey("failed");
    setTranscript("");
    setSeconds(0);

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setErrorKey("nommic");
      setState("error");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!aliveRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : undefined;
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

      /* the speech service only accepts WAV/WebM — a browser whose recorder
         falls back to mp4/ogg (older Safari, in-app webviews) would upload
         doomed audio and die server-side. Fail fast with a targeted
         message instead of a generic error after a wasted round-trip. */
      const actual = recorder.mimeType || mimeType || "";
      if (actual && !actual.startsWith("audio/webm")) {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        recorderRef.current = null;
        setErrorKey("unsupported");
        setState("error");
        return;
      }

      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
        /* hidden-tab-proof length cap: setInterval throttles to ≥1/min in
           background tabs, but the media pipeline keeps delivering chunks —
           enforce the limit here so recordings never outgrow the service's
           30 s window */
        if (
          Date.now() - startedAtRef.current >= MAX_SECONDS * 1000 &&
          recorder.state !== "inactive"
        ) {
          stopAndSend();
        }
      };
      recorder.start(250);
      startedAtRef.current = Date.now();
      setState("recording");

      /* live counter + UI-level cap so payloads stay small */
      timerRef.current = setInterval(() => {
        setSeconds((s) => {
          const next = s + 1;
          if (next >= MAX_SECONDS) stopAndSend();
          return next;
        });
      }, 1000);
    } catch (err) {
      const name = (err as { name?: string })?.name;
      setErrorKey(name === "NotAllowedError" || name === "SecurityError" ? "denied" : name === "NotFoundError" ? "nommic" : "failed");
      setState("error");
    }
  }, [stopAndSend]);

  /* ── error copy ── */
  const errorCopy: Record<string, { fa: string; en: string }> = {
    "denied": { fa: "دسترسی به میکروفون داده نشد. از تنظیمات مرورگر اجازه بدهید و دوباره تلاش کنید.", en: "Microphone access was denied. Allow it in your browser settings and try again." },
    "nommic": { fa: "میکروفونی پیدا نشد یا مرورگر شما از ضبط صدا پشتیبانی نمی‌کند.", en: "No microphone found, or your browser does not support audio recording." },
    "failed": { fa: "تبدیل گفتار به متن ممکن نشد. لطفاً دوباره تلاش کنید.", en: "Speech recognition failed. Please try again." },
    "empty": { fa: "صدایی شنیده نشد. کمی نزدیک‌تر صحبت کنید.", en: "No speech detected. Try speaking a little closer." },
    "unsupported": { fa: "مرورگر شما فرمت صوتی پشتیبانی‌شده را ضبط نمی‌کند؛ لطفاً نام گیاه را تایپ کنید.", en: "Your browser records in a format our speech service can't read — please type the plant name instead." },
    "too_long": { fa: "ضبط بیش از حد طولانی شد؛ کوتاه‌تر صحبت کنید (حداکثر ۱۵ ثانیه).", en: "Recording ran too long — keep it short (max 15 s)." },
  };

  /* ── render ── */

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] gap-0 overflow-hidden rounded-3xl p-0 sm:max-w-md" data-testid="voice-dialog">
        <div className="p-6 text-center">
          <DialogTitle className="flex items-center justify-center gap-2 text-lg font-extrabold">
            <Mic className="size-5 text-forest dark:text-primary" aria-hidden />
            {tx("جستجوی صوتی", "Voice search")}
          </DialogTitle>
          <DialogDescription className="mt-1 text-xs text-muted-foreground">
            {tx("نام گیاه مورد نظرتان را بگویید", "Say the name of the plant you're looking for")}
          </DialogDescription>

          <AnimatePresence mode="wait" initial={false}>
            {/* ── idle ── */}
            {(state === "idle" || state === "done") && (
              <motion.div
                key={state === "done" ? "done" : "idle"}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
                className="mt-5"
              >
                {state === "idle" ? (
                  <>
                    <button
                      type="button"
                      onClick={startRecording}
                      data-testid="voice-mic-btn"
                      aria-label={tx("شروع ضبط", "Start recording")}
                      className="mx-auto size-20 rounded-full bg-forest dark:bg-primary text-primary-foreground grid place-items-center shadow-xl shadow-forest/30 hover:scale-105 active:scale-95 transition-transform"
                    >
                      <Mic className="size-8" aria-hidden />
                    </button>
                    <p className="mt-3 text-sm text-muted-foreground">
                      {tx("برای شروع ضبط بزنید", "Tap to start recording")}
                    </p>
                  </>
                ) : (
                  <>
                    <div
                      data-testid="voice-transcript"
                      className="mx-auto min-h-16 rounded-2xl border border-border bg-muted/40 px-4 py-3 text-sm font-medium leading-relaxed"
                    >
                      «{transcript}»
                    </div>
                    <div className="mt-4 flex items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => onApply(transcript)}
                        data-testid="voice-apply"
                        className="h-10 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground hover:opacity-90 transition-opacity"
                      >
                        <span className="flex items-center gap-1.5">
                          <Search className="size-4" aria-hidden />
                          {tx("جستجو", "Search")}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={startRecording}
                        className="h-10 rounded-xl border border-border bg-card px-4 text-sm font-medium hover:bg-muted transition-colors"
                      >
                        <span className="flex items-center gap-1.5">
                          <RotateCcw className="size-4" aria-hidden />
                          {tx("ضبط مجدد", "Record again")}
                        </span>
                      </button>
                    </div>
                  </>
                )}
              </motion.div>
            )}

            {/* ── recording ── */}
            {state === "recording" && (
              <motion.div
                key="recording"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
                className="mt-5"
              >
                <button
                  type="button"
                  onClick={stopAndSend}
                  data-testid="voice-stop-btn"
                  aria-label={tx("پایان ضبط", "Stop recording")}
                  className="relative mx-auto size-20 rounded-full bg-red-500 text-white grid place-items-center shadow-xl shadow-red-500/30"
                >
                  <motion.span
                    aria-hidden
                    className="absolute inset-0 rounded-full bg-red-500/40"
                    animate={{ scale: [1, 1.35, 1], opacity: [0.7, 0.15, 0.7] }}
                    transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
                  />
                  <Square className="size-6 fill-current" aria-hidden />
                </button>
                <p className="mt-3 text-sm text-muted-foreground" aria-live="polite">
                  {tx("در حال شنیدن…", "Listening…")}{" "}
                  <span className="font-bold text-foreground tabular-nums">{num(seconds)}</span>
                  <span className="text-xs"> / {num(MAX_SECONDS)}</span>
                </p>
              </motion.div>
            )}

            {/* ── processing ── */}
            {state === "processing" && (
              <motion.div
                key="processing"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
                className="mt-5"
                aria-live="polite"
              >
                <div className="mx-auto flex size-20 items-center justify-center">
                  {[0, 1, 2].map((i) => (
                    <motion.span
                      key={i}
                      className="mx-0.5 size-3 rounded-full bg-forest dark:bg-primary"
                      animate={{ y: [0, -8, 0] }}
                      transition={{ duration: 0.7, repeat: Infinity, delay: i * 0.15, ease: "easeInOut" }}
                    />
                  ))}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{tx("در حال تبدیل گفتار به متن…", "Transcribing…")}</p>
              </motion.div>
            )}

            {/* ── error ── */}
            {state === "error" && (
              <motion.div
                key="error"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
                className="mt-5"
                role="alert"
                data-testid="voice-error"
              >
                <div className="mx-auto size-16 rounded-full bg-red-500/10 grid place-items-center">
                  <MicOff className="size-7 text-red-500" aria-hidden />
                </div>
                <p className="mx-auto mt-3 max-w-xs text-sm text-muted-foreground leading-relaxed">
                  {isFa ? errorCopy[errorKey]?.fa : errorCopy[errorKey]?.en}
                </p>
                <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={startRecording}
                    className="h-10 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground hover:opacity-90 transition-opacity"
                  >
                    {tx("تلاش مجدد", "Try again")}
                  </button>
                  <button
                    type="button"
                    onClick={() => transcribe({ demo: true })}
                    data-testid="voice-demo"
                    className="h-10 rounded-xl border border-border bg-card px-4 text-sm font-medium hover:bg-muted transition-colors"
                    aria-label={tx("امتحان با نمونه نمایشی", "Try with a demo sample")}
                  >
                    <span className="flex items-center gap-1.5">
                      <Sparkles className="size-4 text-gold" aria-hidden />
                      {tx("نمونه نمایشی", "Demo sample")}
                    </span>
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <p className={cn("mt-5 text-[11px] text-muted-foreground/70")}>
            {tx(`حداکثر ${num(MAX_SECONDS)} ثانیه ضبط · پردازش صدا روی سرور`, `Max ${MAX_SECONDS}s recording · processed on the server`)}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
