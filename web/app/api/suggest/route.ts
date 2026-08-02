import { NextResponse } from "next/server";
import { findSearchSuggestions } from "@/lib/db";
import { CATEGORIES } from "@/lib/vendorVisuals";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();

  if (q.length < 2) {
    return NextResponse.json({ categories: [], locations: [], vendors: [] });
  }

  const lower = q.toLowerCase();
  const matchingCategories = CATEGORIES.filter((c) => c.toLowerCase().includes(lower));

  const { locations, vendors } = await findSearchSuggestions(q);

  return NextResponse.json({ categories: matchingCategories, locations, vendors });
}
