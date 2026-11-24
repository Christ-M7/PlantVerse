import type { ArticleFixture, ArticleSection, PlantCategory } from "@/data/fixtures";

/** Raw /api/articles row — JSON columns may arrive as strings (DB) or arrays (fallback). */
export interface ArticleRow {
  slug: string;
  titleFa: string;
  titleEn: string;
  excerptFa: string;
  excerptEn: string;
  contentFa: unknown;
  contentEn: unknown;
  tagsFa: unknown;
  tagsEn: unknown;
  gallery: unknown;
  category: string;
  image: string;
  readMinutes: number;
  views: number;
  featured: boolean;
  authorFa: string;
  authorEn: string;
  publishedAt: string;
}

/** Parse a JSON column that may be a string or an already-parsed array. */
function asSections(raw: unknown): ArticleSection[] {
  if (Array.isArray(raw)) return raw as ArticleSection[];
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as ArticleSection[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Parse a JSON string[] column (tags, gallery) that may be a string or array. */
function asStringArray(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === "string");
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Normalize an API row into the UI-facing ArticleFixture. */
export function toArticleFixture(row: ArticleRow): ArticleFixture {
  return {
    slug: row.slug,
    titleFa: row.titleFa,
    titleEn: row.titleEn,
    excerptFa: row.excerptFa,
    excerptEn: row.excerptEn,
    contentFa: asSections(row.contentFa),
    contentEn: asSections(row.contentEn),
    tagsFa: asStringArray(row.tagsFa),
    tagsEn: asStringArray(row.tagsEn),
    gallery: asStringArray(row.gallery),
    category: row.category as PlantCategory,
    image: row.image,
    readMinutes: row.readMinutes,
    views: row.views,
    featured: Boolean(row.featured),
    authorFa: row.authorFa,
    authorEn: row.authorEn,
    publishedAt: row.publishedAt,
  };
}
