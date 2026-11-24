/**
 * PlantVerse — Focus-mode keyboard map («کلیدهای میان‌بر»)
 *
 * Pure, framework-free single-letter shortcuts that ride the app-shell's
 * skip-link infrastructure: the first Tab reaches «پرش به محتوای اصلی»,
 * and from anywhere a keypress can jump straight to a view or open the
 * «؟» cheat-sheet dialog.
 *
 * Design notes
 *  - Latin mnemonics on purpose (g garden, r reminders, s scan…) — keys are
 *    physical and language-agnostic; the cheat-sheet labels each one in the
 *    active language so fa users see «باغ من — G».
 *  - Typing safety is a pure predicate: `shouldIgnoreShortcut` rejects every
 *    modifier combo, IME composition, and any editable target (input,
 *    textarea, select, contentEditable, Radix combobox/search fields) so
 *    hotkeys never hijack form filling or the chat composer.
 *  - Dialog-open detection is deliberately NOT here (DOM-dependent) — the
 *    shell checks `target.closest('[role="dialog"]')` itself.
 */

import type { View } from "@/lib/store/app-store";

export interface ShortcutDef {
  /** physical key (lowercase latin) — the value shown in <kbd> */
  key: string;
  /** target view when pressed; omitted for the help key */
  view?: View;
  labelFa: string;
  labelEn: string;
}

/** Single-letter view jumps + the «؟» help key — display order = cheat-sheet order. */
export const SHORTCUTS: readonly ShortcutDef[] = [
  { key: "h", view: "home", labelFa: "خانه", labelEn: "Home" },
  { key: "e", view: "encyclopedia", labelFa: "دانشنامه", labelEn: "Encyclopedia" },
  { key: "s", view: "scanner", labelFa: "اسکن گیاه", labelEn: "Scan plant" },
  { key: "g", view: "garden", labelFa: "باغ من", labelEn: "My garden" },
  { key: "r", view: "reminders", labelFa: "یادآورها", labelEn: "Reminders" },
  { key: "c", view: "community", labelFa: "انجمن", labelEn: "Community" },
  { key: "b", view: "shop", labelFa: "فروشگاه", labelEn: "Shop" },
  { key: "p", view: "profile", labelFa: "پروفایل", labelEn: "Profile" },
  { key: "f", view: "greenhouse", labelFa: "گلخانه", labelEn: "Greenhouse" },
  { key: "m", view: "mushrooms", labelFa: "قارچ‌ها", labelEn: "Mushrooms" },
] as const;

/** The cheat-sheet key: both «؟» (shift+/ on EN) and the Persian «؟» glyph. */
export const HELP_KEYS = ["?", "؟"] as const;

/** key → ShortcutDef (help included). Uppercase and Persian «؟» normalized. */
export function matchShortcut(rawKey: string): ShortcutDef | null {
  const key = rawKey === "؟" ? "?" : rawKey.toLowerCase();
  if (HELP_KEYS.includes(key as (typeof HELP_KEYS)[number])) {
    return { key: "?", labelFa: "کلیدهای میان‌بر", labelEn: "Keyboard shortcuts" };
  }
  return SHORTCUTS.find((s) => s.key === key) ?? null;
}

/**
 * True when a keydown must be ignored: any modifier combo (let browser/OS
 * shortcuts win), IME composition, or an editable target (form fields,
 * contentEditable, Radix comboboxes use role="combobox" inputs too).
 */
export function shouldIgnoreShortcut(target: EventTarget | null, event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) return true;
  if (event.isComposing) return true;
  if (!(target instanceof HTMLElement)) return false; // body → allow
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}
