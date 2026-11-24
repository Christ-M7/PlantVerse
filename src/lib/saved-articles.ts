/**
 * PlantVerse — shared reading-list store (localStorage-backed).
 *
 * Single source of truth for bookmarked magazine articles, used by both the
 * article view (toggle button) and the profile reading-list section. Key
 * properties:
 *
 *  - `pv-saved-articles` holds a JSON string[] of slugs (oldest first, newest
 *    appended at the end — the profile list mirrors this order).
 *  - Reads are cached per-tab so `useSyncExternalStore` snapshots are
 *    referentially stable (no render loops) and stay cheap.
 *  - Every write dispatches a same-tab `pv:saved-articles` CustomEvent; the
 *    browser's cross-tab `storage` event is subscribed too, so all mounted
 *    consumers live-sync without prop drilling.
 *  - All storage access is try/catch-wrapped: private mode / quota errors
 *    degrade to in-memory state instead of breaking the UX.
 */

export const SAVED_KEY = "pv-saved-articles";
/** Same-tab notification — `detail` carries the fresh slug list. */
export const SAVED_EVENT = "pv:saved-articles";

/** Module-level snapshot cache — invalidated on every external notification. */
let cache: string[] | null = null;

const parse = (raw: string | null): string[] => {
  try {
    const parsed: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
};

/** Current saved slugs (order = insertion order). Safe on the server (→ []). */
export function readSavedArticles(): string[] {
  if (cache) return cache;
  if (typeof window === "undefined") return [];
  cache = parse(window.localStorage.getItem(SAVED_KEY));
  return cache;
}

/** Persist the list, refresh the cache and notify same-tab subscribers. */
export function writeSavedArticles(slugs: string[]): void {
  cache = slugs;
  try {
    window.localStorage.setItem(SAVED_KEY, JSON.stringify(slugs));
  } catch {
    /* private mode / quota — keep UX running without persistence */
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<string[]>(SAVED_EVENT, { detail: slugs }));
  }
}

/** Toggle one slug; returns the new bookmarked state for that slug. */
export function toggleSavedArticle(slug: string): boolean {
  const current = readSavedArticles();
  const exists = current.includes(slug);
  writeSavedArticles(exists ? current.filter((s) => s !== slug) : [...current, slug]);
  return !exists;
}

/**
 * Subscribe for `useSyncExternalStore`. Listens to the same-tab CustomEvent
 * and cross-tab `storage` events; both invalidate the cache so the next
 * snapshot re-reads localStorage. Returns an unsubscribe function.
 */
export function subscribeSavedArticles(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const invalidate = () => {
    cache = null;
    onChange();
  };
  window.addEventListener(SAVED_EVENT, invalidate);
  window.addEventListener("storage", invalidate);
  return () => {
    window.removeEventListener(SAVED_EVENT, invalidate);
    window.removeEventListener("storage", invalidate);
  };
}
