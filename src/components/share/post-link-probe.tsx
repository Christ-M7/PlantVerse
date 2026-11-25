"use client";

/**
 * PlantVerse — post deep-link probe (`/?post=ID`).
 *
 * Mounted once in AppShell: opening the app with `?post=ID` (the link the
 * «کپی لینک پست» menu produces) navigates to the community feed which then
 * scrolls to and ring-highlights the post. The query param is stripped
 * immediately so refresh/back and StrictMode's double-run never re-trigger.
 *
 * Unknown or malformed ids still navigate — the feed shows its honest
 * "post couldn't be found" toast after its retry budget expires.
 */

import { useEffect } from "react";
import { useAppStore } from "@/lib/store/app-store";

export function PostLinkProbe() {
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const raw = sp.get("post");
    if (!raw) return;
    window.history.replaceState(null, "", window.location.pathname);
    const id = raw.trim().slice(0, 64);
    if (id) {
      // navigate bumps navSeq even when community is already the active view,
      // so re-opening the same link re-arms the highlight effect
      useAppStore.getState().navigate("community", { query: id });
    }
  }, []);
  return null;
}
