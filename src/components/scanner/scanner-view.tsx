"use client";

import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ImagePlus, Flashlight, History, ShieldCheck, Leaf, X, Camera,
  Droplets, SunDim, Thermometer, ChevronLeft, Sparkles, RotateCw, ArrowLeft, AlertTriangle,
} from "lucide-react";
import { useAppStore } from "@/lib/store/app-store";
import { useLang } from "@/lib/i18n/use-lang";
import { useDialogFocus } from "@/hooks/use-dialog-focus";

interface ScanResult {
  nameFa: string; nameEn: string;
  scientificName: string;
  confidence: number;
  care: { waterFa: string; waterEn: string; lightFa: string; lightEn: string; tempFa: string; tempEn: string };
  slug?: string;
}

const DEMO_IMG = "/images/pothos.jpg";

export function ScannerView() {
  const navigate = useAppStore((s) => s.navigate);
  const goBack = useAppStore((s) => s.goBack);
  const showToast = useAppStore((s) => s.showToast);
  const { tx, num, isFa } = useLang();

  const [phase, setPhase] = useState<"idle" | "scanning" | "result" | "error">("idle");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [torch, setTorch] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<{ id: string; nameFa: string; nameEn: string; scientificName?: string; confidence: number; image?: string }[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const [camActive, setCamActive] = useState(false);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [imgSrc, setImgSrc] = useState<string>(DEMO_IMG);

  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastImageRef = useRef<string | null>(null);
  const scanningRef = useRef(false);
  const historySeq = useRef(0);
  const historyDialogRef = useRef<HTMLElement>(null);
  useDialogFocus(historyOpen, historyDialogRef);

  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

  /* Escape closes the history sheet (custom overlay) */
  useEffect(() => {
    if (!historyOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setHistoryOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [historyOpen]);

  const openHistory = useCallback(async () => {
    setHistoryOpen(true);
    setHistoryLoading(true);
    setHistoryError(false);
    const seq = ++historySeq.current;
    try {
      const res = await fetch("/api/scan");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (seq !== historySeq.current) return; // stale response (double-open)
      setHistory(data.scans ?? []);
    } catch {
      if (seq !== historySeq.current) return;
      /* real error state — a network hiccup must not read as «no scans yet» */
      setHistoryError(true);
    } finally {
      if (seq === historySeq.current) setHistoryLoading(false);
    }
  }, []);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const startCamera = async (mode: "environment" | "user" = facing) => {
    try {
      /* stop any previous stream first — re-enabling leaked tracks */
      stopCamera();
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: mode } });
      streamRef.current = stream;
      setFacing(mode);
      setCamActive(true);
      setImgSrc("");
      setTimeout(() => {
        if (videoRef.current) videoRef.current.srcObject = stream;
      }, 50);
    } catch {
      showToast(tx("دسترسی دوربین رد شد — با گالری امتحان کنید", "Camera denied — try the gallery"));
    }
  };

  const toggleTorch = async () => {
    const next = !torch;
    setTorch(next);
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) {
      showToast(tx("چراغ قوه فقط با دوربین زنده کار می‌کند", "Flash needs the live camera"));
      return;
    }
    try {
      /* real torch where the platform supports it (Chrome/Android) */
      await track.applyConstraints({ advanced: [{ torch: next }] } as unknown as MediaTrackConstraints);
    } catch {
      showToast(tx("این دستگاه از چراغ قوه پشتیبانی نمی‌کند", "Torch not supported on this device"));
    }
  };

  const captureFrame = (): string | null => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return null;
    const canvas = document.createElement("canvas");
    const size = Math.min(v.videoWidth, v.videoHeight, 720);
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext("2d");
    ctx?.drawImage(v, (v.videoWidth - size) / 2, (v.videoHeight - size) / 2, size, size, 0, 0, size, size);
    return canvas.toDataURL("image/jpeg", 0.85);
  };

  const doScan = async (imageBase64?: string | null) => {
    if (scanningRef.current) return; // ignore double-fire while scanning
    scanningRef.current = true;
    setPhase("scanning");
    setResult(null);
    lastImageRef.current = imageBase64 ?? null;
    stopCamera();
    setCamActive(false);
    const payload = imageBase64
      ? { image: imageBase64 }
      : { demo: true };
    const minDelay = new Promise((r) => setTimeout(r, 2600)); // cinematic scan time
    try {
      const [res] = await Promise.all([
        fetch("/api/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
        minDelay,
      ]);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.success === false) throw new Error(data.error);
      setResult(data.result);
      setPhase("result");
    } catch {
      /* REAL failures get a real error state — the old catch rendered a
         fabricated 97% «Golden Pothos», which could mask a toxic-plant scan
         with a confident harmless ID */
      setPhase("error");
    } finally {
      scanningRef.current = false;
    }
  };

  const onPickFile = (f: File | undefined) => {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const raw = reader.result as string;
      const dataUrl = await downscaleImage(raw, 1024, 0.82);
      setImgSrc(dataUrl);
      doScan(dataUrl);
    };
    reader.readAsDataURL(f);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto text-emerald-50 bg-[#07120c]">
      {/* sr-only page title — the scanner surface had no heading landmark (a11y) */}
      <h1 className="sr-only">{tx("اسکن گیاه", "Scan a plant")}</h1>
      {/* deep-forest backdrop */}
      <div className="fixed inset-0 bg-[radial-gradient(120%_90%_at_50%_0%,#0d2417_0%,#07120c_55%,#050b08_100%)]" aria-hidden />

      {/* golden ornamental corners */}
      <div aria-hidden className="fixed inset-0 pointer-events-none opacity-40">
        {["top-3 start-3", "top-3 end-3 rotate-90", "bottom-3 start-3 -rotate-90", "bottom-3 end-3 rotate-180"].map((pos) => (
          <svg key={pos} viewBox="0 0 100 100" className={`absolute ${pos} size-20 sm:size-28 text-amber-200/60`} fill="none" stroke="currentColor" strokeWidth="1.4">
            <path d="M8 92C8 40 40 8 92 8" strokeLinecap="round" />
            <path d="M14 84c2-30 20-56 48-64M20 76c1-24 15-44 38-52M26 68c1-18 12-32 30-40" strokeLinecap="round" opacity="0.7" />
            <path d="M30 24c-6-4-8-10-6-16 6 2 10 6 10 12M40 18c-2-6 0-12 4-16 3 5 4 10 2 15" strokeLinecap="round" strokeWidth="1" opacity="0.8" />
          </svg>
        ))}
      </div>

      {/* digital rain */}
      {phase === "scanning" && (
        <div aria-hidden className="fixed inset-0 overflow-hidden pointer-events-none">
          {Array.from({ length: 14 }).map((_, i) => (
            <span
              key={i}
              className="absolute text-emerald-400/25 font-mono text-[10px] leading-4 select-none"
              style={{
                left: `${(i * 7.3) % 100}%`,
                animation: `pv-rain ${2.2 + (i % 5) * 0.5}s linear infinite`,
                animationDelay: `${-(i * 0.7)}s`,
                writingMode: "horizontal-tb",
              }}
            >
              {"01▓▒░ foliage chlorophyll 10".slice(0, 8 + (i % 6))}
            </span>
          ))}
        </div>
      )}

      <div className="relative z-10 min-h-full flex flex-col px-4 sm:px-8 pt-5 pb-0 max-w-4xl mx-auto w-full">
        {/* ── top bar ── */}
        <header className="flex items-center gap-3">
          <button
            onClick={() => goBack("home")}
            aria-label={tx("بازگشت به جهان‌گیاه", "Back to PlantVerse")}
            className="grid size-10 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/5 text-emerald-100/90 transition-colors hover:bg-white/10"
          >
            <ArrowLeft className="size-5 rtl:rotate-180" aria-hidden />
          </button>
          <span className="flex items-center gap-2 text-amber-100/90">
            <Leaf className="size-5 text-emerald-300" />
            <span className="text-xs sm:text-sm font-bold tracking-[0.2em]">AI PLANT SCANNER</span>
          </span>
          <span className="flex-1" />
          <AnimatePresence mode="wait">
            {phase === "scanning" ? (
              <motion.span key="scanning" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2 text-sm">
                <span className="size-2 rounded-full bg-emerald-400 animate-pulse" />
                {tx("در حال اسکن...", "Scanning...")}
              </motion.span>
            ) : phase === "error" ? (
              <motion.span key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2 text-sm text-red-300">
                <AlertTriangle className="size-4" />
                {tx("اسکن ناموفق", "Scan failed")}
              </motion.span>
            ) : (
              <motion.span key="ready" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-sm text-emerald-200/70">
                {phase === "result" ? tx("اسکن کامل شد", "Scan complete") : tx("آماده اسکن", "Ready to scan")}
              </motion.span>
            )}
          </AnimatePresence>
          <span className="flex-1" />
          <span className="size-10 rounded-2xl border border-amber-200/30 grid place-items-center text-amber-200/80">
            <ShieldCheck className="size-5" />
          </span>
        </header>

        {/* ── main area ── */}
        <div className="flex-1 flex flex-col-reverse lg:flex-row items-stretch gap-5 py-6">
          {/* viewport */}
          <motion.section
            layout
            className="relative flex-1 rounded-3xl overflow-hidden border border-emerald-200/15 shadow-[0_0_60px_-15px_rgba(16,185,129,0.35)] min-h-[340px] sm:min-h-[420px]"
            aria-label={tx("دوربین اسکنر", "Scanner viewport")}
          >
            {camActive ? (
              <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover" />
            ) : imgSrc ? (
              <Image src={imgSrc} alt={tx("نمای اسکن", "Scan view")} fill sizes="(max-width:1024px) 100vw, 66vw" className="object-cover" priority />
            ) : (
              <div className="absolute inset-0 grid place-items-center bg-[#0a1a11]">
                <button onClick={() => startCamera()} className="flex flex-col items-center gap-3 text-emerald-200/80">
                  <span className="size-20 rounded-full border border-emerald-300/30 grid place-items-center">
                    <Camera className="size-8" />
                  </span>
                  {tx("روشن‌کردن دوربین", "Turn on camera")}
                </button>
              </div>
            )}

            {/* scan FX */}
            <div className="absolute inset-0 pointer-events-none" aria-hidden>
              <span className="absolute inset-0 bg-gradient-to-t from-[#07120c]/85 via-transparent to-[#07120c]/45" />
              <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 size-52 sm:size-64 rounded-full border border-dashed border-emerald-300/40 animate-[pv-pulse-ring_2.6s_ease-out_infinite]" />
              <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 size-36 sm:size-44 rounded-full border border-emerald-300/50" />
              {phase === "scanning" && (
                <>
                  <span className="absolute inset-x-0 h-0.5 bg-emerald-400 shadow-[0_0_18px_4px_rgba(52,211,153,0.8)]" style={{ animation: "pv-scanline 1.6s ease-in-out infinite" }} />
                  <span className="absolute inset-x-8 top-0 h-px bg-emerald-300/40" />
                </>
              )}
              {/* corner brackets */}
              {["top-4 start-4 border-t-2 border-s-2 rounded-tl-xl", "top-4 end-4 border-t-2 border-e-2 rounded-tr-xl", "bottom-4 start-4 border-b-2 border-s-2 rounded-bl-xl", "bottom-4 end-4 border-b-2 border-e-2 rounded-br-xl"].map((c) => (
                <span key={c} className={`absolute size-10 border-emerald-300/60 ${c}`} />
              ))}
              {/* floating leaves */}
              {phase !== "idle" && [0, 1, 2].map((i) => (
                <motion.svg key={i} viewBox="0 0 24 24" className="absolute size-4 text-emerald-300/70"
                  style={{ left: `${18 + i * 28}%` }}
                  animate={{ y: [0, 180], rotate: [0, 200], opacity: [0, 0.8, 0] }}
                  transition={{ repeat: Infinity, duration: 5 + i, delay: i * 1.4 }}
                >
                  <path d="M12 2C7 5 3 9 4 15c.6 3.4 3 6 8 7 5-1 7.4-3.6 8-7 1-6-3-10-8-13z" fill="currentColor" />
                </motion.svg>
              ))}
            </div>

            {/* idle CTA */}
            {phase === "idle" && (
              <div className="absolute inset-x-0 bottom-6 flex flex-col items-center gap-3">
                <motion.button
                  whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
                  onClick={() => doScan(camActive ? captureFrame() : null)}
                  className="h-13 px-8 rounded-full bg-emerald-500 text-[#06120b] font-extrabold shadow-[0_0_30px_-5px_rgba(52,211,153,0.7)] flex items-center gap-2 py-3.5"
                >
                  <Sparkles className="size-5" />
                  {camActive ? tx("گرفتن عکس و شناسایی", "Capture & identify") : tx("شروع اسکن نمونه", "Scan sample plant")}
                </motion.button>
                {!camActive && (
                  <button onClick={() => startCamera()} className="text-xs text-emerald-200/70 hover:text-emerald-100 flex items-center gap-1.5">
                    <Camera className="size-4" />
                    {tx("یا دوربین زنده را روشن کنید", "or enable live camera")}
                  </button>
                )}
              </div>
            )}
          </motion.section>

          {/* side tools */}
          <aside className="flex lg:flex-col gap-3 justify-center lg:w-28" aria-label={tx("ابزارها", "Tools")}>
            <ToolButton label={tx("گالری", "Gallery")} onClick={() => fileRef.current?.click()}>
              <ImagePlus className="size-5" />
            </ToolButton>
            <ToolButton label={tx("چراغ قوه", "Flash")} onClick={toggleTorch} active={torch} dot={!torch}>
              <Flashlight className="size-5" />
            </ToolButton>
            <ToolButton
              label={tx("تاریخچه", "History")}
              onClick={openHistory}
              ariaExpanded={historyOpen}
              ariaControls="scan-history"
            >
              <History className="size-5" />
            </ToolButton>
            {camActive && (
              <ToolButton label={tx("تعویض", "Switch")} onClick={() => startCamera(facing === "environment" ? "user" : "environment")}>
                <RotateCw className="size-5" />
              </ToolButton>
            )}
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onPickFile(e.target.files?.[0])} aria-hidden />
          </aside>
        </div>

        {/* ── result card ── */}
        <AnimatePresence>
          {phase === "result" && result && (
            <motion.section
              initial={{ opacity: 0, y: 60 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 40 }}
              transition={{ type: "spring", stiffness: 160, damping: 22 }}
              className="rounded-3xl border border-emerald-200/15 bg-[#0a1c12]/90 pv-glass p-5 sm:p-6 shadow-[0_0_50px_-12px_rgba(16,185,129,0.45)]"
              aria-label={tx("نتیجه شناسایی", "Scan result")}
            >
              <div className="flex items-center gap-2 text-emerald-200/80 text-sm">
                <Leaf className="size-4" />
                {tx("نتیجه شناسایی", "Identification result")}
              </div>
              <div className="mt-3 flex items-center gap-4">
                <span className="size-12 rounded-2xl bg-emerald-500/15 grid place-items-center">
                  <Leaf className="size-6 text-emerald-300" />
                </span>
                <div className="flex-1 min-w-0">
                  <h2 className="text-xl sm:text-2xl font-extrabold text-emerald-50">{tx(result.nameFa, result.nameEn)}</h2>
                  <p className="text-emerald-300/80 italic text-sm">{result.scientificName}</p>
                </div>
                {/* confidence ring */}
                <div className="relative size-20 sm:size-24 shrink-0">
                  <svg viewBox="0 0 100 100" className="size-full -rotate-90">
                    <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="8" />
                    <motion.circle
                      cx="50" cy="50" r="42" fill="none" stroke="#34d399" strokeWidth="8" strokeLinecap="round"
                      strokeDasharray={264}
                      initial={{ strokeDashoffset: 264 }}
                      animate={{ strokeDashoffset: 264 - (264 * result.confidence) / 100 }}
                      transition={{ duration: 1.4, ease: "easeOut" }}
                    />
                  </svg>
                  <div className="absolute inset-0 grid place-items-center text-center leading-none">
                    <div>
                      <p className="text-lg sm:text-xl font-extrabold">{num(result.confidence)}{isFa ? "٪" : "%"}</p>
                      <p className="text-[9px] text-emerald-200/70">{tx("اطمینان", "confidence")}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-emerald-200/10">
                <p className="text-xs text-emerald-200/70 flex items-center gap-1.5 mb-2.5">
                  <Sparkles className="size-3.5 text-amber-300" />
                  {tx("نکات سریع نگهداری", "Quick care tips")}
                </p>
                <div className="grid grid-cols-3 divide-x divide-x-reverse divide-emerald-200/10 rtl:divide-x-reverse text-center">
                  {[
                    { icon: Droplets, fa: result.care.waterFa, en: result.care.waterEn, t: tx("آبیاری", "Water") },
                    { icon: SunDim, fa: result.care.lightFa, en: result.care.lightEn, t: tx("نور", "Light") },
                    { icon: Thermometer, fa: result.care.tempFa, en: result.care.tempEn, t: tx("دما", "Temp") },
                  ].map((c) => (
                    <div key={c.t} className="px-2">
                      <c.icon className="size-5 mx-auto text-emerald-300 mb-1" />
                      <p className="text-[11px] font-bold">{c.t}</p>
                      <p className="text-[10px] text-emerald-200/70 mt-0.5">{tx(c.fa, c.en)}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-4 flex gap-3">
                <motion.button
                  whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                  onClick={() => result.slug ? navigate("plant", { slug: result.slug }) : showToast(tx("این گونه به‌زودی به دانشنامه اضافه می‌شود", "This species is coming soon"))}
                  className="flex-1 h-12 rounded-full bg-emerald-500 text-[#06120b] font-extrabold flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-500/30"
                >
                  {tx("مشاهده جزئیات کامل", "View full details")}
                  <ChevronLeft className="size-4 rtl:rotate-0 ltr:rotate-180" />
                </motion.button>
                <button
                  onClick={() => { setPhase("idle"); setImgSrc(DEMO_IMG); }}
                  className="h-12 px-5 rounded-full border border-emerald-200/25 text-emerald-100 font-bold text-sm hover:bg-emerald-500/10 transition-colors"
                >
                  {tx("اسکن جدید", "New scan")}
                </button>
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {/* ── error card ── */}
        <AnimatePresence>
          {phase === "error" && (
            <motion.section
              initial={{ opacity: 0, y: 60 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 40 }}
              transition={{ type: "spring", stiffness: 160, damping: 22 }}
              className="rounded-3xl border border-red-300/25 bg-[#1a0d0d]/90 pv-glass p-5 sm:p-6"
              role="alert"
              aria-label={tx("خطای اسکن", "Scan error")}
            >
              <div className="flex items-start gap-3">
                <span className="size-12 rounded-2xl bg-red-500/15 grid place-items-center shrink-0">
                  <AlertTriangle className="size-6 text-red-300" />
                </span>
                <div className="flex-1 min-w-0">
                  <h2 className="text-lg font-extrabold text-red-100">{tx("شناسایی ناموفق بود", "Identification failed")}</h2>
                  <p className="text-sm text-red-200/70 mt-1">
                    {tx(
                      "ارتباط با سرویس شناسایی برقرار نشد. دوباره تلاش کنید یا گیاه را در دانشنامه جستجو کنید.",
                      "Couldn't reach the identification service. Try again, or search the plant in the encyclopedia."
                    )}
                  </p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  onClick={() => doScan(lastImageRef.current)}
                  className="flex-1 min-w-36 h-12 rounded-full bg-emerald-500 text-[#06120b] font-extrabold flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/30"
                >
                  <RotateCw className="size-4" />
                  {tx("تلاش مجدد", "Retry")}
                </button>
                <button
                  onClick={() => navigate("encyclopedia")}
                  className="h-12 px-5 rounded-full border border-emerald-200/25 text-emerald-100 font-bold text-sm hover:bg-emerald-500/10 transition-colors"
                >
                  {tx("جستجو در دانشنامه", "Search encyclopedia")}
                </button>
                <button
                  onClick={() => setPhase("idle")}
                  className="h-12 px-5 rounded-full border border-emerald-200/25 text-emerald-100 font-bold text-sm hover:bg-emerald-500/10 transition-colors"
                >
                  {tx("اسکن جدید", "New scan")}
                </button>
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        <footer className="py-4 text-center text-xs text-emerald-200/50 flex items-center justify-center gap-2">
          <ShieldCheck className="size-4" />
          {tx("اسکن ایمن", "Secure scan")} • {tx("داده‌های شما خصوصی است", "Your data stays private")}
        </footer>
      </div>

      {/* history sheet */}
      <AnimatePresence>
        {historyOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setHistoryOpen(false)} className="fixed inset-0 z-[70] bg-black/60" />
            <motion.aside
              id="scan-history"
              role="dialog"
              aria-modal="true"
              aria-label={tx("تاریخچه اسکن‌ها", "Scan history")}
              ref={historyDialogRef}
              tabIndex={-1}
              initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 280, damping: 30 }}
              className="fixed z-[75] bottom-0 inset-x-0 max-h-[55vh] rounded-t-3xl bg-[#0a1c12] border-t border-emerald-200/15 p-5 overflow-y-auto pv-scroll"
            >
              <div className="flex items-center justify-between mb-4">
                <p className="font-extrabold flex items-center gap-2 text-emerald-50"><History className="size-5 text-emerald-300" />{tx("تاریخچه اسکن‌ها", "Scan history")}</p>
                <button onClick={() => setHistoryOpen(false)} className="size-9 grid place-items-center rounded-full hover:bg-white/10" aria-label={tx("بستن", "Close")} data-autofocus><X className="size-5" /></button>
              </div>
              {historyLoading ? (
                <div className="py-10 flex flex-col items-center gap-3" aria-busy="true">
                  <span className="size-8 rounded-full border-2 border-emerald-300/25 border-t-emerald-300 animate-spin" />
                  <p className="text-sm text-emerald-200/60">{tx("در حال بارگذاری تاریخچه…", "Loading history…")}</p>
                </div>
              ) : historyError ? (
                <div className="py-8 text-center space-y-3">
                  <p className="text-sm text-red-300">{tx("بارگذاری تاریخچه ناموفق بود", "Couldn't load history")}</p>
                  <button onClick={openHistory} className="text-sm font-bold text-emerald-300 hover:underline">
                    {tx("تلاش مجدد", "Try again")}
                  </button>
                </div>
              ) : history.length === 0 ? (
                <p className="text-sm text-emerald-200/60 text-center py-8">{tx("هنوز اسکنی ثبت نشده — اولین اسکن را انجام دهید!", "No scans yet — do your first one!")}</p>
              ) : (
                <ul className="space-y-2 pb-4">
                  {history.map((h) => (
                    <li key={h.id} className="flex items-center gap-3 rounded-2xl bg-white/5 p-3">
                      {h.image ? (
                        <img
                          src={h.image}
                          alt={tx(h.nameFa, h.nameEn)}
                          className="size-11 rounded-xl object-cover border border-emerald-200/20 shrink-0"
                          loading="lazy"
                        />
                      ) : (
                        <span className="size-11 rounded-xl bg-emerald-500/10 grid place-items-center shrink-0 border border-emerald-200/10">
                          <Leaf className="size-4 text-emerald-300" />
                        </span>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold truncate">{tx(h.nameFa, h.nameEn)}</p>
                        <p className="text-[11px] text-emerald-200/60 italic truncate">{h.scientificName ?? h.nameEn}</p>
                      </div>
                      <span className="text-xs font-bold text-emerald-300">{num(h.confidence)}{isFa ? "٪" : "%"}</span>
                    </li>
                  ))}
                </ul>
              )}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function ToolButton({ label, onClick, children, active, dot, ariaExpanded, ariaControls }: { label: string; onClick: () => void; children: React.ReactNode; active?: boolean; dot?: boolean; ariaExpanded?: boolean; ariaControls?: string }) {
  return (
    <motion.button
      whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.94 }}
      onClick={onClick}
      aria-label={label}
      {...(ariaExpanded !== undefined ? { "aria-expanded": ariaExpanded } : {})}
      {...(ariaControls ? { "aria-controls": ariaControls } : {})}
      className={`relative w-20 lg:w-full rounded-2xl border p-3 flex lg:flex-col items-center justify-center gap-1.5 transition-colors ${
        active ? "bg-emerald-500/20 border-emerald-400/50 text-emerald-200" : "bg-white/5 border-white/10 text-emerald-100/90 hover:bg-white/10"
      }`}
    >
      {children}
      <span className="text-[10px] font-bold">{label}</span>
      {dot && <span className="absolute top-2 end-2 size-2 rounded-full bg-emerald-400 animate-pulse" />}
    </motion.button>
  );
}

/** Client-side downscale — keeps payloads small for upload + DB persistence. */
async function downscaleImage(dataUrl: string, maxDim = 1024, quality = 0.82): Promise<string> {
  try {
    const img = document.createElement("img");
    img.src = dataUrl;
    await img.decode();
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    if (scale >= 1) return dataUrl;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", quality);
  } catch {
    return dataUrl;
  }
}