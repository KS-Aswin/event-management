import { unstable_cache } from "next/cache";
import { findTaxonomy, type Taxonomy } from "./db";

/** Cache tag: call revalidateTag(TAXONOMY_TAG) after an admin edits categories/templates. */
export const TAXONOMY_TAG = "taxonomy";

/**
 * The taxonomy (categories, offering templates, event types, districts, price
 * units), cached for 5 minutes. Use this from server components and routes so
 * every category list comes from the database (P0-8); /api/meta/taxonomy
 * serves the same data to client components.
 */
export const getTaxonomy: () => Promise<Taxonomy> = unstable_cache(findTaxonomy, ["taxonomy-v1"], {
  revalidate: 300,
  tags: [TAXONOMY_TAG],
});

/**
 * Categories have a stable internal `name` (stored on vendors.category and
 * used as the ?category= filter value, so old links keep working) and an
 * admin-editable `display_name`. Anything shown to people uses the display
 * name (QA-008): an admin rename must reach search filters, chips and cards.
 */
export function categoryLabeller(taxonomy: Pick<Taxonomy, "categories"> | null | undefined): (name: string | null | undefined) => string {
  const byName = new Map<string, string>();
  for (const c of taxonomy?.categories ?? []) byName.set(c.name.toLowerCase(), c.display_name?.trim() || c.name);
  return (name) => (name ? (byName.get(name.trim().toLowerCase()) ?? name) : "");
}

/** The cached taxonomy's labeller; falls back to the raw name if the taxonomy can't load. */
export async function getCategoryLabeller(): Promise<(name: string | null | undefined) => string> {
  try {
    return categoryLabeller(await getTaxonomy());
  } catch {
    return categoryLabeller(null);
  }
}

/**
 * Resolve a ?category= value to the internal name: the name itself, the
 * slug, or the (current) display name, case-insensitively. null if unknown.
 */
export function resolveCategoryName(taxonomy: Pick<Taxonomy, "categories">, value: string): string | null {
  const v = value.trim().toLowerCase();
  if (!v) return null;
  const c = taxonomy.categories.find(
    (x) => x.name.toLowerCase() === v || x.slug?.toLowerCase() === v || x.display_name?.trim().toLowerCase() === v
  );
  return c ? c.name : null;
}
