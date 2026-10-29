import { NextResponse } from "next/server";
import {
  findVendorById,
  findReviewsByVendor,
  findServicesByVendor,
  findPortfolioByVendor,
  updateVendorListing,
} from "@/lib/db";
import { getSession } from "@/lib/session";
import { CATEGORIES } from "@/lib/vendorVisuals";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const vendorId = parseInt(id, 10);
  if (Number.isNaN(vendorId)) {
    return NextResponse.json({ error: "Invalid vendor id." }, { status: 400 });
  }

  const vendor = await findVendorById(vendorId);
  if (!vendor) {
    return NextResponse.json({ error: "Vendor not found." }, { status: 404 });
  }

  const [reviews, services, portfolio] = await Promise.all([
    findReviewsByVendor(vendorId),
    findServicesByVendor(vendorId),
    findPortfolioByVendor(vendorId),
  ]);

  return NextResponse.json({ vendor, reviews, services, portfolio });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;
  const vendorId = parseInt(id, 10);
  if (Number.isNaN(vendorId)) {
    return NextResponse.json({ error: "Invalid vendor id." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { name, category, location, price, experience, tags, about } = (body ?? {}) as Record<
    string,
    unknown
  >;

  if (category !== undefined && !CATEGORIES.includes(category as (typeof CATEGORIES)[number])) {
    return NextResponse.json({ error: "Please choose a valid category." }, { status: 400 });
  }

  let priceNum: number | undefined;
  let priceLabel: string | undefined;
  if (price !== undefined) {
    priceNum = typeof price === "number" ? price : parseInt(String(price), 10);
    if (!priceNum || priceNum <= 0) {
      return NextResponse.json({ error: "Please enter a valid starting price." }, { status: 400 });
    }
    priceLabel = `₹${priceNum.toLocaleString("en-IN")} onwards`;
  }

  const tagList = Array.isArray(tags)
    ? tags.filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    : undefined;

  const updated = await updateVendorListing(vendorId, session.userId, {
    name: typeof name === "string" && name.trim() ? name.trim() : undefined,
    category: typeof category === "string" ? category : undefined,
    location: typeof location === "string" && location.trim() ? location.trim() : undefined,
    price: priceNum,
    priceLabel,
    experience: typeof experience === "string" && experience.trim() ? experience.trim() : undefined,
    tags: tagList,
    about: typeof about === "string" && about.trim() ? about.trim() : undefined,
  });

  // updateVendorListing's WHERE clause matches on (id AND owner_id) together,
  // so a null result here means either the listing doesn't exist or it
  // doesn't belong to this user — deliberately the same 404 for both, so a
  // caller can't use this endpoint to probe which vendor ids exist and are
  // (or aren't) owned by someone else.
  if (!updated) {
    return NextResponse.json(
      { error: "Listing not found, or you don't own it." },
      { status: 404 }
    );
  }

  return NextResponse.json({ vendor: updated });
}
