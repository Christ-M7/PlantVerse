"use client";

import { useEffect, useState } from "react";

/**
 * PlantVerse — lightweight viewer identity («کلید بازدیدکننده»).
 *
 * The demo has no auth, but "whose post is this?" still matters: the
 * notification center must notify the REAL viewer (this browser), not
 * whoever happens to type the demo profile name. A stable random key is
 * minted once per browser, persisted in localStorage, and attached to
 * everything the viewer authors (posts, comments, replies). The server
 * scopes ownership by key first and falls back to the demo profile name
 * for legacy rows (authorKey === "") so pre-R39 content stays coherent.
 *
 * Threat model is demo-level (same as the authorName delete guard): the
 * key is an identity HANDLE, not a secret.
 */

const STORAGE_KEY = "plantverse-viewer-key";
const KEY_MAX = 64;

/** Read the persisted key, minting one on first visit. SSR-safe (→ ""). */
export function getViewerKey(): string {
  if (typeof window === "undefined") return "";
  try {
    let v = window.localStorage.getItem(STORAGE_KEY);
    if (!v) {
      v =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID().replace(/-/g, "").slice(0, 24)
          : `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
      window.localStorage.setItem(STORAGE_KEY, v);
    }
    return v.slice(0, KEY_MAX);
  } catch {
    /* storage blocked (private mode) — identity simply degrades to legacy */
    return "";
  }
}

/**
 * React binding. Returns "" during SSR and the first client render, then
 * settles after mount (the app-wide "deferred after hydration" pattern)
 * so server and client markup stay identical.
 */
export function useViewerKey(): string {
  const [key, setKey] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setKey(getViewerKey()), 0);
    return () => clearTimeout(t);
  }, []);
  return key;
}
