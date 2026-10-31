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
