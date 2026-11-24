/* ============================================================
   product-plant-link.ts — deterministic product → encyclopedia-plant
   mapping for the «از خرید به کاشت» (From Purchase to Planting)
   cross-view path (R49-4).

   Shop products carry a `scientificName` column that is populated
   with a real binomial name for living-goods categories (seeds,
   seedling, plants, mushroom) and with descriptive Persian text for
   non-living goods (fertilizer, tools). The mapping is therefore
   deterministic and data-driven:

     1. scientific match  — case/whitespace-normalized exact match of
        the product's scientificName against the encyclopedia's
        Plant.scientificName (the authoritative authority);
     2. alias match       — a curated `nameEn → plant slug` table for
        products whose commerce name is an exact vernacular label of
        an encyclopedia plant that the binomial lookup cannot see
        (kept for future catalog rows; ships empty because PlantVerse
        never aliases a *different* species — honesty over reach).

   Pure unit: no IO, no Prisma, fully injectable for tests. The API
   layer (GET /api/shop/[id]) and the quick-view dialog both consume
   the same functions so fixture-mode and DB-mode stay in lockstep.
   ============================================================ */

/* ─────────────────────────── types ─────────────────────────── */

/** Minimal plant shape needed for matching (DB rows and PV_PLANTS both satisfy it). */
export interface PlantLinkSeed {
  slug: string;
  nameFa: string;
  nameEn: string;
  scientificName: string;
}

/** Minimal product shape needed for matching. */
export interface ProductLinkSeed {
  nameEn: string;
  scientificName: string;
  category: string;
}

/** How the link was established — surfaced to the UI for honest copy. */
export type PlantMatchType = "scientific" | "alias";

/** The cross-view payload the UI renders the care-path strip from. */
export interface PlantLinkTarget {
  slug: string;
  nameFa: string;
  nameEn: string;
  matchType: PlantMatchType;
}

/* ─────────────────────── normalization ─────────────────────── */

/**
 * Normalize a binomial name for comparison: trim, lowercase, collapse
 * internal whitespace runs. Latin scientific names never rely on case
 * or spacing for meaning, so this is lossless for matching purposes.
 */
export function normalizeSciName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

/* ─────────────────────── curated aliases ─────────────────────── */

/**
 * Product `nameEn` → encyclopedia plant slug. PlantVerse policy: an
 * alias may only point at the SAME species the product actually sells.
 * The table starts empty because every current living-goods product
 * resolves through the scientific-name authority, and no product is
 * force-fitted to a different species (a ficus bonsai must never link
 * to a monstera page).
 */
export const PLANT_PRODUCT_ALIASES: Record<string, string> = {};

/* ─────────────────────── matchers ─────────────────────── */

/**
 * Exact (normalized) scientific-name match. Returns the plant or null;
 * empty product scientific names (fertilizer/tools rows) can never match
 * because `normalizeSciName("")` is a string no plant binomial equals.
 */
export function matchPlantByScientificName(
  scientificName: string,
  plants: PlantLinkSeed[]
): PlantLinkSeed | null {
  const wanted = normalizeSciName(scientificName);
  if (!wanted) return null;
  return plants.find((p) => normalizeSciName(p.scientificName) === wanted) ?? null;
}

/**
 * Alias lookup by the product's English commerce name (exact key match,
 * case-sensitive keys mirror the fixtures contract).
 */
export function matchPlantByAlias(
  product: ProductLinkSeed,
  plants: PlantLinkSeed[],
  aliases: Record<string, string> = PLANT_PRODUCT_ALIASES
): PlantLinkSeed | null {
  const slug = aliases[product.nameEn];
  if (!slug) return null;
  return plants.find((p) => p.slug === slug) ?? null;
}

/* ─────────────────────── main resolver ─────────────────────── */

/**
 * Resolve a product to its encyclopedia plant, or null when the product
 * has no honest counterpart (non-living goods, species not in the
 * encyclopedia). Scientific authority first, curated alias second.
 */
export function plantLinkForProduct(
  product: ProductLinkSeed,
  plants: PlantLinkSeed[],
  aliases: Record<string, string> = PLANT_PRODUCT_ALIASES
): PlantLinkTarget | null {
  const viaSci = matchPlantByScientificName(product.scientificName, plants);
  if (viaSci) {
    return {
      slug: viaSci.slug,
      nameFa: viaSci.nameFa,
      nameEn: viaSci.nameEn,
      matchType: "scientific",
    };
  }
  const viaAlias = matchPlantByAlias(product, plants, aliases);
  if (viaAlias) {
    return {
      slug: viaAlias.slug,
      nameFa: viaAlias.nameFa,
      nameEn: viaAlias.nameEn,
      matchType: "alias",
    };
  }
  return null;
}

/* ─────────────────────── copy helpers ─────────────────────── */

/** Bilingual strip title — matched-type-aware so the copy stays honest. */
export function plantLinkStripTitle(
  matchType: PlantMatchType,
  isFa: boolean
): string {
  if (isFa) {
    return matchType === "scientific"
      ? "این محصول با یک گیاه دانشنامه هم‌خوان است"
      : "این محصول با یک گیاه دانشنامه مرتبط است";
  }
  return matchType === "scientific"
    ? "This product matches an encyclopedia plant"
    : "This product is linked to an encyclopedia plant";
}

/** CTA labels — shared by the quick-view dialog. */
export const PLANT_LINK_CTA = {
  guide: { fa: "راهنمای کامل نگهداری", en: "Full care guide" },
  garden: { fa: "افزودن به باغ من", en: "Add to my garden" },
} as const;

/* ─────────────────────── stats helper ─────────────────────── */

/**
 * Count how many products in a catalog resolve to encyclopedia plants —
 * used by tests and by the shop header chip («۳ محصول با مسیر کاشت»). 
 */
export function linkedProductCount(
  products: ProductLinkSeed[],
  plants: PlantLinkSeed[],
  aliases: Record<string, string> = PLANT_PRODUCT_ALIASES
): number {
  return products.reduce(
    (acc, p) => acc + (plantLinkForProduct(p, plants, aliases) ? 1 : 0),
    0
  );
}
