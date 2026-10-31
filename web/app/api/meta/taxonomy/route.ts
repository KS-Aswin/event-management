import { NextResponse } from "next/server";
import { getTaxonomy } from "@/lib/taxonomy";

// Rendered per request (so `next build` never needs the database), but the
// data itself is cached for 300 s in lib/taxonomy.ts and browsers/CDNs may
// reuse the response for the same window.
export const dynamic = "force-dynamic";

/**
 * GET /api/meta/taxonomy (public): the single source of truth for category
 * lists. Returns active categories (with slug, display name, price units and
 * attribute schema), offering templates, event types with their "what you
 * need" category bundle, Kerala districts and price units with labels.
 */
export async function GET() {
  try {
    const taxonomy = await getTaxonomy();
    return NextResponse.json(taxonomy, {
      headers: { "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch (err) {
    console.error("GET /api/meta/taxonomy failed", err);
    return NextResponse.json({ error: "Could not load categories.", code: "UNAVAILABLE" }, { status: 503 });
  }
}
