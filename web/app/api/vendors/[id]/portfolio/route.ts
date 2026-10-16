import { NextResponse } from "next/server";
import { requireOwnedVendor } from "@/lib/vendor-auth";
import { addPortfolioItem, listPortfolio, MAX_PORTFOLIO_ITEMS } from "@/lib/vendor-content";
import { isHttpsUrl } from "@/lib/validate";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const owned = await requireOwnedVendor(id);
  if (!owned.ok) return owned.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const { url, caption } = (body ?? {}) as Record<string, unknown>;

  if (typeof url !== "string" || url.length > 500 || !isHttpsUrl(url.trim())) {
    return NextResponse.json({ error: "Please provide a valid https image link." }, { status: 400 });
  }
  if (caption !== undefined && caption !== null && (typeof caption !== "string" || caption.length > 120)) {
    return NextResponse.json({ error: "Caption must be 120 characters or fewer." }, { status: 400 });
  }

  const existing = await listPortfolio(owned.vendor.id);
  if (existing.length >= MAX_PORTFOLIO_ITEMS) {
    return NextResponse.json(
      { error: `You can add up to ${MAX_PORTFOLIO_ITEMS} portfolio photos.` },
      { status: 400 }
    );
  }

  const item = await addPortfolioItem(
    owned.vendor.id,
    owned.userId,
    url.trim(),
    typeof caption === "string" && caption.trim() ? caption.trim() : null
  );
  if (!item) {
    return NextResponse.json({ error: "Listing not found, or you don't own it." }, { status: 404 });
  }
  return NextResponse.json({ item }, { status: 201 });
}
