"use client";

import { useEffect, type RefObject } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "textarea:not([disabled])",
  "select:not([disabled])",
  "iframe",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/**
 * Modal-dialog focus management for the custom (non-Radix) overlays.
 *
 * Radix-based shadcn Dialog/Sheet/AlertDialog already trap focus; the five
 * portal-based custom dialogs (growth report, companion check, 360° viewer,
 * scanner history, catalog filters) previously relied on Escape alone, which
 * let keyboard users Tab into the page behind the modal. This hook completes
 * the WAI-ARIA dialog pattern with three behaviors:
 *
 * 1. **Initial focus** — the element carrying `data-autofocus` (typically the
 *    close button) receives focus right after mount; the dialog shell itself
 *    (needs `tabIndex={-1}`) is the fallback.
 * 2. **Tab trap** — Tab / Shift+Tab cycle strictly inside the dialog, so
 *    focus can never reach the page behind the overlay.
 * 3. **Focus restore** — when the dialog unmounts, focus returns to the
 *    element that was active before it opened (usually the trigger button),
 *    so keyboard flow resumes where it left off.
 *
 * Escape handling stays with each component (it is pinned per-dialog in
 * test-core-pure-libs Part 8) — this hook deliberately touches only focus.
 */
export function useDialogFocus(
  open: boolean,
  dialogRef: RefObject<HTMLElement | null>
) {
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    /* 1. initial focus: [data-autofocus] target, else the dialog shell */
    const raf = requestAnimationFrame(() => {
      const target =
        dialog.querySelector<HTMLElement>("[data-autofocus]") ?? dialog;
      target?.focus();
    });

    /* 2. Tab trap: cycle focusables inside the dialog */
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const focusables = dialog.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || active === dialog) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || active === dialog || !(active instanceof HTMLElement) || !dialog.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKey);
      /* 3. focus restore on unmount */
      previouslyFocused?.focus();
    };
  }, [open, dialogRef]);
}
