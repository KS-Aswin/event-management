import { NextResponse } from "next/server";
import { findSearchSuggestions } from "@/lib/db";
import { getTaxonomy } from "@/lib/taxonomy";

const MAX_OFFERINGS = 5;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();

  if (q.length < 2) {
    return NextResponse.json({ categories: [], offerings: [], locations: [], vendors: [] });
  }

  const lower = q.toLowerCase();
  // Categories and offerings come from the DB taxonomy (P0-8), so anything an
  // admin adds or deactivates is reflected here.
  const [taxonomy, { locations, vendors }] = await Promise.all([getTaxonomy(), findSearchSuggestions(q)]);
  const activeCategories = taxonomy.categories.filter((c) => c.active);
  const categoryName = new Map(activeCategories.map((c) => [c.id, c.name]));
  const matchingCategories = activeCategories
    .filter((c) => c.name.toLowerCase().includes(lower) || c.display_name?.toLowerCase().includes(lower))
    .map((c) => c.name);
  const seen = new Set<string>();
  const offerings: { name: string; category: string }[] = [];
  for (const t of taxonomy.templates) {
    const category = categoryName.get(t.category_id);
    if (!t.active || !category || t.code === "other" || !t.name.toLowerCase().includes(lower)) continue;
    const key = t.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    offerings.push({ name: t.name, category });
    if (offerings.length >= MAX_OFFERINGS) break;
  }

  return NextResponse.json({ categories: matchingCategories, offerings, locations, vendors });
}
