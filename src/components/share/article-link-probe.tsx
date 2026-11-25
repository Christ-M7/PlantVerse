"use client";

/**
 * PlantVerse — article deep-link probe (`/?article=SLUG`).
 *
 * Mounted once in AppShell: opening the app with `?article=SLUG` (the link
 * the article share button produces) navigates straight to the article view.
 * The query param is stripped immediately so refresh/back and StrictMode's
 * double-run never re-trigger. Unknown slugs land on the article view's
 * honest not-found state.
 */

import { useEffect } from "react";
import { useAppStore } from "@/lib/store/app-store";

export function ArticleLinkProbe() {
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const raw = sp.get("article");
    if (!raw) return;
    window.history.replaceState(null, "", window.location.pathname);
    const slug = raw.trim().slice(0, 120);
    if (slug) {
      useAppStore.getState().navigate("article", { slug });
    }
  }, []);
  return null;
}
