"use client";

/**
 * PlantVerse — keyboard shortcuts cheat-sheet («کلیدهای میان‌بر») 
 *
 * Opened by the global «؟» hotkey (app-shell) or from Profile → Settings.
 * Renders every single-letter view jump plus the Esc-to-close hint, fully
 * bilingual and RTL/LTR safe (the grid flips with the document direction).
 */

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppStore } from "@/lib/store/app-store";
import { useLang } from "@/lib/i18n/use-lang";
import { HELP_KEYS, SHORTCUTS } from "@/lib/keyboard-map";
import { Keyboard } from "lucide-react";

export function KeyboardShortcutsDialog() {
  const open = useAppStore((s) => s.shortcutsOpen);
  const setOpen = useAppStore((s) => s.setShortcutsOpen);
  const navigate = useAppStore((s) => s.navigate);
  const { tx, isFa } = useLang();

  const title = tx("کلیدهای میان‌بر", "Keyboard shortcuts");
  const desc = tx(
    "از هر جای اپ، یک کلید فشار بده تا مستقیم بپری به بخش موردنظر. برای دیدن این راهنما «؟» را بزن.",
    "From anywhere in the app, press a single key to jump straight to a section. Press «?» to see this guide."
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="max-w-md rounded-3xl border-border/60 bg-card p-6"
        data-testid="shortcuts-dialog"
        role="dialog"
        aria-modal="true"
      >
        <DialogHeader className="items-start text-start">
          <DialogTitle className="flex items-center gap-2 text-base font-extrabold sm:text-lg">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/15 text-primary" aria-hidden>
              <Keyboard className="size-4.5" />
            </span>
            {title}
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed text-muted-foreground sm:text-[13px]">
            {desc}
          </DialogDescription>
        </DialogHeader>

        <ul className="grid max-h-[52vh] gap-1.5 overflow-y-auto py-1 pe-1 [scrollbar-width:thin]" role="list">
          {SHORTCUTS.map((s) => (
            <li key={s.key}>
              <button
                type="button"
                onClick={() => {
                  if (s.view) navigate(s.view);
                  setOpen(false);
                }}
                data-testid={`shortcut-${s.key}`}
                className="flex w-full items-center justify-between gap-3 rounded-2xl px-3 py-2 text-start transition-colors hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <span className="text-sm font-semibold">{tx(s.labelFa, s.labelEn)}</span>
                <kbd
                  className="min-w-7 rounded-lg border border-border bg-muted px-2 py-0.5 text-center font-mono text-xs font-bold text-foreground shadow-sm"
                  aria-label={isFa ? `کلید ${s.labelFa}` : `Key for ${s.labelEn}`}
                >
                  {s.key.toUpperCase()}
                </kbd>
              </button>
            </li>
          ))}
        </ul>

        <p className="mt-1 border-t border-border/60 pt-3 text-[11px] leading-relaxed text-muted-foreground">
          <kbd className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-bold" aria-hidden>
            {tx("؟", HELP_KEYS[0])}
          </kbd>{" "}
          {tx("راهنما ·", "This guide ·")}
          <kbd className="mx-1 rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-bold" aria-hidden>
            Esc
          </kbd>
          {tx("بستن · در حال تایپ، میان‌برها بی‌اثرند", "close · shortcuts pause while you type")}
        </p>
      </DialogContent>
    </Dialog>
  );
}
