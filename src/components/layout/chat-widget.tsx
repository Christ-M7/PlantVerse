"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState, useRef, useEffect } from "react";
import { Leaf, Mic, X, Send, Sparkles } from "lucide-react";
import { useAppStore } from "@/lib/store/app-store";
import { useLang } from "@/lib/i18n/use-lang";
import { VoiceSearch } from "@/components/encyclopedia/voice-search";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

/** Strip LLM markdown artifacts for clean plain-text bubbles */
function cleanMd(raw: string) {
  return raw
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/^#{1,4}\s*/gm, "")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "• ");
}

export function ChatWidget() {
  const open = useAppStore((s) => s.chatOpen);
  const setOpen = useAppStore((s) => s.setChatOpen);
  const view = useAppStore((s) => s.view);
  const slug = useAppStore((s) => s.slug);
  const { tx, lang } = useLang();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  /* Escape closes the chat panel */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  const send = async (text?: string) => {
    const message = (text ?? input).trim();
    if (!message || busy) return;
    const next = [...messages, { role: "user" as const, content: message }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          lang,
          history: next.slice(-8),
          /* where the user is asking FROM — lets the bot answer in context
             (the plant page slug unlocks real catalog care attributes) */
          context: { view, slug: slug ?? undefined },
        }),
      });
      const data = await res.json();
      setMessages((m) => [...m, { role: "assistant", content: cleanMd(String(data.response ?? data.error ?? "…")) }]);
    } catch {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: tx("اتصال برقرار نشد؛ دوباره تلاش کنید 🌱", "Connection failed; please retry 🌱") },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const baseSuggestions = lang === "fa"
    ? ["چطور مونسترا را تکثیر کنم؟", "برگ کالاتیا قهوه‌ای شده!", "بهترین گیاه برای اتاق خواب؟"]
    : ["How to propagate Monstera?", "My Calathea leaves are browning!", "Best bedroom plants?"];
  /* on a plant page the first chip asks about THIS plant — the context
     line grounds the bot's answer in real catalog attributes */
  const suggestions =
    view === "plant" && slug
      ? [
          tx("همین گیاهی که باز است را چطور آبیاری کنم؟", "How should I water the plant I have open?"),
          ...baseSuggestions.slice(0, 2),
        ]
      : baseSuggestions;

  if (view === "scanner") return null;

  return (
    <>
      {/* Floating launcher */}
      <motion.button
        onClick={() => setOpen(!open)}
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.94 }}
        aria-label={tx("چت با گیاه‌شناس هوشمند", "Chat with AI botanist")}
        aria-expanded={open}
        className="fixed bottom-24 sm:bottom-28 z-[60] end-5 size-14 rounded-full bg-primary text-primary-foreground shadow-2xl shadow-primary/40 pv-breathe grid place-items-center"
      >
        <AnimatePresence mode="wait">
          {open ? (
            <motion.span key="x" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }}>
              <X className="size-6" />
            </motion.span>
          ) : (
            <motion.span key="leaf" initial={{ rotate: 90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: -90, opacity: 0 }} className="pv-float">
              <Leaf className="size-6" strokeWidth={2.2} />
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.94 }}
            transition={{ type: "spring", stiffness: 260, damping: 24 }}
            role="dialog"
            aria-modal="true"
            aria-label={tx("گفتگو با گیاه‌شناس هوشمند", "AI botanist chat")}
            className="fixed z-[60] bottom-40 sm:bottom-44 end-4 w-[calc(100vw-2rem)] max-w-sm rounded-3xl border border-border/70 bg-card/95 pv-glass shadow-2xl shadow-forest/25 dark:shadow-black/60 overflow-hidden flex flex-col"
            style={{ height: "min(520px, 62vh)" }}
          >
            {/* header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border/60 bg-gradient-to-l from-sage-soft/60 to-transparent">
              <span className="size-10 rounded-2xl bg-primary/15 grid place-items-center">
                <Leaf className="size-5 text-primary" />
              </span>
              <div className="flex-1">
                <p className="font-bold text-sm">{tx("گیاه‌شناس هوشمند", "AI Botanist")}</p>
                <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  {tx("آنلاین — آماده پاسخ‌گویی", "Online — ready to help")}
                </p>
              </div>
              <Sparkles className="size-4 text-gold" />
            </div>

            {/* messages */}
            <div ref={scrollRef} className="pv-scroll flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {messages.length === 0 && (
                <div className="text-center pt-6 space-y-4">
                  <div className="size-16 mx-auto rounded-full bg-sage-soft dark:bg-secondary grid place-items-center">
                    <Leaf className="size-8 text-primary pv-float" />
                  </div>
                  <p className="text-sm text-muted-foreground max-w-[240px] mx-auto leading-relaxed">
                    {tx(
                      "سلام! من گیاه‌شناس هوشمند جهان‌گیاه هستم. هر سوالی درباره‌ی گیاهانت داری بپرس 🌿",
                      "Hi! I'm PlantVerse's AI botanist. Ask me anything about your plants 🌿"
                    )}
                  </p>
                </div>
              )}
              {messages.map((m, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                      m.role === "user"
                        ? "bg-primary text-primary-foreground rounded-ee-md"
                        : "bg-muted/80 dark:bg-secondary/60 rounded-es-md"
                    }`}
                  >
                    {m.content}
                  </div>
                </motion.div>
              ))}
              {busy && (
                <div className="flex justify-start">
                  <div className="bg-muted/80 dark:bg-secondary/60 rounded-2xl rounded-es-md px-4 py-3 flex gap-1.5">
                    {[0, 1, 2].map((i) => (
                      <motion.span
                        key={i}
                        className="size-2 rounded-full bg-primary/60"
                        animate={{ y: [0, -5, 0] }}
                        transition={{ repeat: Infinity, duration: 0.9, delay: i * 0.15 }}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* suggestions */}
            {messages.length === 0 && (
              <div className="px-4 pb-2 flex flex-wrap gap-2">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="text-[11px] rounded-full border border-border bg-background/70 hover:bg-sage-soft dark:hover:bg-secondary px-3 py-1.5 transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {/* input */}
            <form
              onSubmit={(e) => { e.preventDefault(); send(); }}
              className="flex items-center gap-2 p-3 border-t border-border/60"
            >
              {/* ASR — same recorder engine as the encyclopedia/garden mounts */}
              <motion.button
                whileTap={{ scale: 0.9 }}
                type="button"
                onClick={() => setVoiceOpen(true)}
                disabled={busy}
                aria-label={tx("جستجوی صوتی", "Voice search")}
                data-testid="chat-voice-open"
                className="size-11 shrink-0 rounded-full border border-border bg-background text-muted-foreground grid place-items-center transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-40"
              >
                <Mic className="size-4.5" />
              </motion.button>
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={tx("سوال گیاهی‌ات را بنویس…", "Ask a plant question…")}
                className="flex-1 h-11 min-w-0 rounded-full bg-background border border-input px-4 text-sm outline-none focus:ring-2 focus:ring-ring/50"
                aria-label={tx("پیام", "Message")}
              />
              <motion.button
                whileTap={{ scale: 0.9 }}
                type="submit"
                disabled={busy || !input.trim()}
                aria-label={tx("ارسال", "Send")}
                className="size-11 rounded-full bg-primary text-primary-foreground grid place-items-center disabled:opacity-40 shadow-md shadow-primary/30"
              >
                <Send className="size-4.5 rtl:rotate-180" />
              </motion.button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* voice → transcript lands in the composer input (not auto-sent —
          the user stays in control of what goes to the bot) */}
      <VoiceSearch
        open={voiceOpen}
        onOpenChange={setVoiceOpen}
        onApply={(text) => {
          setInput(text);
          setVoiceOpen(false);
          window.setTimeout(() => inputRef.current?.focus(), 60);
        }}
      />
    </>
  );
}
