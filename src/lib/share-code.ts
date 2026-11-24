/**
 * PlantVerse — share-code utilities for reading-list sharing.
 *
 * A shared reading list is addressed by an 8-character code embedded in links
 * as `?shared=CODE`. Codes use a Crockford-style base32 alphabet without
 * ambiguous glyphs (no I, L, O, U) and are displayed/stored uppercase. Typed
 * or pasted codes are normalized case-insensitively with lookalike mapping
 * (O→0, I/L→1) so a hand-written code still resolves.
 */

export const SHARE_CODE_LENGTH = 8;
export const SHARE_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const SHARE_CODE_PATTERN = /^[0-9A-Z]{8}$/;

/**
 * Normalize a user-supplied code; returns the canonical form or `null` when
 * the string can't possibly be a share code (wrong length / bad glyphs).
 */
export function normalizeShareCode(raw: string): string | null {
  const code = raw
    .trim()
    .toUpperCase()
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  if (!SHARE_CODE_PATTERN.test(code)) return null;
  for (const c of code) {
    if (!SHARE_CODE_ALPHABET.includes(c)) return null;
  }
  return code;
}

/** Share flavours — a code only resolves in its own importer. */
export type ShareKind = "reading" | "garden";

/**
 * Canonical link for a share code (client-only helper — falls back to a
 * relative URL on the server). `kind` is embedded for the importer probe
 * (`?shared=CODE&kind=garden`); reading links stay param-free for backward
 * compatibility with links shared before the garden flavour existed.
 */
export function buildShareUrl(code: string, kind: ShareKind = "reading"): string {
  const suffix = kind === "garden" ? "&kind=garden" : "";
  if (typeof window === "undefined") return `/?shared=${code}${suffix}`;
  return `${window.location.origin}/?shared=${code}${suffix}`;
}
