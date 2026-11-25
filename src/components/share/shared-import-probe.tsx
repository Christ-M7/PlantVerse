"use client";

/**
 * PlantVerse — shared-list URL probe («ورود با لینک اشتراک»). 
 *
 * Mounted once in AppShell: opening the app with `?shared=CODE` opens the
 * matching import preview no matter which view is active. The flavour is
 * carried by `kind` — `kind=garden` routes to the garden importer, anything
 * else (including legacy reading-list links shared before the flavour
 * existed) routes to the reading-list importer.
 *
 * The query params are stripped immediately so refresh/back and StrictMode's
 * double-run never re-trigger the probe.
 */

import { useEffect, useState } from "react";
import { ReadingListImportDialog } from "@/components/profile/reading-list-share";
import { GardenImportDialog } from "@/components/garden/garden-share";
import { normalizeShareCode, type ShareKind } from "@/lib/share-code";

export function SharedListImportProbe() {
  const [pending, setPending] = useState<{ code: string; kind: ShareKind } | null>(null);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      if (!alive) return;
      const sp = new URLSearchParams(window.location.search);
      const raw = sp.get("shared");
      if (!raw) return;
      window.history.replaceState(null, "", window.location.pathname);
      const code = normalizeShareCode(raw);
      if (code) setPending({ code, kind: sp.get("kind") === "garden" ? "garden" : "reading" });
    }, 0);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, []);

  const close = () => setPending(null);

  if (!pending) return null;
  return pending.kind === "garden" ? (
    <GardenImportDialog open onOpenChange={close} initialCode={pending.code} />
  ) : (
    <ReadingListImportDialog open onOpenChange={close} initialCode={pending.code} />
  );
}
